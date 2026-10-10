'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { ensureLauncherProfilesFile } = require('../src/shared/launcher-profiles');

test('creates minimal launcher metadata when no official launcher profile exists', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bald-launcher-profile-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  assert.equal(ensureLauncherProfilesFile(root), true);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, 'launcher_profiles.json'), 'utf8')), {
    profiles: {},
    settings: {},
    version: 3,
  });
  assert.equal(ensureLauncherProfilesFile(root), false);
});

test('preserves an existing launcher profile file', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bald-launcher-profile-existing-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const profilePath = path.join(root, 'launcher_profiles.json');
  const original = '{"profiles":{"keep-me":{}},"version":3}\n';
  fs.writeFileSync(profilePath, original);

  assert.equal(ensureLauncherProfilesFile(root), false);
  assert.equal(fs.readFileSync(profilePath, 'utf8'), original);
});

test('recognizes Microsoft Store launcher metadata without creating a second profile file', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bald-launcher-profile-store-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const storePath = path.join(root, 'launcher_profiles_microsoft_store.json');
  fs.writeFileSync(storePath, '{}');

  assert.equal(ensureLauncherProfilesFile(root), false);
  assert.equal(fs.existsSync(path.join(root, 'launcher_profiles.json')), false);
});
