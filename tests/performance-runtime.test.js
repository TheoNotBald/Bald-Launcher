'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  getJvmArguments,
  getRequiredJavaVersion,
  isOptimizationOptedIn,
  recommendMinecraftMemoryGb,
} = require('../src/shared/performance-runtime');

const gib = 1024 ** 3;

test('uses Minecraft-version-appropriate minimum Java versions', () => {
  assert.equal(getRequiredJavaVersion('1.16.5'), 8);
  assert.equal(getRequiredJavaVersion('1.17.1'), 16);
  assert.equal(getRequiredJavaVersion('1.18.2'), 17);
  assert.equal(getRequiredJavaVersion('1.20.4'), 17);
  assert.equal(getRequiredJavaVersion('1.20.5'), 21);
  assert.equal(getRequiredJavaVersion('1.21.1'), 21);
});

test('recommends a conservative heap while reserving memory for Windows and other apps', () => {
  assert.equal(recommendMinecraftMemoryGb(8 * gib, 7 * gib), 6);
  assert.equal(recommendMinecraftMemoryGb(4 * gib, 1.5 * gib), 1);
  assert.equal(recommendMinecraftMemoryGb(64 * gib, 60 * gib), 8);
  assert.equal(recommendMinecraftMemoryGb(16 * gib, 14 * gib, true), 12);
  assert.equal(recommendMinecraftMemoryGb(0, 0), 2);
});

test('uses Java defaults unless an explicitly selected JVM profile is supported', () => {
  assert.deepEqual(getJvmArguments({ jvmProfile: 'default' }, 21), []);
  assert.deepEqual(getJvmArguments({ jvmProfile: 'zgc' }, 17), []);
  assert.deepEqual(getJvmArguments({ jvmProfile: 'zgc' }, 21), [
    '-XX:+UseZGC',
    '-XX:+ZGenerational',
  ]);
});

test('preserves user-supplied JVM arguments in custom mode', () => {
  assert.deepEqual(getJvmArguments({
    jvmProfile: 'custom',
    customJvmArgs: ' -Dexample=true  -XX:+UseG1GC ',
  }, 21), ['-Dexample=true', '-XX:+UseG1GC']);
});

  test('performance mods remain opt-in for existing and new settings', () => {
    assert.equal(isOptimizationOptedIn(undefined), false);
    assert.equal(isOptimizationOptedIn({ performancePreset: 'max-fps-pvp' }), false);
    assert.equal(isOptimizationOptedIn({ optimizationModsEnabled: false }), false);
    assert.equal(isOptimizationOptedIn({ optimizationModsEnabled: true }), true);
  });
