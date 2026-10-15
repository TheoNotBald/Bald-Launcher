const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { commitStagedFiles } = require('../src/shared/file-transaction');

function withTempDirectory(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bald-file-transaction-'));
  try {
    run(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('commits staged files into their destinations', () => {
  withTempDirectory(root => {
    const stagedDirectory = path.join(root, 'staged');
    const targetDirectory = path.join(root, 'mods');
    fs.mkdirSync(stagedDirectory);
    const stagedPath = path.join(stagedDirectory, 'bundle.jar');
    const targetPath = path.join(targetDirectory, 'bundle.jar');
    fs.writeFileSync(stagedPath, 'verified mod');

    assert.deepEqual(commitStagedFiles([{ stagedPath, targetPath }]), [targetPath]);
    assert.equal(fs.readFileSync(targetPath, 'utf8'), 'verified mod');
    assert.equal(fs.existsSync(stagedPath), false);
  });
});

test('rolls back committed destinations when a later move fails', () => {
  withTempDirectory(root => {
    const stagedDirectory = path.join(root, 'staged');
    const targetDirectory = path.join(root, 'mods');
    fs.mkdirSync(stagedDirectory);
    const stagedFiles = ['first.jar', 'second.jar'].map(name => {
      const stagedPath = path.join(stagedDirectory, name);
      fs.writeFileSync(stagedPath, name);
      return { stagedPath, targetPath: path.join(targetDirectory, name) };
    });
    let moveCount = 0;
    const failingFileSystem = Object.create(fs);
    failingFileSystem.renameSync = (...args) => {
      moveCount += 1;
      if (moveCount === 2) throw new Error('simulated move failure');
      return fs.renameSync(...args);
    };

    assert.throws(() => commitStagedFiles(stagedFiles, failingFileSystem), /simulated move failure/);
    assert.equal(fs.existsSync(stagedFiles[0].targetPath), false);
    assert.equal(fs.existsSync(stagedFiles[1].targetPath), false);
    assert.equal(fs.existsSync(stagedFiles[1].stagedPath), true);
  });
});

test('refuses to overwrite a destination file', () => {
  withTempDirectory(root => {
    const stagedPath = path.join(root, 'staged.jar');
    const targetPath = path.join(root, 'existing.jar');
    fs.writeFileSync(stagedPath, 'new');
    fs.writeFileSync(targetPath, 'original');

    assert.throws(() => commitStagedFiles([{ stagedPath, targetPath }]), /Refusing to overwrite/);
    assert.equal(fs.readFileSync(targetPath, 'utf8'), 'original');
    assert.equal(fs.readFileSync(stagedPath, 'utf8'), 'new');
  });
});
