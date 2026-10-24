'use strict';

function recordProfilePlaytime(profile, session, now = Date.now()) {
  if (!profile || !session || session.running !== true) return 0;
  const lastAccountedAt = Number(session.playtimeLastAccountedAt || session.playtimeStartedAt);
  const currentTime = Number(now);
  if (!Number.isFinite(lastAccountedAt) || !Number.isFinite(currentTime) || currentTime <= lastAccountedAt) return 0;

  const elapsed = currentTime - lastAccountedAt;
  profile.playtimeMs = Math.max(0, Number(profile.playtimeMs) || 0) + elapsed;
  session.playtimeLastAccountedAt = currentTime;
  return elapsed;
}

module.exports = { recordProfilePlaytime };
