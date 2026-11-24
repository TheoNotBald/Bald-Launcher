'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  createOneClientProfileMetadata,
  sortCompatibleModrinthModpackVersions,
  validateModrinthPackDependencies,
} = require('../src/shared/modpack-runtime');

test('selects the newest stable Modrinth pack for the exact game version and loader', () => {
  const versions = [
    {
      id: 'newer-beta',
      version_number: 'v3.0.0-beta',
      version_type: 'beta',
      date_published: '2026-11-24T00:00:00Z',
      game_versions: ['1.21.11'],
      loaders: ['fabric'],
      files: [{ filename: 'pack.mrpack' }],
    },
    {
      id: 'wrong-game',
      version_number: 'v9.0.0',
      version_type: 'release',
      date_published: '2026-11-25T00:00:00Z',
      game_versions: ['1.21.10'],
      loaders: ['fabric'],
      files: [{ filename: 'pack.mrpack' }],
    },
    {
      id: 'wrong-loader',
      version_number: 'v9.0.0',
      version_type: 'release',
      date_published: '2026-11-25T00:00:00Z',
      game_versions: ['1.21.11'],
      loaders: ['forge'],
      files: [{ filename: 'pack.mrpack' }],
    },
    {
      id: 'release-old',
      version_number: 'v2.0.577',
      version_type: 'release',
      date_published: '2026-11-22T00:00:00Z',
      game_versions: ['1.21.11'],
      loaders: ['fabric'],
      files: [{ filename: 'pack.mrpack' }],
    },
    {
      id: 'release-new',
      version_number: 'v2.0.578',
      version_type: 'release',
      date_published: '2026-11-23T00:00:00Z',
      game_versions: ['1.21.11'],
      loaders: ['fabric'],
      files: [{ filename: 'pack.mrpack' }],
    },
  ];

  assert.deepEqual(
    sortCompatibleModrinthModpackVersions(versions, '1.21.11', 'fabric').map(version => version.id),
    ['release-new', 'release-old', 'newer-beta'],
  );
});

test('ignores compatible releases that do not contain a Modrinth archive', () => {
  assert.deepEqual(sortCompatibleModrinthModpackVersions([{
    id: 'no-archive',
    version_type: 'release',
    game_versions: ['1.21.11'],
    loaders: ['fabric'],
    files: [{ filename: 'readme.txt' }],
  }], '1.21.11', 'fabric'), []);
});

test('validates the pack manifest Minecraft and loader dependencies before install', () => {
  assert.deepEqual(validateModrinthPackDependencies({
    minecraft: '1.21.11',
    'fabric-loader': '0.18.1',
  }, '1.21.11', 'fabric', true), {
    loader: 'fabric',
    loaderVersion: '0.18.1',
  });
  assert.throws(
    () => validateModrinthPackDependencies({ minecraft: '1.21.10', 'fabric-loader': '0.18.1' }, '1.21.11', 'fabric', true),
    /targets Minecraft 1\.21\.10/,
  );
  assert.throws(
    () => validateModrinthPackDependencies({ minecraft: '1.21.11', forge: '1.0' }, '1.21.11', 'fabric', true),
    /requires forge/,
  );
  assert.throws(
    () => validateModrinthPackDependencies({ minecraft: '1.21.11' }, '1.21.11', 'fabric', true),
    /must declare Minecraft/,
  );
});

test('OneClient profiles keep the Bald mod and vanilla preset out of the managed pack', () => {
  assert.deepEqual(createOneClientProfileMetadata(
    { id: 'source-profile', name: 'Survival' },
    { id: 'oneclient-version', version_number: 'v2.0.578' },
  ), {
    optimizationManaged: true,
    optimizationKind: 'oneclient',
    optimizationSourceProfileId: 'source-profile',
    optimizationSourceProfileName: 'Survival',
    optimizationWorldSetupComplete: false,
    optimizationReady: false,
    oneClientPackVersionId: 'oneclient-version',
    oneClientPackVersionNumber: 'v2.0.578',
    minecraftClientModEnabled: false,
    minecraftMenuEnabled: false,
    minecraftPerformanceButtonEnabled: false,
    minecraftInGameButtonEnabled: false,
    minecraftPerformanceHudEnabled: false,
    vanillaPerformancePresetEnabled: false,
    optimizationModsEnabled: false,
  });
  assert.throws(() => createOneClientProfileMetadata({}, {}), /source profile is required/);
});
