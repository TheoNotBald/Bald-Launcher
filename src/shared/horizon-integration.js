'use strict';

const { spawn } = require('node:child_process');
const path = require('node:path');

const HORIZON_DOWNLOAD_URL = 'https://playhorizon.dev/download';
const HORIZON_SEARCH_KINDS = new Set(['mod', 'modpack', 'resource', 'shader', 'datapack']);
const HORIZON_SEARCH_SOURCES = new Set(['horizon', 'modrinth']);
const MAX_HORIZON_OUTPUT_BYTES = 4 * 1024 * 1024;
const DEFAULT_HORIZON_TIMEOUT_MS = 120_000;

function getHorizonPaths(userDataPath) {
  if (typeof userDataPath !== 'string' || !path.isAbsolute(userDataPath)) {
    throw new TypeError('Horizon data root must be an absolute path.');
  }
  const root = path.join(userDataPath, 'horizon-rust');
  return {
    root,
    launcherHome: path.join(root, 'launcher'),
    gameHome: path.join(root, 'game'),
  };
}

function buildHorizonEnvironment(userDataPath, baseEnvironment = process.env) {
  const roots = getHorizonPaths(userDataPath);
  return {
    ...baseEnvironment,
    HORIZON_LAUNCHER_HOME: roots.launcherHome,
    HORIZON_HOME: roots.gameHome,
  };
}

function normalizeHorizonLauncherPath(executablePath) {
  const value = typeof executablePath === 'string' ? executablePath.trim() : '';
  if (!value || !path.isAbsolute(value)) {
    throw new TypeError('Select the Horizon Launcher executable using an absolute path.');
  }
  if (process.platform === 'win32' && path.extname(value).toLowerCase() !== '.exe') {
    throw new TypeError('The selected Horizon Launcher file must be an .exe.');
  }
  return path.normalize(value);
}

function validateInstanceName(instanceName) {
  const value = typeof instanceName === 'string' ? instanceName.trim() : '';
  if (!value || value.length > 100 || /[\u0000-\u001f\u007f]/.test(value) || value.startsWith('-')) {
    throw new TypeError('Choose a Horizon instance name between 1 and 100 characters.');
  }
  return value;
}

function validateProjectId(projectId) {
  const value = typeof projectId === 'string' ? projectId.trim() : '';
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value)) {
    throw new TypeError('The Horizon mod identifier is invalid.');
  }
  return value;
}

function buildHorizonPrepareArgs(version, { download = false } = {}) {
  const value = typeof version === 'string' ? version.trim() : '';
  if (!value || value.length > 160 || !/^[A-Za-z0-9][A-Za-z0-9._+-]*$/.test(value)) {
    throw new TypeError('The selected Horizon version is invalid. Refresh the Horizon profiles and try again.');
  }
  return ['prepare', ...(download ? ['--download'] : []), '--version', value];
}

function buildHorizonPrepareCheckArgs(rootPath) {
  if (typeof rootPath !== 'string' || !path.isAbsolute(rootPath)) {
    throw new TypeError('The Horizon version folder must be an absolute path.');
  }
  return ['--check', '--root', path.normalize(rootPath)];
}

function getSelectedHorizonBuild(value) {
  const installed = Array.isArray(value?.installed) ? value.installed : [];
  const selected = typeof value?.selected === 'string' ? value.selected.trim() : '';
  if (!selected || !installed.includes(selected)) {
    throw new Error('Horizon has no selected installed build. Install or select a Horizon build, then try again.');
  }
  return selected;
}

function getHorizonAccountRequirement(value) {
  const accounts = Array.isArray(value?.accounts) ? value.accounts : [];
  const readyAccount = accounts.find(account => account?.selected === true
    && account?.authentication?.state === 'ready');
  if (!readyAccount) {
    return {
      code: 'HORIZON_SIGN_IN_REQUIRED',
      message: 'Sign in to a Microsoft account that owns Minecraft: Java Edition in Horizon before playing this profile.',
    };
  }
  if (value?.owner !== true) {
    return {
      code: 'HORIZON_OWNERSHIP_REQUIRED',
      message: 'The selected Horizon account does not own Minecraft: Java Edition. Sign in with an account that owns the game.',
    };
  }
  return null;
}

function buildHorizonSearchArgs({ query, kind, source, instance }) {
  const searchText = typeof query === 'string' ? query.trim() : '';
  if (!searchText || searchText.length > 160 || /[\u0000-\u001f\u007f]/.test(searchText)) {
    throw new TypeError('Enter a search term between 1 and 160 characters.');
  }
  if (searchText.startsWith('-')) throw new TypeError('Search terms cannot start with a dash.');
  if (!HORIZON_SEARCH_KINDS.has(kind)) throw new TypeError('The requested Horizon mod category is invalid.');
  if (!HORIZON_SEARCH_SOURCES.has(source)) throw new TypeError('The requested Horizon mod source is invalid.');
  if (kind === 'shader' && source !== 'horizon') {
    throw new TypeError('Horizon shader packs are available from the Horizon registry.');
  }

  const args = ['mods', 'search', ...searchText.split(/\s+/), '--kind', kind, '--source', source];
  if (instance) args.push('--instance', validateInstanceName(instance));
  return args;
}

function buildHorizonInstallArgs({ projectId, source, kind = 'mod', instance, world }) {
  if (!HORIZON_SEARCH_SOURCES.has(source)) throw new TypeError('The requested Horizon mod source is invalid.');
  if (!HORIZON_SEARCH_KINDS.has(kind)) throw new TypeError('The requested Horizon content category is invalid.');
  if (kind === 'shader' && source !== 'horizon') {
    throw new TypeError('Horizon shader packs are available from the Horizon registry.');
  }
  if (kind === 'datapack' && !world) {
    throw new TypeError('Select a world before installing a Horizon data pack.');
  }
  if (kind !== 'datapack' && world) {
    throw new TypeError('A world can only be selected when installing a data pack.');
  }
  const args = ['mods', 'install', validateProjectId(projectId), '--source', source];
  if (instance) args.push('--instance', validateInstanceName(instance));
  if (world) {
    const worldName = typeof world === 'string' ? world.trim() : '';
    if (!worldName || worldName.length > 100 || worldName.startsWith('-') || /[\u0000-\u001f\u007f]/.test(worldName)) {
      throw new TypeError('The selected world name is invalid.');
    }
    args.push('--world', worldName);
  }
  return args;
}

function runHorizonCommand({
  executablePath,
  userDataPath,
  args,
  json = true,
  timeoutMs = DEFAULT_HORIZON_TIMEOUT_MS,
  spawnProcess = spawn,
  maxOutputBytes = MAX_HORIZON_OUTPUT_BYTES,
}) {
  const executable = normalizeHorizonLauncherPath(executablePath);
  if (!Array.isArray(args) || args.some(argument => typeof argument !== 'string' || argument.includes('\u0000'))) {
    throw new TypeError('Horizon command arguments must be strings without NUL characters.');
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || !Number.isSafeInteger(maxOutputBytes) || maxOutputBytes < 1) {
    throw new TypeError('Horizon command limits must be positive finite values.');
  }

  const commandArgs = json ? ['--json', ...args] : args.slice();
  const options = {
    env: buildHorizonEnvironment(userDataPath),
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  };

  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawnProcess(executable, commandArgs, options);
    } catch (error) {
      reject(new Error(`Could not start Horizon Launcher: ${error.message}`));
      return;
    }

    let stdout = '';
    let stderr = '';
    let outputBytes = 0;
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(new Error(`Horizon command timed out after ${timeoutMs} ms.`));
    }, timeoutMs);

    const failForOutputLimit = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill();
      reject(new Error(`Horizon command exceeded its ${maxOutputBytes}-byte output limit.`));
    };

    const appendOutput = (target, chunk) => {
      if (settled) return target;
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      outputBytes += buffer.length;
      if (outputBytes > maxOutputBytes) {
        failForOutputLimit();
        return target;
      }
      return target + buffer.toString('utf8');
    };

    child.stdout?.on('data', chunk => { stdout = appendOutput(stdout, chunk); });
    child.stderr?.on('data', chunk => { stderr = appendOutput(stderr, chunk); });
    child.once('error', error => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`Could not start Horizon Launcher: ${error.message}`));
    });
    child.once('close', (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        const detail = stderr.trim() || stdout.trim() || `exit code ${code}${signal ? ` (${signal})` : ''}`;
        reject(new Error(`Horizon command failed: ${detail}`));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

function parseHorizonJson(stdout) {
  try {
    return JSON.parse(stdout);
  } catch (error) {
    throw new Error(`Horizon Launcher returned invalid JSON: ${error.message}`);
  }
}

function publicHorizonAccounts(value) {
  const accounts = Array.isArray(value) ? value : Array.isArray(value?.accounts) ? value.accounts : [];
  return accounts.flatMap(account => {
    const uuid = String(account?.uuid || account?.minecraft_uuid || '').trim();
    const name = String(account?.name || account?.username || '').trim();
    if (!uuid || !name) return [];
    return [{
      uuid,
      name,
      selected: account.selected === true || account.is_selected === true || value?.selected === uuid,
    }];
  });
}

function findMatchingHorizonAccount(accounts, minecraftUuid) {
  const normalize = value => String(value || '').replace(/-/g, '').toLowerCase();
  const targetUuid = normalize(minecraftUuid);
  if (!targetUuid) return null;
  return publicHorizonAccounts(accounts).find(account => normalize(account.uuid) === targetUuid) || null;
}

module.exports = {
  DEFAULT_HORIZON_TIMEOUT_MS,
  HORIZON_DOWNLOAD_URL,
  buildHorizonEnvironment,
  buildHorizonInstallArgs,
  buildHorizonPrepareCheckArgs,
  buildHorizonPrepareArgs,
  buildHorizonSearchArgs,
  getHorizonAccountRequirement,
  getSelectedHorizonBuild,
  findMatchingHorizonAccount,
  getHorizonPaths,
  normalizeHorizonLauncherPath,
  parseHorizonJson,
  publicHorizonAccounts,
  runHorizonCommand,
  validateInstanceName,
  validateProjectId,
};
