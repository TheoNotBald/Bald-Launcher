'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { getScheduleIntervalMs, runDueSchedules } = require('../src/servers/schedule-runner');

test('schedule intervals honor hours and minutes', () => {
  assert.equal(getScheduleIntervalMs({ intervalHours: 3, intervalMinutes: 0 }), 3 * 60 * 60 * 1000);
  assert.equal(getScheduleIntervalMs({ intervalMinutes: 15 }), 15 * 60 * 1000);
  assert.equal(getScheduleIntervalMs({ intervalMinutes: 0 }), 0);
});

test('due schedules execute once and advance past missed intervals before persisting', async () => {
  const now = 10_000_000;
  const server = { id: 'server-a', schedules: [{ id: 'backup', type: 'backup', enabled: true, intervalHours: 3, intervalMinutes: 0, nextRunAt: now - 7 * 60 * 60 * 1000 }] };
  const actions = [];
  let persisted = 0;
  await runDueSchedules([server], {
    now,
    execute: async (_server, schedule) => actions.push(schedule.type),
    persist: () => { persisted += 1; },
  });
  assert.deepEqual(actions, ['backup']);
  assert.equal(server.schedules[0].nextRunAt, now + 2 * 60 * 60 * 1000);
  assert.equal(persisted, 1);
});

test('overlapping scheduler ticks do not run an action twice', async () => {
  const server = { id: 'server-b', schedules: [{ id: 'start', type: 'start', enabled: true, intervalMinutes: 1, nextRunAt: 1 }] };
  let release;
  let runs = 0;
  const options = {
    now: 1000,
    execute: () => {
      runs += 1;
      return new Promise(resolve => { release = resolve; });
    },
  };
  const firstTick = runDueSchedules([server], options);
  await new Promise(resolve => setImmediate(resolve));
  await runDueSchedules([server], options);
  assert.equal(runs, 1);
  release({ ok: true });
  await firstTick;
});

test('due actions for the same server run sequentially', async () => {
  const server = { id: 'server-d', schedules: [
    { id: 'stop', type: 'stop', enabled: true, intervalMinutes: 1, nextRunAt: 1 },
    { id: 'backup', type: 'backup', enabled: true, intervalMinutes: 1, nextRunAt: 1 },
  ] };
  const order = [];
  await runDueSchedules([server], {
    now: 1000,
    execute: async (_server, schedule) => {
      order.push(`${schedule.type}-start`);
      await new Promise(resolve => setImmediate(resolve));
      order.push(`${schedule.type}-end`);
    },
  });
  assert.deepEqual(order, ['stop-start', 'stop-end', 'backup-start', 'backup-end']);
});

test('invalid scheduled actions are disabled and reported rather than retried silently', async () => {
  const schedule = { id: 'bad', type: 'command', enabled: true, intervalMinutes: 1, nextRunAt: 1, command: '  ' };
  const errors = [];
  await runDueSchedules([{ id: 'server-c', schedules: [schedule] }], {
    now: 1000,
    execute: () => assert.fail('Invalid action must not run'),
    onError: (_server, _schedule, error) => errors.push(error.message),
  });
  assert.equal(schedule.enabled, false);
  assert.deepEqual(errors, ['Scheduled command must be non-empty and remain on one console line.']);
});
