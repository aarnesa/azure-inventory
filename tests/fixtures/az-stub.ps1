# Synthetic Azure CLI boundary for child-process tests. Never calls Azure.
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'New-SyntheticData.ps1')
$mode = $env:AZURE_INVENTORY_TEST_MODE
$sample = New-SyntheticData -ResourceCount $(if ($mode -eq 'success') { 2501 } else { 12 })
$tenant = $sample.context.tenantId
$subscription = $sample.context.subscriptions[0].id
$denied = '22222222-2222-2222-2222-222222222222'
$user = @{ type = 'user'; name = 'synthetic-user' }
switch ($args[0] + ' ' + $args[1]) {
    'account show' {
        if ($mode -eq 'authentication') { Write-Output 'ERROR: AADSTS synthetic expired login'; exit 1 }
        @{ tenantId = $tenant; user = $user } | ConvertTo-Json -Compress
    }
    'account list' {
        $accounts = @(@{ id = $subscription; name = 'Demo subscription'; state = 'Enabled'; tenantId = $tenant; user = $user })
        if ($mode -eq 'partial') {
            $accounts += @{ id = $denied; name = 'Denied demo'; state = 'Enabled'; tenantId = $tenant; user = $user }
        }
        ConvertTo-Json -InputObject $accounts -Depth 10 -Compress
    }
    'cloud show' {
        @{ name = 'AzureCloud'; endpoints = @{ resourceManager = 'https://management.azure.com/' } } | ConvertTo-Json -Compress
    }
    'rest --method' {
        if ($args[2] -ne 'post' -or $args[4] -notlike 'https://management.azure.com/providers/Microsoft.ResourceGraph/resources?*') {
            throw 'Unexpected operation in synthetic CLI.'
        }
        $body = [IO.File]::ReadAllText($args[8].Substring(1)) | ConvertFrom-Json -AsHashtable
        if ($mode -eq 'partial' -and $denied -in $body.subscriptions) {
            Write-Output 'ERROR: (AuthorizationFailed) Synthetic subscription denied'
            exit 1
        }
        if ($body.query.StartsWith('ResourceContainers')) { $rows = $sample.containers }
        elseif ($body.query.Contains('| mv-expand')) { $rows = $sample.references }
        elseif ($body.query.StartsWith('Resources')) { $rows = $sample.resources }
        else { throw 'Unexpected query in synthetic CLI.' }
        $offset = if ($body.options.ContainsKey('$skipToken')) { [int] $body.options['$skipToken'] } else { 0 }
        $page = @($rows | Select-Object -Skip $offset -First 1000)
        $next = if ($offset + $page.Count -lt $rows.Count) { [string] ($offset + $page.Count) } else { '' }
        @{ data = $page; count = $page.Count; totalRecords = $rows.Count
            resultTruncated = [bool] $next; '$skipToken' = $next } | ConvertTo-Json -Depth 30 -Compress
    }
    default { throw 'Unexpected command in synthetic CLI.' }
}
