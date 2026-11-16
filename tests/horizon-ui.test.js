'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const workspace = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(workspace, 'bald_launcher_v7.html'), 'utf8').replace(/\r\n/g, '\n');

function createRendererContext(instances = []) {
  const grid = { innerHTML: '' };
  const count = { textContent: '' };
  const launch = { disabled: true };
  const search = { value: '' };
  const sort = { value: 'recent' };
  const tabs = ['overview', 'mod', 'resource', 'shader', 'modpack', 'datapack'].map(tab => ({
    dataset: { horizonTab: tab },
    attributes: {},
    classList: { toggle(name, enabled) { this[name] = enabled; } },
    setAttribute(name, value) { this.attributes[name] = value; },
  }));
  const library = { hidden: false };
  const detail = { hidden: true };
  const detailName = { textContent: '' };
  const detailMeta = { textContent: '' };
  const overviewVersion = { textContent: '' };
  const overviewWorldCount = { textContent: '' };
  const overviewPackCount = { textContent: '' };
  const overviewPage = { hidden: false };
  const modsPage = { hidden: true };
  const packsPage = { hidden: true };
  const modQuery = { placeholder: '' };
  const packQuery = { placeholder: '' };
  const source = { value: 'horizon' };
  const world = { hidden: true, value: '', replaceChildren() { this.options = []; }, appendChild(option) { (this.options ||= []).push(option); } };
  const modeClasses = new Set();
  const modeView = { classList: {
    add(name) { modeClasses.add(name); },
    remove(name) { modeClasses.delete(name); },
    contains(name) { return modeClasses.has(name); },
  } };
  const scroll = { scrollTop: 50 };
  const packSearchControls = { hidden: false };
  const packActions = { hidden: true };
  const importPack = { hidden: false, textContent: '' };
  const importModpack = { hidden: true };
  const addDatapack = { hidden: true };
  const packHelp = { textContent: '' };
  const installedHeading = { textContent: '' };
  const elements = new Map([
    ['horizonProfileGrid', grid],
    ['horizonProfileCount', count],
    ['horizonDetailPlayButton', launch],
    ['horizonProfileSearch', search],
    ['horizonProfileSort', sort],
    ['horizonProfileLibrary', library],
    ['horizonProfileDetail', detail],
    ['horizonDetailName', detailName],
    ['horizonDetailMeta', detailMeta],
    ['horizonOverviewVersion', overviewVersion],
    ['horizonOverviewWorldCount', overviewWorldCount],
    ['horizonOverviewPackCount', overviewPackCount],
    ['horizonOverviewPage', overviewPage],
    ['horizonModsPage', modsPage],
    ['horizonPacksPage', packsPage],
    ['horizonModQuery', modQuery],
    ['horizonPackQuery', packQuery],
    ['horizonModSource', source],
    ['horizonDatapackWorld', world],
    ['horizonPackSearchControls', packSearchControls],
    ['horizonPackActions', packActions],
    ['horizonImportPackButton', importPack],
    ['horizonImportModpackButton', importModpack],
    ['horizonAddDatapackButton', addDatapack],
    ['horizonPackHelp', packHelp],
    ['horizonInstalledHeading', installedHeading],
  ]);
  const context = {
    horizonInstances: [],
    horizonRunningInstanceIds: new Set(),
    horizonSelectedInstanceId: '',
    horizonContentRequestId: 0,
    state: { settings: {} },
    document: {
      getElementById: id => elements.get(id) || null,
      querySelector: selector => selector === '.horizon-mode-view' ? modeView : selector === '.horizon-detail-scroll' ? scroll : null,
      querySelectorAll: selector => selector === '[data-horizon-tab]' ? tabs : [],
    },
    async selectHorizonInstance(id) {
      context.horizonSelectedInstanceId = String(id);
      return true;
    },
    async refreshHorizonInstalledContent() {},
    escapeHtml(value) {
      return String(value).replace(/[&<>"']/g, character => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[character]);
    },
    escapeJsString(value) {
      return String(value || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n');
    },
  };
  const start = html.indexOf('function renderHorizonInstances(');
  const end = html.indexOf('\nasync function loadHorizonStatus()', start);
  assert.ok(start >= 0 && end > start, 'Horizon profile renderer should exist');
  vm.runInNewContext(`${html.slice(start, end)}\nrenderHorizonInstances(${JSON.stringify(instances)});`, context);
  const openStart = html.indexOf('async function openHorizonProfile(');
  const openEnd = html.indexOf('\nasync function loadHorizonStatus()', openStart);
  assert.ok(openStart >= 0 && openEnd > openStart, 'Horizon profile detail actions should exist');
  vm.runInNewContext(html.slice(openStart, openEnd), context);
  return {
    context, grid, count, launch, search, sort, tabs, library, detail,
    detailName, detailMeta, overviewVersion, overviewWorldCount, overviewPackCount, overviewPage, modsPage, packsPage,
    modQuery, packQuery, source, world, modeView, modeClasses, scroll,
    packSearchControls, packActions, importPack, importModpack, addDatapack,
    packHelp, installedHeading,
  };
}

test('Horizon profiles render as searchable, selectable Java-style profile cards', () => {
  const { grid, count, launch, context } = createRendererContext([
    { id: 'alpha', name: 'Alpha', kind: 'own', version: '26.3', playedSecs: 3600 },
    { id: 'beta', name: '<img src=x onerror=alert(1)>', kind: 'imported', version: '26.2', playedSecs: 0 },
    { id: 'java', name: 'Java profile', isJava: true, kind: 'java' },
  ]);

  assert.equal(count.textContent, '2 of 2 profiles');
  assert.match(grid.innerHTML, /class="profile-card horizon-profile-card/);
  assert.match(grid.innerHTML, /onclick="openHorizonProfile\('alpha'\)"/);
  assert.match(grid.innerHTML, /aria-pressed="true"/);
  assert.match(grid.innerHTML, /26\.3 · own/);
  assert.match(grid.innerHTML, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(grid.innerHTML, /<img src=x/);
  assert.doesNotMatch(grid.innerHTML, /Java profile/);
  assert.equal(launch.disabled, false);
  assert.equal(context.horizonSelectedInstanceId, 'alpha');
});

test('opening a Horizon profile shows per-profile mods and content sections', async () => {
  const {
    context, library, detail, detailName, detailMeta, overviewVersion,
    overviewPage, modsPage, packsPage, world, tabs,
    modeClasses, addDatapack, importModpack, packHelp, packActions,
    importPack, scroll,
  } = createRendererContext([
    { id: 'alpha', name: 'Alpha', kind: 'own', version: '26.3', playedSecs: 3600 },
  ]);
  await vm.runInNewContext('openHorizonProfile("alpha")', context);

  assert.equal(library.hidden, true);
  assert.equal(detail.hidden, false);
  assert.equal(modeClasses.has('is-profile-open'), true);
  assert.equal(detailName.textContent, 'Alpha');
  assert.equal(detailMeta.textContent, '26.3 · own');
  assert.equal(overviewVersion.textContent, '26.3');
  assert.equal(overviewPage.hidden, false);

  vm.runInNewContext('setHorizonProfileTab("mod")', context);
  assert.equal(overviewPage.hidden, true);
  assert.equal(modsPage.hidden, false);
  assert.equal(packActions.hidden, true);
  assert.equal(tabs.find(tab => tab.dataset.horizonTab === 'mod').attributes['aria-selected'], 'true');
  assert.match(html, /<button class="modal-btn primary" type="button" onclick="openHorizonModManager\(\)">[\s\S]*?Open mod manager/);
  assert.equal((html.match(/onclick="openHorizonModManager\(\)"/g) || []).length, 1);

  vm.runInNewContext('setHorizonProfileTab("shader")', context);
  assert.equal(packsPage.hidden, false);
  assert.equal(packActions.hidden, false);
  assert.equal(importPack.textContent, 'Add shader pack');

  vm.runInNewContext('setHorizonProfileTab("datapack")', context);
  assert.equal(world.hidden, false);
  assert.equal(addDatapack.hidden, false);
  vm.runInNewContext('setHorizonProfileTab("modpack")', context);
  assert.equal(packActions.hidden, false);
  assert.equal(importModpack.hidden, false);
  assert.match(packHelp.textContent, /separately from profile content/);
  vm.runInNewContext('setHorizonProfileTab("resource")', context);
  assert.equal(importPack.hidden, false);
  assert.equal(importPack.textContent, 'Add resource pack');
  assert.equal(world.hidden, true);
  assert.equal(scroll.scrollTop, 0);
  vm.runInNewContext('closeHorizonProfile()', context);
  assert.equal(modeClasses.has('is-profile-open'), false);
});

test('Horizon profile overview loads world and pack counts for the selected instance', async () => {
  const worldCount = { textContent: '' };
  const packCount = { textContent: '' };
  const status = { textContent: '', isError: false };
  const context = {
    horizonProfileTab: 'overview',
    horizonContentRequestId: 0,
    selectedHorizonInstanceId: () => 'alpha',
    launcherBridge: {
      async listHorizonWorlds(instanceId) {
        assert.equal(instanceId, 'alpha');
        return { ok: true, worlds: [{ name: 'World 1' }, { name: 'World 2' }] };
      },
      async listHorizonMods(instanceId) {
        assert.equal(instanceId, 'alpha');
        return { ok: true, packs: [{ file: 'a.zip' }, { file: 'b.zip' }, { file: 'c.zip' }] };
      },
    },
    document: {
      getElementById(id) {
        return id === 'horizonOverviewWorldCount' ? worldCount
          : id === 'horizonOverviewPackCount' ? packCount
            : null;
      },
    },
    setHorizonStatus(message, isError) {
      status.textContent = message;
      status.isError = isError;
    },
  };
  const start = html.indexOf('async function refreshHorizonInstalledContent(){');
  const end = html.indexOf('\nasync function openHorizonModManager()', start);
  assert.ok(start >= 0 && end > start, 'Horizon overview loader should exist');
  vm.runInNewContext(html.slice(start, end), context);
  await vm.runInNewContext('refreshHorizonInstalledContent()', context);

  assert.equal(worldCount.textContent, '2');
  assert.equal(packCount.textContent, '3');
  assert.equal(status.textContent, '');
});

test('Horizon overview ignores results for a profile that is no longer selected', async () => {
  const worldCount = { textContent: '' };
  const packCount = { textContent: '' };
  let activeInstanceId = 'alpha';
  let resolveWorlds;
  let resolvePacks;
  const context = {
    horizonProfileTab: 'overview',
    horizonContentRequestId: 0,
    selectedHorizonInstanceId: () => activeInstanceId,
    launcherBridge: {
      listHorizonWorlds: () => new Promise(resolve => { resolveWorlds = resolve; }),
      listHorizonMods: () => new Promise(resolve => { resolvePacks = resolve; }),
    },
    document: {
      getElementById(id) {
        return id === 'horizonOverviewWorldCount' ? worldCount
          : id === 'horizonOverviewPackCount' ? packCount
            : null;
      },
    },
    setHorizonStatus() {
      assert.fail('A stale request should not update the profile status.');
    },
  };
  const start = html.indexOf('async function refreshHorizonInstalledContent(){');
  const end = html.indexOf('\nasync function openHorizonModManager()', start);
  vm.runInNewContext(html.slice(start, end), context);
  const request = vm.runInNewContext('refreshHorizonInstalledContent()', context);
  activeInstanceId = 'beta';
  resolveWorlds({ ok: true, worlds: [{ name: 'Old world' }] });
  resolvePacks({ ok: true, packs: [{ file: 'old.zip' }] });
  await request;

  assert.equal(worldCount.textContent, '…');
  assert.equal(packCount.textContent, '…');
});

test('Horizon profile search and sort preserve selection and update empty state', () => {
  const { grid, count, launch, search, sort, context } = createRendererContext([
    { id: 'older', name: 'Older', kind: 'own', version: '26.1', playedSecs: 12 },
    { id: 'newer', name: 'Newer', kind: 'own', version: '26.3', playedSecs: 120 },
  ]);
  search.value = 'new';
  sort.value = 'version';
  vm.runInNewContext('renderHorizonInstances()', context);

  assert.equal(count.textContent, '1 of 2 profiles');
  assert.match(grid.innerHTML, />Newer</);
  assert.doesNotMatch(grid.innerHTML, />Older</);
  assert.equal(context.horizonSelectedInstanceId, 'older');
  assert.equal(launch.disabled, false);

  search.value = 'missing';
  vm.runInNewContext('renderHorizonInstances()', context);
  assert.match(grid.innerHTML, /No Horizon profiles match your search/);
  assert.equal(launch.disabled, true);

  search.value = '';
  context.horizonSelectedInstanceId = '';
  context.state.settings.horizonInstanceId = 'removed-profile';
  context.horizonInstances.find(instance => instance.id === 'newer').selected = true;
  vm.runInNewContext('renderHorizonInstances()', context);
  assert.equal(context.horizonSelectedInstanceId, 'newer');
  assert.equal(launch.disabled, false);
});

test('Horizon automatic installer IPC channel is wired in preload and main', () => {
  const preload = fs.readFileSync(path.join(workspace, 'preload.js'), 'utf8');
  const main = fs.readFileSync(path.join(workspace, 'main.js'), 'utf8');
  assert.match(preload, /ipcRenderer\.invoke\('horizon:ensure-installed'\)/);
  assert.match(main, /ipcMain\.handle\('horizon:ensure-installed'/);
});

test('Horizon account connection uses a selectable Bald Microsoft account and public Horizon status', () => {
  const preload = fs.readFileSync(path.join(workspace, 'preload.js'), 'utf8');
  const main = fs.readFileSync(path.join(workspace, 'main.js'), 'utf8');
  assert.match(html, /id="horizonBaldAccountSelect"[^>]*onchange="loadHorizonStatus\(\)"/);
  assert.match(html, /Bald Launcher will match the Minecraft UUID and select it automatically/);
  assert.match(preload, /getHorizonStatus: accountId => ipcRenderer\.invoke\('horizon:get-status', \{ accountId \}\)/);
  assert.match(preload, /syncHorizonAccount: accountId => ipcRenderer\.invoke\('horizon:sync-account', \{ accountId \}\)/);
  assert.match(main, /runHorizonCli\(\['account', 'list'\]\)/);
  assert.match(main, /runHorizonCli\(\['account', 'select', matchingAccount\.uuid\]\)/);
  assert.match(main, /findMatchingHorizonAccount\(horizonAccounts, baldAccount\.uuid\)/);
  assert.match(main, /ipcMain\.handle\('horizon:sync-account'/);
  assert.match(html, /watchHorizonAccountSync\(\);/);
  assert.match(html, /setInterval\(async \(\)=>/);
});

test('Horizon content tabs use dedicated pack, modpack, and world data-pack operations', () => {
  const preload = fs.readFileSync(path.join(workspace, 'preload.js'), 'utf8');
  const main = fs.readFileSync(path.join(workspace, 'main.js'), 'utf8');
  assert.match(preload, /listHorizonWorlds: instanceId => ipcRenderer\.invoke\('horizon:list-worlds'/);
  assert.match(preload, /listHorizonDatapacks: payload => ipcRenderer\.invoke\('horizon:list-datapacks'/);
  assert.match(preload, /horizonDatapackAction: payload => ipcRenderer\.invoke\('horizon:datapack-action'/);
  assert.match(preload, /importHorizonPack: payload => ipcRenderer\.invoke\('horizon:import-pack'/);
  assert.match(preload, /listHorizonModpacks: \(\) => ipcRenderer\.invoke\('horizon:list-modpacks'/);
  assert.match(main, /runHorizonCli\(\['worlds', 'list', '--instance', instance\.id\]\)/);
  assert.match(main, /runHorizonCli\(\['worlds', 'datapack-list', world, '--instance', instance\.id\]\)/);
  assert.match(main, /runHorizonCli\(\['worlds', 'datapack-add', world, filePath, '--instance', instance\.id\]\)/);
  assert.match(main, /runHorizonCli\(\['packs', 'add', filePath, '--instance', instance\.id\]\)/);
  assert.match(main, /runHorizonCli\(\['modpack', 'list'\]\)/);
});

test('Java profile browser retains its original scrolling layout', () => {
  assert.match(html, /\.profiles-view\{padding:16px;display:flex;flex-direction:column;gap:14px;overflow-y:auto;height:100%;\}/);
  assert.doesNotMatch(html, /profilesView\.scrollTop\s*=\s*0/);
});
