const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { runInstallerProcess } = require('../src/shared/run-installer');

function createChild() {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  return child;
}

test('streams installer output without buffering the full process output', async () => {
  const child = createChild();
  const statuses = [];
  let spawnArguments;
  const run = runInstallerProcess(
    (...args) => {
      spawnArguments = args;
      return child;
    },
    'java.exe',
    'forge-installer.jar',
    ['--installClient', 'C:\\Minecraft'],
    'C:\\Minecraft',
    status => statuses.push(status),
  );
  const largeOutput = `${'installer output\n'.repeat(100_000)}complete`;
  child.stdout.write(largeOutput);
  child.stdout.end();
  child.stderr.end();
  child.emit('close', 0, null);

  await run;
  assert.deepEqual(spawnArguments, [
    'java.exe',
    ['-jar', 'forge-installer.jar', '--installClient', 'C:\\Minecraft'],
    {
      cwd: 'C:\\Minecraft',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  ]);
  assert.equal(statuses.at(-1), 'complete');
});

test('reports installer failure with bounded stderr details', async () => {
  const child = createChild();
  const run = runInstallerProcess(() => child, 'java.exe', 'installer.jar', [], 'C:\\Minecraft');
  child.stderr.write(`${'x'.repeat(20_000)}\ninstallation failed`);
  child.emit('close', 1, null);

  await assert.rejects(run, /Loader installer failed with exit code 1:[\s\S]*installation failed/);
});

test('reports a process startup error', async () => {
  const child = createChild();
  const run = runInstallerProcess(() => child, 'missing-java.exe', 'installer.jar', [], 'C:\\Minecraft');
  child.emit('error', new Error('spawn missing-java.exe ENOENT'));

  await assert.rejects(run, /Could not start loader installer: spawn missing-java\.exe ENOENT/);
});
