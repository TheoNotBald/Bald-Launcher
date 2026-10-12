'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { configureUpdaterFeed } = require('../src/shared/updater-feed');

test('uses the GitHub feed when packaged build metadata is missing', t => {
  const resourcesPath = fs.mkdtempSync(path.join(os.tmpdir(), 'bald-updater-feed-'));
  t.after(() => fs.rmSync(resourcesPath, { recursive: true, force: true }));
  const calls = [];
  const updater = {
    autoDownload: false,
    autoInstallOnAppQuit: true,
    setFeedURL: options => calls.push(options),
  };
  const installDirectory = path.join(resourcesPath, 'running-app');

  assert.equal(configureUpdaterFeed(updater, { isPackaged: true, resourcesPath, installDirectory }), true);
  assert.equal(updater.autoDownload, true);
  assert.equal(updater.autoInstallOnAppQuit, false);
  assert.equal(updater.installDirectory, installDirectory);
  assert.deepEqual(calls, [{
    provider: 'github',
    owner: 'TheoNotBald',
    repo: 'Bald-Launcher',
  }]);
});

test('keeps electron-builder feed metadata when it is present', t => {
  const resourcesPath = fs.mkdtempSync(path.join(os.tmpdir(), 'bald-updater-feed-configured-'));
  t.after(() => fs.rmSync(resourcesPath, { recursive: true, force: true }));
  fs.writeFileSync(path.join(resourcesPath, 'app-update.yml'), 'provider: github\n');
  const updater = {
    autoDownload: false,
    autoInstallOnAppQuit: true,
    installDirectory: undefined,
    setFeedURL: () => assert.fail('existing electron-builder feed should be preserved'),
  };
  const installDirectory = path.join(resourcesPath, 'installed-app');

  assert.equal(configureUpdaterFeed(updater, {
    isPackaged: true,
    resourcesPath,
    installDirectory,
  }), false);
  assert.equal(updater.autoDownload, true);
  assert.equal(updater.autoInstallOnAppQuit, false);
  assert.equal(updater.installDirectory, installDirectory);
});

test('does not configure updates for an unpackaged development run', t => {
  const resourcesPath = fs.mkdtempSync(path.join(os.tmpdir(), 'bald-updater-feed-dev-'));
  t.after(() => fs.rmSync(resourcesPath, { recursive: true, force: true }));
  const updater = {
    autoDownload: false,
    autoInstallOnAppQuit: true,
    setFeedURL: () => assert.fail('development runs must not configure updates'),
  };

  assert.equal(configureUpdaterFeed(updater, {
    isPackaged: false,
    resourcesPath,
  }), false);
  assert.equal(updater.autoDownload, false);
  assert.equal(updater.autoInstallOnAppQuit, true);
  assert.equal(updater.installDirectory, undefined);
});
