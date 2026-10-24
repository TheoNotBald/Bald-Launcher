const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'bald_launcher_v7.html'), 'utf8').replace(/\r\n/g, '\n');

function getFunctionSource(signature, nextSignature) {
  const start = html.indexOf(signature);
  const end = html.indexOf(nextSignature, start);
  assert.ok(start >= 0 && end > start, `${signature} should exist`);
  return html.slice(start, end);
}

function escapeContext() {
  const escapeHtml = value => String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]);
  const escapeJsString = value => String(value ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\r/g, '\\r').replace(/\n/g, '\\n').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  return { escapeHtml, escapeJsString, escapeInlineHandlerArg: value => escapeHtml(escapeJsString(value)) };
}

function browseErrorContext(searchContent) {
  const elements = new Map([
    ['browseSearch', { value: '' }],
    ['browseStatus', { textContent: '' }],
    ['browseResults', { innerHTML: '' }],
    ['browsePagination', { innerHTML: '' }],
  ]);
  return {
    ...escapeContext(),
    browseRequestId: 0,
    browsePage: 1,
    currentProfileId: 'qa-profile',
    currentServerId: null,
    browseTypeFilter: 'all',
    browseSource: 'modrinth',
    browseInstalledModInventory: { warning: '' },
    state: {},
    launcherBridge: { searchContent },
    document: { getElementById: id => elements.get(id) || null },
    getProfile: () => ({ id: 'qa-profile', loader: 'fabric', mcVersion: '1.21.1' }),
    getServer: () => null,
    elements,
  };
}

test('provider browse errors render as inert text for failures and thrown errors', async () => {
  const source = getFunctionSource('async function runBrowseSearch(){', '\nfunction closeModDetails(');
  const payload = '<img src=x onerror=window.name=1>';

  for (const searchContent of [
    async () => ({ ok: false, error: payload }),
    async () => { throw new Error(payload); },
  ]) {
    const context = browseErrorContext(searchContent);
    await vm.runInNewContext(`${source}\nrunBrowseSearch();`, context);
    const markup = context.elements.get('browseResults').innerHTML;
    assert.match(markup, /&lt;img src=x onerror=window\.name=1&gt;/);
    assert.doesNotMatch(markup, /<img src=/);
  }
});

test('modpack results reject executable project URLs and escape provider-controlled fields', async () => {
  const paginationSource = getFunctionSource('function renderModpackPagination(){', '\nfunction setModpackPage(');
  const source = `${paginationSource}\n${getFunctionSource('async function runModpackSearch(){', '\nasync function installSelectedModpack(')}`;
  const elements = new Map([
    ['modpackServerSelect', { value: '' }],
    ['modpackProfileSelect', { value: '' }],
    ['modpackSearch', { value: '' }],
    ['modpackStatus', { textContent: '' }],
    ['modpackResults', { innerHTML: '' }],
    ['modpackPagination', { innerHTML: '' }],
  ]);
  const context = {
    ...escapeContext(),
    modpackRequestId: 0,
    modpackSource: 'modrinth',
    modpackContext: 'profile',
    modpackTarget: 'new-profile',
    modpackPage: 1,
    modpackTotalPages: 1,
    modpackTotalHits: 0,
    modpackByKey: {},
    currentProfileId: null,
    state: { activeProfileId: 'qa-profile' },
    launcherBridge: {
      searchModpacks: async () => ({
        ok: true,
        hits: [{
          source: 'modrinth',
          id: `qa' onclick="window.name=1`,
          name: '<img src=x onerror=window.name=2>',
          desc: 'QA pack',
          downloads: 1,
          projectUrl: 'javascript:window.name=3',
        }],
      }),
    },
    document: { getElementById: id => elements.get(id) || null },
    getServer: () => null,
    getProfile: () => ({ id: 'qa-profile', loader: 'fabric', mcVersion: '1.21.1' }),
  };

  await vm.runInNewContext(`${source}\nrunModpackSearch();`, context);
  const markup = elements.get('modpackResults').innerHTML;
  assert.match(markup, /href="#"/);
  assert.doesNotMatch(markup, /href="javascript:/i);
  assert.match(markup, /&lt;img src=x onerror=window\.name=2&gt;/);
  assert.doesNotMatch(markup, /<img src=/);
  assert.doesNotMatch(markup, /onclick="installSelectedModpack\('modrinth:qa' onclick=/);
});

test('modpack search exposes provider result pages and requests the selected page', async () => {
  const source = getFunctionSource('function renderModpackPagination(){', '\nasync function installSelectedModpack(');
  const elements = new Map([
    ['modpackServerSelect', { value: '' }],
    ['modpackProfileSelect', { value: 'qa-profile' }],
    ['modpackSearch', { value: '' }],
    ['modpackStatus', { textContent: '' }],
    ['modpackResults', { innerHTML: '' }],
    ['modpackPagination', { innerHTML: '' }],
  ]);
  const requests = [];
  const context = {
    ...escapeContext(),
    modpackRequestId: 0,
    modpackSource: 'modrinth',
    modpackContext: 'profile',
    modpackTarget: 'existing-profile',
    modpackPage: 1,
    modpackTotalPages: 1,
    modpackTotalHits: 0,
    modpackByKey: {},
    currentProfileId: 'qa-profile',
    state: { activeProfileId: 'qa-profile' },
    launcherBridge: {
      searchModpacks: async params => {
        requests.push(params);
        return { ok: true, hits: [], totalHits: 61 };
      },
    },
    document: { getElementById: id => elements.get(id) || null },
    getServer: () => null,
    getProfile: () => ({ id: 'qa-profile', loader: 'fabric', mcVersion: '1.21.1' }),
  };

  await vm.runInNewContext(`${source}\nrunModpackSearch();`, context);
  assert.match(elements.get('modpackPagination').innerHTML, /Page 1 of 4/);
  await vm.runInNewContext('setModpackPage(2);', context);
  assert.equal(requests[0].page, 1);
  assert.equal(requests[1].page, 2);
  assert.match(elements.get('modpackPagination').innerHTML, /Page 2 of 4/);
});

test('unavailable cosmetic textures do not stop other 3D thumbnail renders', async () => {
  const source = getFunctionSource('function updateCosmeticThumbnail(', '\nfunction renderCosmeticsPanel(){');
  const unavailableMessage = '3D preview unavailable. Check or re-import this texture.';
  const tiles = [
    { dataset: { cosmeticThumbnail: 'missing-skin' }, innerHTML: '<img>', textContent: '', title: '' },
    { dataset: { cosmeticThumbnail: 'valid-skin' }, innerHTML: '<img>', textContent: '', title: '' },
  ];
  const selectedSkinPreview = { innerHTML: '<img>', textContent: '' };
  const canvas = { toDataURL: () => 'data:image/png;base64,capture' };
  const cosmetics = {
    skin: { id: 'missing-skin', filePath: 'missing.png' },
    cape: null,
    model: 'classic',
  };
  const warnings = [];
  const context = {
    cosmeticThumbnailCache: new Map(),
    cosmeticThumbnailRequests: new Map([
      ['missing-skin', { kind: 'skin', item: { id: 'missing-skin', name: 'Missing skin', filePath: 'missing.png' } }],
      ['valid-skin', { kind: 'skin', item: { id: 'valid-skin', name: 'Valid skin', filePath: 'valid.png' } }],
    ]),
    cosmeticThumbnailRequestId: 0,
    cosmeticThumbnailRenderer: null,
    cosmeticThumbnailKey: (_kind, item) => item.id,
    getAccountCosmeticsSnapshot: () => cosmetics,
    capitalize: value => value,
    escapeHtml: value => String(value),
    console: { warn: (...args) => warnings.push(args) },
    window: {
      MinecraftPlayerPreview: class {
        constructor() {
          this.viewer = { playerObject: { rotation: { y: 0 } }, render() {} };
        }
        setVisible() {}
        async setAppearance(skin) {
          if (skin.filePath === 'missing.png') throw new Error('Texture file is unavailable.');
        }
      },
    },
    document: {
      querySelectorAll: () => tiles,
      getElementById: id => ({
        cosmeticThumbnailCanvas: canvas,
        selectedSkinPreview,
      })[id] || null,
    },
  };

  await vm.runInNewContext(`${source}\nrenderCosmeticLibraryThumbnails();`, context);

  assert.equal(tiles[0].textContent, unavailableMessage);
  assert.equal(selectedSkinPreview.textContent, unavailableMessage);
  assert.match(tiles[1].innerHTML, /data:image\/png;base64,capture/);
  assert.equal(warnings.length, 1);
});

test('inline handler arguments escape both JavaScript string delimiters and HTML attributes', () => {
  const helper = getFunctionSource('function escapeHtml(value){', '\nfunction buildRaw(');
  const context = escapeContext();
  vm.runInNewContext(`${helper}\nthis.escapeInlineHandlerArg = escapeInlineHandlerArg;`, context);
  const escaped = context.escapeInlineHandlerArg(`a'\" onclick="x\n\u2028`);
  assert.match(escaped, /&#39;/);
  assert.match(escaped, /&quot;/);
  assert.match(escaped, /\\n/);
  assert.match(escaped, /\\u2028/);
});
