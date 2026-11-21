'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const workspace = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(workspace, 'bald_launcher_v7.html'), 'utf8');
const main = fs.readFileSync(path.join(workspace, 'main.js'), 'utf8');

test('launcher startup splash reports real boot phases and supports recovery', () => {
  assert.match(html, /id="bootSplash"[^>]*role="status"/);
  assert.match(html, /id="bootSplashProgress"[^>]*role="progressbar"/);
  assert.match(html, /function updateBootSplash\(progress, phase, hint\)/);
  assert.match(html, /updateBootSplash\(15, 'Checking the Minecraft version catalog/);
  assert.match(html, /updateBootSplash\(39, 'Restoring your profiles and settings/);
  assert.match(html, /updateBootSplash\(100, 'Launcher ready/);
  assert.match(html, /showBootSplashError\(error\)/);
  assert.match(html, /retry\.addEventListener\('click', \(\) => window\.location\.reload\(\)/);
  assert.match(html, /const BOOT_SPLASH_MIN_DURATION_MS = 1800/);
  assert.match(html, /BOOT_SPLASH_MIN_DURATION_MS - \(performance\.now\(\) - bootSplashStartedAt\)/);
  assert.match(html, /boot\(\)\.then\(async \(\) => \{[\s\S]*?await new Promise\(resolve => window\.setTimeout[\s\S]*?overlay\?\.classList\.add\('is-dismissed'\)/);
});

test('Java prewarm failures do not update activity or emit repeated launch notifications', () => {
  const launch = main.slice(main.indexOf('async function launchJavaProfile(payload)'), main.indexOf("ipcMain.handle('launcher:launch'"));
  const failureBranch = launch.slice(launch.indexOf('if (prewarming) {', launch.indexOf('const failedProfile =')), launch.indexOf('\n    if (failedProfile)', launch.indexOf('const failedProfile =')));
  assert.match(failureBranch, /PREWARM_AUTH_FAILED/);
  assert.match(failureBranch, /return \{\s*ok: false,\s*skipped: true/);
  assert.doesNotMatch(failureBranch, /emitStatus|emitLog/);
  assert.match(html, /if \(result\?\.code === 'PREWARM_AUTH_FAILED'\) break;/);
  assert.match(launch, /if \(!prewarming\) \{\s*profile\.lastUsedAt = Date\.now\(\)/);
});

test('Java asset downloads use capped parallelism and a persistent verified-asset cache', () => {
  assert.match(main, /maxSockets: Math\.min\(16, Math\.max\(8, os\.cpus\(\)\.length\)\)/);
  assert.match(main, /assetConcurrency: Math\.min\(24, Math\.max\(8, os\.cpus\(\)\.length\)\)/);
  assert.match(main, /assetValidationCachePath: path\.join\(app\.getPath\('userData'\), 'minecraft-asset-validation-cache\.json'\)/);
  assert.match(main, /if \(warmState\?\.prewarming && Number\.isSafeInteger\(warmState\.child\.pid\)\)[\s\S]*?PRIORITY_NORMAL[\s\S]*?await pendingPrewarm/);
});
