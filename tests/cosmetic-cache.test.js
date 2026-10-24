'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');

test('official texture cache accepts only existing PNG files inside its cache directory', t => {
  const start = main.indexOf('const isUsableOfficialTexture = texture => {');
  const end = main.indexOf('\n  const hasUsableOfficialTextures', start);
  assert.ok(start >= 0 && end > start, 'official texture cache validation should exist');
  const helper = main.slice(start, end).replace(
    'const isUsableOfficialTexture = texture => {',
    'this.isUsableOfficialTexture = texture => {',
  );

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bald-cosmetic-cache-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const cacheRoot = path.join(root, 'cosmetics', 'official');
  const validPath = path.join(cacheRoot, 'skin.png');
  const wrongExtensionPath = path.join(cacheRoot, 'skin.jpg');
  const outsidePath = path.join(root, 'skin.png');
  fs.mkdirSync(cacheRoot, { recursive: true });
  fs.writeFileSync(validPath, 'texture');
  fs.writeFileSync(wrongExtensionPath, 'texture');
  fs.writeFileSync(outsidePath, 'texture');

  const context = {
    path,
    fs,
    officialCacheRoot: `${path.resolve(cacheRoot)}${path.sep}`.toLowerCase(),
  };
  vm.runInNewContext(helper, context);

  assert.equal(context.isUsableOfficialTexture({ filePath: validPath }), true);
  assert.equal(context.isUsableOfficialTexture({ filePath: path.join(cacheRoot, 'missing.png') }), false);
  assert.equal(context.isUsableOfficialTexture({ filePath: wrongExtensionPath }), false);
  assert.equal(context.isUsableOfficialTexture({ filePath: outsidePath }), false);
});
