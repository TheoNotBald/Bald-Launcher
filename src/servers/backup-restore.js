'use strict';

const AdmZip = require('adm-zip');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function validateZipEntries(entries, stagingPath) {
  for (const entry of entries) {
    const entryName = String(entry.entryName || '').replace(/\\/g, '/');
    if (!entryName || entryName.startsWith('/') || /^[a-zA-Z]:/.test(entryName)) {
      throw new Error('The backup contains an invalid absolute path.');
    }
    const segments = entryName.split('/');
    if (segments.includes('..')) throw new Error('The backup contains a path traversal entry.');
    const resolvedEntry = path.resolve(stagingPath, ...segments);
    const relative = path.relative(stagingPath, resolvedEntry);
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error('The backup contains an entry outside its extraction folder.');
    }
    const unixMode = (Number(entry.header?.attr) >>> 16) & 0o170000;
    if (unixMode === 0o120000) throw new Error('The backup contains a symbolic link, which cannot be restored safely.');
  }
}

function restoreWorldFromZip(archivePath, serverRoot, worldName, isValidWorld) {
  const backupsPath = path.join(serverRoot, 'backups');
  const stagingPath = path.join(backupsPath, `.restore-${crypto.randomUUID()}`);
  const worldPath = path.join(serverRoot, worldName);
  const rollbackPath = path.join(backupsPath, `${worldName}.before-restore-${Date.now()}-${crypto.randomUUID()}`);
  let previousWorldMoved = false;

  try {
    fs.mkdirSync(stagingPath, { recursive: true });
    const archive = new AdmZip(archivePath);
    const entries = archive.getEntries();
    if (!entries.length) throw new Error('The backup archive is empty.');
    validateZipEntries(entries, stagingPath);
    archive.extractAllTo(stagingPath, true);

    let restoredWorldPath = path.join(stagingPath, worldName);
    if (!fs.existsSync(restoredWorldPath)) {
      const wrappedRoot = path.join(stagingPath, path.basename(serverRoot), worldName);
      if (fs.existsSync(wrappedRoot)) restoredWorldPath = wrappedRoot;
    }
    if (!fs.existsSync(restoredWorldPath) || !isValidWorld(restoredWorldPath)) {
      throw new Error(`The backup does not contain a valid "${worldName}" Minecraft world.`);
    }

    if (fs.existsSync(worldPath)) {
      fs.renameSync(worldPath, rollbackPath);
      previousWorldMoved = true;
    }
    try {
      fs.renameSync(restoredWorldPath, worldPath);
    } catch (error) {
      if (previousWorldMoved && !fs.existsSync(worldPath)) fs.renameSync(rollbackPath, worldPath);
      previousWorldMoved = false;
      throw error;
    }
    return { rollbackPath: previousWorldMoved ? rollbackPath : null };
  } finally {
    fs.rmSync(stagingPath, { recursive: true, force: true });
  }
}

module.exports = { restoreWorldFromZip, validateZipEntries };
