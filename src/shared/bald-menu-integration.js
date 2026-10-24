'use strict';

const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');

const SUPPORTED_MINECRAFT_VERSION = '1.21.11';
const MOD_FILENAME = 'bald-launcher-client.jar';
const MAX_ACTION_BODY_BYTES = 8192;

function isSupportedBaldMenuTarget(profile) {
  return String(profile?.mcVersion || '') === SUPPORTED_MINECRAFT_VERSION
    && String(profile?.loader || '').toLowerCase() === 'fabric';
}

function normalizeBaldMenuSettings(settings) {
  return {
    minecraftMenuEnabled: settings?.minecraftMenuEnabled !== false,
    minecraftPerformanceButtonEnabled: settings?.minecraftPerformanceButtonEnabled !== false,
    minecraftInGameButtonEnabled: settings?.minecraftInGameButtonEnabled !== false,
    minecraftPerformanceHudEnabled: settings?.minecraftPerformanceHudEnabled === true,
  };
}

function buildBaldMenuConfig({ profileId, settings, activeAccountId, accounts, bridge }) {
  if (!profileId || typeof profileId !== 'string') throw new TypeError('A profile ID is required.');
  if (!bridge?.url || !bridge?.token) throw new TypeError('A local launcher bridge is required.');
  return {
    enabled: normalizeBaldMenuSettings(settings).minecraftMenuEnabled,
    performanceButtonEnabled: normalizeBaldMenuSettings(settings).minecraftPerformanceButtonEnabled,
    inGameButtonEnabled: normalizeBaldMenuSettings(settings).minecraftInGameButtonEnabled,
    performanceHudEnabled: normalizeBaldMenuSettings(settings).minecraftPerformanceHudEnabled,
    profileId,
    activeAccountId: String(activeAccountId || ''),
    accounts: (Array.isArray(accounts) ? accounts : [])
      .filter(account => typeof account?.id === 'string' && typeof account?.name === 'string')
      .map(account => ({ id: account.id, name: account.name.slice(0, 32) })),
    bridgeUrl: bridge.url,
    bridgeToken: bridge.token,
  };
}

function installBaldMenuMod({ sourceJar, modsDirectory, fsImpl = fs }) {
  const source = path.resolve(sourceJar);
  const destinationDirectory = path.resolve(modsDirectory);
  const sourceStat = fsImpl.lstatSync(source);
  if (!sourceStat.isFile() || sourceStat.isSymbolicLink()) {
    throw new Error('The Bald Launcher client mod is not a regular file.');
  }
  if (sourceStat.size <= 0) throw new Error('The Bald Launcher client mod is empty.');

  fsImpl.mkdirSync(destinationDirectory, { recursive: true });
  const directoryStat = fsImpl.lstatSync(destinationDirectory);
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
    throw new Error('The profile mods folder must be a real directory.');
  }

  const destination = path.join(destinationDirectory, MOD_FILENAME);
  if (path.dirname(path.resolve(destination)) !== destinationDirectory) {
    throw new Error('The managed mod path is outside the profile mods folder.');
  }
  let existing = null;
  try {
    existing = fsImpl.lstatSync(destination);
    if (!existing.isFile() || existing.isSymbolicLink()) {
      throw new Error('The existing Bald Launcher mod path is not a regular file.');
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  const suffix = crypto.randomUUID();
  const temporary = path.join(destinationDirectory, `.bald-launcher-${suffix}.tmp`);
  const backup = path.join(destinationDirectory, `.bald-launcher-${suffix}.bak`);
  let movedExisting = false;
  try {
    fsImpl.copyFileSync(source, temporary, fs.constants.COPYFILE_EXCL);
    if (existing) {
      fsImpl.renameSync(destination, backup);
      movedExisting = true;
    }
    fsImpl.renameSync(temporary, destination);
    if (movedExisting) {
      try {
        fsImpl.unlinkSync(backup);
      } catch (error) {
        console.error('[Bald Menu] The previous managed mod backup could not be removed:', error);
      }
    }
    return destination;
  } catch (error) {
    try {
      if (fsImpl.existsSync(temporary)) fsImpl.unlinkSync(temporary);
      if (movedExisting && !fsImpl.existsSync(destination) && fsImpl.existsSync(backup)) {
        fsImpl.renameSync(backup, destination);
      }
    } catch (rollbackError) {
      error.rollbackError = rollbackError;
    }
    throw error;
  }
}

function createBaldMenuBridge({ profileId, accounts, onAction, host = '127.0.0.1' }) {
  if (typeof profileId !== 'string' || !profileId) throw new TypeError('A profile ID is required.');
  if (typeof onAction !== 'function') throw new TypeError('A launcher action handler is required.');
  const token = crypto.randomBytes(32).toString('hex');
  const knownAccounts = new Set((Array.isArray(accounts) ? accounts : [])
    .filter(account => typeof account?.id === 'string')
    .map(account => account.id));

  const server = http.createServer((request, response) => {
    const reply = (status, payload) => {
      response.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'Connection': 'close',
      });
      response.end(JSON.stringify(payload));
    };
    if (request.method !== 'POST' || request.url !== '/action') {
      reply(404, { error: 'Not found.' });
      return;
    }

    const authorization = String(request.headers.authorization || '');
    const suppliedToken = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
    const expected = Buffer.from(token);
    const supplied = Buffer.from(suppliedToken);
    if (expected.length !== supplied.length || !crypto.timingSafeEqual(expected, supplied)) {
      reply(401, { error: 'Unauthorized.' });
      request.resume();
      return;
    }

    const chunks = [];
    let size = 0;
    request.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_ACTION_BODY_BYTES) {
        reply(413, { error: 'Request too large.' });
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', async () => {
      if (response.writableEnded) return;
      let payload;
      try {
        payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        reply(400, { error: 'Invalid JSON.' });
        return;
      }
      if (!payload || payload.profileId !== profileId) {
        reply(403, { error: 'Profile mismatch.' });
        return;
      }
      if (!['open-cosmetics', 'switch-account'].includes(payload.action)) {
        reply(400, { error: 'Unsupported launcher action.' });
        return;
      }
      if (payload.action === 'switch-account' && !knownAccounts.has(payload.accountId)) {
        reply(404, { error: 'Account not found.' });
        return;
      }
      try {
        await onAction({
          action: payload.action,
          profileId,
          accountId: payload.action === 'switch-account' ? payload.accountId : null,
        });
        reply(200, { ok: true });
      } catch (error) {
        console.error('[Bald Menu] Could not handle an in-game launcher request:', error);
        reply(500, { error: 'Launcher action failed.' });
      }
    });
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, host, () => {
      server.removeListener('error', reject);
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Could not determine the local launcher bridge port.'));
        return;
      }
      resolve({
        token,
        url: `http://${host}:${address.port}/action`,
        close: () => new Promise((closeResolve, closeReject) => {
          if (!server.listening) {
            closeResolve();
            return;
          }
          server.close(error => error ? closeReject(error) : closeResolve());
        }),
      });
    });
  });
}

module.exports = {
  MOD_FILENAME,
  SUPPORTED_MINECRAFT_VERSION,
  buildBaldMenuConfig,
  createBaldMenuBridge,
  installBaldMenuMod,
  isSupportedBaldMenuTarget,
  normalizeBaldMenuSettings,
};
