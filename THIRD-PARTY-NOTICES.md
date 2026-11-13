# Third-party notices

## Mermaid Tiny

- Package: `@mermaid-js/tiny`
- Version: `12.3.0`
- Upstream: https://github.com/mermaid-js/mermaid
- Distribution: https://www.npmjs.com/package/@mermaid-js/tiny/v/12.3.0
- License: MIT; see `vendor\mermaid\LICENSE`.
- Included asset: `vendor\mermaid\mermaid.tiny.js`, unmodified from the package.
- Asset SHA-256: `C41F5236091B83F524C4940F97A16B2B14A76F21FF84AEA4FD6B66421D8A2A9A`
- Package integrity: `sha512-90BO2kQvmQWj9YjBX2IsLHCw61rN69dPTn5wFfDu+b9aT7qtzfzTA3wpKWeaRAKK85refSo9How5EOeY39DWfA==`

The package was obtained through the development environment's configured npm registry mirror and its archive integrity was verified before extraction. No install scripts were executed.

The bundled JavaScript retains its dependency license notices, including the upstream "Bundled license information" comment. Keep those notices when redistributing the asset or generated reports. Generated HTML includes the original license texts listed below, embeds the renderer, normalizes script line endings for CSP, and escapes script-closing sequences if present; it does not fetch the renderer over the network.

## Bundled dependency notices

- **DOMPurify 3.4.17**, copyright Cure53 and contributors. Distributed here under its Apache-2.0 option. Original license: `vendor\mermaid\LICENSE-DOMPURIFY`. Upstream: https://github.com/cure53/DOMPurify
- **Lodash ES 4.18.1**, copyright OpenJS Foundation and contributors; includes Underscore notices for Jeremy Ashkenas, DocumentCloud, and Investigative Reporters & Editors. MIT. Original license: `vendor\mermaid\LICENSE-LODASH`. Upstream: https://github.com/lodash/lodash
- **regenerator-runtime notice**, copyright 2014-present Facebook, Inc., MIT. Its copyright/license notice is retained in the renderer; the MIT permission and warranty text is included with the report. Upstream license reference: https://github.com/babel/babel/blob/main/packages/babel-helpers/LICENSE

The DOMPurify and Lodash license files were extracted unchanged from their matching npm packages after verifying these package integrities:

- DOMPurify: `sha512-B/pSlYVHQ58kqISD/yDjuJ1yfzI34m1gF4lAod2bwSRhiN4K5Cl3H8Af7hqB2PmTL911tdEudnnXn5FnhRoz0w==`
- Lodash ES: `sha512-J8xewKD/Gk22OZbhpOVSwcs60zhd95ESDwezOFuA3/099925PdHJ7OFHNTGtajL3AlZkykD32HykiMo+BIBI8A==`

## Microsoft Azure architecture icons

- Source: https://learn.microsoft.com/azure/architecture/icons/ (`Azure_Public_Service_Icons_V25.zip`)
- Package SHA-256 and per-icon source hashes: `vendor\azure-icons\manifest.json`
- Terms: Microsoft's icon terms; see `vendor\azure-icons\TERMS.md` and the unchanged `vendor\azure-icons\Microsoft_Terms_of_Use.pdf`.
- Included asset: `vendor\azure-icons\icons.json`, a subset of the package's SVG icons with only the outer `<svg>` wrapper and `<title>` metadata removed. Generated reports embed this file to draw architecture diagrams.

The icons are not covered by this repository's license. They may be used only in architectural diagrams, training materials, or documentation, as described in Microsoft's terms.

The `.drawio` export references draw.io's own built-in `img/lib/azure2` shape library by name; it does not embed icon files.

Pester and Playwright Core are development tools, not bundled report/runtime dependencies.
