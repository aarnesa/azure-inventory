# Azure inventory for GitHub Copilot

A small, read-only repository that turns your own Azure CLI login into **one offline HTML report**: a dashboard you can drill into, searchable resources, and architecture diagrams. No deployment, server, database, app registration, or application secret.

Copilot drives the workflow; local PowerShell code collects and formats the data. Mermaid Tiny draws diagrams with the official Microsoft Azure architecture icons in the report's browser, not in an external AI/image service. Each view can also be downloaded as an editable draw.io file.

## Quick start

### 1. Install once

On **Windows** (PowerShell):

```powershell
winget install --id Microsoft.PowerShell
winget install --id Microsoft.AzureCLI
git clone https://github.com/aarnesa/azure-inventory.git
```

On **Linux or WSL**, use the `apt` or `dnf` commands in [Linux and WSL](#linux-and-wsl) instead. On **macOS**: `brew install powershell` and `brew install --cask azure-cli`, then the same `git clone`. No Git? Download the repository as a ZIP from GitHub (**Code → Download ZIP**) and extract it.

Open the `azure-inventory` folder in GitHub Copilot: the Copilot app, Copilot CLI started in that folder, or VS Code in **Agent** mode.

### 2. Sign in to Azure

```sh
az login --tenant "<tenant-id>"
```

A browser opens for your account and MFA. If the CLI then asks you to pick a subscription, just press **Enter**; the tool reads all subscriptions you can see. Read access (for example the **Reader** role) is enough.

Where to find the tenant ID (a GUID):

- Azure portal → **Microsoft Entra ID** → **Overview** → **Tenant ID**, or
- run `az login` without `--tenant`, then ask Copilot *"Mitkä tenantit näen?"* / *"Which tenants can I see?"*; it lists the tenant names and IDs.

### 3. Ask Copilot

Copy one of these prompts into Copilot:

> Tee Azure-inventointi tenantista `<tenant-id>` ja luo offline-HTML-raportti azure-inventory-skillin avulla.

> Use the azure-inventory skill to inventory tenant `<tenant-id>` and create an offline HTML report.

Copilot runs the local script and tells you where the report is: `output/<tenant>-<run-id>/report.html`. Open it by double-clicking (WSL: see [Linux and WSL](#linux-and-wsl)). It opens on a dashboard; see [Report layout](#report-layout). The report works offline and is never uploaded anywhere.

If Copilot doesn't seem to know the skill, add: *"Read `.github/skills/azure-inventory/SKILL.md` first."*

## Linux and WSL

Use this instead of the `winget` commands in step 1; steps 2 and 3 are the same. On Windows you don't need WSL.

### Ubuntu and Debian (apt)

```bash
sudo apt-get update && sudo apt-get install -y curl git
. /etc/os-release
curl -fsSLO "https://packages.microsoft.com/config/$ID/$VERSION_ID/packages-microsoft-prod.deb"
sudo dpkg -i packages-microsoft-prod.deb && rm packages-microsoft-prod.deb
sudo apt-get update && sudo apt-get install -y powershell
curl -fsSL https://aka.ms/InstallAzureCLIDeb | sudo bash
git clone https://github.com/aarnesa/azure-inventory.git
```

### RHEL, AlmaLinux, Rocky Linux and CentOS Stream (dnf)

```bash
. /etc/os-release
sudo rpm --import https://packages.microsoft.com/keys/microsoft.asc
sudo rpm --import https://packages.microsoft.com/keys/microsoft-2025.asc
sudo dnf install -y "https://packages.microsoft.com/config/rhel/${VERSION_ID%%.*}/packages-microsoft-prod.rpm"
sudo dnf install -y powershell azure-cli git
git clone https://github.com/aarnesa/azure-inventory.git
```

Check the install with `pwsh --version` and `az --version`. If `powershell` can't be found (typical on ARM64), open the section below.

<details>
<summary>ARM64, Fedora and other distributions</summary>

Microsoft's `apt` and `dnf` repositories have no PowerShell package for ARM64 Ubuntu or ARM64 RHEL (`powershell` is "not found"), and the commands above don't cover Fedora. Install PowerShell from the release tarball instead:

```bash
ARCH=$(uname -m | sed 's/x86_64/x64/;s/aarch64/arm64/')
VER=$(curl -fsSLI -o /dev/null -w '%{url_effective}' https://github.com/PowerShell/PowerShell/releases/latest | sed 's|.*/v||')
sudo mkdir -p /opt/microsoft/powershell/7
curl -fsSL "https://github.com/PowerShell/PowerShell/releases/download/v$VER/powershell-$VER-linux-$ARCH.tar.gz" | sudo tar -xz -C /opt/microsoft/powershell/7
sudo chmod +x /opt/microsoft/powershell/7/pwsh
sudo ln -sf /opt/microsoft/powershell/7/pwsh /usr/local/bin/pwsh
```

The tarball needs a few system libraries (for example ICU and OpenSSL); see [Microsoft's guide](https://learn.microsoft.com/powershell/scripting/install/install-other-linux). For Azure CLI on other distributions, see [Microsoft's install guide](https://learn.microsoft.com/cli/azure/install-azure-cli-linux).

</details>

### WSL notes

- **Sign in inside WSL.** WSL has its own Azure CLI login, so run `az login --tenant "<tenant-id>"` in the WSL shell even if you're signed in on Windows. If no browser opens, add `--use-device-code` (some tenants block device-code sign-in).
- **Run Copilot inside WSL** so it uses WSL's `pwsh` and `az`: install Copilot CLI with `curl -fsSL https://gh.io/copilot-install | bash`, then run `cd azure-inventory && copilot` and sign in with `/login`. Or open the folder in VS Code with the **WSL** extension and use **Agent** mode.
- **Clone into your Linux home folder** (`~`), not under `/mnt/c`; it's faster.
- **Open the report** with `wslview output/<tenant>-<run-id>/report.html` (opens your Windows browser), or run `explorer.exe .` in the report folder and double-click `report.html`. On a Linux desktop use `xdg-open`.

**Tested:** the tool itself (demo report and test suite) on Ubuntu 24.04 under WSL, ARM64, PowerShell 7.7. The `apt` and `dnf` commands follow Microsoft's guides ([PowerShell](https://learn.microsoft.com/powershell/scripting/install/installing-powershell-on-linux), [Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli-linux)) but were not run on every distribution listed; if one fails, follow the guide for your release.

## Edit diagrams in draw.io

1. In the report, open the **Architecture** tab and choose a view.
2. Select **Download this view (.drawio)** or **Download whole tenant (.drawio)**.
3. Install draw.io once: `winget install --id JGraph.Draw` on Windows, or the VS Code extension **Draw.io Integration** on any system. On a Linux desktop, download the `.deb` or `.rpm` for your CPU from [draw.io releases](https://github.com/jgraph/drawio-desktop/releases) and install it with `sudo apt install ./<file>.deb` or `sudo dnf install ./<file>.rpm`. Under WSL the browser runs on Windows, so install draw.io on Windows; the file lands in your Windows Downloads folder.
4. Open the downloaded file. A whole-tenant file has several pages; switch between them with the tabs at the bottom.
5. Move shapes or use **Arrange → Layout** to tidy up, then **File → Export as → PNG / SVG / PDF**.

The files contain customer data. Use the desktop app or VS Code, not online diagram editors, unless the customer has approved it. More detail: [Editable draw.io export](#editable-drawio-export).

## Troubleshooting

| Problem | What to do |
| --- | --- |
| Sign-in expired, wrong tenant, or "not signed in" | Run `az login --tenant "<tenant-id>"` again, then repeat the prompt. |
| No browser opens for `az login` (WSL, SSH) | Run `az login --use-device-code --tenant "<tenant-id>"`. If your tenant blocks device-code sign-in, sign in from a system where a browser works, for example Windows instead of WSL. |
| `Unable to locate package powershell` or dnf "No match" | The Microsoft repository has no PowerShell package for your CPU or distribution (for example ARM64). Use the tarball in [Linux and WSL](#linux-and-wsl). |
| Report won't open from WSL | Run `wslview output/<tenant>-<run-id>/report.html`, or `explorer.exe .` in the report folder. |
| Report says **Partial collection - review warnings** | The report is usable but incomplete. Open the warnings at the top of the report; they usually mean missing read access to some subscriptions. |
| Few or no resources | You only see what your account can read. Ask for the **Reader** role on the subscriptions or management group. |
| Copilot doesn't find the skill | Ask it to read `.github/skills/azure-inventory/SKILL.md`. |
| Diagram is crowded | Narrow it with the subscription and resource group filters, or edit the draw.io export. |

## Details

The repository includes its own skill in `.github/skills/azure-inventory/SKILL.md`. The Azure MCP server and other personal skills are **not** prerequisites.

The report includes a vendored renderer and icons and requires JavaScript, but **no internet connection** when viewing it. There is no Node.js or Python requirement. Baseline HTML size is about 3.2 MB because the offline Mermaid renderer and Azure icons are included; inventory data increases that size.

## Run directly

From the repository root (PowerShell, bash or zsh):

```sh
pwsh -NoProfile -File ./scripts/Invoke-AzureInventory.ps1 -TenantId "<tenant-id>"
```

The script requires the active Azure CLI account to be an interactive user in that tenant. It refreshes subscription discovery, explicitly scopes the queries, and never changes the default subscription or runs `az login` itself.

Optional output location:

```sh
pwsh -NoProfile -File ./scripts/Invoke-AzureInventory.ps1 -TenantId "<tenant-id>" -OutputDirectory "<folder>"
```

Each run gets a unique directory. Earlier reports are not overwritten. If you choose a custom location inside a Git repository, add it to that repository's ignore rules before committing anything.

The command prints a small JSON summary containing status, tenant, counts, and the absolute report path, not the resource list.

| Exit code | Meaning |
| --- | --- |
| `0` | All requested queries succeeded for the visible Resource Graph data; **not** proof of complete tenant coverage |
| `2` | A report was written, but collection or relationship detail is explicitly partial |
| `1` | Fatal authentication, collection, validation, or output failure; do not claim a successful report |

If authentication expires, sign in again interactively. If permissions fail, review the user's read access. Retrying does not grant additional access. Do not bypass these errors by switching to another tenant or credential.

## What is included

- One chosen Entra tenant and its subscriptions visible to the signed-in user.
- Resource Graph's `Resources` and `ResourceContainers` tables, across all returned pages.
- IDs, names, types, kinds, regions, resource groups, available SKU fields, and tags.
- Subscription query outcomes, visible empty resource groups, totals, and summaries.
- A dashboard-first report: key figures plus clickable, paginated breakdowns by category, type, resource group, subscription, and region.
- A searchable resource table with subscription/group/category/type/region filters and 50-row pages.
- Tenant/subscription/group overview diagrams and resource-group relationship diagrams, narrowed with cascading filters: subscription → resource group → optional single resource (shows its direct observed links).
- Connection evidence and explicit references to objects absent from the returned resource rows.
- Downloadable `.drawio` files for the current diagram view or the whole tenant.

Diagrams are rendered only when opened. Overview pages show up to 20 groups; resource views show up to 30 primary resources with 40 incident links per page. References may add nodes. These are **display partitions**, not resource collection limits; use the view navigation to see the remaining partitions.

## Report layout

The report opens on a **dashboard** and keeps the detail one click away. The four tabs can also be opened by URL hash (for example `report.html#groups`) and with the arrow keys.

| Tab | Shows |
| --- | --- |
| **Overview** (default) | Key figures (resources, subscriptions, resource groups, resource types, regions) and breakdowns by category, type, resource group, subscription, and region. Coverage and per-subscription query status are in a collapsed section at the bottom. |
| **Resources** | Searchable table with subscription, resource group, category, type, and region filters; 50 rows per page; details for each row on demand. |
| **Resource groups** | Searchable list of groups with subscription, region, and resource count, including visible empty groups; 50 per page. |
| **Architecture** | Diagrams and draw.io export, described below. |

Drill down from the Overview by clicking a row in any breakdown. The selection becomes a chip above the lists, and the other breakdowns then count only the resources inside it. A breakdown never filters itself, so its alternatives stay visible. Click the row or its chip again to remove that filter, or use **Clear filters**. **Browse N resources →** opens the Resources tab with the same filters applied.

Each breakdown starts with its top entries (8 types, 8 resource groups, 6 subscriptions, 6 regions; every category). **Show all N** pages through the rest 10 at a time, and **Show top N** collapses it again. A selected entry outside the top rows stays on the list. Resources without a reported location are counted as **(not reported)**. The key figures always cover the whole report and ignore the filters. The Resource groups and Architecture tabs are built when first opened and are not filtered by the Overview selection.

## Architecture diagrams

Diagrams use the official [Microsoft Azure architecture icons](https://learn.microsoft.com/azure/architecture/icons/) with the resource name and type next to each icon. Resources are nested as **subscription → resource group → virtual network → subnet**, so NICs and private endpoints appear inside their subnet. Related resources that are not part of the selected view are drawn in dashed **Outside this view** groups: incoming references on one side and outgoing references on the other.

| Style | Shows |
| --- | --- |
| **Compact architecture** (default) | Folds NICs and disks into their VM, public IPs into their NIC or VM, and child resources into their parent; the folded names stay visible as details. NSG and route table associations become details on the NIC, or a badge inside the subnet, instead of separate edges. Folding applies only to collected rows in the same view. |
| **Detailed** | Every resource and every observed link, including NSG and route table edges. |

Resource types without a specific mapping use their provider category's icon (for example, Networking or Databases), or a generic Azure resource icon. The automatic layout is a starting point: long edges may cross labels in large views.

### Editable draw.io export

Use **Download this view (.drawio)** or **Download whole tenant (.drawio)** below the diagram. The files are created locally in the browser; nothing is uploaded. The whole-tenant file has one page for the tenant overview, one for each subscription, and one compact page for each resource group with collected resources.

Exported shapes use draw.io's built-in Azure icon library and the same nesting. Containers and resources store their Azure resource ID as `azureResourceId` shape data (**Edit Data** in draw.io).

Open the files in [draw.io Desktop](https://github.com/jgraph/drawio-desktop/releases) or the VS Code **Draw.io Integration** extension. Use **Arrange → Layout** or move shapes to tidy up the layout. Exported files contain customer inventory data: don't open them in a web-based editor or upload them to an online diagram service unless the customer has approved it.

Supported initial relationships: resource-ID containment, VM NICs/disks, NIC subnets/public IPs/NSGs, subnet NSGs/route tables, VNet peering, private endpoint subnet/targets, and App Service plan/VNet integration references. Unrecognized resource types still appear in the inventory.

No inferred app-to-database connections are invented. A configuration reference is **not** proof of traffic, access authorization, connectivity, or a full dependency graph.

## Coverage limits

- "All" means all returned pages from the selected Resource Graph tables within the requested visible scope. Not every Azure service, child object, or table is included.
- Azure may silently omit objects without read access, even when a query succeeds. The tool cannot count inaccessible resources or certify tenant completeness. Read permissions may be scoped below the subscription.
- Resource Graph is eventually consistent. A run is not an atomic snapshot. Inconsistent page counts, duplicates, unusable continuation tokens, and known failures are reported rather than silently ignored.
- The tool batches up to 1,000 subscriptions per query and follows pages of up to 1,000 rows. Failed batches are isolated to individual subscriptions where possible.
- Relationship expansion has a service limit of 2,000 elements per array. Larger supported arrays explicitly mark the report partial; their resource rows remain included.
- A referenced subnet may be embedded in a VNet and not be a separate `Resources` row. "Referenced only" does not mean inaccessible or nonexistent.
- Costs, security/compliance audits, comprehensive RBAC, application settings, connection strings, keys, secret values, and data-plane contents are excluded.
- No automatic cross-tenant or Lighthouse traversal. Cross-scope references can be shown, but are not queried.
- Queries use the active CLI cloud's ARM endpoint and Resource Graph API `2022-10-01`. Sovereign-cloud behavior has not been live-validated.

Printing prints only the active tab, as currently displayed: the Overview with its current lists, one page of resources or groups, or the current diagram, not every resource. Share the original HTML for the full interactive inventory.

## Customer data and Git sharing

Resource names, IDs, tags, and topology can be confidential. Tags can even contain sensitive values; this tool does not guarantee their redaction.

Collection and rendering run locally. The skill does not automatically paste the report or raw inventory into Copilot context. **Copilot itself is not an offline service.** Asking an agent to inspect a customer report may send its content to the configured AI service.

Reports are written under `output/` by default, which `.gitignore` excludes. Raw provider responses and auth tokens are not saved. Temporary request bodies contain queries/scope, not bearer tokens, and are removed after the request. The HTML embeds all collected report data; sharing it shares that data. Downloaded `.drawio` files go to the browser's download folder and contain names, IDs, and topology; handle them like the report. Ignore rules are not access controls or a substitute for checking staged files.

For customer distribution, share only the source and vendored renderer and icons. Before publishing a Git repository:

1. Choose a distribution license for your own code and the intended repository visibility.
2. Preserve `THIRD-PARTY-NOTICES.md`, the Mermaid license, and `vendor/azure-icons/TERMS.md` with Microsoft's terms of use. The Azure icons belong to Microsoft, are not covered by your license, and may be used only in architecture diagrams, training materials, or documentation.
3. Check that no generated report, real inventory fixture, credential, or local artifact is staged.

This template does not create a remote repository, push commits, or publish reports. No license for the project's own code is implicitly assigned; the owner must choose one before external distribution.

## Safe demo and development checks

Generate a demo without Azure credentials or any Azure calls:

```sh
pwsh -NoProfile -File ./tests/New-DemoReport.ps1
pwsh -NoProfile -File ./tests/New-DemoReport.ps1 -ResourceCount 2501
pwsh -NoProfile -File ./tests/New-DemoReport.ps1 -Varied -ResourceCount 450
```

Demo IDs and names are synthetic. `-Varied` spreads the resources over eight subscriptions and many types, groups, and regions, so the dashboard's paging and drill-down have something to show. Demo tags intentionally include inert HTML-shaped text to exercise escaping.

Pester (version 5 or 6) is only a development dependency. Run in `pwsh`:

```powershell
Install-Module Pester -MinimumVersion 5.0 -Scope CurrentUser
Invoke-Pester -Path ./tests -CI
```

Tests mock the Azure boundary. They cover pagination beyond 1,000 rows, large subscription scopes, partial failures, retries, authentication boundaries, observed relationships, and safe/self-contained HTML generation. Child-process tests also verify the actual command-line entry point and exit codes using a synthetic CLI. They never use your live Azure login.

An optional **developer-only** browser check uses Node.js, `playwright-core`, and an installed Microsoft Edge:

```powershell
npm install --no-save --package-lock=false --ignore-scripts playwright-core
$report = pwsh -NoProfile -File ./tests/New-DemoReport.ps1 -ResourceCount 2501
$hostile = pwsh -NoProfile -File ./tests/New-DemoReport.ps1 -Adversarial
$varied = pwsh -NoProfile -File ./tests/New-DemoReport.ps1 -Varied -ResourceCount 450
node ./tests/BrowserSmoke.cjs $report $hostile $varied
```

It opens the actual `file:` report in an isolated offline browser context and checks the dashboard (drill-down filters, paging, tabs, deep links, print layout, narrow screens), table interactions, diagram filters, compact and detailed styles, icons, and draw.io downloads. It also checks hostile labels and rejects any HTTP(S) request or script error. The hostile and varied reports are optional (pass `-` to skip the hostile one); the varied report enables the dashboard paging checks. None of these browser-testing packages are needed by report users.

The implementation targets cross-platform PowerShell 7. The tests pass with PowerShell 7.7 on Windows and on Ubuntu 24.04 under WSL (ARM64), and demo-report generation was checked on both. The browser smoke tests have only been run on Windows. macOS, other Linux distributions and live Azure collection are not claimed as tested. A live smoke run must use a tenant explicitly chosen by the user.

## Renderer maintenance

`vendor/mermaid/manifest.json` pins Mermaid Tiny's version, package integrity, and renderer SHA-256. Report generation verifies the renderer checksum. The generated page also uses CSP script hashes and blocks external resource connections.

For an update, obtain the package from its official npm distribution, verify the package integrity, replace the renderer/license, update the manifest and notices, and rerun PowerShell and offline browser checks. Do not substitute a CDN URL or an unverified download at report runtime.

### Azure icons

`vendor/azure-icons` contains only the icons listed in `templates/azure-types.json`, taken from Microsoft's Azure architecture icon package. Each icon is stored without its outer `<svg>` wrapper and `<title>`; the artwork itself is unchanged. `manifest.json` pins the source package and the `icons.json` SHA-256, and report generation verifies that checksum. `azure-types.json` maps resource types to display names, icons, and draw.io shapes.

To add a resource type or update the icons, download the official package manually after reading its terms, edit `azure-types.json` if needed, and run:

```powershell
pwsh -NoProfile -File ./tools/Update-AzureIcons.ps1 -ZipPath <path-to-zip> -Version <version> -SourceUrl <download-url>
```

The tool does not download anything. It rejects icons with scripts, external references, or style sheets. Rerun the PowerShell and browser checks afterwards.
