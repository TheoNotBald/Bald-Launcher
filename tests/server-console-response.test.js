'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { waitForLogResponse } = require('../src/servers/console-response');

test('waits for a console response written after the command offset', async t => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'bald-console-response-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const logPath = path.join(folder, 'latest.log');
  fs.writeFileSync(logPath, 'old response: Saved the game\n');
  const startOffset = fs.statSync(logPath).size;
  const waiter = waitForLogResponse(logPath, /Saved the game/i, { startOffset, timeoutMs: 500, pollIntervalMs: 5 });
  setTimeout(() => fs.appendFileSync(logPath, 'new response: Saved the game\n'), 10);
  assert.equal(await waiter, true);
});

test('does not treat an old response as a new acknowledgment', async t => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'bald-console-timeout-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const logPath = path.join(folder, 'latest.log');
  fs.writeFileSync(logPath, 'Saved the game\n');
  await assert.rejects(
    waitForLogResponse(logPath, /Saved the game/i, { startOffset: fs.statSync(logPath).size, timeoutMs: 10, pollIntervalMs: 2 }),
    /did not acknowledge/,
  );
});
