'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'bald_launcher_v7.html'), 'utf8').replace(/\r\n/g, '\n');
const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');

test('performance settings expose a Bald-styled OneClient profile control, not the automatic Sodium opt-in', () => {
  assert.match(html, /id="oneClientPerformanceInstallButton"[^>]*onclick="installOneClientPerformanceProfile\(\)"/);
  assert.match(html, /full official OneClient Modrinth pack matching this profile’s Minecraft version/);
  assert.doesNotMatch(html, /id="optimizationModsEnabled"/);
});

test('OneClient control requests an isolated compatible Fabric profile based on the original profile', async () => {
  const start = html.indexOf('let oneClientProfileInstallBusy = false;');
  const end = html.indexOf('\n// ---------------- Logs ----------------', start);
  assert.ok(start >= 0 && end > start, 'OneClient install control should exist');
  const source = html.slice(start, end);

  const originalProfile = { id: 'source', name: 'Survival', mcVersion: '1.21.11', loader: 'vanilla' };
  const selectedOneClient = {
    id: 'oneclient-existing',
    optimizationKind: 'oneclient',
    optimizationSourceProfileId: originalProfile.id,
    mcVersion: originalProfile.mcVersion,
  };
  const profiles = [originalProfile, selectedOneClient];
  const state = { profiles, activeProfileId: selectedOneClient.id };
  let installRequest = null;
  let openedProfile = null;
  const button = { disabled: false };
  const status = { textContent: '' };
  const notifications = [];
  const context = {
    currentProfileId: selectedOneClient.id,
    state,
    getProfile: id => state.profiles.find(profile => profile.id === id) || null,
    launcherBridge: {
      installModpackToProfile: async payload => {
        installRequest = payload;
        const profile = {
          id: 'oneclient-new',
          name: 'OneClient 1.21.11 v2.0.578',
          mcVersion: '1.21.11',
          oneClientPackVersionNumber: 'v2.0.578',
        };
        return { ok: true, profile, state: { profiles: [...profiles, profile], activeProfileId: profile.id } };
      },
      getState: async () => state,
    },
    document: {
      getElementById: id => id === 'oneClientPerformanceInstallButton' ? button
        : id === 'oneClientProfileStatus' ? status
          : null,
    },
    showProfileImportProgress: () => {},
    hideProfileImportProgress: () => {},
    renderProfileGrid: () => {},
    openProfile: id => { openedProfile = id; },
    addNotification: (...args) => notifications.push(args),
  };

  vm.runInNewContext(`${source}\nthis.installOneClientPerformanceProfile = installOneClientPerformanceProfile;`, context);
  await context.installOneClientPerformanceProfile();

  assert.deepEqual(JSON.parse(JSON.stringify(installRequest)), {
    source: 'modrinth',
    projectId: 'QhX1nx34',
    mcVersion: '1.21.11',
    loader: 'fabric',
    optimizationKind: 'oneclient',
    optimizationSourceProfileId: 'source',
  });
  assert.equal(openedProfile, 'oneclient-new');
  assert.equal(button.disabled, false);
  assert.match(status.textContent, /Installed OneClient v2\.0\.578/);
  assert.equal(notifications.length, 1);
});

test('profile normalization preserves OneClient settings that disable Bald overlays and vanilla presets', () => {
  const profileStart = main.indexOf('function normalizeProfile(profile) {');
  const profileEnd = main.indexOf('\nfunction normalizeInstalledContent', profileStart);
  const settingsStart = main.indexOf('function normalizeSettings(settings) {');
  const settingsEnd = main.indexOf('\nfunction normalizeTheme', settingsStart);
  assert.ok(profileStart >= 0 && profileEnd > profileStart && settingsStart >= 0 && settingsEnd > settingsStart);
  const context = {
    COMMON_VERSIONS: ['1.21.1'],
    LOADERS: ['fabric', 'vanilla'],
    DEFAULT_STATE: { settings: { memoryMax: 6 } },
    getRendererOptions: () => [{ id: 'sodium' }, { id: 'vanilla' }],
    normalizeLoaderVersion: value => String(value || ''),
    normalizeInstalledContent: value => value,
    normalizeBaldMenuSettings: settings => ({
      minecraftClientModEnabled: settings?.minecraftClientModEnabled !== false,
      minecraftMenuEnabled: settings?.minecraftMenuEnabled !== false,
      minecraftPerformanceButtonEnabled: settings?.minecraftPerformanceButtonEnabled !== false,
      minecraftInGameButtonEnabled: settings?.minecraftInGameButtonEnabled !== false,
      minecraftPerformanceHudEnabled: settings?.minecraftPerformanceHudEnabled === true,
    }),
    path,
  };
  vm.runInNewContext(
    `${main.slice(profileStart, profileEnd)}\n${main.slice(settingsStart, settingsEnd)}\nthis.normalizeProfile=normalizeProfile;this.normalizeSettings=normalizeSettings;`,
    context,
  );
  const profile = context.normalizeProfile({
    id: 'oneclient',
    name: 'OneClient 1.21.11',
    mcVersion: '1.21.11',
    loader: 'fabric',
    optimizationManaged: true,
    optimizationKind: 'oneclient',
    optimizationSourceProfileId: 'original',
    minecraftClientModEnabled: false,
    minecraftMenuEnabled: false,
    minecraftPerformanceButtonEnabled: false,
    minecraftInGameButtonEnabled: false,
    minecraftPerformanceHudEnabled: false,
    vanillaPerformancePresetEnabled: false,
  });
  const settings = context.normalizeSettings({ ...profile, optimizationModsEnabled: true });

  assert.equal(profile.optimizationKind, 'oneclient');
  assert.equal(profile.optimizationSourceProfileId, 'original');
  assert.equal(settings.minecraftClientModEnabled, false);
  assert.equal(settings.minecraftMenuEnabled, false);
  assert.equal(settings.minecraftPerformanceButtonEnabled, false);
  assert.equal(settings.minecraftInGameButtonEnabled, false);
  assert.equal(settings.minecraftPerformanceHudEnabled, false);
  assert.equal(settings.vanillaPerformancePresetEnabled, false);
  assert.equal(settings.optimizationModsEnabled, false);
});
