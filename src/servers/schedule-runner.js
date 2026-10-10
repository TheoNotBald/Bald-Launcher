'use strict';

const inFlightSchedules = new Set();
const MAX_SCHEDULE_INTERVAL_MS = 720 * 60 * 60 * 1000;

function getScheduleIntervalMs(schedule) {
  const hours = Number(schedule?.intervalHours);
  const minutes = Number(schedule?.intervalMinutes);
  if (Number.isFinite(hours) && hours > 0) {
    const intervalMs = hours * 60 * 60 * 1000;
    return Number.isFinite(intervalMs) && intervalMs <= MAX_SCHEDULE_INTERVAL_MS ? intervalMs : 0;
  }
  if (Number.isFinite(minutes) && minutes > 0) {
    const intervalMs = minutes * 60 * 1000;
    return Number.isFinite(intervalMs) && intervalMs <= MAX_SCHEDULE_INTERVAL_MS ? intervalMs : 0;
  }
  return 0;
}

async function runDueSchedules(servers, { now = Date.now(), execute, persist, onError } = {}) {
  if (typeof execute !== 'function') throw new TypeError('A schedule executor is required.');
  const actionsByServer = new Map();
  let changed = false;

  for (const server of Array.isArray(servers) ? servers : []) {
    for (const schedule of Array.isArray(server?.schedules) ? server.schedules : []) {
      const nextRunAt = Number(schedule?.nextRunAt);
      const intervalMs = getScheduleIntervalMs(schedule);
      if (schedule?.enabled === false) continue;
      if (intervalMs <= 0) {
        schedule.enabled = false;
        changed = true;
        onError?.(server, schedule, new Error('Schedule interval must be between 1 minute and 720 hours.'));
        continue;
      }
      if (schedule?.nextRunAt == null || !Number.isFinite(nextRunAt) || nextRunAt > now) continue;

      const key = `${server.id}:${schedule.id}`;
      if (inFlightSchedules.has(key)) continue;
      if (!['start', 'stop', 'backup', 'command'].includes(schedule.type)) {
        schedule.enabled = false;
        changed = true;
        onError?.(server, schedule, new Error(`Unsupported scheduled action: ${String(schedule.type)}`));
        continue;
      }
      if (schedule.type === 'command' && (!String(schedule.command || '').trim() || /[\r\n\u0000]/.test(String(schedule.command || '')))) {
        schedule.enabled = false;
        changed = true;
        onError?.(server, schedule, new Error('Scheduled command must be non-empty and remain on one console line.'));
        continue;
      }

      const missedIntervals = Math.floor((now - nextRunAt) / intervalMs) + 1;
      schedule.nextRunAt = nextRunAt + missedIntervals * intervalMs;
      changed = true;
      inFlightSchedules.add(key);
      const serverKey = String(server.id);
      if (!actionsByServer.has(serverKey)) actionsByServer.set(serverKey, []);
      actionsByServer.get(serverKey).push({ key, server, schedule });
    }
  }

  if (changed) persist?.();
  await Promise.all([...actionsByServer.values()].map(async tasks => {
    for (const { key, server, schedule } of tasks) {
      try {
        const result = await execute(server, schedule);
        if (result?.ok === false) onError?.(server, schedule, new Error(result.error || 'Scheduled action failed.'));
      } catch (error) {
        onError?.(server, schedule, error);
      } finally {
        inFlightSchedules.delete(key);
      }
    }
  }));
}

module.exports = { getScheduleIntervalMs, runDueSchedules };
