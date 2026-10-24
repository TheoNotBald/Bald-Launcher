'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createPlayitManager } = require('../playit-manager');

function createFixture(t, { exitOnInterrupt = true, exitOnKill = true } = {}) {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'bald-playit-'));
  t.after(() => fs.rmSync(userData, { recursive: true, force: true }));
  const executablePath = path.join(userData, 'playit', 'playit.exe');
  fs.mkdirSync(path.dirname(executablePath), { recursive: true });
  fs.writeFileSync(executablePath, '');
  const process = new EventEmitter();
  process.pid = 12345;
  process.onData = callback => { process.dataCallback = callback; };
  process.onExit = callback => { process.exitCallback = callback; };
  process.write = value => {
    if (value === '\u0003' && exitOnInterrupt) process.exitCallback({ exitCode: 0, signal: null });
  };
  process.kill = () => {
    if (exitOnKill) process.exitCallback({ exitCode: 1, signal: 9 });
  };
  const manager = createPlayitManager({
    app: { getPath: () => userData },
    shell: { openExternal: async () => {} },
    emit: () => {},
    pty: { spawn: () => process },
    stopTimeoutMs: 5,
  });
  return { manager, process };
}

test('Playit stop confirms exit and reports a stopped state after graceful shutdown', async t => {
  const { manager } = createFixture(t);
  assert.equal(manager.start().ok, true);
  const result = await manager.stop();
  assert.equal(result.ok, true);
  assert.equal(result.status, 'stopped');
  assert.equal(result.pid, null);
});

test('Playit stop does not report success while the agent remains alive', async t => {
  const { manager } = createFixture(t, { exitOnInterrupt: false, exitOnKill: false });
  assert.equal(manager.start().ok, true);
  const result = await manager.stop();
  assert.equal(result.ok, false);
  assert.equal(result.status, 'stopping');
  assert.equal(result.pid, 12345);
});

test('Playit restart does not spawn another agent if the old process fails to stop', async t => {
  const { manager } = createFixture(t, { exitOnInterrupt: false, exitOnKill: false });
  assert.equal(manager.start().ok, true);
  const result = await manager.restart();
  assert.equal(result.ok, false);
  assert.equal(result.pid, 12345);
});

test('Playit background mode records a detached process and leaves it running on launcher detach', async t => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'bald-playit-background-'));
  t.after(() => fs.rmSync(userData, { recursive: true, force: true }));
  const executablePath = path.join(userData, 'playit', 'playit.exe');
  fs.mkdirSync(path.dirname(executablePath), { recursive: true });
  fs.writeFileSync(executablePath, '');
  const child = new EventEmitter();
  child.pid = 54321;
  child.exitCode = null;
  child.unref = () => {};
  child.kill = () => { child.exitCode = 0; };
  const manager = createPlayitManager({
    app: { getPath: () => userData },
    shell: { openExternal: async () => {} },
    emit: () => {},
    spawnProcess: () => child,
    isProcessAlive: pid => pid === child.pid && child.exitCode == null,
  });
  const started = manager.start({ keepRunningOnClose: true });
  assert.equal(started.ok, true);
  assert.equal(started.persistent, true);
  assert.equal(started.pid, child.pid);
  assert.equal(manager.write('help').ok, false);

  const detached = manager.detach();
  assert.equal(detached.ok, true);
  assert.equal(detached.persistent, true);
  assert.equal(detached.pid, child.pid);
  assert.equal(child.exitCode, null);

  child.exitCode = 0;
  child.emit('exit', 0, null);
});
