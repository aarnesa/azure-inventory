#requires -Version 7.0
[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [guid] $TenantId,
    [string] $OutputDirectory = (Join-Path $PSScriptRoot '..\output')
)

$ErrorActionPreference = 'Stop'
try {
    Import-Module (Join-Path $PSScriptRoot 'AzureInventory.psm1') -Force
    $inventory = Get-AzureInventory -TenantId $TenantId.ToString()
    $report = Export-InventoryReport -Inventory $inventory -OutputDirectory $OutputDirectory
    [ordered]@{
        status = $inventory.status
        tenantId = $inventory.tenantId
        subscriptions = $inventory.subscriptions.Count
        resources = $inventory.resources.Count
        warnings = $inventory.warnings.Count
        report = $report
    } | ConvertTo-Json
    if ($inventory.status -eq 'Partial') { exit 2 }
    exit 0
}
catch {
    Write-Error -Message $_.Exception.Message -ErrorAction Continue
    exit 1
}
