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
  const source = getFunctionSource('async function runModpackSearch(){', '\nasync function installSelectedModpack(');
  const elements = new Map([
    ['modpackServerSelect', { value: '' }],
    ['modpackProfileSelect', { value: '' }],
    ['modpackSearch', { value: '' }],
    ['modpackStatus', { textContent: '' }],
    ['modpackResults', { innerHTML: '' }],
  ]);
  const context = {
    ...escapeContext(),
    modpackRequestId: 0,
    modpackSource: 'modrinth',
    modpackContext: 'profile',
    modpackTarget: 'new-profile',
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
