'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { PRESET, setVanillaPerformancePreset } = require('../src/shared/vanilla-performance');

function createPaths(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bald-vanilla-performance-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return {
    optionsPath: path.join(root, 'profile', 'options.txt'),
    backupPath: path.join(root, 'launcher', 'performance-backup.json'),
  };
}

test('applies the vanilla FPS preset and preserves unrelated options', t => {
  const { optionsPath, backupPath } = createPaths(t);
  fs.mkdirSync(path.dirname(optionsPath), { recursive: true });
  fs.writeFileSync(optionsPath, [
    'version:4671',
    'graphicsPreset:"custom"',
    'renderDistance:12',
    'simulationDistance:10',
    'resourcePacks:["vanilla"]',
    '',
  ].join('\n'));

  const result = setVanillaPerformancePreset({ enabled: true, optionsPath, backupPath });
  const options = fs.readFileSync(optionsPath, 'utf8');
  const backup = JSON.parse(fs.readFileSync(backupPath, 'utf8'));

  assert.equal(result.enabled, true);
  assert.match(options, /graphicsPreset:"fast"/);
  assert.match(options, /renderDistance:6/);
  assert.match(options, /simulationDistance:4/);
  assert.match(options, /particles:2/);
  assert.match(options, /resourcePacks:\["vanilla"\]/);
  assert.equal(backup.original.renderDistance, '12');
  assert.equal(backup.managed.graphicsPreset, '"fast"');
});

test('restores unchanged settings and preserves values changed in Minecraft', t => {
  const { optionsPath, backupPath } = createPaths(t);
  fs.mkdirSync(path.dirname(optionsPath), { recursive: true });
  fs.writeFileSync(optionsPath, [
    'version:4671',
    'renderDistance:12',
    'simulationDistance:8',
    'resourcePacks:["vanilla"]',
    '',
  ].join('\n'));

  setVanillaPerformancePreset({ enabled: true, optionsPath, backupPath });
  const inGameOptions = fs.readFileSync(optionsPath, 'utf8').replace('renderDistance:6', 'renderDistance:10');
  fs.writeFileSync(optionsPath, inGameOptions);
  const result = setVanillaPerformancePreset({ enabled: false, optionsPath, backupPath });
  const restored = fs.readFileSync(optionsPath, 'utf8');

  assert.equal(result.enabled, false);
  assert.match(restored, /renderDistance:10/);
  assert.match(restored, /simulationDistance:8/);
  assert.match(restored, /resourcePacks:\["vanilla"\]/);
  assert.doesNotMatch(restored, /particles:2/);
  assert.equal(fs.existsSync(backupPath), false);
});

test('reapplying the preset reuses the original snapshot', t => {
  const { optionsPath, backupPath } = createPaths(t);
  fs.mkdirSync(path.dirname(optionsPath), { recursive: true });
  fs.writeFileSync(optionsPath, 'renderDistance:12\n');

  setVanillaPerformancePreset({ enabled: true, optionsPath, backupPath });
  const firstBackup = fs.readFileSync(backupPath, 'utf8');
  setVanillaPerformancePreset({ enabled: true, optionsPath, backupPath });

  assert.equal(fs.readFileSync(backupPath, 'utf8'), firstBackup);
  assert.equal((fs.readFileSync(optionsPath, 'utf8').match(/^renderDistance:/gm) || []).length, 1);
});

test('creates a minimal video options file for a profile that has never launched', t => {
  const { optionsPath, backupPath } = createPaths(t);

  const result = setVanillaPerformancePreset({ enabled: true, optionsPath, backupPath });

  assert.equal(result.changed, true);
  assert.equal(fs.existsSync(optionsPath), true);
  assert.equal(fs.existsSync(backupPath), true);
  assert.match(fs.readFileSync(optionsPath, 'utf8'), /renderDistance:6/);
  assert.equal(Object.keys(PRESET).includes('renderDistance'), true);
});

test('does not overwrite a changed value while the preset is enabled and restoring', t => {
  const { optionsPath, backupPath } = createPaths(t);
  fs.mkdirSync(path.dirname(optionsPath), { recursive: true });
  fs.writeFileSync(optionsPath, 'renderDistance:12\n');
  setVanillaPerformancePreset({ enabled: true, optionsPath, backupPath });
  fs.writeFileSync(optionsPath, 'renderDistance:10\n');
  setVanillaPerformancePreset({ enabled: false, optionsPath, backupPath });

  assert.equal(fs.readFileSync(optionsPath, 'utf8'), 'renderDistance:10\n');
});
