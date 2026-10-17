'use strict';

const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { resolveProfileImportPath, runProfileImportDownloads } = require('../src/shared/profile-import');

test('resolves safe profile import paths and rejects traversal and absolute paths', () => {
  const root = path.join(os.tmpdir(), 'bald-profile-import');

  assert.deepEqual(resolveProfileImportPath(root, 'mods/example.jar'), {
    relative: 'mods/example.jar',
    destination: path.join(root, 'mods', 'example.jar'),
  });
  assert.equal(resolveProfileImportPath(root, '../outside.txt'), null);
  assert.equal(resolveProfileImportPath(root, 'mods/../../outside.txt'), null);
  assert.equal(resolveProfileImportPath(root, 'C:\\outside.txt'), null);
  assert.equal(resolveProfileImportPath(root, '/outside.txt'), null);
  assert.equal(resolveProfileImportPath(root, ''), null);
});

test('downloads profile files concurrently with a bounded worker count and reports progress', async () => {
  const reports = [];
  let active = 0;
  let peak = 0;
  const files = Array.from({ length: 8 }, (_, index) => ({ path: `mods/${index}.jar` }));
  const results = await runProfileImportDownloads({
    files,
    destinationRoot: path.join(os.tmpdir(), 'bald-profile-import'),
    concurrency: 3,
    onProgress: report => reports.push(report),
    downloadFile: async (_file, _destination, onTransfer) => {
      active += 1;
      peak = Math.max(peak, active);
      onTransfer({ loaded: 50, total: 100 });
      await new Promise(resolve => setImmediate(resolve));
      active -= 1;
    },
  });

  assert.equal(results.length, files.length);
  assert.ok(results.every(result => result.error === null));
  assert.equal(peak, 3);
  assert.equal(reports.at(-1).completed, files.length);
  assert.equal(reports.at(-1).percent, 99);
  assert.ok(reports.length >= 2);
});

test('keeps per-file download failures actionable while continuing other imports', async () => {
  const results = await runProfileImportDownloads({
    files: [{ path: 'mods/broken.jar' }, { path: 'mods/ok.jar' }],
    destinationRoot: path.join(os.tmpdir(), 'bald-profile-import'),
    concurrency: 2,
    downloadFile: async file => {
      if (file.path.includes('broken')) throw new Error('network disconnected');
    },
  });

  assert.equal(results[0].error, 'network disconnected');
  assert.equal(results[1].error, null);
});

test('does not invoke downloads for unsafe profile import paths', async () => {
  let downloadCount = 0;
  const results = await runProfileImportDownloads({
    files: [{ path: '../outside.jar' }],
    destinationRoot: path.join(os.tmpdir(), 'bald-profile-import'),
    downloadFile: async () => { downloadCount += 1; },
  });

  assert.equal(downloadCount, 0);
  assert.match(results[0].error, /unsafe/);
});
