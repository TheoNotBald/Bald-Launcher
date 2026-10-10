const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', 'bald_launcher_v7.html'), 'utf8').replace(/\r\n/g, '\n');

function sourceRange(source, startText, endText, description) {
  const start = source.indexOf(startText);
  const end = source.indexOf(endText, start);
  assert.ok(start >= 0 && end > start, description);
  return source.slice(start, end);
}

test('renderer rejects invalid numeric server settings and multiline MOTDs without persisting them', async () => {
  const handler = sourceRange(html, 'async function saveServerSetting(key, value)', '\nasync function uploadServerIcon(', 'server settings handler should exist');
  const alerts = [];
  const server = { id: 'qa-server', status: 'idle', serverPort: 25565, worldName: 'world', maxPlayers: 20, memoryMax: 4, viewDistance: 10, simulationDistance: 10 };
  const context = {
    currentServerId: server.id,
    state: { servers: [server] },
    getServer: id => context.state.servers.find(entry => entry.id === id),
    alert: message => alerts.push(String(message)),
    confirm: () => true,
    renderServers() {},
    renderServerDetail() {},
    launcherBridge: {
      syncState: async next => { context.state.servers = next.servers; },
      writeServerSettings: async () => ({ ok: true }),
    },
  };
  vm.runInNewContext(`${handler}\nthis.saveServerSetting = saveServerSetting;`, context);

  await context.saveServerSetting('maxPlayers', String(Number.MAX_SAFE_INTEGER + 1));
  await context.saveServerSetting('memoryMax', '33');
  await context.saveServerSetting('viewDistance', '64');
  await context.saveServerSetting('simulationDistance', '1');
  await context.saveServerSetting('motd', 'QA\nserver-port=12346');
  await context.saveServerSetting('serverPort', '65536');
  await context.saveServerSetting('worldName', '..');

  assert.deepEqual(
    [context.state.servers[0].maxPlayers, context.state.servers[0].memoryMax, context.state.servers[0].viewDistance, context.state.servers[0].simulationDistance, context.state.servers[0].motd, context.state.servers[0].serverPort, context.state.servers[0].worldName],
    [20, 4, 10, 10, undefined, 25565, 'world'],
  );
  assert.equal(alerts.length, 7);
  assert.ok(alerts.some(message => message.includes('MOTD must be a single line')));
});

test('main-process server normalization bounds settings and prevents world-path and property-line injection', t => {
  const normalizeSource = sourceRange(main, 'function normalizeServer(server)', '\nfunction getEffectiveServerMemory(', 'server normalizer should exist');
  const propertiesSource = sourceRange(main, 'function updateServerProperties(server,', '\nipcMain.handle(\'launcher:stop-server\'', 'server properties writer should exist');
  const rootPath = fs.mkdtempSync(path.join(os.tmpdir(), 'bald-server-settings-'));
  t.after(() => fs.rmSync(rootPath, { recursive: true, force: true }));

  const context = {
    path: { isAbsolute: () => false, normalize: value => value, join: (...parts) => path.join(...parts), relative: (...parts) => path.relative(...parts) },
    fs,
    normalizeInstalledContent: entry => entry,
    sanitizeServerFolderName: value => value,
    normalizeServerAddress: value => value || '',
    ensureServerRoot: () => rootPath,
    getServerRoot: () => rootPath,
    readServerPort: () => 25565,
    Date,
  };
  vm.runInNewContext(`${normalizeSource}\n${propertiesSource}\nthis.normalizeServer = normalizeServer;\nthis.updateServerProperties = updateServerProperties;`, context);

  const server = context.normalizeServer({
    id: 'qa-server',
    rootPath,
    serverPort: 0,
    memoryMax: 3.5,
    maxPlayers: Number.MAX_VALUE,
    viewDistance: 64,
    simulationDistance: 1,
    worldName: '..',
    motd: 'QA\r\nserver-port=12346',
  });
  assert.equal(server.serverPort, 25565);
  assert.equal(server.memoryMax, 4);
  assert.equal(server.maxPlayers, 20);
  assert.equal(server.viewDistance, 32);
  assert.equal(server.simulationDistance, 2);
  assert.equal(server.worldName, 'world');
  assert.equal(server.motd, 'QA server-port=12346');

  context.updateServerProperties(server);
  const properties = fs.readFileSync(path.join(rootPath, 'server.properties'), 'utf8');
  assert.equal((properties.match(/^server-port=/gm) || []).length, 1);
  assert.match(properties, /^server-port=25565$/m);
  assert.doesNotMatch(properties, /^server-port=12346$/m);
});
