const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
const start = main.indexOf('async function chooseServerPort(server, rootPath)');
const end = main.indexOf('\nfunction isDirectDownloadServerType(', start);
assert.ok(start >= 0 && end > start, 'server port selection should exist');
const source = main.slice(start, end);

test('stopped servers may share a configured port when the port is actually free', async () => {
  const probeCalls = [];
  const context = {
    launcherState: {
      servers: [
        { id: 'current', serverPort: 25565 },
        { id: 'stopped', serverPort: 25565, status: 'idle' },
      ],
    },
    readServerPort: () => 25565,
    isPortAvailable: async port => { probeCalls.push(port); return true; },
  };
  vm.runInNewContext(`${source}\nthis.chooseServerPort = chooseServerPort;`, context);

  assert.equal(await context.chooseServerPort({ id: 'current', serverPort: 25565 }, 'unused-root'), 25565);
  assert.deepEqual(probeCalls, [25565]);
});

test('port selection still rejects a port occupied by another process', async () => {
  const context = {
    readServerPort: () => 25565,
    isPortAvailable: async () => false,
  };
  vm.runInNewContext(`${source}\nthis.chooseServerPort = chooseServerPort;`, context);

  await assert.rejects(
    context.chooseServerPort({ id: 'current', serverPort: 25565 }, 'unused-root'),
    /Port 25565 is already in use/,
  );
});
