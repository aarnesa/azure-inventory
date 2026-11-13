function New-SyntheticData {
    param([ValidateRange(12, 100000)][int] $ResourceCount = 12, [switch] $Adversarial, [switch] $Varied)
    $tenant = '00000000-0000-0000-0000-000000000001'
    $subscription = '11111111-1111-1111-1111-111111111111'
    $prefix = "/subscriptions/$subscription/resourceGroups/demo-app/providers"
    $network = "/subscriptions/$subscription/resourceGroups/demo-network/providers/Microsoft.Network"
    $nic = "$network/networkInterfaces/demo-nic"
    $vnet = "$network/virtualNetworks/demo-vnet"
    $subnet = "$vnet/subnets/app"
    $vm = "$prefix/Microsoft.Compute/virtualMachines/demo-vm"
    $disk = "$prefix/Microsoft.Compute/disks/demo-os"
    $plan = "$prefix/Microsoft.Web/serverfarms/demo-plan"
    $storage = "$prefix/Microsoft.Storage/storageAccounts/demostorage"
    $publicIp = "$network/publicIPAddresses/demo-pip"
    $dataDisk = "$prefix/Microsoft.Compute/disks/demo-data"
    $rows = [System.Collections.Generic.List[object]]::new()
    $definitions = @(
        @($vm, 'demo-vm', 'microsoft.compute/virtualmachines', 'demo-app'),
        @($disk, 'demo-os', 'microsoft.compute/disks', 'demo-app'),
        @($nic, 'demo-nic', 'microsoft.network/networkinterfaces', 'demo-network'),
        @($vnet, 'demo-vnet', 'microsoft.network/virtualnetworks', 'demo-network'),
        @("$network/networkSecurityGroups/demo-nsg", 'demo-nsg', 'microsoft.network/networksecuritygroups', 'demo-network'),
        @("$network/privateEndpoints/demo-pe", 'demo-pe', 'microsoft.network/privateendpoints', 'demo-network'),
        @($storage, 'demostorage', 'microsoft.storage/storageaccounts', 'demo-app'),
        @($plan, 'demo-plan', 'microsoft.web/serverfarms', 'demo-app'),
        @("$prefix/Microsoft.Web/sites/demo-web", 'demo-web', 'microsoft.web/sites', 'demo-app'),
        @("$prefix/Contoso.Widgets/widgets/demo-widget", 'demo-widget', 'contoso.widgets/widgets', 'demo-app'),
        @($publicIp, 'demo-pip', 'microsoft.network/publicipaddresses', 'demo-network'),
        @($dataDisk, 'demo-data', 'microsoft.compute/disks', 'demo-app')
    )
    foreach ($definition in $definitions) {
        $rows.Add(@{
            id = $definition[0]; name = $definition[1]; type = $definition[2]; resourceGroup = $definition[3]
            subscriptionId = $subscription; location = 'westeurope'; kind = ''
            sku = @{ name = 'Demo'; tier = ''; capacity = '' }; tags = @{ environment = 'synthetic'; owner = 'example' }
        })
    }
    $rows[0]['osDiskId'] = $disk
    $rows[2]['virtualMachineId'] = $vm
    $rows[2]['nsgId'] = "$network/networkSecurityGroups/demo-nsg"
    $rows[5]['subnetId'] = $subnet
    $rows[8]['planId'] = $plan
    $rows[8]['integrationSubnetId'] = $subnet
    $rows[9]['tags']['unsafe-example'] = '</script><img src="https://invalid.example/leak" onerror="globalThis.inventoryInjection=true">'
    $rows[9]['tags']['marker-example'] = '@@MERMAID@@'
    if ($Adversarial) {
        $rows[9]['name'] = 'demo-widget "] --> injected["bad"] </script><img src="https://invalid.example/name" onerror="globalThis.inventoryInjection=true">'
    }
    $subscriptions = [System.Collections.Generic.List[object]]::new()
    $subscriptions.Add(@{
        id = $subscription; name = 'Demo subscription'; state = 'Enabled'
        queries = @{ Resources = 'Succeeded'; Containers = 'Succeeded'; References = 'Succeeded' }
    })
    $variedGroups = [System.Collections.Generic.List[object]]::new()
    if ($Varied) {
        # A seeded generator keeps the spread of subscriptions, groups, types and regions identical on every run.
        $rng = @{ State = [long] 20260101 }
        $pick = {
            param([int] $Count)
            $rng.State = ($rng.State * 1103515245 + 12345) % 2147483648
            [int][Math]::Floor([Math]::Pow($rng.State / 2147483648.0, 2) * $Count)
        }
        $subscriptionNames = 'Demo production', 'Demo test', 'Demo shared services', 'Demo data platform', 'Demo sandbox', 'Demo connectivity', 'Demo identity'
        $subscriptionIds = @($subscription)
        for ($n = 1; $n -le $subscriptionNames.Count; $n++) {
            $subscriptionIds += 'aaaaaaaa-0000-0000-0000-{0:d12}' -f $n
            $subscriptions.Add(@{
                id = $subscriptionIds[-1]; name = $subscriptionNames[$n - 1]; state = 'Enabled'
                queries = @{ Resources = 'Succeeded'; Containers = 'Succeeded'; References = 'Succeeded' }
            })
        }
        $types = @(
            'microsoft.compute/virtualmachines', 'microsoft.compute/disks', 'microsoft.network/networkinterfaces',
            'microsoft.storage/storageaccounts', 'microsoft.network/publicipaddresses', 'microsoft.network/networksecuritygroups',
            'microsoft.web/sites', 'microsoft.insights/components', 'microsoft.network/virtualnetworks', 'microsoft.keyvault/vaults',
            'microsoft.web/serverfarms', 'microsoft.operationalinsights/workspaces', 'microsoft.sql/servers',
            'microsoft.managedidentity/userassignedidentities', 'microsoft.network/loadbalancers',
            'microsoft.containerservice/managedclusters', 'microsoft.containerregistry/registries', 'microsoft.servicebus/namespaces',
            'microsoft.documentdb/databaseaccounts', 'microsoft.cognitiveservices/accounts', 'microsoft.recoveryservices/vaults',
            'contoso.widgets/widgets', 'fabrikam.telemetry/collectors', 'contoso.gadgets/gizmos'
        )
        $regions = @('westeurope', 'northeurope', 'swedencentral', 'uksouth', 'germanywestcentral', 'francecentral', 'eastus', 'eastus2', 'westus3', 'southeastasia', 'global')
        $environments = @('prod', 'test', 'dev')
        $groupCount = 14
        for ($g = 0; $g -lt $groupCount; $g++) {
            # Two groups are never returned as containers so the report also shows groups inferred from resource rows.
            if ($g -in 4, 9) { continue }
            $owner = $subscriptionIds[$g % $subscriptionIds.Count]
            $groupName = 'demo-rg-{0:d2}' -f ($g + 1)
            $variedGroups.Add(@{
                id = "/subscriptions/$owner/resourceGroups/$groupName"
                name = $groupName; type = 'microsoft.resources/subscriptions/resourcegroups'
                subscriptionId = $owner; resourceGroup = $groupName
                location = 'westeurope'; tags = @{ environment = 'synthetic' }
            })
        }
    }
    for ($i = $rows.Count; $i -lt $ResourceCount; $i++) {
        if ($Varied) {
            $group = & $pick $groupCount
            $type = $types[(& $pick $types.Count)]
            $owner = $subscriptionIds[$group % $subscriptionIds.Count]
            $groupName = 'demo-rg-{0:d2}' -f ($group + 1)
            $name = 'demo-{0}-{1:d5}' -f $type.Split('/')[-1], $i
            # A few rows have no location so the dashboard also shows an unreported region.
            $location = if ($i % 53 -eq 0) { '' } else { $regions[(& $pick $regions.Count)] }
            $rows.Add(@{
                id = "/subscriptions/$owner/resourceGroups/$groupName/providers/$type/$name"; name = $name; type = $type
                resourceGroup = $groupName; subscriptionId = $owner; location = $location; kind = ''
                sku = $null; tags = @{ environment = $environments[$i % $environments.Count] }
            })
            continue
        }
        $name = 'demo-resource-{0:d5}' -f $i
        $rows.Add(@{
            id = "$prefix/Contoso.Widgets/widgets/$name"; name = $name; type = 'contoso.widgets/widgets'
            resourceGroup = 'demo-app'; subscriptionId = $subscription; location = 'northeurope'; kind = ''
            sku = $null; tags = @{ environment = 'synthetic' }
        })
    }
    return @{
        context = @{
            tenantId = $tenant; cloud = 'AzureCloud'; endpoint = 'https://management.azure.com'
            subscriptions = @($subscriptions)
        }
        resources = $rows.ToArray()
        containers = @(
            foreach ($name in @('demo-app', 'demo-network', 'demo-empty')) {
                @{
                    id = "/subscriptions/$subscription/resourceGroups/$name"
                    name = $name; type = 'microsoft.resources/subscriptions/resourcegroups'
                    subscriptionId = $subscription; resourceGroup = $name
                    location = 'westeurope'; tags = @{ environment = 'synthetic' }
                }
            }
            $variedGroups
        )
        references = @(
            @{ id = $vm; path = 'networkProfile.networkInterfaces'; itemId = $nic },
            @{ id = $vm; path = 'storageProfile.dataDisks'; diskId = $dataDisk },
            @{ id = $nic; path = 'ipConfigurations'; itemName = 'secondary'; subnetId = $subnet; publicIpId = $publicIp },
            @{ id = $nic; path = 'ipConfigurations'; itemName = 'primary'; subnetId = $subnet
                publicIpId = "$network/publicIPAddresses/referenced-only-ip" },
            @{ id = $vnet; path = 'subnets'; itemId = $subnet; itemName = 'app'
                nsgId = "$network/networkSecurityGroups/demo-nsg"; routeTableId = "$network/routeTables/referenced-only-routes" },
            @{ id = $vnet; path = 'virtualNetworkPeerings'; itemName = 'hub'
                remoteVnetId = "/subscriptions/22222222-2222-2222-2222-222222222222/resourceGroups/external/providers/Microsoft.Network/virtualNetworks/hub" },
            @{ id = "$network/privateEndpoints/demo-pe"; path = 'privateLinkServiceConnections'; itemName = 'storage'; serviceId = $storage }
        )
    }
}
