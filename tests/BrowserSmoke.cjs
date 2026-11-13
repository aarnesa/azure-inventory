'use strict';
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { pathToFileURL } = require('node:url');
const { resolve } = require('node:path');
const { chromium } = require('playwright-core');

const VIEWS = ['overview', 'resources', 'groups', 'architecture'];
const digits = text => Number(text.replace(/\D/g, ''));
const reportUrl = path => pathToFileURL(resolve(path)).href;
const localized = (page, number) => page.evaluate(value => value.toLocaleString(), number);

async function waitForDiagram(page, scope) {
  await page.waitForFunction(expected => {
    const status = document.getElementById('diagram-status').textContent;
    return status.includes(expected) && !status.startsWith('Rendering:');
  }, scope);
  assert.equal(await page.locator('#diagram .warning').count(), 0, 'Mermaid must render, not show a fallback');
  assert.equal(await page.locator('#diagram > svg').count(), 1);
}

async function assertOnlyIconImages(page) {
  const sources = await page.locator('img').evaluateAll(images => images.map(image => image.getAttribute('src')));
  for (const source of sources) assert.match(source, /^data:image\/svg\+xml;base64,[A-Za-z0-9+/=]+$/, 'Only embedded icon images may appear');
}

async function appStructure(page, style) {
  await page.locator('#diagram-subscription').selectOption('11111111-1111-1111-1111-111111111111');
  await page.locator('#diagram-group').selectOption('11111111-1111-1111-1111-111111111111|demo-app');
  await page.locator('#diagram-style').selectOption(style);
  await waitForDiagram(page, 'demo-app | resources');
  return {
    nodes: await page.locator('#diagram g.icon-shape').count(),
    clusters: await page.locator('#diagram g.cluster').count(),
    edges: await page.locator('#diagram .edgePaths path').count()
  };
}

async function downloadDrawio(page, button) {
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator(button).click()]);
  const xml = readFileSync(await download.path(), 'utf8');
  const result = await page.evaluate(source => {
    const doc = new DOMParser().parseFromString(source, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) return { parseError: true };
    const problems = [];
    const diagrams = [...doc.getElementsByTagName('diagram')];
    for (const diagram of diagrams) {
      const ids = new Set();
      for (const node of diagram.querySelectorAll('[id]')) {
        if (ids.has(node.getAttribute('id'))) problems.push(`duplicate id ${node.getAttribute('id')}`);
        ids.add(node.getAttribute('id'));
      }
      for (const cell of diagram.getElementsByTagName('mxCell')) {
        for (const name of ['parent', 'source', 'target']) {
          if (cell.hasAttribute(name) && !ids.has(cell.getAttribute(name))) problems.push(`${name} ${cell.getAttribute(name)} is missing`);
        }
      }
    }
    const objects = [...doc.getElementsByTagName('UserObject')];
    return {
      parseError: false, pages: diagrams.length, problems,
      images: [...source.matchAll(/image=([^;"]+);/g)].map(match => match[1]),
      labels: objects.map(object => object.getAttribute('label')),
      resourceIds: objects.map(object => object.getAttribute('azureResourceId')).filter(Boolean)
    };
  }, xml);
  assert.equal(result.parseError, false, 'draw.io export must be well-formed XML');
  assert.deepEqual(result.problems, [], 'draw.io cells must reference existing parents and endpoints');
  assert.ok(result.images.length > 0, 'draw.io export must use Azure shapes');
  for (const image of result.images) assert.match(image, /^img\/lib\/azure2\/[A-Za-z0-9_ ./()+-]+\.svg$/, 'Shapes must come from the draw.io Azure library');
  return { ...result, filename: download.suggestedFilename() };
}

async function assertView(page, name) {
  for (const view of VIEWS) {
    assert.equal(await page.locator(`#tab-${view}`).getAttribute('aria-selected'), String(view === name), `${view} tab selection`);
    assert.equal(await page.locator(`#view-${view}`).isVisible(), view === name, `${view} view visibility`);
  }
}

async function openView(page, name) {
  await page.locator(`#tab-${name}`).click();
  await assertView(page, name);
}

// Dashboard filters work on any report: select, combine, hand over to the Resources tab, then undo.
async function drillDown(page, count) {
  const total = await localized(page, count);
  const everything = `All ${total} resources`;
  assert.equal(await page.locator('#view-count').innerText(), everything);
  assert.equal(await page.locator('#chips .chip').count(), 0);
  assert.equal(await page.locator('#clear-filters').isHidden(), true, 'Clear filters appears only while a filter is active');

  const typeBar = page.locator('#panel-type button.bar').first();
  const typeCount = digits(await typeBar.locator('.count').innerText());
  await typeBar.click();
  assert.equal(await page.locator('#panel-type button.bar[aria-pressed=true]').count(), 1);
  assert.match(await page.locator('#chips .chip').innerText(), /^Type: /);
  assert.equal(await page.locator('#view-count').innerText(), `Showing ${await localized(page, typeCount)} of ${total} resources`);
  assert.equal(digits(await page.locator('#resource-badge').innerText()), typeCount, 'The Resources tab count follows the dashboard');

  const groupBar = page.locator('#panel-group button.bar').first();
  const narrowed = digits(await groupBar.locator('.count').innerText());
  assert.ok(narrowed <= typeCount, 'Other panels count only the resources inside the selection');
  await groupBar.click();
  assert.equal(await page.locator('#chips .chip').count(), 2);
  assert.equal(digits(await page.locator('#resource-badge').innerText()), narrowed);

  await page.locator('#open-resources').click();
  assert.equal(await page.evaluate(() => location.hash), '#resources');
  await assertView(page, 'resources');
  assert.equal(await page.locator('#resource-rows > tr').count(), Math.min(50, narrowed));
  assert.notEqual(await page.locator('#type-filter').inputValue(), '', 'The Resources filters mirror the dashboard');
  assert.notEqual(await page.locator('#group-filter').inputValue(), '');
  assert.equal(await page.locator('#reset-filters').isDisabled(), false);
  await openView(page, 'overview');

  await page.locator('#panel-type button.bar[aria-pressed=true]').click();
  assert.equal(await page.locator('#panel-type button.bar[aria-pressed=true]').count(), 0, 'Selecting a selected row clears it');
  assert.equal(await page.locator('#chips .chip').count(), 1);
  await page.locator('#chips .chip').click();
  assert.equal(await page.locator('#chips .chip').count(), 0, 'A chip removes its own filter');
  assert.equal(await page.locator('#view-count').innerText(), everything);

  await page.locator('#panel-type button.bar').first().click();
  await page.locator('#clear-filters').click();
  assert.equal(await page.locator('#chips .chip').count(), 0);
  assert.equal(await page.locator('#view-count').innerText(), everything);
  assert.equal(digits(await page.locator('#resource-badge').innerText()), count);
}

async function searchChip(page) {
  const hostile = '<img src=x onerror="globalThis.inventoryInjection=true">';
  await openView(page, 'resources');
  await page.locator('#search').fill(hostile);
  await openView(page, 'overview');
  assert.equal(await page.locator('#chips .chip').count(), 1);
  assert.equal(await page.locator('#chips .chip').getAttribute('title'), hostile);
  assert.match(await page.locator('#chips .chip').innerText(), /^Search: "<img src=x onerror=/);
  assert.equal(await page.locator('#chips img').count(), 0, 'Search text stays text');
  assert.equal(await page.locator('#view-count').innerText(), 'No resources match these filters');
  assert.equal(await page.locator('#open-resources').isDisabled(), true);
  assert.equal(await page.evaluate(() => Boolean(globalThis.inventoryInjection)), false);
  await page.locator('#clear-filters').click();
  assert.equal(await page.locator('#search').inputValue(), '', 'Clearing the filters empties the search box');
}

async function tabNavigation(page) {
  await page.locator('#tab-overview').focus();
  for (const [key, view] of [['Home', 'overview'], ['ArrowRight', 'resources'], ['ArrowRight', 'groups'], ['ArrowLeft', 'resources'], ['Home', 'overview']]) {
    await page.keyboard.press(key);
    await assertView(page, view);
    assert.equal(await page.evaluate(() => document.activeElement.id), `tab-${view}`, 'Arrow keys move focus with the tab');
  }
  await page.evaluate(() => { location.hash = 'groups'; });
  await page.waitForFunction(() => document.getElementById('tab-groups').getAttribute('aria-selected') === 'true');
  await assertView(page, 'groups');
  await page.evaluate(() => { location.hash = ''; });
  await page.waitForFunction(() => document.getElementById('tab-overview').getAttribute('aria-selected') === 'true');
  await assertView(page, 'overview');
}

async function deepLink(context, watch, report) {
  const page = watch(await context.newPage());
  await page.goto(`${reportUrl(report)}#groups`);
  await assertView(page, 'groups');
  await page.locator('#group-table tbody tr').first().waitFor();
  await page.close();
}

async function printLayout(page) {
  await page.emulateMedia({ media: 'print' });
  assert.equal(await page.locator('#tabs').isHidden(), true, 'The tab bar is not printed');
  assert.equal(await page.locator('#view-overview').isVisible(), true);
  assert.equal(await page.locator('#view-resources').isHidden(), true, 'Only the active view is printed');
  await page.emulateMedia({ media: 'screen' });
}

// Walks one dashboard panel through its pages and returns every label it listed.
async function pageThrough(page, id, top) {
  const panel = page.locator(`#panel-${id}`);
  const total = digits(await panel.locator('.panel-head span').innerText());
  assert.ok(total > top, `${id} needs more than ${top} entries to paginate`);
  assert.equal(await panel.locator('button.bar').count(), top, `${id} lists only its top ${top} first`);
  await panel.getByRole('button', { name: /^Show all / }).click();
  assert.equal(await page.evaluate(() => document.activeElement.dataset.focusId), `action:${id}:collapse`, 'Keyboard focus stays inside the panel');
  const keys = new Set();
  const labels = [];
  for (let start = 0; start < total; start += 10) {
    assert.equal(await panel.locator('.panel-foot .muted').innerText(), `${start + 1}-${Math.min(start + 10, total)} of ${total}`);
    const rows = await panel.locator('button.bar').evaluateAll(buttons => buttons.map(button => ({
      key: button.dataset.focusId,
      label: button.querySelector('.label').firstChild.textContent
    })));
    assert.equal(rows.length, Math.min(10, total - start));
    for (const row of rows) {
      keys.add(row.key);
      labels.push(row.label);
    }
    assert.equal(await panel.getByRole('button', { name: 'Previous', exact: true }).isDisabled(), start === 0);
    assert.equal(await panel.getByRole('button', { name: 'Next', exact: true }).isDisabled(), start + 10 >= total);
    if (start + 10 < total) await panel.getByRole('button', { name: 'Next', exact: true }).click();
  }
  assert.equal(keys.size, total, `Every ${id} entry appears exactly once across the pages`);
  await panel.getByRole('button', { name: `Show top ${top}`, exact: true }).click();
  assert.equal(await panel.locator('button.bar').count(), top);
  return labels;
}

// Needs a report with more entries per dimension than the dashboard shows at once.
async function variedChecks(page, report) {
  await page.goto(reportUrl(report));
  await assertView(page, 'overview');
  assert.match(await page.locator('.metric').nth(4).innerText(), /without location/, 'Resources without a location are called out');
  assert.ok(await page.locator('#panel-category button.tile').count() > 8, 'Every category is listed as a tile');
  assert.equal(await page.locator('#panel-category .panel-foot').count(), 0, 'Categories are not paginated');
  await pageThrough(page, 'type', 8);
  await pageThrough(page, 'group', 8);
  await pageThrough(page, 'subscription', 6);
  assert.ok((await pageThrough(page, 'region', 6)).includes('(not reported)'), 'Resources without a location stay countable');

  const types = page.locator('#panel-type');
  const total = digits(await types.locator('.panel-head span').innerText());
  await types.getByRole('button', { name: /^Show all / }).click();
  await types.getByRole('button', { name: 'Next', exact: true }).click();
  const outside = types.locator('button.bar').nth(2);
  const outsideLabel = await outside.locator('.label').evaluate(node => node.firstChild.textContent);
  await outside.click();
  assert.equal(await types.locator('button.bar').count(), 9, 'A selection outside the top rows stays visible');
  assert.equal(await types.locator('button.bar[aria-pressed=true] .label').evaluate(node => node.firstChild.textContent), outsideLabel);
  assert.equal(await types.getByRole('button', { name: `Show all ${total}`, exact: true }).count(), 1, 'Panels collapse when the filters change');
  await page.locator('#clear-filters').click();

  const subscriptions = page.locator('#panel-subscription');
  const chosen = await subscriptions.locator('button.bar .label').first().innerText();
  await subscriptions.locator('button.bar').first().click();
  const siblings = await page.locator('#panel-group button.bar small').allInnerTexts();
  assert.ok(siblings.length > 0 && siblings.every(name => name === chosen), 'Resource groups follow the selected subscription');
  assert.ok(await subscriptions.locator('button.bar').count() >= 6, 'The selected panel keeps listing its alternatives');
  await page.locator('#clear-filters').click();

  const nodes = await page.evaluate(() => document.querySelectorAll('#view-overview *').length);
  assert.ok(nodes < 600, `The dashboard stays small however many resources exist (${nodes} elements)`);
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `No horizontal overflow at ${width}px`);
  }
  await page.setViewportSize({ width: 1280, height: 720 });
}

async function main() {
  const [demoReport, adversarialReport, variedReport] = process.argv.slice(2).map(argument => argument === '-' ? undefined : argument);
  if (!demoReport) throw new Error('Usage: node tests\\BrowserSmoke.cjs <demo-report.html> [adversarial-report.html|-] [varied-report.html]');
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const context = await browser.newContext({ offline: true, acceptDownloads: true });
    const errors = [];
    const requests = [];
    const watch = page => {
      page.on('pageerror', error => errors.push(error.message));
      page.on('request', request => {
        if (/^https?:/i.test(request.url())) requests.push(request.url());
      });
      return page;
    };
    const page = watch(await context.newPage());
    await page.goto(reportUrl(demoReport));
    const count = await page.evaluate(() => JSON.parse(document.getElementById('inventory-data').textContent).resources.length);
    assert.ok(count >= 10);
    assert.equal(await page.evaluate(() => navigator.onLine), false);
    await assertView(page, 'overview');
    assert.equal(await page.locator('#resource-rows > tr').count(), Math.min(50, count));
    assert.equal(await page.locator('#group-table tbody tr').count(), 0, 'Groups are built when their tab is first opened');
    assert.equal(await page.locator('#diagram svg').count(), 0, 'Diagrams must remain lazy');
    assert.equal(Number((await page.locator('.metric strong').first().innerText()).replace(/\D/g, '')), count);
    assert.match(await page.locator('.metric').nth(2).innerText(), /1 without resources/, 'Empty groups are called out on the dashboard');
    await drillDown(page, count);
    await searchChip(page);
    await assertOnlyIconImages(page);

    await openView(page, 'resources');
    await page.locator('#search').fill('demo-vm');
    assert.equal(await page.locator('#resource-rows > tr').count(), 1);
    await page.locator('#search').fill('');
    await page.locator('#type-filter').selectOption('microsoft.network/virtualnetworks');
    assert.equal(await page.locator('#resource-rows > tr').count(), 1);
    await page.locator('#type-filter').selectOption('');
    if (count > 50) {
      const first = await page.locator('#resource-rows > tr').first().innerText();
      await page.locator('#next').click();
      assert.notEqual(await page.locator('#resource-rows > tr').first().innerText(), first);
    }
    await page.locator('#search').fill('demo-widget');
    await page.locator('#resource-rows summary').click();
    assert.equal(await page.locator('#resource-rows img').count(), 0, 'Tag HTML must remain text');
    assert.equal(await page.evaluate(() => Boolean(globalThis.inventoryInjection)), false);
    await page.locator('#reset-filters').click();
    assert.equal(await page.locator('#search').inputValue(), '');
    assert.equal(await page.locator('#reset-filters').isDisabled(), true);

    await openView(page, 'groups');
    await page.locator('#group-table tbody tr').first().waitFor();
    assert.match(await page.locator('#group-table').innerText(), /demo-empty/);
    await tabNavigation(page);
    await printLayout(page);
    await deepLink(context, watch, demoReport);

    await openView(page, 'architecture');
    await waitForDiagram(page, 'Tenant overview');
    assert.ok(await page.locator('#diagram g.icon-shape').count() > 0, 'Azure icons must render as diagram nodes');
    await assertOnlyIconImages(page);
    const subscription = '11111111-1111-1111-1111-111111111111';
    assert.equal(await page.locator('#diagram-group').isDisabled(), true, 'Group filter waits for a subscription');
    await page.locator('#diagram-subscription').selectOption(subscription);
    await waitForDiagram(page, 'Demo subscription | group overview');
    assert.equal(await page.locator('#diagram-resource').isDisabled(), true, 'Resource filter waits for a group');
    await page.locator('#diagram-group').selectOption(`${subscription}|demo-network`);
    await waitForDiagram(page, 'demo-network | resources');
    const compact = await page.locator('#diagram > svg').textContent();
    assert.match(compact, /Subnet: app/, 'Subnets are drawn as containers');
    assert.match(compact, /NSG: demo-nsg/, 'Compact view shows NSG associations as details');
    assert.match(compact, /demo-pip/, 'A merged public IP stays visible as a detail');
    const compactNodes = await page.locator('#diagram g.icon-shape').count();
    await page.locator('#diagram-style').selectOption('detailed');
    await waitForDiagram(page, 'demo-network | resources');
    assert.ok(await page.locator('#diagram g.icon-shape').count() > compactNodes, 'Detailed view draws merged resources separately');
    const labels = await page.locator('#diagram .edgeLabel').allTextContents();
    assert.ok(labels.some(label => label.includes('NSG')), 'Connection labels must be human-readable');
    assert.ok(labels.some(label => label.includes('public IP')), 'Detailed view draws the public IP link');
    assert.ok(labels.every(label => !/#\d+;/.test(label)), 'Connection labels must not display entity syntax');
    assert.match(await page.locator('#edge-evidence').textContent(), /22222222-2222-2222-2222-222222222222/);
    assert.match(await page.locator('#edge-evidence').textContent(), /routetables\/referenced-only-routes/i, 'Embedded-subnet relationships must not disappear when both endpoints lack resource rows');
    await page.locator('#diagram-style').selectOption('compact');
    await waitForDiagram(page, 'demo-network | resources');
    const vnetId = await page.evaluate(() => JSON.parse(document.getElementById('inventory-data').textContent).resources.find(resource => resource.name === 'demo-vnet').id);
    await page.locator('#diagram-resource').selectOption(vnetId);
    await waitForDiagram(page, 'demo-vnet | direct links');
    assert.match(await page.locator('#edge-evidence').textContent(), /routetables\/referenced-only-routes/i);
    const tenantId = await page.evaluate(() => JSON.parse(document.getElementById('inventory-data').textContent).tenantId);
    const viewExport = await downloadDrawio(page, '#export-view');
    assert.equal(viewExport.filename, `azure-architecture-${tenantId}-demo-vnet.drawio`);
    assert.equal(viewExport.pages, 1);
    assert.ok(viewExport.resourceIds.includes(vnetId), 'Exported shapes keep their Azure resource ID');
    const tenantExport = await downloadDrawio(page, '#export-tenant');
    assert.equal(tenantExport.filename, `azure-architecture-${tenantId}-tenant.drawio`);
    assert.equal(tenantExport.pages, 4, 'Tenant export holds the overviews and one page per non-empty group');
    assert.match(await page.locator('#export-status').textContent(), /with 4 pages/);
    await page.locator('#diagram-subscription').selectOption('');
    await waitForDiagram(page, 'Tenant overview');
    assert.equal(await page.locator('#diagram-group').isDisabled(), true, 'Clearing the subscription resets dependent filters');

    if (adversarialReport) {
      const expected = [await appStructure(page, 'compact'), await appStructure(page, 'detailed')];
      await page.goto(reportUrl(adversarialReport));
      await openView(page, 'resources');
      await page.locator('#search').fill('demo-widget');
      assert.match(await page.locator('#resource-rows').innerText(), /demo-widget "\] --> injected\["bad"\]/, 'Malicious names render as literal text in the table');
      await page.locator('#resource-rows summary').click();
      assert.equal(await page.locator('#resource-rows img').count(), 0);
      await openView(page, 'architecture');
      await waitForDiagram(page, 'Tenant overview');
      assert.deepEqual([await appStructure(page, 'compact'), await appStructure(page, 'detailed')], expected,
        'Malicious names must not change the diagram structure');
      assert.match(await page.locator('#diagram > svg').textContent(), /demo-widget "\] --> injected/, 'Malicious names render as literal text');
      await assertOnlyIconImages(page);
      const hostile = await downloadDrawio(page, '#export-view');
      assert.ok(hostile.labels.some(label => label.includes('demo-widget "] --> injected["bad"]')), 'draw.io labels keep hostile names as escaped text');
      assert.equal(await page.evaluate(() => Boolean(globalThis.inventoryInjection)), false);
    }
    if (variedReport) await variedChecks(page, variedReport);
    assert.deepEqual(errors, [], 'No browser script errors');
    assert.deepEqual(requests, [], 'No HTTP(S) requests, including failed attempts');
    console.log(JSON.stringify({
      resources: count, offline: true, httpRequests: requests.length, scriptErrors: errors.length,
      diagrams: 'passed', adversarial: Boolean(adversarialReport), varied: Boolean(variedReport)
    }));
  } finally {
    await browser.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
