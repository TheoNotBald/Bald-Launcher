'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const SNAPSHOT_NAME_PATTERN = /^launcher-state-\d{4}-\d{2}-\d{2}T.*\.json$/;

function createStateSafetySnapshot({
  stateFilePath,
  backupRoot,
  fsImpl = fs,
  now = new Date(),
  maxSnapshots = 10,
  logger = console,
}) {
  fsImpl.mkdirSync(backupRoot, { recursive: true });
  let createdSnapshot = null;
  if (stateFilePath && fsImpl.existsSync(stateFilePath)) {
    const snapshotName = `launcher-state-${now.toISOString().replace(/[:.]/g, '-')}-${crypto.randomUUID()}.json`;
    createdSnapshot = path.join(backupRoot, snapshotName);
    try {
      fsImpl.copyFileSync(stateFilePath, createdSnapshot, fs.constants.COPYFILE_EXCL);
      if (fsImpl.statSync(createdSnapshot).size !== fsImpl.statSync(stateFilePath).size) {
        throw new Error('The launcher state snapshot size does not match the source.');
      }
    } catch (error) {
      try {
        fsImpl.rmSync(createdSnapshot, { force: true });
      } catch (cleanupError) {
        logger.warn('[Updater] Could not remove incomplete state snapshot:', cleanupError);
      }
      throw error;
    }
  }

  try {
    const snapshots = fsImpl.readdirSync(backupRoot, { withFileTypes: true })
      .filter(entry => entry.isFile() && SNAPSHOT_NAME_PATTERN.test(entry.name))
      .map(entry => {
        const snapshotPath = path.join(backupRoot, entry.name);
        return { path: snapshotPath, modifiedAt: fsImpl.statSync(snapshotPath).mtimeMs };
      })
      .sort((left, right) => {
        if (left.path === createdSnapshot) return -1;
        if (right.path === createdSnapshot) return 1;
        return right.modifiedAt - left.modifiedAt;
      });
    for (const oldSnapshot of snapshots.slice(Math.max(0, maxSnapshots))) {
      try {
        fsImpl.unlinkSync(oldSnapshot.path);
      } catch (error) {
        logger.warn('[Updater] Could not prune old state snapshot:', error);
      }
    }
  } catch (error) {
    logger.warn('[Updater] Could not prune old state snapshots:', error);
  }

  return createdSnapshot;
}

module.exports = { createStateSafetySnapshot };
