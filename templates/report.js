'use strict';
(() => {
  const data = JSON.parse(document.getElementById('inventory-data').textContent);
  if (data.demo) {
    document.title = 'Azure inventory - synthetic demo';
    document.querySelector('h1').textContent = 'Azure inventory - synthetic demo';
  }
  const byId = new Map(data.resources.map(resource => [resource.id, resource]));
  const subscriptions = new Map(data.subscriptions.map(subscription => [subscription.id, subscription]));
  const pageSize = 50;
  const $ = id => document.getElementById(id);
  const text = value => value == null ? '' : String(value);
  const element = (tag, content, className) => {
    const node = document.createElement(tag);
    if (content !== undefined) node.textContent = text(content);
    if (className) node.className = className;
    return node;
  };
  const subName = id => subscriptions.get(id)?.name || id;
  const groupKey = resource => `${resource.subscriptionId}|${resource.resourceGroup.toLowerCase()}`;
  const groups = new Map(data.resourceGroups.map(group => [
    `${group.subscriptionId}|${group.name.toLowerCase()}`,
    { ...group, resources: [], inferred: false }
  ]));
  for (const resource of data.resources) {
    const key = groupKey(resource);
    if (!groups.has(key)) {
      groups.set(key, {
        id: resource.resourceGroup
          ? `/subscriptions/${resource.subscriptionId}/resourcegroups/${resource.resourceGroup.toLowerCase()}`
          : `/subscriptions/${resource.subscriptionId}`,
        name: resource.resourceGroup || '(subscription-scoped)',
        subscriptionId: resource.subscriptionId, location: '', tags: null, resources: [], inferred: true
      });
    }
    groups.get(key).resources.push(resource);
  }
  const groupList = [...groups.values()].sort((a, b) => a.id.localeCompare(b.id));
  const table = (headers, rows) => {
    const result = element('table');
    const head = element('thead');
    const header = element('tr');
    headers.forEach(value => header.append(element('th', value)));
    head.append(header);
    const body = element('tbody');
    for (const values of rows) {
      const row = element('tr');
      values.forEach(value => row.append(element('td', value)));
      body.append(row);
    }
    result.append(head, body);
    return result;
  };
  const own = (object, key) => object && Object.hasOwn(object, key) ? object[key] : undefined;
  const short = (value, max = 40) => {
    const characters = [...text(value)];
    return characters.length > max ? `${characters.slice(0, max - 1).join('')}\u2026` : characters.join('');
  };
  const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;
  const iconPack = JSON.parse($('azure-icons').textContent);
  const typeMap = JSON.parse($('azure-types').textContent);
  const SUBSCRIPTION_TYPE = 'microsoft.resources/subscriptions';
  const GROUP_TYPE = 'microsoft.resources/subscriptions/resourcegroups';
  const VNET_TYPE = 'microsoft.network/virtualnetworks';
  const SUBNET_TYPE = 'microsoft.network/virtualnetworks/subnets';
  const kindKeys = Object.keys(typeMap.types).filter(key => key.includes('|'));
  const typeCache = new Map();
  function typeInfo(type, kind) {
    const lowerType = text(type).toLowerCase();
    const cacheKey = `${lowerType}|${text(kind).toLowerCase()}`;
    if (typeCache.has(cacheKey)) return typeCache.get(cacheKey);
    const tokens = text(kind).toLowerCase().split(/[,\s]+/).filter(Boolean);
    const kindKey = kindKeys.find(key => key.slice(0, key.indexOf('|')) === lowerType && tokens.includes(key.slice(key.indexOf('|') + 1)));
    let info = own(typeMap.types, kindKey || lowerType);
    if (!info) {
      const category = own(typeMap.providers, lowerType.split('/')[0]) || typeMap.fallback.category;
      const visual = own(typeMap.categories, category) || typeMap.fallback;
      const segment = lowerType.split('/').at(-1);
      info = { name: segment ? segment[0].toUpperCase() + segment.slice(1) : typeMap.fallback.name, category, icon: visual.icon, drawio: visual.drawio };
    }
    if (!own(iconPack.icons, info.icon)) info = { ...info, icon: typeMap.fallback.icon, drawio: typeMap.fallback.drawio };
    typeCache.set(cacheKey, info);
    return info;
  }
  const iconUris = new Map();
  function iconUri(name) {
    if (!iconUris.has(name)) {
      const icon = iconPack.icons[name];
      const box = [icon.left || 0, icon.top || 0, icon.width || iconPack.width, icon.height || iconPack.height].map(Number).join(' ');
      const bytes = new TextEncoder().encode(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${box}" width="20" height="20">${icon.body}</svg>`);
      let binary = '';
      for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
      iconUris.set(name, `data:image/svg+xml;base64,${btoa(binary)}`);
    }
    return iconUris.get(name);
  }
  const safeIcon = name => own(iconPack.icons, name) ? name : typeMap.fallback.icon;

  const EMPTY = '__empty__';
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  // One precomputed row per resource drives the dashboard facets, filters and the table.
  const items = data.resources.map(resource => {
    const info = typeInfo(resource.type, '');
    return {
      resource,
      subscription: resource.subscriptionId,
      group: groupKey(resource),
      category: info.category,
      type: resource.type || EMPTY,
      region: resource.location || EMPTY,
      search: [resource.id, resource.name, resource.type, info.name, info.category, resource.resourceGroup,
        subName(resource.subscriptionId), resource.location, JSON.stringify(resource.sku), JSON.stringify(resource.tags)].join(' ').toLowerCase()
    };
  });
  const populate = (id, values) => {
    for (const [value, label] of values) {
      const option = element('option', label);
      option.value = value;
      $(id).append(option);
    }
  };
  $('scope').textContent = `Tenant ${data.tenantId} | ${data.cloud}`;
  $('status').textContent = data.status === 'Partial' ? 'Partial collection - review warnings' : 'Visible-data collection succeeded';
  $('status').classList.toggle('partial', data.status === 'Partial');
  $('time').textContent = `Started ${data.startedAt} | Finished ${data.finishedAt}`;
  const withResources = new Set(items.map(item => item.subscription));
  const note = (count, one, many = one) => count ? `${count.toLocaleString()} ${count === 1 ? one : many}` : '';
  for (const [label, value, hint] of [
    ['Resources', data.resources.length],
    ['Subscriptions', data.subscriptions.length, note(data.subscriptions.filter(subscription => !withResources.has(subscription.id)).length, 'without resources')],
    ['Resource groups', groupList.length, note(groupList.filter(group => !group.resources.length).length, 'without resources')],
    ['Resource types', new Set(items.map(item => item.type)).size],
    ['Regions', new Set(items.filter(item => item.region !== EMPTY).map(item => item.region)).size,
      note(items.filter(item => item.region === EMPTY).length, 'resource without location', 'resources without location')]
  ]) {
    const card = element('div', undefined, 'metric');
    card.append(element('strong', value.toLocaleString()), element('span', label));
    if (hint) card.append(element('small', hint));
    $('metrics').append(card);
  }
  $('group-badge').textContent = groupList.length.toLocaleString();
  $('relationship-count').textContent = `${data.relationships.length.toLocaleString()} observed ${data.relationships.length === 1 ? 'relationship' : 'relationships'} collected.`;
  if (data.warnings.length) {
    $('warnings-box').hidden = false;
    $('warnings-box').open = data.warnings.length <= 3;
    $('warnings-summary').textContent = `${plural(data.warnings.length, 'collection warning')} - review before relying on this report`;
    for (const warning of data.warnings) {
      $('warnings').append(element('div', `${warning.query} | ${warning.scope}: ${warning.message}`, 'warning'));
    }
  }
  $('subscriptions').append(table(
    ['Subscription', 'ID', 'State', 'Resources', 'Containers', 'References', 'Resource rows'],
    data.subscriptions.map(subscription => [
      subscription.name, subscription.id, subscription.state,
      subscription.queries.Resources, subscription.queries.Containers, subscription.queries.References,
      data.resources.filter(resource => resource.subscriptionId === subscription.id).length
    ])
  ));
  const subscriptionOptions = new Map(data.subscriptions.map(subscription => [subscription.id, subscription.name]));
  for (const item of items) {
    if (!subscriptionOptions.has(item.subscription)) subscriptionOptions.set(item.subscription, subName(item.subscription));
  }
  const unreported = key => key === EMPTY ? '(not reported)' : key;
  const optionsFor = dimension => [...new Set(items.map(item => item[dimension]))]
    .map(key => [key, unreported(key)])
    .sort((a, b) => (a[0] === EMPTY) - (b[0] === EMPTY) || collator.compare(a[1], b[1]));
  populate('subscription-filter', [...subscriptionOptions]);
  populate('group-filter', [...groups.entries()].map(([key, group]) => [key, `${group.name} | ${subName(group.subscriptionId)}`]));
  for (const dimension of ['category', 'type', 'region']) populate(`${dimension}-filter`, optionsFor(dimension));
  populate('diagram-subscription', data.subscriptions.map(subscription => [subscription.id, subscription.name]));

  const DIMENSIONS = ['subscription', 'group', 'category', 'type', 'region'];
  const noFilters = () => ({ query: '', subscription: '', group: '', category: '', type: '', region: '' });
  const filters = noFilters();
  const dashboard = { items, facets: {} };
  let page = 0;
  function renderResources() {
    const start = page * pageSize;
    const matching = dashboard.items;
    const rows = document.createDocumentFragment();
    for (const { resource } of matching.slice(start, start + pageSize)) {
      const row = element('tr');
      const name = element('td');
      const details = element('details', undefined, 'details');
      details.append(element('summary', resource.name || '(unnamed)'));
      details.append(element('p', resource.id, 'mono'));
      details.append(element('p', `Kind: ${resource.kind || '(not reported)'}`));
      details.append(element('pre', `SKU: ${JSON.stringify(resource.sku || {}, null, 2)}\nTags: ${JSON.stringify(resource.tags || {}, null, 2)}`, 'mono'));
      name.append(details);
      row.append(name, ...[
        resource.type, subName(resource.subscriptionId), resource.resourceGroup || '(subscription-scoped)',
        resource.location || '(not reported)', resource.sku?.name || resource.sku?.tier || '(not reported)'
      ].map(value => element('td', value)));
      rows.append(row);
    }
    $('resource-rows').replaceChildren(rows);
    $('resource-badge').textContent = matching.length.toLocaleString();
    $('page-status').textContent = matching.length
      ? `${start + 1}-${Math.min(start + pageSize, matching.length)} of ${matching.length.toLocaleString()} resources`
      : 'No resources match this view.';
    $('previous').disabled = page === 0;
    $('next').disabled = start + pageSize >= matching.length;
  }
  // Every panel counts the resources that pass all filters except its own, so it keeps showing the alternatives to its selection.
  const matches = (item, skip) => DIMENSIONS.every(dimension => dimension === skip || !filters[dimension] || item[dimension] === filters[dimension]);
  const GROUP_ICON = typeInfo(GROUP_TYPE, '').icon;
  const SUBSCRIPTION_ICON = typeInfo(SUBSCRIPTION_TYPE, '').icon;
  const describe = {
    subscription: key => ({ label: subName(key), title: key, icon: SUBSCRIPTION_ICON }),
    group: key => ({ label: groups.get(key)?.name || '(subscription-scoped)', sub: subName(groups.get(key)?.subscriptionId), icon: GROUP_ICON }),
    category: key => ({ label: key, icon: safeIcon(own(typeMap.categories, key)?.icon) }),
    type: key => {
      if (key === EMPTY) return { label: unreported(key), icon: typeMap.fallback.icon };
      const info = typeInfo(key, '');
      return { label: info.name, sub: key, icon: info.icon };
    },
    region: key => ({ label: unreported(key) })
  };
  const dimensionLabels = { subscription: 'Subscription', group: 'Resource group', category: 'Category', type: 'Type', region: 'Region' };
  const PAGE_SIZE = 10;
  const PANELS = [
    { id: 'category', dimension: 'category', title: 'Categories', noun: ['category', 'categories'], top: Infinity, tiles: true },
    { id: 'type', dimension: 'type', title: 'Resource types', noun: ['type', 'types'], top: 8 },
    { id: 'group', dimension: 'group', title: 'Resource groups', noun: ['group', 'groups'], top: 8 },
    { id: 'subscription', dimension: 'subscription', title: 'Subscriptions', noun: ['subscription', 'subscriptions'], top: 6 },
    { id: 'region', dimension: 'region', title: 'Regions', noun: ['region', 'regions'], top: 6 }
  ];
  const panelState = new Map(PANELS.map(panel => [panel.id, { expanded: false, page: 0 }]));
  const nounOf = (count, [one, many]) => `${count.toLocaleString()} ${count === 1 ? one : many}`;

  const byFocusId = id => [...document.querySelectorAll('[data-focus-id]')].find(node => node.dataset.focusId === id && !node.disabled);
  function focusFirst(ids) {
    for (const id of ids) {
      const target = id === 'count' ? $('view-count') : byFocusId(id);
      if (target) {
        target.focus();
        return;
      }
    }
  }
  const iconImage = name => {
    const image = element('img');
    image.alt = '';
    image.src = iconUri(name);
    return image;
  };
  function choice(panel, entry, className) {
    const button = element('button', undefined, className);
    button.type = 'button';
    button.title = entry.title || entry.label;
    button.dataset.focusId = `bar:${panel.id}:${entry.key}`;
    button.setAttribute('aria-pressed', String(filters[panel.dimension] === entry.key));
    button.addEventListener('click', () => {
      const id = `bar:${panel.id}:${entry.key}`;
      const before = button.getBoundingClientRect().top;
      applyFilters({ [panel.dimension]: filters[panel.dimension] === entry.key ? '' : entry.key }, [id, 'count']);
      // Panels above may shrink or grow; keep the clicked row where the pointer is.
      const moved = byFocusId(id);
      if (moved) window.scrollBy(0, moved.getBoundingClientRect().top - before);
    });
    return button;
  }
  function bar(panel, entry, max) {
    const button = choice(panel, entry, 'bar');
    button.style.setProperty('--share', `${entry.count ? Math.max(2, Math.round(entry.count / max * 100)) : 0}%`);
    if (entry.icon) button.append(iconImage(entry.icon));
    const label = element('span', entry.label, 'label');
    if (entry.sub) label.append(element('small', entry.sub));
    button.append(label, element('span', entry.count.toLocaleString(), 'count'));
    return button;
  }
  function tile(panel, entry) {
    const button = choice(panel, entry, 'tile');
    if (entry.icon) button.append(iconImage(entry.icon));
    const body = element('span', undefined, 'tile-text');
    body.append(element('strong', entry.count.toLocaleString()), element('span', entry.label, 'tile-name'));
    button.append(body);
    return button;
  }
  function facetEntries(panel) {
    const counts = dashboard.facets[panel.dimension];
    const selected = filters[panel.dimension];
    const entries = [...counts].map(([key, count]) => ({ key, count, ...describe[panel.dimension](key) }));
    if (selected && !counts.has(selected)) entries.push({ key: selected, count: 0, ...describe[panel.dimension](selected) });
    return entries.sort((a, b) => b.count - a.count || collator.compare(a.label, b.label) || collator.compare(a.key, b.key));
  }
  function renderPanel(panel, focusIds) {
    const state = panelState.get(panel.id);
    const selected = filters[panel.dimension];
    const entries = facetEntries(panel);
    const total = entries.length;
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    state.page = Math.min(state.page, pages - 1);
    let shown = state.expanded
      ? entries.slice(state.page * PAGE_SIZE, (state.page + 1) * PAGE_SIZE)
      : entries.slice(0, panel.top);
    // Keep the active selection visible even when it is outside the top rows.
    const pinned = !state.expanded && selected ? entries.find(entry => entry.key === selected) : undefined;
    if (pinned && !shown.includes(pinned)) shown = [...shown, pinned];
    const head = element('div', undefined, 'panel-head');
    head.append(element('h2', panel.title), element('span', nounOf(total, panel.noun)));
    const parts = [head];
    if (total) {
      const list = element('div', undefined, panel.tiles ? 'tiles' : 'bars');
      list.setAttribute('role', 'group');
      list.setAttribute('aria-label', `Filter by ${panel.noun[0]}`);
      for (const entry of shown) list.append(panel.tiles ? tile(panel, entry) : bar(panel, entry, entries[0].count));
      parts.push(list);
    } else {
      parts.push(element('p', 'No resources in this selection.', 'empty'));
    }
    const foot = element('div', undefined, 'panel-foot');
    const action = (id, label, handler) => {
      const button = element('button', label);
      button.type = 'button';
      button.dataset.focusId = `action:${panel.id}:${id}`;
      button.addEventListener('click', handler);
      return button;
    };
    const go = (expanded, pageIndex, focus) => {
      state.expanded = expanded;
      state.page = pageIndex;
      renderPanel(panel, focus.map(id => `action:${panel.id}:${id}`));
    };
    if (state.expanded && total) {
      const previous = action('previous', 'Previous', () => go(true, state.page - 1, ['previous', 'next', 'collapse']));
      const next = action('next', 'Next', () => go(true, state.page + 1, ['next', 'previous', 'collapse']));
      previous.disabled = state.page === 0;
      next.disabled = state.page >= pages - 1;
      foot.append(
        previous,
        element('span', `${state.page * PAGE_SIZE + 1}-${Math.min((state.page + 1) * PAGE_SIZE, total)} of ${total.toLocaleString()}`, 'muted'),
        next,
        action('collapse', `Show top ${panel.top}`, () => go(false, 0, ['expand']))
      );
    } else if (!state.expanded && total > panel.top) {
      foot.append(action('expand', `Show all ${total.toLocaleString()}`, () => go(true, 0, ['collapse'])));
    }
    if (foot.childNodes.length) parts.push(foot);
    $(`panel-${panel.id}`).replaceChildren(...parts);
    if (focusIds) focusFirst(focusIds);
  }
  function activeFilters() {
    const active = [];
    if (filters.query) active.push({ key: 'query', label: `Search: "${short(filters.query, 60)}"`, title: filters.query });
    for (const dimension of DIMENSIONS) {
      if (!filters[dimension]) continue;
      const entry = describe[dimension](filters[dimension]);
      const value = dimension === 'group' && entry.sub ? `${entry.label} | ${entry.sub}` : entry.label;
      active.push({ key: dimension, label: `${dimensionLabels[dimension]}: ${value}`, title: entry.title || entry.sub || value });
    }
    return active;
  }
  function renderViewBar() {
    const active = activeFilters();
    const total = items.length;
    const shown = dashboard.items.length;
    const nouns = ['resource', 'resources'];
    $('view-count').textContent = !active.length ? `All ${nounOf(total, nouns)}`
      : shown ? `Showing ${shown.toLocaleString()} of ${nounOf(total, nouns)}` : 'No resources match these filters';
    $('view-hint').hidden = active.length > 0;
    $('clear-filters').hidden = !active.length;
    $('reset-filters').disabled = !active.length;
    $('open-resources').textContent = `Browse ${nounOf(shown, nouns)} \u2192`;
    $('open-resources').disabled = shown === 0;
    $('chips').replaceChildren(...active.map(({ key, label, title }) => {
      const chip = element('button', label, 'chip');
      chip.type = 'button';
      chip.title = title;
      chip.setAttribute('aria-label', `Remove filter ${label}`);
      const mark = element('i', '\u2715');
      mark.setAttribute('aria-hidden', 'true');
      chip.append(mark);
      chip.addEventListener('click', () => applyFilters({ [key]: '' }, ['count']));
      return chip;
    }));
  }
  function syncControls() {
    if ($('search').value.trim() !== filters.query) $('search').value = filters.query;
    for (const dimension of DIMENSIONS) $(`${dimension}-filter`).value = filters[dimension];
  }
  function refresh(focusIds) {
    const query = filters.query.toLowerCase();
    const base = query ? items.filter(item => item.search.includes(query)) : items;
    dashboard.items = base.filter(item => matches(item));
    for (const dimension of DIMENSIONS) {
      const counts = new Map();
      for (const item of base) {
        if (matches(item, dimension)) counts.set(item[dimension], (counts.get(item[dimension]) || 0) + 1);
      }
      dashboard.facets[dimension] = counts;
    }
    page = 0;
    renderResources();
    renderViewBar();
    PANELS.forEach(panel => renderPanel(panel));
    if (focusIds) focusFirst(focusIds);
  }
  function applyFilters(changes, focusIds) {
    Object.assign(filters, changes);
    for (const state of panelState.values()) {
      state.expanded = false;
      state.page = 0;
    }
    syncControls();
    refresh(focusIds);
  }
  $('search').addEventListener('input', () => applyFilters({ query: $('search').value.trim() }));
  for (const dimension of DIMENSIONS) {
    $(`${dimension}-filter`).addEventListener('change', event => applyFilters({ [dimension]: event.target.value }));
  }
  $('clear-filters').addEventListener('click', () => applyFilters(noFilters(), ['count']));
  $('reset-filters').addEventListener('click', () => {
    applyFilters(noFilters());
    $('search').focus();
  });
  $('previous').addEventListener('click', () => { page--; renderResources(); });
  $('next').addEventListener('click', () => { page++; renderResources(); });
  refresh();

  let groupPage = 0;
  function renderGroups() {
    const query = $('group-search').value.toLowerCase().trim();
    const matching = groupList.filter(group => `${group.name} ${subName(group.subscriptionId)}`.toLowerCase().includes(query));
    const start = groupPage * pageSize;
    $('group-table').replaceChildren(table(
      ['Group', 'Subscription', 'Region', 'Resources', 'Container metadata', 'Tags'],
      matching.slice(start, start + pageSize).map(group => [
        group.name, subName(group.subscriptionId), group.location || '(not reported)', group.resources.length,
        group.inferred ? 'Not returned; inferred from resource rows' : 'Returned',
        JSON.stringify(group.tags || {})
      ])
    ));
    $('group-page-status').textContent = matching.length ? `${start + 1}-${Math.min(start + pageSize, matching.length)} of ${matching.length} groups` : 'No groups match this view.';
    $('group-previous').disabled = groupPage === 0;
    $('group-next').disabled = start + pageSize >= matching.length;
  }
  $('group-search').addEventListener('input', () => { groupPage = 0; renderGroups(); });
  $('group-previous').addEventListener('click', () => { groupPage--; renderGroups(); });
  $('group-next').addEventListener('click', () => { groupPage++; renderGroups(); });

  const ownerOf = id => {
    let current = id;
    while (current && !byId.has(current)) current = current.slice(0, current.lastIndexOf('/'));
    return current;
  };
  const incident = new Map();
  for (const edge of data.relationships) {
    const owners = new Set([edge.source, edge.target]);
    // Keep references between embedded subresources in their owning resource's view.
    for (const id of [edge.source, edge.target]) {
      const parent = ownerOf(id);
      if (parent) owners.add(parent);
    }
    for (const id of owners) {
      if (!incident.has(id)) incident.set(id, []);
      incident.get(id).push(edge);
    }
  }
  const edgesFor = ids => {
    const result = new Set();
    for (const id of ids) for (const edge of incident.get(id) || []) result.add(edge);
    return [...result];
  };
  const chunks = (items, size) => Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, (index + 1) * size));

  // Derive a type for referenced IDs that have no resource row.
  function idType(id) {
    const parts = text(id).toLowerCase().split('/').filter(Boolean);
    const provider = parts.lastIndexOf('providers');
    if (provider < 0) return parts.length >= 4 ? GROUP_TYPE : SUBSCRIPTION_TYPE;
    const types = [parts[provider + 1]];
    for (let index = provider + 2; index < parts.length; index += 2) types.push(parts[index]);
    return types.join('/');
  }
  const infoOf = id => {
    const row = byId.get(id);
    return row ? typeInfo(row.type, row.kind) : typeInfo(idType(id), '');
  };
  const nameOf = id => byId.get(id)?.name || text(id).split('/').at(-1) || text(id);
  const subscriptionOfId = id => text(id).split('/')[2] || '';
  const groupKeyOfId = id => {
    const parts = text(id).split('/');
    return `${parts[2] || ''}|${parts[3] === 'resourcegroups' ? parts[4] || '' : ''}`;
  };
  const isGroupId = id => /^\/subscriptions\/[^/]+\/resourcegroups\/[^/]+$/.test(id);
  const isSubnetId = id => /\/providers\/microsoft\.network\/virtualnetworks\/[^/]+\/subnets\/[^/]+$/.test(id);
  const vnetOfSubnet = id => id.slice(0, id.lastIndexOf('/subnets/'));
  const friendlyLabels = {
    'App Service plan': 'hosted on', 'private link target': 'private link', 'VNet integration subnet': 'VNet integration',
    'VNet peering reference': 'peering', 'network interface': 'NIC', 'VM reference': 'attached to VM',
    contains: 'child resource', 'contains subnet': 'subnet', subnet: 'in subnet'
  };
  // Edge labels are restricted to plain words so they never carry renderer syntax.
  const edgeLabel = label => text(own(friendlyLabels, label) ?? label).replace(/[^A-Za-z0-9 ()-]/g, ' ');
  const addDetail = (details, label, value) => {
    if (!details.has(label)) details.set(label, new Set());
    details.get(label).add(text(value));
  };
  const detailLines = (details, limit = 3) => {
    const lines = [...details].map(([label, values]) => values.size === 1 ? `${label}: ${[...values][0]}` : `${label}: ${values.size}`);
    return lines.length > limit ? [...lines.slice(0, limit), `+${lines.length - limit} more`] : lines;
  };

  function newScene(title, direction) {
    return { title, direction, containers: new Map(), roots: [], nodes: new Map(), edges: new Map(), evidence: [], used: new Set() };
  }
  function ensureContainer(scene, key, kind, label, type, parentKey) {
    if (!scene.containers.has(key)) {
      const container = { key, kind, label, type, parentKey, children: [], nodes: [], details: new Map() };
      scene.containers.set(key, container);
      if (parentKey) scene.containers.get(parentKey).children.push(container);
      else scene.roots.push(container);
    }
    return scene.containers.get(key);
  }
  function addNode(scene, key, parentKey, { label, info, typeName, resourceId, external = false }) {
    if (!scene.nodes.has(key)) {
      scene.nodes.set(key, {
        key, parentKey, label: short(label), typeName: typeName || info.name, icon: info.icon, drawio: info.drawio,
        resourceId, external, details: new Map()
      });
      scene.containers.get(parentKey).nodes.push(key);
    }
    return scene.nodes.get(key);
  }
  function addEdge(scene, source, target, label, dashed) {
    // Dashed peering links are undirected, so both directions share one line.
    if (dashed && target < source) [source, target] = [target, source];
    const key = `${source}\n${target}\n${label}`;
    if (!scene.edges.has(key)) scene.edges.set(key, { source, target, label, dashed });
    return key;
  }
  const tenantContainer = scene => ensureContainer(scene, 'tenant', 'tenant', `Microsoft Entra tenant: ${data.tenantId}`, 'tenant', null);
  const subscriptionContainer = (scene, subscriptionId, parentKey) =>
    ensureContainer(scene, `sub:${subscriptionId}`, 'subscription', `Subscription: ${subName(subscriptionId)}`, SUBSCRIPTION_TYPE, parentKey);
  const groupContainer = (scene, key) => {
    const [subscriptionId, groupName] = key.split('|');
    const parent = subscriptionContainer(scene, subscriptionId, null);
    const label = groupName ? `Resource group: ${groups.get(key)?.name || groupName}` : 'Subscription-scoped resources';
    return ensureContainer(scene, `rg:${key}`, 'rg', label, GROUP_TYPE, parent.key);
  };
  const outsideContainer = scene => ensureContainer(scene, 'outside', 'outside', 'Outside this view', null, null);
  const isWithin = (scene, key, containerKey) => {
    let current = scene.nodes.get(key)?.parentKey ?? scene.containers.get(key)?.parentKey;
    while (current) {
      if (current === containerKey) return true;
      current = scene.containers.get(current)?.parentKey;
    }
    return false;
  };
  const finish = (scene, edges = [...scene.edges.entries()]) => {
    scene.used = new Set(edges.flatMap(([, edge]) => [edge.source, edge.target]));
    return scene;
  };

  function mergeHosts(scope, considered, pinned, compact) {
    const host = new Map();
    const rep = id => {
      for (let depth = 0; depth < 8 && host.has(id); depth++) id = host.get(id);
      return id;
    };
    if (compact) {
      const merge = (member, target) => {
        if (member !== target && scope.has(member) && scope.has(target) && !pinned.has(member) && !host.has(member) && rep(target) !== member) {
          host.set(member, target);
        }
      };
      for (const edge of considered) {
        if (['network interface', 'OS disk', 'data disk'].includes(edge.label)) merge(edge.target, edge.source);
        else if (edge.label === 'VM reference') merge(edge.source, edge.target);
        else if (edge.label === 'contains' && byId.has(edge.source)) merge(edge.target, edge.source);
      }
      for (const edge of considered) if (edge.label === 'public IP') merge(edge.target, edge.source);
    }
    return { host, rep };
  }

  // Resource-level architecture scene shared by Mermaid and draw.io output.
  function resourceScene({ title, scope, considered, pinned, compact }) {
    const scene = newScene(title, 'LR');
    const { host, rep } = mergeHosts(scope, considered, pinned, compact);
    const reps = [...new Set([...scope].map(rep))];
    const vnets = new Set(reps.filter(id => byId.get(id).type === VNET_TYPE));
    const knownSubnet = id => isSubnetId(id) && vnets.has(vnetOfSubnet(id));
    const subnetIds = [...new Set(considered.flatMap(edge => [edge.source, edge.target]).filter(knownSubnet))].sort();
    const vnetContainers = new Set(subnetIds.map(vnetOfSubnet));
    const placement = new Map();
    for (const edge of considered.filter(item => item.label === 'subnet').sort((a, b) => a.target.localeCompare(b.target))) {
      if (!scope.has(edge.source) || !knownSubnet(edge.target)) continue;
      const node = rep(edge.source);
      const vnet = byId.get(vnetOfSubnet(edge.target));
      if (!placement.has(node) && !vnets.has(node) && groupKey(byId.get(node)) === groupKey(vnet)) placement.set(node, edge.target);
    }
    const placedSubnets = new Set(placement.values());
    const sortKey = id => {
      const row = byId.get(id);
      const info = typeInfo(row.type, row.kind);
      return `${info.category}|${info.name}|${text(row.name).toLowerCase()}|${id}`;
    };
    reps.sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
    for (const id of reps.filter(item => vnetContainers.has(item))) {
      const vnet = byId.get(id);
      ensureContainer(scene, `vnet:${id}`, 'vnet', `Virtual network: ${short(vnet.name)}`, VNET_TYPE, groupContainer(scene, groupKey(vnet)).key);
    }
    const subnetInfo = typeInfo(SUBNET_TYPE, '');
    for (const id of subnetIds) {
      const parent = `vnet:${vnetOfSubnet(id)}`;
      if (placedSubnets.has(id)) ensureContainer(scene, `subnet:${id}`, 'subnet', `Subnet: ${short(nameOf(id))}`, SUBNET_TYPE, parent);
      else addNode(scene, `sn:${id}`, parent, { label: nameOf(id), info: subnetInfo, resourceId: id });
    }
    for (const id of reps.filter(item => !vnetContainers.has(item))) {
      const row = byId.get(id);
      const parent = placement.has(id) ? `subnet:${placement.get(id)}` : groupContainer(scene, groupKey(row)).key;
      const node = addNode(scene, id, parent, { label: row.name || '(unnamed)', info: typeInfo(row.type, row.kind), resourceId: id });
      const sku = row.sku?.name || row.sku?.tier;
      if (sku) addDetail(node.details, 'SKU', short(sku, 24));
    }
    const subnetKey = id => placedSubnets.has(id) ? `subnet:${id}` : `sn:${id}`;
    const detailsOf = key => (scene.nodes.get(key) || scene.containers.get(key)).details;
    const keyOf = id => {
      if (scope.has(id)) {
        const node = rep(id);
        return vnetContainers.has(node) ? `vnet:${node}` : node;
      }
      if (knownSubnet(id)) return subnetKey(id);
      if (isGroupId(id) && scene.containers.has(`rg:${groupKeyOfId(id)}`)) return `rg:${groupKeyOfId(id)}`;
      const key = `ext:${id}`;
      if (!scene.nodes.has(key)) {
        outsideContainer(scene);
        const row = byId.get(id);
        const node = addNode(scene, key, 'outside', { label: nameOf(id), info: infoOf(id), resourceId: id, external: true });
        if (row) addDetail(node.details, 'Resource group', short(row.resourceGroup || '(subscription-scoped)', 28));
        else if (isSubnetId(id)) addDetail(node.details, 'Virtual network', short(nameOf(vnetOfSubnet(id)), 28));
        else addDetail(node.details, 'Status', 'referenced only');
      }
      return key;
    };
    for (const member of host.keys()) {
      addDetail(detailsOf(keyOf(member)), infoOf(member).name, short(nameOf(member), 28));
    }
    for (const edge of considered) {
      const record = (shownAs, key) => scene.evidence.push({ edge, shownAs, key });
      const sourceIn = scope.has(edge.source);
      const targetIn = scope.has(edge.target);
      if (edge.label === 'contains' && !byId.has(edge.source)) { record('Nesting'); continue; }
      if (edge.label === 'contains subnet' && vnetContainers.has(edge.source)) { record('Nesting'); continue; }
      if (edge.label === 'subnet' && sourceIn && placement.get(rep(edge.source)) === edge.target) { record('Nesting'); continue; }
      if (sourceIn && targetIn && rep(edge.source) === rep(edge.target)) { record(`Merged into ${nameOf(rep(edge.source))}`); continue; }
      if (compact && (edge.label === 'NSG' || edge.label === 'route table')) {
        const label = edge.label === 'NSG' ? 'NSG' : 'Route table';
        if (knownSubnet(edge.source)) {
          addDetail(detailsOf(subnetKey(edge.source)), label, short(nameOf(edge.target), 28));
          record(placedSubnets.has(edge.source) ? 'Subnet badge' : 'Node detail');
          continue;
        }
        if (sourceIn || targetIn) {
          const [owner, other, name] = sourceIn ? [edge.source, edge.target, label] : [edge.target, edge.source, 'Associated with'];
          addDetail(detailsOf(keyOf(owner)), name, short(nameOf(other), 28));
          record('Node detail');
          continue;
        }
      }
      let source = keyOf(edge.source);
      let target = keyOf(edge.target);
      let label = edge.label;
      if (source === target || isWithin(scene, source, target) || isWithin(scene, target, source)) { record('Nesting'); continue; }
      if (compact && label === 'VM reference') [source, target, label] = [target, source, 'network interface'];
      record('Edge', addEdge(scene, source, target, edgeLabel(label), label === 'VNet peering reference'));
    }
    return scene;
  }
  function splitEdges(scene, paged) {
    const edges = [...scene.edges.entries()];
    if (!paged || edges.length <= EDGE_PAGE) return [finish(scene, edges)];
    return chunks(edges, EDGE_PAGE).map((slice, index, all) => {
      const keys = new Set(slice.map(([key]) => key));
      return finish({
        ...scene, title: `${scene.title} | links ${index + 1}/${all.length}`, edges: new Map(slice),
        evidence: scene.evidence.filter(row => row.key ? keys.has(row.key) : index === 0)
      }, slice);
    });
  }
  const NODE_PAGE = 40;
  const EDGE_PAGE = 60;
  const OVERVIEW_PAGE = 20;
  function groupScenes(key, compact, paged) {
    const group = groups.get(key);
    if (!group.resources.length) {
      const scene = newScene(`${group.name} | no collected resource rows`, 'LR');
      groupContainer(scene, key);
      return [finish(scene)];
    }
    const all = new Set(group.resources.map(resource => resource.id));
    const considered = edgesFor(all);
    const { rep } = mergeHosts(all, considered, new Set(), compact);
    const members = new Map();
    for (const id of all) {
      if (!members.has(rep(id))) members.set(rep(id), []);
      members.get(rep(id)).push(id);
    }
    const affinity = new Map();
    for (const edge of considered) {
      if (edge.label === 'subnet' && all.has(edge.source) && isSubnetId(edge.target) && !affinity.has(rep(edge.source))) affinity.set(rep(edge.source), edge.target);
    }
    const order = id => {
      const row = byId.get(id);
      if (row.type === VNET_TYPE) return id;
      if (affinity.has(id)) return `${vnetOfSubnet(affinity.get(id))}/${affinity.get(id)}`;
      const info = typeInfo(row.type, row.kind);
      return `~${info.category}|${info.name}|${text(row.name).toLowerCase()}`;
    };
    const reps = [...members.keys()].sort((a, b) => order(a).localeCompare(order(b)) || a.localeCompare(b));
    const pages = paged ? chunks(reps, NODE_PAGE) : [reps];
    return pages.flatMap((slice, index) => {
      const scope = new Set(slice.flatMap(id => members.get(id)));
      const scene = resourceScene({
        title: `${group.name} | resources ${index + 1}/${pages.length} (${plural(group.resources.length, 'resource')})`,
        scope, considered: edgesFor(scope), pinned: new Set(), compact
      });
      return splitEdges(scene, paged);
    });
  }
  function resourceScenes(id, compact, paged) {
    const resource = byId.get(id);
    const edges = incident.get(id) || [];
    const slices = paged && edges.length > EDGE_PAGE ? chunks(edges, EDGE_PAGE) : [edges];
    return slices.map((slice, index) => {
      const scope = new Set([id]);
      for (const edge of slice) {
        for (const endpoint of [edge.source, edge.target]) {
          const owner = ownerOf(endpoint);
          if (owner) scope.add(owner);
        }
      }
      const page = slices.length > 1 ? ` ${index + 1}/${slices.length}` : '';
      return finish(resourceScene({
        title: `${resource.name} | direct links${page} (${plural(edges.length, 'link')})`, scope, considered: slice, pinned: new Set([id]), compact
      }));
    });
  }
  const lazy = factory => {
    let value;
    return () => value ??= factory();
  };
  const linkIndex = keyOf => {
    const links = new Map();
    for (const edge of data.relationships) {
      const source = keyOf(edge.source);
      const target = keyOf(edge.target);
      if (source === target) continue;
      const key = `${source}\n${target}`;
      if (!links.has(key)) links.set(key, []);
      links.get(key).push(edge);
    }
    return links;
  };
  const subscriptionLinks = lazy(() => linkIndex(subscriptionOfId));
  const groupLinks = lazy(() => linkIndex(groupKeyOfId));
  function aggregate(scene, links, onPage, nodeKey, externalKey) {
    for (const [pair, edges] of links) {
      const [source, target] = pair.split('\n');
      if (!onPage.has(source) && !onPage.has(target)) continue;
      const key = addEdge(scene,
        onPage.has(source) ? nodeKey(source) : externalKey(source),
        onPage.has(target) ? nodeKey(target) : externalKey(target),
        plural(edges.length, 'link'), false);
      for (const edge of edges) scene.evidence.push({ edge, shownAs: `Aggregated (${plural(edges.length, 'link')})`, key });
    }
  }
  function tenantScenes(paged) {
    const list = data.subscriptions;
    const pages = paged && list.length ? chunks(list, OVERVIEW_PAGE) : [list];
    const subscriptionInfo = typeInfo(SUBSCRIPTION_TYPE, '');
    return pages.map((slice, index) => {
      const page = pages.length > 1 ? ` ${index + 1}/${pages.length}` : '';
      const scene = newScene(`Tenant overview${page} | ${plural(list.length, 'subscription')}`, 'TB');
      tenantContainer(scene);
      const onPage = new Set(slice.map(subscription => subscription.id));
      for (const subscription of slice) {
        const node = addNode(scene, `subnode:${subscription.id}`, 'tenant', { label: subscription.name, info: subscriptionInfo, resourceId: `/subscriptions/${subscription.id}` });
        addDetail(node.details, 'Resource groups', groupList.filter(group => group.subscriptionId === subscription.id).length);
        addDetail(node.details, 'Resources', data.resources.filter(resource => resource.subscriptionId === subscription.id).length);
        if (Object.values(subscription.queries || {}).some(state => state !== 'Succeeded')) addDetail(node.details, 'Collection', 'partial');
      }
      aggregate(scene, subscriptionLinks(), onPage, id => `subnode:${id}`, id => {
        const key = `ext:sub:${id}`;
        if (!scene.nodes.has(key)) {
          outsideContainer(scene);
          const node = addNode(scene, key, 'outside', { label: subName(id), info: subscriptionInfo, resourceId: `/subscriptions/${id}`, external: true });
          addDetail(node.details, 'Status', subscriptions.has(id) ? 'other page' : 'referenced only');
        }
        return key;
      });
      return finish(scene);
    });
  }
  function subscriptionScenes(subscriptionId, paged) {
    const entries = [...groups.entries()].filter(([, group]) => group.subscriptionId === subscriptionId).sort((a, b) => a[1].id.localeCompare(b[1].id));
    const pages = paged && entries.length ? chunks(entries, OVERVIEW_PAGE) : [entries];
    const groupInfo = typeInfo(GROUP_TYPE, '');
    return pages.map((slice, index) => {
      const scene = newScene(`${subName(subscriptionId)} | group overview ${index + 1}/${pages.length} (${plural(entries.length, 'group')})`, 'TB');
      tenantContainer(scene);
      const container = subscriptionContainer(scene, subscriptionId, 'tenant');
      const onPage = new Set(slice.map(([key]) => key));
      for (const [key, group] of slice) {
        const scoped = !key.split('|')[1];
        const node = addNode(scene, `grp:${key}`, container.key, {
          label: scoped ? '(subscription-scoped)' : group.name, info: groupInfo, resourceId: group.id,
          typeName: scoped ? 'Resources without a group' : undefined
        });
        addDetail(node.details, 'Resources', group.resources.length);
        const categories = new Map();
        for (const resource of group.resources) {
          const category = typeInfo(resource.type, resource.kind).category;
          categories.set(category, (categories.get(category) || 0) + 1);
        }
        [...categories].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 2)
          .forEach(([category, count]) => addDetail(node.details, category, count));
        if (group.inferred) addDetail(node.details, 'Group metadata', 'inferred');
      }
      aggregate(scene, groupLinks(), onPage, key => `grp:${key}`, key => {
        const nodeKey = `ext:grp:${key}`;
        if (!scene.nodes.has(nodeKey)) {
          outsideContainer(scene);
          const [externalSubscription, name] = key.split('|');
          const group = groups.get(key);
          const node = addNode(scene, nodeKey, 'outside', {
            label: group?.name || name || '(subscription-scoped)', info: groupInfo, external: true,
            resourceId: `/subscriptions/${externalSubscription}${name ? `/resourcegroups/${name}` : ''}`
          });
          addDetail(node.details, 'Subscription', short(subName(externalSubscription), 28));
          if (!group) addDetail(node.details, 'Status', 'referenced only');
        }
        return nodeKey;
      });
      return finish(scene);
    });
  }
  function buildScenes({ subscription, group, resource, compact, paged }) {
    if (resource && byId.has(resource)) return resourceScenes(resource, compact, paged);
    if (group && groups.has(group)) return groupScenes(group, compact, paged);
    if (subscription) return subscriptionScenes(subscription, paged);
    return [...tenantScenes(paged), ...data.subscriptions.flatMap(item => subscriptionScenes(item.id, paged))];
  }
  const visibleNode = (scene, key) => !scene.nodes.get(key).external || scene.used.has(key);
  const hasContent = (scene, container) => container.kind !== 'outside' || container.nodes.some(key => visibleNode(scene, key));
  // Split external nodes so links flow in from the left and out to the right.
  function rootsOf(scene) {
    const roots = scene.roots.filter(container => container.kind !== 'outside');
    const outside = scene.containers.get('outside');
    if (!outside) return roots;
    const visible = outside.nodes.filter(key => visibleNode(scene, key));
    const edges = [...scene.edges.values()];
    const targets = new Set(edges.map(edge => edge.target));
    const incoming = new Set(edges.map(edge => edge.source).filter(key => visible.includes(key) && !targets.has(key)));
    const part = (suffix, nodes) => nodes.length ? [{ ...outside, key: `outside:${suffix}`, nodes, children: [] }] : [];
    return [...part('in', visible.filter(key => incoming.has(key))), ...roots, ...part('out', visible.filter(key => !incoming.has(key)))];
  }
  const containerTitle = container => short([container.label, ...detailLines(container.details, 4)].join(' | '), 110);
  const nodeLines = node => [node.label, node.typeName, ...detailLines(node.details)];

  // Encode every untrusted label character as a Mermaid entity, not DSL syntax.
  const mermaidLabel = value => [...text(value)].map(character => {
    const code = character.codePointAt(0);
    return `#${code < 32 ? 32 : code};`;
  }).join('');
  function mermaidSource(scene) {
    const ids = new Map();
    const idFor = key => {
      if (!ids.has(key)) ids.set(key, `${scene.containers.has(key) ? 'c' : 'n'}${ids.size}`);
      return ids.get(key);
    };
    const lines = [
      `flowchart ${scene.direction}`,
      'classDef tenant fill:#ffffff,stroke:#1e3a8a,stroke-width:1.5px,color:#17243b',
      'classDef subscription fill:#ffffff,stroke:#155fbd,stroke-width:1.5px,color:#17243b',
      'classDef rg fill:#f8fafc,stroke:#94a3b8,color:#17243b',
      'classDef vnet fill:#eef5ff,stroke:#2563eb,color:#17243b',
      'classDef subnet fill:#ffffff,stroke:#60a5fa,stroke-dasharray:5 4,color:#17243b',
      'classDef outside fill:#ffffff,stroke:#64748b,stroke-dasharray:6 4,color:#475569',
      'classDef badge fill:#eff6ff,stroke:#bfdbfe,color:#1e3a8a,font-size:12px'
    ];
    const emit = container => {
      if (!hasContent(scene, container)) return;
      const icon = container.type ? `<img src=${iconUri(typeInfo(container.type, '').icon)} width=20 height=20>` : '';
      // Mermaid widens clusters for long titles after layout, so details go in a sized badge node instead.
      lines.push(`subgraph ${idFor(container.key)}["${icon}${mermaidLabel(short(container.label, 60))}"]`);
      if (container.details.size) {
        const badge = idFor(`${container.key}:badge`);
        lines.push(`${badge}["${detailLines(container.details, 4).map(mermaidLabel).join('<br>')}"]`, `class ${badge} badge`);
      }
      container.children.forEach(emit);
      for (const key of container.nodes.filter(item => visibleNode(scene, item))) {
        const node = scene.nodes.get(key);
        lines.push(`${idFor(key)}@{ icon: "azure:${node.icon}", label: "${nodeLines(node).map(mermaidLabel).join('<br>')}", pos: "b", h: 40 }`);
      }
      if (!container.nodes.length && !container.children.length) lines.push(`${idFor(`${container.key}:empty`)}["${mermaidLabel('No collected resource rows')}"]`);
      lines.push('end', `class ${idFor(container.key)} ${container.kind}`);
    };
    rootsOf(scene).forEach(emit);
    for (const edge of scene.edges.values()) {
      lines.push(`${idFor(edge.source)} ${edge.dashed ? '-.-' : '-->'}|"${edge.label}"| ${idFor(edge.target)}`);
    }
    return lines.join('\n');
  }

  const xml = value => text(value)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '\uFFFD')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
    .replace(/\r\n|\r|\n/g, '&#10;').replace(/\t/g, '&#9;');
  const SLOT_W = 200;
  const SLOT_H = 150;
  const ICON = 48;
  const HEADER = 34;
  const PAD = 16;
  const GAP = 24;
  const LEAF_STYLE = 'image;aspect=fixed;html=0;verticalLabelPosition=bottom;verticalAlign=top;labelBackgroundColor=none;fontSize=11;fontColor=#17243B;';
  const EDGE_STYLE = 'edgeStyle=orthogonalEdgeStyle;rounded=1;html=0;endArrow=block;endFill=1;fontSize=10;fontColor=#334155;strokeColor=#475569;labelBackgroundColor=#FFFFFF;';
  const CONTAINER_STYLE = 'rounded=1;arcSize=8;absoluteArcSize=1;html=0;whiteSpace=nowrap;container=1;collapsible=0;recursiveResize=0;verticalAlign=top;align=left;spacingLeft=34;spacingTop=7;fontStyle=1;fontSize=12;fontColor=#17243B;';
  const CONTAINER_COLORS = {
    tenant: 'fillColor=#FFFFFF;strokeColor=#1E3A8A;strokeWidth=2;', subscription: 'fillColor=#FFFFFF;strokeColor=#155FBD;strokeWidth=2;',
    rg: 'fillColor=#F8FAFC;strokeColor=#94A3B8;', vnet: 'fillColor=#EEF5FF;strokeColor=#2563EB;',
    subnet: 'fillColor=#FFFFFF;strokeColor=#60A5FA;dashed=1;', outside: 'fillColor=#FFFFFF;strokeColor=#64748B;dashed=1;fontColor=#475569;'
  };
  function layoutContainer(scene, container) {
    const leaves = container.nodes.filter(key => visibleNode(scene, key));
    const kids = container.children.filter(child => hasContent(scene, child)).map(child => layoutContainer(scene, child));
    const columns = container.kind === 'outside' ? 1 : Math.max(1, Math.min(leaves.length, Math.max(4, Math.ceil(Math.sqrt(leaves.length)))));
    let y = HEADER + PAD;
    const placed = leaves.map((key, index) => ({ key, x: PAD + (index % columns) * SLOT_W, y: y + Math.floor(index / columns) * SLOT_H }));
    if (leaves.length) y += Math.ceil(leaves.length / columns) * SLOT_H;
    const rowLimit = Math.max(columns * SLOT_W, 1000, ...kids.map(kid => kid.w));
    let x = PAD;
    let rowHeight = 0;
    let width = PAD + columns * SLOT_W;
    if (kids.length && leaves.length) y += GAP;
    for (const kid of kids) {
      if (x > PAD && x + kid.w > PAD + rowLimit) {
        x = PAD;
        y += rowHeight + GAP;
        rowHeight = 0;
      }
      kid.x = x;
      kid.y = y;
      x += kid.w + GAP;
      rowHeight = Math.max(rowHeight, kid.h);
      width = Math.max(width, x - GAP);
    }
    y += rowHeight;
    const titleWidth = Math.min(1000, 48 + [...containerTitle(container)].length * 7.5);
    return { container, leaves: placed, kids, w: Math.ceil(Math.max(width + PAD, titleWidth)), h: Math.max(y + PAD, HEADER + 40) };
  }
  const containerResourceId = container => {
    const separator = container.key.indexOf(':');
    const prefix = container.key.slice(0, separator);
    const value = container.key.slice(separator + 1);
    if (prefix === 'vnet' || prefix === 'subnet') return value;
    if (prefix === 'rg') return groups.get(value)?.id || '';
    if (prefix === 'sub') return `/subscriptions/${value}`;
    return '';
  };
  function drawioPage(scene, pageIndex) {
    const cells = [];
    const ids = new Map();
    const idFor = key => {
      if (!ids.has(key)) ids.set(key, `p${pageIndex}-${ids.size + 2}`);
      return ids.get(key);
    };
    const emit = (layout, parentId, x, y) => {
      const container = layout.container;
      const id = idFor(container.key);
      const resourceId = containerResourceId(container);
      const geometry = `<mxGeometry x="${x}" y="${y}" width="${layout.w}" height="${layout.h}" as="geometry"/>`;
      const style = `${CONTAINER_STYLE}${CONTAINER_COLORS[container.kind]}`;
      cells.push(resourceId
        ? `<UserObject id="${id}" label="${xml(containerTitle(container))}" azureResourceId="${xml(resourceId)}"><mxCell style="${style}" vertex="1" parent="${parentId}">${geometry}</mxCell></UserObject>`
        : `<mxCell id="${id}" value="${xml(containerTitle(container))}" style="${style}" vertex="1" parent="${parentId}">${geometry}</mxCell>`);
      if (container.type) {
        cells.push(`<mxCell id="${id}-icon" value="" style="image;aspect=fixed;html=0;image=img/lib/azure2/${xml(typeInfo(container.type, '').drawio)};" vertex="1" connectable="0" parent="${id}"><mxGeometry x="8" y="7" width="20" height="20" as="geometry"/></mxCell>`);
      }
      for (const leaf of layout.leaves) {
        const node = scene.nodes.get(leaf.key);
        const resource = node.resourceId ? ` azureResourceId="${xml(node.resourceId)}"` : '';
        cells.push(`<UserObject id="${idFor(leaf.key)}" label="${xml(nodeLines(node).join('\n'))}"${resource}><mxCell style="${LEAF_STYLE}image=img/lib/azure2/${xml(node.drawio)};" vertex="1" parent="${id}"><mxGeometry x="${leaf.x + (SLOT_W - ICON) / 2}" y="${leaf.y}" width="${ICON}" height="${ICON}" as="geometry"/></mxCell></UserObject>`);
      }
      for (const kid of layout.kids) emit(kid, id, kid.x, kid.y);
    };
    let x = 0;
    let y = 0;
    let rowHeight = 0;
    for (const root of rootsOf(scene).filter(container => hasContent(scene, container))) {
      const layout = layoutContainer(scene, root);
      if (x > 0 && x + layout.w > 2400) {
        x = 0;
        y += rowHeight + 60;
        rowHeight = 0;
      }
      emit(layout, '1', x, y);
      x += layout.w + 60;
      rowHeight = Math.max(rowHeight, layout.h);
    }
    for (const edge of scene.edges.values()) {
      const style = edge.dashed ? `${EDGE_STYLE}dashed=1;endArrow=none;` : EDGE_STYLE;
      cells.push(`<mxCell id="${idFor(`edge\n${edge.source}\n${edge.target}\n${edge.label}`)}" value="${xml(edge.label)}" style="${style}" edge="1" parent="1" source="${idFor(edge.source)}" target="${idFor(edge.target)}"><mxGeometry relative="1" as="geometry"/></mxCell>`);
    }
    return `<diagram id="page-${pageIndex}" name="${xml(short(scene.title, 90))}"><mxGraphModel dx="0" dy="0" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="0" pageScale="1" pageWidth="1600" pageHeight="1200" math="0" shadow="0"><root><mxCell id="0"/><mxCell id="1" parent="0"/>${cells.join('')}</root></mxGraphModel></diagram>`;
  }
  const drawioFile = scenes => `<?xml version="1.0" encoding="UTF-8"?>\n<mxfile host="azure-inventory">${scenes.map(drawioPage).join('')}</mxfile>\n`;
  const slug = value => text(value).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'view';
  function download(filename, content) {
    const url = URL.createObjectURL(new Blob([content], { type: 'application/xml' }));
    const link = element('a');
    link.href = url;
    link.download = filename;
    link.hidden = true;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  let diagramPages = [];
  let diagramPage = 0;
  let renderSerial = 0;
  let rendererReady = false;
  const resetOptions = (id, values, enabled) => {
    const select = $(id);
    select.replaceChildren(select.options[0]);
    select.value = '';
    populate(id, values);
    select.disabled = !enabled;
  };
  const selection = () => ({
    subscription: $('diagram-subscription').value, group: $('diagram-group').value,
    resource: $('diagram-resource').value, compact: $('diagram-style').value !== 'detailed'
  });
  const modeNotes = {
    compact: 'Compact view: network interfaces, OS/data disks and public IPs are drawn inside their VM, child resources are counted in their parent, and NSG/route table associations appear as details when both ends are in view. Choose Detailed to draw every resource and link.',
    detailed: 'Detailed view: every collected resource and observed link in this view is drawn as its own node and edge.'
  };
  async function renderDiagram() {
    const view = diagramPages[diagramPage];
    $('diagram-previous').disabled = diagramPage <= 0;
    $('diagram-next').disabled = diagramPage + 1 >= diagramPages.length;
    $('diagram-mode-note').textContent = modeNotes[selection().compact ? 'compact' : 'detailed'];
    if (!view) {
      $('diagram').replaceChildren(element('p', 'No subscriptions or resources are available for this view.', 'empty'));
      $('diagram-status').textContent = 'No diagram data.';
      $('edge-evidence').replaceChildren();
      return;
    }
    const serial = ++renderSerial;
    $('diagram-status').textContent = `Rendering: ${view.title}`;
    const evidence = [table(
      ['Source ID', 'Target ID', 'Relationship', 'Evidence', 'Shown as'],
      view.evidence.slice(0, 500).map(({ edge, shownAs }) => [edge.source, edge.target, edge.label, edge.evidence, shownAs])
    )];
    if (view.evidence.length > 500) evidence.unshift(element('p', `Showing the first 500 of ${view.evidence.length.toLocaleString()} connections for this view.`, 'muted notice'));
    $('edge-evidence').replaceChildren(...evidence);
    try {
      if (!rendererReady) {
        mermaid.initialize({
          startOnLoad: false, securityLevel: 'strict', theme: 'base', maxTextSize: 900000, htmlLabels: true,
          themeVariables: {
            primaryColor: '#ffffff', primaryBorderColor: '#94a3b8', primaryTextColor: '#17243b', lineColor: '#475569',
            edgeLabelBackground: '#ffffff', clusterBkg: '#f8fafc', clusterBorder: '#94a3b8',
            fontFamily: 'system-ui, "Segoe UI", sans-serif', fontSize: '13px'
          },
          // Styles inside the SVG also apply while Mermaid measures cluster titles.
          themeCSS: '.cluster-label img{vertical-align:-5px;margin-right:6px}.cluster-label span{white-space:nowrap}',
          flowchart: { htmlLabels: true, useMaxWidth: false, nodeSpacing: 36, rankSpacing: 56, padding: 14 }
        });
        mermaid.registerIconPacks([{ name: 'azure', icons: iconPack }]);
        rendererReady = true;
      }
      const { svg } = await mermaid.render(`inventory-diagram-${serial}`, mermaidSource(view));
      if (serial !== renderSerial) return;
      // Only Mermaid's strict-mode SVG output reaches this sink, never inventory HTML.
      $('diagram').innerHTML = svg;
      $('diagram-status').textContent = `${view.title} | diagram ${diagramPage + 1}/${diagramPages.length}`;
    } catch (error) {
      if (serial !== renderSerial) return;
      $('diagram').replaceChildren(element('p', `Diagram rendering failed: ${error.message}. Inventory tables and connection evidence remain available.`, 'warning'));
      $('diagram-status').textContent = 'Diagram failed; the resource inventory is unchanged.';
    }
  }
  function selectDiagramScope() {
    renderSerial++;
    diagramPage = 0;
    diagramPages = buildScenes({ ...selection(), paged: true });
    renderDiagram();
  }
  $('diagram-subscription').addEventListener('change', () => {
    const subscription = $('diagram-subscription').value;
    resetOptions('diagram-group', [...groups.entries()]
      .filter(([, group]) => group.subscriptionId === subscription)
      .sort((a, b) => a[1].name.localeCompare(b[1].name))
      .map(([key, group]) => [key, `${group.name} (${group.resources.length})`]), Boolean(subscription));
    resetOptions('diagram-resource', [], false);
    selectDiagramScope();
  });
  $('diagram-group').addEventListener('change', () => {
    const group = groups.get($('diagram-group').value);
    resetOptions('diagram-resource', group
      ? [...group.resources].sort((a, b) => text(a.name).localeCompare(text(b.name)))
        .map(resource => [resource.id, `${resource.name || '(unnamed)'} | ${typeInfo(resource.type, resource.kind).name}`])
      : [], Boolean(group?.resources.length));
    selectDiagramScope();
  });
  $('diagram-resource').addEventListener('change', selectDiagramScope);
  $('diagram-style').addEventListener('change', selectDiagramScope);
  $('render-diagram').addEventListener('click', () => {
    if (!diagramPages.length) diagramPages = buildScenes({ ...selection(), paged: true });
    renderDiagram();
  });
  $('diagram-previous').addEventListener('click', () => { diagramPage--; renderDiagram(); });
  $('diagram-next').addEventListener('click', () => { diagramPage++; renderDiagram(); });
  function exportDrawio(scenes, scopeName) {
    const filename = `azure-architecture-${slug(data.tenantId)}-${slug(scopeName)}.drawio`;
    download(filename, drawioFile(scenes));
    $('export-status').textContent = `Created ${filename} with ${scenes.length} page${scenes.length === 1 ? '' : 's'}.`;
  }
  $('export-view').addEventListener('click', () => {
    const current = selection();
    const name = current.resource ? byId.get(current.resource)?.name
      : current.group ? groups.get(current.group)?.name
        : current.subscription ? subName(current.subscription) : 'all-subscriptions';
    exportDrawio(buildScenes({ ...current, paged: false }), name);
  });
  $('export-tenant').addEventListener('click', () => {
    const scenes = [...tenantScenes(false)];
    for (const subscription of data.subscriptions) {
      scenes.push(...subscriptionScenes(subscription.id, false));
      for (const [key, group] of [...groups.entries()].sort((a, b) => a[1].id.localeCompare(b[1].id))) {
        if (group.subscriptionId === subscription.id && group.resources.length) scenes.push(...groupScenes(key, true, false));
      }
    }
    exportDrawio(scenes, 'tenant');
  });

  // The tab controller sits last because it touches state (diagramPages) declared above.
  const views = ['overview', 'resources', 'groups', 'architecture'];
  let activeView = '';
  const viewFromHash = () => views.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'overview';
  function showView(name) {
    if (name === activeView) return;
    activeView = name;
    for (const view of views) {
      const selected = view === name;
      $(`tab-${view}`).setAttribute('aria-selected', String(selected));
      $(`tab-${view}`).tabIndex = selected ? 0 : -1;
      $(`view-${view}`).hidden = !selected;
    }
    // Groups and diagrams are built when first needed so the report opens on the dashboard without that work.
    if (name === 'groups') renderGroups();
    if (name === 'architecture' && !diagramPages.length) selectDiagramScope();
  }
  function goTo(name) {
    if (location.hash.slice(1) !== name) location.hash = name;
    showView(name);
    const target = Math.max(0, $(`view-${name}`).offsetTop - $('tabs').offsetHeight - 22);
    if (scrollY > target) scrollTo(0, target);
  }
  for (const view of views) $(`tab-${view}`).addEventListener('click', () => goTo(view));
  addEventListener('hashchange', () => showView(viewFromHash()));
  $('tabs').addEventListener('keydown', event => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const index = views.indexOf(activeView);
    const targets = { ArrowLeft: (index + views.length - 1) % views.length, ArrowRight: (index + 1) % views.length, Home: 0, End: views.length - 1 };
    if (!Object.hasOwn(targets, event.key)) return;
    event.preventDefault();
    const next = views[targets[event.key]];
    goTo(next);
    $(`tab-${next}`).focus();
  });
  $('open-resources').addEventListener('click', () => goTo('resources'));
  showView(viewFromHash());
})();
