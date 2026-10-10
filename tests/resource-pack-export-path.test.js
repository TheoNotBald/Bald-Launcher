const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const studio = fs.readFileSync(path.join(__dirname, '..', 'src', 'resource-packs', 'resource-pack-studio.js'), 'utf8');

function sourceRange(startText, endText, description) {
  const start = studio.indexOf(startText);
  const end = studio.indexOf(endText, start);
  assert.ok(start >= 0 && end > start, description);
  return studio.slice(start, end);
}

async function captureTextureExport(entry, animated) {
  const helpers = sourceRange(
    '  const resourcePath = entry =>',
    '\n  // A resource only has a real Minecraft Java model file',
    'resource path helpers should exist',
  );
  const exporter = sourceRange('  async function exportPack(install)', '\n  function setStatus(', 'pack exporter should exist');
  const captured = [];
  const state = {
    catalog: [entry],
    modifiedResources: { [entry.path]: Date.now() },
    buffers: { [entry.id]: new Uint8ClampedArray(4) },
    modelOverrides: {},
  };
  const context = {
    state,
    syncProject() {},
    project: () => ({ data: {} }),
    animationFor: () => animated ? { enabled: true } : null,
    buildAnimationSheet: () => ({ sheet: new Uint8ClampedArray(4), width: 1, height: 1 }),
    buildAnimationMcmeta: () => ({ animation: { frametime: 2 } }),
    bufferKey: candidate => candidate.id,
    dimensionsFor: () => ({ width: 1, height: 1 }),
    createImageData: () => ({}),
    ImageData: class {},
    document: {
      createElement: () => ({
        getContext: () => ({ putImageData() {} }),
        toDataURL: () => 'data:image/png;base64,AA==',
      }),
    },
    window: {
      launcherAPI: {
        exportResourcePack: async payload => {
          captured.push(payload);
          return { ok: true };
        },
      },
    },
    setStatus() {},
  };
  vm.runInNewContext(`${helpers}\n${exporter}\nthis.exportPack = exportPack;`, context);
  await context.exportPack(false);
  return captured[0].entries;
}

test('resource-pack export uses the catalog path instead of legacy community texture aliases', () => {
  const helpers = sourceRange(
    '  const resourcePath = entry =>',
    '\n  // A resource only has a real Minecraft Java model file',
    'resource path helpers should exist',
  );
  const context = {};
  vm.runInNewContext(`${helpers}\nthis.textureAssetPath = textureAssetPath;`, context);
  assert.equal(context.textureAssetPath({
    path: 'assets/minecraft/textures/block/acacia_planks.png',
    texturePath: 'blocks/acacia_planks.png',
  }), 'assets/minecraft/textures/block/acacia_planks.png');
  assert.equal(context.textureAssetPath({
    path: 'minecraft:oak_planks',
    texturePath: 'blocks/oak_planks.png',
  }), 'assets/minecraft/textures/block/oak_planks.png');
  assert.equal(context.textureAssetPath({
    path: 'minecraft:iron_ingot',
    texturePath: 'items/iron_ingot.png',
  }), 'assets/minecraft/textures/item/iron_ingot.png');
  assert.equal(context.textureAssetPath({
    path: 'assets/custom/textures/entity/example.png',
    texturePath: 'entity/example.png',
  }), 'assets/custom/textures/entity/example.png');
});

test('static and animated texture exports write to the canonical Minecraft asset path', async () => {
  const entry = {
    id: 'acacia_planks',
    path: 'assets/minecraft/textures/block/acacia_planks.png',
    texturePath: 'blocks/acacia_planks.png',
  };
  const staticEntries = await captureTextureExport(entry, false);
  assert.deepEqual(Array.from(staticEntries, output => output.path), ['assets/minecraft/textures/block/acacia_planks.png']);

  const animatedEntries = await captureTextureExport(entry, true);
  assert.deepEqual(Array.from(animatedEntries, output => output.path), [
    'assets/minecraft/textures/block/acacia_planks.png',
    'assets/minecraft/textures/block/acacia_planks.png.mcmeta',
  ]);

  const exporter = sourceRange('  async function exportPack(install)', '\n  function setStatus(', 'pack exporter should exist');
  assert.equal((exporter.match(/const texturePath = textureAssetPath\(entry\);/g) || []).length, 2);
  assert.doesNotMatch(exporter, /assets\/minecraft\/textures\/\$\{resourcePath\(entry\)\}/);
});
