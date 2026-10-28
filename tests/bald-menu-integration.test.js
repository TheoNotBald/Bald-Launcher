'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  MOD_FILENAME,
  buildBaldMenuConfig,
  createBaldMenuBridge,
  installBaldMenuMod,
  isSupportedBaldMenuTarget,
  normalizeBaldMenuSettings,
  reconcileBaldMenuMod,
  removeBaldMenuMod,
} = require('../src/shared/bald-menu-integration');

test('Bald menu integration is restricted to Fabric 1.21.11', () => {
  assert.equal(isSupportedBaldMenuTarget({ mcVersion: '1.21.11', loader: 'fabric' }), true);
  assert.equal(isSupportedBaldMenuTarget({ mcVersion: '1.21.11', loader: 'forge' }), false);
  assert.equal(isSupportedBaldMenuTarget({ mcVersion: '1.21.10', loader: 'fabric' }), false);
});

test('Bald menu settings default on and allow independent toggles', () => {
  assert.deepEqual(normalizeBaldMenuSettings({}), {
    minecraftClientModEnabled: true,
    minecraftMenuEnabled: true,
    minecraftPerformanceButtonEnabled: true,
    minecraftInGameButtonEnabled: true,
    minecraftPerformanceHudEnabled: false,
  });
  assert.deepEqual(normalizeBaldMenuSettings({
    minecraftClientModEnabled: false,
    minecraftMenuEnabled: false,
    minecraftPerformanceButtonEnabled: true,
    minecraftInGameButtonEnabled: false,
    minecraftPerformanceHudEnabled: true,
  }), {
    minecraftClientModEnabled: false,
    minecraftMenuEnabled: false,
    minecraftPerformanceButtonEnabled: true,
    minecraftInGameButtonEnabled: false,
    minecraftPerformanceHudEnabled: true,
  });
});

test('Bald menu runtime config contains account labels but no auth fields', () => {
  const config = buildBaldMenuConfig({
    profileId: 'profile-1',
    settings: {
      minecraftClientModEnabled: true,
      minecraftMenuEnabled: true,
      minecraftPerformanceButtonEnabled: false,
      minecraftInGameButtonEnabled: false,
      minecraftPerformanceHudEnabled: true,
    },
    activeAccountId: 'account-1',
    accounts: [{ id: 'account-1', name: 'Theo', auth: { accessToken: 'must-not-leak' } }],
    bridge: { url: 'http://127.0.0.1:12345/action', token: 'ephemeral' },
  });
  assert.deepEqual(config.accounts, [{ id: 'account-1', name: 'Theo' }]);
  assert.equal(config.performanceButtonEnabled, false);
  assert.equal(config.inGameButtonEnabled, false);
  assert.equal(config.performanceHudEnabled, true);
  assert.equal(config.clientModEnabled, true);
  assert.equal(JSON.stringify(config).includes('must-not-leak'), false);
});

test('disabled master setting suppresses runtime features without erasing their saved choices', () => {
  const config = buildBaldMenuConfig({
    profileId: 'profile-1',
    settings: {
      minecraftClientModEnabled: false,
      minecraftMenuEnabled: true,
      minecraftPerformanceButtonEnabled: true,
      minecraftInGameButtonEnabled: true,
      minecraftPerformanceHudEnabled: true,
    },
    bridge: { url: 'http://127.0.0.1:12345/action', token: 'ephemeral' },
  });
  assert.equal(config.clientModEnabled, false);
  assert.equal(config.enabled, false);
  assert.equal(config.performanceButtonEnabled, false);
  assert.equal(config.inGameButtonEnabled, false);
  assert.equal(config.performanceHudEnabled, false);
  assert.equal(normalizeBaldMenuSettings({ minecraftClientModEnabled: false })
    .minecraftMenuEnabled, true);
});

test('managed Bald menu installation atomically replaces only its owned target', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bald-menu-mod-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'source.jar');
  const mods = path.join(root, 'profile', 'mods');
  fs.writeFileSync(source, 'new-mod-binary');
  fs.mkdirSync(mods, { recursive: true });
  fs.writeFileSync(path.join(mods, 'user-mod.jar'), 'user-mod');
  fs.writeFileSync(path.join(mods, MOD_FILENAME), 'old-mod-binary');

  const installed = installBaldMenuMod({ sourceJar: source, modsDirectory: mods });
  assert.equal(installed, path.join(mods, MOD_FILENAME));
  assert.equal(fs.readFileSync(installed, 'utf8'), 'new-mod-binary');
  assert.equal(fs.readFileSync(path.join(mods, 'user-mod.jar'), 'utf8'), 'user-mod');
  assert.deepEqual(fs.readdirSync(mods).sort(), [MOD_FILENAME, 'user-mod.jar'].sort());
});

test('disabling Bald Client removes only its managed JAR and preserves other mods', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bald-menu-disable-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const mods = path.join(root, 'profile', 'mods');
  fs.mkdirSync(mods, { recursive: true });
  const managed = path.join(mods, MOD_FILENAME);
  const unrelated = path.join(mods, 'user-mod.jar');
  fs.writeFileSync(managed, 'owned-mod');
  fs.writeFileSync(unrelated, 'user-mod');

  assert.equal(removeBaldMenuMod({ modsDirectory: mods }), true);
  assert.equal(fs.existsSync(managed), false);
  assert.equal(fs.readFileSync(unrelated, 'utf8'), 'user-mod');
  assert.equal(removeBaldMenuMod({ modsDirectory: mods }), false);
});

test('Bald mod reconciliation installs only for enabled supported targets', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bald-menu-reconcile-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'source.jar');
  const mods = path.join(root, 'profile', 'mods');
  fs.writeFileSync(source, 'managed-mod');

  assert.deepEqual(reconcileBaldMenuMod({
    enabled: true, supportedTarget: true, sourceJar: source, modsDirectory: mods,
  }), { installed: true, removed: false });
  assert.equal(fs.readFileSync(path.join(mods, MOD_FILENAME), 'utf8'), 'managed-mod');
  assert.deepEqual(reconcileBaldMenuMod({
    enabled: false, supportedTarget: true, modsDirectory: mods,
  }), { installed: false, removed: true });
  assert.equal(fs.existsSync(path.join(mods, MOD_FILENAME)), false);
  const unrelated = path.join(mods, 'user-mod.jar');
  fs.writeFileSync(unrelated, 'user-mod');
  installBaldMenuMod({ sourceJar: source, modsDirectory: mods });
  assert.deepEqual(reconcileBaldMenuMod({
    enabled: true, supportedTarget: false, modsDirectory: mods,
  }), { installed: false, removed: true });
  assert.equal(fs.existsSync(path.join(mods, MOD_FILENAME)), false);
  assert.equal(fs.readFileSync(unrelated, 'utf8'), 'user-mod');
});

test('disabling Bald mod does not create a missing mods folder or touch a symlink target', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bald-menu-safe-remove-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const absent = path.join(root, 'missing', 'mods');
  assert.equal(removeBaldMenuMod({ modsDirectory: absent }), false);
  assert.equal(fs.existsSync(path.dirname(absent)), false);

  const target = path.join(root, 'outside.jar');
  fs.writeFileSync(target, 'user-data');
  const mods = path.join(root, 'profile', 'mods');
  fs.mkdirSync(mods, { recursive: true });
  const managed = path.join(mods, MOD_FILENAME);
  const fsImpl = Object.create(fs);
  fsImpl.lstatSync = targetPath => {
    if (path.resolve(targetPath) === path.resolve(managed)) {
      return { isDirectory: () => false, isFile: () => true, isSymbolicLink: () => true };
    }
    return fs.lstatSync(targetPath);
  };
  assert.throws(() => removeBaldMenuMod({ modsDirectory: mods, fsImpl }), /not a regular file/);
  assert.equal(fs.readFileSync(target, 'utf8'), 'user-data');
});

test('loopback bridge authorizes and validates requests before dispatch', async t => {
  const actions = [];
  const bridge = await createBaldMenuBridge({
    profileId: 'profile-1',
    accounts: [{ id: 'account-1' }],
    onAction: action => actions.push(action),
  });
  t.after(() => bridge.close());

  const post = (token, body, route = '/action') => new Promise((resolve, reject) => {
    const url = new URL(bridge.url);
    const request = http.request({
      host: url.hostname,
      port: url.port,
      path: route,
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    request.on('error', reject);
    request.end(JSON.stringify(body));
  });

  assert.equal((await post('wrong', { action: 'open-cosmetics', profileId: 'profile-1' })).status, 401);
  assert.equal((await post(bridge.token, { action: 'switch-account', accountId: 'unknown', profileId: 'profile-1' })).status, 404);
  assert.equal((await post(bridge.token, { action: 'open-cosmetics', profileId: 'other-profile' })).status, 403);
  assert.equal((await post(bridge.token, { action: 'switch-account', accountId: 'account-1', profileId: 'profile-1' })).status, 200);
  assert.deepEqual(actions, [{ action: 'switch-account', profileId: 'profile-1', accountId: 'account-1' }]);
});
