'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { shouldPromptForStaleWorldLock } = require('../src/servers/world-lock-policy');

test('a clean launcher stop does not trigger a stale world lock prompt', () => {
  assert.equal(shouldPromptForStaleWorldLock({ lastKnownState: 'stopped', lastExitCode: 0 }), false);
});

test('crashed, unknown, and unverified exits keep the stale world lock prompt', () => {
  for (const runtime of [
    { lastKnownState: 'crashed', lastExitCode: 1 },
    { lastKnownState: 'stopped', lastExitCode: null },
    { lastKnownState: 'unknown', lastExitCode: 0 },
    undefined,
  ]) {
    assert.equal(shouldPromptForStaleWorldLock(runtime), true);
  }
});
