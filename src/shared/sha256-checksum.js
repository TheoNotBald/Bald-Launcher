'use strict';

const crypto = require('node:crypto');
const path = require('node:path');

function findSha256Asset(assets, binaryName) {
  const names = new Set([
    `${binaryName}.sha256`,
    `${binaryName}.sha256sum`,
    `${path.parse(binaryName).name}.sha256`,
  ]);
  return (Array.isArray(assets) ? assets : []).find(asset => names.has(String(asset?.name || '')));
}

function parseSha256Checksum(contents, expectedFilename) {
  const expectedBaseName = path.basename(expectedFilename).toLowerCase();
  for (const line of String(contents || '').split(/\r?\n/)) {
    const match = line.trim().match(/^([a-f\d]{64})(?:\s+\*?(.+?))?\s*$/i);
    if (!match) continue;
    const filename = match[2]?.trim();
    if (filename && path.basename(filename).toLowerCase() !== expectedBaseName) continue;
    return match[1].toLowerCase();
  }
  throw new Error(`The published SHA-256 checksum does not contain a digest for ${expectedFilename}.`);
}

function verifySha256(data, expectedDigest) {
  const expected = String(expectedDigest || '').toLowerCase();
  if (!/^[a-f\d]{64}$/.test(expected)) throw new Error('The published SHA-256 checksum is malformed.');
  const actual = crypto.createHash('sha256').update(data).digest();
  const expectedBuffer = Buffer.from(expected, 'hex');
  if (!crypto.timingSafeEqual(actual, expectedBuffer)) {
    throw new Error('The downloaded Playit agent does not match its published SHA-256 checksum.');
  }
  return true;
}

module.exports = { findSha256Asset, parseSha256Checksum, verifySha256 };
