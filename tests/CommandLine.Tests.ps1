#requires -Version 7.0
Describe 'Command-line workflow with a synthetic CLI' {
    BeforeAll {
        $script:entryPoint = Join-Path $PSScriptRoot '..\scripts\Invoke-AzureInventory.ps1'
        $script:stubScript = Join-Path $PSScriptRoot 'fixtures\az-stub.ps1'
        $script:pwsh = (Get-Command pwsh -CommandType Application | Select-Object -First 1).Source
        function Invoke-SyntheticWorkflow {
            param([string] $Mode, [string] $Directory)
            $shim = Join-Path $Directory $(if ($IsWindows) { 'az.cmd' } else { 'az' })
            [IO.Directory]::CreateDirectory($Directory) | Out-Null
            if ($IsWindows) {
                [IO.File]::WriteAllText($shim, "@echo off`r`n`"$script:pwsh`" -NoProfile -File `"$script:stubScript`" %*`r`nexit /b %errorlevel%`r`n")
            }
            else {
                $quoted = @($script:pwsh, $script:stubScript) | ForEach-Object { "'" + $_.Replace("'", "'\''") + "'" }
                [IO.File]::WriteAllText($shim, "#!/bin/sh`nexec $($quoted[0]) -NoProfile -File $($quoted[1]) `"`$@`"`n")
                chmod u+x $shim
            }
            $oldPath = $env:PATH
            $oldMode = $env:AZURE_INVENTORY_TEST_MODE
            $PSNativeCommandUseErrorActionPreference = $false
            try {
                $env:PATH = "$Directory$([IO.Path]::PathSeparator)$oldPath"
                $env:AZURE_INVENTORY_TEST_MODE = $Mode
                $selected = @(Get-Command az -CommandType Application)
                if ($selected.Count -eq 0 -or $selected[0].Source -ne $shim) {
                    throw "Synthetic CLI was not selected; refusing to run. Expected $shim; resolved $($selected.Source -join ', ')."
                }
                $output = & $script:pwsh -NoProfile -File $script:entryPoint `
                    -TenantId '00000000-0000-0000-0000-000000000001' -OutputDirectory (Join-Path $Directory 'reports') 2>&1
                return @{ exitCode = $LASTEXITCODE; output = ($output | ForEach-Object { [string] $_ }) -join "`n" }
            }
            finally {
                $env:PATH = $oldPath
                $env:AZURE_INVENTORY_TEST_MODE = $oldMode
            }
        }
    }
    It 'writes all 2501 rows and exits zero through the actual entry point' {
        $result = Invoke-SyntheticWorkflow success (Join-Path $TestDrive 'success')
        $result.exitCode | Should -Be 0 -Because $result.output
        $summary = $result.output | ConvertFrom-Json
        $summary.status | Should -Be 'Succeeded'
        $summary.resources | Should -Be 2501
        Test-Path -LiteralPath $summary.report | Should -BeTrue
    }
    It 'writes an explicitly partial report and exits two' {
        $result = Invoke-SyntheticWorkflow partial (Join-Path $TestDrive 'partial')
        $result.exitCode | Should -Be 2 -Because $result.output
        $summary = $result.output | ConvertFrom-Json
        $summary.status | Should -Be 'Partial'
        $summary.resources | Should -Be 12
        $summary.warnings | Should -Be 3
        Test-Path -LiteralPath $summary.report | Should -BeTrue
    }
    It 'exits one without a report on authentication failure' {
        $directory = Join-Path $TestDrive 'authentication'
        $result = Invoke-SyntheticWorkflow authentication $directory
        $result.exitCode | Should -Be 1
        $result.output | Should -Match 'authentication failed'
        Test-Path -LiteralPath (Join-Path $directory 'reports') | Should -BeFalse
    }
}
