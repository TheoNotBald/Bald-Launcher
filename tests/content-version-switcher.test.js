const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { normalizeContentLoader } = require('../src/content/content-provider-utils');

const html = fs.readFileSync(path.join(__dirname, '..', 'bald_launcher_v7.html'), 'utf8').replace(/\r\n/g, '\n');

test('shared content loader normalization is available to installation and version lookup paths', () => {
  assert.equal(normalizeContentLoader('Fabric'), 'fabric');
  assert.equal(normalizeContentLoader(' Neo Forge '), 'neoforge');
  assert.equal(normalizeContentLoader('neo_forge'), 'neoforge');
  assert.equal(normalizeContentLoader('Paper'), 'paper');
  assert.equal(normalizeContentLoader(null), '');

  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  assert.match(main, /normalizeContentLoader,\s*\n\s*selectCurseForgeFile/);
  assert.match(main, /const normalizedLoader = normalizeContentLoader\(loader\)/);
  assert.match(main, /getModrinthVersions\(projectId, mcVersion, normalizedLoader, type/);
  assert.match(main, /const loader = String\(server/);
  assert.doesNotMatch(main, /function getVulkanDatabaseEntry[\s\S]*?function normalizeContentLoader/);
});

test('cached Minecraft version manifest keeps snapshots and pre-releases out of the version list', async () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  const start = main.indexOf('async function getVersionManifest()');
  const end = main.indexOf('\nfunction parseVersion(', start);
  assert.ok(start >= 0 && end > start, 'version manifest loader should exist');
  const handler = main.slice(start, end);
  const now = Date.now();
  const context = {
    versionManifestCache: [
      { id: '1.21.1', type: 'release' },
      { id: '26.4-snapshot-3', type: 'snapshot' },
      { id: '1.22-pre1', type: 'old_beta' },
    ],
    versionManifestFetchedAt: now - 1000,
    VERSION_CACHE_TTL_MS: 60_000,
    normalizeVersionList: versions => [...new Set(versions.map(version => version.id))],
    Date: { now: () => now },
  };
  const result = await vm.runInNewContext(`${handler}\ngetVersionManifest()`, context);
  assert.deepEqual(Array.from(result), ['1.21.1']);
});

test('server delete and folder-selection controls are connected through the preload bridge', () => {
  const preload = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  assert.match(preload, /deleteServer: serverId => ipcRenderer\.invoke\('launcher:delete-server', \{ serverId \}\)/);
  assert.match(preload, /chooseServerFolder: serverId => ipcRenderer\.invoke\('server:choose-folder', \{ serverId \}\)/);
  assert.match(main, /ipcMain\.handle\('launcher:delete-server'/);
  assert.match(main, /ipcMain\.handle\('server:choose-folder'[\s\S]*?Stop the server before changing its folder/);
  assert.match(html, /async function chooseServerFolder\(serverId\)[\s\S]*?catch \(error\)[\s\S]*?alert\(error\?\.message/);

  const rendererBridge = [...new Set([...html.matchAll(/launcherBridge\??\.([A-Za-z_$][\w$]*)/g)].map(match => match[1]))];
  const preloadBridge = [...preload.matchAll(/^\s{2}([A-Za-z_$][\w$]*)\s*:/gm)].map(match => match[1]);
  assert.deepEqual(rendererBridge.filter(method => !preloadBridge.includes(method)), []);
});

test('server console copy button handler is available globally even before output arrives', () => {
  assert.match(html, /\nasync function copyServerConsole\(\) \{[\s\S]*?\n\}\n\nfunction renderServerConsole\(\)/);
  assert.doesNotMatch(html, /function renderServerConsole\(\) \{[\s\S]*?async function copyServerConsole\(/);
  assert.match(html, /onclick="copyServerConsole\(\)"/);
});

test('Electron renderer console handler reads current event fields and preserves severity', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  const start = main.indexOf("mainWindow.webContents.on('console-message'");
  const end = main.indexOf('\n  });', start);
  assert.ok(start >= 0 && end > start, 'renderer console listener should exist');

  const listeners = [];
  const calls = [];
  const context = {
    mainWindow: { webContents: { on: (event, listener) => listeners.push({ event, listener }) } },
    console: {
      error: message => calls.push(['error', message]),
      warn: message => calls.push(['warning', message]),
      log: message => calls.push(['info', message]),
    },
  };
  vm.runInNewContext(main.slice(start, end + '\n  });'.length), context);
  assert.equal(listeners[0].event, 'console-message');
  listeners[0].listener({ level: 'warning', sourceId: 'renderer.js', lineNumber: 12, message: 'test warning' });
  assert.deepEqual(calls, [['warning', '[renderer:warning] renderer.js:12 test warning']]);
});

test('profile and browse version buttons pass content through escaped data attributes', () => {
  assert.match(html, /data-version-content="\$\{escapeHtml\(JSON\.stringify\(m\)\)\}"[^>]*onclick="openContentVersionSwitcherFromButton\(this,'library'\)"/);
  assert.match(html, /data-version-content="\$\{escapeHtml\(JSON\.stringify\(hit\)\)\}"[^>]*onclick="openContentVersionSwitcherFromButton\(this,'browse'\)"/);
  assert.match(html, /async function openContentVersionSwitcherFromButton\(button, scope = 'browse'\)[\s\S]*?button\?\.getAttribute\('data-version-content'\)[\s\S]*?await openContentVersionSwitcher\(serialized, scope\)/);
  assert.doesNotMatch(html, /onclick="openContentVersionSwitcher\('\$\{escapeJsString\(JSON\.stringify\((?:m|hit)\)\)\}'/);
});

test('button click handler forwards the selected project JSON to the version switcher', async () => {
  const start = html.indexOf('async function openContentVersionSwitcherFromButton');
  const end = html.indexOf('\nasync function openContentVersionSwitcher(', start);
  assert.ok(start >= 0 && end > start, 'version button click handler should exist');
  const handler = html.slice(start, end);
  const calls = [];
  const content = { id: 'project-1', name: `A "quoted" mod's`, source: 'modrinth' };
  const serialized = JSON.stringify(content);
  const context = {
    button: { getAttribute: name => name === 'data-version-content' ? serialized : null },
    openContentVersionSwitcher: async (...args) => calls.push(args),
  };

  await vm.runInNewContext(`${handler}\nopenContentVersionSwitcherFromButton(button, 'browse')`, context);
  assert.equal(calls.length, 1);
  assert.deepEqual(JSON.parse(calls[0][0]), content);
  assert.equal(calls[0][1], 'browse');
});

test('browse install button safely forwards quoted project metadata', async () => {
  assert.match(html, /data-browse-content="\$\{escapeHtml\(JSON\.stringify\(hit\)\)\}" onclick="installFromBrowseFromButton\(this\)"/);
  const start = html.indexOf('async function installFromBrowseFromButton');
  const end = html.indexOf('\n// ---------------- Profile settings tab', start);
  assert.ok(start >= 0 && end > start, 'browse install adapter should exist');
  const calls = [];
  const content = { id: 'project-1', name: `A "quoted" mod's`, iconUrl: 'https://example.invalid/icon?a=1&b=2', source: 'curseforge' };
  const context = {
    button: { getAttribute: name => name === 'data-browse-content' ? JSON.stringify(content) : null },
    browseSource: 'modrinth',
    installFromBrowse: async (...args) => calls.push(args),
    alert: message => { throw new Error(message); },
  };
  await vm.runInNewContext(`${html.slice(start, end)}\ninstallFromBrowseFromButton(button)`, context);
  assert.deepEqual(calls, [['project-1', content.name, 'mod', content.iconUrl, 'curseforge']]);
});

test('existing-content lookup does not treat two missing slugs as the same project', () => {
  const start = html.indexOf('function findInstalledVersionEntry');
  const end = html.indexOf('\n// Local heuristic', start);
  assert.ok(start >= 0 && end > start, 'installed version lookup should exist');
  const source = html.slice(start, end);
  const context = { contentIdentity: value => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '') };
  vm.runInNewContext(`${source}\nthis.findInstalledVersionEntry = findInstalledVersionEntry;`, context);
  const entries = [{ id: 'local:one', slug: '', name: 'Local One' }, { id: 'project-1', slug: '', name: 'Project One' }];
  assert.equal(context.findInstalledVersionEntry(entries, { id: 'project-1' }), entries[1]);
  assert.equal(context.findInstalledVersionEntry(entries, { id: 'different-id', slug: '' }), null);
  assert.equal(context.findInstalledVersionEntry(entries, { id: 'different-id', slug: 'project-one' }), null);
  assert.equal(context.findInstalledVersionEntry([{ id: 'new-id', slug: 'project-one' }], { id: 'old-id', slug: 'project-one' }).id, 'new-id');
});

test('version buttons have visible styling and an inline up/down arrows icon', () => {
  assert.match(html, /\.content-version-btn\{[^}]*background:#211e4b[^}]*color:#d2ccff/);
  assert.match(html, /\.content-version-btn svg\{[^}]*stroke:currentColor/);
  assert.equal((html.match(/class="content-version-btn"[^>]*><svg viewBox="0 0 24 24"/g) || []).length, 3);
});

test('version selector stacks above the browse modal and remains viewport-bounded', () => {
  const browseLayer = html.match(/#browseModal\{position:fixed;z-index:(\d+)/);
  const versionsLayer = html.match(/#contentVersionModal\{position:fixed;z-index:(\d+)/);
  assert.ok(browseLayer && versionsLayer, 'both modal layers should have explicit fixed positioning');
  assert.ok(Number(versionsLayer[1]) > Number(browseLayer[1]), 'version modal must be above the open browse modal');
  assert.match(html, /#contentVersionModal \.modal-box\{width:min\(700px,calc\(100vw - 32px\)\);max-height:calc\(100vh - 32px\);overflow:hidden;\}/);
  assert.match(html, /id="contentVersionModal"[^>]*onclick="if\(event\.target===this\)closeContentVersionModal\(\)"/);
  assert.match(html, /id="contentVersionTitle"[^>]*>Choose a version<\/span><button class="modal-close" type="button" aria-label="Close version switcher"/);
});

test('server mods and plugins folders support version switching and individual or bulk updates', () => {
  assert.match(html, /function getServerFolderContentType\(relativePath\)[\s\S]*?normalized === 'mods' \? 'mod' : normalized === 'plugins' \? 'plugin'/);
  assert.match(html, /function renderServerFileContentActions\(server, type, file\)[\s\S]*?openContentVersionSwitcherFromButton\(this,'library'\)[\s\S]*?updateServerContentFromButton\(this\)/);
  assert.match(html, /function renderServerFolderContentControls\(server, type\)[\s\S]*?updateAllServerContent\(/);
  assert.match(html, /async function refreshServerContent\([\s\S]*?launcherBridge\.syncServerContent\(serverId\)/);
  assert.match(html, /async function updateServerContentItem\([\s\S]*?latestVersionId: entry\.latestVersionId \|\| null/);
  assert.match(html, /async function updateAllServerContent\([\s\S]*?for \(const entry of updates\)[\s\S]*?latestVersionId: entry\.latestVersionId \|\| null/);
  assert.match(html, /renderServerFileContentActions\(server, serverContentType, item\)/);
});

test('server version listing normalizes loader and retries an empty loader-filtered result', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  const start = main.indexOf("ipcMain.handle('launcher:get-content-versions'");
  assert.ok(start >= 0);
  const end = main.indexOf("\nipcMain.handle('launcher:get-installed-mods'", start);
  const handler = main.slice(start, end);
  assert.match(handler, /SERVER_CONTENT_TYPES\[String\(server\.serverType \|\| ''\)\.toLowerCase\(\)\]\?\.loader/);
  assert.match(handler, /if \(server && loader && versions\.length === 0\)/);
  assert.match(handler, /Server or Client/);
  assert.match(handler, /versions = mapVersions\(rows\);[\s\S]*?if \(server && loader && versions\.length === 0\)/);
});

test('profile update actions pass the provider latest version instead of redownloading the current version', () => {
  assert.match(html, /launcherBridge\?\.updateContent\?\.\(\{ profileId: p\.id, id: entry\.id, fileName: entry\.fileName, versionId: entry\.latestVersionId \|\| null, fileId: entry\.latestVersionId \|\| null \}\)/);
  assert.match(html, /launcherBridge\.updateContent\(\{ profileId: p\.id, id: entry\.id, fileName: entry\.fileName, versionId: entry\.latestVersionId \|\| null, fileId: entry\.latestVersionId \|\| null \}\)/);
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  assert.match(main, /installModrinthContent\(profile, \{ \.\.\.entry, type \}, stagingPath, payload\.versionId \|\| entry\.latestVersionId \|\| null\)/);
});

test('profile import emits staged progress and the UI displays a progress dialog', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  const preload = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '..', 'bald_launcher_v7.html'), 'utf8');
  const start = main.indexOf("ipcMain.handle('launcher:import-profile'");
  const end = main.indexOf("\nipcMain.handle('launcher:backup-profile'", start);
  assert.ok(start >= 0 && end > start, 'profile import handler should exist');
  const handler = main.slice(start, end);
  assert.match(handler, /emitStatus\('Importing profile · choosing file\.\.\.'\)/);
  assert.match(handler, /emitStatus\(`Importing profile · reading archive · \$\{path\.basename\(sourcePath\)\}`\)/);
  assert.match(handler, /emitProfileImportProgress\(\{\s*phase: 'download'/);
  assert.match(handler, /emitProfileImportProgress\(\{ phase: 'extract'/);
  assert.match(handler, /emitStatus\('Importing profile · extracting included files\.\.\.'\)/);
  assert.match(handler, /emitStatus\(`Profile imported · \$\{imported\.name\}`\)/);
  assert.match(handler, /emitStatus\(`Profile import failed · \$\{message\}`\)/);
  assert.match(preload, /onProfileImportProgress:/);
  assert.match(html, /id="profileImportOverlay"/);
  assert.match(html, /id="profileImportProgressBar" role="progressbar"/);
  assert.match(html, /id="profileImportProgressFill"/);
  assert.match(html, /profile-import-progress-indeterminate \.profile-import-progress-fill/);
  assert.match(html, /updateProfileImportProgress\(progress\)/);
});

test('large Modrinth imports stream files and extract overrides without buffering or duplicate copies', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  const importStart = main.indexOf("ipcMain.handle('launcher:import-profile'");
  const importSource = main.slice(importStart, main.indexOf("ipcMain.handle('launcher:backup-profile'", importStart));
  assert.match(importSource, /runProfileImportDownloads\(\{[\s\S]*?concurrency: sourceStats\.size > twoGb \? 2 : 4/);
  assert.match(importSource, /responseType: 'stream'/);
  assert.match(importSource, /await pipeline\(response\.data, meter, fs\.createWriteStream/);
  assert.doesNotMatch(importSource, /responseType:\s*'arraybuffer'/);
  const overridesStart = main.indexOf('async function extractMrpackOverrides');
  const overridesEnd = main.indexOf('\nfunction contentIdentity', overridesStart);
  const overrides = main.slice(overridesStart, overridesEnd);
  assert.match(overrides, /capture: false,[\s\S]*?onOutputLine/);
  assert.match(overrides, /\['-xvf', sourcePath, '-C', staging, 'overrides'\]/);
  assert.match(overrides, /await moveImportedTree/);
  const moveStart = main.indexOf('async function moveImportedTree');
  const moveEnd = main.indexOf('\nasync function extractMrpackOverrides', moveStart);
  assert.match(main.slice(moveStart, moveEnd), /await fs\.promises\.rename\(source, destination\)/);
  assert.doesNotMatch(overrides, /fs\.promises\.cp|fs\.cpSync/);
  assert.match(overrides, /onProgress\(\{ completed: extractedEntries, total: totalEntries, percent \}\)/);
  const inspectStart = main.indexOf('async function inspectMrpackOverrides');
  const inspectEnd = main.indexOf('\nasync function extractMrpackOverrides', inspectStart);
  const inspect = main.slice(inspectStart, inspectEnd);
  assert.match(inspect, /\['-tvf', sourcePath\]/);
  assert.match(inspect, /uncompressedBytes \+= size/);
  assert.match(importSource, /fs\.statfsSync\(createdRoot\)/);
  assert.match(importSource, /archiveInfo\.uncompressedBytes/);
});

test('cosmetic editors protect high-resolution capes and asynchronous preview state', () => {
  const library = fs.readFileSync(path.join(__dirname, '..', 'src', 'cosmetics', 'library', 'cosmetic-library.js'), 'utf8');
  assert.match(library, /width === 128 && height === 64/);
  assert.match(library, /width === 256 && height === 128/);

  const studio = fs.readFileSync(path.join(__dirname, '..', 'src', 'cosmetics', 'studio', 'cosmetic-studio.js'), 'utf8');
  assert.match(studio, /image\.onerror = \(\) => alert\(`Could not decode this \$\{state\.kind\} PNG\.`\)/);
  assert.match(studio, /canvas\.addEventListener\('pointercancel', endPointer\)/);
  assert.match(studio, /canvas\.addEventListener\('lostpointercapture'/);
  assert.match(studio, /state\.width === 128 && state\.height === 64/);

  const preview = fs.readFileSync(path.join(__dirname, '..', 'src', 'cosmetics', 'preview', 'minecraft-player-preview.mjs'), 'utf8');
  assert.match(preview, /this\.appearanceRequest/);
  assert.match(preview, /if \(request !== this\.appearanceRequest\) return false/);
});

test('cape editor preserves artwork across resolution changes and restores project drafts', () => {
  const studio = fs.readFileSync(path.join(__dirname, '..', 'src', 'cosmetics', 'studio', 'cosmetic-studio.js'), 'utf8');
  assert.match(studio, /function resizeCapePixels\(pixels, sourceWidth, sourceHeight, width, height\)/);
  assert.match(studio, /pixels: resizeCapePixels\(frame\.pixels, state\.project\.width, state\.project\.height, width, height\)/);
  assert.match(studio, /toggleCapePlayback\(state, false\);\s*const project = window\.CapeProjectModel\.createProject/);
  assert.match(studio, /const draftProject = state\.kind === 'cape' && draft\.project && window\.CapeProjectModel/);
  assert.match(studio, /if \(state\.kind === 'cape' && draftProject\)/);
});

test('cape editor history snapshots stay attached to the active animation frame', () => {
  const studio = fs.readFileSync(path.join(__dirname, '..', 'src', 'cosmetics', 'studio', 'cosmetic-studio.js'), 'utf8');
  assert.match(studio, /function createHistorySnapshot\(state\)/);
  assert.match(studio, /if \(state\.kind === 'cape'\) syncCapeFrame\(state\);/);
  assert.match(studio, /frameIndex: state\.kind === 'cape' \? state\.frameIndex : null/);
  assert.match(studio, /state\.redo\.push\(createHistorySnapshot\(state\)\)/);
  assert.match(studio, /const snapshot = state\.undo\.pop\(\)/);
  assert.match(studio, /restorePixels\(state, snapshot\)/);
  assert.match(studio, /state\.paintGestureActive/);
  assert.match(studio, /project: state\.kind === 'cape' && state\.project/);
  assert.match(studio, /state\.project = window\.CapeProjectModel\.createProject\(\{/);
});

test('server content sync is exposed through the preload bridge', () => {
  const preload = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  assert.match(preload, /syncServerContent: serverId => ipcRenderer\.invoke\('launcher:sync-server-content', serverId\)/);
  assert.match(main, /ipcMain\.handle\('launcher:sync-server-content'/);
});

test('profiles include search and sort filters and only expose profile import', () => {
  assert.match(html, /id="profileSearch"[^>]*oninput="renderProfileGrid\(\)"/);
  assert.match(html, /id="profileSort"[\s\S]*value="recent">Recently used[\s\S]*value="added">Recently added[\s\S]*value="edited">Recently edited[\s\S]*value="all">All profiles/);
  assert.match(html, /onclick="importProfileExport\(\)"/);
  assert.doesNotMatch(html, /Import modpack|importModpackFile|launcher:import-modpack/);
  const preload = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  assert.doesNotMatch(preload, /importModpack|launcher:import-modpack/);
  assert.doesNotMatch(main, /ipcMain\.handle\('launcher:import-modpack'/);
  assert.match(main, /extensions: \['baldprofile', 'mrpack'\]/);
  assert.match(main, /project\?\.icon_url/);
  assert.match(main, /folderName: getProfileFolderName/);
  assert.match(main, /fs\.watch\(profilesRoot/);
  assert.match(preload, /onStateChanged/);
});

test('profile recently-used sorting tracks Start clicks rather than profile selection', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  const startHandler = main.slice(main.indexOf("ipcMain.handle('launcher:launch'"), main.indexOf("ipcMain.handle('launcher:stop'"));
  const activeHandler = main.slice(main.indexOf("ipcMain.handle('launcher:set-active-profile'"), main.indexOf('// ---------------------------------------------------------------------------\n// IPC: content'));
  assert.match(startHandler, /profile\.lastUsedAt = Date\.now\(\)/);
  assert.doesNotMatch(startHandler, /profile\.updatedAt =/);
  assert.doesNotMatch(activeHandler, /lastUsedAt/);
  assert.match(html.slice(html.indexOf('async function launchClick'), html.indexOf('function handleLaunchButtonClick')), /profile\.lastUsedAt = Date\.now\(\)/);
});

test('profiles track persistent playtime only while Minecraft is running', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  assert.match(main, /playtimeMs: Math\.max\(0, Number\(profile\?\.playtimeMs\) \|\| 0\)/);
  assert.match(main, /lastPlayedAt: Number\.isFinite\(Number\(profile\?\.lastPlayedAt\)\)/);
  assert.match(main, /startProfilePlaytimeTracking\(profile, session\)/);
  assert.match(main, /stopProfilePlaytimeTracking\(profile\.id\)/);
  assert.match(main, /recordProfilePlaytime\(profile, session\)/);
  assert.match(main, /process\.kill\(Number\(session\.pid\), 0\);[\s\S]*?startProfilePlaytimeTracking\(profile, session, Date\.now\(\)\)/);
  const html = fs.readFileSync(path.join(__dirname, '..', 'bald_launcher_v7.html'), 'utf8');
  assert.match(html, /formatProfilePlaytime\(p\.playtimeMs\)/);
  assert.match(html, /formatProfileLastPlayed\(p\.lastPlayedAt\)/);
});

test('profile launch uses the selected Microsoft account instead of silently falling back', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '..', 'bald_launcher_v7.html'), 'utf8');
  const launch = main.slice(main.indexOf("ipcMain.handle('launcher:launch'"), main.indexOf("ipcMain.handle('launcher:stop'"));
  assert.match(launch, /payload\?\.accountId/);
  assert.match(launch, /launcherState\.accounts\.find\(item => item\.id === requestedAccountId\)/);
  assert.match(launch, /getLaunchAuthorization\(account\)/);
  assert.match(main, /refreshMicrosoftAuthorization\(account\.auth/);
  assert.match(main, /Could not refresh the Minecraft session for "\$\{account\.name\}"/);
  const launchClick = html.slice(html.indexOf('async function launchClick'), html.indexOf('function handleLaunchButtonClick'));
  assert.match(launchClick, /accountId: state\.activeAccountId/);
});

test('cosmetic studio audit covers layer visibility and cape structural history', () => {
  const studio = fs.readFileSync(path.join(__dirname, '..', 'src', 'cosmetics', 'studio', 'cosmetic-studio.js'), 'utf8');
  assert.equal((studio.match(/<\/section>/g) || []).length, 1, 'studio layout should have balanced section closure');
  assert.match(studio, /if \(state\.kind === 'skin'\) toggleLayer\(state, overlay\.querySelector\('\[data-layer="inner"\]'\)\)/);
  assert.match(studio, /function addCapeFrame\(state, duplicate\) \{\s*pushHistory\(state\)/);
  assert.match(studio, /function deleteCapeFrame\(state\) \{\s*pushHistory\(state\)/);
  assert.match(studio, /function updateCapeDelay\(state, value\) \{\s*pushHistory\(state\)/);
  assert.match(studio, /if \(width === state\.width && height === state\.height\) return;\s*pushHistory\(state\)/);
  assert.match(studio, /toggleCapePlayback\(state, false\);\s*const project/);
  assert.match(studio, /const playback = document\.getElementById\('capePlayback'\)/);
  assert.match(studio, /if \(state\.kind === 'cape'\) \{\s*const loop = document\.getElementById\('capeLoop'\)/);
  assert.match(studio, /const importedPixels = context\.getImageData[\s\S]*?pushHistory\(state\)/);
  assert.match(studio, /id="capeSheetFrame"/);
  assert.match(studio, /id="studioCanvas" width="\$\{state\.width\}" height="\$\{state\.height\}"/);
  assert.match(studio, /if \(!canvas\) return;/);
});

test('cosmetic studio exposes a persistent color control for the 3D preview background', () => {
  const studio = fs.readFileSync(path.join(__dirname, '..', 'src', 'cosmetics', 'studio', 'cosmetic-studio.js'), 'utf8');
  assert.match(studio, /id="studioPreviewBackground" type="color"/);
  assert.match(studio, /const PREVIEW_BACKGROUND_KEY = 'bald:cosmetic-studio:preview-background'/);
  assert.match(studio, /function getPreviewBackground\(\)/);
  assert.match(studio, /state\.previewBackground = color/);
  assert.match(studio, /state\.viewer\.background = color/);
  assert.match(studio, /state\.viewer\.render\(\)/);
  assert.match(studio, /localStorage\.setItem\(PREVIEW_BACKGROUND_KEY, color\)/);
  assert.match(studio, /state\.viewer\.background = state\.previewBackground/);
});

test('Windows launcher window and executable use the shipped branded icon', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  assert.match(main, /app\.setAppUserModelId\('com\.baldlauncher\.app'\)/);
  assert.match(main, /icon:\s*path\.join\(__dirname,\s*'build',\s*'icon\.ico'\)/);

  const icon = fs.readFileSync(path.join(__dirname, '..', 'build', 'icon.ico'));
  assert.equal(icon.readUInt16LE(0), 0, 'ICO reserved field');
  assert.equal(icon.readUInt16LE(2), 1, 'ICO image type');
  const count = icon.readUInt16LE(4);
  assert.ok(count >= 5, 'provide multiple icon sizes for Windows surfaces');
  for (let index = 0; index < count; index += 1) {
    const entryOffset = 6 + index * 16;
    const width = icon[entryOffset] || 256;
    const height = icon[entryOffset + 1] || 256;
    const byteLength = icon.readUInt32LE(entryOffset + 8);
    const imageOffset = icon.readUInt32LE(entryOffset + 12);
    assert.ok(width >= 16 && height >= 16, 'icon frames should be at least 16px');
    assert.ok(byteLength > 8 && imageOffset + byteLength <= icon.length, 'icon frame must be complete');
    assert.deepEqual([...icon.subarray(imageOffset, imageOffset + 8)], [137, 80, 78, 71, 13, 10, 26, 10], 'icon frame should be a PNG');
  }
});

test('launcher update UI downloads the latest release before offering installation', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  const preload = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '..', 'bald_launcher_v7.html'), 'utf8');
  const updaterFeed = fs.readFileSync(path.join(__dirname, '..', 'src', 'shared', 'updater-feed.js'), 'utf8');

  assert.match(main, /autoUpdater\.checkForUpdatesAndNotify\(\)/);
  assert.match(main, /const installDirectory = path\.dirname\(app\.getPath\('exe'\)\)/);
  assert.match(main, /autoUpdater\.disableDifferentialDownload = true/);
  assert.match(updaterFeed, /updater\.autoDownload = true/);
  assert.match(updaterFeed, /updater\.autoInstallOnAppQuit = false/);
  assert.match(updaterFeed, /updater\.installDirectory = installDirectory/);
  assert.match(main, /autoUpdater\.quitAndInstall\(true,\s*true\)/);
  assert.match(main, /state:\s*'downloaded',\s*\.\.\.\(version\s*\?\s*\{\s*version\s*\}\s*:\s*\{\}\)/);
  assert.match(main, /send\('launcher:update-ready',\s*\{\s*version\s*\}\)/);
  assert.match(preload, /const handler = \(_event, update\) => callback\(update\);\s*ipcRenderer\.on\('launcher:update-ready'/);
  assert.match(html, /Downloading the latest version\$\{version\} automatically/);
  assert.match(html, /button\.disabled = true;\s*button\.textContent = `Downloading\$\{version\}\.\.\.`/);
  assert.match(html, /Restart to install\$\{version\}/);
  assert.doesNotMatch(html, /button\.textContent = 'Update now'/);
});

test('launcher uses its dark draggable titlebar instead of the Windows white titlebar', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  const preload = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '..', 'bald_launcher_v7.html'), 'utf8');
  const builder = fs.readFileSync(path.join(__dirname, '..', 'electron-builder.yml'), 'utf8');

  assert.match(main, /minHeight:\s*720,\s*frame:\s*false/);
  assert.match(main, /ipcMain\.handle\('launcher:window-control'/);
  assert.match(preload, /controlWindow:\s*action\s*=>\s*ipcRenderer\.invoke\('launcher:window-control',\s*action\)/);
  assert.match(html, /\.titlebar\{[^}]*-webkit-app-region:drag/);
  assert.match(html, /class="titlebar-logo" src="build\/bald-launcher-mark\.svg"/);
  assert.match(builder, /- build\/bald-launcher-mark\.svg/);
  assert.match(html, /class="window-controls"/);
  assert.match(html, /data-window-control="minimize"/);
  assert.match(html, /data-window-control="toggle-maximize"/);
  assert.match(html, /data-window-control="close"/);
  assert.match(html, /querySelectorAll\('\[data-window-control\]'\)/);
  assert.match(html, /id="updateButton" type="button">Check for updates<\/button>/);
  assert.doesNotMatch(html, /class="sidebar-brand-mark"/);
});

test('Windows release packages every root module required by the main process', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  const builder = fs.readFileSync(path.join(__dirname, '..', 'electron-builder.yml'), 'utf8');

  for (const match of main.matchAll(/require\(['"]\.\/([^'"]+)['"]\)/g)) {
    if (match[1].includes('/')) continue;
    const dependency = `${match[1]}.js`;
    assert.ok(fs.existsSync(path.join(__dirname, '..', dependency)), `missing main-process module ${dependency}`);
    assert.ok(builder.includes(`- ${dependency}`), `electron-builder must package ${dependency}`);
  }
});

test('resource pack cards recover pack icons from imported archives', () => {
  const studio = fs.readFileSync(path.join(__dirname, '..', 'src', 'resource-packs', 'resource-pack-studio.js'), 'utf8');
  assert.match(studio, /function getPackIconDataUrl\(entry\)/);
  assert.match(studio, /pack\\\.png\$/);
  assert.match(studio, /const iconDataUrl = getPackIconDataUrl/);
  assert.match(studio, /onerror="this\.hidden=true;this\.nextElementSibling\.hidden=false"/);
});

test('installed resource packs extract pack.png icons during profile sync', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  assert.match(main, /function readResourcePackIcon\(filePath\)/);
  assert.match(main, /readResourcePackIcon\(path\.join\(folder, item\.name\)\)/);
  assert.match(main, /data:image\/png;base64/);
});

test('resource-pack thumbnails and 3D preview only load while visible', () => {
  const studio = fs.readFileSync(path.join(__dirname, '..', 'src', 'resource-packs', 'resource-pack-studio.js'), 'utf8');
  assert.doesNotMatch(studio, /tiles\.slice\(0, 24\)\.forEach\(load\)/);
  assert.match(studio, /rootMargin: '0px'/);
  assert.match(studio, /visibleCanvas\.offsetParent/);
});

test('character preview defers skin loading while the cosmetics panel is hidden', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'bald_launcher_v7.html'), 'utf8');
  assert.match(html, /let pendingCharacterPreview = null/);
  assert.match(html, /cosmeticsPanel\?\.style\.display === 'none'/);
  assert.match(html, /pendingCharacterPreview = \{ entry, model \}/);
});

test('Modrinth profile imports do not impose an arbitrary downloaded-file size limit', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  const importStart = main.indexOf("ipcMain.handle('launcher:import-profile'");
  assert.ok(importStart >= 0);
  const importSource = main.slice(importStart, main.indexOf("ipcMain.handle('launcher:backup-profile'", importStart));
  assert.match(importSource, /maxContentLength: Infinity/);
  assert.match(importSource, /maxBodyLength: Infinity/);
  assert.doesNotMatch(importSource, /maxContentLength:\s*100\s*\*\s*1024\s*\*\s*1024/);
});

test('large Modrinth profile imports ask before opening archives over 2 GB', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  const importStart = main.indexOf("ipcMain.handle('launcher:import-profile'");
  const importSource = main.slice(importStart, main.indexOf("ipcMain.handle('launcher:backup-profile'", importStart));
  assert.match(importSource, /sourceStats\.size > twoGb/);
  assert.match(importSource, /Do you want to proceed\?/);
  assert.match(importSource, /buttons: \['Proceed', 'Cancel'\]/);
  assert.match(importSource, /confirmation\.response !== 0/);
});

test('large Modrinth profile imports use the ZIP64-capable archive path after confirmation', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  const importStart = main.indexOf("ipcMain.handle('launcher:import-profile'");
  const importSource = main.slice(importStart, main.indexOf("ipcMain.handle('launcher:backup-profile'", importStart));
  assert.match(importSource, /readMrpackEntry\(sourcePath, 'modrinth\.index\.json'\)/);
  assert.match(importSource, /extractMrpackOverrides\(sourcePath, createdRoot, progress =>/);
  assert.doesNotMatch(importSource, /new AdmZip\(sourcePath\)/);
  assert.match(main.slice(0, importStart), /async function readMrpackEntry\(sourcePath, entryPath\)/);
});
