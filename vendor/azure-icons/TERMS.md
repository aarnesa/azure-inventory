# Microsoft Azure architecture icons

This folder contains a subset of the official Microsoft Azure architecture icons
(`Azure_Public_Service_Icons_V25.zip`) from
https://learn.microsoft.com/azure/architecture/icons/.

The icons belong to Microsoft and are **not** covered by this repository's license. Microsoft's icon terms
(as published on that page) are:

> Microsoft permits the use of these icons in architectural diagrams, training materials, or documentation.
> You can copy, distribute, and display the icons only for the permitted use unless granted explicit
> permission by Microsoft. Microsoft reserves all other rights.

`Microsoft_Terms_of_Use.pdf` is included unchanged from the icon package.

## How this tool uses them

- Icons are embedded in generated inventory reports only to draw architecture diagrams of the Azure
  resources that the signed-in user can read.
- The product or resource type name is shown next to each icon.
- Icon artwork is not cropped, flipped, rotated, recolored, or distorted. `tools\Update-AzureIcons.ps1`
  removes only the outer `<svg>` wrapper and `<title>` metadata so the icon can be embedded inline.
- Do not reuse these files for any other purpose, and do not use them to represent your own product or
  service.

## Updating

Download a newer package from the page above after reading the terms, then run:

```powershell
.\tools\Update-AzureIcons.ps1 -ZipPath <path-to-zip> -Version <version> -SourceUrl <download-url>
```

The tool extracts only the icons listed in `templates\azure-types.json`, rejects icons with active
content or external references, and rewrites `icons.json` and `manifest.json`. Report generation verifies
`icons.json` against the SHA-256 in `manifest.json`.
