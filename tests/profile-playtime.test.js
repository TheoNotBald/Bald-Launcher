'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { recordProfilePlaytime } = require('../src/shared/profile-playtime');

test('records elapsed time only for a running profile session', () => {
  const profile = { playtimeMs: 60_000 };
  const session = { running: true, playtimeStartedAt: 1000, playtimeLastAccountedAt: 1000 };

  assert.equal(recordProfilePlaytime(profile, session, 16_000), 15_000);
  assert.equal(profile.playtimeMs, 75_000);
  assert.equal(session.playtimeLastAccountedAt, 16_000);
});

test('does not count stopped or backwards-time sessions', () => {
  const profile = { playtimeMs: 0 };
  const session = { running: false, playtimeStartedAt: 1000, playtimeLastAccountedAt: 1000 };

  assert.equal(recordProfilePlaytime(profile, session, 2000), 0);
  session.running = true;
  assert.equal(recordProfilePlaytime(profile, session, 500), 0);
  assert.equal(profile.playtimeMs, 0);
});

test('does not mutate a profile if playtime session timestamps are missing', () => {
  const profile = {};
  assert.equal(recordProfilePlaytime(profile, { running: true }, 5000), 0);
  assert.equal(profile.playtimeMs, undefined);
});
