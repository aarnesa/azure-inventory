#requires -Version 7.0
Import-Module (Join-Path $PSScriptRoot '..\scripts\AzureInventory.psm1') -Force

InModuleScope AzureInventory {
    BeforeAll {
        . (Join-Path $script:Root 'tests\fixtures\New-SyntheticData.ps1')
        function New-TestPage {
            param([object[]] $Rows = @(), [int] $Total = 0, [string] $Token = '')
            return @{ data = @($Rows); count = $Rows.Count; totalRecords = $Total
                resultTruncated = [bool] $Token; '$skipToken' = $Token }
        }

        function New-TestModel {
            param($Fixture)
            return ConvertTo-InventoryModel -Context $Fixture.context -ResourceRows $Fixture.resources `
                -ContainerRows $Fixture.containers -ReferenceRows $Fixture.references `
                -Warnings ([System.Collections.Generic.List[object]]::new()) -StartedAt '2026-01-01T00:00:00Z'
        }
    }

    Describe 'Azure CLI response handling' {
        BeforeEach {
            Mock Invoke-AzProcess { throw 'A test attempted an unmocked Azure call.' }
            Mock Start-Sleep {}
        }
        It 'retries throttling and returns the successful JSON without printing raw responses' {
            $script:attempt = 0
            Mock Invoke-AzProcess {
                $script:attempt++
                if ($script:attempt -lt 3) { return @{ exitCode = 1; text = 'ERROR: (TooManyRequests) 429' } }
                return @{ exitCode = 0; text = '{"data":[]}' }
            }
            (Invoke-AzJson -Arguments @('rest') -RetryTransient)['data'].Count | Should -Be 0
            Should -Invoke Invoke-AzProcess -Times 3 -Exactly
            Should -Invoke Start-Sleep -Times 2 -Exactly
        }
        It 'stops after four transient attempts and does not expose raw error content' {
            Mock Invoke-AzProcess { @{ exitCode = 1; text = '503 ServiceUnavailable PRIVATE_SENTINEL' } }
            { Invoke-AzJson -Arguments @('rest') -RetryTransient } | Should -Throw '*bounded retries*'
            Should -Invoke Invoke-AzProcess -Times 4 -Exactly
        }
        It 'reports an authentication category without leaking the raw error' {
            Mock Invoke-AzProcess { @{ exitCode = 1; text = 'AADSTS expired session PRIVATE_SENTINEL' } }
            try { Invoke-AzJson -Arguments @('rest') -RetryTransient; throw 'Expected failure' }
            catch {
                $_.Exception.Data['Category'] | Should -Be 'Authentication'
                $_.Exception.Message | Should -Not -Match 'PRIVATE_SENTINEL'
            }
            Should -Invoke Invoke-AzProcess -Times 1 -Exactly
        }
        It 'rejects malformed success output instead of producing an empty inventory' {
            Mock Invoke-AzProcess { @{ exitCode = 0; text = 'not-json' } }
            { Invoke-AzJson -Arguments @('rest') } | Should -Throw '*invalid JSON*'
        }
    }

    Describe 'User and tenant scope' {
        BeforeEach {
            $script:fixture = New-SyntheticData
            $script:account = @{ tenantId = $fixture.context.tenantId; user = @{ type = 'user'; name = 'synthetic-user' } }
            $script:accounts = @(
                @{ id = $fixture.context.subscriptions[0].id; tenantId = $fixture.context.tenantId
                    name = 'Demo'; state = 'Enabled'; user = @{ type = 'user'; name = 'synthetic-user' } },
                @{ id = '22222222-2222-2222-2222-222222222222'; tenantId = '33333333-3333-3333-3333-333333333333'
                    name = 'Different tenant'; state = 'Enabled'; user = @{ type = 'user'; name = 'synthetic-user' } }
            )
            Mock Invoke-AzJson {
                switch ($Arguments[0] + ' ' + $Arguments[1]) {
                    'account show' { return $script:account }
                    'account list' { return ,$script:accounts }
                    'cloud show' { return @{ name = 'AzureCloud'; endpoints = @{ resourceManager = 'https://management.azure.com/' } } }
                    default { throw 'Unexpected command' }
                }
            }
        }
        It 'refreshes the cache and limits discovery to the explicit tenant' {
            $context = Get-InventoryContext $fixture.context.tenantId
            $context.subscriptions.Count | Should -Be 1
            $context.subscriptions[0].id | Should -Be $fixture.context.subscriptions[0].id
            Should -Invoke Invoke-AzJson -Times 1 -ParameterFilter { $Arguments[1] -eq 'list' -and '--refresh' -in $Arguments }
            Should -Invoke Invoke-AzJson -Times 0 -ParameterFilter { 'set' -in $Arguments -or 'login' -in $Arguments }
        }
        It 'rejects a mismatched active tenant before refreshing other subscriptions' {
            $script:account.tenantId = '33333333-3333-3333-3333-333333333333'
            { Get-InventoryContext $fixture.context.tenantId } | Should -Throw '*not in tenant*'
            Should -Invoke Invoke-AzJson -Times 0 -ParameterFilter { $Arguments[1] -eq 'list' }
        }
        It 'rejects service-principal authentication' {
            $script:account.user.type = 'servicePrincipal'
            { Get-InventoryContext $fixture.context.tenantId } | Should -Throw '*interactive user*'
        }
        It 'rejects a mixed-principal subscription cache' {
            $script:accounts[0].user.name = 'different-user'
            { Get-InventoryContext $fixture.context.tenantId } | Should -Throw '*different principal*'
        }
        It 'recognizes a tenant-level account with no subscriptions' {
            $script:accounts = @(@{
                id = $fixture.context.tenantId; tenantId = $fixture.context.tenantId
                name = 'N/A(tenant level account)'; user = @{ type = 'user'; name = 'synthetic-user' }
            })
            (Get-InventoryContext $fixture.context.tenantId).subscriptions.Count | Should -Be 0
        }
    }

    Describe 'Complete pagination and safe requests' {
        BeforeEach {
            $script:fixture = New-SyntheticData
            $script:subscription = $fixture.context.subscriptions[0].id
            Mock Invoke-AzProcess { throw 'A test attempted an unmocked Azure call.' }
        }
        It 'collects 2501 resources and follows tokens rather than the first-page count' {
            $script:allRows = (New-SyntheticData -ResourceCount 2501).resources
            $script:pageNumber = 0
            Mock Invoke-GraphRequest {
                $Body.subscriptions.Count | Should -Be 1
                $Body.options.allowPartialScopes | Should -BeFalse
                $Body.options.resultFormat | Should -Be 'objectArray'
                $Body.options['$top'] | Should -Be 1000
                $Body.query | Should -Match 'order by id asc'
                $offset = $script:pageNumber * 1000
                if ($script:pageNumber) { $Body.options['$skipToken'] | Should -Be "token-$script:pageNumber" }
                $script:pageNumber++
                $token = if ($script:pageNumber -lt 3) { "token-$script:pageNumber" } else { '' }
                New-TestPage -Rows @($script:allRows | Select-Object -Skip $offset -First 1000) -Total 2501 -Token $token
            }
            $rows = @(Get-GraphRows -QueryName Resources -SubscriptionIds @($subscription) -Endpoint $fixture.context.endpoint)
            $rows.Count | Should -Be 2501
            Should -Invoke Invoke-GraphRequest -Times 3 -Exactly
        }
        It 'rejects truncation without a continuation token' {
            Mock Invoke-GraphRequest { @{ data = @($script:fixture.resources[0]); count = 1; totalRecords = 2; resultTruncated = 'true' } }
            { Get-GraphRows Resources @($subscription) $fixture.context.endpoint } | Should -Throw '*truncated*'
        }
        It 'rejects repeated tokens instead of looping forever' {
            $script:pageNumber = 0
            Mock Invoke-GraphRequest {
                $row = $script:fixture.resources[$script:pageNumber++]
                New-TestPage @($row) 3 'same-token'
            }
            { Get-GraphRows Resources @($subscription) $fixture.context.endpoint } | Should -Throw '*repeated continuation*'
        }
        It 'rejects case-variant duplicate IDs' {
            $row = $fixture.resources[0]
            $copy = $row.Clone()
            $copy.id = $row.id.ToUpperInvariant()
            $script:duplicates = @($row, $copy)
            Mock Invoke-GraphRequest { New-TestPage $script:duplicates 2 }
            { Get-GraphRows Resources @($subscription) $fixture.context.endpoint } | Should -Throw '*duplicate*'
        }
        It 'rejects resources from an unrequested subscription' {
            $script:fixture.resources[0].id = '/subscriptions/22222222-2222-2222-2222-222222222222/resourceGroups/other'
            Mock Invoke-GraphRequest { New-TestPage @($script:fixture.resources[0]) 1 }
            { Get-GraphRows Resources @($subscription) $fixture.context.endpoint } | Should -Throw '*outside*scope*'
        }
        It 'distinguishes a valid empty response from an invalid page shape' {
            Mock Invoke-GraphRequest { New-TestPage }
            @(Get-GraphRows Resources @($subscription) $fixture.context.endpoint).Count | Should -Be 0
            Mock Invoke-GraphRequest { @{ error = 'unexpected' } }
            { Get-GraphRows Resources @($subscription) $fixture.context.endpoint } | Should -Throw '*invalid page shape*'
        }
        It 'rejects a changing total during pagination' {
            $script:pageNumber = 0
            Mock Invoke-GraphRequest {
                $script:pageNumber++
                if ($script:pageNumber -eq 1) { return New-TestPage @($script:fixture.resources[0]) 2 'next' }
                New-TestPage @($script:fixture.resources[1]) 3
            }
            { Get-GraphRows Resources @($subscription) $fixture.context.endpoint } | Should -Throw '*changed while paging*'
        }
        It 'uses a scoped read-only POST and cleans its request file even on failure' {
            $script:requestPath = ''
            Mock Invoke-AzJson {
                $Arguments[0] | Should -Be 'rest'
                $Arguments[2] | Should -Be 'post'
                $Arguments[4] | Should -Match '/providers/Microsoft.ResourceGraph/resources'
                $Arguments[6] | Should -Be $script:subscription
                $script:requestPath = $Arguments[8].Substring(1)
                $body = Get-Content -LiteralPath $script:requestPath -Raw | ConvertFrom-Json -AsHashtable
                $body.subscriptions[0] | Should -Be $script:subscription
                throw (New-InventoryError 'Test failure' 'Denied')
            }
            { Invoke-GraphRequest -Body @{ subscriptions = @($subscription) } -Endpoint $fixture.context.endpoint -SubscriptionId $subscription } | Should -Throw '*Test failure*'
            Test-Path -LiteralPath $script:requestPath | Should -BeFalse
        }
    }

    Describe 'Scope failures and batching' {
        BeforeEach {
            $script:fixture = New-SyntheticData
            Mock Get-InventoryContext { $script:fixture.context }
            Mock Invoke-AzProcess { throw 'A test attempted an unmocked Azure call.' }
        }
        It 'produces an explicitly partial model when one subscription fails' {
            $script:fixture.context.subscriptions += @{
                id = '22222222-2222-2222-2222-222222222222'; name = 'Denied demo'; state = 'Enabled'
                queries = @{ Resources = 'Pending'; Containers = 'Pending'; References = 'Pending' }
            }
            Mock Get-GraphRows {
                if ($SubscriptionIds.Count -gt 1 -or $SubscriptionIds[0] -like '22222222*') {
                    throw (New-InventoryError 'Denied synthetic scope' 'Denied')
                }
                switch ($QueryName) {
                    Resources { $script:fixture.resources }
                    Containers { $script:fixture.containers }
                    References { $script:fixture.references }
                }
            }
            $model = Get-AzureInventory $fixture.context.tenantId
            $model.status | Should -Be 'Partial'
            $model.resources.Count | Should -Be 12
            $model.warnings.Count | Should -Be 3
            $model.subscriptions[1].queries.Resources | Should -Be 'Failed'
        }
        It 'fails rather than presenting an empty successful tenant when all resource queries fail' {
            Mock Get-GraphRows { throw (New-InventoryError 'Denied synthetic scope' 'Denied') }
            { Get-AzureInventory $fixture.context.tenantId } | Should -Throw '*every selected subscription*'
        }
        It 'stops immediately on authentication failure rather than trying other scopes' {
            Mock Get-GraphRows { throw (New-InventoryError 'Sign in again' 'Authentication') }
            { Get-AzureInventory $fixture.context.tenantId } | Should -Throw '*Sign in again*'
            Should -Invoke Get-GraphRows -Times 1 -Exactly
        }
        It 'can successfully collect zero visible rows without treating it as authorization proof' {
            Mock Get-GraphRows { @() }
            $model = Get-AzureInventory $fixture.context.tenantId
            $model.status | Should -Be 'Succeeded'
            $model.resources.Count | Should -Be 0
        }
        It 'does not query Azure when there are no subscriptions' {
            $script:fixture.context.subscriptions = @()
            Mock Get-GraphRows { throw 'Should not query' }
            (Get-AzureInventory $fixture.context.tenantId).resources.Count | Should -Be 0
            Should -Invoke Get-GraphRows -Times 0
        }
        It 'splits 1001 subscriptions without losing a scope' {
            $script:fixture.context.subscriptions = @(for ($i = 1; $i -le 1001; $i++) {
                @{ id = ('{0:x8}-0000-0000-0000-000000000000' -f $i); name = "Synthetic $i"; state = 'Enabled'
                    queries = @{ Resources = 'Pending'; Containers = 'Pending'; References = 'Pending' } }
            })
            Mock Get-GraphRows {
                $SubscriptionIds.Count | Should -BeLessOrEqual 1000
                @()
            }
            $model = Get-AzureInventory $fixture.context.tenantId
            $model.subscriptions.Count | Should -Be 1001
            @($model.subscriptions | Where-Object { $_.queries.Resources -ne 'Succeeded' }).Count | Should -Be 0
            Should -Invoke Get-GraphRows -Times 6 -Exactly
        }
    }

    Describe 'Evidence-based relationships and report output' {
        BeforeEach { $script:fixture = New-SyntheticData }
        It 'retains unknown types and creates observed VM, private endpoint and app-plan links' {
            $model = New-TestModel $fixture
            @($model.resources | Where-Object type -eq 'contoso.widgets/widgets').Count | Should -Be 1
            @($model.relationships | Where-Object label -eq 'OS disk').Count | Should -Be 1
            @($model.relationships | Where-Object label -eq 'App Service plan').Count | Should -Be 1
            @($model.relationships | Where-Object label -eq 'private link target').Count | Should -Be 1
            @($model.relationships | Where-Object { $_.source -like '*/privateendpoints/*' -and $_.label -eq 'subnet' }).Count | Should -Be 1
            @($model.relationships | Where-Object { $_.target -like '/subscriptions/22222222*' }).Count | Should -Be 1
            @($model.relationships | Where-Object { -not $_.evidence }).Count | Should -Be 0
        }
        It 'handles nested and extension resource containment' {
            $parent = '/subscriptions/11111111-1111-1111-1111-111111111111/resourceGroups/demo/providers/Microsoft.Sql/servers/example'
            Get-ParentResourceId "$parent/databases/demo" | Should -Be $parent
            Get-ParentResourceId "$parent/providers/Microsoft.Insights/diagnosticSettings/demo" | Should -Be $parent
        }
        It 'marks oversized relationship arrays partial without removing the resource' {
            $fixture.resources[0].relationshipArrayTooLarge = $true
            $model = New-TestModel $fixture
            $model.status | Should -Be 'Partial'
            $model.resources.Count | Should -Be 12
            $model.warnings[0].message | Should -Match '2000'
        }
        It 'encodes inventory data without script termination or recursive template replacement' {
            $model = New-TestModel $fixture
            $path = Export-InventoryReport $model $TestDrive
            $html = [IO.File]::ReadAllText($path)
            $html | Should -Not -Match '<img src="https://invalid'
            ([regex]::Matches($html, '<script(?:\s[^>]*)?>')).Count | Should -Be 5
            $json = [regex]::Match($html, '(?s)<script id="inventory-data" type="application/json">(.*?)</script>').Groups[1].Value
            $roundTrip = $json | ConvertFrom-Json -AsHashtable
            $widget = @($roundTrip.resources | Where-Object type -eq 'contoso.widgets/widgets')[0]
            $widget.tags['marker-example'] | Should -Be '@@MERMAID@@'
            $widget.tags['unsafe-example'] | Should -Be $fixture.resources[9].tags['unsafe-example']
        }
        It 'hashes the browser-normalized script bytes for CSP' {
            $html = [IO.File]::ReadAllText((Export-InventoryReport (New-TestModel $fixture) $TestDrive))
            foreach ($match in [regex]::Matches($html, '(?s)<script>(.*?)</script>')) {
                $normalized = $match.Groups[1].Value.Replace("`r`n", "`n").Replace("`r", "`n")
                $html.Contains("sha256-$(Get-ContentHash $normalized)") | Should -BeTrue
            }
            $html | Should -Match "connect-src 'none'"
        }
        It 'does not overwrite an existing report' {
            $model = New-TestModel $fixture
            $first = Export-InventoryReport $model $TestDrive
            $second = Export-InventoryReport $model $TestDrive
            $first | Should -Not -Be $second
            Test-Path -LiteralPath $first | Should -BeTrue
            Test-Path -LiteralPath $second | Should -BeTrue
        }
        It 'rejects a renderer that does not match the pinned checksum' {
            Mock Get-FileHash { @{ Hash = 'not-the-pinned-checksum' } }
            { Export-InventoryReport (New-TestModel $fixture) $TestDrive } | Should -Throw '*renderer checksum*'
        }
        It 'rejects vendored Azure icons that do not match their manifest' {
            Mock Get-FileHash { @{ Hash = 'not-the-icon-checksum' } } -ParameterFilter { $LiteralPath -like '*azure-icons*' }
            { Export-InventoryReport (New-TestModel $fixture) $TestDrive } | Should -Throw '*icon checksum*'
        }
        It 'embeds the icon pack and type map as inert JSON with markup characters escaped' {
            $html = [IO.File]::ReadAllText((Export-InventoryReport (New-TestModel $fixture) $TestDrive))
            foreach ($id in @('azure-icons', 'azure-types')) {
                $json = [regex]::Match($html, "(?s)<script id=`"$id`" type=`"application/json`">(.*?)</script>").Groups[1].Value
                $json | Should -Not -BeNullOrEmpty
                $json | Should -Not -Match '[<>]'
                $null = $json | ConvertFrom-Json -AsHashtable
            }
            $icons = [regex]::Match($html, '(?s)<script id="azure-icons" type="application/json">(.*?)</script>').Groups[1].Value
            $icons | Should -Match '\\u003cdefs'
            $types = [regex]::Match($html, '(?s)<script id="azure-types" type="application/json">(.*?)</script>').Groups[1].Value | ConvertFrom-Json -AsHashtable
            $types['types']['microsoft.compute/virtualmachines'] | Should -Not -BeNullOrEmpty
        }
    }
}
