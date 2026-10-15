'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { getLoaderJvmArguments, getLoaderLibraryPaths } = require('../src/shared/loader-jvm-arguments');

test('NeoForge library discovery and MCLC classpaths use the installer library directory', () => {
  const profileRoot = path.join(os.tmpdir(), 'bald-neoforge-profile');
  const sharedCacheRoot = path.join(os.tmpdir(), 'bald-shared-cache');

  assert.deepEqual(getLoaderLibraryPaths('neoforge', profileRoot, sharedCacheRoot), {
    libraryDirectory: path.join(profileRoot, 'libraries'),
    libraryRoot: path.join(profileRoot, 'libraries'),
  });
});

test('other loaders keep using the shared library cache', () => {
  const profileRoot = path.join(os.tmpdir(), 'bald-fabric-profile');
  const sharedCacheRoot = path.join(os.tmpdir(), 'bald-shared-cache');

  assert.deepEqual(getLoaderLibraryPaths('fabric', profileRoot, sharedCacheRoot), {
    libraryDirectory: path.join(sharedCacheRoot, 'libraries'),
    libraryRoot: path.join(sharedCacheRoot, 'libraries'),
  });
});

test('resolves NeoForge module-path placeholders from the supplied loader library directory', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bald-loader-jvm-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const versionJsonPath = path.join(root, 'versions', 'neoforge-21.1.259', 'neoforge-21.1.259.json');
  fs.mkdirSync(path.dirname(versionJsonPath), { recursive: true });
  fs.writeFileSync(versionJsonPath, JSON.stringify({
    id: 'neoforge-21.1.259',
    arguments: {
      jvm: [
        '-DlibraryDirectory=${library_directory}',
        '-p',
        '${library_directory}/cpw/mods/bootstraplauncher/2.0.2/bootstraplauncher-2.0.2.jar${classpath_separator}${library_directory}/cpw/mods/securejarhandler/3.0.8/securejarhandler-3.0.8.jar',
        '--add-modules',
        'ALL-MODULE-PATH',
        '-Dversion=${version_name}',
      ],
    },
  }));
  const libraryDirectory = getLoaderLibraryPaths(
    'neoforge',
    root,
    path.join(root, 'shared-cache'),
  ).libraryDirectory;

  assert.deepEqual(getLoaderJvmArguments(versionJsonPath, {
    libraryDirectory,
    versionName: 'neoforge-21.1.259',
    classpathSeparator: ';',
    platform: 'win32',
    architecture: 'x64',
  }), [
    `-DlibraryDirectory=${libraryDirectory}`,
    '-p',
    `${libraryDirectory}/cpw/mods/bootstraplauncher/2.0.2/bootstraplauncher-2.0.2.jar;${libraryDirectory}/cpw/mods/securejarhandler/3.0.8/securejarhandler-3.0.8.jar`,
    '--add-modules',
    'ALL-MODULE-PATH',
    '-Dversion=neoforge-21.1.259',
  ]);
});

test('includes only JVM arguments allowed by the current OS rule', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bald-loader-jvm-rules-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const versionJsonPath = path.join(root, 'version.json');
  fs.writeFileSync(versionJsonPath, JSON.stringify({
    arguments: {
      jvm: [
        { rules: [{ action: 'allow', os: { name: 'windows' } }], value: '-Dwindows=true' },
        { rules: [{ action: 'allow', os: { name: 'linux' } }], value: '-Dlinux=true' },
        { rules: [{ action: 'allow', os: { name: 'windows' } }], value: ['-Dmulti=1', '-Dmulti=2'] },
      ],
    },
  }));

  assert.deepEqual(getLoaderJvmArguments(versionJsonPath, { platform: 'win32' }), ['-Dwindows=true', '-Dmulti=1', '-Dmulti=2']);
});

test('returns no extra JVM arguments for versions without JVM launch metadata', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bald-loader-jvm-vanilla-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const versionJsonPath = path.join(root, 'version.json');
  fs.writeFileSync(versionJsonPath, JSON.stringify({ id: '1.21.1' }));

  assert.deepEqual(getLoaderJvmArguments(versionJsonPath), []);
});
