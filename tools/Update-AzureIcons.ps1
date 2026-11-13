#Requires -Version 7.0
<#
.SYNOPSIS
Maintainer tool: refreshes vendor\azure-icons from the official Microsoft Azure architecture icon package.

.DESCRIPTION
Extracts only the icons referenced by templates\azure-types.json from a locally downloaded
Azure_Public_Service_Icons_<version>.zip. Icon artwork is not changed: the outer <svg> wrapper
and the <title> metadata element are removed so that the body can be embedded inline. Icons that
contain active content, external references, comments, or style sheets are rejected.

Download the package yourself from https://learn.microsoft.com/azure/architecture/icons/ after
reading the icon terms. This tool never downloads anything and does not touch Azure.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string]$ZipPath,

    [string]$Version = 'V25',

    [string]$SourceUrl = 'https://arch-center.azureedge.net/icons/Azure_Public_Service_Icons_V25.zip',

    [string]$TypeMapPath = (Join-Path $PSScriptRoot '..\templates\azure-types.json'),

    [string]$OutputDirectory = (Join-Path $PSScriptRoot '..\vendor\azure-icons')
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem

function Get-Sha256Hex([byte[]]$Bytes) {
    [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($Bytes))
}

function Read-EntryBytes([IO.Compression.ZipArchiveEntry]$Entry) {
    $stream = $Entry.Open()
    try {
        $memory = [IO.MemoryStream]::new()
        $stream.CopyTo($memory)
        $memory.ToArray()
    } finally {
        $stream.Dispose()
    }
}

function Assert-SafeSvg([string]$Svg, [string]$Name) {
    $forbidden = [ordered]@{
        'script element'         = '<\s*script'
        'event handler'          = '\son[a-z]+\s*='
        'foreignObject element'  = '<\s*foreignObject'
        'image element'          = '<\s*image'
        'style element'          = '<\s*style'
        'comment'                = '<!--'
        'DOCTYPE or entity'      = '<!\s*(DOCTYPE|ENTITY)'
        'processing instruction' = '<\?'
        'javascript URL'         = 'javascript\s*:'
    }
    foreach ($rule in $forbidden.GetEnumerator()) {
        if ($Svg -match "(?i)$($rule.Value)") { throw "Icon '$Name' contains a forbidden $($rule.Key)." }
    }
    foreach ($match in [regex]::Matches($Svg, '(?i)\bhref\s*=\s*"([^"]*)"')) {
        if (-not $match.Groups[1].Value.StartsWith('#')) { throw "Icon '$Name' contains an external reference." }
    }
    foreach ($match in [regex]::Matches($Svg, '(?i)url\(\s*([^)]*)\)')) {
        if (-not $match.Groups[1].Value.Trim(" '`"").StartsWith('#')) { throw "Icon '$Name' contains an external url() reference." }
    }

    $settings = [Xml.XmlReaderSettings]::new()
    $settings.DtdProcessing = [Xml.DtdProcessing]::Prohibit
    $settings.XmlResolver = $null
    $reader = [Xml.XmlReader]::Create([IO.StringReader]::new($Svg), $settings)
    try {
        $document = [Xml.XmlDocument]::new()
        $document.XmlResolver = $null
        $document.Load($reader)
    } finally {
        $reader.Dispose()
    }
    if ($document.DocumentElement.LocalName -ne 'svg' -or $document.DocumentElement.NamespaceURI -ne 'http://www.w3.org/2000/svg') {
        throw "Icon '$Name' is not an SVG document."
    }
    $document.DocumentElement
}

function ConvertTo-IconifyIcon([string]$Svg, [string]$Name) {
    $Svg = $Svg.TrimStart([char]0xFEFF)
    $root = Assert-SafeSvg $Svg $Name
    $viewBox = [string]$root.GetAttribute('viewBox')
    $numbers = @($viewBox.Trim() -split '[\s,]+' | Where-Object { $_ } | ForEach-Object { [double]::Parse($_, [Globalization.CultureInfo]::InvariantCulture) })
    if ($numbers.Count -ne 4 -or $numbers[2] -le 0 -or $numbers[3] -le 0) { throw "Icon '$Name' has no usable viewBox." }

    $open = [regex]::Match($Svg, '(?is)^\s*<svg\b[^>]*>')
    $close = $Svg.LastIndexOf('</svg>', [StringComparison]::OrdinalIgnoreCase)
    if (-not $open.Success -or $close -lt $open.Length) { throw "Icon '$Name' has an unexpected SVG wrapper." }
    $body = $Svg.Substring($open.Length, $close - $open.Length)
    $body = [regex]::Replace($body, '(?is)<title\b[^>]*>.*?</title>', '')
    $body = [regex]::Replace($body, '>\s+<', '><').Trim()
    if (-not $body) { throw "Icon '$Name' is empty." }

    $icon = [ordered]@{ body = $body }
    if ($numbers[0] -ne 0) { $icon.left = $numbers[0] }
    if ($numbers[1] -ne 0) { $icon.top = $numbers[1] }
    if ($numbers[2] -ne 18) { $icon.width = $numbers[2] }
    if ($numbers[3] -ne 18) { $icon.height = $numbers[3] }
    $icon
}

$ZipPath = (Resolve-Path -LiteralPath $ZipPath).Path
$typeMap = Get-Content -LiteralPath $TypeMapPath -Raw | ConvertFrom-Json -AsHashtable
if (-not $typeMap.icons -or $typeMap.icons.Count -eq 0) { throw 'The type map has no icons section.' }

$zipBytes = [IO.File]::ReadAllBytes($ZipPath)
$archive = [IO.Compression.ZipFile]::OpenRead($ZipPath)
try {
    $entryPattern = '^Azure_Public_Service_Icons/Icons/(?<category>[^/]+)/\d+-icon-service-(?<name>[^/]+)\.svg$'
    $index = @{}
    $termsEntry = $null
    foreach ($entry in $archive.Entries) {
        $match = [regex]::Match($entry.FullName, $entryPattern, 'IgnoreCase')
        if ($match.Success) {
            $key = ('{0}/{1}' -f $match.Groups['category'].Value, $match.Groups['name'].Value).ToLowerInvariant()
            if (-not $index.ContainsKey($key)) { $index[$key] = [Collections.Generic.List[object]]::new() }
            $index[$key].Add($entry)
        } elseif ($entry.FullName -match '(^|/)Microsoft_Terms_of_Use\.pdf$') {
            $termsEntry = $entry
        }
    }
    if ($index.Count -eq 0) { throw 'The zip does not look like the Azure public service icon package.' }

    $icons = [ordered]@{}
    $sources = [ordered]@{}
    foreach ($iconKey in ($typeMap.icons.Keys | Sort-Object -CaseSensitive)) {
        if ($iconKey -cnotmatch '^[a-z0-9]+(-[a-z0-9]+)*$') { throw "Icon key '$iconKey' must be lowercase kebab-case." }
        $wanted = ([string]$typeMap.icons[$iconKey]).ToLowerInvariant()
        $found = $index[$wanted]
        if (-not $found) { throw "Icon '$iconKey' ($($typeMap.icons[$iconKey])) was not found in the zip." }
        if ($found.Count -gt 1) { throw "Icon '$iconKey' ($($typeMap.icons[$iconKey])) is ambiguous: $($found.FullName -join ', ')" }

        $bytes = Read-EntryBytes $found[0]
        $svg = [Text.UTF8Encoding]::new($false, $true).GetString($bytes)
        $icons[$iconKey] = ConvertTo-IconifyIcon $svg $iconKey
        $sources[$iconKey] = [ordered]@{ source = $found[0].FullName; sha256 = Get-Sha256Hex $bytes }
    }

    $lines = [Collections.Generic.List[string]]::new()
    $lines.Add('{')
    $lines.Add('  "prefix": "azure",')
    $lines.Add('  "width": 18,')
    $lines.Add('  "height": 18,')
    $lines.Add('  "icons": {')
    $keys = @($icons.Keys)
    for ($i = 0; $i -lt $keys.Count; $i++) {
        $comma = if ($i -lt $keys.Count - 1) { ',' } else { '' }
        $lines.Add(('    {0}: {1}{2}' -f (ConvertTo-Json $keys[$i] -Compress), (ConvertTo-Json $icons[$keys[$i]] -Compress), $comma))
    }
    $lines.Add('  }')
    $lines.Add('}')
    $iconsJson = ($lines -join "`n") + "`n"
    $iconsBytes = [Text.UTF8Encoding]::new($false).GetBytes($iconsJson)

    $null = New-Item -ItemType Directory -Path $OutputDirectory -Force
    [IO.File]::WriteAllBytes((Join-Path $OutputDirectory 'icons.json'), $iconsBytes)

    $manifest = [ordered]@{
        name          = 'Microsoft Azure architecture icons'
        version       = $Version
        source        = $SourceUrl
        terms         = 'https://learn.microsoft.com/azure/architecture/icons/'
        zipSha256     = Get-Sha256Hex $zipBytes
        iconsFile     = 'icons.json'
        iconsSha256   = Get-Sha256Hex $iconsBytes
        modifications = 'Outer <svg> wrapper and <title> metadata removed and whitespace between elements collapsed for inline embedding. Artwork, colors, and proportions unchanged.'
        icons         = $sources
    }
    if ($termsEntry) {
        $termsBytes = Read-EntryBytes $termsEntry
        [IO.File]::WriteAllBytes((Join-Path $OutputDirectory 'Microsoft_Terms_of_Use.pdf'), $termsBytes)
        $manifest.termsFile = 'Microsoft_Terms_of_Use.pdf'
        $manifest.termsFileSha256 = Get-Sha256Hex $termsBytes
    } else {
        Write-Warning 'Microsoft_Terms_of_Use.pdf was not found in the zip.'
    }
    $manifestJson = ($manifest | ConvertTo-Json -Depth 5) -replace "`r`n", "`n"
    [IO.File]::WriteAllText((Join-Path $OutputDirectory 'manifest.json'), $manifestJson + "`n", [Text.UTF8Encoding]::new($false))

    [pscustomobject]@{
        Icons       = $icons.Count
        IconsBytes  = $iconsBytes.Length
        IconsSha256 = $manifest.iconsSha256
        Output      = (Resolve-Path -LiteralPath $OutputDirectory).Path
    }
} finally {
    $archive.Dispose()
}
