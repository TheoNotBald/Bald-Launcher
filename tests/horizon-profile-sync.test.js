'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  copyDirectoryWithoutOverwrite,
  isPathWithin,
  mergeHorizonOptions,
} = require('../src/shared/horizon-profile-sync');

test('Horizon sync copies only shared visual and performance settings', () => {
  const result = mergeHorizonOptions(
    'renderDistance:32\nenableVsync:false\ncustomJavaOnly:value\n',
    'renderDistance:12\nenableVsync:true\nhorizonOnly:keep\n',
    ['options'],
  );

  assert.match(result.text, /renderDistance:32/);
  assert.match(result.text, /enableVsync:false/);
  assert.match(result.text, /horizonOnly:keep/);
  assert.doesNotMatch(result.text, /customJavaOnly/);
  assert.deepEqual(result.merged, ['renderDistance', 'enableVsync']);
});

test('Horizon sync copies only keybinds already supported by the destination', () => {
  const result = mergeHorizonOptions(
    'key_key.forward:key.keyboard.w\nkey_java_only:key.keyboard.x\n',
    'key_key.forward:key.keyboard.up\nkey_horizon_only:key.keyboard.h\n',
    ['keybinds'],
  );

  assert.match(result.text, /key_key.forward:key.keyboard.w/);
  assert.match(result.text, /key_horizon_only:key.keyboard.h/);
  assert.doesNotMatch(result.text, /key_java_only/);
  assert.deepEqual(result.merged, ['key_key.forward']);
});

test('Horizon sync preserves existing values and does not add unsupported keybinds', () => {
  const result = mergeHorizonOptions(
    'renderDistance:32\nkey_key.forward:key.keyboard.w\n',
    'horizonOnly:keep\n',
    ['keybinds'],
  );

  assert.match(result.text, /horizonOnly:keep/);
  assert.doesNotMatch(result.text, /key_key.forward/);
  assert.doesNotMatch(result.text, /renderDistance/);
  assert.deepEqual(result.merged, []);
});

test('Horizon resource-pack sync preserves existing files and skips conflicts', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'horizon-profile-sync-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'source', 'pack.zip');
  const destinationRoot = path.join(root, 'profile');
  const destination = path.join(destinationRoot, 'resourcepacks', 'pack.zip');
  fs.mkdirSync(path.dirname(source), { recursive: true });
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(source, 'source-pack');
  fs.writeFileSync(destination, 'existing-pack');

  assert.deepEqual(copyDirectoryWithoutOverwrite(
    source,
    destination,
    destinationRoot,
  ), { copied: 0, skipped: 1 });
  assert.equal(fs.readFileSync(destination, 'utf8'), 'existing-pack');
});

test('Horizon resource-pack sync rejects symlinked destination parents', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'horizon-profile-sync-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'source.zip');
  const destinationRoot = path.join(root, 'profile');
  const externalDirectory = path.join(root, 'external');
  fs.mkdirSync(destinationRoot, { recursive: true });
  fs.mkdirSync(externalDirectory, { recursive: true });
  fs.writeFileSync(source, 'source-pack');
  try {
    fs.symlinkSync(externalDirectory, path.join(destinationRoot, 'resourcepacks'), 'junction');
  } catch (error) {
    if (['EACCES', 'EPERM', 'ENOTSUP'].includes(error.code)) {
      t.skip(`The test environment cannot create directory junctions: ${error.message}`);
      return;
    }
    throw error;
  }

  assert.throws(
    () => copyDirectoryWithoutOverwrite(
      source,
      path.join(destinationRoot, 'resourcepacks', 'source.zip'),
      destinationRoot,
    ),
    /symbolic links/,
  );
  assert.equal(fs.existsSync(path.join(externalDirectory, 'source.zip')), false);
});

test('Horizon resource-pack sync rejects a destination nested inside its source', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'horizon-profile-sync-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'source');
  const destinationRoot = path.join(source, 'profile');
  const destination = path.join(destinationRoot, 'resourcepacks');
  fs.mkdirSync(destination, { recursive: true });

  assert.throws(
    () => copyDirectoryWithoutOverwrite(source, destination, destinationRoot),
    /source directory cannot contain its destination/,
  );
});

test('Horizon sync path checks include the root itself and reject escapes', () => {
  const root = path.join(os.tmpdir(), 'horizon-profile-sync');
  assert.equal(isPathWithin(root, root), true);
  assert.equal(isPathWithin(root, path.join(root, 'instances', 'profile')), true);
  assert.equal(isPathWithin(root, path.join(root, '..', 'outside')), false);
});
