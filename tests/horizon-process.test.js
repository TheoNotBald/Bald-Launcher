'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough, Writable } = require('node:stream');
const {
  closeHorizonGameWindows,
  createHorizonWindowController,
  minimizeHorizonGameWindows,
  restoreHorizonGameWindows,
} = require('../src/shared/horizon-process');

function createSpawn(output, calls) {
  return (executable, args, options) => {
    calls.push({ executable, args, options });
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => {};
    setImmediate(() => {
      child.stdout.end(output);
      child.emit('close', 0, null);
    });
    return child;
  };
}

function createControllerSpawn(calls) {
  return (executable, args, options) => {
    calls.push({ executable, args, options });
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => child.emit('close', 1, null);
    child.stdin = new Writable({
      write(chunk, encoding, callback) {
        const request = JSON.parse(chunk.toString('utf8'));
        calls.push(request);
        setImmediate(() => child.stdout.write(`${JSON.stringify({ id: request.id, windows: 1 })}\n`));
        callback();
      },
      final(callback) {
        setImmediate(() => child.emit('close', 0, null));
        callback();
      },
    });
    setImmediate(() => child.stdout.write('{"ready":true}\n'));
    return child;
  };
}

test('Horizon warm-start window controls minimize and restore the client window', async () => {
  for (const [action, control, expectedWait] of [
    ['minimize', minimizeHorizonGameWindows, '1'],
    ['restore', restoreHorizonGameWindows, '0'],
  ]) {
    const calls = [];
    const result = await control(1234, { platform: 'win32', spawnProcess: createSpawn('1', calls) });
    assert.deepEqual(result, { windows: 1 });
    assert.equal(calls[0].executable, 'powershell.exe');
    assert.equal(calls[0].options.env.BALD_HORIZON_ROOT_PID, '1234');
    assert.equal(calls[0].options.env.BALD_HORIZON_WINDOW_ACTION, action);
    assert.equal(calls[0].options.env.BALD_HORIZON_WAIT_FOR_WINDOW, expectedWait);
  }
});

test('Horizon game-window close remains graceful and reports missing windows', async () => {
  const calls = [];
  const result = await closeHorizonGameWindows(4321, {
    platform: 'win32',
    spawnProcess: createSpawn('0', calls),
  });
  assert.deepEqual(result, { windows: 0 });
  assert.equal(calls[0].options.env.BALD_HORIZON_WINDOW_ACTION, 'close');
  assert.equal(calls[0].options.env.BALD_HORIZON_WAIT_FOR_WINDOW, '0');
});

test('persistent Horizon window controller reuses its PowerShell process for controls', async () => {
  const calls = [];
  const controller = createHorizonWindowController({
    platform: 'win32',
    spawnProcess: createControllerSpawn(calls),
  });

  await controller.ready;
  assert.equal(calls[0].options.windowsHide, true);
  assert.deepEqual(await controller.control(0, 'hide-terminal', { waitForWindow: false }), { windows: 1 });
  assert.deepEqual(await controller.control(0, 'hide-prewarm', { waitForWindow: false }), { windows: 1 });
  await assert.rejects(controller.control(0, 'hide'), /valid Horizon launcher process ID/);
  assert.deepEqual(await controller.control(1234, 'hide', { waitForWindow: true }), { windows: 1 });
  assert.deepEqual(await controller.control(1234, 'hide-terminal', { waitForWindow: false }), { windows: 1 });
  assert.deepEqual(await controller.control(1234, 'minimize', { waitForWindow: true }), { windows: 1 });
  assert.deepEqual(await controller.control(1234, 'mute-process-audio', { waitForWindow: false }), { windows: 1 });
  assert.deepEqual(await controller.control(1234, 'restore-process-audio', { waitForWindow: false }), { windows: 1 });
  assert.deepEqual(await controller.control(1234, 'limit-process-tree', { waitForWindow: false }), { windows: 1 });
  assert.deepEqual(await controller.control(1234, 'restore-process-limits', { waitForWindow: false }), { windows: 1 });
  assert.deepEqual(await controller.control(1234, 'restore'), { windows: 1 });
  assert.equal(calls.filter(call => typeof call === 'object' && 'rootPid' in call).length, 10);
  assert.equal(calls[1].action, 'hide-terminal');
  assert.equal(calls[1].rootPid, 0);
  assert.equal(calls[2].action, 'hide-prewarm');
  assert.equal(calls[2].rootPid, 0);
  assert.equal(calls[3].action, 'hide');
  assert.equal(calls[4].action, 'hide-terminal');
  assert.equal(calls[5].action, 'minimize');
  assert.equal(calls[6].action, 'mute-process-audio');
  assert.equal(calls[7].action, 'restore-process-audio');
  assert.equal(calls[8].action, 'limit-process-tree');
  assert.equal(calls[9].action, 'restore-process-limits');
  assert.equal(calls[10].action, 'restore');
  assert.match(calls[0].args[3], /PrewarmCpuRate = 5000/);
  await controller.close();
  await assert.rejects(controller.control(1234, 'restore'), /closed/);
});

test('persistent window controller can hide, restore, and close Java process windows', async () => {
  const calls = [];
  const controller = createHorizonWindowController({
    platform: 'win32',
    spawnProcess: createControllerSpawn(calls),
  });

  await controller.ready;
  assert.deepEqual(await controller.control(5678, 'hide-process', { waitForWindow: true }), { windows: 1 });
  assert.deepEqual(await controller.control(5678, 'restore-process', { waitForWindow: false }), { windows: 1 });
  assert.deepEqual(await controller.control(5678, 'close-process', { waitForWindow: false }), { windows: 1 });
  assert.deepEqual(calls.filter(call => typeof call === 'object' && 'rootPid' in call).map(call => call.action), [
    'hide-process',
    'restore-process',
    'close-process',
  ]);
  assert.match(calls[0].args[3], /close-process.*hide-process.*restore-process/);
  await controller.close();
});

test('Horizon window controls validate process IDs and platform', async () => {
  await assert.rejects(minimizeHorizonGameWindows(0, { platform: 'win32' }), /valid Horizon launcher process ID/);
  await assert.rejects(restoreHorizonGameWindows(1234, { platform: 'linux' }), /supported on Windows only/);
  assert.throws(() => createHorizonWindowController({ platform: 'linux' }), /supported on Windows only/);
});

test('Horizon PowerShell window controller runs when no game window exists', { skip: process.platform !== 'win32' }, async () => {
  const result = await minimizeHorizonGameWindows(process.pid, {
    waitForWindow: false,
    timeoutMs: 10_000,
  });
  assert.deepEqual(result, { windows: 0 });
});

test('persistent Horizon window controller starts and controls windows on Windows', { skip: process.platform !== 'win32' }, async () => {
  const controller = createHorizonWindowController();
  try {
    await controller.ready;
    const hidden = await controller.control(process.pid, 'hide', {
      waitForWindow: false,
      timeoutMs: 10_000,
    });
    const result = await controller.control(process.pid, 'restore', {
      waitForWindow: false,
      timeoutMs: 10_000,
    });
    assert.deepEqual(hidden, { windows: 0 });
    assert.deepEqual(result, { windows: 0 });
  } finally {
    await controller.close();
  }
});
