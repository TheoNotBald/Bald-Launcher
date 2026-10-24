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
} = require('../src/shared/bald-menu-integration');

test('Bald menu integration is restricted to Fabric 1.21.11', () => {
  assert.equal(isSupportedBaldMenuTarget({ mcVersion: '1.21.11', loader: 'fabric' }), true);
  assert.equal(isSupportedBaldMenuTarget({ mcVersion: '1.21.11', loader: 'forge' }), false);
  assert.equal(isSupportedBaldMenuTarget({ mcVersion: '1.21.10', loader: 'fabric' }), false);
});

test('Bald menu settings default on and allow independent toggles', () => {
  assert.deepEqual(normalizeBaldMenuSettings({}), {
    minecraftMenuEnabled: true,
    minecraftPerformanceButtonEnabled: true,
    minecraftInGameButtonEnabled: true,
    minecraftPerformanceHudEnabled: false,
  });
  assert.deepEqual(normalizeBaldMenuSettings({
    minecraftMenuEnabled: false,
    minecraftPerformanceButtonEnabled: true,
    minecraftInGameButtonEnabled: false,
    minecraftPerformanceHudEnabled: true,
  }), {
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
  assert.equal(JSON.stringify(config).includes('must-not-leak'), false);
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
