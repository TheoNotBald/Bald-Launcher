const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const forgeVersionHelpers = require('../src/shared/forge-version');

const projectRoot = path.join(__dirname, '..');
const main = fs.readFileSync(path.join(projectRoot, 'main.js'), 'utf8');
const html = fs.readFileSync(path.join(projectRoot, 'bald_launcher_v7.html'), 'utf8').replace(/\r\n/g, '\n');
const preload = fs.readFileSync(path.join(projectRoot, 'preload.js'), 'utf8');

test('loader version metadata keeps stable and preview builds while filtering malformed entries', () => {
  const start = main.indexOf('function normalizeLoaderVersion(');
  const end = main.indexOf('\nasync function getLoaderVersions(', start);
  assert.ok(start >= 0 && end > start, 'loader version normalizers should exist');
  const context = {};
  vm.runInNewContext(`${main.slice(start, end)}
    this.normalizeMetaLoaderVersions = normalizeMetaLoaderVersions;
    this.normalizeNeoForgeVersions = normalizeNeoForgeVersions;`, context);

  const metaVersions = context.normalizeMetaLoaderVersions([
    { loader: { version: '0.20.1', stable: true } },
    { loader: { version: '0.21.0-alpha', stable: false } },
    { loader: { version: '0.20.1', stable: true } },
    { loader: { version: '../bad', stable: true } },
  ]);
  assert.deepEqual(Array.from(metaVersions, item => [item.version, item.stable]), [
    ['0.20.1', true],
    ['0.21.0-alpha', false],
  ]);

  const neoVersions = context.normalizeNeoForgeVersions(
    '<versions><version>21.1.8</version><version>21.1.10-beta</version><version>20.4.1</version></versions>',
    '1.21.1',
  );
  assert.deepEqual(Array.from(neoVersions, item => item.version), ['21.1.10-beta', '21.1.8']);
});

test('loader version lookup queries and caches every supported loader catalog', async () => {
  const start = main.indexOf('function normalizeLoaderVersion(');
  const end = main.indexOf('\nasync function getLoaderManifest(', start);
  assert.ok(start >= 0 && end > start, 'loader version lookup should exist');
  const responses = {
    'https://meta.fabricmc.net/v2/versions/loader/1.21.1': [
      { loader: { version: '0.20.1', stable: true } },
      { loader: { version: '0.21.0-alpha', stable: false } },
    ],
    'https://meta.quiltmc.org/v3/versions/loader/1.21.1': [
      { loader: { version: '0.29.2', stable: true } },
      { loader: { version: '0.30.0-beta', stable: false } },
    ],
    'https://files.minecraftforge.net/net/minecraftforge/forge/maven-metadata.json': {
      '1.21.1': ['1.21.1-52.1.0', '1.21.1-53.0.0-rc1'],
    },
    'https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml':
      '<versions><version>21.1.209</version><version>21.1.210-beta</version></versions>',
  };
  const requestedUrls = [];
  const cacheWrites = [];
  const context = {
    ...forgeVersionHelpers,
    path,
    app: { getPath: () => 'C:\\user-data' },
    fs: {
      readFileSync: () => { throw new Error('cache miss'); },
      mkdirSync: () => {},
      writeFileSync: (filePath, value) => cacheWrites.push([filePath, JSON.parse(value)]),
    },
    axios: {
      get: async url => {
        requestedUrls.push(url);
        return { data: responses[url] };
      },
    },
    VERSION_CACHE_TTL_MS: 60_000,
  };
  vm.runInNewContext(`${main.slice(start, end)}\nthis.getLoaderVersions = getLoaderVersions;`, context);

  const expected = {
    fabric: ['0.20.1', '0.21.0-alpha'],
    quilt: ['0.29.2', '0.30.0-beta'],
    forge: ['1.21.1-53.0.0-rc1', '1.21.1-52.1.0'],
    neoforge: ['21.1.210-beta', '21.1.209'],
  };
  for (const [loader, expectedVersions] of Object.entries(expected)) {
    const versions = await context.getLoaderVersions('1.21.1', loader);
    assert.deepEqual(Array.from(versions, item => item.version), expectedVersions);
  }
  assert.equal(requestedUrls.length, 4);
  assert.equal(cacheWrites.length, 4);
  for (const [loader] of Object.entries(expected)) {
    assert.ok(cacheWrites.some(([filePath]) => filePath.includes(`loader-versions-${loader}-1.21.1.json`)));
  }
});

test('pinned Fabric, Quilt, Forge, and NeoForge versions reach their installers and use separate caches', async t => {
  const start = main.indexOf('async function installLoader(profile)');
  const end = main.indexOf('\nfunction createWindow()', start);
  assert.ok(start >= 0 && end > start, 'loader installation function should exist');
  const cases = [
    { loader: 'fabric', version: '0.20.1', id: 'fabric-loader-0.20.1-1.21.1' },
    { loader: 'quilt', version: '0.29.2', id: 'quilt-loader-0.29.2-1.21.1' },
    { loader: 'forge', version: '1.21.1-52.1.0', id: '1.21.1-forge-52.1.0' },
    { loader: 'neoforge', version: '21.1.209', id: 'neoforge-21.1.209' },
  ];

  for (const item of cases) {
    await t.test(item.loader, async () => {
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
        normalizeLoaderVersion: version => /^[0-9][a-zA-Z0-9.+_-]{0,79}$/.test(String(version || '').trim())
          ? String(version).trim()
          : '',
        getLoaderVersionId: () => null,
        getMinecraftRootFor: () => 'C:\\minecraft',
        ensureVanillaVersionProfile: async () => {},
        getJavaPath: async () => 'java.exe',
        ensureLauncherProfilesFile: () => {},
        getLoaderVersions: async (minecraftVersion, loader) => {
          metadataRequests.push([minecraftVersion, loader]);
          return [{ version: item.version, stable: true }];
        },
        emitStatus: () => {},
        LOADER_INSTALLER_DIR: 'loaders',
        downloadToFile: async () => {},
        runInstaller: async (...args) => installerCalls.push(args),
        findInstalledVersionId: (_root, minecraftVersion, loader, _before, loaderVersion) => {
          assert.equal(minecraftVersion, '1.21.1');
          assert.equal(loader, item.loader === 'neoforge' ? 'neoforge' : item.loader);
          assert.equal(loaderVersion, item.version);
          return item.id;
        },
        getLoaderCachePath: (_profile, _minecraftVersion, _loader, version) => `cache-${version || 'latest'}`,
      };
      vm.runInNewContext(`${main.slice(start, end)}\nthis.installLoader = installLoader;`, context);
      const result = await context.installLoader({
        id: `profile-${item.loader}`,
        mcVersion: '1.21.1',
        loader: item.loader,
        loaderVersion: item.version,
      });

      assert.equal(result, item.id);
      assert.deepEqual(metadataRequests, [['1.21.1', item.loader]]);
      assert.ok(installerCalls[0][1].includes(item.version), 'installer artifact should match the selected loader version');
      if (item.loader === 'fabric' || item.loader === 'quilt') {
        assert.ok(installerCalls[0][2].includes(item.version), 'installer args should pin the selected version');
      }
      assert.deepEqual(cacheWrites, [[`cache-${item.version}`, { loaderVersion: item.version, versionId: item.id }]]);
    });
  }
});

test('installed loader profiles are matched to the exact selected loader version', () => {
  const start = main.indexOf('function findInstalledVersionId(');
  const end = main.indexOf('\nasync function installLoader(', start);
  assert.ok(start >= 0 && end > start, 'installed loader lookup should exist');
  const context = {
    path,
    fs: {
      readdirSync: () => [
        { name: 'fabric-loader-0.20.1-1.21.1', isDirectory: () => true },
        { name: 'quilt-loader-0.29.2-1.21.1', isDirectory: () => true },
        { name: '1.21.1-forge-52.1.0', isDirectory: () => true },
        { name: 'neoforge-21.1.209', isDirectory: () => true },
      ],
    },
  };
  vm.runInNewContext(`${main.slice(start, end)}\nthis.findInstalledVersionId = findInstalledVersionId;`, context);
  const find = context.findInstalledVersionId;
  assert.equal(find('C:\\minecraft', '1.21.1', 'fabric', new Set(), '0.20.1'), 'fabric-loader-0.20.1-1.21.1');
  assert.equal(find('C:\\minecraft', '1.21.1', 'quilt', new Set(), '0.29.2'), 'quilt-loader-0.29.2-1.21.1');
  assert.equal(find('C:\\minecraft', '1.21.1', 'forge', new Set(), '1.21.1-52.1.0'), '1.21.1-forge-52.1.0');
  assert.equal(find('C:\\minecraft', '1.21.1', 'neoforge', new Set(), '21.1.209'), 'neoforge-21.1.209');
  assert.equal(find('C:\\minecraft', '1.21.1', 'fabric', new Set(), '0.19.0'), null);
});

test('profile selector lists every loader version, marks previews, and resets on loader changes', async () => {
  const start = html.indexOf('let pdLoaderVersionRequestId =');
  const end = html.indexOf('\nfunction populatePdSettingsForm(', start);
  assert.ok(start >= 0 && end > start, 'loader version selector should exist');
  const elements = new Map();
  for (const id of ['pdLoaderVersionRow', 'pdLoaderVersion', 'pdLoaderVersionLabel', 'pdLoaderVersionStatus']) {
    elements.set(id, {
      hidden: false,
      disabled: false,
      value: '',
      textContent: '',
      style: {},
      dataset: {},
      children: [],
      replaceChildren() { this.children = []; },
      appendChild(option) { this.children.push(option); },
      setAttribute() {},
      querySelector(selector) { return selector === '#pdLoaderVersion' ? {} : null; },
    });
  }
  const row = elements.get('pdLoaderVersionRow');
  const settings = {
    hidden: false,
    dataset: {},
    querySelectorAll: () => [row],
    querySelector: () => ({ innerHTML: '' }),
  };
  const settingsButtons = ['general', 'installation', 'java', 'files'].map(category => ({
    dataset: { profileSettingsCategory: category },
    classList: { toggle() {} },
  }));
  elements.set('javaProfileSettings', settings);
  elements.set('javaProfileSettingsNav', { querySelectorAll: () => settingsButtons });
  const versionsByLoader = {
    fabric: [{ version: '0.20.1', stable: true }, { version: '0.21.0-alpha', stable: false }],
    forge: [{ version: '1.21.1-52.1.0', stable: true }, { version: '1.21.1-53.0.0-rc1', stable: false }],
  };
  const context = {
    document: {
      getElementById: id => elements.get(id),
      createElement: () => ({ value: '', textContent: '' }),
    },
    launcherBridge: {
      getLoaderVersions: async (_mcVersion, loader) => ({ ok: true, versions: versionsByLoader[loader] || [] }),
    },
  };
  const categoryStart = html.indexOf('function setProfileSettingsCategory(');
  const categoryEnd = html.indexOf('\nfunction openExportFormatModal', categoryStart);
  assert.ok(categoryStart >= 0 && categoryEnd > categoryStart, 'profile settings category selector should exist');
  vm.runInNewContext(`${html.slice(start, end)}\n${html.slice(categoryStart, categoryEnd)}
    this.refreshPdLoaderVersions = refreshPdLoaderVersions;
    this.setProfileSettingsCategory = setProfileSettingsCategory;`, context);
  context.setProfileSettingsCategory('general');
  await context.refreshPdLoaderVersions('1.21.1', 'fabric', '0.20.1');
  const select = elements.get('pdLoaderVersion');
  assert.equal(row.hidden, true, 'late loader metadata must not expose the Installation row on General');
  assert.equal(select.value, '0.20.1');
  assert.deepEqual(select.children.map(option => option.value), ['', '0.20.1', '0.21.0-alpha']);
  assert.equal(select.children[2].textContent, '0.21.0-alpha (preview)');

  context.setProfileSettingsCategory('installation');
  assert.equal(row.hidden, false);
  await context.refreshPdLoaderVersions('1.21.1', 'fabric', '0.20.1');
  assert.equal(row.hidden, false, 'the selector remains visible on Installation after refresh');

  await context.refreshPdLoaderVersions('1.21.1', 'forge');
  assert.equal(elements.get('pdLoaderVersionLabel').textContent, 'Forge version');
  assert.equal(select.value, '', 'the previous loader selection should not carry into Forge');
  assert.deepEqual(select.children.map(option => option.value), ['', '1.21.1-52.1.0', '1.21.1-53.0.0-rc1']);
  assert.equal(select.children[2].textContent, '1.21.1-53.0.0-rc1 (preview)');

  await context.refreshPdLoaderVersions('1.21.1', 'vanilla');
  assert.equal(row.hidden, true);
});

test('version selector is wired to profile persistence, legacy Fabric values, and all loader IPC', () => {
  assert.match(preload, /getLoaderVersions: \(mcVersion, loader\) => ipcRenderer\.invoke\('launcher:get-loader-versions', \{ mcVersion, loader \}\)/);
  assert.match(main, /ipcMain\.handle\('launcher:get-loader-versions'[\s\S]*?getLoaderVersions\(payload\?\.mcVersion, payload\?\.loader\)/);
  assert.match(main, /loaderVersion: loader !== 'vanilla'[\s\S]*?normalizeLoaderVersion\(profile\?\.loaderVersion \?\? profile\?\.fabricLoaderVersion\)/);
  assert.match(html, /loaderVersion: document\.getElementById\('pdLoaderVersion'\)\.value/);
  assert.match(html, /id="pdLoaderVersionRow"[^>]*hidden/);
});
