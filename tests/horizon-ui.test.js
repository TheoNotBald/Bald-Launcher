'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const AdmZip = require('adm-zip');

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
  assert.match(html, /id="pdtab-logs"[^>]*>Logs/);
  assert.match(html, /openProfileSettingsModal\(\)/);
  assert.match(html, /id="profileSettingsModal"/);
  assert.match(html, /id="exportFormatModal"/);
  assert.match(html, /id="exportFolderModal"/);
  assert.match(html, /id="javaProfileContent"/);
  assert.match(html, /id="horizonProfileContent"/);
  assert.match(html, /id="javaProfileSettings"/);
  assert.match(html, /id="horizonProfileSettings"/);
  assert.doesNotMatch(html, /id="panel-horizon"/);
  assert.doesNotMatch(html, /id="horizonProfileLibrary"/);
  assert.match(html, /Import Java world/);
  assert.match(html, /id="horizonProfileSettings"[\s\S]*?Import Java world/);
  assert.match(html, /id="pdPrewarmEnabled" type="checkbox" onchange="setJavaProfilePrewarm\(this\.checked\)"/);
  assert.match(html, /id="horizonPrewarmEnabled" type="checkbox" onchange="setHorizonProfilePrewarm\(this\.checked\)"/);
  assert.match(html, /id="npHorizonMinecraftVersion" disabled[\s\S]*?<option value="26\.3" selected>26\.3<\/option>/);
  assert.match(html, /id="horizonProfileVersion"[^>]*disabled[\s\S]*?<option value="26\.3" selected>26\.3<\/option>/);
  assert.match(html, /id="pdPlayButton"/);
  assert.match(html, /class="add-content-btn" type="button" onclick="openBrowseModal\(\)"/);
  assert.match(html, /id="horizonInstalledContentSearch"/);
  assert.match(html, /id="horizonInstalledContentList"/);
  assert.match(html, /id="horizonBrowseWorldRow"/);
  assert.match(html, /if \(horizonModeActive\) \{\s*await runHorizonBrowseSearch\(\);/);
});

test('Java and Horizon profile prewarming requires explicit opt-in', () => {
  assert.match(main, /prewarmEnabled: profile\?\.prewarmOptIn === true && profile\?\.prewarmEnabled === true/);
  assert.match(main, /prewarmOptIn: profile\?\.prewarmOptIn === true/);
  assert.match(main, /horizonPrewarmByInstance[\s\S]*?\[instance\.id\]: enabled/);
  assert.match(main, /typeof payload\?\.prewarmEnabled === 'boolean' \? \{ prewarmOptIn: true \} : \{\}/);
  assert.match(html, /const preferredProfileId = currentProfileId \|\| state\.activeProfileId;[\s\S]*?for \(const profile of orderedProfiles\)[\s\S]*?profile\.prewarmEnabled !== true[\s\S]*?prewarming: true/);
  assert.match(html, /prewarmEnabledHorizonInstances\?\.\(\)/);
  const horizonPrewarmCall = html.indexOf('const horizonResult = await launcherBridge?.prewarmEnabledHorizonInstances?.()');
  assert.ok(
    horizonPrewarmCall >= 0
      && horizonPrewarmCall < html.indexOf('const profiles = state.profiles || [];', horizonPrewarmCall),
    'Horizon warm-ups must start before Java warm-ups, without requiring a mode switch',
  );
  assert.match(main, /function prewarmSelectedHorizonInstance\(instanceIdOverride\)/);
  assert.match(main, /if \(launcherState\.settings\?\.horizonPrewarmByInstance\?\.\[instanceId\] !== true\)/);
  const enabledPrewarm = main.slice(
    main.indexOf('async function prewarmEnabledHorizonInstances()'),
    main.indexOf('async function stopHorizonPrewarmedProcesses()', main.indexOf('async function prewarmEnabledHorizonInstances()')),
  );
  assert.match(enabledPrewarm, /ensureHorizonLauncherInstalled\(\)/);
  assert.match(enabledPrewarm, /Object\.values\(instanceSettings\)\.some\(enabled => enabled === true\)/);
  assert.ok(enabledPrewarm.indexOf('ensureHorizonLauncherInstalled()') < enabledPrewarm.indexOf('await getHorizonInstances()'));
});

test('profile inventory refreshes do not poll or synchronously load mod jars', () => {
  assert.doesNotMatch(html, /refreshProfileContent\(currentProfileId, true\);\s*\}\s*\},\s*10000\)/);
  assert.match(main, /async function readInstalledModInventory\(modsFolder\)/);
  assert.match(main, /new AdmZip\(await fs\.promises\.readFile\(filePath\)\)/);
  assert.match(main, /installedModMetadataCache\.get\(cacheKey\)/);
});

test('profile mod inventory caches unchanged jar metadata and refreshes changed jars', async () => {
  const start = main.indexOf('async function readInstalledModInventory(');
  const end = main.indexOf('\nfunction normalizeSettings(', start);
  assert.ok(start >= 0 && end > start, 'Could not find mod inventory implementation');
  let archiveLoads = 0;
  class TrackingAdmZip {
    constructor(buffer) {
      archiveLoads++;
      this.archive = new AdmZip(buffer);
    }

    getEntry(name) {
      return this.archive.getEntry(name);
    }
  }
  const readInventory = vm.runInNewContext(
    `${main.slice(start, end)}\nreadInstalledModInventory`,
    {
      fs,
      path,
      AdmZip: TrackingAdmZip,
      installedModMetadataCache: new Map(),
      console: { warn() {} },
    },
  );
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bald-mod-inventory-'));
  const modsFolder = path.join(root, 'mods');
  const jarPath = path.join(modsFolder, 'sample.jar');
  fs.mkdirSync(modsFolder);
  const writeJar = name => {
    const archive = new AdmZip();
    archive.addFile('fabric.mod.json', Buffer.from(JSON.stringify({ id: 'sample', name, version: '1' })));
    archive.writeZip(jarPath);
  };
  try {
    writeJar('Sample mod');
    assert.equal((await readInventory(modsFolder)).mods[0].name, 'Sample mod');
    await readInventory(modsFolder);
    assert.equal(archiveLoads, 1);
    writeJar('Changed sample mod name');
    assert.equal((await readInventory(modsFolder)).mods[0].name, 'Changed sample mod name');
    assert.equal(archiveLoads, 2);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
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
    ['horizonPrewarmEnabled', { checked: false }],
    ['horizonProfileStatus', { hidden: false }],
  ]);
  const calls = [];
  const context = {
    HORIZON_MINECRAFT_VERSION: '26.3',
    horizonInstances: [{ id: 'alpha', name: 'Alpha', kind: 'own', version: '26.3' }],
    horizonSelectedInstanceId: '',
    state: { settings: {} },
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
  const prepare = handler.indexOf('ensureHorizonBuildPrepared(horizonBuild, prepared, accountResult, sendPreparingStatus)');
  const spawn = handler.indexOf('startHorizonClient(instance, executablePath, roots)');
  assert.ok(warmCheck >= 0 && warmRestore > warmCheck && warmCheck < selectedBuild, 'A ready warm process must be reused before running CLI checks');
  assert.ok(selectedBuild >= 0 && preparedCheck > selectedBuild, 'Horizon must check preparation for its selected installed build');
  assert.ok(accountCheck > selectedBuild && accountCheck < prepare, 'Account state should be read alongside the prepared-state check');
  assert.ok(prepare > preparedCheck, 'The launch path must prepare resources only after checking the selected build');
  assert.match(main, /async function ensureHorizonBuildPrepared[\s\S]*?runHorizonCli\(buildHorizonPrepareArgs\(buildTag\)[\s\S]*?getHorizonAccountRequirement\(accountResult\?\.accounts\)[\s\S]*?buildHorizonPrepareArgs\(buildTag, \{ download: true \}\)/);
  assert.ok(spawn > prepare, 'Horizon must verify preparation before starting a cold play process');
  assert.match(handler, /preparing: true/);
  assert.match(html, /processState\?\.preparing/);
  assert.match(main, /HORIZON_(?:SIGN_IN|OWNERSHIP)_REQUIRED/);
});

test('Horizon stays hidden during warm-up and starts warming again after Play exits', () => {
  assert.match(main, /function prewarmSelectedHorizonInstance\(instanceIdOverride\)/);
  assert.match(main, /while \(Date\.now\(\) < windowDeadline && !result\.windows\)[\s\S]*?windowController\.control\(child\.pid, 'hide-prewarm',\s*\{[\s\S]*?waitForWindow: false[\s\S]*?windowController\.control\(child\.pid, 'mute-process-audio'/);
  assert.match(main, /function restoreHorizonPrewarmAudio\(state\)[\s\S]*?restore-process-audio/);
  assert.match(horizonProcess, /volume = \(ISimpleAudioVolume\)session;/);
  assert.match(horizonProcess, /-notin @\('limit-process-tree', 'mute-process-audio', 'restore-process-audio', 'restore-process-limits'\)/);
  assert.match(main, /emitStatus\(`Prewarm complete: Horizon profile \$\{instance\.name\} is ready\.`\)/);
  assert.match(main, /emitStatus\(`Prewarm complete: Java profile \$\{profile\.name\} is ready\.`\)/);
  assert.match(html, /if \(\/\^Prewarm complete:\/i\.test\(text\)\)[\s\S]*?addNotification\('Prewarm complete'/);
  assert.match(main, /function acquireHorizonPrewarmCover\(\)/);
  assert.match(main, /releaseWindowCover = acquireHorizonPrewarmCover\(\)/);
  assert.match(main, /mainWindow\.setAlwaysOnTop\(true\)/);
  assert.match(main, /mainWindow\.setAlwaysOnTop\(false\)/);
  assert.doesNotMatch(main, /horizonPrewarmCoverWasAlwaysOnTop/);
  assert.match(main, /releaseWindowCover\(\);\s*state\.ready = true/);
  assert.match(main, /state\.activated[\s\S]*?horizonPrewarmByInstance\?\.\[instance\.id\] === true[\s\S]*?prewarmSelectedHorizonInstance\(instance\.id\)/);
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
  assert.match(horizonProcess, /IsJavaToolkitWindow\(window\)/);
  assert.match(horizonProcess, /action == "hide-process"[\s\S]*?hiddenWindows\.Contains\(window\) && !IsJavaToolkitWindow\(window\)/);
  assert.match(horizonProcess, /monitorWindows = action == "hide" \|\| action == "hide-process"/);
  assert.match(main, /windowController\.control\(0, 'hide-terminal', \{ waitForWindow: false \}\)/);
  assert.match(main, /windowController\.control\(0, 'hide-prewarm', \{ waitForWindow: false \}\)/);
  assert.match(main, /warmState\.windowController\.control\(warmState\.child\.pid, 'hide-terminal', \{ waitForWindow: false \}\)/);
  assert.match(main, /windowController\.control\(child\.pid, 'hide-terminal', \{ waitForWindow: false \}\)/);
});

test('prewarm CPU is capped until Play and fresh Minecraft launches are foregrounded', () => {
  assert.match(horizonProcess, /PrewarmCpuRate = 5000/);
  assert.match(horizonProcess, /CpuRateControlEnabled \| CpuRateControlHardCap/);
  assert.match(main, /limit-process-tree/);
  assert.match(main, /restore-process-limits/);
  assert.match(main, /activateMinecraftWindow\(child\.pid, profile\.name\)/);
  assert.match(main, /control\(child\.pid, 'restore', \{\s*timeoutMs: 30_000,\s*waitForWindow: true/);
  assert.match(main, /blurLauncherWindowForGame\(\)/);
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

test('Java profile tabs clear stale Horizon status text', () => {
  const setPdTab = extractFunction('function setPdTab(tab){', '\nconst PROFILE_SYNC_CATEGORIES =');
  const ids = [
    'pdtab-content',
    'pdtab-logs',
    'pd-content-view',
    'pd-logs-view',
    'javaProfileContent',
    'horizonProfileContent',
    'javaProfileSettings',
    'horizonProfileSettings',
    'javaProfileLogs',
    'horizonProfileLogs',
    'horizonProfileStatus',
  ];
  const elements = new Map(ids.map(id => [id, {
    classList: { toggle() {} },
    style: {},
    hidden: false,
    textContent: id === 'horizonProfileStatus' ? 'Showing the ready Horizon window for Horizon…' : '',
  }]));
  const context = {
    document: { getElementById: id => elements.get(id) },
    horizonModeActive: false,
    currentProfileId: null,
    renderProfileLogs() {},
  };
  vm.runInNewContext(`${setPdTab}\nsetPdTab('content')`, context);

  assert.equal(elements.get('horizonProfileStatus').hidden, true);
  assert.equal(elements.get('horizonProfileStatus').textContent, '');
  assert.equal(elements.get('javaProfileContent').hidden, false);
});

test('profile log tabs show only the active mode logs', () => {
  const setPdTab = extractFunction('function setPdTab(tab){', '\nconst PROFILE_SYNC_CATEGORIES =');
  const ids = [
    'pdtab-content',
    'pdtab-logs',
    'pd-content-view',
    'pd-logs-view',
    'javaProfileContent',
    'horizonProfileContent',
    'javaProfileSettings',
    'horizonProfileSettings',
    'javaProfileLogs',
    'horizonProfileLogs',
    'horizonProfileStatus',
  ];
  const elements = new Map(ids.map(id => [id, {
    classList: { toggle() {} },
    style: {},
    hidden: false,
    textContent: '',
  }]));
  const context = {
    document: { getElementById: id => elements.get(id) },
    horizonModeActive: false,
    currentProfileId: null,
    renderProfileLogs() {},
    loadHorizonLogs() {},
  };
  vm.runInNewContext(`${setPdTab}\nsetPdTab('logs')`, context);
  assert.equal(elements.get('javaProfileLogs').style.display, 'flex');
  assert.equal(elements.get('horizonProfileLogs').hidden, true);
  assert.equal(elements.get('horizonProfileLogs').style.display, 'none');

  context.horizonModeActive = true;
  vm.runInNewContext('setPdTab("logs")', context);
  assert.equal(elements.get('javaProfileLogs').hidden, true);
  assert.equal(elements.get('javaProfileLogs').style.display, 'none');
  assert.equal(elements.get('horizonProfileLogs').hidden, false);
  assert.equal(elements.get('horizonProfileLogs').style.display, 'flex');
});

test('profile export UI supports real format selection and folder selection', () => {
  assert.match(html, /profile-settings-modal \.pd-settings-row/);
  assert.match(html, /profile-action-menu \.profile-menu-group-label/);
  assert.doesNotMatch(html, /<div class="profile-menu-group-label">Launch<\/div>/);
  assert.doesNotMatch(html, /runProfileAction\('modpack'\)/);
  assert.doesNotMatch(html, /runProfileAction\('backup'\)/);
  assert.doesNotMatch(html, /runProfileAction\('delete'\)/);
  assert.match(html, /const rect = anchor\?\.\getBoundingClientRect/);
  assert.match(html, /rect\.bottom \+ 6/);
  assert.match(html, /Open mods folder/);
  assert.doesNotMatch(html, /runProfileAction\('edit'\)/);
  assert.doesNotMatch(html, /runProfileAction\('open'\)/);
  assert.match(html, /Select all/);
  assert.match(html, /Deselect all/);
  assert.match(html, /exportFolderSelectionCount/);
  assert.match(html, /getProfileExportInventory/);
  assert.match(html, /onExportProgress/);
  assert.match(html, /notification-progress-track/);
  assert.match(html, /id="pdPrewarmEnabled" type="checkbox"/);
  assert.match(html, /id="pdJavaPath"[^>]*aria-label="Java executable"/);
  assert.match(html, /type="range" class="profile-memory-slider" id="pdMemoryMax"/);
  assert.match(html, /<input type="number" id="pdMemoryMaxInput"[^>]*min="512"[^>]*max="32768"/);
  assert.match(html, /id="ramSlider"[^>]*oninput="updateRam/);
  assert.match(html, /<input type="number" id="ramInput"[^>]*min="512"[^>]*max="32768"/);
  assert.match(html, /min="512" max="32768" value="6144" step="1" id="ramSlider"/);
  assert.match(html, /id="pdMemoryMax"[^>]*min="512"[^>]*max="32768"[^>]*step="1"/);
  assert.match(html, /function formatMemoryValue\(mb\)/);
  assert.match(html, /class="profile-settings-brand-logo" src="build\/bald-launcher-mark\.png"/);
  assert.match(html, /id="profileSettingsContent"><\/div>\s*<footer class="profile-settings-footer" id="javaProfileSettingsFooter">[\s\S]*?onclick="saveProfileSettings\(\)"[\s\S]*?Save changes/);
  assert.match(html, /if \(javaFooter\) javaFooter\.hidden=true/);
  assert.match(html, /if \(javaFooter\) javaFooter\.hidden=false/);
  assert.doesNotMatch(html, /pdInstallationSaveRow|profile-settings-warning|Installation changes rewrite Minecraft files/);
  assert.match(html, /async function saveProfileSettings\(\)[\s\S]*?installationChanged[\s\S]*?await savePdSettings\(\)/);
  assert.doesNotMatch(html, /onclick="saveInstallationSettings|> Save installation<\/button>/);
  assert.doesNotMatch(html, /onclick="savePdSettings\(\)"/);
  assert.match(html, /<div class="server-memory-control">[\s\S]*?type="range" class="setting-slider"/);
  assert.match(html, /aria-label="Server maximum RAM in gigabytes"/);
  assert.match(html, /id="serverJavaPathSelect"/);
  assert.match(html, /bald-launcher-mark\.png/);
  assert.match(main, /ipcMain\.handle\('launcher:get-java-installations'/);
  assert.match(main, /async function discoverJavaInstallations\(\)/);
  assert.match(main, /launcher:get-profile-export-inventory/);
  assert.match(main, /launcher:open-profile-mods-folder/);
  assert.match(main, /launcher:export-progress/);
  assert.match(main, /The exported Modrinth archive is incomplete/);
  assert.match(main, /const realSourcePath = fs\.realpathSync\(sourcePath\)/);
  assert.match(main, /await assertTreeHasNoSymlinks\(sourcePath/);
  assert.doesNotMatch(main, /sourcePath\.startsWith\(path\.resolve\(root\)\)/);
  assert.match(html, /The export did not return a completion result/);
  assert.match(html, /exportProgressNotificationIds\.delete\(exportId\)/);
  assert.match(html, /data-export-format="bald"/);
  assert.match(html, /data-export-format="modrinth"/);
  assert.match(html, /data-export-format="curseforge"/);
  assert.match(html, /data-export-format="prism"/);
  assert.match(html, /data-export-format="lunar"/);
  assert.match(html, /data-export-format="dawn"/);
  assert.match(html, /data-export-format="oneclient"/);
  assert.match(html, /data-export-format="minecraft"/);
  assert.match(html, /build\/export-icons\/modrinth\.png/);
  assert.match(html, /build\/export-icons\/prism\.png/);
  assert.match(html, /build\/export-icons\/oneclient\.png/);
  assert.match(html, /function submitFormatExport\(\)[\s\S]*?launcherBridge\.exportModpack[\s\S]*?launcherBridge\.exportProfile/);
  assert.match(main, /if \(format === 'bald'\)/);
  assert.match(main, /else if \(format === 'curseforge'\)/);
  assert.match(main, /else if \(format === 'prism'\)/);
  assert.match(main, /else if \(format === 'lunar'\)/);
  assert.match(main, /else if \(format === 'dawn'\)/);
  assert.match(main, /else if \(format === 'oneclient'\)/);
  assert.match(main, /else if \(format === 'minecraft'\)/);
});

test('RAM controls keep editable MB values and only snap slider drags near whole GBs', () => {
  const memoryControls = extractFunction('function normalizeMemoryMb(', '\nfunction formatMemoryValue(');
  const memoryFormatter = extractFunction('function formatMemoryValue(', '\nasync function loadProfileJavaInstallations(');
  const elements = {
    pdMemoryMax: { style: { setProperty() {} }, setAttribute(name, value) { this[name] = value; } },
    pdMemoryMaxInput: { value: '' },
    pdMemoryMaxValue: { textContent: '' },
  };
  const context = {
    document: { getElementById: id => elements[id] },
  };
  vm.createContext(context);
  vm.runInContext(`${memoryControls}\n${memoryFormatter}`, context);

  context.updateProfileRamSlider(6100);
  assert.equal(Number(elements.pdMemoryMax.value), 6100);
  assert.equal(Number(elements.pdMemoryMaxInput.value), 6100);
  context.updateProfileRamSlider(1000, true);
  assert.equal(Number(elements.pdMemoryMax.value), 1024);
  context.updateProfileRamInput('5001', true);
  assert.equal(Number(elements.pdMemoryMax.value), 5001);
  assert.equal(Number(elements.pdMemoryMaxInput.value), 5001);
});

test('profile avatars use the selected profile icon instead of launcher branding', () => {
  assert.match(html, /if \(pdIcon\) pdIcon\.textContent = String\(p\.icon/);
  assert.match(html, /getElementById\('profileSettingsIcon'\)\.textContent = String\(profile\.icon/);
  assert.doesNotMatch(html, /pdIcon\) pdIcon\.innerHTML = .*bald-launcher-mark/);
  assert.doesNotMatch(html, /getElementById\('profileSettingsIcon'\)\.innerHTML = .*bald-launcher-mark/);
});

test('Java profile browser retains its original scrolling layout', () => {
  assert.match(html, /\.profiles-view\{padding:16px;display:flex;flex-direction:column;gap:14px;overflow-y:auto;height:100%;\}/);
  assert.doesNotMatch(html, /profilesView\.scrollTop\s*=\s*0/);
});
