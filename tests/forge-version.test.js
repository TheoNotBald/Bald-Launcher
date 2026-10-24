'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { selectForgeVersion } = require('../src/shared/forge-version');

test('selects the highest stable Forge build from version-keyed metadata', () => {
  const metadata = {
    '1.20.1': [
      '1.20.1-47.2.0',
      '1.20.1-47.10.0',
      '1.20.1-47.4.28',
      '1.20.1-47.5.0-rc1',
    ],
    '1.20.2': ['1.20.2-48.1.0'],
  };

  assert.equal(selectForgeVersion(metadata, '1.20.1'), '1.20.1-47.10.0');
});

test('supports flat Forge version metadata and requires an exact Minecraft prefix', () => {
  assert.equal(selectForgeVersion({ versions: ['1.20.1-47.4.28', '1.20.10-50.0.1'] }, '1.20.1'), '1.20.1-47.4.28');
  assert.equal(selectForgeVersion({ versions: ['1.20.10-50.0.1'] }, '1.20.1'), null);
});

test('rejects invalid metadata and prerelease-only version lists', () => {
  assert.equal(selectForgeVersion(null, '1.20.1'), null);
  assert.equal(selectForgeVersion({ '1.20.1': ['1.20.1-47.5.0-beta1', '1.20.1-47.5.0-rc1'] }, '1.20.1'), null);
});
