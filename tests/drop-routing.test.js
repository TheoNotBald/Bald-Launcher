'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const AdmZip = require('adm-zip');
const { classifyProfileDrop, copyPathWithoutOverwrite, copyDropItems, extractWorldArchive, validateWorldArchiveEntryPath } = require('../drop-routing');

function withTempDirectory(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bald-drop-test-'));
  try {
    run(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('classifies Minecraft mods, resource packs, shaders, and worlds', () => {
  withTempDirectory(root => {
    const mod = path.join(root, 'sample.jar');
    const modZip = new AdmZip();
    modZip.addFile('fabric.mod.json', Buffer.from('{}'));
    modZip.writeZip(mod);
    assert.equal(classifyProfileDrop(mod).type, 'mods');

    const pack = path.join(root, 'pack.zip');
    const packZip = new AdmZip();
    packZip.addFile('pack.mcmeta', Buffer.from('{}'));
    packZip.writeZip(pack);
    assert.equal(classifyProfileDrop(pack).type, 'resourcepack');

    const shader = path.join(root, 'shaders.zip');
    const shaderZip = new AdmZip();
    shaderZip.addFile('shaders/example.fsh', Buffer.from(''));
    shaderZip.writeZip(shader);
    assert.equal(classifyProfileDrop(shader).type, 'shader');

    const world = path.join(root, 'My World');
    fs.mkdirSync(world);
    fs.writeFileSync(path.join(world, 'level.dat'), 'world');
    assert.equal(classifyProfileDrop(world).type, 'world');
  });
});

test('reports unknown content and modpack archives clearly', () => {
  withTempDirectory(root => {
    const textFile = path.join(root, 'notes.txt');
    fs.writeFileSync(textFile, 'not game content');
    assert.equal(classifyProfileDrop(textFile).type, 'unknown');

    const archive = path.join(root, 'pack.mrpack');
    fs.writeFileSync(archive, 'archive');
    assert.match(classifyProfileDrop(archive).reason, /Import Profile/);
  });
});

test('copies files and folders without overwriting existing destinations', () => {
  withTempDirectory(root => {
    const source = path.join(root, 'source');
    const destination = path.join(root, 'destination');
    fs.mkdirSync(source);
    fs.mkdirSync(destination);
    const file = path.join(source, 'same.txt');
    fs.writeFileSync(file, 'original');
    fs.writeFileSync(path.join(destination, 'same.txt'), 'keep me');

    const first = copyPathWithoutOverwrite(file, destination);
    const second = copyPathWithoutOverwrite(file, destination);
    assert.equal(path.basename(first), 'same (2).txt');
    assert.equal(path.basename(second), 'same (3).txt');
    assert.equal(fs.readFileSync(path.join(destination, 'same.txt'), 'utf8'), 'keep me');

    const folder = path.join(source, 'folder');
    fs.mkdirSync(folder);
    fs.writeFileSync(path.join(folder, 'nested.txt'), 'nested');
    const copied = copyDropItems([folder], destination);
    assert.equal(copied[0].ok, true);
    assert.equal(fs.readFileSync(path.join(copied[0].destinationPath, 'nested.txt'), 'utf8'), 'nested');
    assert.throws(() => copyPathWithoutOverwrite(folder, path.join(folder, 'inside')), /cannot be copied into itself/);
    assert.equal(fs.existsSync(path.join(folder, 'inside')), false);
  });
});

test('extracts a zipped world under a safe unique save folder', () => {
  withTempDirectory(root => {
    const archivePath = path.join(root, 'Adventure.zip');
    const archive = new AdmZip();
    archive.addFile('Adventure/level.dat', Buffer.from('level'));
    archive.addFile('Adventure/region/r.0.0.mca', Buffer.from('region'));
    archive.writeZip(archivePath);
    const saves = path.join(root, 'saves');
    fs.mkdirSync(saves);
    fs.mkdirSync(path.join(saves, 'Adventure'));

    const extracted = extractWorldArchive(archivePath, saves);
    assert.equal(path.basename(extracted), 'Adventure (2)');
    assert.equal(fs.readFileSync(path.join(extracted, 'level.dat'), 'utf8'), 'level');
    assert.equal(fs.readFileSync(path.join(extracted, 'region', 'r.0.0.mca'), 'utf8'), 'region');
  });
});

test('rejects world archive entries that attempt path traversal', () => {
  assert.throws(() => validateWorldArchiveEntryPath('../outside/level.dat'), /Unsafe path/);
  assert.throws(() => validateWorldArchiveEntryPath('C:/outside/level.dat'), /Unsafe path/);
  assert.equal(validateWorldArchiveEntryPath('Adventure/level.dat'), 'Adventure/level.dat');
});
