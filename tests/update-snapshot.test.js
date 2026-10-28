'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createStateSafetySnapshot } = require('../src/shared/update-snapshot');

test('creates a state snapshot and prunes only old launcher-state files', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bald-update-snapshot-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const backupRoot = path.join(root, 'update-backups');
  const source = path.join(root, 'launcher-state.json');
  const unrelatedDirectory = path.join(backupRoot, 'launcher-0.1.11-before-repair');
  fs.mkdirSync(unrelatedDirectory, { recursive: true });
  fs.writeFileSync(path.join(unrelatedDirectory, 'app.asar'), 'preserve');
  fs.writeFileSync(source, 'current launcher state');
  fs.mkdirSync(backupRoot, { recursive: true });
  for (let index = 0; index < 10; index += 1) {
    fs.writeFileSync(
      path.join(backupRoot, `launcher-state-2026-10-${String(index + 1).padStart(2, '0')}T00-00-00-000Z.json`),
      `old ${index}`,
    );
  }

  const snapshot = createStateSafetySnapshot({
    stateFilePath: source,
    backupRoot,
    now: new Date('2026-10-28T03:16:12.966Z'),
  });

  assert.equal(fs.readFileSync(snapshot, 'utf8'), 'current launcher state');
  assert.equal(fs.existsSync(path.join(unrelatedDirectory, 'app.asar')), true);
  const stateSnapshots = fs.readdirSync(backupRoot)
    .filter(name => /^launcher-state-.*\.json$/.test(name));
  assert.equal(stateSnapshots.length, 10);
  assert.equal(stateSnapshots.includes(path.basename(snapshot)), true);
});

test('fails safely if the state snapshot cannot be created', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bald-update-snapshot-error-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'launcher-state.json');
  fs.writeFileSync(source, 'state');

  assert.throws(() => createStateSafetySnapshot({
    stateFilePath: source,
    backupRoot: path.join(root, 'backups'),
    fsImpl: {
      mkdirSync: fs.mkdirSync.bind(fs),
      existsSync: fs.existsSync.bind(fs),
      copyFileSync: () => {
        const error = new Error('permission denied');
        error.code = 'EACCES';
        throw error;
      },
      rmSync: fs.rmSync.bind(fs),
      readdirSync: fs.readdirSync.bind(fs),
      statSync: fs.statSync.bind(fs),
      unlinkSync: fs.unlinkSync.bind(fs),
    },
  }), /permission denied/);
});
