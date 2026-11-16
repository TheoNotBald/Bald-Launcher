'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const AdmZip = require('adm-zip');
const {
  installHorizonLauncherArchive,
  selectHorizonLauncherAsset,
} = require('../src/shared/horizon-installer');
const {
  buildHorizonEnvironment,
  buildHorizonInstallArgs,
  buildHorizonSearchArgs,
  findMatchingHorizonAccount,
  getHorizonPaths,
  normalizeHorizonLauncherPath,
  parseHorizonJson,
  publicHorizonAccounts,
  runHorizonCommand,
} = require('../src/shared/horizon-integration');

test('Horizon account matching exposes only public identity fields and compares Minecraft UUIDs', () => {
  const raw = {
    accounts: [{
      uuid: '12345678-1234-1234-1234-123456789abc',
      username: 'PlayerOne',
      selected: false,
      access_token: 'must-not-escape',
      refresh_token: 'must-not-escape',
    }],
  };
  const accounts = publicHorizonAccounts(raw);
  assert.deepEqual(accounts, [{
    uuid: '12345678-1234-1234-1234-123456789abc',
    name: 'PlayerOne',
    selected: false,
  }]);
  assert.equal(findMatchingHorizonAccount(accounts, '12345678123412341234123456789ABC').name, 'PlayerOne');
  assert.equal(findMatchingHorizonAccount(accounts, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'), null);
});

test('Horizon data paths stay separate from the Java profiles root', () => {
  const userData = path.resolve('test-user-data');
  const roots = getHorizonPaths(userData);
  assert.equal(roots.launcherHome, path.join(userData, 'horizon-rust', 'launcher'));
  assert.equal(roots.gameHome, path.join(userData, 'horizon-rust', 'game'));
  assert.notEqual(roots.gameHome, path.join(userData, 'profiles'));
  assert.deepEqual(buildHorizonEnvironment(userData, { ...process.env, HORIZON_HOME: 'old' }), {
    ...process.env,
    HORIZON_LAUNCHER_HOME: roots.launcherHome,
    HORIZON_HOME: roots.gameHome,
  });
});

test('Horizon launcher executable must be an absolute Windows executable path', () => {
  assert.throws(() => normalizeHorizonLauncherPath('horizon-launcher.exe'), /absolute path/);
  if (process.platform === 'win32') {
    assert.throws(() => normalizeHorizonLauncherPath('C:\\Horizon\\launcher.txt'), /\.exe/);
    assert.equal(
      normalizeHorizonLauncherPath('C:\\Horizon\\horizon-launcher.exe'),
      'C:\\Horizon\\horizon-launcher.exe',
    );
  }
});

test('Horizon search arguments constrain sources, kinds, and instance selection', () => {
  assert.deepEqual(buildHorizonSearchArgs({
    query: 'fresh animations',
    kind: 'mod',
    source: 'horizon',
    instance: 'Bald Rust',
  }), ['mods', 'search', 'fresh', 'animations', '--kind', 'mod', '--source', 'horizon', '--instance', 'Bald Rust']);
  assert.throws(() => buildHorizonSearchArgs({
    query: 'water',
    kind: 'shader',
    source: 'modrinth',
  }), /Horizon registry/);
  assert.throws(() => buildHorizonSearchArgs({
    query: '-help',
    kind: 'mod',
    source: 'horizon',
  }), /start with a dash/);
});

test('Horizon install arguments keep identifiers separate from the command shell', () => {
  assert.deepEqual(buildHorizonInstallArgs({
    projectId: 'native-pack:tools',
    source: 'horizon',
    instance: 'Rust Test',
  }), ['mods', 'install', 'native-pack:tools', '--source', 'horizon', '--instance', 'Rust Test']);
  assert.deepEqual(buildHorizonInstallArgs({
    projectId: 'example-datapack',
    source: 'modrinth',
    instance: 'Rust Test',
    world: 'My World',
  }), ['mods', 'install', 'example-datapack', '--source', 'modrinth', '--instance', 'Rust Test', '--world', 'My World']);
  assert.throws(() => buildHorizonInstallArgs({
    projectId: '--delete',
    source: 'horizon',
  }), /identifier is invalid/);
  assert.throws(() => buildHorizonInstallArgs({
    projectId: 'example-datapack',
    source: 'horizon',
    world: '--delete',
  }), /world name is invalid/);
});

test('Horizon CLI command uses isolated roots and parses structured output', async () => {
  const calls = [];
  const spawnProcess = (executable, args, options) => {
    calls.push({ executable, args, options });
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => {};
    setImmediate(() => {
      child.stdout.end('[{"id":"horizon","name":"Horizon","kind":"own"}]');
      child.emit('close', 0, null);
    });
    return child;
  };
  const result = await runHorizonCommand({
    executablePath: path.resolve('horizon-launcher.exe'),
    userDataPath: path.resolve('test-user-data'),
    args: ['instance', 'list'],
    spawnProcess,
  });

  assert.deepEqual(calls[0].args, ['--json', 'instance', 'list']);
  assert.equal(calls[0].options.env.HORIZON_HOME, path.join(path.resolve('test-user-data'), 'horizon-rust', 'game'));
  assert.deepEqual(parseHorizonJson(result.stdout), [{ id: 'horizon', name: 'Horizon', kind: 'own' }]);
});

test('Horizon CLI rejects nonzero exit codes with the command error', async () => {
  const spawnProcess = () => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => {};
    setImmediate(() => {
      child.stderr.end('Sign in with a Minecraft account first.');
      child.emit('close', 1, null);
    });
    return child;
  };
  await assert.rejects(runHorizonCommand({
    executablePath: path.resolve('horizon-launcher.exe'),
    userDataPath: path.resolve('test-user-data'),
    args: ['play', '--instance', 'horizon'],
    spawnProcess,
  }), /Sign in with a Minecraft account first/);
});

test('automatic Horizon setup selects and verifies the latest official Windows archive', () => {
  const zip = new AdmZip();
  zip.addFile('horizon-launcher.exe', Buffer.from('official launcher test binary'));
  zip.addFile('resources/config.json', Buffer.from('{}'));
  const archive = zip.toBuffer();
  const digest = crypto.createHash('sha256').update(archive).digest('hex');
  const releases = [
    {
      tag_name: 'launcher@0.2.9',
      published_at: '2026-01-01T00:00:00Z',
      draft: false,
      assets: [],
    },
    {
      tag_name: 'launcher@0.2.10',
      published_at: '2026-02-01T00:00:00Z',
      draft: false,
      assets: [{
        name: 'horizon-launcher-windows-x64.zip',
        browser_download_url: 'https://github.com/horizon-rust/horizon/releases/download/launcher%400.2.10/horizon-launcher-windows-x64.zip',
        digest: `sha256:${digest}`,
        size: archive.length,
      }],
    },
  ];
  const selected = selectHorizonLauncherAsset(releases, 'x64');
  assert.equal(selected.version, '0.2.10');
  const installRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bald-horizon-test-'));
  try {
    const installed = installHorizonLauncherArchive({
      archive,
      digest: selected.digest,
      version: selected.version,
      installRoot,
    });
    assert.equal(fs.readFileSync(installed.executablePath, 'utf8'), 'official launcher test binary');
    assert.equal(installed.reused, false);
    const reused = installHorizonLauncherArchive({
      archive,
      digest: selected.digest,
      version: selected.version,
      installRoot,
    });
    assert.equal(reused.executablePath, installed.executablePath);
    assert.equal(reused.reused, true);
  } finally {
    fs.rmSync(installRoot, { recursive: true, force: true });
  }
});

test('automatic Horizon setup rejects untrusted assets, digest mismatches, and archive traversal', () => {
  const releases = [{
    tag_name: 'launcher@0.2.10',
    published_at: '2026-02-01T00:00:00Z',
    assets: [{
      name: 'horizon-launcher-windows-x64.zip',
      browser_download_url: 'https://example.com/horizon-launcher-windows-x64.zip',
      digest: `sha256:${'a'.repeat(64)}`,
      size: 1024,
    }],
  }];
  assert.throws(() => selectHorizonLauncherAsset(releases, 'x64'), /official GitHub/);
  assert.throws(() => selectHorizonLauncherAsset(releases, 'ia32'), /not supported/);

  const zip = new AdmZip();
  zip.addFile('safe.txt', Buffer.from('not allowed'));
  const archive = Buffer.from(zip.toBuffer());
  for (let index = 0; index <= archive.length - 8; index += 1) {
    if (archive.toString('ascii', index, index + 8) === 'safe.txt') {
      archive.write('../x.txt', index, 'ascii');
    }
  }
  const digest = crypto.createHash('sha256').update(archive).digest('hex');
  const installRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bald-horizon-unsafe-test-'));
  try {
    assert.throws(() => installHorizonLauncherArchive({
      archive,
      digest: '0'.repeat(64),
      version: '0.2.10',
      installRoot,
    }), /SHA-256/);
    assert.throws(() => installHorizonLauncherArchive({
      archive,
      digest,
      version: '0.2.10',
      installRoot,
    }), /unsafe file path/);
    assert.equal(fs.existsSync(path.join(path.dirname(installRoot), 'outside.txt')), false);
  } finally {
    fs.rmSync(installRoot, { recursive: true, force: true });
  }
});
