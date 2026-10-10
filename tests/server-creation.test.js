const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'bald_launcher_v7.html'), 'utf8').replace(/\r\n/g, '\n');
const start = html.indexOf('async function submitNewServer(){');
const end = html.indexOf('\nfunction setServerTab(', start);
assert.ok(start >= 0 && end > start, 'server creation handler should exist');
const handler = html.slice(start, end);

function createContext(createServer) {
  const elements = {
    nsName: { value: 'QA Server' },
    nsVersion: { value: '1.21.1' },
    nsServerType: { value: 'paper' },
    nsMemory: { value: '4' },
    nsNetworkingMode: { value: 'playit' },
    newServerModal: { style: { display: 'flex' } },
    sbStatus: { textContent: '' },
  };
  const alerts = [];
  const calls = [];
  const context = {
    document: { getElementById: id => elements[id] },
    launcherBridge: createServer ? { createServer } : null,
    state: { servers: [] },
    serverConsoleLogs: {},
    closeNewServerModal() { elements.newServerModal.style.display = 'none'; },
    renderServers() { calls.push('renderServers'); },
    openServerDetail(id) { calls.push(`openServerDetail:${id}`); },
    alert(message) { alerts.push(message); },
    console: { error() {} },
    Date,
  };
  vm.runInNewContext(`${handler}\nthis.submitNewServer = submitNewServer;`, context);
  return { context, elements, alerts, calls };
}

test('server creation IPC failure is reported without adding a phantom server', async () => {
  const { context, elements, alerts, calls } = createContext(async () => ({ ok: false, error: 'Server storage is unavailable.' }));
  await context.submitNewServer();
  assert.deepEqual(Array.from(context.state.servers), []);
  assert.deepEqual(alerts, ['Server storage is unavailable.']);
  assert.equal(elements.newServerModal.style.display, 'flex');
  assert.deepEqual(calls, []);
});

test('server creation IPC exception is reported without falling back to local-only state', async () => {
  const { context, elements, alerts, calls } = createContext(async () => { throw new Error('IPC disconnected'); });
  await context.submitNewServer();
  assert.deepEqual(Array.from(context.state.servers), []);
  assert.deepEqual(alerts, ['Could not create server: IPC disconnected']);
  assert.equal(elements.newServerModal.style.display, 'flex');
  assert.deepEqual(calls, []);
});

test('server creation stores only the server returned by the launcher bridge', async () => {
  const server = { id: 'server-created', name: 'QA Server' };
  const { context, elements, alerts, calls } = createContext(async payload => {
    assert.equal(payload.name, 'QA Server');
    return { ok: true, server };
  });
  await context.submitNewServer();
  assert.deepEqual(Array.from(context.state.servers), [server]);
  assert.equal(context.serverConsoleLogs[server.id].length, 0);
  assert.equal(elements.newServerModal.style.display, 'none');
  assert.deepEqual(alerts, []);
  assert.deepEqual(calls, ['renderServers', 'openServerDetail:server-created']);
});

test('server creation keeps the local preview fallback when no launcher bridge exists', async () => {
  const { context, elements, alerts, calls } = createContext(null);
  await context.submitNewServer();
  assert.equal(context.state.servers.length, 1);
  assert.equal(context.state.servers[0].name, 'QA Server');
  assert.equal(context.state.servers[0].mcVersion, '1.21.1');
  assert.equal(context.state.servers[0].serverType, 'paper');
  assert.equal(elements.newServerModal.style.display, 'none');
  assert.deepEqual(alerts, []);
  assert.equal(calls[0], 'renderServers');
  assert.match(calls[1], /^openServerDetail:server-/);
});
