#requires -Version 7.0
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$script:Root = Split-Path $PSScriptRoot -Parent

$script:Queries = [ordered]@{
    Resources = @'
Resources
| project id, name, type, kind, subscriptionId, resourceGroup, location, tags,
    sku = bag_pack("name", tostring(sku.name), "tier", tostring(sku.tier), "capacity", tostring(sku.capacity)),
    osDiskId = tostring(properties.storageProfile.osDisk.managedDisk.id),
    virtualMachineId = tostring(properties.virtualMachine.id),
    nsgId = tostring(properties.networkSecurityGroup.id),
    subnetId = tostring(properties.subnet.id),
    planId = tostring(properties.serverFarmId),
    integrationSubnetId = tostring(properties.virtualNetworkSubnetId),
    relationshipArrayTooLarge = (array_length(properties.networkProfile.networkInterfaces) > 2000
        or array_length(properties.storageProfile.dataDisks) > 2000
        or array_length(properties.ipConfigurations) > 2000
        or array_length(properties.subnets) > 2000
        or array_length(properties.virtualNetworkPeerings) > 2000
        or array_length(properties.privateLinkServiceConnections) > 2000
        or array_length(properties.manualPrivateLinkServiceConnections) > 2000)
| order by id asc
'@
    Containers = @'
ResourceContainers
| where type =~ 'microsoft.resources/subscriptions' or type =~ 'microsoft.resources/subscriptions/resourcegroups'
| project id, name, type, subscriptionId, resourceGroup, location, tags
| order by id asc
'@
    References = @'
Resources
| where type in~ ('microsoft.compute/virtualmachines', 'microsoft.network/networkinterfaces',
    'microsoft.network/virtualnetworks', 'microsoft.network/privateendpoints')
| extend collections = pack_array(
    bag_pack("path", "networkProfile.networkInterfaces", "items", properties.networkProfile.networkInterfaces),
    bag_pack("path", "storageProfile.dataDisks", "items", properties.storageProfile.dataDisks),
    bag_pack("path", "ipConfigurations", "items", properties.ipConfigurations),
    bag_pack("path", "subnets", "items", properties.subnets),
    bag_pack("path", "virtualNetworkPeerings", "items", properties.virtualNetworkPeerings),
    bag_pack("path", "privateLinkServiceConnections", "items", properties.privateLinkServiceConnections),
    bag_pack("path", "manualPrivateLinkServiceConnections", "items", properties.manualPrivateLinkServiceConnections))
| mv-expand collection = collections limit 16
| mv-expand entry = collection.items limit 2000
| where isnotempty(entry)
| project id, type, path = tostring(collection.path),
    itemId = tostring(entry.id), itemName = tostring(entry.name),
    diskId = tostring(entry.managedDisk.id),
    subnetId = tostring(entry.properties.subnet.id),
    publicIpId = tostring(entry.properties.publicIPAddress.id),
    nsgId = tostring(entry.properties.networkSecurityGroup.id),
    routeTableId = tostring(entry.properties.routeTable.id),
    remoteVnetId = tostring(entry.properties.remoteVirtualNetwork.id),
    serviceId = tostring(entry.properties.privateLinkServiceId)
| order by id asc, path asc, itemId asc, itemName asc, diskId asc, subnetId asc,
    publicIpId asc, nsgId asc, routeTableId asc, remoteVnetId asc, serviceId asc
'@
}

function New-InventoryError {
    param([string] $Message, [string] $Category = 'Response')
    $exception = [InvalidOperationException]::new($Message)
    $exception.Data['Category'] = $Category
    return $exception
}

function Invoke-AzProcess {
    param([Parameter(Mandatory)][string[]] $Arguments)
    $command = Get-Command az -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $command) {
        throw (New-InventoryError 'Azure CLI is missing. Install Azure CLI, then sign in interactively.' 'Prerequisite')
    }
    $PSNativeCommandUseErrorActionPreference = $false
    $output = & $command.Source @Arguments --only-show-errors --output json 2>&1
    return @{ exitCode = $LASTEXITCODE; text = (($output | ForEach-Object { [string] $_ }) -join "`n") }
}

function Invoke-AzJson {
    param([Parameter(Mandatory)][string[]] $Arguments, [switch] $RetryTransient)
    for ($attempt = 0; $attempt -lt 4; $attempt++) {
        $result = Invoke-AzProcess -Arguments $Arguments
        $exitCode = $result.exitCode
        $text = $result.text
        if ($exitCode -eq 0) {
            try { return ConvertFrom-Json -InputObject $text -AsHashtable -Depth 100 -NoEnumerate }
            catch { throw (New-InventoryError 'Azure CLI returned invalid JSON. No response was saved.') }
        }
        if ($text -match '(?i)AADSTS|az login|AuthenticationFailed|InvalidAuthenticationToken|ExpiredAuthenticationToken|\b401\b') {
            throw (New-InventoryError 'Azure authentication failed. Run az login --tenant <target-tenant-guid> interactively and retry.' 'Authentication')
        }
        if ($text -match '(?i)AuthorizationFailed|Forbidden|Authorization_RequestDenied|\b403\b') {
            throw (New-InventoryError 'Azure denied this query. Check the user''s read permissions for this scope.' 'Denied')
        }
        $transient = $text -match '(?i)TooManyRequests|Throttl|ServiceUnavailable|InternalServerError|GatewayTimeout|\b(429|500|502|503|504)\b'
        if ($transient -and $RetryTransient -and $attempt -lt 3) {
            Start-Sleep -Seconds ([math]::Pow(2, $attempt + 1))
            continue
        }
        if ($transient) {
            throw (New-InventoryError 'Azure throttling or a temporary service failure persisted after bounded retries. Retry later.' 'Transient')
        }
        throw (New-InventoryError "Azure CLI command '$($Arguments[0])' failed (exit $exitCode). Check CLI connectivity, version, and the selected cloud. Raw diagnostics were not saved." 'Command')
    }
}

function Get-InventoryContext {
    param([Parameter(Mandatory)][string] $TenantId)
    $tenant = ([guid] $TenantId).ToString()
    $account = Invoke-AzJson -Arguments @('account', 'show')
    if ($account -isnot [System.Collections.IDictionary] -or $account['tenantId'] -ne $tenant) {
        throw (New-InventoryError "The active Azure CLI account is not in tenant $tenant. Run az login --tenant $tenant interactively. The default subscription was not changed." 'Authentication')
    }
    if ($account['user'] -isnot [System.Collections.IDictionary] -or $account['user']['type'] -ne 'user') {
        throw (New-InventoryError 'An interactive user login is required; service-principal and managed-identity sessions are not supported.' 'Authentication')
    }
    $accounts = Invoke-AzJson -Arguments @('account', 'list', '--all', '--refresh')
    if ($accounts -isnot [array]) { throw (New-InventoryError 'Azure CLI returned an invalid subscription list.') }
    $subscriptions = [System.Collections.Generic.List[object]]::new()
    $seen = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    foreach ($item in $accounts) {
        if ($item['tenantId'] -ne $tenant) { continue }
        if ($item['user'] -isnot [System.Collections.IDictionary] -or
            $item['user']['type'] -ne 'user' -or $item['user']['name'] -ne $account['user']['name']) {
            throw (New-InventoryError 'The subscription cache contains a different principal. Refresh the interactive login for the target tenant.' 'Authentication')
        }
        if ($item['name'] -eq 'N/A(tenant level account)') { continue }
        $id = ([guid] $item['id']).ToString()
        if ($seen.Add($id)) {
            $subscriptions.Add([ordered]@{
                id = $id; name = [string] $item['name']; state = [string] $item['state']
                queries = [ordered]@{ Resources = 'Pending'; Containers = 'Pending'; References = 'Pending' }
            })
        }
    }
    $cloud = Invoke-AzJson -Arguments @('cloud', 'show')
    if ($cloud -isnot [System.Collections.IDictionary] -or $cloud['endpoints'] -isnot [System.Collections.IDictionary]) {
        throw (New-InventoryError 'Azure CLI returned invalid cloud metadata.')
    }
    $endpoint = [uri] $cloud['endpoints']['resourceManager']
    if (-not $endpoint.IsAbsoluteUri -or $endpoint.Scheme -ne 'https' -or $endpoint.Query -or $endpoint.Fragment) {
        throw (New-InventoryError 'The configured Azure Resource Manager endpoint must be an absolute HTTPS URL.')
    }
    return @{
        tenantId = $tenant; cloud = [string] $cloud['name']
        endpoint = $endpoint.AbsoluteUri.TrimEnd('/')
        subscriptions = @($subscriptions | Sort-Object { $_['id'] })
    }
}

function Invoke-GraphRequest {
    param([hashtable] $Body, [string] $Endpoint, [string] $SubscriptionId)
    $tempPath = [IO.Path]::GetTempFileName()
    try {
        [IO.File]::WriteAllText($tempPath, (ConvertTo-Json $Body -Depth 20 -Compress), [Text.UTF8Encoding]::new($false))
        return Invoke-AzJson -Arguments @(
            'rest', '--method', 'post',
            '--url', "$Endpoint/providers/Microsoft.ResourceGraph/resources?api-version=2022-10-01",
            '--subscription', $SubscriptionId,
            '--body', "@$tempPath"
        ) -RetryTransient
    }
    finally { Remove-Item -LiteralPath $tempPath -Force -ErrorAction Stop }
}

function Get-GraphRows {
    param([string] $QueryName, [string[]] $SubscriptionIds, [string] $Endpoint)
    $rows = [System.Collections.Generic.List[object]]::new()
    $tokens = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    $keys = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    $next = ''
    $expected = $null
    do {
        $options = @{ '$top' = 1000; resultFormat = 'objectArray'; allowPartialScopes = $false }
        if ($next) { $options['$skipToken'] = $next }
        $response = Invoke-GraphRequest -Endpoint $Endpoint -SubscriptionId $SubscriptionIds[0] -Body @{
            subscriptions = @($SubscriptionIds); query = $script:Queries[$QueryName]; options = $options
        }
        if ($response -isnot [System.Collections.IDictionary] -or $response['data'] -isnot [array] -or
            -not $response.Contains('count') -or -not $response.Contains('totalRecords') -or
            [string] $response['resultTruncated'] -notin @('true', 'false')) {
            throw (New-InventoryError "$QueryName returned an invalid page shape.")
        }
        $page = $response['data']
        $total = [long] $response['totalRecords']
        if ([long] $response['count'] -ne $page.Count -or $total -lt $page.Count -or $total -lt 0) {
            throw (New-InventoryError "$QueryName returned inconsistent page counts.")
        }
        if ($null -eq $expected) { $expected = $total }
        if ($total -ne $expected) {
            throw (New-InventoryError "$QueryName changed while paging. Retry the inventory; it is not an atomic snapshot.")
        }
        foreach ($row in $page) {
            if ($row -isnot [System.Collections.IDictionary] -or -not $row['id']) {
                throw (New-InventoryError "$QueryName returned a row without an ID.")
            }
            $id = [string] $row['id']
            if ($id -notmatch '^/subscriptions/([0-9a-f-]{36})(?:/|$)' -or $Matches[1] -notin $SubscriptionIds) {
                throw (New-InventoryError "$QueryName returned a row outside the requested subscription scope.")
            }
            $key = $id
            if ($QueryName -eq 'References') {
                $key = (@('id', 'path', 'itemId', 'itemName', 'diskId', 'subnetId', 'publicIpId', 'nsgId', 'routeTableId', 'remoteVnetId', 'serviceId') |
                    ForEach-Object { [string] $row[$_] }) -join [char] 31
            }
            if (-not $keys.Add($key)) {
                throw (New-InventoryError "$QueryName returned duplicate IDs/rows while paging. Retry the inventory.")
            }
            $rows.Add($row)
        }
        $next = [string] $response['$skipToken']
        if ($next -and ($page.Count -eq 0 -or -not $tokens.Add($next))) {
            throw (New-InventoryError "$QueryName returned an empty continuation page or a repeated continuation token.")
        }
        if (-not $next -and ([string] $response['resultTruncated'] -eq 'true' -or $rows.Count -ne $expected)) {
            throw (New-InventoryError "$QueryName was truncated without a usable continuation token.")
        }
        if ($rows.Count -gt $expected) { throw (New-InventoryError "$QueryName exceeded its advertised record count.") }
    } while ($next)
    return $rows.ToArray()
}

function Read-InventoryScope {
    param([string] $QueryName, [object[]] $Subscriptions, [string] $Endpoint,
        [System.Collections.Generic.List[object]] $Warnings)
    try {
        $rows = @(Get-GraphRows -QueryName $QueryName -SubscriptionIds @($Subscriptions | ForEach-Object { $_['id'] }) -Endpoint $Endpoint)
        foreach ($subscription in $Subscriptions) { $subscription['queries'][$QueryName] = 'Succeeded' }
        return $rows
    }
    catch {
        if ($_.Exception.Data['Category'] -eq 'Authentication') { throw }
        if ($Subscriptions.Count -gt 1) {
            foreach ($subscription in $Subscriptions) {
                Read-InventoryScope -QueryName $QueryName -Subscriptions @($subscription) -Endpoint $Endpoint -Warnings $Warnings
            }
            return
        }
        $Subscriptions[0]['queries'][$QueryName] = 'Failed'
        $Warnings.Add([ordered]@{
            scope = $Subscriptions[0]['id']; query = $QueryName
            message = $_.Exception.Message
        })
    }
}

function Get-ParentResourceId {
    param([string] $Id)
    $parts = $Id.Trim('/').Split('/')
    if ($parts.Length -lt 4) { return '' }
    $providerIndex = -1
    for ($i = 0; $i -lt $parts.Length; $i++) {
        if ($parts[$i] -eq 'providers') { $providerIndex = $i }
    }
    if ($providerIndex -ge 0) {
        $length = if ($parts.Length - $providerIndex -gt 4) { $parts.Length - 2 } else { $providerIndex }
        return '/' + ($parts[0..($length - 1)] -join '/')
    }
    if ($parts.Length -eq 4 -and $parts[2] -eq 'resourceGroups') {
        return '/' + ($parts[0..1] -join '/')
    }
    return ''
}

function Add-InventoryEdge {
    param([string] $Source, [string] $Target, [string] $Label, [string] $Evidence,
        [System.Collections.Generic.List[object]] $Edges,
        [System.Collections.Generic.HashSet[string]] $Seen)
    if ([string]::IsNullOrWhiteSpace($Target)) { return }
    if ($Source -notmatch '^/subscriptions/[0-9a-f-]{36}(?:/|$)' -or $Target -notmatch '^/subscriptions/[0-9a-f-]{36}(?:/|$)') {
        throw (New-InventoryError 'A relationship contained an invalid Azure resource ID.')
    }
    $sourceId = $Source.TrimEnd('/').ToLowerInvariant()
    $targetId = $Target.TrimEnd('/').ToLowerInvariant()
    if ($Seen.Add("$sourceId|$targetId|$Label|$Evidence")) {
        $Edges.Add([ordered]@{ source = $sourceId; target = $targetId; label = $Label; evidence = $Evidence })
    }
}

function Get-InventoryEdges {
    param([object[]] $Resources, [object[]] $References)
    $edges = [System.Collections.Generic.List[object]]::new()
    $seen = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    foreach ($resource in $Resources) {
        $id = [string] $resource['id']
        $parent = Get-ParentResourceId -Id $id
        if ($parent) { Add-InventoryEdge $parent $id 'contains' 'Resource ID containment' $edges $seen }
        $fields = @(switch ([string] $resource['type']) {
            'microsoft.compute/virtualmachines' {
                @{ column = 'osDiskId'; label = 'OS disk'; path = 'storageProfile.osDisk.managedDisk.id' }
            }
            'microsoft.network/networkinterfaces' {
                @{ column = 'virtualMachineId'; label = 'VM reference'; path = 'virtualMachine.id' }
                @{ column = 'nsgId'; label = 'NSG'; path = 'networkSecurityGroup.id' }
            }
            'microsoft.network/privateendpoints' {
                @{ column = 'subnetId'; label = 'subnet'; path = 'subnet.id' }
            }
            'microsoft.web/sites' {
                @{ column = 'planId'; label = 'App Service plan'; path = 'serverFarmId' }
                @{ column = 'integrationSubnetId'; label = 'VNet integration subnet'; path = 'virtualNetworkSubnetId' }
            }
        })
        foreach ($field in $fields) {
            Add-InventoryEdge $id ([string] $resource[$field.column]) $field.label "properties.$($field.path)" $edges $seen
        }
    }
    foreach ($reference in $References) {
        $id = [string] $reference['id']
        $path = [string] $reference['path']
        switch ($path) {
            'networkProfile.networkInterfaces' {
                Add-InventoryEdge $id $reference['itemId'] 'network interface' "properties.$path[].id" $edges $seen
            }
            'storageProfile.dataDisks' {
                Add-InventoryEdge $id $reference['diskId'] 'data disk' "properties.$path[].managedDisk.id" $edges $seen
            }
            'ipConfigurations' {
                Add-InventoryEdge $id $reference['subnetId'] 'subnet' "properties.$path[].properties.subnet.id" $edges $seen
                Add-InventoryEdge $id $reference['publicIpId'] 'public IP' "properties.$path[].properties.publicIPAddress.id" $edges $seen
            }
            'subnets' {
                Add-InventoryEdge $id $reference['itemId'] 'contains subnet' "properties.$path[].id" $edges $seen
                Add-InventoryEdge $reference['itemId'] $reference['nsgId'] 'NSG' "properties.$path[].properties.networkSecurityGroup.id" $edges $seen
                Add-InventoryEdge $reference['itemId'] $reference['routeTableId'] 'route table' "properties.$path[].properties.routeTable.id" $edges $seen
            }
            'virtualNetworkPeerings' {
                Add-InventoryEdge $id $reference['remoteVnetId'] 'VNet peering reference' "properties.$path[].properties.remoteVirtualNetwork.id" $edges $seen
            }
            { $_ -in @('privateLinkServiceConnections', 'manualPrivateLinkServiceConnections') } {
                Add-InventoryEdge $id $reference['serviceId'] 'private link target' "properties.$path[].properties.privateLinkServiceId" $edges $seen
            }
            default { throw (New-InventoryError 'The relationship query returned an unsupported property path.') }
        }
    }
    return @($edges | Sort-Object source, target, label, evidence)
}

function ConvertTo-InventoryModel {
    param([hashtable] $Context, [object[]] $ResourceRows, [object[]] $ContainerRows,
        [object[]] $ReferenceRows, [System.Collections.Generic.List[object]] $Warnings, [string] $StartedAt)
    $resources = @(
        foreach ($row in $ResourceRows) {
            if ($row['relationshipArrayTooLarge'] -eq $true) {
                $Warnings.Add([ordered]@{
                    scope = $row['id']; query = 'References'
                    message = 'A relationship array exceeds the Resource Graph expansion limit of 2000. Diagram detail is incomplete; the resource inventory row is retained.'
                })
            }
            [ordered]@{
                id = ([string] $row['id']).ToLowerInvariant(); name = [string] $row['name']
                type = ([string] $row['type']).ToLowerInvariant(); kind = [string] $row['kind']
                subscriptionId = ([string] $row['subscriptionId']).ToLowerInvariant()
                resourceGroup = [string] $row['resourceGroup']; location = [string] $row['location']
                sku = $row['sku']; tags = $row['tags']
            }
        }
    )
    $groups = @(
        foreach ($row in $ContainerRows) {
            if ($row['type'] -eq 'microsoft.resources/subscriptions/resourcegroups') {
                [ordered]@{
                    id = ([string] $row['id']).ToLowerInvariant(); name = [string] $row['name']
                    subscriptionId = ([string] $row['subscriptionId']).ToLowerInvariant()
                    location = [string] $row['location']; tags = $row['tags']
                }
            }
        }
    )
    $edges = @(Get-InventoryEdges -Resources $ResourceRows -References $ReferenceRows)
    return [ordered]@{
        schemaVersion = 1; tenantId = $Context.tenantId; cloud = $Context.cloud
        startedAt = $StartedAt; finishedAt = [DateTimeOffset]::UtcNow.ToString('o')
        status = $(if ($Warnings.Count) { 'Partial' } else { 'Succeeded' })
        subscriptions = @($Context.subscriptions)
        resourceGroups = @($groups | Sort-Object { $_['id'] })
        resources = @($resources | Sort-Object { $_['id'] })
        relationships = $edges; warnings = $Warnings.ToArray()
    }
}

function Get-AzureInventory {
    [CmdletBinding()]
    param([Parameter(Mandatory)][guid] $TenantId)
    $startedAt = [DateTimeOffset]::UtcNow.ToString('o')
    $context = Get-InventoryContext -TenantId $TenantId.ToString()
    $warnings = [System.Collections.Generic.List[object]]::new()
    $results = @{ Resources = [System.Collections.Generic.List[object]]::new()
        Containers = [System.Collections.Generic.List[object]]::new()
        References = [System.Collections.Generic.List[object]]::new() }
    for ($offset = 0; $offset -lt $context.subscriptions.Count; $offset += 1000) {
        $last = [math]::Min($offset + 999, $context.subscriptions.Count - 1)
        $batch = @($context.subscriptions[$offset..$last])
        foreach ($queryName in $script:Queries.Keys) {
            $rows = @(Read-InventoryScope -QueryName $queryName -Subscriptions $batch -Endpoint $context.endpoint -Warnings $warnings)
            $results[$queryName].AddRange([object[]] $rows)
        }
    }
    if ($context.subscriptions.Count -gt 0 -and
        @($context.subscriptions | Where-Object { $_['queries']['Resources'] -eq 'Succeeded' }).Count -eq 0) {
        throw (New-InventoryError 'Resource collection failed in every selected subscription. No report was written. Check read permissions, connectivity, and Resource Graph availability.')
    }
    return ConvertTo-InventoryModel -Context $context -ResourceRows $results.Resources.ToArray() `
        -ContainerRows $results.Containers.ToArray() -ReferenceRows $results.References.ToArray() `
        -Warnings $warnings -StartedAt $startedAt
}

function Get-ContentHash {
    param([string] $Content)
    $algorithm = [Security.Cryptography.SHA256]::Create()
    try { return [Convert]::ToBase64String($algorithm.ComputeHash([Text.Encoding]::UTF8.GetBytes($Content))) }
    finally { $algorithm.Dispose() }
}

function Export-InventoryReport {
    [CmdletBinding()]
    param([Parameter(Mandatory)][System.Collections.IDictionary] $Inventory,
        [Parameter(Mandatory)][string] $OutputDirectory)
    $rendererPath = Join-Path $script:Root 'vendor\mermaid\mermaid.tiny.js'
    $manifestPath = Join-Path $script:Root 'vendor\mermaid\manifest.json'
    if (-not (Test-Path -LiteralPath $rendererPath) -or -not (Test-Path -LiteralPath $manifestPath)) {
        throw (New-InventoryError 'The offline Mermaid renderer is missing. Restore the vendor files from this repository.' 'Prerequisite')
    }
    $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json -AsHashtable
    if ((Get-FileHash -LiteralPath $rendererPath -Algorithm SHA256).Hash -ne $manifest['sha256']) {
        throw (New-InventoryError 'The offline Mermaid renderer checksum does not match the pinned manifest.' 'Prerequisite')
    }
    $iconPath = Join-Path $script:Root 'vendor\azure-icons\icons.json'
    $iconManifestPath = Join-Path $script:Root 'vendor\azure-icons\manifest.json'
    $typePath = Join-Path $script:Root 'templates\azure-types.json'
    if (-not (Test-Path -LiteralPath $iconPath) -or -not (Test-Path -LiteralPath $iconManifestPath) -or -not (Test-Path -LiteralPath $typePath)) {
        throw (New-InventoryError 'The vendored Azure icons or type map are missing. Restore them from this repository.' 'Prerequisite')
    }
    $iconManifest = Get-Content -LiteralPath $iconManifestPath -Raw | ConvertFrom-Json -AsHashtable
    if ((Get-FileHash -LiteralPath $iconPath -Algorithm SHA256).Hash -ne $iconManifest['iconsSha256']) {
        throw (New-InventoryError 'The vendored Azure icon checksum does not match its manifest.' 'Prerequisite')
    }
    $renderer = [IO.File]::ReadAllText($rendererPath).Replace("`r`n", "`n").Replace("`r", "`n") -replace '(?im)^\s*//# sourceMappingURL=.*$', '' -replace '(?i)</script', '<\/script'
    # HTML normalizes CRLF before checking CSP hashes.
    $app = [IO.File]::ReadAllText((Join-Path $script:Root 'templates\report.js')).Replace("`r`n", "`n").Replace("`r", "`n")
    $template = [IO.File]::ReadAllText((Join-Path $script:Root 'templates\report.html'))
    $data = ConvertTo-Json -InputObject $Inventory -Depth 50 -Compress -EscapeHandling EscapeHtml
    $licenses = foreach ($name in @('LICENSE', 'LICENSE-DOMPURIFY', 'LICENSE-LODASH')) {
        "$name`n" + [IO.File]::ReadAllText((Join-Path $script:Root "vendor\mermaid\$name"))
    }
    # Embed trusted vendored JSON verbatim so key order is kept; escaping markup characters cannot change JSON meaning.
    $embedJson = {
        param([string] $Path)
        $raw = [IO.File]::ReadAllText($Path)
        $null = $raw | ConvertFrom-Json -AsHashtable
        $raw.Trim().Replace('&', '\u0026').Replace('<', '\u003c').Replace('>', '\u003e')
    }
    $values = @{
        DATA = $data; MERMAID = $renderer; APP = $app
        MERMAID_HASH = (Get-ContentHash $renderer); APP_HASH = (Get-ContentHash $app)
        LICENSE = [Net.WebUtility]::HtmlEncode(($licenses -join "`n`n"))
        ICONS = (& $embedJson $iconPath); TYPES = (& $embedJson $typePath)
        ICON_VERSION = [Net.WebUtility]::HtmlEncode([string] $iconManifest['version'])
    }
    $html = [regex]::Replace($template, '@@(DATA|MERMAID|APP|MERMAID_HASH|APP_HASH|LICENSE|ICONS|TYPES|ICON_VERSION)@@',
        [Text.RegularExpressions.MatchEvaluator] { param($match) $values[$match.Groups[1].Value] })
    $tenant = ([guid] $Inventory['tenantId']).ToString()
    $directory = Join-Path ([IO.Path]::GetFullPath($OutputDirectory)) "$tenant-$([DateTimeOffset]::UtcNow.ToString('yyyyMMddTHHmmssfffZ'))-$([guid]::NewGuid().ToString('N').Substring(0, 8))"
    [IO.Directory]::CreateDirectory($directory) | Out-Null
    $path = Join-Path $directory 'report.html'
    $stream = [IO.File]::Open($path, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    try {
        $bytes = [Text.Encoding]::UTF8.GetBytes($html)
        $stream.Write($bytes, 0, $bytes.Length)
    }
    finally { $stream.Dispose() }
    return $path
}

Export-ModuleMember -Function Get-AzureInventory, Export-InventoryReport
