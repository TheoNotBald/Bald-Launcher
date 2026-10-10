'use strict';

const assert = require('node:assert/strict');
const AdmZip = require('adm-zip');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { restoreWorldFromZip, validateZipEntries } = require('../src/servers/backup-restore');

test('restore stages and validates world before replacing it, retaining the previous world', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bald-restore-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const world = path.join(root, 'world');
  fs.mkdirSync(world);
  fs.writeFileSync(path.join(world, 'level.dat'), 'old');
  const archivePath = path.join(root, 'backup.zip');
  const archive = new AdmZip();
  archive.addFile('world/level.dat', Buffer.from('restored'));
  archive.writeZip(archivePath);

  const result = restoreWorldFromZip(archivePath, root, 'world', candidate => fs.readFileSync(path.join(candidate, 'level.dat'), 'utf8') === 'restored');
  assert.equal(fs.readFileSync(path.join(world, 'level.dat'), 'utf8'), 'restored');
  assert.ok(result.rollbackPath);
  assert.equal(fs.readFileSync(path.join(result.rollbackPath, 'level.dat'), 'utf8'), 'old');
});

test('invalid backup world leaves existing world untouched', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bald-restore-invalid-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const world = path.join(root, 'world');
  fs.mkdirSync(world);
  fs.writeFileSync(path.join(world, 'level.dat'), 'old');
  const archivePath = path.join(root, 'invalid.zip');
  const archive = new AdmZip();
  archive.addFile('world/not-level.dat', Buffer.from('invalid'));
  archive.writeZip(archivePath);

  assert.throws(() => restoreWorldFromZip(archivePath, root, 'world', () => false), /valid "world" Minecraft world/);
  assert.equal(fs.readFileSync(path.join(world, 'level.dat'), 'utf8'), 'old');
});

test('backup entry validation rejects traversal, absolute paths, and symlinks', () => {
  const stagingPath = path.join(os.tmpdir(), 'staging');
  assert.throws(() => validateZipEntries([{ entryName: '../outside' }], stagingPath), /path traversal/);
  assert.throws(() => validateZipEntries([{ entryName: 'C:/outside' }], stagingPath), /absolute path/);
  assert.throws(() => validateZipEntries([{ entryName: 'link', header: { attr: 0o120777 << 16 } }], stagingPath), /symbolic link/);
});
