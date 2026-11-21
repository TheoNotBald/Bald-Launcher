'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const handlerPath = require.resolve('../node_modules/minecraft-launcher-core/components/handler');

function createHandler(Handler, rootPath, objectFiles, cachePath, concurrency = 2, writeAssets = true) {
  const assetRoot = path.join(rootPath, 'assets');
  const indexPath = path.join(assetRoot, 'indexes', 'test.json');
  const objects = {};
  for (const [name, content] of Object.entries(objectFiles)) {
    const hash = crypto.createHash('sha1').update(content).digest('hex');
    if (writeAssets) {
      const objectPath = path.join(assetRoot, 'objects', hash.slice(0, 2), hash);
      fs.mkdirSync(path.dirname(objectPath), { recursive: true });
      fs.writeFileSync(objectPath, content);
    }
    objects[name] = { hash };
  }
  fs.mkdirSync(path.dirname(indexPath), { recursive: true });
  fs.writeFileSync(indexPath, JSON.stringify({ objects }));

  const client = {
    options: {
      root: rootPath,
      version: { number: 'test' },
      overrides: {
        assetRoot,
        assetValidationCachePath: cachePath,
        assetConcurrency: concurrency,
        maxSockets: concurrency,
        url: { resource: 'https://assets.invalid' },
      },
    },
    emit() {},
  };
  const handler = new Handler(client);
  handler.version = { assets: 'modern' };
  return { handler, assetRoot, objects };
}

test('Minecraft asset validation is bounded and cached across launcher sessions', async () => {
  const rootPath = fs.mkdtempSync(path.join(os.tmpdir(), 'bald-asset-cache-'));
  const cachePath = path.join(rootPath, 'asset-validation.json');
  const files = Object.fromEntries(Array.from({ length: 10 }, (_, index) => [
    `assets/test/${index}`,
    Buffer.from(`verified Minecraft asset ${index}`),
  ]));

  try {
    let Handler = require(handlerPath);
    const first = createHandler(Handler, rootPath, files, cachePath);
    let activeChecks = 0;
    let peakChecks = 0;
    let firstPassChecks = 0;
    const checkSum = first.handler.checkSum.bind(first.handler);
    first.handler.checkSum = async (hash, file) => {
      activeChecks++;
      firstPassChecks++;
      peakChecks = Math.max(peakChecks, activeChecks);
      await new Promise(resolve => setTimeout(resolve, 3));
      try {
        return await checkSum(hash, file);
      } finally {
        activeChecks--;
      }
    };
    await first.handler.getAssets();

    assert.equal(firstPassChecks, Object.keys(files).length);
    assert.ok(peakChecks <= 2, `Expected at most 2 concurrent hashes, saw ${peakChecks}`);
    assert.equal(JSON.parse(fs.readFileSync(cachePath, 'utf8')).files.length, Object.keys(files).length);

    delete require.cache[handlerPath];
    Handler = require(handlerPath);
    const second = createHandler(Handler, rootPath, files, cachePath, 2, false);
    let repeatChecks = 0;
    second.handler.checkSum = async () => {
      repeatChecks++;
      return false;
    };
    await second.handler.getAssets();

    assert.equal(repeatChecks, 0, 'unchanged assets should use the persisted, metadata-checked verification cache');

    const [changedName, changedContent] = Object.entries(files)[0];
    const changedHash = crypto.createHash('sha1').update(changedContent).digest('hex');
    const changedPath = path.join(first.assetRoot, 'objects', changedHash.slice(0, 2), changedHash);
    fs.writeFileSync(changedPath, Buffer.alloc(changedContent.length, 0x78));
    fs.utimesSync(changedPath, new Date(), new Date(Date.now() + 5000));

    delete require.cache[handlerPath];
    Handler = require(handlerPath);
    const third = createHandler(Handler, rootPath, files, cachePath, 2, false);
    let invalidatedChecks = 0;
    const thirdCheckSum = third.handler.checkSum.bind(third.handler);
    third.handler.checkSum = async (hash, file) => {
      invalidatedChecks++;
      return thirdCheckSum(hash, file);
    };
    third.handler.downloadAsync = async (_url, directory, name) => {
      assert.equal(name, changedHash);
      fs.writeFileSync(path.join(directory, name), changedContent);
    };
    await third.handler.getAssets();

    assert.equal(invalidatedChecks, 2, `expected a changed asset to be revalidated and repaired (${changedName})`);
  } finally {
    fs.rmSync(rootPath, { recursive: true, force: true });
    delete require.cache[handlerPath];
  }
});

test('overlapping profile warm-ups share a single download for the same asset', async () => {
  const rootPath = fs.mkdtempSync(path.join(os.tmpdir(), 'bald-shared-asset-'));
  const cachePath = path.join(rootPath, 'asset-validation.json');
  const content = Buffer.from('one shared Minecraft asset');
  const hash = crypto.createHash('sha1').update(content).digest('hex');
  const files = { 'assets/shared': content };

  try {
    delete require.cache[handlerPath];
    const Handler = require(handlerPath);
    const first = createHandler(Handler, rootPath, files, cachePath, 1, false);
    const second = createHandler(Handler, rootPath, files, cachePath, 1, false);
    let downloadCount = 0;
    for (const handler of [first.handler, second.handler]) {
      handler.downloadAsync = async (_url, directory, name) => {
        downloadCount++;
        await new Promise(resolve => setTimeout(resolve, 15));
        fs.mkdirSync(directory, { recursive: true });
        fs.writeFileSync(path.join(directory, name), content);
      };
    }

    await Promise.all([first.handler.getAssets(), second.handler.getAssets()]);

    assert.equal(downloadCount, 1);
    assert.equal(crypto.createHash('sha1').update(fs.readFileSync(path.join(first.assetRoot, 'objects', hash.slice(0, 2), hash))).digest('hex'), hash);
  } finally {
    fs.rmSync(rootPath, { recursive: true, force: true });
    delete require.cache[handlerPath];
  }
});
