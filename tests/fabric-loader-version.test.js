const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const projectRoot = path.join(__dirname, '..');
const main = fs.readFileSync(path.join(projectRoot, 'main.js'), 'utf8');
const html = fs.readFileSync(path.join(projectRoot, 'bald_launcher_v7.html'), 'utf8').replace(/\r\n/g, '\n');
const preload = fs.readFileSync(path.join(projectRoot, 'preload.js'), 'utf8');

test('Fabric version normalization prefers stable versions and removes invalid or duplicate values', () => {
  const start = main.indexOf('function normalizeFabricLoaderVersion(');
  const end = main.indexOf('\nasync function getFabricLoaderVersions(', start);
  assert.ok(start >= 0 && end > start, 'Fabric version normalization helpers should exist');
  const context = {};
  vm.runInNewContext(`${main.slice(start, end)}\nthis.normalizeFabricLoaderVersions = normalizeFabricLoaderVersions;`, context);

  const versions = context.normalizeFabricLoaderVersions([
    { loader: { version: '0.18.2', stable: true } },
    { loader: { version: '0.19.0-alpha', stable: false } },
    { loader: { version: '0.18.1', stable: true } },
    { loader: { version: '0.18.2', stable: true } },
    { loader: { version: '../bad', stable: true } },
  ]);
  assert.deepEqual(Array.from(versions), ['0.18.2', '0.18.1']);
});

test('pinned Fabric version is used for installation and version-specific caching', async () => {
  const start = main.indexOf('async function installLoader(profile)');
  const end = main.indexOf('\nfunction createWindow()', start);
  assert.ok(start >= 0 && end > start, 'loader installation function should exist');
  const installerCalls = [];
  const cacheWrites = [];
  const metadataRequests = [];
  const context = {
    path,
    fs: {
      existsSync: () => false,
      readdirSync: () => [],
      writeFileSync: (filePath, value) => cacheWrites.push([filePath, JSON.parse(value)]),
    },
    normalizeFabricLoaderVersion: version => /^[0-9][a-zA-Z0-9.+_-]{0,39}$/.test(String(version || '').trim())
      ? String(version).trim()
      : '',
    getLoaderVersionId: () => null,
    getMinecraftRootFor: () => 'C:\\minecraft',
    ensureVanillaVersionProfile: async () => {},
    getJavaPath: async () => 'java.exe',
    getFabricLoaderVersions: async version => {
      metadataRequests.push(version);
      return ['0.18.2', '0.18.1'];
    },
    emitStatus: () => {},
    LOADER_INSTALLER_DIR: 'loaders',
    downloadToFile: async () => {},
    runInstaller: async (...args) => installerCalls.push(args),
    findInstalledVersionId: (_root, mcVersion, loader, _before, loaderVersion) => {
      assert.equal(mcVersion, '1.21.1');
      assert.equal(loader, 'fabric');
      assert.equal(loaderVersion, '0.18.2');
      return 'fabric-loader-0.18.2-1.21.1';
    },
    getLoaderCachePath: (_profile, _mcVersion, _loader, version) => `cache-${version || 'latest'}`,
  };
  vm.runInNewContext(`${main.slice(start, end)}\nthis.installLoader = installLoader;`, context);
  const result = await context.installLoader({ id: 'profile-1', mcVersion: '1.21.1', loader: 'fabric', fabricLoaderVersion: '0.18.2' });

  assert.equal(result, 'fabric-loader-0.18.2-1.21.1');
  assert.deepEqual(metadataRequests, ['1.21.1']);
  assert.ok(installerCalls[0][2].includes('0.18.2'), 'installer args should pin the selected Fabric version');
  assert.deepEqual(cacheWrites, [['cache-0.18.2', { loaderVersion: '0.18.2', versionId: result }]]);
});

test('installed Fabric profiles are matched by the selected loader and Minecraft versions', () => {
  const start = main.indexOf('function findInstalledVersionId(');
  const end = main.indexOf('\nasync function installLoader(', start);
  assert.ok(start >= 0 && end > start, 'installed loader lookup should exist');
  const context = {
    path,
    fs: {
      readdirSync: () => [{ name: 'fabric-loader-0.18.2-1.21.1', isDirectory: () => true }],
    },
  };
  vm.runInNewContext(`${main.slice(start, end)}\nthis.findInstalledVersionId = findInstalledVersionId;`, context);
  assert.equal(context.findInstalledVersionId('C:\\minecraft', '1.21.1', 'fabric', new Set(), '0.18.2'), 'fabric-loader-0.18.2-1.21.1');
  assert.equal(context.findInstalledVersionId('C:\\minecraft', '1.21.1', 'fabric', new Set(), '0.18.1'), null);
});

test('profile settings selector loads compatible versions and preserves only a compatible saved choice', async () => {
  const start = html.indexOf('let pdFabricLoaderRequestId =');
  const end = html.indexOf('\nfunction populatePdSettingsForm(', start);
  assert.ok(start >= 0 && end > start, 'Fabric Loader settings selector should exist');

  const elements = new Map();
  for (const id of ['pdFabricLoaderVersionRow', 'pdFabricLoaderVersion', 'pdFabricLoaderVersionStatus']) {
    elements.set(id, {
      hidden: false,
      disabled: false,
      value: '',
      textContent: '',
      style: {},
      children: [],
      replaceChildren() { this.children = []; },
      appendChild(option) { this.children.push(option); },
    });
  }
  const context = {
    document: {
      getElementById: id => elements.get(id),
      createElement: () => ({ value: '', textContent: '' }),
    },
    launcherBridge: { getFabricLoaderVersions: async () => ({ ok: true, versions: ['0.18.2', '0.18.1'] }) },
  };
  vm.runInNewContext(`${html.slice(start, end)}\nthis.refreshPdFabricLoaderVersions = refreshPdFabricLoaderVersions;`, context);
  await context.refreshPdFabricLoaderVersions('1.21.1', 'fabric', '0.18.1');
  const row = elements.get('pdFabricLoaderVersionRow');
  const select = elements.get('pdFabricLoaderVersion');
  assert.equal(row.hidden, false);
  assert.equal(row.style.display, '');
  assert.equal(select.value, '0.18.1');
  assert.deepEqual(select.children.map(option => option.value), ['', '0.18.2', '0.18.1']);
  assert.match(elements.get('pdFabricLoaderVersionStatus').textContent, /compatible versions available/);

  context.launcherBridge.getFabricLoaderVersions = async () => ({ ok: true, versions: ['0.18.3'] });
  await context.refreshPdFabricLoaderVersions('1.21.2', 'fabric', '0.18.1');
  assert.equal(select.value, '', 'an incompatible saved version should fall back to Latest stable');
});

test('Fabric version setting is connected through profile persistence and the preload bridge', () => {
  assert.match(preload, /getFabricLoaderVersions: mcVersion => ipcRenderer\.invoke\('launcher:get-fabric-loader-versions', mcVersion\)/);
  assert.match(main, /ipcMain\.handle\('launcher:get-fabric-loader-versions'[\s\S]*?getFabricLoaderVersions\(mcVersion\)/);
  assert.match(main, /fabricLoaderVersion: loader === 'fabric' \? normalizeFabricLoaderVersion\(profile\?\.fabricLoaderVersion\) : ''/);
  assert.match(html, /fabricLoaderVersion: document\.getElementById\('pdFabricLoaderVersion'\)\.value/);
  assert.match(html, /fabricVersionSelect\.replaceChildren\(\)[\s\S]*?currentFabricVersionOption\.value = p\.fabricLoaderVersion \|\| ''/);
  assert.match(html, /id="pdFabricLoaderVersionRow"[^>]*hidden/);
});
