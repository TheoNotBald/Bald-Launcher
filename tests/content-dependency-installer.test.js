const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { installRequiredDependencies } = require('../src/content/dependency-installer');

const html = fs.readFileSync(path.join(__dirname, '..', 'bald_launcher_v7.html'), 'utf8');

test('declining the dependency prompt leaves required mods uninstalled', async () => {
  const target = { mcVersion: '1.21.1', loader: 'fabric', mods: [] };
  const prompts = [];
  const installs = [];
  const result = await installRequiredDependencies({
    dependencies: [{ projectId: 'fabric-api' }],
    target,
    scope: { profileId: 'profile-1' },
    confirmDownload: async details => { prompts.push(details); return false; },
    searchContent: async () => ({ ok: true, hits: [{ id: 'fabric-api', slug: 'fabric-api', name: 'Fabric API', type: 'mod' }] }),
    installContent: async payload => { installs.push(payload); return { ok: true }; },
  });

  assert.equal(result.declined, true);
  assert.equal(result.installedCount, 0);
  assert.equal(prompts.length, 1);
  assert.equal(prompts[0].names[0], 'Fabric API');
  assert.deepEqual(installs, []);
  assert.deepEqual(target.mods, []);
});

test('installs exact compatible dependencies and prompts for required transitive mods', async () => {
  const target = { mcVersion: '26.2', loader: 'fabric', mods: [] };
  const prompts = [];
  const installs = [];
  const searchContent = async params => ({
    ok: true,
    hits: [{
      id: params.query,
      slug: params.query,
      name: params.query === 'fabric-api' ? 'Fabric API' : 'Config Library',
      type: 'mod',
      versionId: `latest-${params.query}`,
    }],
  });
  const installContent = async payload => {
    installs.push(payload);
    return {
      ok: true,
      entry: { id: payload.id, slug: payload.slug, name: payload.name, type: 'mod' },
      requiredDependencies: payload.id === 'fabric-api' ? [{ projectId: 'config-lib', versionId: 'pinned-config' }] : [],
    };
  };
  const result = await installRequiredDependencies({
    dependencies: [{ projectId: 'fabric-api' }],
    target,
    scope: { profileId: 'profile-2' },
    confirmDownload: async details => { prompts.push(details); return true; },
    searchContent,
    installContent,
  });

  assert.equal(result.installedCount, 2);
  assert.equal(result.declined, false);
  assert.deepEqual(prompts.map(prompt => prompt.names), [['Fabric API'], ['Config Library']]);
  assert.equal(prompts[1].transitive, true);
  assert.deepEqual(installs.map(payload => payload.id), ['fabric-api', 'config-lib']);
  assert.equal(installs[1].versionId, 'pinned-config');
  assert.equal(installs[0].profileId, 'profile-2');
  assert.deepEqual(target.mods.map(mod => mod.id), ['fabric-api', 'config-lib']);
  assert.deepEqual(result.errors, []);
});

test('server dependency installs use the server loader and update server content state', async () => {
  const target = { mcVersion: '1.21.1', serverType: 'fabric', installedContent: [] };
  let searchParameters;
  let installPayload;
  const result = await installRequiredDependencies({
    dependencies: [{ projectId: 'fabric-api' }],
    target,
    scope: { serverId: 'server-1' },
    confirmDownload: async () => true,
    searchContent: async params => {
      searchParameters = params;
      return { ok: true, hits: [{ id: 'fabric-api', slug: 'fabric-api', name: 'Fabric API', type: 'mod' }] };
    },
    installContent: async payload => {
      installPayload = payload;
      return { ok: true, entry: { id: 'fabric-api', name: 'Fabric API', type: 'mod' } };
    },
  });

  assert.equal(result.installedCount, 1);
  assert.equal(searchParameters.loader, 'fabric');
  assert.equal(searchParameters.serverType, 'fabric');
  assert.equal(installPayload.serverId, 'server-1');
  assert.equal(installPayload.profileId, undefined);
  assert.deepEqual(target.installedContent.map(entry => entry.id), ['fabric-api']);
});

test('does not install fuzzy or ambiguous project matches', async () => {
  const target = { mcVersion: '1.21.1', serverType: 'fabric', installedContent: [] };
  const installs = [];
  const result = await installRequiredDependencies({
    dependencies: [{ projectId: 'exact-id' }, { projectId: 'ambiguous-id' }],
    target,
    scope: { serverId: 'server-1' },
    confirmDownload: async () => true,
    searchContent: async params => ({
      ok: true,
      hits: params.query === 'exact-id'
        ? [{ id: 'some-other-id', slug: 'near-match', name: 'Near Match', type: 'mod' }]
        : [
          { id: 'ambiguous-id', slug: 'ambiguous-id', name: 'First match', type: 'mod' },
          { id: 'ambiguous-id', slug: 'ambiguous-id', name: 'Second match', type: 'mod' },
        ],
    }),
    installContent: async payload => { installs.push(payload); return { ok: true }; },
  });

  assert.equal(result.installedCount, 0);
  assert.equal(result.errors.length, 2);
  assert.deepEqual(installs, []);
  assert.deepEqual(target.installedContent, []);
});

test('skips dependencies already installed in the selected target', async () => {
  const target = { mcVersion: '1.21.1', loader: 'fabric', mods: [{ id: 'fabric-api' }] };
  let prompted = false;
  let searched = false;
  const result = await installRequiredDependencies({
    dependencies: [{ projectId: 'fabric-api' }],
    target,
    scope: { profileId: 'profile-3' },
    confirmDownload: async () => { prompted = true; return true; },
    searchContent: async () => { searched = true; return { ok: true, hits: [] }; },
    installContent: async () => { throw new Error('Already-installed dependency should not be downloaded.'); },
  });

  assert.equal(result.installedCount, 0);
  assert.equal(prompted, false);
  assert.equal(searched, false);
});

test('normal Browse installs hand required dependency metadata to the opt-in installer', () => {
  assert.match(html, /<script src="src\/content\/dependency-installer\.js"><\/script>/);
  assert.match(html, /requiredDependencies = result\.requiredDependencies \|\| \[\]/);
  assert.match(html, /offerRequiredContentDependencies\(result\.requiredDependencies, server/);
  assert.match(html, /offerRequiredContentDependencies\(requiredDependencies, p/);
  assert.match(html, /window\.ContentDependencyInstaller\.installRequiredDependencies/);
  assert.match(html, /Download and install \$\{names\.length === 1 \? 'this dependency' : 'these dependencies'\} now\?/);
});
