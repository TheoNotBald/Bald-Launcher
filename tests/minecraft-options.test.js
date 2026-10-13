'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { applyMinecraftVideoPreset } = require('../src/shared/minecraft-options');

test('writes valid Minecraft option values for the max-FPS preset', () => {
  const result = applyMinecraftVideoPreset('lang:en_us\nkey_key.forward:87\nmaxFps:60\n', {
    performancePreset: 'max-fps-pvp',
    fpsCap: 'Unlimited',
    renderDistance: 32,
    simulationDistance: 32,
  });

  assert.match(result, /lang:en_us/);
  assert.match(result, /key_key\.forward:87/);
  assert.match(result, /maxFps:260/);
  assert.match(result, /enableVsync:false/);
  assert.match(result, /graphicsMode:0/);
  assert.match(result, /renderClouds:"false"/);
  assert.match(result, /cloudRange:0/);
  assert.match(result, /particles:2/);
  assert.match(result, /mipmapLevels:0/);
  assert.match(result, /entityDistanceScaling:0\.5/);
  assert.match(result, /entityShadows:false/);
  assert.match(result, /textureFiltering:0/);
  assert.match(result, /biomeBlendRadius:0/);
  assert.match(result, /renderDistance:32/);
  assert.match(result, /simulationDistance:32/);
  assert.match(result, /graphicsPreset:"custom"/);
});

test('applies balanced and quality presets and clamps invalid numeric settings', () => {
  const balanced = applyMinecraftVideoPreset('', {
    performancePreset: 'balanced-pvp',
    fpsCap: '90',
    renderDistance: 100,
    simulationDistance: -1,
  });
  const quality = applyMinecraftVideoPreset('', { performancePreset: 'quality' });

  assert.match(balanced, /maxFps:90/);
  assert.match(balanced, /renderDistance:32/);
  assert.match(balanced, /simulationDistance:5/);
  assert.match(balanced, /particles:1/);
  assert.match(quality, /graphicsMode:2/);
  assert.match(quality, /particles:0/);
  assert.match(quality, /mipmapLevels:4/);
});

test('max-FPS preset preserves the selected Minecraft distances within supported ranges', () => {
  const result = applyMinecraftVideoPreset('', {
    performancePreset: 'max-fps-pvp',
    renderDistance: 12,
    simulationDistance: 7,
  });

  assert.match(result, /renderDistance:12/);
  assert.match(result, /simulationDistance:7/);
});

test('caps unlimited FPS to the maximum supported slider value and respects explicit caps', () => {
  const unlimited = applyMinecraftVideoPreset('', { fpsCap: 'Unlimited' });
  const capped = applyMinecraftVideoPreset('', { fpsCap: '144' });

  assert.match(unlimited, /maxFps:260/);
  assert.match(capped, /maxFps:144/);
  assert.doesNotMatch(unlimited, /(^|\n)clouds:/);
});
