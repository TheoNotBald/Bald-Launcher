'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const workspace = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(workspace, 'bald_launcher_v7.html'), 'utf8').replace(/\r\n/g, '\n');
const main = fs.readFileSync(path.join(workspace, 'main.js'), 'utf8');
const preload = fs.readFileSync(path.join(workspace, 'preload.js'), 'utf8');
const horizonProcess = fs.readFileSync(path.join(workspace, 'src', 'shared', 'horizon-process.js'), 'utf8');

function extractFunction(startMarker, endMarker) {
  const start = html.indexOf(startMarker);
  const end = html.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `Could not find function ${startMarker}`);
  return html.slice(start, end);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]);
}

test('Horizon and Java reuse the shared profile list and profile detail structure', () => {
  assert.match(html, /id="panel-home"/);
  assert.match(html, /id="profileGrid"/);
  assert.match(html, /id="panel-profile"/);
  assert.match(html, /class="pd-tabs"/);
  assert.match(html, /id="pdtab-content"[^>]*>Content/);
  assert.match(html, /id="pdtab-settings"[^>]*>Settings/);
  assert.match(html, /id="pdtab-logs"[^>]*>Logs/);
  assert.match(html, /id="javaProfileContent"/);
  assert.match(html, /id="horizonProfileContent"/);
  assert.match(html, /id="javaProfileSettings"/);
  assert.match(html, /id="horizonProfileSettings"/);
  assert.doesNotMatch(html, /id="panel-horizon"/);
  assert.doesNotMatch(html, /id="horizonProfileLibrary"/);
  assert.match(html, /Import Java world/);
  assert.match(html, /id="horizonProfileSettings"[\s\S]*?Import Java world/);
  assert.match(html, /id="npHorizonMinecraftVersion" disabled[\s\S]*?<option value="26\.3" selected>26\.3<\/option>/);
  assert.match(html, /id="horizonProfileVersion"[^>]*disabled[\s\S]*?<option value="26\.3" selected>26\.3<\/option>/);
  assert.match(html, /id="pdPlayButton"/);
  assert.match(html, /class="add-content-btn" type="button" onclick="openBrowseModal\(\)"/);
  assert.match(html, /id="horizonInstalledContentSearch"/);
  assert.match(html, /id="horizonInstalledContentList"/);
  assert.match(html, /id="horizonBrowseWorldRow"/);
  assert.match(html, /if \(horizonModeActive\) \{\s*await runHorizonBrowseSearch\(\);/);
});

test('Horizon cards use the shared grid with profile metadata and no Java loader chips', () => {
  const grid = { innerHTML: '' };
  const count = { textContent: '' };
  const search = { value: '' };
  const sort = { value: 'recent' };
  const context = {
    HORIZON_MINECRAFT_VERSION: '26.3',
    horizonInstances: [],
    horizonRunningInstanceIds: new Set(),
    horizonSelectedInstanceId: '',
    state: { settings: {} },
    document: {
      getElementById(id) {
        return ({ profileGrid: grid, profileCount: count, profileSearch: search, profileSort: sort })[id] || null;
      },
    },
    escapeHtml,
    escapeJsString(value) { return String(value || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'"); },
    formatProfilePlaytime: milliseconds => `${milliseconds / 3600000}h`,
    formatProfileLastPlayed: timestamp => timestamp ? 'Recently' : 'Never',
  };
  const renderer = extractFunction('function renderHorizonInstances(', '\nasync function openHorizonProfile(');
  vm.runInNewContext(`${renderer}\nrenderHorizonInstances(${JSON.stringify([
    { id: 'alpha', name: 'Alpha', kind: 'own', version: '26.3', playedSecs: 3600, lastPlayedAt: 123 },
    { id: 'beta', name: '<img src=x>', kind: 'imported', version: '26.2', playedSecs: 0 },
    { id: 'java', name: 'Java profile', isJava: true },
  ])});`, context);

  assert.equal(count.textContent, '2 of 2 profiles');
  assert.match(grid.innerHTML, /class="profile-card horizon-profile-card/);
  assert.match(grid.innerHTML, /openProfile\('alpha'\)/);
  assert.match(grid.innerHTML, /26\.3/);
  assert.match(grid.innerHTML, /1h/);
  assert.match(grid.innerHTML, /&lt;img src=x&gt;/);
  assert.doesNotMatch(grid.innerHTML, /Java profile/);
  assert.doesNotMatch(grid.innerHTML, /loader-chip|vulkan|sodium/i);
});

test('opening a Horizon profile populates the shared Java profile header and tabs', async () => {
  const nodes = new Map([
    ['pdIcon', { textContent: '' }],
    ['pdName', { textContent: '' }],
    ['pdSub', { textContent: '' }],
    ['horizonProfileName', { value: '' }],
    ['horizonProfileVersion', { value: '' }],
    ['horizonProfileStatus', { hidden: false }],
  ]);
  const calls = [];
  const context = {
    HORIZON_MINECRAFT_VERSION: '26.3',
    horizonInstances: [{ id: 'alpha', name: 'Alpha', kind: 'own', version: '26.3' }],
    horizonSelectedInstanceId: '',
    document: { getElementById: id => nodes.get(id) || null },
    async selectHorizonInstance(id) { context.horizonSelectedInstanceId = String(id); return true; },
    populateHorizonJavaProfiles() {},
    populateHorizonBaldAccounts() {},
    setPdTab(tab) { calls.push(['tab', tab]); },
    showPanel(panel) { calls.push(['panel', panel]); },
    renderPlayButton() { calls.push(['play']); },
    setHorizonProfileTab(tab) { calls.push(['content', tab]); },
  };
  const openFunction = extractFunction('async function openHorizonProfile(', '\nfunction closeHorizonProfile(');
  vm.runInNewContext(`${openFunction}\nopenHorizonProfile('alpha')`, context);
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(nodes.get('pdName').textContent, 'Alpha');
  assert.equal(nodes.get('pdSub').textContent, 'Horizon · 26.3');
  assert.equal(nodes.get('horizonProfileName').value, 'Alpha');
  assert.equal(nodes.get('horizonProfileVersion').value, '26.3');
  assert.deepEqual(calls, [['tab', 'content'], ['panel', 'profile'], ['play'], ['content', 'mod']]);
});

test('shared Play button routes to Horizon Stop while preserving Java launch behavior', () => {
  const button = {
    disabled: false,
    title: '',
    innerHTML: '',
    classes: {},
    classList: { toggle(name, enabled) { button.classes[name] = enabled; } },
  };
  const context = {
    horizonModeActive: true,
    horizonRunningInstanceIds: new Set(['alpha']),
    horizonPrewarmedInstanceIds: new Set(),
    horizonLaunchingInstanceIds: new Set(),
    selectedHorizonInstanceId: () => 'alpha',
    runningProfileIds: new Set(),
    currentProfileId: 'java-profile',
    launchPreparingProfileId: null,
    document: { getElementById: id => id === 'pdPlayButton' ? button : null },
  };
  const renderer = extractFunction('function renderPlayButton(){', '\nfunction renderSynchronizationWorkspace(');
  vm.runInNewContext(`${renderer}\nrenderPlayButton()`, context);
  assert.match(button.innerHTML, /> Stop/);
  assert.equal(button.disabled, false);
  assert.equal(button.classes['stop-btn'], true);

  context.horizonModeActive = false;
  button.innerHTML = '';
  vm.runInNewContext('renderPlayButton()', context);
  assert.match(button.innerHTML, /> Play/);
  assert.equal(button.classes['stop-btn'], false);

  context.horizonModeActive = true;
  context.horizonRunningInstanceIds.clear();
  context.horizonPrewarmedInstanceIds.add('alpha');
  button.innerHTML = '';
  vm.runInNewContext('renderPlayButton()', context);
  assert.match(button.innerHTML, /> Play/);
  assert.equal(button.title, 'Open the prewarmed Horizon window');
});

test('shared Play button click dispatches by mode', () => {
  const calls = [];
  const context = {
    horizonModeActive: true,
    toggleHorizonPlay() { calls.push('horizon'); },
    document: { getElementById: () => ({ textContent: '' }) },
    launchClick() { calls.push('java'); },
  };
  const handler = extractFunction('function handleLaunchButtonClick(){', '\nfunction bindProfileLaunchButton(');
  vm.runInNewContext(`${handler}\nhandleLaunchButtonClick()`, context);
  context.horizonModeActive = false;
  vm.runInNewContext('handleLaunchButtonClick()', context);
  assert.deepEqual(calls, ['horizon', 'java']);
});

test('profile synchronization shows only compatible Horizon destinations and categories', () => {
  const host = { innerHTML: '' };
  const context = {
    state: {
      profiles: [{ id: 'java-source', name: 'Java source', mcVersion: '1.21.11', loader: 'fabric' }],
      profileSync: {
        sourceMode: 'profile',
        sourceProfileId: 'java-source',
        categories: ['options'],
        destinationProfileIds: [],
        horizonDestinationInstanceIds: ['horizon-instance'],
        horizonCategories: ['options', 'keybinds', 'resourcepacks'],
      },
    },
    synchronizationDraft: null,
    horizonInstances: [{ id: 'horizon-instance', name: 'Horizon profile', version: null }],
    HORIZON_MINECRAFT_VERSION: '26.3',
    horizonSyncProfilesLoaded: true,
    horizonSyncProfilesError: '',
    escapeHtml,
    capitalize: value => String(value).charAt(0).toUpperCase() + String(value).slice(1),
    document: { getElementById: id => id === 'synchronizationWorkspace' ? host : null },
  };
  const renderer = extractFunction('function renderSynchronizationWorkspace() {', '\nfunction synchronizationSourceModeChanged(');
  vm.runInNewContext(`${renderer}\nrenderSynchronizationWorkspace()`, context);

  assert.match(host.innerHTML, /Horizon profile/);
  assert.match(host.innerHTML, /data-horizon-sync-destination="horizon-instance"[^>]*checked/);
  assert.match(host.innerHTML, /data-horizon-sync-category="resourcepacks"/);
  assert.match(host.innerHTML, /data-horizon-sync-category="shaders"[^>]*disabled/);
  assert.match(host.innerHTML, /Not available for Horizon profiles/);
});

test('Horizon IPC channels used for worlds and profiles are exposed and registered', () => {
  for (const [channel, preloadPattern, mainPattern] of [
    ['horizon:list-worlds', /listHorizonWorlds:[^,\n]*ipcRenderer\.invoke\('horizon:list-worlds'/, /ipcMain\.handle\('horizon:list-worlds'/],
    ['horizon:import-modpack', /importHorizonModpack:[^,\n]*ipcRenderer\.invoke\('horizon:import-modpack'/, /ipcMain\.handle\('horizon:import-modpack'/],
    ['horizon:launch', /launchHorizon:[^,\n]*ipcRenderer\.invoke\('horizon:launch'/, /ipcMain\.handle\('horizon:launch'/],
    ['horizon:stop', /stopHorizon:[^,\n]*ipcRenderer\.invoke\('horizon:stop'/, /ipcMain\.handle\('horizon:stop'/],
  ]) {
    assert.match(preload, preloadPattern, `${channel} must be exposed by preload`);
    assert.match(main, mainPattern, `${channel} must be registered by main`);
  }
  const importHandler = main.slice(main.indexOf("ipcMain.handle('horizon:import-modpack'"), main.indexOf("ipcMain.handle('horizon:import-java-world'"));
  assert.doesNotMatch(importHandler, /resolveHorizonInstance/, 'modpack import must work before the first profile exists');
});

test('Horizon Play skips repeated preparation for ready builds and verifies first preparation', () => {
  const start = main.indexOf("ipcMain.handle('horizon:launch'");
  const end = main.indexOf("ipcMain.handle('horizon:stop'", start);
  assert.ok(start >= 0 && end > start);
  const handler = main.slice(start, end);
  const selectedBuild = handler.indexOf("runHorizonCli(['versions', '--installed']");
  const warmCheck = handler.indexOf('const warmState = horizonPrewarmedProcesses.get(');
  const warmRestore = handler.indexOf("warmState.windowController.control(warmState.child.pid, 'restore')");
  const preparedCheck = handler.indexOf('isHorizonBuildPrepared(horizonBuild)');
  const accountCheck = handler.indexOf("runHorizonCli(['account', 'list']");
  const preparedGuard = handler.indexOf('if (!prepared)');
  const prepare = handler.indexOf('runHorizonCli(buildHorizonPrepareArgs(horizonBuild)');
  const ownershipGate = handler.indexOf('getHorizonAccountRequirement(accountResult.accounts)');
  const downloadPrepare = handler.indexOf('buildHorizonPrepareArgs(horizonBuild, { download: true })');
  const spawn = handler.indexOf('startHorizonClient(instance, executablePath, roots)');
  assert.ok(warmCheck >= 0 && warmRestore > warmCheck && warmCheck < selectedBuild, 'A ready warm process must be reused before running CLI checks');
  assert.ok(selectedBuild >= 0 && preparedCheck > selectedBuild, 'Horizon must check preparation for its selected installed build');
  assert.ok(accountCheck > selectedBuild && accountCheck < preparedGuard, 'Account state should be read alongside the prepared-state check');
  assert.ok(preparedGuard > preparedCheck && prepare > preparedGuard, 'A prepared build must skip the prepare command');
  assert.ok(ownershipGate > prepare && downloadPrepare > ownershipGate, 'A failed local prepare must check ownership before Mojang download');
  assert.ok(spawn > downloadPrepare, 'Horizon must verify preparation before starting a cold play process');
  assert.match(handler, /if \(!prepared\) \{/);
  assert.match(handler, /preparing: true/);
  assert.match(html, /processState\?\.preparing/);
  assert.match(main, /HORIZON_(?:SIGN_IN|OWNERSHIP)_REQUIRED/);
});

test('Horizon stays hidden during warm-up and starts warming again after Play exits', () => {
  assert.match(main, /function prewarmSelectedHorizonInstance\(instanceIdOverride\)/);
  assert.match(main, /windowController\.control\(0, 'hide-prewarm',\s*\{[\s\S]*?waitForWindow: true/);
  assert.match(main, /function acquireHorizonPrewarmCover\(\)/);
  assert.match(main, /releaseWindowCover = acquireHorizonPrewarmCover\(\)/);
  assert.match(main, /mainWindow\.setAlwaysOnTop\(true\)/);
  assert.match(main, /releaseWindowCover\(\);\s*state\.ready = true/);
  assert.match(main, /state\.activated && !horizonPrewarmShutdownRequested[\s\S]*?prewarmSelectedHorizonInstance\(instance\.id\)/);
  assert.match(main, /warmState\.activated = true/);
  assert.match(main, /state\.activated = true;/);
  assert.match(main, /windowsHide: true/);
  assert.match(horizonProcess, /action == "hide" \? 0 : 6/);
  assert.match(horizonProcess, /SetWinEventHook\(0x8000, 0x800C/);
  assert.match(horizonProcess, /IsHorizonTerminalWindow/);
  assert.match(horizonProcess, /CASCADIA_HOSTING_WINDOW_CLASS/);
  assert.match(horizonProcess, /horizon-rust/);
  assert.match(horizonProcess, /watchHorizonByTitle && IsHorizonGameWindow\(window\)/);
  assert.match(horizonProcess, /wasHidden/);
  assert.match(horizonProcess, /SetForegroundWindow\(window\)/);
  assert.match(horizonProcess, /ActivateWindow\(titledWindow\)/);
  assert.match(main, /windowController\.control\(0, 'hide-terminal', \{ waitForWindow: false \}\)/);
  assert.match(main, /windowController\.control\(0, 'hide-prewarm', \{ waitForWindow: false \}\)/);
  assert.match(main, /warmState\.windowController\.control\(warmState\.child\.pid, 'hide-terminal', \{ waitForWindow: false \}\)/);
  assert.match(main, /windowController\.control\(child\.pid, 'hide-terminal', \{ waitForWindow: false \}\)/);
});

test('closing the launcher requests app shutdown before the window is destroyed', () => {
  const start = main.indexOf("ipcMain.handle('launcher:window-control'");
  const end = main.indexOf("ipcMain.handle('server:playit-status'", start);
  assert.ok(start >= 0 && end > start);
  const handler = main.slice(start, end);
  assert.match(handler, /if \(action === 'close'\) \{\s*app\.quit\(\);\s*return \{ ok: true \};/);
  const shutdown = main.slice(main.indexOf("app.on('before-quit'"), main.indexOf("app.on('window-all-closed'"));
  assert.match(shutdown, /Playit did not stop cleanly; the launcher is closing anyway/);
  assert.match(shutdown, /if \(shouldStopHorizonPrewarm\) await stopHorizonPrewarmedProcesses\(\);/);
  assert.match(shutdown, /quittingAfterManagedShutdown = true;\s*app\.quit\(\);/);
  assert.match(shutdown, /catch \(error\) \{[\s\S]*?Unable to stop Playit cleanly/);
});

test('Horizon Add Content uses the shared browse modal and Horizon catalog/install IPC', () => {
  assert.match(html, /function openBrowseModal\(\)[\s\S]*?browseTypeFilter = horizonModeActive \? 'mod' : 'all'/);
  assert.match(html, /browseSource = 'modrinth';/);
  assert.match(html, /modal\.classList\.toggle\('horizon-mode', horizonModeActive\)/);
  assert.match(html, /browseModalTitle'\)\.textContent = horizonModeActive \? 'Add Horizon content' : 'Add content'/);
  assert.match(html, /function renderBrowseChips\(\)[\s\S]*?if \(horizonModeActive\)[\s\S]*?Native Mods[\s\S]*?Resource Packs[\s\S]*?Shaders/);
  assert.match(html, /searchHorizonMods\?\.\(\{/);
  assert.match(html, /installHorizonMod\?\.\(\{/);
  assert.match(html, /kind,\s*source,\s*instanceId/);
  assert.match(html, /No Horizon-native listings yet[\s\S]*?Browse Modrinth/);
  assert.match(html, /entry\.projectUrl \|\| entry\.page \|\| entry\.url/);
  assert.match(html, /#browseModal\.horizon-mode \.content-attribution\{display:none;\}/);
  const installHandler = main.slice(main.indexOf("ipcMain.handle('horizon:install-mod'"), main.indexOf("ipcMain.handle('horizon:mod-action'"));
  assert.match(installHandler, /timeoutMs: 10 \* 60 \* 1000, maxOutputBytes: 16 \* 1024 \* 1024/);
});

test('Horizon catalog results map Modrinth project fields and expose the project page', async () => {
  const elements = {
    browseSearch: { value: 'sodium' },
    browseStatus: { textContent: '' },
    browseResults: { innerHTML: '' },
    browsePagination: { innerHTML: '' },
  };
  const calls = [];
  const context = {
    browseRequestId: 0,
    browseTypeFilter: 'mod',
    browseSource: 'modrinth',
    browseInstalledModInventory: { warning: '' },
    browseContentByKey: {},
    horizonModeActive: true,
    document: { getElementById: id => elements[id] || null },
    selectedHorizonInstanceId: () => 'horizon',
    launcherBridge: {
      async searchHorizonMods(payload) {
        calls.push(payload);
        return { ok: true, results: [{
          id: 'AANobbMI',
          title: 'Sodium',
          summary: 'A rendering engine replacement.',
          author: 'jellysquid3',
          page: 'https://modrinth.com/mod/sodium',
        }] };
      },
    },
    contentIdentity: value => String(value).toLowerCase(),
    isBrowseContentInstalled: () => false,
    escapeHtml,
    escapeInlineHandlerArg: value => String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'"),
    TYPE_ICON: { mod: 'ti-puzzle' },
  };
  const handler = extractFunction('async function runHorizonBrowseSearch(){', '\nasync function runBrowseSearch(){');
  await vm.runInNewContext(`${handler}\nrunHorizonBrowseSearch()`, context);

  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [{
    query: 'sodium',
    kind: 'mod',
    source: 'modrinth',
    instanceId: 'horizon',
  }]);
  assert.match(elements.browseResults.innerHTML, /Sodium/);
  assert.match(elements.browseResults.innerHTML, /A rendering engine replacement/);
  assert.match(elements.browseResults.innerHTML, /https:\/\/modrinth\.com\/mod\/sodium/);
  assert.match(elements.browseStatus.textContent, /1 Horizon-compatible result/);
});

test('switching Horizon Add Content to data packs loads worlds before searching', async () => {
  const calls = [];
  const context = {
    horizonModeActive: true,
    browseTypeFilter: 'mod',
    browseSource: 'modrinth',
    browsePage: 3,
    browseTotalPages: 4,
    renderBrowseChips() { calls.push('chips'); },
    async loadHorizonBrowseWorlds() { calls.push('worlds-start'); await Promise.resolve(); calls.push('worlds-ready'); },
    async runBrowseSearch() { calls.push('search'); },
  };
  const handler = extractFunction('function setBrowseType(t){', '\nfunction browsePageButtons(){');
  vm.runInNewContext(`${handler}\nsetBrowseType('datapack')`, context);
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(context.browseTypeFilter, 'datapack');
  assert.equal(context.browsePage, 1);
  assert.equal(context.browseTotalPages, 1);
  assert.deepEqual(calls, ['chips', 'worlds-start', 'worlds-ready', 'search']);
});

test('Horizon Add Content dispatches the selected category and world through Horizon IPC', async () => {
  const calls = [];
  const status = { textContent: '' };
  const context = {
    browseContentByKey: {},
    horizonModeActive: true,
    browseSource: 'modrinth',
    document: { getElementById: id => id === 'browseStatus' ? status : id === 'horizonBrowseWorld' ? { value: 'My World' } : null },
    selectedHorizonInstanceId: () => 'alpha',
    launcherBridge: {
      async installHorizonMod(payload) { calls.push(payload); return { ok: true }; },
    },
    async refreshBrowseInstalledMods() { calls.push('inventory'); },
    async runHorizonBrowseSearch() { calls.push('search'); },
    async refreshHorizonInstalledContent() { calls.push('content'); },
  };
  const handler = extractFunction('async function installFromBrowse(id, name, type, iconUrl, source = browseSource){', '\nasync function offerRequiredContentDependencies(');
  await vm.runInNewContext(`${handler}\ninstallFromBrowse('pack-id', 'Pack', 'datapack', '', 'modrinth')`, context);

  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    { instanceId: 'alpha', projectId: 'pack-id', source: 'modrinth', kind: 'datapack', world: 'My World' },
    'inventory',
    'search',
    'content',
  ]);
  assert.match(status.textContent, /Added Pack/);
});

test('Horizon Add Content inventory includes native mods, packs, and modpacks', async () => {
  const context = {
    browseInventoryRequestId: 0,
    browseInstalledModInventory: {},
    horizonModeActive: true,
    selectedHorizonInstanceId: () => 'alpha',
    launcherBridge: {
      async listHorizonMods() {
        return { ok: true, mods: [{ id: 'm1' }], packs: [
          { id: 'r1', kind: 'resource_pack' },
          { id: 's1', kind: 'shader_pack' },
        ] };
      },
      async listHorizonModpacks() { return { ok: true, modpacks: [{ id: 'mp1', name: 'Pack' }] }; },
    },
  };
  const handler = extractFunction('async function refreshBrowseInstalledMods(){', '\nfunction closeBrowseModal(){');
  await vm.runInNewContext(`${handler}\nrefreshBrowseInstalledMods()`, context);

  assert.equal(context.browseInstalledModInventory.loaded, true);
  assert.equal(context.browseInstalledModInventory.scopeKey, 'horizon:alpha');
  assert.deepEqual(Array.from(context.browseInstalledModInventory.mods, item => item.type), ['mod', 'resource', 'shader', 'modpack']);
});

test('Horizon renderer reports IPC failures in its inline status region', () => {
  assert.match(html, /function setHorizonStatus\(message, isError=false, showSignIn=false\)/);
  assert.match(html, /horizon-sign-in-action/);
  assert.match(html, /button\.textContent = 'Sign in'/);
  assert.match(html, /id="horizonProfileStatus"[^>]*role="status"/);
  assert.match(html, /catch \(error\) \{\s*setHorizonStatus\(error\?\.message \|\| String\(error\), true\);/);
  assert.match(html, /id="horizonProfileLogStatus" role="status"/);
});

test('Java profile browser retains its original scrolling layout', () => {
  assert.match(html, /\.profiles-view\{padding:16px;display:flex;flex-direction:column;gap:14px;overflow-y:auto;height:100%;\}/);
  assert.doesNotMatch(html, /profilesView\.scrollTop\s*=\s*0/);
});
