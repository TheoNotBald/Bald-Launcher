'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');
const { findSha256Asset, parseSha256Checksum, verifySha256 } = require('../src/shared/sha256-checksum');

test('selects the checksum asset corresponding to the chosen binary', () => {
  const assets = [
    { name: 'playit-linux-arm64.sha256' },
    { name: 'playit-linux-amd64.sha256' },
  ];
  assert.deepEqual(findSha256Asset(assets, 'playit-linux-amd64'), assets[1]);
  assert.equal(findSha256Asset(assets, 'playit-windows-amd64.exe'), undefined);
});

test('parses standard SHA-256 sidecars and matches the requested binary name', () => {
  const digest = 'a'.repeat(64);
  assert.equal(parseSha256Checksum(`${digest}  playit-linux-amd64\n`, 'playit-linux-amd64'), digest);
  assert.equal(parseSha256Checksum(`${digest}\n`, 'playit-linux-amd64'), digest);
  assert.throws(
    () => parseSha256Checksum(`${digest}  playit-linux-arm64\n`, 'playit-linux-amd64'),
    /does not contain a digest/,
  );
});

test('verifies the downloaded bytes and rejects a mismatched or malformed digest', () => {
  const bytes = Buffer.from('verified Playit executable');
  const digest = crypto.createHash('sha256').update(bytes).digest('hex');
  assert.equal(verifySha256(bytes, digest), true);
  assert.throws(() => verifySha256(bytes, 'b'.repeat(64)), /does not match/);
  assert.throws(() => verifySha256(bytes, 'not-a-hash'), /malformed/);
});
