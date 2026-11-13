#requires -Version 7.0
[CmdletBinding()]
param(
    [ValidateRange(12, 100000)][int] $ResourceCount = 12,
    [switch] $Adversarial,
    [switch] $Varied,
    [string] $OutputDirectory = (Join-Path $PSScriptRoot '..\output\demo')
)
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot '..\scripts\AzureInventory.psm1') -Force
. (Join-Path $PSScriptRoot 'fixtures\New-SyntheticData.ps1')
$fixture = New-SyntheticData -ResourceCount $ResourceCount -Adversarial:$Adversarial -Varied:$Varied
$inventory = & (Get-Module AzureInventory) {
    param($sample)
    ConvertTo-InventoryModel -Context $sample.context -ResourceRows $sample.resources `
        -ContainerRows $sample.containers -ReferenceRows $sample.references `
        -Warnings ([System.Collections.Generic.List[object]]::new()) -StartedAt '2026-01-01T00:00:00Z'
} $fixture
$inventory['demo'] = $true
Export-InventoryReport -Inventory $inventory -OutputDirectory $OutputDirectory
