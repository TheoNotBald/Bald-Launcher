const { app, BrowserWindow, ipcMain, dialog, shell, safeStorage } = require('electron');
let libLaunch = null;
try { libLaunch = require('./src/lib/launch'); libLaunch.register(ipcMain); } catch (error) { if (error.code !== 'MODULE_NOT_FOUND') console.error('[lib]', error); }
const { execFile, execFileSync, spawn, spawnSync } = require('child_process');
const net = require('net');
const zlib = require('zlib');
const { Transform } = require('stream');
const { pipeline } = require('stream/promises');
const { StringDecoder } = require('string_decoder');
const fs = require('fs');
const path = require('path');
let mainWindow;

function reportStartupFailure(error, stage) {
  const details = error instanceof Error ? error.stack || error.message : String(error);
  const message = `Startup stage: ${stage}\n${details}`;
  try {
    fs.writeFileSync(path.join(app.getPath('userData'), 'startup-error.txt'), `${new Date().toISOString()}\n${message}`);
  } catch (writeError) {
    console.error('[Startup] Could not write startup-error.txt:', writeError);
  }
  console.error(`[Startup] ${message}`);
  if (!mainWindow || mainWindow.isDestroyed()) {
    dialog.showErrorBox('Bald Launcher could not start', message);
  }
}
process.on('uncaughtException', error => reportStartupFailure(error, 'uncaught exception'));
process.on('unhandledRejection', error => {
  if (!mainWindow || mainWindow.isDestroyed()) reportStartupFailure(error, 'unhandled rejection');
  else console.error('[Runtime] Unhandled promise rejection:', error);
});
const crypto = require('crypto');
const os = require('os');
const axios = require('axios');
const FormData = require('form-data');
const AdmZip = require('adm-zip');
const pidusage = require('pidusage');
const MCLC = require('minecraft-launcher-core');
const { autoUpdater } = require('electron-updater');
const { createPlayitManager } = require('./playit-manager');
const { classifyProfileDrop, copyDropItems, copyPathWithoutOverwrite, extractWorldArchive } = require('./drop-routing');
const { shouldPromptForStaleWorldLock } = require('./src/servers/world-lock-policy');
const { createStateStore } = require('./src/shared/state-store');
const { createSecureStateCodec } = require('./src/shared/secure-state-codec');
const { commitStagedFiles } = require('./src/shared/file-transaction');
const { parseWindowsGpuPreference, summarizeGpuEngineSamples } = require('./src/shared/windows-gpu');
const { redactLaunchArguments } = require('./src/shared/launch-arguments');
const { findSha256Asset, parseSha256Checksum, verifySha256 } = require('./src/shared/sha256-checksum');
const {
  HORIZON_RELEASES_API,
  installHorizonLauncherArchive,
  selectHorizonLauncherAsset,
} = require('./src/shared/horizon-installer');
const ServerStats = require('./src/servers/server-stats');
const { runDueSchedules } = require('./src/servers/schedule-runner');
const { restoreWorldFromZip } = require('./src/servers/backup-restore');
const { waitForLogResponse } = require('./src/servers/console-response');
const { canAdoptDiscoveredProcess, findMatchingServerProcess, getProcessStartTime, matchesServerProcessIdentity: verifyServerProcessIdentity } = require('./src/servers/process-identity');
const { ensureLauncherProfilesFile } = require('./src/shared/launcher-profiles');
const { getLoaderJvmArguments, getLoaderLibraryPaths } = require('./src/shared/loader-jvm-arguments');
const { runInstallerProcess } = require('./src/shared/run-installer');
const { setVanillaPerformancePreset } = require('./src/shared/vanilla-performance');
const {
  closeHorizonGameWindows,
  createHorizonWindowController,
} = require('./src/shared/horizon-process');
const {
  copyDirectoryWithoutOverwrite,
  isPathWithin,
  mergeHorizonOptions,
} = require('./src/shared/horizon-profile-sync');
const {
  HORIZON_DOWNLOAD_URL,
  buildHorizonInstallArgs,
  buildHorizonPrepareCheckArgs,
  buildHorizonPrepareArgs,
  buildHorizonSearchArgs,
  findMatchingHorizonAccount,
  getHorizonAccountRequirement,
  getHorizonPaths,
  getSelectedHorizonBuild,
  normalizeHorizonLauncherPath,
  parseHorizonJson,
  publicHorizonAccounts,
  runHorizonCommand,
  validateInstanceName,
  validateProjectId,
} = require('./src/shared/horizon-integration');
const { refreshMicrosoftAuthorization } = require('./src/shared/launch-authorization');
const { runProfileImportDownloads } = require('./src/shared/profile-import');
const {
  ONECLIENT_MODPACK_PROJECT_ID,
  createOneClientProfileMetadata,
  sortCompatibleModrinthModpackVersions,
  validateModrinthPackDependencies,
} = require('./src/shared/modpack-runtime');
const { recordProfilePlaytime } = require('./src/shared/profile-playtime');
const { getForgeVersions } = require('./src/shared/forge-version');
const {
  buildBaldMenuConfig,
  createBaldMenuBridge,
  isSupportedBaldMenuTarget,
  normalizeBaldMenuSettings,
  reconcileBaldMenuMod,
} = require('./src/shared/bald-menu-integration');
const {
  areProfileRootsIsolated,
  canCreateOptimizationProfile,
  compareBenchmarkGroups,
  copyMinecraftVisualSettings,
  createBenchmarkConfigurationSignature,
  createBenchmarkSignature,
  findModSetConflicts,
  getJvmArguments,
  getRequiredJavaVersion,
  isOptimizationOptedIn,
  parsePresentMonCsv,
  parseWindowsCommandLine,
  recommendMinecraftMemoryGb,
  runIsolatedProfileSetup,
  validateRendererBundleSelection,
} = require('./src/shared/performance-runtime');
const { configureUpdaterFeed } = require('./src/shared/updater-feed');
const { createStateSafetySnapshot } = require('./src/shared/update-snapshot');
const { normalizeAccountCosmetics, getAccountCosmetics, setAccountSelection, pushRecentItem } = require('./src/cosmetics/account/cosmetic-state');
const { createCosmeticLibrary } = require('./src/cosmetics/library/cosmetic-library');
const { resolveCustomSkinLoader } = require('./src/cosmetics/custom-skin-loader/resolver');
const { installCustomSkinLoader, disableCustomSkinLoader, removeManagedInstallation } = require('./src/cosmetics/custom-skin-loader/installer');
const { diagnoseInstallation } = require('./src/cosmetics/custom-skin-loader/diagnostics');
const { readOwnership } = require('./src/cosmetics/custom-skin-loader/ownership');
const {
  analyzeMinecraftFailure: analyzeCodexStyleMinecraftFailure,
  getServerCrashExitCode,
  newestTextFile,
} = require('./src/crash/crash-analyzer');
const { readCrashEvidenceAtOffset } = require('./src/crash/evidence-reader');
const {
  getCurseForgeFingerprint,
  getCurseForgeSha1,
  isCurseForgeServerCompatible,
  getCurseForgeSideLabel,
  getModrinthSideLabel,
  isModrinthServerCompatible,
  mapCurseForgeProjectType,
  normalizeContentLoader,
  selectCurseForgeFile,
  selectModrinthVersion,
} = require('./src/content/content-provider-utils');

app.commandLine.appendSwitch('disable-features', 'DIPS');
if (process.platform === 'win32') app.setAppUserModelId('com.baldlauncher.app');

const htmlPath = path.join(__dirname, 'bald_launcher_v7.html');
const appIconPath = app.isPackaged
  ? path.join(process.resourcesPath, 'icon.ico')
  : path.join(__dirname, 'build', 'icon.ico');
let hasSingleInstanceLock = true;
try {
  hasSingleInstanceLock = app.requestSingleInstanceLock();
} catch (error) {
  console.warn('Single instance lock check failed:', error);
}

async function getInstalledGpuModels() {
  if (process.platform !== 'win32') return [];
  return new Promise(resolve => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Get-CimInstance Win32_VideoController | Select-Object Name | ConvertTo-Json -Compress'], {
      timeout: 8000, windowsHide: true, maxBuffer: 1024 * 1024,
    }, (error, stdout) => {
      if (error || !stdout.trim()) return resolve([]);
      try {
        const parsed = JSON.parse(stdout);
        resolve((Array.isArray(parsed) ? parsed : [parsed]).map(adapter => String(adapter.Name || '')).filter(Boolean));
      } catch (parseError) {
        console.warn('[Performance] Could not parse installed GPU inventory:', parseError);
        resolve([]);
      }
    });
  });
}

async function readWindowsGpuPreference(executablePath) {
  if (process.platform !== 'win32') {
    return { state: 'unsupported', value: null, error: 'Windows graphics preferences are only available on Windows.' };
  }
  const normalizedPath = String(executablePath || '').trim();
  if (!normalizedPath) return { state: 'unavailable', value: null, error: 'The Minecraft Java executable could not be determined.' };
  const encodedPath = Buffer.from(normalizedPath, 'utf8').toString('base64');
  const script = [
    '$ErrorActionPreference = "Stop"',
    `$exePath = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String("${encodedPath}"))`,
    '$key = Get-ItemProperty -Path "HKCU:\\Software\\Microsoft\\DirectX\\UserGpuPreferences" -ErrorAction SilentlyContinue',
    '$property = if ($key) { $key.PSObject.Properties[$exePath] } else { $null }',
    '$value = if ($property) { [string]$property.Value } else { $null }',
    '@{ value = $value } | ConvertTo-Json -Compress',
  ].join('; ');
  return new Promise(resolve => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      timeout: 8000,
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    }, (error, stdout) => {
      if (error || !stdout.trim()) {
        return resolve({
          state: 'unavailable',
          value: null,
          error: error?.message || 'Windows did not return the per-application graphics preference.',
        });
      }
      try {
        const result = JSON.parse(stdout);
        const value = typeof result.value === 'string' ? result.value : null;
        resolve({ state: parseWindowsGpuPreference(value), value, error: null });
      } catch (parseError) {
        resolve({ state: 'unavailable', value: null, error: `Could not parse the Windows graphics preference: ${parseError.message}` });
      }
    });
  });
}
if (!hasSingleInstanceLock) {
  console.warn('Single instance lock not acquired; continuing launch.');
}
const launcher = new MCLC.Client();
let profileImportInProgress = false;
let reloadTimer;
let stateFilePath;
let writeStatePending = false;
let launcherUpdateStatus = { state: 'idle' };
let updateCheckPromise = null;
if (hasSingleInstanceLock) {
  app.on('second-instance', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
}
const contentSearchCache = new Map();
const dependencyInstallControllers = new Map();
const CONTENT_SEARCH_CACHE_TTL_MS = 5 * 60 * 1000;
const resourcePackCatalogCache = new Map();
const resourcePackAssetCache = new Map();
const resourcePackModelCache = new Map();
const resourcePackBlockstateCache = new Map();
const RESOURCE_PACK_FORMATS = Object.freeze({
  '26.2': { min_format: 88, max_format: 88 },
  '26.1': { min_format: 84, max_format: 84 },
  '1.21.11': { min_format: 75, max_format: 75 },
  '1.21.4': { pack_format: 46 },
  '1.21.1': { pack_format: 34 },
  '1.20.6': { pack_format: 32 },
  '1.20.4': { pack_format: 22 },
  '1.20.1': { pack_format: 15 },
  '1.19.4': { pack_format: 13 },
  '1.18.2': { pack_format: 8 },
  '1.16.5': { pack_format: 6 },
  '1.12.2': { pack_format: 3 },
  '1.8.9': { pack_format: 1 },
  '1.7.10': { pack_format: 1 },
});
function minecraftAssetPath(textureName, fallbackType, fallbackName) {
  const normalized = String(textureName || '').replace(/^minecraft:/, '');
  const match = normalized.match(/^(?:item|items|block|blocks|entity)\/(.+?)(?:\.png)?$/);
  if (match) {
    const group = normalized.startsWith('entity/') ? 'entity' : normalized.startsWith('item') ? 'items' : 'blocks';
    return `${group}/${match[1]}.png`;
  }

  return `${fallbackType}/${fallbackName}.png`;
}

// Human-readable display name for a jar-sourced texture, derived purely from
// its own path (no third-party manifest involved).
function jarTextureName(category, leaf) {
  const suffix = {
    block: 'Block Texture', item: 'Item Texture', entity: 'Entity Texture',
    gui: 'GUI Texture', particle: 'Particle', painting: 'Painting',
    trims: 'Armor Trim', mob_effect: 'Mob Effect Icon', map: 'Map Texture',
    environment: 'Environment Texture', misc: 'Miscellaneous Texture',
    font: 'Font Texture', colormap: 'Color Map', effect: 'Effect',
  }[category] || 'Texture';
  const normalized = String(leaf || '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()
    .replace(/\b\w/g, character => character.toUpperCase());
  const suffixPattern = new RegExp(`\\s+${suffix.replace(/ /g, '\\s+')}\\s*$`, 'i');
  return suffixPattern.test(normalized) ? normalized : `${normalized} ${suffix}`;
}
const playitManager = createPlayitManager({
  app,
  shell,
  emit: message => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (message?.type === 'data') mainWindow.webContents.send('server:playit-data', message.data);
    if (message?.type === 'clear') mainWindow.webContents.send('server:playit-clear');
    if (message?.type === 'exit') mainWindow.webContents.send('server:playit-exit', message);
    if (message?.status) mainWindow.webContents.send('server:playit-state', message);
  },
});

const MODRINTH_API = 'https://api.modrinth.com/v2';
const modrinthHashCache = new Map();
const modrinthVersionsCache = new Map();
const curseForgeVersionsCache = new Map();
const installedContentHashCache = new Map();
const installedContentFingerprintCache = new Map();
const installedModMetadataCache = new Map();
const installedCurseForgeMatchCache = new Map();
const VERSION_MANIFEST_URL = 'https://launchermeta.mojang.com/mc/game/version_manifest_v2.json';
let versionManifestCache = null;
let versionManifestFetchedAt = 0;
const VERSION_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const FALLBACK_VERSIONS = ['26.2', '26.1', '1.21.11', '1.21.4', '1.21.1', '1.20.4', '1.20.1', '1.19.4', '1.19.2', '1.18.2', '1.16.5', '1.12.2', '1.8.9', '1.7.10'];
const CURSEFORGE_API = 'https://api.curseforge.com/v1';
const SERVER_CONTENT_TYPES = {
  vanilla: { projectTypes: ['datapack'] },
  fabric: { projectTypes: ['mod', 'datapack'], loader: 'fabric' },
  forge: { projectTypes: ['mod', 'datapack'], loader: 'forge' },
  neoforge: { projectTypes: ['mod', 'datapack'], loader: 'neoforge' },
  quilt: { projectTypes: ['mod', 'datapack'], loader: 'quilt' },
  paper: { projectTypes: ['plugin', 'datapack'], loader: 'paper' },
  purpur: { projectTypes: ['plugin', 'datapack'], loader: 'purpur' },
  folia: { projectTypes: ['plugin', 'datapack'], loader: 'folia' },
  spigot: { projectTypes: ['plugin', 'datapack'], loader: 'spigot' },
  bukkit: { projectTypes: ['plugin', 'datapack'], loader: 'bukkit' },
  velocity: { projectTypes: ['plugin'], loader: 'velocity' },
  waterfall: { projectTypes: ['plugin'], loader: 'waterfall' },
  bungeecord: { projectTypes: ['plugin'], loader: 'bungeecord' },
};

function buildSearchFacets(serverType, selectedChip) {
  const config = SERVER_CONTENT_TYPES[String(serverType || '').toLowerCase()] || SERVER_CONTENT_TYPES.paper;
  const types = selectedChip === 'all' || !selectedChip ? config.projectTypes : [selectedChip];
  if (types.some(type => !config.projectTypes.includes(type))) return null;
  const facets = [types.map(type => `project_type:${type}`)];
  if (config.loader) facets.push([`categories:${config.loader}`]);
  return facets;
}
const LOADER_INSTALLER_DIR = 'loader-installers';

// ---------------------------------------------------------------------------
// Renderer compatibility is deliberately explicit. A Modrinth release is
// necessary but not sufficient for Vulkan support: render-path and culling
// projects stay excluded until their VulkanMod behavior is verified.
const RENDERER_DATABASE = {
  '1.21.11:fabric:vulkanmod': {
    status: 'supported',
    label: 'Vulkan (VulkanMod)',
    project: 'vulkanmod',
    optimizationMods: ['not-enough-vulkan', 'lithium', 'ferrite-core', 'c2me-fabric', 'krypton', 'badoptimizations', 'threadtweak', 'scalablelux'],
    dependencies: ['fabric-api'],
    excludedMods: ['immediatelyfast', 'modernfix', 'noisium', 'entityculling', 'moreculling', 'particle-core', 'dynamic-fps'],
    compatibility: {
      'vulkanmod': 'SUPPORTED', 'not-enough-vulkan': 'SUPPORTED', 'lithium': 'SUPPORTED', 'ferrite-core': 'SUPPORTED',
      'c2me-fabric': 'SUPPORTED', 'krypton': 'SUPPORTED', 'badoptimizations': 'SUPPORTED', 'threadtweak': 'SUPPORTED', 'scalablelux': 'SUPPORTED',
      'immediatelyfast': 'UNKNOWN', 'modernfix': 'INCOMPATIBLE', 'noisium': 'INCOMPATIBLE', 'entityculling': 'UNKNOWN',
      'moreculling': 'UNKNOWN', 'particle-core': 'UNKNOWN', 'dynamic-fps': 'PARTIALLY SUPPORTED',
    },
  },
  '26.1.1:fabric:vulkanmod': {
    status: 'supported',
    label: 'Vulkan (VulkanMod)',
    project: 'vulkanmod',
    optimizationMods: ['not-enough-vulkan', 'lithium', 'ferrite-core', 'c2me-fabric', 'krypton', 'badoptimizations', 'threadtweak', 'scalablelux'],
    dependencies: ['fabric-api'],
    excludedMods: ['immediatelyfast', 'modernfix', 'noisium', 'entityculling', 'moreculling', 'particle-core', 'dynamic-fps'],
  },
  '26.2:fabric:sodium-native-vulkan': {
    status: 'recommended',
    label: 'Sodium + Vulkan',
    project: 'sodium',
    optimizationMods: ['lithium', 'ferrite-core', 'c2me-fabric', 'krypton', 'badoptimizations', 'threadtweak'],
    dependencies: ['fabric-api'],
    excludedMods: ['vulkanmod', 'not-enough-vulkan', 'entityculling', 'moreculling', 'immediatelyfast', 'modernfix', 'noisium', 'particle-core'],
    compatibility: { sodium: 'SUPPORTED', lithium: 'SUPPORTED', 'ferrite-core': 'SUPPORTED', 'c2me-fabric': 'SUPPORTED', krypton: 'SUPPORTED', badoptimizations: 'SUPPORTED', threadtweak: 'SUPPORTED' },
  },
};

const RENDERER_PROJECTS = {
  sodium: { slug: 'sodium', loaders: ['fabric', 'quilt', 'neoforge'] },
  vulkanmod: { slug: 'vulkanmod', loaders: ['fabric', 'quilt'] },
  embeddium: { slug: 'embeddium', loaders: ['forge', 'neoforge'] },
};

const VULKAN_SUPPORTED_1_21 = new Set(['1.21', '1.21.1', '1.21.2', '1.21.3', '1.21.4', '1.21.5', '1.21.9', '1.21.10', '1.21.11']);

function getRendererDatabaseEntry(mcVersion, loader, renderer) {
  const normalizedLoader = normalizeContentLoader(loader);
  const exact = RENDERER_DATABASE[`${mcVersion}:${normalizedLoader}:${renderer}`]
    || (mcVersion.startsWith('26.1') ? RENDERER_DATABASE[`26.1.1:${normalizedLoader}:${renderer}`] : null)
    || (mcVersion.startsWith('26.2') ? RENDERER_DATABASE[`26.2:${normalizedLoader}:${renderer}`] : null);
  if (exact) return exact;
  return null;
}

function getVulkanDatabaseEntry(mcVersion, loader) {
  loader = normalizeContentLoader(loader);
  if (mcVersion.startsWith('26.2') && loader === 'fabric') return getRendererDatabaseEntry(mcVersion, loader, 'sodium-native-vulkan');
  if (loader === 'fabric' && VULKAN_SUPPORTED_1_21.has(mcVersion)) {
    return RENDERER_DATABASE['1.21.11:fabric:vulkanmod'];
  }
  return getRendererDatabaseEntry(mcVersion, loader, 'vulkanmod');
}

function normalizeVersionList(versions) {
  if (!Array.isArray(versions)) return FALLBACK_VERSIONS;
  return versions
    .map(version => typeof version === 'string' ? version : version?.id || version?.version || '')
    .filter(Boolean)
    .filter((value, index, list) => list.indexOf(value) === index);
}

async function getVersionManifest() {
  const now = Date.now();
  if (versionManifestCache && now - versionManifestFetchedAt < VERSION_CACHE_TTL_MS) {
    return normalizeVersionList(versionManifestCache.filter(version => version?.type === 'release'));
  }
  try {
    const response = await axios.get(VERSION_MANIFEST_URL, { timeout: 8000 });
    versionManifestCache = response.data?.versions || [];
    versionManifestFetchedAt = now;
    fs.mkdirSync(path.join(app.getPath('userData'), 'cache'), { recursive: true });
    fs.writeFileSync(path.join(app.getPath('userData'), 'cache', 'version-manifest.json'), JSON.stringify({ fetchedAt: now, versions: versionManifestCache }));
    return normalizeVersionList(versionManifestCache.filter(version => version.type === 'release'));
  } catch (_error) {
    if (!versionManifestCache) {
      try {
        const cached = JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'cache', 'version-manifest.json'), 'utf8'));
        versionManifestCache = cached.versions || [];
      } catch (_cacheError) {}
    }
    return normalizeVersionList(versionManifestCache?.filter(version => version.type === 'release') || versionManifestCache || FALLBACK_VERSIONS);
  }
}

function parseVersion(v) {
  return String(v || '0')
    .split('.')
    .map(n => parseInt(n, 10) || 0);
}

function getRendererOptions(mcVersion, loader) {
  const l = String(loader || '').toLowerCase();
  const options = [];

  if (mcVersion.startsWith('26.2') && l === 'fabric') {
    options.push({ id: 'sodium-native-vulkan', label: 'Sodium + Vulkan', note: 'Native Vulkan backend; standalone VulkanMod is not used on 26.2+' });
  } else {
    if (RENDERER_PROJECTS.sodium.loaders.includes(l)) {
      options.push({ id: 'sodium', label: 'Sodium', note: 'Exact Minecraft and loader compatibility is checked before installation' });
    }
    if (getVulkanDatabaseEntry(mcVersion, l)?.status === 'supported') {
      options.push({ id: 'vulkan', label: 'Vulkan (VulkanMod)', note: 'Verified Vulkan-specific profile for this version + loader' });
    }
  }
  if (RENDERER_PROJECTS.embeddium.loaders.includes(l)) {
    options.push({ id: 'embeddium', label: 'Embeddium', note: "Forge/NeoForge's Sodium-equivalent renderer" });
  }
  options.push({ id: 'vanilla', label: l === 'forge' ? 'Vanilla / OptiFine' : 'Vanilla', note: 'Always available fallback' });

  return options;
}

const COMMON_VERSIONS = [
  '1.21.4', '1.21.3', '1.21.1', '1.20.6', '1.20.4', '1.20.1',
  '1.19.4', '1.19.2', '1.18.2', '1.16.5', '1.12.2', '1.8.9',
];
const LOADERS = ['fabric', 'forge', 'neoforge', 'quilt', 'vanilla'];

// ---------------------------------------------------------------------------
// Renderer-mode companion bundles
//
// Curated from current community consensus (Sodium: Sodium + Lithium +
// FerriteCore + EntityCulling + ModernFix is the recurring "core stack";
// Vulkan: Lithium/C2ME/EntityCulling as the non-renderer-conflicting
// companions for VulkanMod). These are search terms, not fixed Modrinth
// IDs — the actual project is resolved via a live search per version/loader
// so this stays correct as mods update. Worth revisiting periodically since
// "best bundle" opinions shift.
// ---------------------------------------------------------------------------
const RENDERER_BUNDLES = {
  vulkan: ['VulkanMod', 'Not Enough Vulkan', 'Lithium', 'FerriteCore', 'C2ME', 'Krypton', 'BadOptimizations', 'ThreadTweak', 'ScalableLux'],
  sodium: ['Sodium', 'Lithium', 'FerriteCore', 'ImmediatelyFast', 'ModernFix', 'EntityCulling', 'BadOptimizations', 'MoreCulling'],
  'sodium-native-vulkan': ['Sodium', 'Lithium', 'FerriteCore', 'ImmediatelyFast', 'ModernFix', 'EntityCulling', 'BadOptimizations', 'MoreCulling'],
  embeddium: ['Embeddium', 'FerriteCore', 'ModernFix'],
};

const OPTIMIZATION_PROJECT_SLUGS = {
  'VulkanMod': 'vulkanmod',
  'Not Enough Vulkan': 'not-enough-vulkan',
  Lithium: 'lithium',
  FerriteCore: 'ferrite-core',
  C2ME: 'c2me-fabric',
  Krypton: 'krypton',
  BadOptimizations: 'badoptimizations',
  ThreadTweak: 'threadtweak',
  ScalableLux: 'scalablelux',
  ImmediatelyFast: 'immediatelyfast',
  ModernFix: 'modernfix',
  EntityCulling: 'entityculling',
  MoreCulling: 'moreculling',
  BadOptimizations: 'badoptimizations',
  Sodium: 'sodium',
  Embeddium: 'embeddium',
};

const OPTIONAL_RENDERER_RECOMMENDATIONS = new Set(['MoreCulling']);

function getRendererBundleDefinition(mcVersion, loader, rendererMode) {
  const normalizedLoader = normalizeContentLoader(loader);
  const databaseEntry = rendererMode === 'vulkan'
    ? getVulkanDatabaseEntry(mcVersion, normalizedLoader)
    : getRendererDatabaseEntry(mcVersion, normalizedLoader, rendererMode);
  const fallbackProjects = (RENDERER_BUNDLES[rendererMode] || [])
    .map(term => OPTIMIZATION_PROJECT_SLUGS[term])
    .filter(Boolean);
  const allowedProjectIds = databaseEntry
    ? [databaseEntry.project, ...(databaseEntry.optimizationMods || [])].filter(Boolean)
    : fallbackProjects;
  return {
    allowedProjectIds: [...new Set(allowedProjectIds)],
    excludedProjectIds: databaseEntry?.excludedMods || [],
  };
}

const DEFAULT_THEME = {
  name: 'Default',
  colors: {
    bgVoid: '#0a0a0a',
    bgSurface: '#111111',
    bgSurface2: '#161616',
    border: '#1e1e1e',
    borderStrong: '#2a2a2a',
    accentGreen: '#7ef15e',
    accentGreenBg: '#2d6e1a',
    accentGreenBgHover: '#357a1e',
    accentGreenText: '#d4f0c4',
    accentPurple: '#7f77dd',
    accentPurpleBg: '#221c47',
    textPrimary: '#cccccc',
    textSecondary: '#555555',
    textMuted: '#3a3a3a',
    bgSidebar: '#0f1317',
    bgHeader: '#0a0a0a',
    bgCard: '#111111',
    bgCardHover: '#1a2128',
    bgSelected: '#18251a',
    bgInput: '#161616',
    inputFocus: '#7ef15e',
    accentPrimaryHover: '#91f270',
    accentSecondaryHover: '#aaa3ff',
    success: '#78e35a',
    warning: '#e5b84e',
    error: '#f06a6a',
    info: '#69b9ee',
    playButton: '#2d6e1a',
    browseButton: '#221c47',
    downloadButton: '#2d6e1a',
    dangerButton: '#7f1d1d',
    scrollbar: '#35424e',
    notification: '#f06a6a',
  },
  typography: {
    fontFamily: 'system-ui, -apple-system, sans-serif',
    fontSizeXs: '10px',
    fontSizeSm: '11px',
    fontSizeBase: '12px',
    fontSizeMd: '13px',
    fontSizeLg: '14px',
    fontSizeXl: '16px',
    fontWeight: '400',
    headingWeight: '650',
    letterSpacing: '0px',
    lineHeight: '1.45',
  },
  spacing: {
    paddingSmall: '8px',
    paddingBase: '12px',
    paddingLarge: '16px',
    gapSmall: '4px',
    gapBase: '8px',
    gapLarge: '14px',
    compact: '8px',
    comfortable: '12px',
    spacious: '18px',
  },
  borders: {
    radiusSmall: '6px',
    radiusBase: '8px',
    radiusMd: '12px',
    borderWidth: '0.5px',
    enabled: true,
    opacity: 100,
    style: 'solid',
  },
  background: {
    type: 'solid',
    image: '',
    blur: 0,
    opacity: 100,
    overlayColor: '#000000',
    overlayOpacity: 0,
    brightness: 100,
    saturation: 100,
    fit: 'cover',
    gradient: 'linear-gradient(135deg, #0a0a0a, #161616)',
  },
  corners: {
    card: '9px',
    button: '8px',
    input: '6px',
    tab: '6px',
    modCard: '9px',
    serverCard: '9px',
    profileCard: '12px',
    modal: '12px',
    notification: '8px',
  },
  shadows: {
    small: '0 2px 8px rgba(0,0,0,.22)',
    medium: '0 8px 24px rgba(0,0,0,.3)',
    large: '0 18px 48px rgba(0,0,0,.4)',
  },
  effects: {
    shadowEnabled: true,
    glowEnabled: false,
    blur: 0,
    transparency: 100,
    cardOpacity: 100,
    backgroundBlur: 0,
    buttonGlow: 0,
    hoverLift: 1,
    transitionSpeed: 180,
    reducedMotion: false,
  },
  sidebar: {
    width: '76px',
    background: '#0f1317',
    border: '#26303a',
    iconSize: '20px',
    textSize: '11px',
    selectedBackground: '#18251a',
    selectedText: '#78e35a',
    hoverBackground: '#1a2128',
    hoverText: '#e5e9ed',
    radius: '10px',
    spacing: '6px',
  },
  buttons: { radius: '8px', height: '36px', weight: '600', glow: 0 },
  cards: { background: '#111111', hover: '#1a2128', selected: '#18251a', opacity: 100, radius: '9px', shadow: true },
  inputs: { background: '#161616', focus: '#7ef15e', radius: '6px', border: '#35424e' },
  modals: { background: '#111111', opacity: 100, radius: '12px', shadow: true, blur: 4 },
  advanced: {
    customCss: '',
  },
};

function createBuiltInTheme(name, overrides = {}) {
  const theme = JSON.parse(JSON.stringify(DEFAULT_THEME));
  Object.entries(overrides).forEach(([section, values]) => {
    theme[section] = { ...(theme[section] || {}), ...values };
  });
  theme.name = name;
  return theme;
}

const DEFAULT_STATE = {
  accounts: [
    { id: 'ms-main', name: 'YourName', type: 'Microsoft', initials: 'YO', accent: '#3c3489', fg: '#ceecf6' },
    { id: 'offline-local', name: 'LocalPlayer', type: 'Offline', initials: 'LP', accent: '#173404', fg: '#97c459' },
  ],
  activeAccountId: 'ms-main',
  profiles: [
    {
      id: 'default',
      name: 'Default profile',
      mcVersion: '1.21.1',
      loader: 'fabric',
      rendererMode: 'vulkan',
      icon: 'B',
      mods: [],
      prewarmEnabled: true,
      customSkinLoader: {
        enabled: false,
        state: 'disabled',
        managed: false,
        compatibility: null,
        lastError: null,
      },
    },
  ],
  activeProfileId: 'default',
  settings: {
    memoryMax: recommendMinecraftMemoryGb(os.totalmem(), os.freemem()),
    memoryMaxAuto: true,
    resolution: '1920×1080',
    fpsCap: 'Unlimited',
    renderDistance: 8,
    simulationDistance: 5,
    vanillaPerformancePresetEnabled: true,
    jvmProfile: 'default',
    customJvmArgs: '',
    optimizationModsEnabled: false,
    minecraftClientModEnabled: true,
    minecraftMenuEnabled: true,
    minecraftPerformanceButtonEnabled: true,
    minecraftInGameButtonEnabled: true,
    minecraftPerformanceHudEnabled: false,
    playitKeepRunningOnClose: false,
    horizonLauncherPath: '',
    horizonInstanceId: '',
    horizonPrewarmByInstance: {},
    horizonAccountId: '',
  },
  themes: {
    '1': createBuiltInTheme('Bald Dark'),
    '2': createBuiltInTheme('AMOLED', { colors: { bgVoid: '#000000', bgSurface: '#050505', bgSurface2: '#0b0b0b', bgSidebar: '#020202', bgCard: '#070707' } }),
    '3': createBuiltInTheme('Emerald', { colors: { accentGreen: '#65f28b', accentGreenBg: '#155c34', accentGreenBgHover: '#1d7844', selected: '#163a27', accentPurple: '#63d5c8' }, sidebar: { selectedBackground: '#163a27', selectedText: '#65f28b' } }),
    '4': createBuiltInTheme('Purple', { colors: { accentGreen: '#c2a3ff', accentGreenBg: '#493477', accentGreenBgHover: '#5f4798', accentPurple: '#d3bfff', accentPurpleBg: '#2f2050', inputFocus: '#c2a3ff' }, sidebar: { selectedBackground: '#2f2050', selectedText: '#d3bfff' } }),
    '5': createBuiltInTheme('Minecraft', { colors: { accentGreen: '#7bc043', accentGreenBg: '#35651b', accentGreenBgHover: '#477e23', accentPurple: '#d4a85c', accentPurpleBg: '#4a351d', bgCard: '#151713' }, sidebar: { selectedBackground: '#203b16', selectedText: '#9be45f' } }),
  },
  activeThemeId: '1',
  servers: [],
  performanceMachineId: crypto.randomUUID(),
  profileSync: {
    sourceMode: 'profile',
    sourceProfileId: null,
    manualPaths: {},
    categories: ['options', 'keybinds', 'servers', 'resourcepacks', 'shaders', 'configs'],
    destinationProfileIds: [],
    horizonDestinationInstanceIds: [],
    horizonCategories: ['options', 'keybinds', 'resourcepacks'],
    syncNextNewProfile: false,
    autoSyncEveryNewProfile: false,
  },
};

function normalizeProfileSync(value) {
  const input = value && typeof value === 'object' ? value : {};
  return {
    sourceMode: input.sourceMode === 'manual' ? 'manual' : 'profile',
    sourceProfileId: input.sourceProfileId ? String(input.sourceProfileId) : null,
    manualPaths: input.manualPaths && typeof input.manualPaths === 'object'
      ? Object.fromEntries(Object.entries(input.manualPaths).map(([key, item]) => [key, String(item || '').trim()]).filter(([, item]) => item))
      : {},
    categories: Array.isArray(input.categories) ? input.categories.map(String) : DEFAULT_STATE.profileSync.categories.slice(),
    destinationProfileIds: Array.isArray(input.destinationProfileIds) ? input.destinationProfileIds.map(String) : [],
    horizonDestinationInstanceIds: Array.isArray(input.horizonDestinationInstanceIds)
      ? [...new Set(input.horizonDestinationInstanceIds.map(String).filter(Boolean))].slice(0, 100)
      : [],
    horizonCategories: Array.isArray(input.horizonCategories)
      ? [...new Set(input.horizonCategories.map(String).filter(category => ['options', 'keybinds', 'resourcepacks'].includes(category)))]
      : DEFAULT_STATE.profileSync.horizonCategories.slice(),
    syncNextNewProfile: input.syncNextNewProfile === true || (input.autoSyncNewProfiles === true && input.autoSyncEveryNewProfile !== true),
    autoSyncEveryNewProfile: input.autoSyncEveryNewProfile === true,
  };
}

let launcherState = cloneDefaultState();
const secureStateCodec = createSecureStateCodec(safeStorage, {
  onDecryptError: (error, accountId) => console.error(`[Auth] Could not decrypt stored credentials for account ${accountId}:`, error),
});
const launcherStateStore = createStateStore({
  getStateFilePath: () => getStateFilePath(),
  initialState: launcherState,
  serializeState: secureStateCodec.serializeState,
  deserializeState: secureStateCodec.deserializeState,
  onPersisted: secureStateCodec.markPersisted,
  normalizeState: rawState => {
    if (!rawState || typeof rawState !== 'object') return cloneDefaultState();
    if (rawState && Array.isArray(rawState.profiles) && rawState.profiles.length) {
      return {
        accounts: Array.isArray(rawState.accounts) && rawState.accounts.length ? rawState.accounts.map(normalizeAccount) : DEFAULT_STATE.accounts.map(normalizeAccount),
        activeAccountId: rawState.activeAccountId || DEFAULT_STATE.activeAccountId,
        profiles: rawState.profiles.map(normalizeProfile),
        activeProfileId: rawState.activeProfileId || rawState.profiles[0].id,
        settings: normalizeSettings(rawState.settings),
        sessions: Array.isArray(rawState.sessions) ? rawState.sessions : [],
        servers: Array.isArray(rawState.servers) ? rawState.servers.map(normalizeServer) : [],
        performanceMachineId: String(rawState.performanceMachineId || crypto.randomUUID()),
        themes: rawState.themes || DEFAULT_STATE.themes,
        activeThemeId: rawState.activeThemeId || DEFAULT_STATE.activeThemeId,
        profileSync: normalizeProfileSync(rawState.profileSync),
      };
    }
    return cloneDefaultState();
  },
  onPersistError: error => console.error('State persistence error:', error),
});
const runningProcesses = new Map();
const javaPrewarmedProcesses = new Map();
const javaPrewarmTasks = new Map();
const horizonProcesses = new Map();
const horizonPrewarmedProcesses = new Map();
const horizonPrewarmTasks = new Map();
let horizonPrewarmShutdownRequested = false;
let horizonPrewarmCoverCount = 0;
const profilePlaytimeIntervals = new Map();
const serverProcesses = new Map();
const serverStartupTasks = new Map();
const serverStartedAt = new Map();
const serverTpsSamples = new Map();
const tpsPollState = new Map();
const serverOutputLineBuffers = new Map();
const serverTpsPollRetryAt = new Map();
const serverJarValidationCache = new Map();
const serverProcessPollers = new Map();
const javaMajorVersionCache = new Map();
const serverJavaPathCache = new Map();
let playitProcess = null;
const playitState = {
  installed: false,
  linked: false,
  claimUrl: '',
  claimCode: '',
  authTimedOut: false,
  agentName: '',
  addressByServer: {},
  publicAddressByServer: {},
  consoleLines: [],
  pendingServerId: '',
  status: 'not-installed',
};

function getPlayitProcessNames() {
  return process.platform === 'win32' ? ['playit.exe', 'playitd.exe'] : ['playit', 'playitd'];
}

function getPlayitAgentPath() {
  return path.join(app.getPath('userData'), 'playit', process.platform === 'win32' ? 'playit.exe' : 'playit');
}

function isPlayitChildRunning(child) {
  if (!child || child.killed || child.exitCode !== null) return false;
  try {
    process.kill(child.pid, 0);
    return true;
  } catch (_error) {
    return false;
  }
}

function findPlayitDaemonProcess() {
  try {
    const processNames = getPlayitProcessNames();
    if (process.platform === 'win32') {
      const output = execFileSync('tasklist', ['/FO', 'CSV', '/NH'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      const lines = String(output || '').split(/\r?\n/);
      for (const line of lines) {
        if (!line.trim()) continue;
        const match = line.match(/"([^"]+)"\s*,\s*"([^"]+)"/);
        if (!match) continue;
        const processName = match[1].toLowerCase();
        const pid = Number(match[2]);
        if (Number.isFinite(pid) && processNames.some(name => processName === name.toLowerCase())) {
          return { pid, name: processName };
        }
      }
      return null;
    }
    const output = execFileSync('ps', ['-eo', 'pid,comm'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    const lines = String(output || '').split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const match = trimmed.match(/^(\d+)\s+(.*)$/);
      if (!match) continue;
      const pid = Number(match[1]);
      const name = String(match[2] || '').trim();
      const lowered = name.toLowerCase();
      if (processNames.some(candidate => lowered === candidate.toLowerCase() || lowered.endsWith(`/${candidate.toLowerCase()}`) || lowered.endsWith(`/${candidate.toLowerCase()}.exe`))) {
        return { pid, name };
      }
    }
    return null;
  } catch (_error) {
    return null;
  }
}

function stopPlayitAgent({ killOrphan = false } = {}) {
  if (playitProcess && !playitProcess.killed) {
    try {
      playitProcess.kill('SIGTERM');
      if (process.platform === 'win32') {
        try { execFileSync('taskkill', ['/PID', String(playitProcess.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (_error) {}
      }
    } catch (_error) {}
    playitProcess = null;
  }
  if (killOrphan) {
    const orphan = findPlayitDaemonProcess();
    if (orphan) {
      try {
        if (process.platform === 'win32') {
          execFileSync('taskkill', ['/PID', String(orphan.pid), '/F'], { stdio: 'ignore' });
        } else {
          process.kill(orphan.pid, 'SIGTERM');
        }
      } catch (_error) {}
    }
  }
  playitState.status = hasNativePlayitLink() ? 'linked-offline' : 'not-linked';
  if (!fs.existsSync(getPlayitAgentPath())) playitState.status = 'not-installed';
}

function getNativePlayitConfigPath() {
  return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'playit_gg', 'playit.toml');
}

function getPlayitCliPath() {
  if (process.platform === 'win32') {
    const candidates = [
      path.join(process.env.PROGRAMFILES || 'C:\\Program Files', 'playit_gg', 'bin', 'playit.exe'),
      path.join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'playit_gg', 'bin', 'playit.exe'),
      path.join(app.getPath('userData'), 'playit', 'playit.exe'),
      path.join(__dirname, 'playit', 'playit.exe'),
    ];
    return candidates.find(candidate => fs.existsSync(candidate)) || candidates[0];
  }
  return path.join(os.homedir(), '.local', 'bin', 'playit');
}

function getPlayitCliOutput(args) {
  const cliPath = getPlayitCliPath();
  try {
    return execFileSync(cliPath, args, { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (error) {
    const stdout = error && error.stdout ? String(error.stdout) : '';
    const stderr = error && error.stderr ? String(error.stderr) : '';
    const combined = [stdout, stderr].filter(Boolean).join('\n').trim();
    throw new Error(combined || (error && error.message) || 'Playit command failed');
  }
}

function getPlayitPublicEndpoint() {
  try {
    const response = JSON.parse(getPlayitCliOutput(['tunnels', 'list']));
    const tunnel = Array.isArray(response?.tunnels)
      ? response.tunnels.find(item => item?.active && item?.origin?.data?.local_port)
      : null;
    const domain = String(tunnel?.alloc?.assigned_domain || tunnel?.alloc?.assigned_srv || '').trim();
    const publicPort = Number(tunnel?.alloc?.port_start || 0);
    if (!domain) return null;
    return publicPort > 0 ? `${domain}:${publicPort}` : domain;
  } catch (error) {
    console.error('Unable to resolve the active Playit tunnel endpoint:', error instanceof Error ? error.message : String(error));
    return null;
  }
}

function clearPlayitConfigForRelink() {
  try {
    const configPath = getNativePlayitConfigPath();
    if (fs.existsSync(configPath)) {
      fs.rmSync(configPath, { force: true });
    }
    const appPlayitDir = path.join(app.getPath('userData'), 'playit');
    if (fs.existsSync(appPlayitDir)) {
      fs.rmSync(appPlayitDir, { recursive: true, force: true });
    }
  } catch (_error) {
    // Ignore cleanup failures and let the user re-run the official Playit claim flow.
  }
}

function killPlayitProcesses() {
  try {
    if (process.platform === 'win32') {
      for (const name of ['playitd.exe', 'playit.exe']) {
        try { execFileSync('taskkill', ['/IM', name, '/F'], { stdio: 'ignore' }); } catch (_error) {}
      }
    }
  } catch (_error) {}
}

function hasNativePlayitLink() {
  try {
    return /(^|\n)\s*secret_key\s*=\s*"[^"]+"/i.test(fs.readFileSync(getNativePlayitConfigPath(), 'utf8'));
  } catch (_error) {
    return false;
  }
}

function getPlayitStateKind() {
  const text = playitState.consoleLines.join('\n');
  if (!playitState.installed && !fs.existsSync(getPlayitAgentPath())) return 'not-installed';
  if (playitState.authTimedOut || /authorization timed out|timed out/i.test(text)) return 'timed-out';
  if (playitState.claimUrl || /claim url|claim code|Waiting for you to authorize|Waiting for frontend secret provisioning over IPC|configured agent secret is no longer valid|Waiting for.*authorization/i.test(text)) return 'waiting';
  if (/Another instance is already running|error:|failed|panic|invalid secret/i.test(text)) return 'error';
  if (!hasNativePlayitLink()) return 'not-linked';
  const appRunning = isPlayitChildRunning(playitProcess);
  const orphanRunning = Boolean(findPlayitDaemonProcess());
  if (appRunning || orphanRunning) return 'running';
  return 'linked-offline';
}

function readPlayitState() {
  const statePath = path.join(app.getPath('userData'), 'playit', 'state.json');
  try {
    const savedState = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    Object.assign(playitState, savedState);
  } catch (_error) {}
  playitState.installed = fs.existsSync(getPlayitAgentPath());
  playitState.consoleLines = Array.isArray(playitState.consoleLines) ? playitState.consoleLines.slice(-200) : [];
  playitState.linked = hasNativePlayitLink();
  if (playitState.linked) {
    playitState.claimUrl = '';
    playitState.claimCode = '';
  }
  if (!('authTimedOut' in playitState)) {
    playitState.authTimedOut = false;
  }
  playitState.status = getPlayitStateKind();
  const appRunning = isPlayitChildRunning(playitProcess);
  const orphanRunning = Boolean(findPlayitDaemonProcess());
  return { ...playitState, running: appRunning || orphanRunning, status: playitState.status };
}

function writePlayitState() {
  const statePath = path.join(app.getPath('userData'), 'playit', 'state.json');
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify(playitState, null, 2), 'utf8');
}

function attachPlayitProcessOutput(child) {
  if (!child) return;
  const handleOutput = chunk => {
    const text = String(chunk || '');
    const claim = text.match(/https?:\/\/[^\s]+(?:claim|account)[^\s]*/i) || text.match(/https?:\/\/playit\.gg\/claim\/[^\s]+/i);
    if (claim) {
      playitState.claimUrl = claim[0].replace(/[),.]+$/, '');
      try {
        if (playitState.claimUrl && !/playit\.gg\/claim\//i.test(playitState.claimUrl)) {
          // keep using the exact URL the binary printed when it is present
        }
      } catch (_error) {}
    }
    const lines = text.split(/\r?\n/).map(line => stripAnsi(String(line || '')).trim()).filter(line => line.length > 0);
    if (lines.length) {
      const invalidSecret = lines.some(line => /configured agent secret is no longer valid|Waiting for frontend secret provisioning over IPC|Another instance is already running/i.test(line));
      if (invalidSecret) {
        playitState.linked = false;
      }
      const claimUrlLine = lines.find(line => /https?:\/\/.*playit\.gg\/claim\//i.test(line));
      if (claimUrlLine) {
        const claimUrl = claimUrlLine.match(/https?:\/\/[^\s]+/i)?.[0]?.replace(/[),.]+$/, '');
        if (claimUrl) playitState.claimUrl = claimUrl;
      }
      appendPlayitConsoleLines(lines);
    }
  };
  child.stdout?.on('data', handleOutput);
  child.stderr?.on('data', handleOutput);
  child.once('error', error => {
    playitState.consoleLines.push(`Playit agent error: ${error instanceof Error ? error.message : String(error)}`);
    if (playitState.consoleLines.length > 250) playitState.consoleLines = playitState.consoleLines.slice(-250);
    writePlayitState();
    playitProcess = null;
  });
  child.once('close', () => {
    if (playitProcess && playitProcess.pid === child.pid) playitProcess = null;
  });
}

function hasPlayitProvisioningIssue() {
  return playitState.consoleLines.some(line => /configured agent secret is no longer valid|Waiting for frontend secret provisioning over IPC|Another instance is already running/i.test(line));
}

function appendPlayitConsoleLines(lines) {
  if (!Array.isArray(lines) || !lines.length) return;
  playitState.consoleLines.push(...lines);
  if (playitState.consoleLines.length > 250) playitState.consoleLines = playitState.consoleLines.slice(-250);
  writePlayitState();
}

function startPlayitAgent() {
  if (!fs.existsSync(getPlayitAgentPath())) {
    playitState.status = 'not-installed';
    writePlayitState();
    return false;
  }
  if (!hasNativePlayitLink()) {
    playitState.status = 'not-linked';
    writePlayitState();
    return false;
  }
  if (isPlayitChildRunning(playitProcess)) {
    playitState.status = 'running';
    writePlayitState();
    return true;
  }
  playitProcess = null;
  const agentPath = getPlayitAgentPath();
  const secretPath = getNativePlayitConfigPath();
  const orphan = findPlayitDaemonProcess();
  if (orphan) {
    playitState.status = 'running';
    playitState.consoleLines.push('Playit agent is already running outside this launcher; reusing the existing singleton instance.');
    if (playitState.consoleLines.length > 250) playitState.consoleLines = playitState.consoleLines.slice(-250);
    writePlayitState();
    return true;
  }
  if (hasPlayitProvisioningIssue()) {
    if (playitState.claimUrl) {
      try {
        shell.openExternal(playitState.claimUrl);
      } catch (_error) {}
    }
    playitState.status = 'waiting';
    playitState.consoleLines.push('Playit agent is waiting for a valid secret/provisioning state; not restarting automatically. Visit the claim link above to relink the Playit account.');
    if (playitState.consoleLines.length > 250) playitState.consoleLines = playitState.consoleLines.slice(-250);
    writePlayitState();
    return false;
  }
  playitProcess = spawn(agentPath, ['start', '--secret_path', secretPath], {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    detached: true,
  });
  attachPlayitProcessOutput(playitProcess);
  playitProcess.unref();
  playitState.status = 'running';
  writePlayitState();
  return true;
}

async function pollPlayitClaimExchange(claimCode, timeoutMs = 5 * 60 * 1000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const rawResult = getPlayitCliOutput(['claim', 'exchange', claimCode]);
      const result = String(rawResult || '').trim();
      if (result) return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      playitState.consoleLines.push(`Playit claim polling: ${message}`);
      if (playitState.consoleLines.length > 250) playitState.consoleLines = playitState.consoleLines.slice(-250);
      writePlayitState();
    }
    await new Promise(resolve => setTimeout(resolve, 4000));
  }
  throw new Error('Claim timed out — user did not authorize within 5 minutes');
}

function writePlayitSecretFile(secretText) {
  const cleaned = String(secretText || '').trim();
  if (!cleaned) throw new Error('Playit claim exchange returned an empty secret');
  const configDir = path.dirname(getNativePlayitConfigPath());
  fs.mkdirSync(configDir, { recursive: true });
  const secretPath = getNativePlayitConfigPath();
  if (/secret_key\s*=|\[.*\]|secret\s*=|token\s*=/i.test(cleaned)) {
    fs.writeFileSync(secretPath, cleaned, 'utf8');
    return;
  }
  fs.writeFileSync(secretPath, `secret_key = "${cleaned.replace(/"/g, '\\"')}"\n`, 'utf8');
}

async function runPlayitClaimFlow() {
  killPlayitProcesses();
  clearPlayitConfigForRelink();
  playitState.status = 'waiting';
  playitState.consoleLines = [
    'Starting Playit claim flow...',
    'Step 1: generating a fresh claim code using the official Playit CLI',
  ];
  playitState.claimUrl = '';
  playitState.claimCode = '';
  playitState.linked = false;
  playitState.authTimedOut = false;
  writePlayitState();
  const claimCode = String(getPlayitCliOutput(['claim', 'generate']) || '').trim();
  if (!claimCode) throw new Error('Playit claim generate returned an empty code');
  playitState.claimCode = claimCode;
  playitState.consoleLines.push(`Claim code: ${claimCode}`);
  const claimUrl = String(getPlayitCliOutput(['claim', 'url', claimCode]) || '').trim();
  if (!/^https?:\/\//i.test(claimUrl)) {
    throw new Error(`Invalid claim URL returned by Playit: ${claimUrl || '<empty>'}`);
  }
  playitState.claimUrl = claimUrl;
  playitState.consoleLines.push(`Claim URL: ${claimUrl}`);
  playitState.consoleLines.push('Waiting for you to authorize this agent on playit.gg...');
  writePlayitState();
  await shell.openExternal(claimUrl);
  try {
    const secretText = await pollPlayitClaimExchange(claimCode);
    playitState.consoleLines.push(`Exchange result: ${secretText}`);
    writePlayitSecretFile(secretText);
    playitState.consoleLines.push('Fresh secret written to the Playit secret file. The agent can start cleanly.');
    playitState.linked = true;
    playitState.claimUrl = '';
    playitState.claimCode = '';
    playitState.authTimedOut = false;
    playitState.status = 'linked-offline';
    writePlayitState();
    startPlayitAgent();
    return { ok: true, claimCode, claimUrl };
  } catch (error) {
    playitState.authTimedOut = true;
    playitState.status = 'timed-out';
    playitState.consoleLines.push(error instanceof Error ? error.message : String(error));
    writePlayitState();
    throw error;
  }
}

function getServerJarCandidates(serverType) {
  const type = normalizeServerType(serverType);
  return [
    'paper.jar',
    'purpur.jar',
    'folia.jar',
    'spigot.jar',
    'craftbukkit.jar',
    'bukkit.jar',
    'velocity.jar',
    'waterfall.jar',
    'bungeecord.jar',
    'paperclip.jar',
    'fabric-server-launch.jar',
    'quilt-server-launch.jar',
    'server.jar',
    'minecraft_server.jar',
    `${type}.jar`,
  ];
}

function getServerTpsConfig(server) {
  const installed = [
    ...(Array.isArray(server?.mods) ? server.mods : []),
    ...(Array.isArray(server?.content) ? server.content : []),
    ...(Array.isArray(server?.installedContent) ? server.installedContent : []),
  ];
  const profile = server?.profileId ? launcherState.profiles.find(item => item.id === server.profileId) : null;
  if (profile?.mods) installed.push(...profile.mods);
  let hasSparkFile = false;
  try {
    for (const folder of ['plugins', 'mods']) {
      const folderPath = path.join(getServerRoot(server.id), folder);
      if (server?.id && fs.existsSync(folderPath) && fs.readdirSync(folderPath).some(isActiveSparkJar)) {
        hasSparkFile = true;
        break;
      }
    }
  } catch (_error) {}
  return ServerStats.getTpsProviderConfig({
    serverType: server?.serverType,
    mcVersion: server?.mcVersion,
    installed,
    hasSparkFile,
  });
}

function isActiveSparkJar(fileName) {
  const name = String(fileName || '');
  return /\.jar$/i.test(name) && /^spark(?:[-_.]|$)/i.test(name);
}

function normalizeServerTpsLine(line) {
  return stripAnsi(String(line || ''))
    .replace(/^\[\d{2}:\d{2}:\d{2}(?:\s+[A-Z]+)?\]\s*(?:\[[^\]]+\])?:\s*/i, '')
    .replace(/^\[[^\]]+\]:\s*/, '')
    .replace(/^\[[^\]]+\]\s*:\s*/, '')
    .replace(/^\[[^\]]+\]\s*/, '')
    .replace(/^\[\s*(?:⚡|\?)\s*\]\s*/, '')
    .trim();
}

function parseServerTpsOutput(line) {
  return ServerStats.parseTpsOutput(line);
}

function parseServerMsptOutput(line) {
  return ServerStats.parseMsptOutput(line);
}

function normalizeServerCpuPercent(cpuPercent, logicalCpuCount = os.cpus().length) {
  if (cpuPercent == null) return null;
  const value = Number(cpuPercent);
  const coreCount = Math.max(1, Number(logicalCpuCount) || 1);
  return Number.isFinite(value) ? Number((value / coreCount).toFixed(1)) : null;
}

function stripAnsi(value) {
  return String(value || '').replace(/[\u001b\u009b]\[[0-?]*[ -\/]*[@-~]/g, '');
}

function recordServerTpsOutput(serverId, line) {
  const value = parseServerTpsOutput(normalizeServerTpsLine(line));
  if (value != null) {
    const previous = serverTpsSamples.get(serverId);
    serverTpsSamples.set(serverId, { value, mspt: previous?.mspt ?? null, recordedAt: Date.now() });
  }
}

function isTpsTelemetryLine(line) {
  const text = normalizeServerTpsLine(line);
  return parseServerTpsOutput(text) != null || /^(?:>|\s*)\/?(?:spark[bv]?\s+tps|tps|forge tps|neoforge tps)\s*$/i.test(text);
}

function isTpsPollLine(line) {
  const text = normalizeServerTpsLine(line);
  return isTpsTelemetryLine(text) || /^(?:>|\s*)\/?(?:spark\s+)?tps\b/i.test(text);
}

function isTpsValuesLine(line) {
  return /^\*?\d+(?:\.\d+)?(?:\s*,\s*\*?\d+(?:\.\d+)?){0,4}$/.test(normalizeServerTpsLine(line));
}

function isSparkTpsCommandEcho(line) {
  return /^(?:>\s*)?\/?spark[bv]?\s+tps\s*$/i.test(normalizeServerTpsLine(line));
}

function isSparkTpsCommand(command) {
  return /^spark[bv]?\s+tps$/i.test(String(command || '').trim());
}

function isTpsPollCommandFailure(line) {
  return /an unexpected error occurred while trying to execute that command/i.test(normalizeServerTpsLine(line));
}

function isSparkWorkerLogLine(line) {
  return /\[spark-worker-pool-[^\]]+\/INFO\]:\s*\[\s*⚡\s*\]/i.test(stripAnsi(String(line || '')));
}

function isSparkConsoleLine(line) {
  const text = stripAnsi(String(line || ''));
  return isSparkWorkerLogLine(text)
    || /\[\s*⚡\s*\]/.test(text)
    || isSparkTpsCommandEcho(text);
}

function isSparkConsoleMetricLine(text) {
  return /^(?:\*?\d+(?:\.\d+)?(?:\s*,\s*\*?\d+(?:\.\d+)?){0,4}|\d+(?:\.\d+)?\s*\/\s*\d+(?:\.\d+)?\s*\/\s*\d+(?:\.\d+)?\s*\/\s*\d+(?:\.\d+)?(?:\s*;\s*\d+(?:\.\d+)?\s*\/\s*\d+(?:\.\d+)?\s*\/\s*\d+(?:\.\d+)?\s*\/\s*\d+(?:\.\d+)?)?|\d+(?:\.\d+)?%\s*,\s*\d+(?:\.\d+)?%\s*,\s*\d+(?:\.\d+)?%\s*\((?:system|process)\))$/i.test(text);
}

function isSparkConsoleHistoryLine(line, state) {
  if (isSparkConsoleLine(line)) return true;
  const normalized = normalizeServerTpsLine(line);
  if (/\bTPS\b.*\bfrom last\b/i.test(normalized) || /Tick durations\b.*\bfrom last\b/i.test(normalized)) {
    state.remainingRows = 1;
    return true;
  }
  if (/CPU usage\b.*\bfrom last\b/i.test(normalized)) {
    state.remainingRows = 2;
    return true;
  }
  if (state.remainingRows > 0) {
    if (!normalized || isSparkConsoleMetricLine(normalized)) {
      state.remainingRows -= 1;
      return true;
    }
    state.remainingRows = 0;
  }
  return false;
}

function handleServerProcessOutput(serverId, type, chunk, stream = 'default') {
  const bufferKey = `${serverId}:${stream}`;
  const split = ServerStats.splitCompleteLines(serverOutputLineBuffers.get(bufferKey), chunk);
  serverOutputLineBuffers.set(bufferKey, split.remainder);
  const lines = split.lines.filter(Boolean);
  const state = tpsPollState.get(serverId);
  for (const line of lines) {
    const suppressConsoleLine = isSparkConsoleLine(line);
    recordServerTpsOutput(serverId, line);
    const normalized = normalizeServerTpsLine(line);
    if (state?.inFlight && isSparkTpsCommand(state.command)) {
      if (isSparkTpsCommandEcho(line)) continue;
      if (isTpsPollCommandFailure(line)) {
        state.commandFailed = true;
        state.resolve({ tps: state.tps, mspt: state.mspt, commandFailed: true });
        continue;
      }
      if (/\bTPS\b.*\bfrom last\b/i.test(normalized)) {
        state.sawSparkResponse = true;
        state.awaitingTps = true;
        state.buffer = [normalized];
        state.tps = parseServerTpsOutput(normalized);
        if (state.tps != null) state.awaitingTps = false;
        continue;
      }
      if (/Tick durations\b.*\bfrom last\b/i.test(normalized)) {
        state.sawSparkResponse = true;
        state.awaitingMspt = true;
        state.mspt = parseServerMsptOutput(normalized) ?? state.mspt;
        if (state.tps != null && state.mspt != null) state.resolve({ tps: state.tps, mspt: state.mspt });
        continue;
      }
      if (/CPU usage\b.*\bfrom last\b/i.test(normalized)) {
        state.sawSparkResponse = true;
        state.awaitingCpu = true;
        continue;
      }
      if (state.awaitingTps && isTpsValuesLine(line)) {
        state.buffer.push(normalized);
        state.tps = parseServerTpsOutput(state.buffer.join('\n'));
        state.awaitingTps = false;
        continue;
      }
      if (state.awaitingMspt) {
        const mspt = parseServerMsptOutput(normalized);
        if (mspt != null) {
          state.mspt = mspt;
          state.awaitingMspt = false;
          if (state.tps != null) state.resolve({ tps: state.tps, mspt: state.mspt });
          continue;
        }
        if (!normalized) continue;
        state.awaitingMspt = false;
      }
      if (state.awaitingCpu && /%\s*\(\s*(?:system|process)\s*\)\s*$/i.test(normalized)) {
        if (/\(\s*process\s*\)\s*$/i.test(normalized) && state.tps != null && state.mspt != null) {
          state.resolve({ tps: state.tps, mspt: state.mspt });
        }
        continue;
      }
      if (state.sawSparkResponse && isTpsValuesLine(line)) continue;
    }
    if (state?.inFlight && isTpsPollLine(line)) {
      state.buffer = [normalized];
      continue;
    }
    if (state?.inFlight && /Tick durations\b.*\bfrom last\b/i.test(normalized)) {
      state.awaitingMspt = true;
      continue;
    }
    if (state?.inFlight && state.awaitingMspt) {
      const mspt = parseServerMsptOutput(normalized);
      if (mspt != null) {
        state.mspt = mspt;
        if (state.tps != null) state.resolve({ tps: state.tps, mspt });
        continue;
      }
      if (!normalized) continue;
    }
    if (state?.inFlight && state.buffer.length && !state.tps && isTpsValuesLine(line)) {
      state.buffer.push(normalized);
      state.tps = parseServerTpsOutput(state.buffer.join('\n'));
      if (state.tps != null && (!isSparkTpsCommand(state.command) || state.mspt != null)) {
        state.resolve({ tps: state.tps, mspt: isSparkTpsCommand(state.command) ? state.mspt : null });
      }
      continue;
    }
    if (state?.inFlight && !isSparkTpsCommand(state.command)) {
      const mspt = parseServerMsptOutput(normalized);
      if (mspt != null) state.mspt = mspt;
      const tps = parseServerTpsOutput(normalized);
      if (tps != null) {
        state.tps = tps;
        state.resolve({ tps, mspt: state.mspt });
        continue;
      }
      if (mspt != null) continue;
    }
    if (!suppressConsoleLine) emitServerConsole(serverId, type, line);
  }
  return lines;
}
function cloneDefaultState() {
  return {
    accounts: DEFAULT_STATE.accounts.map(normalizeAccount),
    activeAccountId: DEFAULT_STATE.activeAccountId,
    profiles: DEFAULT_STATE.profiles.map(profile => normalizeProfile({ ...profile, mods: [...profile.mods] })),
    activeProfileId: DEFAULT_STATE.activeProfileId,
    settings: { ...DEFAULT_STATE.settings },
    sessions: [],
    servers: Array.isArray(DEFAULT_STATE.servers) ? DEFAULT_STATE.servers.map(normalizeServer) : [],
    performanceMachineId: DEFAULT_STATE.performanceMachineId,
  };
}

function getMinecraftRootFor(profileId) {
  const requestedId = typeof profileId === 'object' ? profileId?.id : profileId;
  const profile = typeof profileId === 'object'
    ? profileId
    : Array.isArray(launcherState?.profiles)
      ? launcherState.profiles.find(item => item.id === requestedId)
    : null;
  return path.join(app.getPath('userData'), 'profiles', profile?.folderName || requestedId);
}

const BALD_PROFILE_SCHEMA_VERSION = 1;

function createProfileId() {
  return `profile-${crypto.randomUUID()}`;
}

function getProfileFolderName(name, profileId, profiles = launcherState.profiles) {
  const base = sanitizeFileName(String(name || '').trim()).replace(/\.+$/g, '').slice(0, 80) || 'New profile';
  const used = new Set((profiles || []).map(profile => String(profile.folderName || '').toLowerCase()));
  if (!used.has(base.toLowerCase())) return base;
  return `${base} (${String(profileId).slice(-8)})`;
}

function reconcileProfileFolders() {
  const profilesRoot = path.join(app.getPath('userData'), 'profiles');
  if (!fs.existsSync(profilesRoot)) return false;
  const missing = launcherState.profiles.filter(profile => !fs.existsSync(getMinecraftRootFor(profile.id)));
  if (!missing.length) return false;
  const missingIds = new Set(missing.map(profile => profile.id));
  launcherState.profiles = launcherState.profiles.filter(profile => !missingIds.has(profile.id));
  if (!launcherState.profiles.some(profile => profile.id === launcherState.activeProfileId)) {
    launcherState.activeProfileId = launcherState.profiles[0]?.id || null;
  }
  scheduleStateWrite();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('launcher:state-changed', launcherState);
  }
  return true;
}

let profileFolderWatch = null;
let profileFolderWatchTimer = null;
function watchProfileFolders() {
  const profilesRoot = path.join(app.getPath('userData'), 'profiles');
  fs.mkdirSync(profilesRoot, { recursive: true });
  try {
    profileFolderWatch?.close();
    profileFolderWatch = fs.watch(profilesRoot, { persistent: false }, () => {
      clearTimeout(profileFolderWatchTimer);
      profileFolderWatchTimer = setTimeout(() => reconcileProfileFolders(), 150);
    });
  } catch (error) {
    console.error('[Profiles] Folder watch failed:', error);
  }
}

function getProfileBackupRoot(profileId) {
  return path.join(app.getPath('userData'), 'profile-backups', profileId);
}

function readTextIfPresent(filePath, maxBytes = 2 * 1024 * 1024) {
  try {
    if (!fs.existsSync(filePath)) return '';
    const stat = fs.statSync(filePath);
    const start = Math.max(0, stat.size - maxBytes);
    const handle = fs.openSync(filePath, 'r');
    const buffer = Buffer.alloc(Math.min(stat.size, maxBytes));
    fs.readSync(handle, buffer, 0, buffer.length, start);
    fs.closeSync(handle);
    return buffer.toString('utf8');
  } catch (_error) {
    return '';
  }
}

function analyzeMinecraftFailure(profile, session = null, exitCode = null) {
  const root = profile?.__logRoot || getMinecraftRootFor(profile.id);
  return analyzeCodexStyleMinecraftFailure({
    root,
    session,
    exitCode,
    profileId: profile?.id,
    profileName: profile?.name,
  });
}

function analyzeServerFailure(server) {
  return analyzeMinecraftFailure({
    id: `server-${server.id}`,
    name: server.name,
    __logRoot: getServerRoot(server.id),
  }, null, getServerCrashExitCode(server));
}

function validateProfileExport(value) {
  if (!value || typeof value !== 'object' || value.format !== 'baldprofile') {
    throw new Error('This file is not a Bald Launcher profile export.');
  }
  if (value.schemaVersion !== BALD_PROFILE_SCHEMA_VERSION) {
    throw new Error(`Unsupported Bald profile version: ${value.schemaVersion || 'unknown'}`);
  }
  if (!value.profile || typeof value.profile !== 'object') throw new Error('The profile export is missing its profile data.');
  const profile = normalizeProfile(value.profile);
  if (!profile.name || !profile.mcVersion || !profile.loader) throw new Error('The profile export is incomplete.');
  return profile;
}

function getServersRoot() {
  const root = path.join(app.getPath('appData'), 'Bald Launcher', 'servers');
  fs.mkdirSync(root, { recursive: true });
  return path.normalize(root);
}

function getProcessDetails(pid) {
  const processId = Number(pid);
  if (!Number.isInteger(processId) || processId <= 0) return null;
  try {
    if (process.platform === 'win32') {
      const script = `$p = Get-CimInstance Win32_Process -Filter \"ProcessId = ${processId}\"; if ($p) { $p | Select-Object ProcessId,Name,ExecutablePath,CommandLine,CreationDate | ConvertTo-Json -Compress }`;
      const output = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      return output ? JSON.parse(output) : null;
    }
    process.kill(processId, 0);
    return { ProcessId: processId };
  } catch (_error) {
    return null;
  }
}

function isProcessIdAlive(pid) {
  const processId = Number(pid);
  if (!Number.isInteger(processId) || processId <= 0) return false;
  try {
    process.kill(processId, 0);
    return true;
  } catch (error) {
    return !['ESRCH', 'EINVAL'].includes(error?.code);
  }
}

function listJavaProcesses() {
  if (process.platform !== 'win32') return [];
  try {
    const script = 'Get-CimInstance Win32_Process | Where-Object { $_.Name -match "^javaw?\\.exe$" } | Select-Object ProcessId,Name,ExecutablePath,CommandLine,CreationDate | ConvertTo-Json -Compress';
    const output = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (!output) return [];
    const parsed = JSON.parse(output);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch (_error) {
    return [];
  }
}

function findLiveServerProcess(server) {
  return findMatchingServerProcess(server, listJavaProcesses());
}

function adoptLiveServerProcess(server, details) {
  const pid = Number(details?.ProcessId);
  if (!server || !Number.isInteger(pid) || pid <= 0) return null;
  const runtime = {
    ...server.runtime,
    pid,
    javaPath: String(details.ExecutablePath || server.runtime?.javaPath || ''),
    jarFileName: server.jarFileName || server.runtime?.jarFileName || '',
    cwd: server.rootPath || server.runtime?.cwd || '',
    launchToken: server.runtime?.launchToken || `adopted-${Date.now()}`,
    startedAt: server.runtime?.startedAt || Date.now(),
    processStartTime: server.runtime?.processStartTime || getProcessStartTime(details) || Date.now(),
    lastKnownState: 'process-alive',
    lastExitReason: '',
  };
  updateServerInState(server.id, { status: 'running', runtime });
  const adopted = getServerById(server.id);
  monitorPersistedServerProcess(adopted);
  return adopted;
}

function hasWorldSessionLock(server) {
  const worldPath = path.join(getServerRoot(server.id), server.worldName || 'world');
  return fs.existsSync(path.join(worldPath, 'session.lock'));
}

function matchesServerProcessIdentity(server, runtime = server?.runtime) {
  if (!server || !runtime?.pid) return false;
  const details = getProcessDetails(runtime.pid);
  return verifyServerProcessIdentity(server, runtime, details);
}

function inspectPersistedServerProcess(server) {
  const pid = Number(server?.runtime?.pid);
  if (!Number.isInteger(pid) || pid <= 0 || !isProcessIdAlive(pid)) return 'stopped';
  const details = getProcessDetails(pid);
  if (!details) return 'unverified';
  return verifyServerProcessIdentity(server, server.runtime, details) ? 'matched' : 'different-process';
}

function stopServerProcessPoller(serverId) {
  const timer = serverProcessPollers.get(serverId);
  if (timer) clearInterval(timer);
  serverProcessPollers.delete(serverId);
}

function monitorPersistedServerProcess(server) {
  if (!server?.runtime?.pid) return;
  stopServerProcessPoller(server.id);
  const timer = setInterval(() => {
    const current = getServerById(server.id);
    const processState = current?.runtime?.pid ? inspectPersistedServerProcess(current) : 'stopped';
    if (processState !== 'matched') {
      stopServerProcessPoller(server.id);
      if (current?.runtime?.pid) {
        if (processState === 'unverified') {
          updateServerInState(server.id, {
            status: 'idle',
            runtime: { ...current.runtime, lastKnownState: 'unknown', lastExitReason: 'The PID is alive, but the server process identity could not be verified.' },
          });
          emitServerConsole(server.id, 'warn', 'The saved Java PID is alive, but the server process identity could not be verified. The launcher did not stop or replace it.');
        } else {
          updateServerInState(server.id, {
            status: 'idle',
            playerCount: 0,
            runtime: { ...current.runtime, pid: null, lastKnownState: 'unknown', lastExitReason: 'The saved PID no longer belongs to this server process.' },
          });
          emitServerConsole(server.id, 'warn', 'The saved PID no longer belongs to this server process. It was detached without terminating that process.');
        }
      }
      return;
    }
    if (current.status === 'idle') updateServerInState(server.id, { status: 'running', runtime: { ...current.runtime, lastKnownState: 'process-alive' } });
  }, 5000);
  serverProcessPollers.set(server.id, timer);
}

function reconcilePersistedServerProcesses() {
  let changed = false;
  launcherState.servers = launcherState.servers.map(server => {
    const runtime = server.runtime;
    if (!runtime?.pid) {
      if (server.status !== 'idle') { changed = true; return { ...server, status: 'idle', playerCount: 0, runtime: { ...runtime, lastKnownState: 'stopped' } }; }
      return server;
    }
    const processState = inspectPersistedServerProcess(server);
    if (processState === 'matched') {
      changed = true;
      monitorPersistedServerProcess(server);
      return { ...server, status: 'running', playerCount: 0, runtime: { ...runtime, lastKnownState: 'process-alive' } };
    }
    if (processState === 'unverified') {
      changed = true;
      return { ...server, status: 'idle', playerCount: 0, runtime: { ...runtime, lastKnownState: 'unknown', lastExitReason: 'The PID is alive, but the server process identity could not be verified.' } };
    }
    changed = true;
    return { ...server, status: 'idle', playerCount: 0, runtime: { ...runtime, pid: null, lastKnownState: 'unknown', lastExitReason: 'Persisted process identity did not match a live Java server.' } };
  });
  if (changed) scheduleStateWrite();
}

function sanitizeServerFolderName(name) {
  const cleaned = String(name || 'New server')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/[. ]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned || cleaned === '.' || cleaned === '..') return 'New server';
  return cleaned.slice(0, 80);
}

function getUniqueServerFolderName(name) {
  const base = sanitizeServerFolderName(name);
  const root = getServersRoot();
  let candidate = base;
  let suffix = 1;
  while (fs.existsSync(path.join(root, candidate))) candidate = `${base} (${suffix++})`;
  return candidate;
}

function getServerRoot(serverOrId) {
  const server = typeof serverOrId === 'object'
    ? serverOrId
    : launcherState.servers.find(entry => entry.id === String(serverOrId || ''));
  if (server?.rootPath && path.isAbsolute(server.rootPath)) return path.normalize(server.rootPath);
  const folderName = server?.folderName || sanitizeServerFolderName(server?.name || serverOrId);
  return path.join(getServersRoot(), folderName);
}

function hasUsableServerWorld(rootPath, worldName = 'world') {
  const worldPath = path.join(rootPath, String(worldName || 'world'));
  return fs.existsSync(path.join(worldPath, 'level.dat'))
    || fs.existsSync(path.join(worldPath, 'level.dat_old'));
}

function validateMinecraftLevelDat(levelDatPath) {
  if (!fs.existsSync(levelDatPath)) return { valid: false, reason: 'level.dat is missing.' };
  let compressed;
  try {
    compressed = fs.readFileSync(levelDatPath);
  } catch (error) {
    return { valid: false, reason: `level.dat could not be read: ${error.message}` };
  }
  if (compressed.length < 2 || compressed[0] !== 0x1f || compressed[1] !== 0x8b) {
    return { valid: false, reason: 'level.dat is not a valid GZIP-compressed NBT file.' };
  }
  try {
    const nbt = zlib.gunzipSync(compressed);
    let offset = 0;
    const ensure = size => {
      if (offset + size > nbt.length) throw new Error('NBT data is truncated.');
    };
    const readByte = () => { ensure(1); return nbt[offset++]; };
    const readInt = () => { ensure(4); const value = nbt.readInt32BE(offset); offset += 4; return value; };
    const readString = () => {
      ensure(2);
      const length = nbt.readUInt16BE(offset);
      offset += 2;
      ensure(length);
      const value = nbt.toString('utf8', offset, offset + length);
      offset += length;
      return value;
    };
    const readPayload = (type, depth) => {
      if (depth > 64) throw new Error('NBT nesting is too deep.');
      if (type === 0) return;
      if (type === 1) { ensure(1); offset += 1; return; }
      if (type === 2) { ensure(2); offset += 2; return; }
      if (type === 3 || type === 5) { ensure(4); offset += 4; return; }
      if (type === 4 || type === 6) { ensure(8); offset += 8; return; }
      if (type === 7 || type === 11 || type === 12) {
        const length = readInt();
        if (length < 0 || length > 10000000) throw new Error('NBT array length is invalid.');
        const bytesPerValue = type === 7 ? 1 : type === 11 ? 4 : 8;
        ensure(length * bytesPerValue);
        offset += length * bytesPerValue;
        return;
      }
      if (type === 8) { readString(); return; }
      if (type === 9) {
        const itemType = readByte();
        const length = readInt();
        if (length < 0 || length > 10000000) throw new Error('NBT list length is invalid.');
        for (let index = 0; index < length; index += 1) readPayload(itemType, depth + 1);
        return;
      }
      if (type === 10) {
        const names = new Set();
        while (true) {
          const childType = readByte();
          if (childType === 0) return names;
          if (childType < 1 || childType > 12) throw new Error('NBT tag type is invalid.');
          const name = readString();
          names.add(name);
          readPayload(childType, depth + 1);
        }
      }
      throw new Error('NBT tag type is invalid.');
    };
    if (readByte() !== 10) return { valid: false, reason: 'level.dat does not contain an NBT compound root.' };
    readString();
    const rootNames = readPayload(10, 0);
    if (!rootNames.has('Data')) return { valid: false, reason: 'level.dat is missing the Minecraft Data compound.' };
    return { valid: true };
  } catch (error) {
    return { valid: false, reason: `level.dat NBT validation failed: ${error.message}` };
  }
}

function inspectMinecraftWorld(worldPath) {
  if (!fs.existsSync(worldPath)) return { exists: false, valid: true };
  if (!fs.statSync(worldPath).isDirectory()) return { exists: true, valid: false, reason: 'The world path is not a directory.' };
  const validation = validateMinecraftLevelDat(path.join(worldPath, 'level.dat'));
  return { exists: true, ...validation };
}

function findUsableWorldName(rootPath, preferredName = 'world') {
  if (hasUsableServerWorld(rootPath, preferredName)) return String(preferredName || 'world');
  if (!fs.existsSync(rootPath)) return null;
  return fs.readdirSync(rootPath, { withFileTypes: true })
    .find(entry => entry.isDirectory() && hasUsableServerWorld(rootPath, entry.name))?.name || null;
}

function inferServerTypeFromJar(jarFileName, fallback = 'paper') {
  const name = String(jarFileName || '').toLowerCase();
  if (name.includes('paper')) return 'paper';
  if (name.includes('purpur')) return 'purpur';
  if (name.includes('folia')) return 'folia';
  if (name.includes('velocity')) return 'velocity';
  if (name.includes('waterfall')) return 'waterfall';
  if (name.includes('bungee')) return 'bungeecord';
  if (name.includes('neoforge')) return 'neoforge';
  if (name.includes('forge')) return 'forge';
  if (name.includes('fabric')) return 'fabric';
  if (name.includes('quilt')) return 'quilt';
  if (name.includes('spigot')) return 'spigot';
  if (name.includes('craftbukkit') || name.includes('bukkit')) return 'bukkit';
  if (name.includes('vanilla') || name.includes('server')) return 'vanilla';
  return normalizeServerType(fallback);
}

function jarContainsEntry(jarPath, pattern) {
  try {
    if (!jarPath || !fs.existsSync(jarPath)) return false;
    const zip = new AdmZip(jarPath);
    return zip.getEntries().some(entry => pattern.test(entry.entryName));
  } catch {
    return false;
  }
}

function isPaperServerJar(jarPath) {
  try {
    const resolvedPath = path.resolve(jarPath);
    const stats = fs.statSync(resolvedPath);
    const cacheKey = `${resolvedPath.toLowerCase()}|${stats.size}|${stats.mtimeMs}`;
    const cached = serverJarValidationCache.get(cacheKey);
    if (cached !== undefined) return cached;
    const valid = jarContainsEntry(resolvedPath, /(?:^|\/)(?:io\/papermc\/paper|paperclip|PaperBootstrap)/i);
    if (serverJarValidationCache.size >= 128) serverJarValidationCache.delete(serverJarValidationCache.keys().next().value);
    serverJarValidationCache.set(cacheKey, valid);
    return valid;
  } catch {
    return false;
  }
}

function isFabricServerJar(jarPath) {
  return jarContainsEntry(jarPath, /(?:^|\/)(?:net\/fabricmc\/installer\/ServerLauncher|net\/fabricmc\/loader\/impl\/launch\/(?:server\/FabricServerLauncher|knot\/KnotServer))\.class$/i);
}

function isQuiltServerJar(jarPath) {
  if (jarContainsEntry(jarPath, /(?:^|\/)(?:org\/quiltmc\/installer\/(?:Main|ServerLauncher)|org\/quiltmc\/loader\/impl\/launch\/(?:server\/QuiltServerLauncher|knot\/KnotServer))\.class$/i)) return true;
  try {
    const manifest = new AdmZip(jarPath).getEntry('META-INF/MANIFEST.MF')?.getData().toString('utf8') || '';
    return /^Main-Class:\s*org\.quiltmc\.loader\.impl\.launch\.server\.QuiltServerLauncher\s*$/mi.test(manifest);
  } catch {
    return false;
  }
}

function findExistingServerJar(rootPath, preferredName = '') {
  const jarNames = fs.readdirSync(rootPath)
    .filter(name => name.toLowerCase().endsWith('.jar'));
  const isLikelyServerJarName = name => !/^(?:forge|neoforge)-installer\.jar$|^BuildTools\.jar$/i.test(name)
    && /^(?:paper|purpur|folia|spigot|craftbukkit|bukkit|velocity|waterfall|bungeecord|neoforge|forge|fabric-server|quilt-server|server)(?:[-_.].*)?\.jar$/i.test(name);
  if (preferredName && jarNames.includes(preferredName) && isLikelyServerJarName(preferredName)) return preferredName;
  const candidates = getServerJarCandidates('paper')
    .concat(['purpur.jar', 'folia.jar', 'fabric-server-launch.jar', 'server.jar', 'paper-server.jar']);
  return candidates.find(name => jarNames.includes(name))
    || jarNames.find(isLikelyServerJarName)
    || null;
}

function hasDirectServerFiles(rootPath, preferredJar = '') {
  if (!fs.existsSync(rootPath) || !fs.statSync(rootPath).isDirectory()) return false;
  return Boolean(findExistingServerJar(rootPath, preferredJar) && findUsableWorldName(rootPath));
}

function findAutomaticServerRoot(server) {
  const userRoot = path.join(os.homedir(), 'Downloads');
  if (!fs.existsSync(userRoot)) return null;
  const managedRoot = path.resolve(path.join(app.getPath('userData'), 'servers'));
  const matches = [];
  const walk = (folder, depth) => {
    if (depth > 3 || path.resolve(folder).startsWith(managedRoot)) return;
    let entries;
    try { entries = fs.readdirSync(folder, { withFileTypes: true }); } catch (_error) { return; }
    const jar = findExistingServerJar(folder, server?.jarFileName);
    const world = entries.find(entry => entry.isDirectory() && hasUsableServerWorld(folder, entry.name));
    if (jar && world && path.resolve(folder) !== path.resolve(userRoot)) {
      const preferredJar = String(server?.jarFileName || '').toLowerCase();
      const levelPath = path.join(folder, world.name, 'level.dat');
      matches.push({
        rootPath: folder,
        jarFileName: jar,
        worldName: world.name,
        preferred: preferredJar && jar.toLowerCase() === preferredJar,
        modifiedAt: fs.statSync(levelPath).mtimeMs,
      });
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory() && !['node_modules', '.git', 'libraries', 'versions'].includes(entry.name.toLowerCase())) {
        walk(path.join(folder, entry.name), depth + 1);
      }
    }
  };
  walk(userRoot, 0);
  return matches.sort((a, b) => Number(b.preferred) - Number(a.preferred) || b.modifiedAt - a.modifiedAt)[0] || null;
}

function quoteWindowsBatchArgument(value) {
  return `"${String(value || '').replace(/(["^&|<>])/g, '^$1')}"`;
}

function writeServerStartBatch(rootPath, javaExecutable, serverMemory, customArgs, jarFileName) {
  const launchTargetArgs = String(jarFileName || '').startsWith('@')
    ? [...customArgs, '@user_jvm_args.txt', jarFileName, 'nogui']
    : [...customArgs, '-jar', jarFileName, 'nogui'];
  const javaArgLine = [
    quoteWindowsBatchArgument(javaExecutable),
    '-Xms512M',
    `-Xmx${serverMemory}G`,
    ...launchTargetArgs.map(quoteWindowsBatchArgument),
  ].join(' ');
  const batchPath = path.join(rootPath, 'start.bat');
  const content = [
    '@echo off',
    'setlocal',
    `cd /d ${quoteWindowsBatchArgument(rootPath)}`,
    javaArgLine,
    'set "EXIT_CODE=%ERRORLEVEL%"',
    'endlocal & exit /b %EXIT_CODE%',
    '',
  ].join('\r\n');
  fs.writeFileSync(batchPath, content, 'utf8');
  return batchPath;
}

function normalizeServerType(serverType) {
  return String(serverType || 'paper').toLowerCase();
}

function normalizeServerAddress(address) {
  const value = String(address || '').trim();
  if (!value || value.length > 255) return '';
  if (/^\d+\.\d+[a-z]$/i.test(value)) return '';
  if (/^(?:localhost|(?:\d{1,3}\.){3}\d{1,3}|[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?)(?::\d{1,5})?$/i.test(value)) return value;
  return '';
}

function readServerPort(rootPath) {
  try {
    const propertiesPath = path.join(rootPath, 'server.properties');
    if (!fs.existsSync(propertiesPath)) return 25565;
    const match = fs.readFileSync(propertiesPath, 'utf8').match(/^\s*server-port\s*=\s*(\d+)\s*$/mi);
    const port = Number(match?.[1]);
    return port >= 1 && port <= 65535 ? port : 25565;
  } catch {
    return 25565;
  }
}

function isPortAvailable(port) {
  return new Promise(resolve => {
    const probe = net.createServer();
    probe.once('error', () => resolve(false));
    probe.once('listening', () => probe.close(() => resolve(true)));
    probe.listen(port, '127.0.0.1');
  });
}

async function chooseServerPort(server, rootPath) {
  const preferred = Number(server?.serverPort) || readServerPort(rootPath);
  if (!(await isPortAvailable(preferred))) {
    throw new Error(`Port ${preferred} is already in use. Change this server's port in Settings > Networking before starting it.`);
  }
  return preferred;
}

function isDirectDownloadServerType(serverType) {
  const type = normalizeServerType(serverType);
  return ['paper', 'purpur', 'folia', 'velocity', 'waterfall', 'bungeecord', 'vanilla', 'fabric', 'quilt'].includes(type);
}

function isInstallerBuildServerType(serverType) {
  const type = normalizeServerType(serverType);
  return ['forge', 'neoforge', 'spigot', 'bukkit'].includes(type);
}

function getServerJarTypeInfo(serverType) {
  const type = normalizeServerType(serverType);
  const mapping = {
    paper: { project: 'paper', jar: 'paper.jar' },
    purpur: { project: 'purpur', jar: 'purpur.jar' },
    folia: { project: 'folia', jar: 'folia.jar' },
    forge: { project: 'forge', jar: 'forge-installer.jar' },
    neoforge: { project: 'neoforge', jar: 'neoforge-installer.jar' },
    spigot: { project: 'spigot', jar: 'BuildTools.jar' },
    bukkit: { project: 'bukkit', jar: 'BuildTools.jar' },
    velocity: { project: 'velocity', jar: 'velocity.jar' },
    waterfall: { project: 'waterfall', jar: 'waterfall.jar' },
    bungeecord: { project: 'bungeecord', jar: 'BungeeCord.jar' },
    vanilla: { project: 'vanilla', jar: 'server.jar' },
    fabric: { project: 'fabric', jar: 'fabric-server-launch.jar' },
    quilt: { project: 'quilt', jar: 'quilt-server-launch.jar' },
  };
  return mapping[type] || { project: 'paper', jar: 'paper.jar' };
}

async function downloadVanillaServerJar(version, targetPath) {
  const manifestResponse = await axios.get(VERSION_MANIFEST_URL, { timeout: 15000 });
  const manifest = manifestResponse.data || {};
  const match = (manifest.versions || []).find(entry => entry.id === version)
    || (manifest.versions || []).find(entry => entry.type === 'release' && entry.id.startsWith(version.split('.')[0] + '.'))
    || (manifest.versions || []).find(entry => entry.type === 'release');
  if (!match?.url) throw new Error(`No release manifest entry was found for ${version}`);

  const versionResponse = await axios.get(match.url, { timeout: 15000 });
  const downloadUrl = versionResponse.data?.downloads?.server?.url;
  if (!downloadUrl) throw new Error(`No Mojang server download URL exists for ${version}`);

  const jarResponse = await axios.get(downloadUrl, { timeout: 120000, responseType: 'arraybuffer' });
  fs.writeFileSync(targetPath, Buffer.from(jarResponse.data));
  return true;
}

async function downloadDirectWebsiteJar(url, targetPath) {
  const response = await axios.get(url, { timeout: 120000, responseType: 'arraybuffer', headers: { 'User-Agent': 'Mozilla/5.0' } });
  fs.writeFileSync(targetPath, Buffer.from(response.data));
  return true;
}

async function downloadValidatedServerJar(url, targetPath, serverType, reportProgress = () => {}) {
  const temporaryPath = `${targetPath}.download-${crypto.randomUUID()}`;
  try {
    let lastReportedPercent = 0;
    const response = await axios.get(url, {
      timeout: 120000,
      responseType: 'arraybuffer',
      headers: { 'User-Agent': 'Mozilla/5.0' },
      onDownloadProgress: event => {
        const total = Number(event.total) || 0;
        if (!total) return;
        const percent = Math.floor((event.loaded / total) * 100);
        if (percent >= lastReportedPercent + 10 || percent === 100) {
          lastReportedPercent = percent;
          reportProgress(percent);
        }
      },
    });
    fs.writeFileSync(temporaryPath, Buffer.from(response.data));
    const valid = serverType === 'vanilla'
      ? jarContainsEntry(temporaryPath, /^(?:net\/minecraft\/bundler\/Main\.class|net\/minecraft\/server\/MinecraftServer\.class|version\.json)$/i)
      : ['paper', 'purpur', 'folia'].includes(serverType)
        ? isPaperServerJar(temporaryPath)
        : serverType === 'fabric'
          ? isFabricServerJar(temporaryPath)
          : serverType === 'quilt'
            ? isQuiltServerJar(temporaryPath)
            : jarContainsEntry(temporaryPath, /(?:^|\/)(?:com\/velocitypowered\/|net\/md_5\/bungee\/)/i);
    if (!valid) throw new Error(`The downloaded file is not a valid ${serverType} server JAR.`);
    fs.renameSync(temporaryPath, targetPath);
    return true;
  } catch (error) {
    if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
    throw error;
  }
}

async function resolveDirectServerJarDownloadUrl(serverType, version) {
  const pageMap = {
    paper: 'https://papermc.io/downloads/paper',
    folia: 'https://papermc.io/downloads/folia',
    velocity: 'https://papermc.io/downloads/velocity',
    waterfall: 'https://papermc.io/downloads/waterfall',
    bungeecord: 'https://papermc.io/downloads/waterfall',
  };
  const pageUrl = pageMap[String(serverType || 'paper').toLowerCase()];
  if (!pageUrl) return null;

  try {
    const response = await axios.get(pageUrl, { timeout: 30000, headers: { 'User-Agent': 'Mozilla/5.0' } });
    const html = String(response.data || '');
    const jarUrls = [...html.matchAll(/https?:\/\/[^\s\"'<>]+\.jar/gi)].map(match => match[0]);
    return jarUrls.find(url => url.includes('fill-data.papermc.io') || !url.includes('github.com')) || jarUrls[0] || null;
  } catch (_error) {
    return null;
  }
}

async function downloadServerJar(server) {
  const rootPath = ensureServerRoot(server.id);
  const type = normalizeServerType(server.serverType);
  const fileName = getServerJarTypeInfo(type).jar;
  const targetPath = path.join(rootPath, fileName);
  if (fs.existsSync(targetPath)) {
    const validExistingJar = type === 'paper'
      ? isPaperServerJar(targetPath)
      : type === 'fabric'
        ? isFabricServerJar(targetPath)
        : type === 'quilt'
          ? isQuiltServerJar(targetPath)
          : true;
    if (validExistingJar) return { ok: true, fileName };
    const invalidPath = `${targetPath}.not-${type}-${Date.now()}`;
    fs.renameSync(targetPath, invalidPath);
    const invalidDescription = type === 'paper' ? 'Paper' : type === 'fabric' ? 'Fabric Loader' : type === 'quilt' ? 'Quilt Loader' : type;
    emitServerConsole(server.id, 'warn', `The existing ${fileName} is not a valid ${invalidDescription} server JAR. It was preserved as ${path.basename(invalidPath)} while the matching server JAR is downloaded.`);
  }

  const version = String(server.mcVersion || '1.21.1');

  if (type === 'quilt') {
    try {
      const metadataBaseUrl = 'https://meta.quiltmc.org/v3';
      const [loaderResponse, installerResponse] = await Promise.all([
        axios.get(`${metadataBaseUrl}/versions/loader/${version}`, { timeout: 30000, headers: { 'User-Agent': 'Mozilla/5.0' } }),
        axios.get(`${metadataBaseUrl}/versions/installer`, { timeout: 30000, headers: { 'User-Agent': 'Mozilla/5.0' } }),
      ]);
      const loaders = Array.isArray(loaderResponse.data) ? loaderResponse.data : [];
      const compatibleLoaders = loaders.filter(item => item?.intermediary?.version === version);
      const compareLoaderVersions = (left, right) => String(right?.loader?.version || '')
        .localeCompare(String(left?.loader?.version || ''), undefined, { numeric: true, sensitivity: 'base' });
      const stableLoaders = compatibleLoaders.filter(item => {
        const loaderVersion = String(item?.loader?.version || '');
        return item?.loader?.stable === true
          || (item?.loader?.stable !== false && !/(?:alpha|beta|pre|rc|snapshot)/i.test(loaderVersion));
      });
      const loader = stableLoaders.sort(compareLoaderVersions)[0] || compatibleLoaders.sort(compareLoaderVersions)[0];
      const installers = Array.isArray(installerResponse.data) ? installerResponse.data : [];
      const installer = installers.find(item => item?.version && item?.url);
      if (!loader?.loader?.version) throw new Error(`No Quilt loader is available for Minecraft ${version}.`);
      if (!installer?.url) throw new Error('No Quilt installer is available.');

      const installerPath = path.join(rootPath, 'quilt-installer.jar');
      emitServerConsole(server.id, 'info', `Preparing Quilt ${loader.loader.version} for Minecraft ${version}...`);
      await downloadDirectWebsiteJar(installer.url, installerPath);
      if (!jarContainsEntry(installerPath, /org\/quiltmc\/installer\//i)) {
        throw new Error('The downloaded Quilt installer is not a valid installer JAR.');
      }

      const installerJava = await resolveJavaForMinecraft(version, server.javaPath);
      await new Promise((resolve, reject) => {
        const child = spawn(installerJava, [
          '-jar',
          installerPath,
          'install',
          'server',
          version,
          loader.loader.version,
          '--install-dir=.',
          '--download-server',
        ], { cwd: rootPath, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
        child.stdout.on('data', chunk => handleServerProcessOutput(server.id, 'info', chunk));
        child.stderr.on('data', chunk => handleServerProcessOutput(server.id, 'info', chunk));
        child.on('error', reject);
        child.on('close', code => {
          if (code !== 0) {
            reject(new Error(`Quilt installer exited with code ${code}. Review the preceding installer output for details.`));
            return;
          }
          if (!fs.existsSync(targetPath) || !isQuiltServerJar(targetPath)) {
            reject(new Error('Quilt installer completed without creating a valid quilt-server-launch.jar.'));
            return;
          }
          updateServerInState(server.id, { jarFileName: fileName });
          resolve();
        });
      });
      return { ok: true, fileName };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, error: `Could not install a valid Quilt server for Minecraft ${version}. ${message}` };
    }
  }

  if (type === 'fabric') {
    const tempPath = `${targetPath}.download-${crypto.randomUUID()}`;
    try {
      const metadataBaseUrl = 'https://meta.fabricmc.net/v2';
      const loaderResponse = await axios.get(`${metadataBaseUrl}/versions/loader/${version}`, { timeout: 30000, headers: { 'User-Agent': 'Mozilla/5.0' } });
      const compatibleLoaders = (Array.isArray(loaderResponse.data) ? loaderResponse.data : [])
        .filter(item => item?.intermediary?.version === version);
      const loader = compatibleLoaders.find(item => item?.loader?.stable) || compatibleLoaders[0];
      const loaderVersion = loader?.loader?.version || loader?.version || loader?.id;
      if (!loaderVersion) throw new Error(`No ${type} loader is available for Minecraft ${version}.`);
      const installerResponse = await axios.get(`${metadataBaseUrl}/versions/installer`, { timeout: 30000, headers: { 'User-Agent': 'Mozilla/5.0' } });
      const installer = (installerResponse.data || []).find(item => item?.stable) || (installerResponse.data || [])[0];
      const installerVersion = installer?.version;
      if (!installerVersion) throw new Error('No Fabric installer is available.');
      const jarUrl = `${metadataBaseUrl}/versions/loader/${version}/${loaderVersion}/${installerVersion}/server/jar`;
      const jarResponse = await axios.get(jarUrl, { timeout: 120000, responseType: 'arraybuffer', headers: { 'User-Agent': 'Mozilla/5.0' } });
      fs.writeFileSync(tempPath, Buffer.from(jarResponse.data));
      if (!isFabricServerJar(tempPath)) throw new Error(`The downloaded ${type} JAR did not contain its server loader.`);
      fs.renameSync(tempPath, targetPath);
      return { ok: true, fileName };
    } catch (_error) {
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
      const message = _error instanceof Error ? _error.message : String(_error);
      return { ok: false, error: `Could not download a valid ${type} server for Minecraft ${version}. ${message}` };
    }
  }

  let upstreamError = '';
  if (['paper', 'folia'].includes(type)) {
    try {
      const response = await axios.get(`https://fill.papermc.io/v3/projects/${type}/versions/${version}/builds`, { timeout: 30000, headers: { 'User-Agent': 'Mozilla/5.0' } });
      const builds = Array.isArray(response.data) ? response.data : (Array.isArray(response.data?.builds) ? response.data.builds : []);
      const preferred = builds.find(item => String(item?.channel || '').toUpperCase() === 'STABLE') || builds[0];
      const downloadUrl = preferred?.downloads?.['server:default']?.url || preferred?.downloads?.['server']?.url || preferred?.downloads?.server?.url || null;
      if (downloadUrl) {
        await downloadValidatedServerJar(downloadUrl, targetPath, type, percent => emitServerConsole(server.id, 'info', `Downloading ${type} server JAR: ${percent}%`));
        return { ok: true, fileName };
      }
      upstreamError = `The official ${type} API returned no compatible build for Minecraft ${version}.`;
    } catch (_error) {
      upstreamError = _error instanceof Error ? _error.message : String(_error);
    }
  }

  if (type === 'velocity') {
    try {
      const versionsResponse = await axios.get('https://fill.papermc.io/v3/projects/velocity/versions', { timeout: 30000, headers: { 'User-Agent': 'Mozilla/5.0' } });
      const versions = Array.isArray(versionsResponse.data?.versions) ? versionsResponse.data.versions : [];
      const selected = versions.find(item => item?.version?.support?.status === 'SUPPORTED' && !String(item.version.id).includes('SNAPSHOT'))
        || versions.find(item => item?.version?.support?.status === 'SUPPORTED');
      const platformVersion = String(selected?.version?.id || '');
      if (!platformVersion) throw new Error('Velocity has no supported server build.');
      const buildsResponse = await axios.get(`https://fill.papermc.io/v3/projects/velocity/versions/${encodeURIComponent(platformVersion)}/builds`, { timeout: 30000, headers: { 'User-Agent': 'Mozilla/5.0' } });
      const builds = Array.isArray(buildsResponse.data) ? buildsResponse.data : [];
      const preferred = builds.find(item => String(item?.channel || '').toUpperCase() === 'STABLE') || builds[0];
      const downloadUrl = preferred?.downloads?.['server:default']?.url || preferred?.downloads?.server?.url || null;
      if (!downloadUrl) throw new Error(`Velocity ${platformVersion} has no server download.`);
      await downloadValidatedServerJar(downloadUrl, targetPath, type, percent => emitServerConsole(server.id, 'info', `Downloading Velocity server JAR: ${percent}%`));
      const minimumJava = Number(selected?.version?.java?.version?.minimum) || 21;
      if (minimumJava > getRequiredJavaVersion(version)) {
        const javaPath = await getJavaPath(minimumJava, true);
        updateServerInState(server.id, { javaPath });
        server.javaPath = javaPath;
      }
      return { ok: true, fileName };
    } catch (_error) {
      upstreamError = _error instanceof Error ? _error.message : String(_error);
    }
  }

  if (type === 'purpur') {
    try {
      const downloadUrl = `https://api.purpurmc.org/v2/purpur/${version}/latest/download`;
      await downloadValidatedServerJar(downloadUrl, targetPath, type, percent => emitServerConsole(server.id, 'info', `Downloading Purpur server JAR: ${percent}%`));
      return { ok: true, fileName };
    } catch (_error) {
      upstreamError = _error instanceof Error ? _error.message : String(_error);
    }
  }

  if (type === 'bungeecord') {
    try {
      const downloadUrl = 'https://ci.md-5.net/job/BungeeCord/lastSuccessfulBuild/artifact/bootstrap/target/BungeeCord.jar';
      await downloadValidatedServerJar(downloadUrl, targetPath, type, percent => emitServerConsole(server.id, 'info', `Downloading BungeeCord server JAR: ${percent}%`));
      return { ok: true, fileName };
    } catch (_error) {
      upstreamError = _error instanceof Error ? _error.message : String(_error);
    }
  }

  if (type === 'waterfall') {
    try {
      const versionsResponse = await axios.get('https://fill.papermc.io/v3/projects/waterfall/versions', { timeout: 30000, headers: { 'User-Agent': 'Mozilla/5.0' } });
      const versions = Array.isArray(versionsResponse.data?.versions) ? versionsResponse.data.versions : [];
      const gameMajorMinor = version.match(/^(\d+\.\d+)/)?.[1] || '';
      const selected = versions.find(item => item?.version?.id === gameMajorMinor);
      const platformVersion = String(selected?.version?.id || '');
      if (!platformVersion) throw new Error(`Waterfall has no server build for Minecraft ${version}.`);
      const buildsResponse = await axios.get(`https://fill.papermc.io/v3/projects/waterfall/versions/${encodeURIComponent(platformVersion)}/builds`, { timeout: 30000, headers: { 'User-Agent': 'Mozilla/5.0' } });
      const builds = Array.isArray(buildsResponse.data) ? buildsResponse.data : [];
      const latestBuild = builds.find(item => String(item?.channel || '').toUpperCase() === 'STABLE') || builds[0];
      const downloadUrl = latestBuild?.downloads?.['server:default']?.url || latestBuild?.downloads?.server?.url || null;
      if (downloadUrl) {
        await downloadValidatedServerJar(downloadUrl, targetPath, type, percent => emitServerConsole(server.id, 'info', `Downloading Waterfall server JAR: ${percent}%`));
        return { ok: true, fileName };
      }
      upstreamError = `The Waterfall API returned no compatible build for Minecraft ${version}.`;
    } catch (_error) {
      upstreamError = _error instanceof Error ? _error.message : String(_error);
    }
  }

  if (['paper', 'folia', 'purpur', 'velocity', 'waterfall', 'bungeecord'].includes(type)) {
    return { ok: false, error: `No ${type} server build is available for Minecraft ${version}.${upstreamError ? ` Upstream response: ${upstreamError}` : ''}` };
  }

  if (type === 'vanilla') {
    try {
      const temporaryPath = `${targetPath}.download-${crypto.randomUUID()}`;
      try {
        await downloadVanillaServerJar(version, temporaryPath);
        if (!jarContainsEntry(temporaryPath, /^(?:net\/minecraft\/bundler\/Main\.class|net\/minecraft\/server\/MinecraftServer\.class|version\.json)$/i)) {
          throw new Error(`Mojang returned an invalid server JAR for Minecraft ${version}.`);
        }
        fs.renameSync(temporaryPath, targetPath);
      } catch (error) {
        if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
        throw error;
      }
      updateServerInState(server.id, { jarFileName: fileName });
      return { ok: true, fileName };
    } catch (_error) {
      return { ok: false, error: `No Mojang server JAR could be downloaded for ${version}.` };
    }
  }

  if (isInstallerBuildServerType(type)) {
    return { ok: false, error: `${type.toUpperCase()} is not a direct-download server JAR. It requires the official upstream installer/build step before the server can start.` };
  }

  try {
    await downloadVanillaServerJar(version, targetPath);
    updateServerInState(server.id, { jarFileName: fileName });
    return { ok: true, fileName };
  } catch (error) {
    return { ok: false, error: `No server JAR could be downloaded for ${type} ${version}. Add the server JAR manually into ${rootPath}.` };
  }
}

function normalizeServer(server) {
  const id = String(server?.id || `server-${Date.now()}`);
  const name = String(server?.name || 'New server').trim() || 'New server';
  const mcVersion = String(server?.mcVersion || '1.21.1').trim() || '1.21.1';
  const loader = ['fabric', 'forge', 'neoforge', 'quilt', 'vanilla'].includes(String(server?.loader || '').toLowerCase())
    ? String(server.loader).toLowerCase()
    : 'fabric';
  const validServerTypes = ['paper', 'purpur', 'folia', 'forge', 'neoforge', 'spigot', 'bukkit', 'velocity', 'waterfall', 'bungeecord', 'vanilla', 'fabric', 'quilt'];
  const serverType = validServerTypes.includes(String(server?.serverType || '').toLowerCase())
    ? String(server.serverType).toLowerCase()
    : 'paper';
  const integerSetting = (value, fallback) => {
    const number = Number(value);
    return Number.isSafeInteger(number) ? number : fallback;
  };
  const memoryMax = Math.min(32, Math.max(2, integerSetting(server?.memoryMax, 4)));
  const worldNameValue = String(server?.worldName || 'world').trim();
  const worldName = /^[a-zA-Z0-9._-]+$/.test(worldNameValue) && !['.', '..'].includes(worldNameValue)
    ? worldNameValue.slice(0, 80)
    : 'world';
  const difficulty = ['peaceful', 'easy', 'normal', 'hard'].includes(String(server?.difficulty || '').toLowerCase()) ? String(server.difficulty).toLowerCase() : 'normal';
  const gamemode = ['survival', 'creative', 'adventure', 'spectator'].includes(String(server?.gamemode || '').toLowerCase()) ? String(server.gamemode).toLowerCase() : 'survival';
  const networkingMode = ['playit', 'port-forward'].includes(String(server?.networkingMode || '').toLowerCase())
    ? String(server.networkingMode).toLowerCase()
    : 'playit';
  const scheduleList = Array.isArray(server?.schedules) ? server.schedules.map((schedule, index) => ({
    id: String(schedule?.id || `schedule-${Date.now()}-${index}`),
    type: ['start', 'stop', 'backup', 'command'].includes(String(schedule?.type || 'backup')) ? String(schedule.type) : 'backup',
    enabled: schedule?.enabled !== false,
    intervalMinutes: Number(schedule?.intervalMinutes) > 0 ? Number(schedule.intervalMinutes) : 60,
    intervalHours: Number(schedule?.intervalHours) > 0 ? Number(schedule.intervalHours) : 0,
    time: String(schedule?.time || '00:00'),
    command: String(schedule?.command || ''),
    name: String(schedule?.name || ''),
    nextRunAt: Number(schedule?.nextRunAt || Date.now() + 60 * 60 * 1000),
  })) : [];
  const jarFileName = String(server?.jarFileName || '').trim();
  const rootPath = String(server?.rootPath || '').trim();
  const folderName = sanitizeServerFolderName(server?.folderName || name);
  const address = normalizeServerAddress(server?.address);
  const serverPort = Number(server?.serverPort);
  const runtimeSource = server?.runtime && typeof server.runtime === 'object' ? server.runtime : {};
  const runtimePid = Number(runtimeSource.pid);
  const runtimeState = ['stopped', 'starting', 'process-alive', 'running', 'crashed', 'unknown'].includes(String(runtimeSource.lastKnownState || 'stopped'))
    ? String(runtimeSource.lastKnownState)
    : 'stopped';
  return {
    id,
    name: name.slice(0, 32),
    folderName,
    mcVersion,
    loader,
    serverType,
    memoryMax,
    motd: String(server?.motd || 'Bald Launcher Server').replace(/[\r\n]+/g, ' '),
    maxPlayers: Math.max(1, integerSetting(server?.maxPlayers, 20)),
    difficulty,
    gamemode,
    forceGamemode: server?.forceGamemode === true,
    pvp: server?.pvp !== false,
    whitelist: server?.whitelist === true,
    viewDistance: Math.min(32, Math.max(2, integerSetting(server?.viewDistance, 10))),
    simulationDistance: Math.min(32, Math.max(2, integerSetting(server?.simulationDistance, 10))),
    autoRestart: server?.autoRestart === true,
    autoStart: server?.autoStart === true,
    javaArgs: String(server?.javaArgs || ''),
    javaPath: String(server?.javaPath || ''),
    rootPath: path.isAbsolute(rootPath) ? path.normalize(rootPath) : '',
    eulaAccepted: server?.eulaAccepted === true,
    serverIconPath: String(server?.serverIconPath || ''),
    networkingMode,
    worldName,
    status: ['idle', 'starting', 'running', 'stopping'].includes(String(server?.status || 'idle')) ? String(server.status) : 'idle',
    address,
    serverPort: serverPort >= 1 && serverPort <= 65535 ? serverPort : 25565,
    jarFileName: jarFileName || '',
    createdAt: Number(server?.createdAt || Date.now()),
    updatedAt: Number(server?.updatedAt || Date.now()),
    playerCount: Number(server?.playerCount || 0),
    runtime: {
      pid: Number.isInteger(runtimePid) && runtimePid > 0 ? runtimePid : null,
      javaPath: String(runtimeSource.javaPath || ''),
      jarFileName: String(runtimeSource.jarFileName || jarFileName || ''),
      launchArgs: Array.isArray(runtimeSource.launchArgs) ? runtimeSource.launchArgs.map(value => String(value)) : [],
      cwd: path.isAbsolute(String(runtimeSource.cwd || '')) ? path.normalize(String(runtimeSource.cwd)) : '',
      launchToken: String(runtimeSource.launchToken || ''),
      startedAt: Number(runtimeSource.startedAt || 0),
      processStartTime: Number(runtimeSource.processStartTime || 0),
      lastKnownState: runtimeState,
      lastExitCode: Number.isInteger(runtimeSource.lastExitCode) ? runtimeSource.lastExitCode : null,
      lastExitReason: String(runtimeSource.lastExitReason || ''),
    },
    schedules: scheduleList,
    installedContent: Array.isArray(server?.installedContent) ? server.installedContent.map(entry => ({
      ...normalizeInstalledContent(entry),
      type: ['mod', 'plugin', 'datapack'].includes(String(entry?.type || '').toLowerCase())
        ? String(entry.type).toLowerCase()
        : 'mod',
    })) : [],
    retentionCount: Number(server?.retentionCount) > 0 ? Number(server.retentionCount) : 10,
  };
}

function getEffectiveServerMemory(server) {
  const requested = Math.max(1, Number(server?.memoryMax) || 4);
  const freeMemoryGb = os.freemem() / 1073741824;
  if (!Number.isFinite(freeMemoryGb) || freeMemoryGb <= 0) return requested;
  // Leave headroom for the launcher, the OS, and native libraries. The
  // initial heap is kept smaller below so Windows does not commit the full
  // maximum before the server needs it.
  const availableLimit = Math.max(1, Math.floor(freeMemoryGb * 0.6));
  return Math.min(requested, availableLimit);
}

function ensureServerRoot(serverId) {
  const rootPath = getServerRoot(serverId);
  fs.mkdirSync(rootPath, { recursive: true });
  fs.mkdirSync(path.join(rootPath, 'backups'), { recursive: true });
  return rootPath;
}

function ensureServerTypeFolders(server) {
  if (!server?.id) return;
  const rootPath = ensureServerRoot(server.id);
  const type = normalizeServerType(server.serverType);
  if (['paper', 'purpur', 'folia', 'spigot', 'bukkit', 'velocity', 'waterfall', 'bungeecord'].includes(type)) {
    fs.mkdirSync(path.join(rootPath, 'plugins'), { recursive: true });
  }
  if (['fabric', 'forge', 'neoforge', 'quilt'].includes(type)) {
    fs.mkdirSync(path.join(rootPath, 'mods'), { recursive: true });
  }
  if (!['velocity', 'waterfall', 'bungeecord'].includes(type)) {
    const worldPath = path.join(rootPath, server.worldName || 'world');
    if (fs.existsSync(worldPath) && fs.statSync(worldPath).isDirectory()) {
      fs.mkdirSync(path.join(worldPath, 'datapacks'), { recursive: true });
    }
  }
}

function resolveServerScopedPath(serverId, relativeOrAbsolutePath) {
  const rootPath = path.resolve(getServerRoot(serverId));
  const targetPath = path.resolve(rootPath, String(relativeOrAbsolutePath || '.'));
  if (targetPath !== rootPath && !targetPath.startsWith(rootPath + path.sep)) {
    throw new Error('The requested file path escapes the server root');
  }
  return targetPath;
}

const binaryServerFileExtensions = new Set([
  '.jar', '.zip', '.gz', '.7z', '.rar', '.tar', '.tgz', '.bz2', '.xz',
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico', '.tif', '.tiff',
  '.mp3', '.wav', '.ogg', '.flac', '.mp4', '.webm', '.avi', '.mov',
  '.exe', '.dll', '.msi', '.bat', '.cmd', '.com', '.scr', '.class', '.bin', '.dat',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.litematic'
]);

function isBinaryServerFile(filePath) {
  if (binaryServerFileExtensions.has(path.extname(filePath).toLowerCase())) return true;
  try {
    const sample = fs.readFileSync(filePath, { encoding: 'utf8', flag: 'r' }).slice(0, 8192);
    return sample.includes('\u0000');
  } catch {
    return false;
  }
}

function emitServerState(server) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('launcher:server-state', { server });
  }
}

function emitServerConsole(serverId, type, line) {
  const text = stripAnsi(line).trim();
  if (!text) return;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(`server:console:${serverId}`, { serverId, type, line: text });
    mainWindow.webContents.send('launcher:server-console', { serverId, type, line: text });
  }
}

function getSharedCacheRoot() {
  return path.join(app.getPath('userData'), 'shared-cache');
}

function ensureLauncherGameFolders(rootPath) {
  const folders = [
    rootPath,
    path.join(rootPath, 'mods'),
    path.join(rootPath, 'resourcepacks'),
    path.join(rootPath, 'shaderpacks'),
    path.join(rootPath, 'assets'),
    path.join(rootPath, 'libraries'),
    path.join(rootPath, 'natives'),
    path.join(rootPath, 'versions'),
  ];
  for (const folder of folders) fs.mkdirSync(folder, { recursive: true });
}

function getContentFolder(type, rootPath) {
  if (type === 'resourcepack') return path.join(rootPath, 'resourcepacks');
  if (type === 'shader') return path.join(rootPath, 'shaderpacks');
  return path.join(rootPath, 'mods');
}

function getServerContentFolder(server, type, rootPath) {
  if (type === 'plugin') return path.join(rootPath, 'plugins');
  if (type === 'datapack') return path.join(rootPath, server.worldName || 'world', 'datapacks');
  return path.join(rootPath, 'mods');
}

function sanitizeFileName(name) {
  return String(name || 'content').replace(/[<>:"/\\|?*]+/g, '_').trim();
}

function getStateFilePath() {
  return path.join(app.getPath('userData'), 'launcher-state.json');
}

function readStateFromDisk() {
  launcherState = launcherStateStore.readFromDisk();
  let changed = false;
  for (const account of launcherState.accounts || []) {
    const cosmetics = normalizeAccountCosmetics(account.cosmetics || {});
    for (const key of ['recentlyUsedSkins', 'recentlyUsedCapes', 'favoriteSkins', 'favoriteCapes']) {
      const before = cosmetics[key];
      cosmetics[key] = before.filter(item => {
        if (!item || !['local', 'created'].includes(item.source) || !item.filePath) return true;
        return fs.existsSync(item.filePath);
      });
      changed ||= cosmetics[key].length !== before.length;
    }
    account.cosmetics = cosmetics;
  }
  if (changed) launcherStateStore.setState(launcherState);
  if (changed || secureStateCodec.isMigrationPending()) scheduleStateWrite();
  return launcherState;
}

function flushStateWrite() {
  launcherStateStore.setState(launcherState);
  launcherStateStore.flush();
  writeStatePending = false;
}

function scheduleStateWriteInternal() {
  launcherStateStore.setState(launcherState);
  writeStatePending = true;
  launcherStateStore.scheduleWrite(400);
}

function scheduleStateWrite() {
  scheduleStateWriteInternal();
}

function emitStatus(message) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('launcher:status', message);
  }
}

function emitExportProgress(exportId, percent, message) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('launcher:export-progress', {
      exportId: String(exportId || ''),
      percent: Math.max(0, Math.min(100, Number(percent) || 0)),
      message: String(message || ''),
    });
  }
}

function emitProfileImportProgress(progress) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('launcher:profile-import-progress', progress);
  }
}

function emitBaldMenuAction(action) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    throw new Error('Bald Launcher is not available to handle the in-game request.');
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  mainWindow.webContents.send('launcher:game-action', action);
}

function emitProcessState(running, profile = null, pid = null, details = {}) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('launcher:process-state', {
      running,
      profileId: profile?.id || null,
      profileName: profile?.name || null,
      pid,
      ...details,
    });
  }
}

function emitLauncherStateChanged() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('launcher:state-changed', launcherState);
  }
}

function accountProfilePlaytime(profileId) {
  const profile = launcherState.profiles.find(item => item.id === profileId);
  const session = getSession(profileId);
  const elapsed = recordProfilePlaytime(profile, session);
  if (elapsed > 0) {
    scheduleStateWrite();
    emitLauncherStateChanged();
  }
}

function startProfilePlaytimeTracking(profile, session, startedAt = Date.now()) {
  if (!profile || !session || session.running !== true) return;
  if (!Number.isFinite(Number(session.playtimeStartedAt))) {
    session.playtimeStartedAt = startedAt;
  }
  if (!Number.isFinite(Number(session.playtimeLastAccountedAt))) {
    session.playtimeLastAccountedAt = session.playtimeStartedAt;
  }
  profile.lastPlayedAt = startedAt;
  const existing = profilePlaytimeIntervals.get(profile.id);
  if (existing) clearInterval(existing);
  const interval = setInterval(() => accountProfilePlaytime(profile.id), 15000);
  interval.unref?.();
  profilePlaytimeIntervals.set(profile.id, interval);
  scheduleStateWrite();
  emitLauncherStateChanged();
}

function stopProfilePlaytimeTracking(profileId) {
  accountProfilePlaytime(profileId);
  const interval = profilePlaytimeIntervals.get(profileId);
  if (interval) clearInterval(interval);
  profilePlaytimeIntervals.delete(profileId);
}

function getSession(profileId) {
  return launcherState.sessions.find(session => session.profileId === profileId) || null;
}

function emitLog(profileName, type, line, profileId = null) {
  const text = String(line || '').trim();
  if (!text) return;
  const normalizedType = ['err', 'warn', 'info', 'normal'].includes(type) ? type : 'normal';
  const entry = { profileId, profileName, type: normalizedType, line: `[${profileName}] ${text}` };
  const session = profileId && getSession(profileId);
  if (session) {
    session.logs = Array.isArray(session.logs) ? session.logs : [];
    session.logs.push(entry);
    if (session.logs.length > 2000) session.logs.splice(0, session.logs.length - 2000);
    scheduleStateWrite();
  }
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('launcher:log', entry);
}

function classifyLogLine(line, fallback = 'normal') {
  const text = String(line || '');
  if (/\b(error|err|exception|failed|failure|crash|fatal|cannot)\b/i.test(text)) return 'err';
  if (/\b(warn|warning)\b/i.test(text)) return 'warn';
  return fallback;
}

function normalizeAccount(account) {
  const name = String(account?.name || '').trim().slice(0, 16) || 'Player';
  const type = account?.type === 'Offline' ? 'Offline' : 'Microsoft';
  const initials = String(account?.initials || name.slice(0, 2).toUpperCase()).slice(0, 2);
  const accent = type === 'Offline' ? '#173404' : '#3c3489';
  const fg = type === 'Offline' ? '#97c459' : '#ceecf6';
  const cosmetics = normalizeAccountCosmetics(account?.cosmetics || {});
  return {
    id: account?.id || `${type.toLowerCase()}-${Date.now()}`,
    name, type, initials, accent, fg,
    uuid: account?.uuid || (type === 'Offline' ? crypto.randomUUID() : null),
    auth: type === 'Microsoft' ? (account?.auth || null) : null,
    skinPath: account?.skinPath || cosmetics.skin?.localPath || null,
    cosmetics,
  };
}

function normalizeProfile(profile) {
  const requestedVersion = String(profile?.mcVersion || '').trim();
  const mcVersion = /^\d+\.\d+(?:\.\d+)?(?:[-+].*)?$/.test(requestedVersion) ? requestedVersion : COMMON_VERSIONS[0];
  const loader = LOADERS.includes(String(profile?.loader).toLowerCase()) ? String(profile.loader).toLowerCase() : 'fabric';
  const validRenderers = getRendererOptions(mcVersion, loader).map(o => o.id);
  const rendererMode = validRenderers.includes(profile?.rendererMode) ? profile.rendererMode : validRenderers[0];
  const name = String(profile?.name || '').trim().slice(0, 40) || 'New profile';
  const customSkinLoader = profile?.customSkinLoader && typeof profile.customSkinLoader === 'object'
    ? profile.customSkinLoader
    : {};
  const profileSettingKeys = [
    'minecraftClientModEnabled',
    'minecraftMenuEnabled',
    'minecraftPerformanceButtonEnabled',
    'minecraftInGameButtonEnabled',
    'minecraftPerformanceHudEnabled',
    'vanillaPerformancePresetEnabled',
    'optimizationModsEnabled',
  ];
  const profileSettingOverrides = Object.fromEntries(profileSettingKeys
    .filter(key => typeof profile?.[key] === 'boolean')
    .map(key => [key, profile[key]]));
  return {
    id: profile?.id || `profile-${Date.now()}`,
    name,
    folderName: String(profile?.folderName || '').trim() || profile?.id || `profile-${Date.now()}`,
    createdAt: Number(profile?.createdAt || Date.now()),
    updatedAt: Number(profile?.updatedAt || profile?.createdAt || Date.now()),
    lastUsedAt: Number(profile?.lastUsedAt || profile?.updatedAt || profile?.createdAt || Date.now()),
    playtimeMs: Math.max(0, Number(profile?.playtimeMs) || 0),
    lastPlayedAt: Number.isFinite(Number(profile?.lastPlayedAt)) && Number(profile.lastPlayedAt) > 0
      ? Number(profile.lastPlayedAt)
      : null,
    mcVersion,
    loader,
    loaderVersion: loader !== 'vanilla'
      ? normalizeLoaderVersion(profile?.loaderVersion ?? profile?.fabricLoaderVersion)
      : '',
    rendererMode,
    prewarmEnabled: profile?.prewarmOptIn === true && profile?.prewarmEnabled === true,
    prewarmOptIn: profile?.prewarmOptIn === true,
    icon: String(profile?.icon || name.slice(0, 1).toUpperCase()).slice(0, 2),
    modpackIconUrl: String(profile?.modpackIconUrl || '').slice(0, 1000) || null,
    ...profileSettingOverrides,
    javaPath: String(profile?.javaPath || '').trim(),
    memoryMax: Math.min(32, Math.max(1, Number(profile?.memoryMax) || DEFAULT_STATE.settings.memoryMax)),
    jvmProfile: ['default', 'zgc', 'custom'].includes(profile?.jvmProfile) ? profile.jvmProfile : 'default',
    customJvmArgs: String(profile?.customJvmArgs || ''),
    customSkinLoader: {
      enabled: customSkinLoader.enabled === true,
      state: ['disabled', 'checking', 'available', 'downloading', 'installing', 'configuring', 'ready', 'updating', 'error', 'unsupported'].includes(customSkinLoader.state)
        ? customSkinLoader.state
        : 'disabled',
      managed: customSkinLoader.managed === true,
      compatibility: customSkinLoader.compatibility && typeof customSkinLoader.compatibility === 'object'
        ? customSkinLoader.compatibility
        : null,
      lastError: customSkinLoader.lastError ? String(customSkinLoader.lastError).slice(0, 500) : null,
    },
    benchmarkHistory: Array.isArray(profile?.benchmarkHistory) ? profile.benchmarkHistory.slice(-30) : [],
    // Each entry is the installed content's own record, not just an id, so the
    // Content tab can render a real installed-library list (name/type/enabled)
    // without needing a live Modrinth lookup every time the profile opens.
    mods: Array.isArray(profile?.mods) ? profile.mods.map(normalizeInstalledContent) : [],
    optimizationManaged: profile?.optimizationManaged === true,
    optimizationKind: ['sodium', 'vanilla-fallback', 'oneclient'].includes(profile?.optimizationKind) ? profile.optimizationKind : null,
    optimizationSourceProfileId: String(profile?.optimizationSourceProfileId || '').slice(0, 120) || null,
    optimizationSourceProfileName: String(profile?.optimizationSourceProfileName || '').slice(0, 80) || null,
    oneClientPackVersionId: String(profile?.oneClientPackVersionId || '').slice(0, 120) || null,
    oneClientPackVersionNumber: String(profile?.oneClientPackVersionNumber || '').slice(0, 80) || null,
    optimizationWorldSetupComplete: profile?.optimizationWorldSetupComplete === true,
    optimizationVisualSettingsCopied: profile?.optimizationVisualSettingsCopied === true,
    optimizationSkippedMods: Array.isArray(profile?.optimizationSkippedMods)
      ? profile.optimizationSkippedMods.map(value => String(value).slice(0, 120)).slice(0, 30)
      : [],
    optimizationReady: profile?.optimizationReady === true,
    optimizationRollbackFiles: Array.isArray(profile?.optimizationRollbackFiles)
      ? profile.optimizationRollbackFiles.slice(0, 100).map(record => ({
          targetFileName: path.basename(String(record?.targetFileName || '')).slice(0, 240),
          disabled: record?.disabled === true,
          backupName: path.basename(String(record?.backupName || '')).slice(0, 160),
          previousEntry: record?.previousEntry && typeof record.previousEntry === 'object'
            ? normalizeInstalledContent(record.previousEntry)
            : null,
        })).filter(record => record.targetFileName && record.backupName && record.previousEntry)
      : [],
  };
}

function normalizeInstalledContent(entry) {
  const type = ['plugin', 'resourcepack', 'shader', 'datapack'].includes(entry?.type) ? entry.type : 'mod';
  return {
    id: String(entry?.id || `content-${Date.now()}`),
    name: String(entry?.name || 'Unknown content').slice(0, 80),
    slug: String(entry?.slug || '').slice(0, 160),
    type,
    iconUrl: entry?.iconUrl || null,
    author: String(entry?.author || '').slice(0, 160),
    description: String(entry?.description || entry?.desc || '').slice(0, 1000),
    minecraftVersion: String(entry?.minecraftVersion || '').slice(0, 32),
    loader: String(entry?.loader || '').slice(0, 32),
    projectUrl: String(entry?.projectUrl || '').slice(0, 500),
    fileName: String(entry?.fileName || '').replace(/[<>:"/\\|?*]+/g, '_').trim().slice(0, 240),
    source: entry?.source === 'curseforge' ? 'curseforge' : entry?.source === 'modrinth' ? 'modrinth' : '',
    versionId: String(entry?.versionId || '').slice(0, 64),
    fileId: String(entry?.fileId || '').slice(0, 64),
    installedVersion: String(entry?.installedVersion || '').slice(0, 100),
    versionType: String(entry?.versionType || '').slice(0, 16),
    publishedAt: String(entry?.publishedAt || '').slice(0, 40),
    environment: String(entry?.environment || '').slice(0, 32),
    side: String(entry?.side || '').slice(0, 32),
    sha1: String(entry?.sha1 || '').slice(0, 40),
    sha512: String(entry?.sha512 || '').slice(0, 128),
    licenseId: String(entry?.licenseId || '').slice(0, 120),
    latestVersionId: String(entry?.latestVersionId || '').slice(0, 64),
    latestVersion: String(entry?.latestVersion || '').slice(0, 100),
    updateAvailable: entry?.updateAvailable === true,
    external: entry?.external === true,
    enabled: entry?.enabled !== false,
    // Which renderer-mode bundle this came from (if any) — lets the
    // launcher clean up/swap the right mods when the mode changes later.
    // Manually-added content (via Add content) leaves this null.
    bundleFor: entry?.bundleFor || null,
    modpack: entry?.modpack === true,
    modpackName: String(entry?.modpackName || '').slice(0, 160),
    modpackProjectId: String(entry?.modpackProjectId || '').slice(0, 100),
  };
}

function readResourcePackIcon(filePath) {
  try {
    const zip = new AdmZip(filePath);
    const iconEntry = zip.getEntries()
      .filter(entry => !entry.isDirectory && /(?:^|[\\/])pack\.png$/i.test(String(entry.entryName || '')))
      .sort((left, right) => String(left.entryName).length - String(right.entryName).length)[0];
    if (!iconEntry) return null;
    const data = iconEntry.getData();
    if (!data.length || data.length > 2 * 1024 * 1024) return null;
    return `data:image/png;base64,${data.toString('base64')}`;
  } catch (error) {
    console.warn('[Content] Could not read resource-pack icon.', {
      filePath,
      message: error?.message || String(error),
    });
    return null;
  }
}

function runArchiveCommand(args, { capture = true, onOutputLine = null } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('tar.exe', args, { windowsHide: true });
    const chunks = [];
    const decoder = onOutputLine ? new StringDecoder('utf8') : null;
    let outputBuffer = '';
    let stderr = '';
    let callbackError = null;
    const handleLine = line => {
      const normalized = line.replace(/\r$/, '');
      if (!normalized) return;
      try {
        onOutputLine?.(normalized);
      } catch (error) {
        callbackError = error;
        child.kill();
      }
    };
    child.stdout?.on('data', chunk => {
      if (capture) chunks.push(chunk);
      if (decoder) {
        outputBuffer += decoder.write(chunk);
        let newline;
        while ((newline = outputBuffer.indexOf('\n')) !== -1) {
          handleLine(outputBuffer.slice(0, newline));
          outputBuffer = outputBuffer.slice(newline + 1);
        }
      }
    });
    child.stderr?.on('data', chunk => {
      stderr = `${stderr}${chunk.toString()}`.slice(-65536);
    });
    child.on('error', error => reject(callbackError || error));
    child.on('close', code => {
      if (decoder) {
        outputBuffer += decoder.end();
        if (outputBuffer) handleLine(outputBuffer);
      }
      if (callbackError) {
        reject(callbackError);
        return;
      }
      if (code !== 0) reject(new Error(stderr.trim() || `Archive command failed with exit code ${code}.`));
      else resolve(capture ? Buffer.concat(chunks) : Buffer.alloc(0));
    });
  });
}

async function readMrpackEntry(sourcePath, entryPath) {
  return runArchiveCommand(['-xOf', sourcePath, entryPath]);
}

async function pathExists(filePath) {
  try {
    await fs.promises.lstat(filePath);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

async function moveImportedTree(source, destination) {
  const sourceStat = await fs.promises.lstat(source);
  const destinationStat = await fs.promises.lstat(destination).catch(error => {
    if (error?.code === 'ENOENT') return null;
    throw error;
  });
  if (sourceStat.isDirectory() && !sourceStat.isSymbolicLink()
      && destinationStat?.isDirectory() && !destinationStat.isSymbolicLink()) {
    const entries = await fs.promises.readdir(source, { withFileTypes: true });
    for (const entry of entries) {
      await moveImportedTree(path.join(source, entry.name), path.join(destination, entry.name));
    }
    await fs.promises.rmdir(source);
    return;
  }
  if (destinationStat) await fs.promises.rm(destination, { recursive: true, force: true });
  await fs.promises.mkdir(path.dirname(destination), { recursive: true });
  await fs.promises.rename(source, destination);
}

async function inspectMrpackOverrides(sourcePath, onProgress = () => {}) {
  let unsafeEntry = '';
  let totalEntries = 0;
  let uncompressedBytes = 0;
  let scannedEntries = 0;
  let lastScanReportAt = 0;
  await runArchiveCommand(['-tvf', sourcePath], {
    capture: false,
    onOutputLine: line => {
      scannedEntries += 1;
      const fields = line.trim().split(/\s+/);
      const entry = fields.slice(8).join(' ');
      const normalized = entry.replace(/\\/g, '/');
      if (normalized.startsWith('/') || /^[a-z]:/i.test(normalized)
          || normalized.split('/').some(segment => segment === '..' || segment === '.')) {
        unsafeEntry ||= entry || line;
      } else if (normalized === 'overrides/' || normalized.startsWith('overrides/')) {
        const size = Number(fields[4]);
        if (!Number.isSafeInteger(size) || size < 0) {
          throw new Error(`Could not determine the uncompressed size of archive entry: ${entry}`);
        }
        totalEntries += 1;
        uncompressedBytes += size;
      }
      const now = Date.now();
      if (now - lastScanReportAt >= 500) {
        lastScanReportAt = now;
        onProgress({ phase: 'scan', scanned: scannedEntries, percent: null });
      }
    },
  });
  if (unsafeEntry) throw new Error(`The profile import contains an unsafe archive path: ${unsafeEntry}`);
  return { totalEntries, uncompressedBytes };
}

async function extractMrpackOverrides(sourcePath, destinationRoot, onProgress = () => {}, archiveInfo = null) {
  const { totalEntries } = archiveInfo || await inspectMrpackOverrides(sourcePath, onProgress);
  if (!totalEntries) return;
  const staging = path.join(destinationRoot, '.bald-import-overrides');
  await fs.promises.mkdir(staging, { recursive: true });
  const extractedRoot = path.join(staging, 'overrides');
  try {
    let extractedEntries = 0;
    let lastReportAt = 0;
    let lastPercent = 0;
    onProgress({ completed: 0, total: totalEntries, percent: 0 });
    await runArchiveCommand(['-xvf', sourcePath, '-C', staging, 'overrides'], {
      capture: false,
      onOutputLine: line => {
        const entry = line.replace(/^x\s+/, '').replace(/\\/g, '/');
        if (entry !== 'overrides' && entry !== 'overrides/' && !entry.startsWith('overrides/')) return;
        extractedEntries = Math.min(totalEntries, extractedEntries + 1);
        const percent = Math.min(99, Math.floor((extractedEntries / totalEntries) * 100));
        const now = Date.now();
        if (percent > lastPercent && (now - lastReportAt >= 150 || extractedEntries === totalEntries)) {
          lastReportAt = now;
          lastPercent = percent;
          onProgress({ completed: extractedEntries, total: totalEntries, percent });
        }
      },
    });
    if (await pathExists(extractedRoot)) {
      const entries = await fs.promises.readdir(extractedRoot);
      for (const entry of entries) {
        await moveImportedTree(path.join(extractedRoot, entry), path.join(destinationRoot, entry));
      }
    }
    onProgress({ completed: totalEntries, total: totalEntries, percent: 100 });
  } finally {
    await fs.promises.rm(staging, { recursive: true, force: true });
  }
}

function contentIdentity(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function isContentInstalled(entries, candidate) {
  const candidateId = contentIdentity(candidate?.id);
  const candidateName = contentIdentity(candidate?.name);
  const candidateSlug = contentIdentity(candidate?.slug);
  return (entries || []).some(entry => {
    const sameId = candidateId && contentIdentity(entry?.id) === candidateId;
    const sameName = candidateName && contentIdentity(entry?.name) === candidateName;
    const sameSlug = candidateSlug && contentIdentity(entry?.slug) === candidateSlug;
    return sameId || sameName || sameSlug;
  });
}

function isInstalledModContent(mods, entries, candidate) {
  const candidateIdentities = [candidate?.id, candidate?.slug, candidate?.name]
    .map(contentIdentity)
    .filter(Boolean);
  if (!candidateIdentities.length) return false;

  return (mods || []).some(mod => {
    const fileIdentity = contentIdentity(String(mod.fileName || '').replace(/\.disabled$/i, ''));
    const linkedEntries = (entries || []).filter(entry => {
      const entryFileName = entry?.fileName
        ? path.basename(String(entry.fileName))
        : `${sanitizeFileName(entry?.name)}.jar`;
      return fileIdentity && contentIdentity(entryFileName.replace(/\.disabled$/i, '')) === fileIdentity;
    });
    const installedIdentities = [
      ...(Array.isArray(mod.modIds) ? mod.modIds : []),
      mod.name,
      String(mod.fileName || '').replace(/\.jar(?:\.disabled)?$/i, ''),
      ...linkedEntries.flatMap(entry => [entry?.id, entry?.slug, entry?.name]),
    ].map(contentIdentity).filter(Boolean);
    return candidateIdentities.some(identity => installedIdentities.includes(identity));
  });
}

function hasInstalledContentFile(profile, entry) {
  return fs.existsSync(getInstalledFilePath(profile, entry.type, entry.name, false))
    || fs.existsSync(getInstalledFilePath(profile, entry.type, entry.name, true));
}

async function readInstalledModInventory(modsFolder) {
  if (!fs.existsSync(modsFolder)) return { mods: [], issues: [] };
  const mods = [];
  const issues = [];
  const files = (await fs.promises.readdir(modsFolder, { withFileTypes: true }))
    .filter(item => item.isFile() && /\.jar(?:\.disabled)?$/i.test(item.name));

  for (const file of files) {
    const filePath = path.join(modsFolder, file.name);
    const stat = await fs.promises.stat(filePath);
    const cacheKey = `${filePath}\0${stat.size}\0${stat.mtimeMs}\0${stat.ctimeMs}`;
    let metadata = installedModMetadataCache.get(cacheKey);
    if (!metadata) {
      const modIds = new Set();
      let displayName = path.basename(file.name).replace(/\.jar(?:\.disabled)?$/i, '');
      let modVersion = '';
      let issue = false;
      try {
        const archive = new AdmZip(await fs.promises.readFile(filePath));
        const fabricEntry = archive.getEntry('fabric.mod.json');
        if (fabricEntry) {
          const text = fabricEntry.getData().toString('utf8');
          try {
            const metadata = JSON.parse(text);
            if (metadata.id) modIds.add(String(metadata.id));
            if (metadata.name) displayName = String(metadata.name);
            if (metadata.version != null) modVersion = String(metadata.version);
          } catch (error) {
            const id = text.match(/^\s*"id"\s*:\s*"([^"]+)"/m)?.[1];
            const name = text.match(/^\s*"name"\s*:\s*"([^"]+)"/m)?.[1];
            if (!id) throw error;
            modIds.add(id);
            if (name) displayName = name;
          }
        }

        const quiltEntry = archive.getEntry('quilt.mod.json');
        if (quiltEntry) {
          const metadata = JSON.parse(quiltEntry.getData().toString('utf8'));
          const loader = metadata.quilt_loader || {};
          if (loader.id) modIds.add(String(loader.id));
          if (loader.metadata?.name && !fabricEntry) displayName = String(loader.metadata.name);
          if (loader.version != null && !modVersion) modVersion = String(loader.version);
        }

        for (const metadataPath of ['META-INF/mods.toml', 'META-INF/neoforge.mods.toml']) {
          const metadataEntry = archive.getEntry(metadataPath);
          if (!metadataEntry) continue;
          const text = metadataEntry.getData().toString('utf8');
          for (const block of text.split(/(?=\[\[mods\]\])/i).filter(part => /^\s*\[\[mods\]\]/i.test(part))) {
            const id = block.match(/^\s*modId\s*=\s*["']([^"']+)["']/im)?.[1];
            if (id) modIds.add(id);
            const version = block.match(/^\s*version\s*=\s*["']([^"']+)["']/im)?.[1];
            if (version && !modVersion) modVersion = version;
            if (displayName === path.basename(file.name).replace(/\.jar(?:\.disabled)?$/i, '')) {
              const name = block.match(/^\s*displayName\s*=\s*["']([^"']+)["']/im)?.[1];
              if (name) displayName = name;
            }
          }
        }
      } catch (error) {
        issue = true;
        console.warn('[Content] Could not inspect installed mod archive.', {
          fileName: file.name,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      metadata = { name: displayName, modIds: [...modIds], modVersion, issue };
      installedModMetadataCache.set(cacheKey, metadata);
    }
    if (metadata.issue) issues.push(file.name);
    mods.push({ fileName: file.name, name: metadata.name, modIds: metadata.modIds, modVersion: metadata.modVersion, enabled: !/\.disabled$/i.test(file.name) });
  }

  return { mods, issues };
}

function normalizeSettings(settings) {
  return {
    memoryMax: Math.min(32, Math.max(1, Number(settings?.memoryMax) || DEFAULT_STATE.settings.memoryMax)),
    memoryMaxAuto: settings?.memoryMaxAuto === true,
    jvmProfile: ['default', 'zgc', 'custom'].includes(settings?.jvmProfile) ? settings.jvmProfile : 'default',
    customJvmArgs: String(settings?.customJvmArgs || ''),
    optimizationModsEnabled: false,
    vanillaPerformancePresetEnabled: settings?.vanillaPerformancePresetEnabled !== false,
    playitKeepRunningOnClose: settings?.playitKeepRunningOnClose === true,
    horizonLauncherPath: String(settings?.horizonLauncherPath || '').trim().slice(0, 2048),
    horizonInstanceId: String(settings?.horizonInstanceId || '').trim().slice(0, 160),
    horizonPrewarmByInstance: settings?.horizonPrewarmByInstance && typeof settings.horizonPrewarmByInstance === 'object'
      ? Object.fromEntries(Object.entries(settings.horizonPrewarmByInstance)
        .filter(([id, enabled]) => typeof id === 'string' && id.length > 0 && typeof enabled === 'boolean')
        .slice(0, 500))
      : {},
    horizonAccountId: String(settings?.horizonAccountId || '').trim().slice(0, 160),
    ...normalizeBaldMenuSettings(settings),
  };
}

function normalizeTheme(theme) {
  const base = theme || JSON.parse(JSON.stringify(DEFAULT_THEME));
  const number = (value, fallback, min, max) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
  };
  const safeCss = (value, fallback) => String(value || fallback).replace(/[{};]/g, '').trim().slice(0, 300) || fallback;
  const color = (value, fallback) => {
    const candidate = safeCss(value, fallback);
    return /^(#[0-9a-f]{3,8}|rgba?\([^)]*\)|hsla?\([^)]*\)|var\(--[a-z0-9-]+\))$/i.test(candidate) ? candidate : fallback;
  };
  const string = (value, fallback) => safeCss(value, fallback);
  return {
    name: String(base?.name || 'Custom Theme').slice(0, 100),
    colors: {
      bgVoid: color(base?.colors?.bgVoid, '#0a0a0a'),
      bgSurface: color(base?.colors?.bgSurface, '#111111'),
      bgSurface2: color(base?.colors?.bgSurface2, '#161616'),
      border: color(base?.colors?.border, '#1e1e1e'),
      borderStrong: color(base?.colors?.borderStrong, '#2a2a2a'),
      accentGreen: color(base?.colors?.accentGreen, '#7ef15e'),
      accentGreenBg: color(base?.colors?.accentGreenBg, '#2d6e1a'),
      accentGreenBgHover: color(base?.colors?.accentGreenBgHover, '#357a1e'),
      accentGreenText: color(base?.colors?.accentGreenText, '#d4f0c4'),
      accentPurple: color(base?.colors?.accentPurple, '#7f77dd'),
      accentPurpleBg: color(base?.colors?.accentPurpleBg, '#221c47'),
      textPrimary: color(base?.colors?.textPrimary, '#cccccc'),
      textSecondary: color(base?.colors?.textSecondary, '#555555'),
      textMuted: color(base?.colors?.textMuted, '#3a3a3a'),
      bgSidebar: color(base?.colors?.bgSidebar, '#0f1317'),
      bgHeader: color(base?.colors?.bgHeader, '#0a0a0a'),
      bgCard: color(base?.colors?.bgCard, '#111111'),
      bgCardHover: color(base?.colors?.bgCardHover, '#1a2128'),
      bgSelected: color(base?.colors?.bgSelected, '#18251a'),
      bgInput: color(base?.colors?.bgInput, '#161616'),
      inputFocus: color(base?.colors?.inputFocus, '#7ef15e'),
      accentPrimaryHover: color(base?.colors?.accentPrimaryHover, '#91f270'),
      accentSecondaryHover: color(base?.colors?.accentSecondaryHover, '#aaa3ff'),
      success: color(base?.colors?.success, '#78e35a'),
      warning: color(base?.colors?.warning, '#e5b84e'),
      error: color(base?.colors?.error, '#f06a6a'),
      info: color(base?.colors?.info, '#69b9ee'),
      playButton: color(base?.colors?.playButton, '#2d6e1a'),
      browseButton: color(base?.colors?.browseButton, '#221c47'),
      downloadButton: color(base?.colors?.downloadButton, '#2d6e1a'),
      dangerButton: color(base?.colors?.dangerButton, '#7f1d1d'),
      scrollbar: color(base?.colors?.scrollbar, '#35424e'),
      notification: color(base?.colors?.notification, '#f06a6a'),
    },
    typography: {
      fontFamily: String(base?.typography?.fontFamily || 'system-ui, -apple-system, sans-serif'),
      fontSizeXs: String(base?.typography?.fontSizeXs || '10px'),
      fontSizeSm: String(base?.typography?.fontSizeSm || '11px'),
      fontSizeBase: String(base?.typography?.fontSizeBase || '12px'),
      fontSizeMd: String(base?.typography?.fontSizeMd || '13px'),
      fontSizeLg: String(base?.typography?.fontSizeLg || '14px'),
      fontSizeXl: String(base?.typography?.fontSizeXl || '16px'),
      fontWeight: string(base?.typography?.fontWeight, '400'),
      headingWeight: string(base?.typography?.headingWeight, '650'),
      letterSpacing: string(base?.typography?.letterSpacing, '0px'),
      lineHeight: string(base?.typography?.lineHeight, '1.45'),
    },
    spacing: {
      paddingSmall: String(base?.spacing?.paddingSmall || '8px'),
      paddingBase: String(base?.spacing?.paddingBase || '12px'),
      paddingLarge: String(base?.spacing?.paddingLarge || '16px'),
      gapSmall: String(base?.spacing?.gapSmall || '4px'),
      gapBase: String(base?.spacing?.gapBase || '8px'),
      gapLarge: String(base?.spacing?.gapLarge || '14px'),
      compact: string(base?.spacing?.compact, '8px'),
      comfortable: string(base?.spacing?.comfortable, '12px'),
      spacious: string(base?.spacing?.spacious, '18px'),
    },
    borders: {
      radiusSmall: String(base?.borders?.radiusSmall || '6px'),
      radiusBase: String(base?.borders?.radiusBase || '8px'),
      radiusMd: String(base?.borders?.radiusMd || '12px'),
      borderWidth: String(base?.borders?.borderWidth || '0.5px'),
      enabled: base?.borders?.enabled !== false,
      opacity: number(base?.borders?.opacity, 100, 0, 100),
      style: ['solid', 'dashed', 'dotted', 'double'].includes(base?.borders?.style) ? base.borders.style : 'solid',
    },
    background: {
      type: ['solid', 'gradient', 'image'].includes(base?.background?.type) ? base.background.type : 'solid',
      image: String(base?.background?.image || ''),
      blur: Number(base?.background?.blur || 0),
      opacity: Math.min(100, Math.max(0, Number(base?.background?.opacity) || 100)),
      overlayColor: String(base?.background?.overlayColor || '#000000'),
      overlayOpacity: Math.min(100, Math.max(0, Number(base?.background?.overlayOpacity) || 0)),
      brightness: number(base?.background?.brightness, 100, 25, 200),
      saturation: number(base?.background?.saturation, 100, 0, 200),
      fit: ['cover', 'contain', 'fill'].includes(base?.background?.fit) ? base.background.fit : 'cover',
      gradient: string(base?.background?.gradient, 'linear-gradient(135deg, #0a0a0a, #161616)'),
    },
    corners: Object.fromEntries(Object.entries(DEFAULT_THEME.corners).map(([key, fallback]) => [key, string(base?.corners?.[key], fallback)])),
    shadows: Object.fromEntries(Object.entries(DEFAULT_THEME.shadows).map(([key, fallback]) => [key, string(base?.shadows?.[key], fallback)])),
    effects: {
      shadowEnabled: base?.effects?.shadowEnabled !== false,
      glowEnabled: base?.effects?.glowEnabled === true,
      blur: number(base?.effects?.blur, 0, 0, 24),
      transparency: number(base?.effects?.transparency, 100, 20, 100),
      cardOpacity: number(base?.effects?.cardOpacity, 100, 30, 100),
      backgroundBlur: number(base?.effects?.backgroundBlur, 0, 0, 32),
      buttonGlow: number(base?.effects?.buttonGlow, 0, 0, 24),
      hoverLift: number(base?.effects?.hoverLift, 1, 0, 6),
      transitionSpeed: number(base?.effects?.transitionSpeed, 180, 0, 1000),
      reducedMotion: base?.effects?.reducedMotion === true,
    },
    sidebar: Object.fromEntries(Object.entries(DEFAULT_THEME.sidebar).map(([key, fallback]) => [key, key === 'width' ? string(base?.sidebar?.[key], fallback) : color(base?.sidebar?.[key], fallback)])),
    buttons: { radius: string(base?.buttons?.radius, '8px'), height: string(base?.buttons?.height, '36px'), weight: string(base?.buttons?.weight, '600'), glow: number(base?.buttons?.glow, 0, 0, 24) },
    cards: { background: color(base?.cards?.background, '#111111'), hover: color(base?.cards?.hover, '#1a2128'), selected: color(base?.cards?.selected, '#18251a'), opacity: number(base?.cards?.opacity, 100, 30, 100), radius: string(base?.cards?.radius, '9px'), shadow: base?.cards?.shadow !== false },
    inputs: { background: color(base?.inputs?.background, '#161616'), focus: color(base?.inputs?.focus, '#7ef15e'), radius: string(base?.inputs?.radius, '6px'), border: color(base?.inputs?.border, '#35424e') },
    modals: { background: color(base?.modals?.background, '#111111'), opacity: number(base?.modals?.opacity, 100, 40, 100), radius: string(base?.modals?.radius, '12px'), shadow: base?.modals?.shadow !== false, blur: number(base?.modals?.blur, 4, 0, 24) },
    advanced: {
      customCss: String(base?.advanced?.customCss || ''),
    },
  };
}

function getActiveTheme() {
  const themeId = String(launcherState.activeThemeId || '1');
  return normalizeTheme(launcherState.themes?.[themeId] || DEFAULT_THEME);
}

function generateThemeCss(theme) {
  const t = normalizeTheme(theme);
  let css = `:root {
    --bg-void: ${t.colors.bgVoid};
    --bg-surface: ${t.colors.bgSurface};
    --bg-surface-2: ${t.colors.bgSurface2};
    --border: ${t.colors.border};
    --border-strong: ${t.colors.borderStrong};
    --accent-green: ${t.colors.accentGreen};
    --accent-green-bg: ${t.colors.accentGreenBg};
    --accent-green-bg-hover: ${t.colors.accentGreenBgHover};
    --accent-green-text-on-dark: ${t.colors.accentGreenText};
    --accent-purple: ${t.colors.accentPurple};
    --accent-purple-bg: ${t.colors.accentPurpleBg};
    --text-primary: ${t.colors.textPrimary};
    --text-secondary: ${t.colors.textSecondary};
    --text-muted: ${t.colors.textMuted};
    --text-xs: ${t.typography.fontSizeXs};
    --text-sm: ${t.typography.fontSizeSm};
    --text-base: ${t.typography.fontSizeBase};
    --text-md: ${t.typography.fontSizeMd};
    --text-lg: ${t.typography.fontSizeLg};
    --text-xl: ${t.typography.fontSizeXl};
    --font-sans: ${t.typography.fontFamily};
    --p-small: ${t.spacing.paddingSmall};
    --p-base: ${t.spacing.paddingBase};
    --p-large: ${t.spacing.paddingLarge};
    --gap-small: ${t.spacing.gapSmall};
    --gap-base: ${t.spacing.gapBase};
    --gap-large: ${t.spacing.gapLarge};
    --radius-small: ${t.borders.radiusSmall};
    --radius-base: ${t.borders.radiusBase};
    --radius-md: ${t.borders.radiusMd};
    --border-width: ${t.borders.borderWidth};
  }`;
  if (t.advanced.customCss) css += `\n${t.advanced.customCss}`;
  return css;
}

function getCurseForgeApiKey() {
  return String(process.env.CURSEFORGE_API_KEY || '').trim();
}

function parseJavaMajorVersion(javaExecutable) {
  const cacheKey = String(javaExecutable || '');
  if (javaMajorVersionCache.has(cacheKey)) return javaMajorVersionCache.get(cacheKey);
  try {
    const result = spawnSync(javaExecutable, ['-version'], { encoding: 'utf8', windowsHide: true, timeout: 5000 });
    const text = `${result.stdout || ''}\n${result.stderr || ''}`;
    const match = text.match(/\bversion\s+"?([\d.]+)/i);
    const versionParts = match?.[1].split('.').map(Number) || [];
    const major = versionParts[0] === 1 ? versionParts[1] || 0 : versionParts[0] || 0;
    javaMajorVersionCache.set(cacheKey, major);
    return major;
  } catch (_error) {
    javaMajorVersionCache.set(cacheKey, 0);
    return 0;
  }
}

function getManagedJavaRoot(version) {
  return path.join(app.getPath('userData'), 'runtimes', `jdk-${version}`);
}

function findJavaExecutable(rootPath) {
  if (!rootPath) return null;
  const direct = path.join(rootPath, 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
  if (fs.existsSync(direct)) return direct;
  try {
    const nested = fs.readdirSync(rootPath, { withFileTypes: true })
      .find(entry => entry.isDirectory() && fs.existsSync(path.join(rootPath, entry.name, 'bin', process.platform === 'win32' ? 'java.exe' : 'java')));
    return nested ? path.join(rootPath, nested.name, 'bin', process.platform === 'win32' ? 'java.exe' : 'java') : null;
  } catch (_error) {
    return null;
  }
}

async function installManagedJava(version) {
  const rootPath = getManagedJavaRoot(version);
  const existing = findJavaExecutable(rootPath);
  if (existing && parseJavaMajorVersion(existing) >= version) return existing;

  const platform = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'mac' : 'linux';
  const architecture = process.arch === 'arm64' ? 'aarch64' : 'x64';
  const apiUrl = `https://api.adoptium.net/v3/assets/latest/${version}/hotspot?architecture=${architecture}&image_type=jdk&os=${platform}&vendor=eclipse`;
  emitStatus(`Java ${version} is required. Finding a compatible JDK download...`);
  const response = await axios.get(apiUrl, { timeout: 30000, headers: { 'User-Agent': 'Bald-Launcher' } });
  const asset = Array.isArray(response.data) ? response.data[0] : null;
  const binary = asset?.binary?.package;
  if (!binary?.link) throw new Error(`Java ${version} is required, but no compatible JDK download was found.`);
  if (!binary.checksum) throw new Error(`Java ${version} download has no published SHA-256 checksum; refusing an unverified runtime.`);
  const archivePath = path.join(app.getPath('userData'), 'runtimes', `jdk-${version}.download`);
  const stagingPath = `${rootPath}.staging`;
  fs.mkdirSync(path.dirname(archivePath), { recursive: true });
  emitStatus(`Downloading Java ${version}...`);
  const archive = await axios.get(binary.link, { responseType: 'arraybuffer', timeout: 180000, headers: { 'User-Agent': 'Bald-Launcher' } });
  const archiveBuffer = Buffer.from(archive.data);
  const checksum = crypto.createHash('sha256').update(archiveBuffer).digest('hex');
  if (checksum.toLowerCase() !== String(binary.checksum).toLowerCase()) {
    throw new Error(`Java ${version} download failed integrity verification.`);
  }
  fs.writeFileSync(archivePath, archiveBuffer);
  try {
    fs.rmSync(stagingPath, { recursive: true, force: true });
    fs.mkdirSync(stagingPath, { recursive: true });
    emitStatus(`Installing Java ${version}...`);
    new AdmZip(archivePath).extractAllTo(stagingPath, true);
    const installed = findJavaExecutable(stagingPath);
    if (!installed || parseJavaMajorVersion(installed) < version) {
      throw new Error(`Downloaded Java ${version} did not contain a usable runtime.`);
    }
    fs.rmSync(rootPath, { recursive: true, force: true });
    fs.renameSync(stagingPath, rootPath);
    const result = findJavaExecutable(rootPath);
    if (!result) throw new Error(`Java ${version} installation could not be validated.`);
    return result;
  } finally {
    fs.rmSync(archivePath, { force: true });
    fs.rmSync(stagingPath, { recursive: true, force: true });
  }
}

async function discoverJavaInstallations() {
  const candidates = new Map();
  const addCandidate = (value, source = 'System') => {
    if (!value) return;
    let executable = String(value).trim();
    if (!executable) return;
    if (!/java(?:w)?\.exe$/i.test(executable) && !/(?:^|[\\/])java$/i.test(executable)) {
      executable = path.join(executable, 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
    }
    if (!fs.existsSync(executable)) return;
    const major = parseJavaMajorVersion(executable);
    if (!major) return;
    candidates.set(path.normalize(executable), {
      path: path.normalize(executable),
      version: major,
      label: `Java ${major} · ${path.basename(path.dirname(path.dirname(executable)))}`,
      source,
    });
  };

  if (process.env.JAVA_HOME) addCandidate(process.env.JAVA_HOME, 'JAVA_HOME');

  if (process.platform === 'win32') {
    const roots = [
      process.env.ProgramFiles,
      process.env['ProgramFiles(x86)'],
      process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs'),
      process.env.USERPROFILE && path.join(process.env.USERPROFILE, '.jdks'),
      process.env.USERPROFILE && path.join(process.env.USERPROFILE, 'scoop', 'apps'),
      'C:\\Program Files\\Java',
      'C:\\Program Files\\Eclipse Adoptium',
      'C:\\Program Files\\Microsoft',
      'C:\\Program Files\\Zulu',
      'C:\\Program Files\\BellSoft',
      'C:\\Program Files\\Semeru',
      'C:\\Program Files\\Amazon Corretto',
    ];
    for (const root of roots) {
      if (!root || !fs.existsSync(root)) continue;
      try {
        const entries = fs.readdirSync(root, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isDirectory()) continue;
          const nested = path.join(root, entry.name);
          addCandidate(path.join(nested, 'bin', 'java.exe'), 'PC');
          try {
            for (const nestedEntry of fs.readdirSync(nested, { withFileTypes: true })) {
              if (nestedEntry.isDirectory()) addCandidate(path.join(nested, nestedEntry.name), 'PC');
            }
          } catch (_error) {}
        }
      } catch (_error) {}
    }
  }

  const managedRoot = path.join(app.getPath('userData'), 'runtimes');
  if (fs.existsSync(managedRoot)) {
    try {
      for (const entry of fs.readdirSync(managedRoot, { withFileTypes: true })) {
        if (entry.isDirectory() && /^jdk-/i.test(entry.name)) {
          const executable = findJavaExecutable(path.join(managedRoot, entry.name));
          if (executable) addCandidate(executable, 'Bald Launcher');
        }
      }
    } catch (_error) {}
  }

  await new Promise(resolve => execFile(process.platform === 'win32' ? 'where.exe' : 'which', ['java'], (error, stdout) => {
    if (!error) {
      for (const line of String(stdout || '').split(/\r?\n/)) addCandidate(line.trim(), 'PATH');
    }
    resolve();
  }));

  return [...candidates.values()].sort((left, right) => right.version - left.version || left.path.localeCompare(right.path));
}

async function getJavaPath(minimumVersion = 21, installIfMissing = false) {
  const cachedPath = serverJavaPathCache.get(minimumVersion);
  if (cachedPath && fs.existsSync(cachedPath) && parseJavaMajorVersion(cachedPath) >= minimumVersion) return cachedPath;
  const managed = findJavaExecutable(getManagedJavaRoot(minimumVersion));
  if (managed && parseJavaMajorVersion(managed) >= minimumVersion) {
    serverJavaPathCache.set(minimumVersion, managed);
    return managed;
  }
  const javaHome = process.env.JAVA_HOME;
  const candidate = javaHome && path.join(javaHome, 'bin', process.platform === 'win32' ? 'java.exe' : 'java');

  const javaCandidates = [];
  const addCandidate = value => {
    if (!value) return;
    const normalized = String(value).trim();
    if (!normalized || javaCandidates.includes(normalized)) return;
    const executable = normalized.endsWith(path.sep + 'java.exe') || normalized.endsWith(path.sep + 'java') ? normalized : path.join(normalized, 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
    if (fs.existsSync(executable)) javaCandidates.push(executable);
  };

  if (javaHome) addCandidate(javaHome);
  if (process.platform === 'win32') {
    const possibleRoots = [
      process.env.ProgramFiles,
      process.env['ProgramFiles(x86)'],
      'C:\\Program Files\\Eclipse Adoptium',
      'C:\\Program Files\\Microsoft',
      'C:\\Program Files\\Zulu',
      'C:\\Program Files\\Java',
      'C:\\Users\\' + (process.env.USERNAME || 'Public') + '\\.jdk',
      'C:\\Users\\' + (process.env.USERNAME || 'Public') + '\\AppData\\Local\\Programs\\Eclipse Adoptium',
    ];
    for (const root of possibleRoots) {
      if (!root) continue;
      if (fs.existsSync(root)) {
        for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
          if (entry.isDirectory()) addCandidate(path.join(root, entry.name));
        }
      }
    }
  }

  const resolved = await new Promise(resolve => execFile(process.platform === 'win32' ? 'where.exe' : 'which', ['java'], (error, stdout) => {
    if (!error && stdout.trim()) {
      for (const line of stdout.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (trimmed) addCandidate(trimmed);
      }
    }
    if (!javaCandidates.length) {
      resolve('java');
      return;
    }

    const ranked = javaCandidates
      .map(candidatePath => ({ path: candidatePath, version: parseJavaMajorVersion(candidatePath) }))
      .filter(item => item.version >= minimumVersion)
      .sort((a, b) => a.version - b.version);

    resolve(ranked[0]?.path || javaCandidates.sort((a, b) => parseJavaMajorVersion(b) - parseJavaMajorVersion(a))[0] || 'java');
  }));
  const resolvedMajor = parseJavaMajorVersion(resolved);
  if (resolvedMajor === minimumVersion) {
    serverJavaPathCache.set(minimumVersion, resolved);
    return resolved;
  }
  if (installIfMissing) {
    const installed = await installManagedJava(minimumVersion);
    serverJavaPathCache.set(minimumVersion, installed);
    return installed;
  }
  if (resolvedMajor >= minimumVersion) {
    serverJavaPathCache.set(minimumVersion, resolved);
    return resolved;
  }
  return resolved;
}

async function resolveJavaForMinecraft(mcVersion, preferredPath = '') {
  const minimumVersion = getRequiredJavaVersion(mcVersion);
  if (preferredPath && parseJavaMajorVersion(preferredPath) >= minimumVersion) {
    serverJavaPathCache.set(minimumVersion, preferredPath);
    return preferredPath;
  }
  return getJavaPath(minimumVersion, true);
}

function getActiveAccount() {
  return launcherState.accounts.find(a => a.id === launcherState.activeAccountId) || launcherState.accounts[0] || null;
}

async function getLaunchAuthorization(account) {
  if (!account) throw new Error('No account selected');
  if (account.type === 'Offline') {
    return {
      access_token: '',
      client_token: account.id,
      uuid: account.uuid,
      name: account.name,
      user_properties: '{}',
      meta: { type: 'mojang' },
    };
  }
  if (!account.auth) throw new Error(`Microsoft account "${account.name}" is not linked. Relink it from the Accounts screen.`);
  try {
    const { Auth } = require('msmc');
    const authorization = await refreshMicrosoftAuthorization(account.auth, async refreshToken => {
      const xboxManager = await new Auth('select_account').refresh(refreshToken);
      return (await xboxManager.getMinecraft()).mclc(true);
    });
    if (account.uuid && authorization.uuid && account.uuid !== authorization.uuid) {
      throw new Error('Microsoft authentication returned a different Minecraft account.');
    }
    account.auth = authorization;
    scheduleStateWrite();
    return authorization;
  } catch (error) {
    const reason = [
      error instanceof Error ? error.message : null,
      typeof error === 'string' ? error : null,
      typeof error?.message === 'string' ? error.message : null,
      typeof error?.error_description === 'string' ? error.error_description : null,
      typeof error?.error?.message === 'string' ? error.error.message : null,
      typeof error?.error?.error_description === 'string' ? error.error.error_description : null,
    ].find(value => value && value.trim()) || 'The authentication provider returned an error.';
    const refreshError = new Error(`Could not refresh the Minecraft session for "${account.name}". Relink this Microsoft account from the Accounts screen and try again. (${reason.slice(0, 240)})`);
    refreshError.code = 'MINECRAFT_SESSION_REFRESH_FAILED';
    throw refreshError;
  }
}

function getActiveProfile() {
  return launcherState.profiles.find(p => p.id === launcherState.activeProfileId) || launcherState.profiles[0] || null;
}

function getLoaderCachePath(profile, mcVersion, loader, loaderVersion = '') {
  const versionSuffix = loaderVersion ? `-${loaderVersion}` : '';
  return path.join(getMinecraftRootFor(profile.id), 'versions', `.bald-${loader}-${mcVersion}${versionSuffix}.json`);
}

function getLoaderVersionId(profile, mcVersion, loader, loaderVersion = '') {
  const cachePath = getLoaderCachePath(profile, mcVersion, loader, loaderVersion);
  try {
    const cached = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    if ((!loaderVersion || cached.loaderVersion === loaderVersion)
      && cached.versionId
      && fs.existsSync(path.join(getMinecraftRootFor(profile.id), 'versions', cached.versionId, `${cached.versionId}.json`))) {
      return cached.versionId;
    }
  } catch (_error) {
    // A missing or stale cache is repaired by the installer path.
  }
  return null;
}

async function downloadToFile(url, filePath, label, signal = null, onProgress = () => {}) {
  const temporaryPath = `${filePath}.${crypto.randomUUID()}.download`;
  emitStatus(`Download started: ${label}`);

  const response = await axios.get(url, {
    responseType: 'stream',
    timeout: 30000,
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
    signal: signal || undefined,
    headers: { 'User-Agent': 'BaldLauncher/0.1.0 (contact: none)' },
  });
  const total = Number(response.headers['content-length']) || 0;
  let received = 0;
  let lastStatusAt = 0;
  let lastStatusPercent = -1;
  const hash = crypto.createHash('sha1');
  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  try {
    await new Promise((resolve, reject) => {
      const output = fs.createWriteStream(temporaryPath);
      const abort = () => {
        const error = signal.reason instanceof Error ? signal.reason : new Error('Dependency download canceled.');
        response.data.destroy(error);
        output.destroy(error);
      };
      const cleanup = () => signal?.removeEventListener('abort', abort);
      response.data.on('data', chunk => {
        received += chunk.length;
        hash.update(chunk);
        onProgress({ loaded: received, total });
        const now = Date.now();
        const percent = total ? Math.floor((received / total) * 100) : -1;
        if (now - lastStatusAt >= 250 || (percent >= 0 && percent >= lastStatusPercent + 5)) {
          const progress = total ? ` ${Math.round((received / total) * 100)}%` : '';
          emitStatus(`Downloading ${label} · ${(received / 1048576).toFixed(1)} MB${total ? ` / ${(total / 1048576).toFixed(1)} MB` : ''}${progress}`);
          lastStatusAt = now;
          lastStatusPercent = percent;
        }
      });
      response.data.on('error', error => { cleanup(); reject(error); });
      output.on('error', error => { cleanup(); reject(error); });
      output.on('finish', () => { cleanup(); resolve(); });
      signal?.addEventListener('abort', abort, { once: true });
      response.data.pipe(output);
      if (signal?.aborted) abort();
    });
    if (signal?.aborted) throw new Error('Dependency download canceled.');
    fs.renameSync(temporaryPath, filePath);
    emitStatus(`Download complete: ${label}`);
    return hash.digest('hex');
  } catch (error) {
    if (fs.existsSync(temporaryPath)) fs.rmSync(temporaryPath, { force: true });
    throw error;
  }
}

async function getModrinthVersions(projectId, mcVersion, loader, type = 'mod', includeAll = false, signal = null) {
  if (!projectId) throw new Error('No Modrinth project id was provided');
  const query = new URLSearchParams({ game_versions: JSON.stringify([mcVersion]), limit: '100' });
  const normalizedLoader = normalizeContentLoader(loader);
  if (['mod', 'plugin'].includes(type) && normalizedLoader && normalizedLoader !== 'vanilla') {
    query.set('loaders', JSON.stringify([normalizedLoader]));
  }
  const versions = [];
  for (let offset = 0; ; offset += 100) {
    query.set('offset', String(offset));
    const response = await axios.get(`${MODRINTH_API}/project/${encodeURIComponent(projectId)}/version?${query}`, {
      timeout: 15000,
      signal: signal || undefined,
      headers: { 'User-Agent': 'BaldLauncher/0.1.0 (contact: none)' },
    });
    const page = Array.isArray(response.data) ? response.data : [];
    versions.push(...page);
    if (!includeAll || page.length < 100) break;
  }
  return versions;
}

async function resolveModrinthFile(projectId, mcVersion, loader, type = 'mod', versionId = null, signal = null) {
  const normalizedLoader = normalizeContentLoader(loader);
  const versions = await getModrinthVersions(projectId, mcVersion, normalizedLoader, type, Boolean(versionId), signal);
  const selected = selectModrinthVersion(versions, versionId);
  if (!selected || !selected.file.hashes?.sha1) {
    throw new Error(`No compatible downloadable Modrinth file found for ${projectId} on Minecraft ${mcVersion}.`);
  }
  if (type === 'mod' && !selected.version.game_versions?.includes(mcVersion)) {
    throw new Error(`Modrinth did not verify ${projectId} for Minecraft ${mcVersion}.`);
  }
  if (type === 'mod' && normalizedLoader && normalizedLoader !== 'vanilla'
    && !selected.version.loaders?.includes(normalizedLoader)) {
    throw new Error(`Modrinth did not verify ${projectId} for the ${normalizedLoader} loader.`);
  }
  return { ...selected.file, version: selected.version };
}

async function installModrinthContent(profile, entry, filePath, versionId = null, signal = null) {
  const file = await resolveModrinthFile(entry.id, profile.mcVersion, profile.loader, entry.type, versionId || entry.versionId || null, signal);
  emitStatus(`Downloading ${entry.name}...`);
  const actualHash = await downloadToFile(file.url, filePath, entry.name, signal);
  if (actualHash.toLowerCase() !== file.hashes.sha1.toLowerCase()) {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    throw new Error(`SHA-1 verification failed for ${entry.name}`);
  }
  return {
    versionId: file.version.id,
    installedVersion: file.version.version_number,
    versionType: file.version.version_type,
    publishedAt: file.version.date_published || '',
    environment: file.version.environment?.server || '',
    side: getModrinthSideLabel(file.version),
    sha1: file.hashes.sha1,
    fileName: file.filename,
    requiredDependencies: getRequiredModrinthDependencies(file.version),
  };
}

function getRequiredModrinthDependencies(version) {
  return (Array.isArray(version?.dependencies) ? version.dependencies : [])
    .filter(dependency => dependency?.dependency_type === 'required' && dependency.project_id)
    .map(dependency => ({
      projectId: String(dependency.project_id),
      versionId: dependency.version_id ? String(dependency.version_id) : null,
    }));
}

const AUTOMATIC_SODIUM_PROJECTS = [
  { id: 'sodium', name: 'Sodium', required: true },
  { id: 'lithium', name: 'Lithium' },
  { id: 'ferrite-core', name: 'FerriteCore' },
  { id: 'immediatelyfast', name: 'ImmediatelyFast' },
  { id: 'modernfix', name: 'ModernFix' },
  { id: 'iris', name: 'Iris', conditional: true },
];

async function resolveAutomaticSodiumPlan(mcVersion, includeIris = false) {
  const resolvedFiles = new Map();
  const projectMetadata = new Map();
  const getProjectMetadata = projectId => {
    if (!projectMetadata.has(projectId)) {
      projectMetadata.set(projectId, axios.get(`${MODRINTH_API}/project/${encodeURIComponent(projectId)}`, {
        timeout: 15000,
        headers: { 'User-Agent': 'BaldLauncher/0.1.0 (contact: none)' },
      }).then(response => response.data));
    }
    return projectMetadata.get(projectId);
  };
  const resolveFile = (projectId, versionId) => {
    const key = `${projectId}:${versionId || ''}`;
    if (!resolvedFiles.has(key)) {
      resolvedFiles.set(key, resolveModrinthFile(projectId, mcVersion, 'fabric', 'mod', versionId));
    }
    return resolvedFiles.get(key);
  };
  const resolveTree = async (projectId, localPlan = new Map(), versionId = null) => {
    if (localPlan.has(projectId)) {
      const existing = localPlan.get(projectId);
      if (versionId && existing.version.id !== versionId) {
        throw new Error(`Conflicting required versions for ${projectId}.`);
      }
      return localPlan;
    }

    const file = await resolveFile(projectId, versionId);
    const gameVersions = Array.isArray(file.version.game_versions) ? file.version.game_versions : [];
    const loaders = Array.isArray(file.version.loaders) ? file.version.loaders : [];
    if (!gameVersions.includes(mcVersion) || !loaders.includes('fabric')) {
      throw new Error(`${projectId} did not return a file verified for Minecraft ${mcVersion} on Fabric.`);
    }
    localPlan.set(projectId, file);
    for (const dependency of getRequiredModrinthDependencies(file.version)) {
      await resolveTree(dependency.projectId, localPlan, dependency.versionId);
    }
    return localPlan;
  };

  const projects = AUTOMATIC_SODIUM_PROJECTS
    .filter(project => !project.conditional || includeIris)
    .map(project => project.conditional && includeIris ? { ...project, required: true } : project);
  const trees = await Promise.all(projects.map(async project => {
    try {
      const tree = await resolveTree(project.id);
      for (const [projectId] of tree) {
        const metadata = await getProjectMetadata(projectId);
        if (metadata.status !== 'approved' || !metadata.license?.id
          || String(metadata.client_side || '').toLowerCase() === 'unsupported') {
          throw new Error(`${projectId} is not an approved, client-compatible project with a declared license.`);
        }
      }
      return { project, tree, error: null };
    } catch (error) {
      if (project.required) throw error;
      return { project, tree: null, error };
    }
  }));
  const files = new Map();
  const skipped = [];
  for (const { project, tree, error } of trees) {
    if (error || !tree) {
      skipped.push(project.name);
      continue;
    }
    const candidate = [...files, ...tree].map(([projectId, file]) => ({
      projectId: String(file.version.project_id || projectId),
      versionId: file.version.id,
      version: file.version,
    }));
    const conflicts = findModSetConflicts(candidate);
    const treeProjectIds = new Set([...tree].map(([projectId, file]) => String(file.version.project_id || projectId)));
    const conflict = [...tree].some(([projectId, file]) => {
      const existing = files.get(projectId);
      return existing && existing.version.id !== file.version.id;
    }) || conflicts.some(item => treeProjectIds.has(item.first) || treeProjectIds.has(item.second));
    if (conflict) {
      if (project.required) throw new Error(`The verified mod set requires conflicting versions of ${project.id}.`);
      skipped.push(project.name);
      continue;
    }
    const missingIntegrity = [...tree].find(([, file]) => !/^[a-f0-9]{128}$/i.test(String(file.hashes?.sha512 || '')));
    if (missingIntegrity) {
      if (project.required) throw new Error(`Modrinth did not provide a SHA-512 checksum for ${missingIntegrity[0]}.`);
      skipped.push(project.name);
      continue;
    }
    for (const [projectId, file] of tree) files.set(projectId, file);
  }

  const selectedConflicts = findModSetConflicts([...files].map(([projectId, file]) => ({
    projectId: String(file.version.project_id || projectId),
    versionId: file.version.id,
    version: file.version,
  })));
  if (selectedConflicts.length) {
    throw new Error(`The selected optimization mods conflict: ${selectedConflicts.map(item => `${item.first} / ${item.second}`).join(', ')}.`);
  }
  const licenses = new Map();
  for (const projectId of files.keys()) {
    licenses.set(projectId, (await getProjectMetadata(projectId)).license.id);
  }
  return { files, skipped, licenses };
}

function findManagedOptimizationProfile(sourceProfile, kind) {
  return launcherState.profiles.find(profile => profile.optimizationManaged
    && profile.optimizationKind === kind
    && profile.optimizationSourceProfileId === sourceProfile.id
    && profile.mcVersion === sourceProfile.mcVersion) || null;
}

function createManagedOptimizationProfile(sourceProfile, kind) {
  const now = Date.now();
  const id = createProfileId();
  const name = `${sourceProfile.name.slice(0, 24)} ${kind === 'sodium' ? 'Optimized' : 'Vanilla Fallback'}`.slice(0, 40);
  return normalizeProfile({
    id,
    name,
    folderName: `${getProfileFolderName(name, id)}-${id.slice(-8)}`,
    mcVersion: sourceProfile.mcVersion,
    loader: kind === 'sodium' ? 'fabric' : 'vanilla',
    rendererMode: kind === 'sodium' ? 'sodium' : 'vanilla',
    icon: kind === 'sodium' ? 'OF' : 'V',
    memoryMax: sourceProfile.memoryMax,
    javaPath: sourceProfile.javaPath,
    jvmProfile: sourceProfile.jvmProfile,
    customJvmArgs: sourceProfile.customJvmArgs,
    optimizationManaged: true,
    optimizationKind: kind,
    optimizationSourceProfileId: sourceProfile.id,
    optimizationSourceProfileName: sourceProfile.name,
    optimizationWorldSetupComplete: false,
    optimizationReady: false,
    createdAt: now,
    updatedAt: now,
    lastUsedAt: now,
    mods: [],
  });
}

async function createManagedSodiumProfile(sourceProfile) {
  if (!canCreateOptimizationProfile(sourceProfile)) {
    throw new Error('Automatic optimization profiles are limited to unmodified Vanilla/Fabric/Quilt profiles. Existing enabled mods and unsupported loaders are left unchanged.');
  }
  const sourceRoot = getMinecraftRootFor(sourceProfile.id);
  const activeModDirectory = path.join(sourceRoot, 'mods');
  if (fs.existsSync(activeModDirectory)) {
    const directoryStat = fs.lstatSync(activeModDirectory);
    if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory()) {
      throw new Error('The source profile mod directory is not a regular directory; the optimization profile was not created.');
    }
    if (fs.readdirSync(activeModDirectory).some(file => /\.jar$/i.test(file))) {
      throw new Error('The source profile contains active mod JARs, so an isolated performance bundle would not preserve its mod set. The original profile was left unchanged.');
    }
  }
  const existing = findManagedOptimizationProfile(sourceProfile, 'sodium');
  if (existing) {
    const sodiumEntry = existing.mods.find(entry => entry.id === 'sodium' && entry.enabled !== false);
    const sodiumPath = sodiumEntry ? resolveInstalledContentPath(existing, sodiumEntry, false) : null;
    if (existing.optimizationReady && fs.existsSync(getMinecraftRootFor(existing.id)) && sodiumPath && fs.existsSync(sodiumPath)) {
      return existing;
    }
    throw new Error(`The existing optimized profile "${existing.name}" is incomplete. Your original profile was not changed.`);
  }

  await getLoaderManifest(sourceProfile.mcVersion, 'fabric');
  const shaderSelection = await hasSelectedShaderPack(sourceRoot);
  const plan = await resolveAutomaticSodiumPlan(sourceProfile.mcVersion, shaderSelection);
  if (!plan.files.has('sodium')) {
    throw new Error(`No compatible Sodium release was verified for Minecraft ${sourceProfile.mcVersion}.`);
  }

  const profile = createManagedOptimizationProfile(sourceProfile, 'sodium');
  profile.optimizationSkippedMods = plan.skipped;
  const root = getMinecraftRootFor(profile.id);
  if (!areProfileRootsIsolated(sourceRoot, root)) {
    throw new Error('The optimized profile directory is not isolated from the source profile.');
  }
  launcherState.profiles.push(profile);
  try {
    await runIsolatedProfileSetup(sourceRoot, root, async () => {
      ensureLauncherGameFolders(root);
      await copyMinecraftVisualSettings(sourceRoot, root, shaderSelection);
      await installLoader(profile);
      const displayNames = new Map(AUTOMATIC_SODIUM_PROJECTS.map(project => [project.id, project.name]));
      for (const [projectId, file] of plan.files) {
        const name = displayNames.get(projectId) || projectId;
        const entry = normalizeInstalledContent({
          id: projectId,
          name,
          slug: projectId,
          type: 'mod',
          enabled: true,
          source: 'modrinth',
          minecraftVersion: sourceProfile.mcVersion,
          loader: 'fabric',
          versionId: file.version.id,
          installedVersion: file.version.version_number,
          versionType: file.version.version_type,
          publishedAt: file.version.date_published || '',
          sha1: file.hashes.sha1,
          sha512: file.hashes.sha512,
          licenseId: plan.licenses.get(projectId) || '',
          fileName: `${sanitizeFileName(name)}.jar`,
          projectUrl: `https://modrinth.com/mod/${encodeURIComponent(projectId)}`,
        });
        const filePath = getInstalledFilePath(profile, 'mod', entry.name, false);
        emitStatus(`Installing verified ${entry.name} for Minecraft ${profile.mcVersion}...`);
        const actualHash = await downloadToFile(file.url, filePath, entry.name);
        if (actualHash.toLowerCase() !== file.hashes.sha1.toLowerCase()) {
          if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
          throw new Error(`SHA-1 verification failed for ${entry.name}.`);
        }
        const actualSha512 = await hashFile(filePath, 'sha512');
        if (actualSha512.toLowerCase() !== file.hashes.sha512.toLowerCase()) {
          if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
          throw new Error(`SHA-512 verification failed for ${entry.name}.`);
        }
        profile.mods.push(entry);
      }
      profile.optimizationVisualSettingsCopied = true;
      profile.optimizationReady = true;
      profile.updatedAt = Date.now();
      launcherState.activeProfileId = profile.id;
      scheduleStateWrite();
    });
    return profile;
  } catch (error) {
    launcherState.profiles = launcherState.profiles.filter(item => item.id !== profile.id);
    if (launcherState.activeProfileId === profile.id) launcherState.activeProfileId = sourceProfile.id;
    scheduleStateWrite();
    throw error;
  }
}

async function createManagedVanillaFallback(sourceProfile) {
  const existing = findManagedOptimizationProfile(sourceProfile, 'vanilla-fallback');
  if (existing && fs.existsSync(getMinecraftRootFor(existing.id))) return existing;
  const profile = createManagedOptimizationProfile(sourceProfile, 'vanilla-fallback');
  const sourceRoot = getMinecraftRootFor(sourceProfile.id);
  const targetRoot = getMinecraftRootFor(profile.id);
  if (!areProfileRootsIsolated(sourceRoot, targetRoot)) throw new Error('The Vanilla fallback profile directory is not isolated from the source profile.');
  await runIsolatedProfileSetup(sourceRoot, targetRoot, async () => {
    ensureLauncherGameFolders(targetRoot);
    await copyMinecraftVisualSettings(sourceRoot, targetRoot, false);
  });
  profile.optimizationVisualSettingsCopied = true;
  profile.optimizationReady = true;
  launcherState.profiles.push(profile);
  launcherState.activeProfileId = profile.id;
  scheduleStateWrite();
  return profile;
}

async function hashFile(filePath, algorithm = 'sha256') {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash(algorithm);
    const input = fs.createReadStream(filePath);
    input.on('error', reject);
    input.on('data', chunk => hash.update(chunk));
    input.on('end', () => resolve(hash.digest('hex')));
  });
}

async function hasSelectedShaderPack(profileRoot) {
  const optionsPath = path.join(profileRoot, 'options.txt');
  if (!fs.existsSync(optionsPath)) return false;
  const metadata = await fs.promises.lstat(optionsPath);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error('The source options.txt is not a regular file; the optimization profile was not created.');
  }
  const options = await fs.promises.readFile(optionsPath, 'utf8');
  const setting = options.split(/\r?\n/).find(line => /^shaderPack:/i.test(line));
  return Boolean(setting && setting.slice(setting.indexOf(':') + 1).trim());
}

async function assertTreeHasNoSymlinks(folderPath, label) {
  const rootStat = await fs.promises.lstat(folderPath);
  if (rootStat.isSymbolicLink()) throw new Error(`${label} contains a symbolic link; it was not copied.`);
  if (rootStat.isDirectory()) {
    for (const entry of await fs.promises.readdir(folderPath, { withFileTypes: true })) {
      const entryPath = path.join(folderPath, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`${label} contains a symbolic link named "${entry.name}"; it was not copied.`);
      if (entry.isDirectory()) await assertTreeHasNoSymlinks(entryPath, label);
    }
  } else if (!rootStat.isFile()) {
    throw new Error(`${label} is not a regular file or directory.`);
  }
}

function isDirectChildPath(parentPath, childPath) {
  const relative = path.relative(path.resolve(parentPath), path.resolve(childPath));
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative);
}

async function assertWorldHasNoSymlinks(folderPath) {
  for (const entry of await fs.promises.readdir(folderPath, { withFileTypes: true })) {
    const entryPath = path.join(folderPath, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`World copy stopped because "${entry.name}" is a symbolic link.`);
    if (entry.isDirectory()) await assertWorldHasNoSymlinks(entryPath);
  }
}

async function copyMinecraftWorld(sourceWorldPath, destinationProfile) {
  const sourcePath = fs.realpathSync(sourceWorldPath);
  if (!fs.statSync(sourcePath).isDirectory()) throw new Error('The selected world is not a directory.');
  const sourceLevelPath = path.join(sourcePath, 'level.dat');
  const sourceLevel = fs.lstatSync(sourceLevelPath);
  if (!sourceLevel.isFile() || sourceLevel.isSymbolicLink() || sourceLevel.size <= 0) {
    throw new Error('The selected folder does not contain a readable Minecraft level.dat file.');
  }
  fs.accessSync(sourceLevelPath, fs.constants.R_OK);

  const savesPath = path.join(getMinecraftRootFor(destinationProfile.id), 'saves');
  fs.mkdirSync(savesPath, { recursive: true });
  const baseName = sanitizeFileName(path.basename(sourcePath)).replace(/\.+$/g, '') || 'Imported World';
  let destinationPath = path.join(savesPath, baseName);
  for (let suffix = 2; fs.existsSync(destinationPath); suffix += 1) {
    destinationPath = path.join(savesPath, `${baseName} (${suffix})`);
  }

  const stagingPath = path.join(savesPath, `.bald-world-copy-${crypto.randomUUID()}`);
  try {
    emitStatus(`Copying world "${baseName}" into ${destinationProfile.name}...`);
    await fs.promises.cp(sourcePath, stagingPath, { recursive: true, errorOnExist: true, force: false });
    await assertWorldHasNoSymlinks(stagingPath);
    const copiedLevelPath = path.join(stagingPath, 'level.dat');
    const copiedLevel = await fs.promises.lstat(copiedLevelPath);
    if (!copiedLevel.isFile() || copiedLevel.size !== sourceLevel.size) {
      throw new Error('The copied world did not pass its level.dat verification.');
    }
    await fs.promises.access(copiedLevelPath, fs.constants.R_OK);
    if (fs.existsSync(destinationPath)) throw new Error('A world with that name appeared in the destination profile.');
    await fs.promises.rename(stagingPath, destinationPath);
    return { name: path.basename(destinationPath), sourcePath, destinationPath };
  } catch (error) {
    if (fs.existsSync(stagingPath)) await fs.promises.rm(stagingPath, { recursive: true, force: true });
    throw error;
  }
}

async function prepareManagedWorlds(profile, sourceProfile) {
  if (profile.optimizationWorldSetupComplete) return;
  const sourceRunning = runningProcesses.has(sourceProfile.id);
  const sourceSaves = path.join(getMinecraftRootFor(sourceProfile.id), 'saves');
  const availableWorlds = !sourceRunning && fs.existsSync(sourceSaves)
    ? fs.readdirSync(sourceSaves, { withFileTypes: true }).filter(entry => {
        if (!entry.isDirectory()) return false;
        try {
          const level = fs.lstatSync(path.join(sourceSaves, entry.name, 'level.dat'));
          return level.isFile() && !level.isSymbolicLink() && level.size > 0;
        } catch (_error) {
          return false;
        }
      })
    : [];
  const buttons = availableWorlds.length
    ? ['Copy an existing world', 'Start with an empty world list', 'Cancel']
    : ['Start with an empty world list', 'Cancel'];
  const decision = await dialog.showMessageBox(mainWindow, {
    type: 'question',
    title: `Set up ${profile.name}`,
    message: 'This profile has its own saves folder.',
    detail: sourceRunning
      ? `Stop "${sourceProfile.name}" before copying one of its worlds. You can start with an empty world list now and import a copy later.`
      : availableWorlds.length
      ? `Choose a world from "${sourceProfile.name}" to copy. The original world will remain untouched.`
      : 'No readable worlds were found in the original profile. You can start with an empty world list.',
    buttons,
    cancelId: buttons.length - 1,
    defaultId: 0,
  });
  if (decision.response === buttons.length - 1) {
    throw Object.assign(new Error('World setup was canceled; no profile or world was changed.'), { code: 'WORLD_SETUP_CANCELED' });
  }

  const choseCopy = availableWorlds.length > 0 && decision.response === 0;
  if (choseCopy) {
    const selected = await dialog.showOpenDialog(mainWindow, {
      title: `Choose a world to copy from ${sourceProfile.name}`,
      defaultPath: sourceSaves,
      properties: ['openDirectory'],
    });
    if (selected.canceled || !selected.filePaths[0]) {
      throw Object.assign(new Error('World selection was canceled; no world was changed.'), { code: 'WORLD_SETUP_CANCELED' });
    }
    const sourceRoot = fs.realpathSync(sourceSaves);
    const selectedPath = fs.realpathSync(selected.filePaths[0]);
    if (!isDirectChildPath(sourceRoot, selectedPath)) {
      throw new Error('Choose a world folder directly inside the original profile saves folder.');
    }
    const copied = await copyMinecraftWorld(selectedPath, profile);
    await dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'World copied',
      message: 'The world copy was verified and is ready to use.',
      detail: `Source: ${copied.sourcePath}\nDestination: ${copied.destinationPath}\nThe original world was not modified.`,
      buttons: ['Continue'],
    });
  }

  profile.optimizationWorldSetupComplete = true;
  scheduleStateWrite();
}

async function installServerModrinthContent(server, entry, filePath, versionId = null, signal = null) {
  const loader = entry.type === 'datapack' ? null : String(server.serverType || server.loader || '').toLowerCase();
  const file = await resolveModrinthFile(entry.id, server.mcVersion, loader, entry.type, versionId || entry.versionId || null, signal);
  if (entry.type === 'mod' && !isModrinthServerCompatible(file.version)) {
    throw new Error(`${entry.name} is not supported on dedicated servers.`);
  }
  emitStatus(`Downloading ${entry.name}...`);
  const actualHash = await downloadToFile(file.url, filePath, entry.name, signal);
  if (actualHash.toLowerCase() !== file.hashes.sha1.toLowerCase()) {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    throw new Error(`SHA-1 verification failed for ${entry.name}`);
  }
  return {
    versionId: file.version.id,
    installedVersion: file.version.version_number,
    versionType: file.version.version_type,
    publishedAt: file.version.date_published || '',
    environment: file.version.environment?.server || '',
    side: getModrinthSideLabel(file.version),
    sha1: file.hashes.sha1,
    fileName: file.filename,
    requiredDependencies: getRequiredModrinthDependencies(file.version),
  };
}

async function ensureFabricApi(profile) {
  if (profile.loader !== 'fabric') return false;
  const existing = profile.mods.find(mod => mod.id === 'fabric-api');
  const enabledPath = getInstalledFilePath(profile, 'mod', 'Fabric API', false);
  const disabledPath = getInstalledFilePath(profile, 'mod', 'Fabric API', true);
  if (existing?.enabled !== false && fs.existsSync(enabledPath)) return false;
  if (fs.existsSync(disabledPath)) fs.renameSync(disabledPath, enabledPath);

  const entry = normalizeInstalledContent({
    id: 'fabric-api',
    name: 'Fabric API',
    type: 'mod',
    enabled: true,
  });
  await installModrinthContent(profile, entry, enabledPath);
  profile.mods = profile.mods.filter(mod => mod.id !== 'fabric-api');
  profile.mods.push(entry);
  return true;
}

function normalizeLoaderVersion(version) {
  const normalized = String(version || '').trim();
  return /^[0-9][a-zA-Z0-9.+_-]{0,79}$/.test(normalized) ? normalized : '';
}

function normalizeLoaderVersionList(items) {
  const seen = new Set();
  return (Array.isArray(items) ? items : []).flatMap(item => {
    const version = normalizeLoaderVersion(typeof item === 'string' ? item : item?.version);
    if (!version || seen.has(version)) return [];
    seen.add(version);
    return [{ version, stable: typeof item === 'object' && item?.stable === true }];
  });
}

function normalizeMetaLoaderVersions(items) {
  return normalizeLoaderVersionList((Array.isArray(items) ? items : []).map(item => ({
    version: item?.loader?.version,
    stable: item?.loader?.stable,
  })));
}

function normalizeNeoForgeVersions(metadata, mcVersion) {
  const minecraftLine = String(mcVersion).split('.').slice(1).join('.');
  const prefix = `${minecraftLine}.`;
  const versions = [...String(metadata || '').matchAll(/<version>([^<]+)<\/version>/g)]
    .map(match => normalizeLoaderVersion(match[1]))
    .filter((version, index, list) => version && version.startsWith(prefix) && list.indexOf(version) === index)
    .sort((left, right) => right.localeCompare(left, undefined, { numeric: true, sensitivity: 'base' }));
  return versions.map(version => ({ version, stable: !/(?:alpha|beta|pre|snapshot|rc)/i.test(version) }));
}

async function getLoaderVersions(mcVersion, loader) {
  const version = String(mcVersion || '').trim();
  const normalizedLoader = String(loader || '').toLowerCase();
  if (!/^\d+\.\d+(?:\.\d+)?$/.test(version)) throw new Error('A valid Minecraft version is required to list loader versions.');
  if (!['fabric', 'forge', 'neoforge', 'quilt'].includes(normalizedLoader)) {
    throw new Error('A supported mod loader is required to list versions.');
  }
  const cachePath = path.join(app.getPath('userData'), 'cache', `loader-versions-${normalizedLoader}-${version}.json`);
  try {
    const cached = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    const cachedVersions = normalizeLoaderVersionList(cached.versions);
    if (Date.now() - cached.fetchedAt < VERSION_CACHE_TTL_MS && cachedVersions.length) {
      return cachedVersions;
    }
  } catch (_error) {}
  let versions;
  if (normalizedLoader === 'fabric' || normalizedLoader === 'quilt') {
    const base = normalizedLoader === 'fabric'
      ? 'https://meta.fabricmc.net/v2/versions/loader'
      : 'https://meta.quiltmc.org/v3/versions/loader';
    const response = await axios.get(`${base}/${encodeURIComponent(version)}`, {
      timeout: 15000,
      headers: { 'User-Agent': 'BaldLauncher/0.1.0 (contact: none)' },
    });
    versions = normalizeMetaLoaderVersions(response.data);
  } else if (normalizedLoader === 'forge') {
    const response = await axios.get('https://files.minecraftforge.net/net/minecraftforge/forge/maven-metadata.json', {
      timeout: 15000,
      headers: { 'User-Agent': 'BaldLauncher/0.1.0 (contact: none)' },
    });
    versions = getForgeVersions(response.data, version).map(item => ({
      version: normalizeLoaderVersion(item),
      stable: !/(?:alpha|beta|pre|snapshot|rc)/i.test(item),
    })).filter(item => item.version);
  } else {
    const response = await axios.get('https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml', {
      timeout: 15000,
      headers: { 'User-Agent': 'BaldLauncher/0.1.0 (contact: none)' },
    });
    versions = normalizeNeoForgeVersions(response.data, version);
  }
  if (!versions.length) throw new Error(`No ${normalizedLoader} versions are available for Minecraft ${version}.`);
  fs.mkdirSync(path.dirname(cachePath), { recursive: true });
  fs.writeFileSync(cachePath, JSON.stringify({ fetchedAt: Date.now(), versions }));
  return versions;
}

async function getLoaderManifest(mcVersion, loader) {
  const cachePath = path.join(app.getPath('userData'), 'cache', `${loader}-${mcVersion}.json`);
  try {
    const cached = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    if (Date.now() - cached.fetchedAt < VERSION_CACHE_TTL_MS && cached.version) return cached.version;
  } catch (_error) {}
  const base = loader === 'quilt' ? 'https://meta.quiltmc.org/v3/versions/loader' : 'https://meta.fabricmc.net/v2/versions/loader';
  const response = await axios.get(`${base}/${encodeURIComponent(mcVersion)}`, {
    timeout: 15000,
    headers: { 'User-Agent': 'BaldLauncher/0.1.0 (contact: none)' },
  });
  const item = response.data?.find(candidate => candidate.loader?.stable) || response.data?.[0];
  const version = item?.loader?.version;
  if (!version) throw new Error(`No ${loader} loader is available for Minecraft ${mcVersion}`);
  fs.mkdirSync(path.dirname(cachePath), { recursive: true });
  fs.writeFileSync(cachePath, JSON.stringify({ fetchedAt: Date.now(), version }));
  return version;
}

async function ensureVanillaVersionProfile(rootPath, mcVersion) {
  const versionDirectory = path.join(rootPath, 'versions', mcVersion);
  const versionPath = path.join(versionDirectory, `${mcVersion}.json`);
  if (fs.existsSync(versionPath)) return;
  const response = await axios.get(VERSION_MANIFEST_URL, { timeout: 15000 });
  const version = response.data?.versions?.find(candidate => candidate.id === mcVersion);
  if (!version?.url) throw new Error(`Minecraft version ${mcVersion} was not found in Mojang's release manifest`);
  emitStatus(`Downloading Minecraft ${mcVersion} metadata...`);
  const versionResponse = await axios.get(version.url, { timeout: 15000 });
  fs.mkdirSync(versionDirectory, { recursive: true });
  fs.writeFileSync(versionPath, JSON.stringify(versionResponse.data, null, 2));
}

function runInstaller(javaPath, installerPath, args, cwd) {
  return runInstallerProcess(spawn, javaPath, installerPath, args, cwd, emitStatus);
}

function findInstalledVersionId(rootPath, mcVersion, loader, before, loaderVersion = '') {
  const versionsPath = path.join(rootPath, 'versions');
  if (loaderVersion) {
    const forgeBuild = loaderVersion.startsWith(`${mcVersion}-`)
      ? loaderVersion.slice(mcVersion.length + 1)
      : loaderVersion;
    const expectedIds = loader === 'fabric'
      ? [`fabric-loader-${loaderVersion}-${mcVersion}`]
      : loader === 'quilt'
        ? [`quilt-loader-${loaderVersion}-${mcVersion}`]
        : loader === 'forge'
          ? [`${mcVersion}-forge-${forgeBuild}`]
          : loader === 'neoforge'
            ? [`neoforge-${loaderVersion}`, `${mcVersion}-neoforge-${loaderVersion}`]
            : [];
    const entries = fs.readdirSync(versionsPath, { withFileTypes: true });
    const expected = new Set(expectedIds.map(id => id.toLowerCase()));
    return entries.find(entry => entry.isDirectory() && expected.has(entry.name.toLowerCase()))?.name || null;
  }
  const matchesLoader = name => loader === 'neoforge'
    ? name.toLowerCase().startsWith('neoforge-') || name.toLowerCase().startsWith(`${mcVersion}-neoforge-`)
    : loader === 'fabric'
      ? name.toLowerCase().startsWith(`fabric-loader-`) && name.toLowerCase().endsWith(`-${mcVersion}`)
      : loader === 'quilt'
        ? name.toLowerCase().startsWith('quilt-loader-') && name.toLowerCase().endsWith(`-${mcVersion}`)
      : name.toLowerCase().startsWith(`${mcVersion}-${loader}-`);
  const candidates = fs.readdirSync(versionsPath, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && matchesLoader(entry.name))
    .map(entry => entry.name)
    .filter(name => !before.has(name));
  if (candidates.length) return candidates[candidates.length - 1];
  const existing = fs.readdirSync(versionsPath, { withFileTypes: true })
    .find(entry => entry.isDirectory() && matchesLoader(entry.name));
  return existing?.name || null;
}

async function installLoader(profile) {
  const { mcVersion, loader } = profile;
  if (loader === 'vanilla') return mcVersion;
  const requestedLoaderVersion = normalizeLoaderVersion(profile.loaderVersion);
  const cachedVersionId = getLoaderVersionId(profile, mcVersion, loader, requestedLoaderVersion);
  if (cachedVersionId) return cachedVersionId;

  const rootPath = getMinecraftRootFor(profile.id);
  const versionsPath = path.join(rootPath, 'versions');
  await ensureVanillaVersionProfile(rootPath, mcVersion);
  const before = new Set(fs.readdirSync(versionsPath));
  const javaPath = await getJavaPath();
  let loaderVersion;
  let installerUrl;
  let installerArgs;

  if (loader === 'fabric' || loader === 'quilt') {
    if (requestedLoaderVersion) {
      const availableVersions = await getLoaderVersions(mcVersion, loader);
      if (!availableVersions.some(item => item.version === requestedLoaderVersion)) {
        throw new Error(`${loader} ${requestedLoaderVersion} is not available for Minecraft ${mcVersion}.`);
      }
      loaderVersion = requestedLoaderVersion;
    } else {
      loaderVersion = await getLoaderManifest(mcVersion, loader);
    }
    installerUrl = loader === 'fabric'
      ? 'https://maven.fabricmc.net/net/fabricmc/fabric-installer/1.0.3/fabric-installer-1.0.3.jar'
      : 'https://maven.quiltmc.org/repository/release/org/quiltmc/quilt-installer/0.8.1/quilt-installer-0.8.1.jar';
    installerArgs = loader === 'fabric'
      ? ['client', '-dir', rootPath, '-mcversion', mcVersion, '-loader', loaderVersion, '-noprofile']
      : ['install', 'client', mcVersion, loaderVersion, '--dir', rootPath];
  } else if (loader === 'forge' || loader === 'neoforge') {
    const availableVersions = await getLoaderVersions(mcVersion, loader);
    if (requestedLoaderVersion) {
      if (!availableVersions.some(item => item.version === requestedLoaderVersion)) {
        throw new Error(`${loader} ${requestedLoaderVersion} is not available for Minecraft ${mcVersion}.`);
      }
      loaderVersion = requestedLoaderVersion;
    } else {
      loaderVersion = availableVersions.find(item => item.stable)?.version || availableVersions[0]?.version;
    }
    if (!loaderVersion) throw new Error(`No ${loader} version is available for Minecraft ${mcVersion}`);
    if (loader === 'forge') {
      installerUrl = `https://maven.minecraftforge.net/net/minecraftforge/forge/${loaderVersion}/forge-${loaderVersion}-installer.jar`;
      installerArgs = ['--installClient', rootPath];
    } else {
      installerUrl = `https://maven.neoforged.net/releases/net/neoforged/neoforge/${loaderVersion}/neoforge-${loaderVersion}-installer.jar`;
      installerArgs = ['--install-client', rootPath];
    }
  } else {
    throw new Error(`Unsupported mod loader: ${loader}`);
  }

  const installerPath = path.join(rootPath, LOADER_INSTALLER_DIR, `${loader}-${loaderVersion}.jar`);
  if (!fs.existsSync(installerPath)) {
    emitStatus(`Downloading ${loader} installer...`);
    await downloadToFile(installerUrl, installerPath, `${loader} installer`);
  }
  if (loader === 'forge' || loader === 'neoforge') ensureLauncherProfilesFile(rootPath);
  emitStatus(`Installing ${loader} ${loaderVersion}...`);
  await runInstaller(javaPath, installerPath, installerArgs, rootPath);
  const versionId = findInstalledVersionId(
    rootPath,
    mcVersion,
    loader === 'neoforge' ? 'neoforge' : loader,
    before,
    requestedLoaderVersion,
  );
  if (!versionId) throw new Error(`${loader} installer completed but no launch profile was created`);
  fs.writeFileSync(getLoaderCachePath(profile, mcVersion, loader, requestedLoaderVersion), JSON.stringify({ loaderVersion, versionId }, null, 2));
  return versionId;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1560,
    height: 900,
    minWidth: 1280,
    minHeight: 720,
    frame: false,
    icon: appIconPath,
    backgroundColor: '#0d0d0d',
    title: 'Bald Launcher',
    show: false,
    center: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: true,
    },
  });

  mainWindow.removeMenu();
  // Always restore native input handling when a packaged window is recreated.
  mainWindow.setIgnoreMouseEvents(false);
  mainWindow.setFocusable(true);
  mainWindow.on('focus', () => {
    if (!mainWindow.isDestroyed()) mainWindow.setIgnoreMouseEvents(false);
  });
  mainWindow.on('restore', () => {
    if (mainWindow.isDestroyed()) return;
    mainWindow.setIgnoreMouseEvents(false);
    mainWindow.setFocusable(true);
  });
  mainWindow.on('show', () => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.setIgnoreMouseEvents(false);
      mainWindow.setFocusable(true);
    }
  });
  mainWindow.webContents.on('console-message', details => {
    const log = details.level === 'error' ? console.error : details.level === 'warning' ? console.warn : console.log;
    log(`[renderer:${details.level}] ${details.sourceId}:${details.lineNumber} ${details.message}`);
  });
  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame) return;
    reportStartupFailure(new Error(`${errorDescription} (${errorCode}): ${validatedURL}`), 'renderer page load');
    if (!mainWindow.isDestroyed()) mainWindow.show();
  });
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    reportStartupFailure(new Error(`Renderer exited (${details.reason}, code ${details.exitCode})`), 'renderer process');
  });
  mainWindow.loadFile(htmlPath).catch(error => {
    reportStartupFailure(error, 'loadFile');
    if (!mainWindow.isDestroyed()) mainWindow.show();
  });
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.webContents.on('before-input-event', (_event, input) => {
    const isReload = input.key === 'F5' || (input.control && input.key.toLowerCase() === 'r');
    if (isReload) mainWindow.reload();
  });

  return mainWindow;
}

function watchLauncherFile() {
  if (app.isPackaged) return;
  try {
    fs.watch(htmlPath, { persistent: false }, () => {
      clearTimeout(reloadTimer);
      reloadTimer = setTimeout(() => {
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.reload();
      }, 150);
    });
  } catch (error) {
    console.error('Launcher file watch failed:', error);
  }
}

// ---------------------------------------------------------------------------
// IPC: state
// ---------------------------------------------------------------------------
ipcMain.handle('launcher:get-state', async () => launcherState);
ipcMain.handle('launcher:get-update-status', async () => ({ ok: true, update: launcherUpdateStatus }));
ipcMain.handle('launcher:window-control', async (_event, action) => {
  if (!mainWindow || mainWindow.isDestroyed()) return { ok: false, error: 'Launcher window is unavailable.' };
  if (action === 'minimize') {
    mainWindow.minimize();
    return { ok: true };
  }
  if (action === 'toggle-maximize') {
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
    return { ok: true, maximized: mainWindow.isMaximized() };
  }
  if (action === 'close') {
    app.quit();
    return { ok: true };
  }
  return { ok: false, error: 'Unknown launcher window action.' };
});

ipcMain.handle('server:playit-status', async () => ({ ok: true, playit: playitManager.state() }));

ipcMain.handle('server:playit-install', async (_event, payload) => {
  try {
    const agentPath = playitManager.getAgentPath();
    const release = await axios.get('https://api.github.com/repos/playit-cloud/playit-agent/releases/latest', {
      headers: { 'User-Agent': 'BaldLauncher/0.1.0', Accept: 'application/vnd.github+json' },
      timeout: 15000,
    });
    const assets = Array.isArray(release.data?.assets) ? release.data.assets : [];
    const asset = process.platform === 'win32'
      ? assets.find(item => /windows/i.test(item.name) && /x86_64|amd64/i.test(item.name) && item.name.toLowerCase().endsWith('.exe'))
      : assets.find(item => /linux/i.test(item.name) && /x86_64|amd64/i.test(item.name) && !item.name.endsWith('.sha256'));
    if (!asset?.browser_download_url) throw new Error('Could not find a compatible Playit agent build in the latest release');
    const checksumAsset = findSha256Asset(assets, asset.name);
    if (!checksumAsset?.browser_download_url) {
      throw new Error(`The latest Playit release does not publish a SHA-256 checksum for ${asset.name}; installation was blocked.`);
    }
    const checksumResponse = await axios.get(checksumAsset.browser_download_url, {
      responseType: 'text',
      timeout: 15000,
      maxContentLength: 4096,
      headers: { 'User-Agent': 'BaldLauncher/0.1.8', Accept: 'text/plain' },
    });
    const expectedChecksum = parseSha256Checksum(checksumResponse.data, asset.name);
    const stagedAgentPath = `${agentPath}.${crypto.randomUUID()}.verified-download`;
    try {
      await downloadToFile(asset.browser_download_url, stagedAgentPath, 'Playit agent');
      verifySha256(fs.readFileSync(stagedAgentPath), expectedChecksum);
      if (process.platform !== 'win32') fs.chmodSync(stagedAgentPath, 0o755);
      fs.renameSync(stagedAgentPath, agentPath);
    } finally {
      if (fs.existsSync(stagedAgentPath)) fs.rmSync(stagedAgentPath, { force: true });
    }
    return { ok: true, playit: playitManager.state() };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle('server:playit-start', async () => playitManager.start({
  keepRunningOnClose: launcherState.settings?.playitKeepRunningOnClose === true,
}));
ipcMain.handle('server:playit-stop', async () => playitManager.stop());
ipcMain.handle('server:playit-restart', async () => playitManager.restart({
  keepRunningOnClose: launcherState.settings?.playitKeepRunningOnClose === true,
}));
ipcMain.handle('server:playit-persistence', async (_event, enabled) => {
  launcherState.settings = { ...launcherState.settings, playitKeepRunningOnClose: enabled === true };
  scheduleStateWrite();
  return {
    ok: true,
    keepRunningOnClose: launcherState.settings.playitKeepRunningOnClose,
    restartRequired: launcherState.settings.playitKeepRunningOnClose && Boolean(playitManager.state().pid) && !playitManager.state().persistent,
  };
});
ipcMain.handle('server:playit-input', async (_event, data) => playitManager.write(data));
ipcMain.handle('server:playit-resize', async (_event, payload) => playitManager.resize(payload?.cols, payload?.rows));
ipcMain.handle('server:playit-clear', async () => playitManager.clear());
ipcMain.handle('server:playit-open-link', async (_event, url) => playitManager.openLink(url));
ipcMain.handle('launcher:open-external-url', async (_event, url) => {
  const value = String(url || '');
  if (!/^https?:\/\//i.test(value)) return { ok: false, error: 'Only HTTP and HTTPS links can be opened.' };
  await shell.openExternal(value);
  return { ok: true };
});

function getConfiguredHorizonLauncher() {
  const executablePath = normalizeHorizonLauncherPath(launcherState.settings?.horizonLauncherPath);
  const stat = fs.lstatSync(executablePath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error('The configured Horizon Launcher path is not a regular executable file.');
  }
  return executablePath;
}

function prepareHorizonHomes() {
  const roots = getHorizonPaths(app.getPath('userData'));
  for (const folder of [roots.root, roots.launcherHome, roots.gameHome]) {
    fs.mkdirSync(folder, { recursive: true });
    const stat = fs.lstatSync(folder);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error(`The Horizon data folder is not a real directory: ${folder}`);
    }
  }
  return roots;
}

async function runHorizonCli(args, options = {}) {
  const executablePath = getConfiguredHorizonLauncher();
  prepareHorizonHomes();
  return runHorizonCommand({
    executablePath,
    userDataPath: app.getPath('userData'),
    args,
    ...options,
  });
}

async function isHorizonBuildPrepared(buildTag) {
  const roots = prepareHorizonHomes();
  const versionDir = path.join(roots.launcherHome, 'versions', buildTag);
  const preparerPath = path.join(versionDir, process.platform === 'win32' ? 'horizon-prepare.exe' : 'horizon-prepare');
  try {
    await runHorizonCommand({
      executablePath: preparerPath,
      userDataPath: app.getPath('userData'),
      args: buildHorizonPrepareCheckArgs(versionDir),
      json: false,
      timeoutMs: 30_000,
    });
    return true;
  } catch (error) {
    if (/is not prepared:\s*horizon-prepare --prepare/i.test(error.message)) return false;
    throw error;
  }
}

function sendHorizonSetupProgress(progress) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('horizon:setup-progress', progress);
  }
}

function sendHorizonProcessState(state) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('horizon:process-state', state);
  }
}

function startHorizonClient(instance, executablePath, roots, { prewarming = false } = {}) {
  const child = spawn(executablePath, ['play', '--instance', instance.id], {
    env: {
      ...process.env,
      HORIZON_LAUNCHER_HOME: roots.launcherHome,
      HORIZON_HOME: roots.gameHome,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let stderrTail = '';
  let resolveReadiness;
  const readiness = prewarming
    ? new Promise(resolve => { resolveReadiness = resolve; })
    : Promise.resolve({ ok: true });
  const state = {
    child,
    instance,
    prewarming,
    activated: false,
    ready: !prewarming,
    readiness,
    resolveReadiness,
    audioMuteTimer: null,
    audioMuteInFlight: false,
    audioMuteErrorReported: false,
    resourceLimitTimer: null,
    resourceLimitInFlight: false,
    resourceLimitErrorReported: false,
  };
  if (prewarming && Number.isSafeInteger(child.pid)) {
    try {
      os.setPriority(child.pid, os.constants.priority.PRIORITY_BELOW_NORMAL);
    } catch (error) {
      console.warn(`[Horizon] Could not lower background process priority for ${instance.name}:`, error.message);
    }
  }
  const closeForegroundController = () => {
    if (state.prewarming || !state.windowController) return;
    const controller = state.windowController;
    state.windowController = null;
    void controller.close().catch(error => {
      console.warn(`[Horizon] Could not stop the terminal window controller for ${instance.name}:`, error.message);
    });
  };
  horizonProcesses.set(instance.id, child);
  if (prewarming) horizonPrewarmedProcesses.set(instance.id, state);

  const captureOutput = (stream, type) => stream?.on('data', chunk => {
    const text = chunk.toString('utf8');
    if (type === 'warn') stderrTail = `${stderrTail}${text}`.slice(-16_384);
    text.split(/\r?\n/).forEach(line => emitLog(instance.name, type, line, `horizon:${instance.id}`));
  });
  captureOutput(child.stdout, 'normal');
  captureOutput(child.stderr, 'warn');

  child.once('error', error => {
    if (state.audioMuteTimer) clearInterval(state.audioMuteTimer);
    state.audioMuteTimer = null;
    if (state.resourceLimitTimer) clearInterval(state.resourceLimitTimer);
    state.resourceLimitTimer = null;
    closeForegroundController();
    if (horizonProcesses.get(instance.id) === child) horizonProcesses.delete(instance.id);
    if (horizonPrewarmedProcesses.get(instance.id) === state) horizonPrewarmedProcesses.delete(instance.id);
    if (!state.ready) state.resolveReadiness?.({ ok: false, error });
    if (state.prewarming) {
      console.warn(`[Horizon] Background warm-up failed for ${instance.name}:`, error.message);
      void state.windowController?.close().catch(closeError => {
        console.warn(`[Horizon] Could not stop the window controller for ${instance.name}:`, closeError.message);
      });
    } else {
      sendHorizonProcessState({
        instanceId: instance.id,
        instanceName: instance.name,
        running: false,
        error: `Could not launch Horizon: ${error.message}`,
      });
    }
  });
  child.once('close', code => {
    if (state.audioMuteTimer) clearInterval(state.audioMuteTimer);
    state.audioMuteTimer = null;
    if (state.resourceLimitTimer) clearInterval(state.resourceLimitTimer);
    state.resourceLimitTimer = null;
    closeForegroundController();
    if (horizonProcesses.get(instance.id) === child) horizonProcesses.delete(instance.id);
    if (horizonPrewarmedProcesses.get(instance.id) === state) horizonPrewarmedProcesses.delete(instance.id);
    if (!state.ready) {
      state.resolveReadiness?.({
        ok: false,
        error: stderrTail.trim() || `Horizon exited before its warm-up completed (code ${code}).`,
      });
    }
    if (state.prewarming) void state.windowController?.close().catch(error => {
      console.warn(`[Horizon] Could not stop the window controller for ${instance.name}:`, error.message);
    });
    if (state.prewarming && code !== 0) {
      console.warn(`[Horizon] Background warm-up exited for ${instance.name}:`, stderrTail.trim() || `exit code ${code}`);
    }
    sendHorizonProcessState({
      instanceId: instance.id,
      instanceName: instance.name,
      running: false,
      ...(code === 0 || state.prewarming ? {} : { error: stderrTail.trim() || `Horizon exited with code ${code}.` }),
    });
    if (state.activated
      && launcherState.settings?.horizonPrewarmByInstance?.[instance.id] === true
      && !horizonPrewarmShutdownRequested) {
      console.info(`[Horizon] Game closed for ${instance.name}; starting a fresh background warm-up.`);
      setTimeout(() => {
        if (!horizonPrewarmShutdownRequested) void prewarmSelectedHorizonInstance(instance.id);
      }, 500);
    }
  });

  const spawned = new Promise((resolve, reject) => {
    child.once('spawn', resolve);
    child.once('error', reject);
  });
  state.spawned = spawned;
  return { child, state, spawned };
}

function acquireHorizonPrewarmCover() {
  if (!mainWindow || mainWindow.isDestroyed() || !mainWindow.isVisible() || mainWindow.isMinimized()) {
    return () => {};
  }
  if (horizonPrewarmCoverCount === 0) {
    mainWindow.setAlwaysOnTop(true);
  }
  horizonPrewarmCoverCount++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    horizonPrewarmCoverCount = Math.max(0, horizonPrewarmCoverCount - 1);
    if (horizonPrewarmCoverCount === 0 && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setAlwaysOnTop(false);
    }
  };
}

function blurLauncherWindowForGame() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setAlwaysOnTop(false);
    mainWindow.blur();
  }
}

function activateMinecraftWindow(pid, profileName) {
  if (!Number.isSafeInteger(pid)) return;
  void (async () => {
    let windowController;
    try {
      windowController = createHorizonWindowController();
      await windowController.ready;
      const restored = await windowController.control(pid, 'restore-process', {
        timeoutMs: 30_000,
        waitForWindow: true,
      });
      if (!restored.windows) {
        console.warn(`[Minecraft] Could not find a game window to bring forward for ${profileName}.`);
        return;
      }
      blurLauncherWindowForGame();
    } catch (error) {
      console.warn(`[Minecraft] Could not bring the game window forward for ${profileName}:`, error.message);
    } finally {
      await windowController?.close().catch(error => {
        console.warn(`[Minecraft] Could not stop the game-window controller for ${profileName}:`, error.message);
      });
    }
  })();
}

function requestJavaProfilePrewarm(profileId) {
  if (!mainWindow || mainWindow.isDestroyed() || !profileId) return;
  mainWindow.webContents.send('launcher:prewarm-profile', { profileId });
}

async function stopJavaPrewarmedProfile(profileId) {
  const state = javaPrewarmedProcesses.get(String(profileId || ''));
  if (!state || !state.prewarming || state.child.killed || state.child.exitCode !== null) return { ok: true, stopped: false };
  state.session.stopRequested = true;
  try {
    if (Number.isSafeInteger(state.child.pid)) {
      await state.windowController.control(state.child.pid, 'close-process', {
        timeoutMs: 8_000,
        waitForWindow: false,
      });
    }
    const exited = await new Promise(resolve => {
      if (state.child.exitCode !== null) return resolve(true);
      const timer = setTimeout(() => resolve(false), 8_000);
      state.child.once('close', () => {
        clearTimeout(timer);
        resolve(true);
      });
    });
    if (!exited && !state.child.killed && state.child.exitCode === null) {
      state.child.kill();
      await new Promise(resolve => {
        if (state.child.exitCode !== null) return resolve();
        const timer = setTimeout(resolve, 2_000);
        state.child.once('close', () => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
    return { ok: true, stopped: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    if (javaPrewarmedProcesses.get(state.profile.id) === state) javaPrewarmedProcesses.delete(state.profile.id);
    state.releaseWindowCover?.();
    await state.windowController?.close().catch(error => {
      console.warn(`[Prewarm] Could not stop Java window controller for ${state.profile.name}:`, error.message);
    });
  }
}

async function stopJavaPrewarmedProfiles() {
  for (const profileId of [...javaPrewarmedProcesses.keys()]) {
    const result = await stopJavaPrewarmedProfile(profileId);
    if (!result.ok) console.warn(`[Prewarm] Could not stop Java profile ${profileId}:`, result.error);
  }
}

function getPrewarmMemoryHeadroomGb(profileMemoryMax = 4) {
  const freeGb = os.freemem() / 1073741824;
  const requestedGb = Number(profileMemoryMax);
  const requiredGb = Number.isFinite(requestedGb) ? Math.min(8, Math.max(4, requestedGb)) : 4;
  return {
    allowed: freeGb >= requiredGb,
    freeGb,
    requiredGb,
  };
}

async function prewarmHorizonInstance(instance, executablePath, roots, startedAt) {
  const existing = horizonProcesses.get(instance.id);
  if (existing && !existing.killed && existing.exitCode === null) return false;

  let windowController;
  let releaseWindowCover = () => {};
  let child;
  let state;
  try {
    windowController = createHorizonWindowController();
    await windowController.ready;
    if (horizonPrewarmShutdownRequested) {
      await windowController.close();
      return false;
    }
    await windowController.control(0, 'hide-prewarm', { waitForWindow: false });
    releaseWindowCover = acquireHorizonPrewarmCover();
    const client = startHorizonClient(instance, executablePath, roots, { prewarming: true });
    ({ child, state } = client);
    state.windowController = windowController;
    const { spawned } = client;
    await spawned;
    const windowDeadline = Date.now() + 30_000;
    let result = { windows: 0 };
    let audioErrorReported = false;
    while (Date.now() < windowDeadline && !result.windows) {
      result = await windowController.control(child.pid, 'hide-prewarm', {
        timeoutMs: 2_000,
        waitForWindow: false,
      });
      await limitHorizonPrewarmResources(state);
      try {
        await windowController.control(child.pid, 'mute-process-audio', {
          timeoutMs: 2_000,
          waitForWindow: false,
        });
      } catch (audioError) {
        if (!audioErrorReported) {
          audioErrorReported = true;
          console.warn(`[Horizon] Could not mute background audio for ${instance.name}:`, audioError.message);
        }
      }
      if (!result.windows && child.exitCode === null) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
    if (!result.windows) throw new Error('Horizon did not create a game window to prewarm.');
    if (child.exitCode !== null) throw new Error('Horizon exited before its warm-up completed.');
    state.audioMuteTimer = setInterval(() => {
      void muteHorizonPrewarmAudio(state).catch(error => {
        if (state.audioMuteErrorReported) return;
        state.audioMuteErrorReported = true;
        console.warn(`[Horizon] Could not keep background audio muted for ${instance.name}:`, error.message);
      });
    }, 500);
    state.resourceLimitTimer = setInterval(() => {
      void limitHorizonPrewarmResources(state);
    }, 1_000);
    releaseWindowCover();
    state.ready = true;
    state.resolveReadiness?.({ ok: true });
    sendHorizonProcessState({
      instanceId: instance.id,
      instanceName: instance.name,
      prewarmed: true,
      pid: child.pid,
    });
    emitStatus(`Prewarm complete: Horizon profile ${instance.name} is ready.`);
    console.info(`[Horizon] Background warm-up is ready for ${instance.name} in ${Date.now() - startedAt} ms.`);
    return true;
  } catch (error) {
    if (state) {
      await restoreHorizonPrewarmResources(state);
      await restoreHorizonPrewarmAudio(state);
      state.ready = true;
      state.resolveReadiness?.({ ok: false, error });
      if (horizonPrewarmedProcesses.get(instance.id) === state) horizonPrewarmedProcesses.delete(instance.id);
      state.prewarming = false;
    }
    if (child && Number.isSafeInteger(child.pid) && child.exitCode === null && windowController) {
      try {
        const closeResult = await windowController.control(child.pid, 'close');
        if (!closeResult.windows) {
          sendHorizonProcessState({
            instanceId: instance.id,
            instanceName: instance.name,
            pid: child.pid,
            running: true,
          });
        }
      } catch (closeError) {
        console.warn(`[Horizon] Could not close an incomplete warm-up for ${instance.name}:`, closeError.message);
        sendHorizonProcessState({
          instanceId: instance.id,
          instanceName: instance.name,
          pid: child.pid,
          running: true,
        });
      }
    }
    if (windowController) {
      try {
        await windowController.close();
      } catch (closeError) {
        console.warn(`[Horizon] Could not stop the window controller for ${instance.name}:`, closeError.message);
      }
    }
    releaseWindowCover();
    throw error;
  }
}

async function muteHorizonPrewarmAudio(state) {
  if (state.audioMuteInFlight || !Number.isSafeInteger(state.child.pid)
    || state.child.killed || state.child.exitCode !== null) return;
  state.audioMuteInFlight = true;
  try {
    const result = await state.windowController.control(state.child.pid, 'mute-process-audio', {
      timeoutMs: 4_000,
      waitForWindow: false,
    });
    if (result.windows > 0 && !state.audioMutedLogWritten) {
      state.audioMutedLogWritten = true;
      console.info(`[Horizon] Background audio muted for ${state.instance.name}.`);
    }
  } finally {
    state.audioMuteInFlight = false;
  }
}

async function limitHorizonPrewarmResources(state) {
  if (state.resourceLimitInFlight || !Number.isSafeInteger(state.child.pid)
    || state.child.killed || state.child.exitCode !== null) return;
  state.resourceLimitInFlight = true;
  try {
    await state.windowController.control(state.child.pid, 'limit-process-tree', {
      timeoutMs: 4_000,
      waitForWindow: false,
    });
  } catch (error) {
    if (state.resourceLimitErrorReported) return;
    state.resourceLimitErrorReported = true;
    console.warn(`[Horizon] Could not cap background CPU use for ${state.instance.name}:`, error.message);
  } finally {
    state.resourceLimitInFlight = false;
  }
}

async function restoreHorizonPrewarmResources(state) {
  if (state.resourceLimitTimer) clearInterval(state.resourceLimitTimer);
  state.resourceLimitTimer = null;
  if (!Number.isSafeInteger(state.child.pid) || state.child.exitCode !== null) return;
  try {
    await state.windowController.control(state.child.pid, 'restore-process-limits', {
      timeoutMs: 4_000,
      waitForWindow: false,
    });
  } catch (error) {
    console.warn(`[Horizon] Could not restore normal CPU use for ${state.instance.name}:`, error.message);
  }
}

async function restoreHorizonPrewarmAudio(state) {
  if (state.audioMuteTimer) clearInterval(state.audioMuteTimer);
  state.audioMuteTimer = null;
  if (!Number.isSafeInteger(state.child.pid) || state.child.exitCode !== null) return;
  try {
    await state.windowController.control(state.child.pid, 'restore-process-audio', {
      timeoutMs: 4_000,
      waitForWindow: false,
    });
  } catch (error) {
    console.warn(`[Horizon] Could not restore audio for ${state.instance.name}:`, error.message);
  }
}

async function ensureHorizonBuildPrepared(buildTag, prepared, accountResult, reportStatus = () => {}) {
  if (prepared) return { ok: true };
  reportStatus(`Preparing Minecraft resources with Horizon build ${buildTag}…`);
  try {
    await runHorizonCli(buildHorizonPrepareArgs(buildTag), { timeoutMs: 10 * 60 * 1000 });
    if (!(await isHorizonBuildPrepared(buildTag))) {
      throw new Error('Horizon preparation returned successfully but did not produce complete Minecraft resources.');
    }
    return { ok: true };
  } catch (localPrepareError) {
    if (accountResult?.error) {
      return {
        ok: false,
        code: 'HORIZON_SIGN_IN_REQUIRED',
        error: 'Horizon could not prepare Minecraft from a local installation. Sign in to an account that owns Minecraft, then try again.',
      };
    }
    const accountRequirement = getHorizonAccountRequirement(accountResult?.accounts);
    if (accountRequirement) return { ok: false, ...accountRequirement };
    reportStatus('Downloading Minecraft resources from Mojang…');
    try {
      await runHorizonCli(buildHorizonPrepareArgs(buildTag, { download: true }), { timeoutMs: 10 * 60 * 1000 });
    } catch (downloadError) {
      throw new Error(`Horizon could not prepare Minecraft. Local preparation failed: ${localPrepareError.message} Mojang download failed: ${downloadError.message}`);
    }
    if (!(await isHorizonBuildPrepared(buildTag))) {
      throw new Error('Horizon preparation completed but its Minecraft resources are still incomplete. Check Horizon’s preparation output and try again.');
    }
    return { ok: true };
  }
}

function prewarmSelectedHorizonInstance(instanceIdOverride) {
  if (process.platform !== 'win32' || horizonPrewarmShutdownRequested) return Promise.resolve();
  const instanceId = String(instanceIdOverride || launcherState.settings?.horizonInstanceId || '').trim();
  if (launcherState.settings?.horizonPrewarmByInstance?.[instanceId] !== true) return Promise.resolve();
  if (!instanceId || !String(launcherState.settings?.horizonLauncherPath || '').trim()) return Promise.resolve();
  const existingTask = horizonPrewarmTasks.get(instanceId);
  if (existingTask) return existingTask;

  const task = (async () => {
    const startedAt = Date.now();
    try {
      const headroom = getPrewarmMemoryHeadroomGb();
      if (!headroom.allowed) {
        console.info(`[Horizon] Background warm-up skipped for ${instanceId}: ${headroom.freeGb.toFixed(1)} GB free; ${headroom.requiredGb.toFixed(1)} GB required.`);
        return;
      }
      const executablePath = getConfiguredHorizonLauncher();
      const roots = prepareHorizonHomes();
      const [instance, buildsResult, accountResult] = await Promise.all([
        resolveHorizonInstance(instanceId),
        runHorizonCli(['versions', '--installed']),
        runHorizonCli(['account', 'list']),
      ]);
      const buildTag = getSelectedHorizonBuild(horizonCommandResult(buildsResult));
      const accountRequirement = getHorizonAccountRequirement(horizonCommandResult(accountResult));
      if (accountRequirement) {
        console.info(`[Horizon] Background warm-up skipped: ${accountRequirement.message}`);
        return;
      }
      const prepared = await isHorizonBuildPrepared(buildTag);
      const preparation = await ensureHorizonBuildPrepared(
        buildTag,
        prepared,
        { accounts: horizonCommandResult(accountResult) },
        message => console.info(`[Horizon] ${message}`),
      );
      if (!preparation.ok) {
        console.info(`[Horizon] Background warm-up skipped: ${preparation.error}`);
        return;
      }
      if (launcherState.settings?.horizonPrewarmByInstance?.[instance.id] !== true) return;
      if (horizonPrewarmShutdownRequested) return;
      await prewarmHorizonInstance(instance, executablePath, roots, startedAt);
    } catch (error) {
      console.warn('[Horizon] Background warm-up skipped:', error instanceof Error ? error.message : String(error));
    }
  })();
  horizonPrewarmTasks.set(instanceId, task);
  void task.finally(() => {
    if (horizonPrewarmTasks.get(instanceId) === task) horizonPrewarmTasks.delete(instanceId);
  });
  return task;
}

async function prewarmEnabledHorizonInstances() {
  if (process.platform !== 'win32' || horizonPrewarmShutdownRequested) return;
  const instanceSettings = launcherState.settings?.horizonPrewarmByInstance || {};
  const hasEnabledProfile = Object.values(instanceSettings).some(enabled => enabled === true);
  if (!hasEnabledProfile) return;
  const installation = await ensureHorizonLauncherInstalled();
  if (!installation.ok) throw new Error(installation.error);
  const instances = await getHorizonInstances();
  for (const instance of instances) {
    if (instance.java) continue;
    if (launcherState.settings?.horizonPrewarmByInstance?.[instance.id] !== true) continue;
    const headroom = getPrewarmMemoryHeadroomGb();
    if (!headroom.allowed) {
      console.info(`[Horizon] Remaining profile warm-ups skipped: ${headroom.freeGb.toFixed(1)} GB free; ${headroom.requiredGb.toFixed(1)} GB required.`);
      break;
    }
    await prewarmSelectedHorizonInstance(instance.id);
  }
}

async function stopHorizonPrewarmedProcesses(instanceIdFilter = null) {
  for (const [instanceId, state] of [...horizonPrewarmedProcesses.entries()]) {
    if (instanceIdFilter && instanceId !== String(instanceIdFilter)) continue;
    const { child, instance } = state;
    if (child.killed || child.exitCode !== null) continue;
    try {
      if (!Number.isSafeInteger(child.pid)) {
        const spawned = await Promise.race([
          state.spawned.then(() => true, () => false),
          new Promise(resolve => setTimeout(() => resolve(false), 5_000)),
        ]);
        if (!spawned || child.exitCode !== null) continue;
      }
      const closeResult = await state.windowController.control(child.pid, 'close', {
        timeoutMs: 8_000,
        waitForWindow: true,
      });
      if (!closeResult.windows) {
        console.warn(`[Horizon] Could not find a game window to close for prewarmed profile ${instance.name}.`);
        continue;
      }
      if (child.exitCode !== null) continue;
      const exited = await new Promise(resolve => {
        const timer = setTimeout(() => {
          child.removeListener('close', onClose);
          resolve(false);
        }, 5_000);
        const onClose = () => {
          clearTimeout(timer);
          resolve(true);
        };
        child.once('close', onClose);
      });
      if (!exited) console.warn(`[Horizon] Prewarmed profile ${instance.name} did not exit after a graceful close request.`);
    } catch (error) {
      console.warn(`[Horizon] Could not close prewarmed profile ${instance.name}:`, error.message);
    } finally {
      await restoreHorizonPrewarmAudio(state);
      try {
        await state.windowController?.close();
      } catch (error) {
        console.warn(`[Horizon] Could not stop the window controller for ${instance.name}:`, error.message);
      }
      if (horizonPrewarmedProcesses.get(instanceId) === state) horizonPrewarmedProcesses.delete(instanceId);
    }
  }
}

async function ensureHorizonLauncherInstalled() {
  try {
    prepareHorizonHomes();
    try {
      const executablePath = getConfiguredHorizonLauncher();
      return { ok: true, executablePath, alreadyInstalled: true };
    } catch (error) {
      if (launcherState.settings?.horizonLauncherPath) {
        console.warn('[Horizon] Saved launcher path is unavailable; installing the official launcher:', error.message);
      }
    }

    if (process.platform !== 'win32') {
      throw new Error('Automatic Horizon installation is currently supported on Windows only.');
    }
    sendHorizonSetupProgress({ phase: 'metadata', message: 'Finding the latest official Horizon Launcher…' });
    const releaseResponse = await axios.get(HORIZON_RELEASES_API, {
      timeout: 30_000,
      maxContentLength: 8 * 1024 * 1024,
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Bald-Launcher' },
    });
    const selected = selectHorizonLauncherAsset(releaseResponse.data, process.arch);
    sendHorizonSetupProgress({
      phase: 'download',
      message: `Downloading Horizon Launcher ${selected.version} from its official GitHub release…`,
      percent: 0,
      total: selected.asset.size,
    });
    const downloadResponse = await axios.get(selected.asset.browser_download_url, {
      timeout: 5 * 60_000,
      maxContentLength: selected.asset.size,
      maxBodyLength: selected.asset.size,
      responseType: 'arraybuffer',
      headers: { Accept: 'application/octet-stream', 'User-Agent': 'Bald-Launcher' },
      onDownloadProgress: progress => {
        const loaded = Math.max(0, Number(progress.loaded) || 0);
        sendHorizonSetupProgress({
          phase: 'download',
          message: `Downloading Horizon Launcher ${selected.version}…`,
          loaded,
          total: selected.asset.size,
          percent: Math.min(100, Math.floor(loaded / selected.asset.size * 100)),
        });
      },
    });
    const archive = Buffer.from(downloadResponse.data);
    if (archive.length !== selected.asset.size) {
      throw new Error(`Horizon Launcher download size mismatch (expected ${selected.asset.size} bytes, got ${archive.length}).`);
    }
    sendHorizonSetupProgress({ phase: 'verify', message: 'Verifying the Horizon Launcher archive…', percent: 100 });
    const roots = getHorizonPaths(app.getPath('userData'));
    const installRoot = path.join(roots.root, 'launcher-apps');
    sendHorizonSetupProgress({ phase: 'install', message: 'Installing Horizon Launcher into its isolated app folder…' });
    const installed = installHorizonLauncherArchive({
      archive,
      digest: selected.digest,
      version: selected.version,
      installRoot,
    });
    launcherState.settings = normalizeSettings({
      ...launcherState.settings,
      horizonLauncherPath: installed.executablePath,
      horizonInstanceId: launcherState.settings?.horizonInstanceId || '',
    });
    scheduleStateWrite();
    sendHorizonSetupProgress({ phase: 'ready', message: `Horizon Launcher ${installed.version} is ready.`, percent: 100 });
    return { ok: true, executablePath: installed.executablePath, version: installed.version };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sendHorizonSetupProgress({ phase: 'error', message, error: true });
    return { ok: false, error: message };
  }
}

ipcMain.handle('horizon:ensure-installed', ensureHorizonLauncherInstalled);

async function getHorizonInstances() {
  const result = await runHorizonCli(['instance', 'list']);
  const instances = parseHorizonJson(result.stdout);
  if (!Array.isArray(instances)) throw new Error('Horizon returned an invalid instance list.');
  return instances.filter(instance => (
    instance
    && typeof instance.id === 'string'
    && typeof instance.name === 'string'
    && typeof instance.home === 'string'
  ));
}

async function resolveHorizonInstance(instanceKey) {
  const key = validateInstanceName(instanceKey);
  const instances = await getHorizonInstances();
  const instance = instances.find(item => item.id === key || item.name === key);
  if (!instance) throw new Error(`Horizon instance "${key}" was not found. Refresh the Rust mode instance list.`);
  if (instance.java) throw new Error('This is a Java Edition instance, not a Horizon Rust instance.');
  return instance;
}

function publicHorizonInstance(instance) {
  return {
    id: instance.id,
    name: instance.name,
    kind: instance.kind,
    isJava: Boolean(instance.java),
    selected: instance.selected === true,
    version: instance.version || null,
    playedSecs: Number(instance.played_secs) || 0,
    lastPlayedAt: instance.last_played_at || instance.lastPlayedAt || null,
    home: instance.home,
  };
}

function horizonCommandResult(result) {
  return parseHorizonJson(result.stdout);
}

async function syncHorizonBaldAccount(accountId) {
  const baldAccount = launcherState.accounts.find(account => account.id === accountId);
  if (baldAccount?.type !== 'Microsoft' || !baldAccount.uuid) {
    return {
      accountId: baldAccount?.id || '',
      accountName: baldAccount?.name || '',
      accountConnected: false,
      accountMessage: 'Select a linked Microsoft account in Bald Launcher to connect it to Horizon.',
      accountError: '',
      horizonAccounts: [],
    };
  }

  let horizonAccounts = [];
  try {
    horizonAccounts = publicHorizonAccounts(horizonCommandResult(await runHorizonCli(['account', 'list'])));
  } catch (error) {
    return {
      accountId: baldAccount.id,
      accountName: baldAccount.name,
      accountConnected: false,
      accountMessage: `Sign in to Horizon once with ${baldAccount.name}; Bald Launcher will match the Minecraft UUID afterward.`,
      accountError: error instanceof Error ? error.message : String(error),
      horizonAccounts,
    };
  }

  const matchingAccount = findMatchingHorizonAccount(horizonAccounts, baldAccount.uuid);
  if (!matchingAccount) {
    return {
      accountId: baldAccount.id,
      accountName: baldAccount.name,
      accountConnected: false,
      accountMessage: `Horizon has no signed-in account matching ${baldAccount.name}. Sign in to Horizon once with that Microsoft account; its Minecraft UUID will be matched automatically.`,
      accountError: '',
      horizonAccounts,
    };
  }

  try {
    if (!matchingAccount.selected) {
      await runHorizonCli(['account', 'select', matchingAccount.uuid]);
    }
    if (launcherState.settings?.horizonAccountId !== baldAccount.id) {
      launcherState.settings = normalizeSettings({
        ...launcherState.settings,
        horizonAccountId: baldAccount.id,
      });
      scheduleStateWrite();
    }
    return {
      accountId: baldAccount.id,
      accountName: baldAccount.name,
      accountConnected: true,
      accountMessage: `${baldAccount.name} is connected to Horizon.`,
      accountError: '',
      horizonAccounts,
    };
  } catch (error) {
    return {
      accountId: baldAccount.id,
      accountName: baldAccount.name,
      accountConnected: false,
      accountMessage: `Horizon found ${baldAccount.name}, but could not select that account.`,
      accountError: error instanceof Error ? error.message : String(error),
      horizonAccounts,
    };
  }
}

ipcMain.handle('horizon:get-status', async (_event, payload = {}) => {
  const roots = getHorizonPaths(app.getPath('userData'));
  const configuredPath = String(launcherState.settings?.horizonLauncherPath || '').trim();
  const requestedAccountId = String(payload?.accountId || '').trim().slice(0, 160);
  const baldAccountId = requestedAccountId
    || launcherState.settings?.horizonAccountId
    || launcherState.activeAccountId
    || '';
  const baldAccount = launcherState.accounts.find(account => account.id === baldAccountId);
  if (!configuredPath) {
    return {
      ok: true,
      configured: false,
      downloadUrl: HORIZON_DOWNLOAD_URL,
      gameHome: roots.gameHome,
      launcherHome: roots.launcherHome,
      selectedInstanceId: launcherState.settings?.horizonInstanceId || '',
      accountId: baldAccount?.id || '',
      accountName: baldAccount?.name || '',
      accountMessage: baldAccount?.type === 'Microsoft'
        ? `Sign in to Horizon once with ${baldAccount.name}; Bald Launcher will match and select it afterward.`
        : 'Select a linked Microsoft account to connect it to Horizon.',
    };
  }
  try {
    const executablePath = getConfiguredHorizonLauncher();
    let instances = [];
    let statusError = '';
    try {
      instances = await getHorizonInstances();
    } catch (error) {
      statusError = error instanceof Error ? error.message : String(error);
    }
    const accountSync = await syncHorizonBaldAccount(baldAccount?.id || '');
    return {
      ok: true,
      configured: true,
      executablePath,
      downloadUrl: HORIZON_DOWNLOAD_URL,
      gameHome: roots.gameHome,
      launcherHome: roots.launcherHome,
      selectedInstanceId: launcherState.settings?.horizonInstanceId || '',
      instances: instances.map(publicHorizonInstance),
      statusError,
      ...accountSync,
      runningInstanceIds: [...horizonProcesses.entries()]
        .filter(([instanceId, child]) => (
          !child.killed
          && child.exitCode === null
          && !horizonPrewarmedProcesses.has(instanceId)
        ))
        .map(([instanceId]) => instanceId),
      prewarmedInstanceIds: [...horizonPrewarmedProcesses.entries()]
        .filter(([, state]) => state.ready && !state.child.killed && state.child.exitCode === null)
        .map(([instanceId]) => instanceId),
    };
  } catch (error) {
    return { ok: false, configured: true, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle('horizon:sync-account', async (_event, payload = {}) => ({
  ok: true,
  ...await syncHorizonBaldAccount(String(payload?.accountId || '').trim().slice(0, 160)),
}));

ipcMain.handle('horizon:open-download', async () => {
  await shell.openExternal(HORIZON_DOWNLOAD_URL);
  return { ok: true };
});

ipcMain.handle('horizon:choose-launcher', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select the Horizon Launcher executable',
    properties: ['openFile'],
    filters: [{ name: 'Horizon Launcher', extensions: ['exe'] }],
  });
  if (result.canceled || !result.filePaths[0]) return { ok: false, canceled: true };
  try {
    const executablePath = normalizeHorizonLauncherPath(result.filePaths[0]);
    const stat = fs.lstatSync(executablePath);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Select a regular Horizon Launcher executable.');
    const version = await runHorizonCommand({
      executablePath,
      userDataPath: app.getPath('userData'),
      args: ['--version'],
      json: false,
      timeoutMs: 15_000,
    });
    const versionText = `${version.stdout}\n${version.stderr}`;
    if (!/horizon[- ]launcher/i.test(versionText)) {
      throw new Error('The selected executable did not identify itself as Horizon Launcher.');
    }
    launcherState.settings = normalizeSettings({
      ...launcherState.settings,
      horizonLauncherPath: executablePath,
      horizonInstanceId: launcherState.settings?.horizonInstanceId || '',
    });
    scheduleStateWrite();
    return { ok: true, executablePath };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle('horizon:open-setup', async () => {
  try {
    const executablePath = getConfiguredHorizonLauncher();
    const roots = prepareHorizonHomes();
    const child = spawn(executablePath, [], {
      env: {
        ...process.env,
        HORIZON_LAUNCHER_HOME: roots.launcherHome,
        HORIZON_HOME: roots.gameHome,
      },
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    });
    await new Promise((resolve, reject) => {
      child.once('spawn', resolve);
      child.once('error', reject);
    });
    child.unref();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle('horizon:list-instances', async () => {
  try {
    return { ok: true, instances: (await getHorizonInstances()).map(publicHorizonInstance) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle('horizon:create-instance', async (_event, payload) => {
  try {
    const name = validateInstanceName(payload?.name);
    await runHorizonCli(['instance', 'create', name]);
    const instances = await getHorizonInstances();
    const created = instances.find(instance => instance.name === name);
    if (!created) throw new Error(`Horizon did not return the new instance "${name}".`);
    launcherState.settings = normalizeSettings({
      ...launcherState.settings,
      horizonInstanceId: created.id,
    });
    scheduleStateWrite();
    void prewarmSelectedHorizonInstance(created.id);
    return { ok: true, instance: publicHorizonInstance(created) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle('horizon:rename-instance', async (_event, payload) => {
  try {
    const instance = await resolveHorizonInstance(payload?.instanceId);
    const name = validateInstanceName(payload?.name);
    await runHorizonCli(['instance', 'rename', instance.id, name]);
    const instances = await getHorizonInstances();
    const renamed = instances.find(item => item.id === instance.id);
    if (!renamed) throw new Error('Horizon did not return the renamed profile.');
    return { ok: true, instance: publicHorizonInstance(renamed) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle('horizon:delete-instance', async (_event, payload) => {
  try {
    const instance = await resolveHorizonInstance(payload?.instanceId);
    if (horizonProcesses.has(instance.id)) {
      throw new Error('Stop this Horizon profile before deleting it.');
    }
    await runHorizonCli(['instance', 'delete', instance.id]);
    if (launcherState.settings?.horizonInstanceId === instance.id) {
      launcherState.settings = normalizeSettings({ ...launcherState.settings, horizonInstanceId: '' });
      scheduleStateWrite();
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle('horizon:set-instance', async (_event, payload) => {
  try {
    const instance = await resolveHorizonInstance(payload?.instanceId);
    launcherState.settings = normalizeSettings({
      ...launcherState.settings,
      horizonInstanceId: instance.id,
    });
    scheduleStateWrite();
    return { ok: true, instance: publicHorizonInstance(instance) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle('horizon:set-prewarm', async (_event, payload = {}) => {
  try {
    const instance = await resolveHorizonInstance(payload?.instanceId);
    const enabled = payload?.enabled === true;
    const settings = normalizeSettings(launcherState.settings);
    settings.horizonPrewarmByInstance = {
      ...settings.horizonPrewarmByInstance,
      [instance.id]: enabled,
    };
    launcherState.settings = settings;
    scheduleStateWrite();
    if (enabled) {
      const headroom = getPrewarmMemoryHeadroomGb();
      if (!headroom.allowed) {
        return {
          ok: true,
          skipped: true,
          state: launcherState,
          error: `Prewarm needs about ${headroom.requiredGb.toFixed(1)} GB free RAM; ${headroom.freeGb.toFixed(1)} GB is free.`,
        };
      }
      await prewarmSelectedHorizonInstance(instance.id);
    } else {
      await stopHorizonPrewarmedProcesses(instance.id);
    }
    return { ok: true, state: launcherState };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error), state: launcherState };
  }
});

ipcMain.handle('horizon:prewarm-enabled', async () => {
  try {
    await prewarmEnabledHorizonInstances();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle('horizon:launch', async (_event, payload) => {
  try {
    const instanceId = payload?.instanceId || launcherState.settings?.horizonInstanceId;
    const instanceKey = String(instanceId || '');
    const prewarmTask = horizonPrewarmTasks.get(instanceKey);
    if (prewarmTask) await prewarmTask;
    const warmState = horizonPrewarmedProcesses.get(instanceKey);
    if (warmState) {
      const readiness = await warmState.readiness;
      if (readiness.ok && !warmState.child.killed && warmState.child.exitCode === null) {
        const activationStartedAt = Date.now();
        await restoreHorizonPrewarmResources(warmState);
        const restored = await warmState.windowController.control(warmState.child.pid, 'restore');
        if (!restored.windows) throw new Error('The prewarmed Horizon window could not be restored.');
        blurLauncherWindowForGame();
        try {
          os.setPriority(warmState.child.pid, os.constants.priority.PRIORITY_NORMAL);
        } catch (error) {
          console.warn(`[Horizon] Could not restore normal process priority for ${warmState.instance.name}:`, error.message);
        }
        await warmState.windowController.control(warmState.child.pid, 'hide-terminal', { waitForWindow: false });
        await restoreHorizonPrewarmAudio(warmState);
        horizonPrewarmedProcesses.delete(instanceKey);
        warmState.prewarming = false;
        warmState.activated = true;
        console.info(`[Horizon] Prewarmed title window restored in ${Date.now() - activationStartedAt} ms.`);
        sendHorizonProcessState({
          instanceId: warmState.instance.id,
          instanceName: warmState.instance.name,
          pid: warmState.child.pid,
          running: true,
        });
        return {
          ok: true,
          instance: publicHorizonInstance(warmState.instance),
          pid: warmState.child.pid,
          prewarmed: true,
        };
      }
      if (!warmState.child.killed && warmState.child.exitCode === null) {
        throw new Error(readiness.error?.message || 'The Horizon warm-up did not complete successfully.');
      }
    }
    const [instance, buildsResult] = await Promise.all([
      resolveHorizonInstance(instanceId),
      runHorizonCli(['versions', '--installed']),
    ]);
    const existing = horizonProcesses.get(instance.id);
    if (existing && !existing.killed && existing.exitCode === null) {
      throw new Error(`${instance.name} is already running.`);
    }
    const executablePath = getConfiguredHorizonLauncher();
    const roots = prepareHorizonHomes();
    const sendPreparingStatus = message => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('horizon:process-state', {
        instanceId: instance.id,
        instanceName: instance.name,
        preparing: true,
        message,
      });
    };
    const horizonBuild = getSelectedHorizonBuild(horizonCommandResult(buildsResult));
    const [prepared, accountResult] = await Promise.all([
      isHorizonBuildPrepared(horizonBuild),
      runHorizonCli(['account', 'list'])
        .then(result => ({ accounts: horizonCommandResult(result) }))
        .catch(error => ({ error })),
    ]);
    const preparation = await ensureHorizonBuildPrepared(horizonBuild, prepared, accountResult, sendPreparingStatus);
    if (!preparation.ok) return preparation;
    if (accountResult.error) {
      return {
        ok: false,
        code: 'HORIZON_SIGN_IN_REQUIRED',
        error: 'Sign in to a Microsoft account that owns Minecraft: Java Edition in Horizon before playing this profile.',
      };
    }
    const accountRequirement = getHorizonAccountRequirement(accountResult.accounts);
    if (accountRequirement) return { ok: false, ...accountRequirement };
    let windowController;
    try {
      windowController = createHorizonWindowController();
      await windowController.ready;
      await windowController.control(0, 'hide-terminal', { waitForWindow: false });
    } catch (error) {
      console.warn('[Horizon] Could not start the hidden-terminal controller:', error.message);
      await windowController?.close().catch(closeError => {
        console.warn('[Horizon] Could not stop the terminal window controller:', closeError.message);
      });
      windowController = undefined;
    }
    const { child, state, spawned } = startHorizonClient(instance, executablePath, roots);
    state.windowController = windowController;
    await spawned;
    if (windowController) {
      try {
        await windowController.control(child.pid, 'hide-terminal', { waitForWindow: false });
      } catch (error) {
        console.warn('[Horizon] Could not hide the Horizon terminal window:', error.message);
        state.windowController = null;
        await windowController.close().catch(closeError => {
          console.warn('[Horizon] Could not stop the terminal window controller:', closeError.message);
        });
      }
    }
    if (windowController) {
      void windowController.control(child.pid, 'restore', {
        timeoutMs: 30_000,
        waitForWindow: true,
      }).then(restored => {
        if (restored.windows) blurLauncherWindowForGame();
        else console.warn(`[Horizon] Could not find a game window to bring forward for ${instance.name}.`);
      }).catch(error => {
        console.warn(`[Horizon] Could not bring the game window forward for ${instance.name}:`, error.message);
      });
    } else {
      activateMinecraftWindow(child.pid, instance.name);
    }
    state.activated = true;
    sendHorizonProcessState({
      instanceId: instance.id,
      instanceName: instance.name,
      pid: child.pid,
      running: true,
    });
    return { ok: true, instance: publicHorizonInstance(instance), pid: child.pid };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle('horizon:stop', async (_event, payload) => {
  try {
    const instance = await resolveHorizonInstance(payload?.instanceId || launcherState.settings?.horizonInstanceId);
    const child = horizonProcesses.get(instance.id);
    if (!child || child.killed || child.exitCode !== null) {
      throw new Error(`${instance.name} is not running.`);
    }
    const closeResult = await closeHorizonGameWindows(child.pid);
    if (!closeResult.windows) {
      throw new Error('Horizon has no open game window to close. No process was force-terminated.');
    }
    const exited = await new Promise(resolve => {
      if (child.exitCode !== null) {
        resolve(true);
        return;
      }
      const timer = setTimeout(() => {
        child.removeListener('close', onClose);
        resolve(false);
      }, 15_000);
      const onClose = () => {
        clearTimeout(timer);
        resolve(true);
      };
      child.once('close', onClose);
    });
    return { ok: true, exited, closeRequests: closeResult.windows };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle('horizon:get-logs', async (_event, payload) => {
  try {
    const instance = await resolveHorizonInstance(payload?.instanceId || launcherState.settings?.horizonInstanceId);
    const roots = prepareHorizonHomes();
    const gameRoot = fs.realpathSync(roots.gameHome);
    const instanceHome = fs.realpathSync(instance.home);
    const relativeHome = path.relative(gameRoot, instanceHome);
    if (relativeHome === '..' || relativeHome.startsWith(`..${path.sep}`) || path.isAbsolute(relativeHome)) {
      throw new Error('The Horizon profile is outside its isolated game folder.');
    }
    const logDirectory = path.join(instanceHome, 'logs');
    if (!fs.existsSync(logDirectory)) return { ok: true, text: '' };
    const directoryStat = fs.lstatSync(logDirectory);
    if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
      throw new Error('The Horizon profile logs path is not a regular directory.');
    }
    const logPath = path.join(logDirectory, 'latest.log');
    if (!fs.existsSync(logPath)) return { ok: true, text: '' };
    const logStat = fs.lstatSync(logPath);
    if (!logStat.isFile() || logStat.isSymbolicLink()) {
      throw new Error('The Horizon latest.log path is not a regular file.');
    }
    const maxBytes = 1024 * 1024;
    const start = Math.max(0, logStat.size - maxBytes);
    const buffer = Buffer.alloc(Math.min(maxBytes, logStat.size));
    const descriptor = fs.openSync(logPath, 'r');
    try {
      fs.readSync(descriptor, buffer, 0, buffer.length, start);
    } finally {
      fs.closeSync(descriptor);
    }
    return { ok: true, text: buffer.toString('utf8'), truncated: start > 0 };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle('horizon:search-mods', async (_event, payload) => {
  try {
    const instance = await resolveHorizonInstance(payload?.instanceId || launcherState.settings?.horizonInstanceId);
    const args = buildHorizonSearchArgs({
      query: payload?.query,
      kind: payload?.kind,
      source: payload?.source,
      instance: instance.id,
    });
    const results = horizonCommandResult(await runHorizonCli(args));
    if (!Array.isArray(results)) throw new Error('Horizon returned an invalid mod search result.');
    return { ok: true, results };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle('horizon:list-mods', async (_event, payload) => {
  try {
    const instance = await resolveHorizonInstance(payload?.instanceId || launcherState.settings?.horizonInstanceId);
    const [modsResult, packsResult] = await Promise.all([
      runHorizonCli(['mods', 'list', '--instance', instance.id]),
      runHorizonCli(['packs', 'list', '--instance', instance.id]),
    ]);
    const mods = horizonCommandResult(modsResult);
    const packs = horizonCommandResult(packsResult);
    if (!Array.isArray(mods) || !Array.isArray(packs)) throw new Error('Horizon returned an invalid installed-content list.');
    return {
      ok: true,
      mods,
      packs,
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle('horizon:list-worlds', async (_event, payload) => {
  try {
    const instance = await resolveHorizonInstance(payload?.instanceId || launcherState.settings?.horizonInstanceId);
    const worlds = horizonCommandResult(await runHorizonCli(['worlds', 'list', '--instance', instance.id]));
    if (!Array.isArray(worlds)) throw new Error('Horizon returned an invalid world list.');
    return { ok: true, worlds };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle('horizon:list-datapacks', async (_event, payload) => {
  try {
    const instance = await resolveHorizonInstance(payload?.instanceId || launcherState.settings?.horizonInstanceId);
    const world = validateInstanceName(payload?.world);
    const packs = horizonCommandResult(await runHorizonCli(['worlds', 'datapack-list', world, '--instance', instance.id]));
    if (!Array.isArray(packs)) throw new Error('Horizon returned an invalid data-pack list.');
    return { ok: true, packs };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle('horizon:datapack-action', async (_event, payload) => {
  try {
    const instance = await resolveHorizonInstance(payload?.instanceId || launcherState.settings?.horizonInstanceId);
    const world = validateInstanceName(payload?.world);
    const action = payload?.action;
    if (action === 'add') {
      const selected = await dialog.showOpenDialog(mainWindow, {
        title: `Add a data pack to ${world}`,
        properties: ['openFile'],
        filters: [{ name: 'Minecraft data packs', extensions: ['zip'] }],
      });
      if (selected.canceled || !selected.filePaths[0]) return { ok: false, canceled: true };
      const filePath = path.resolve(selected.filePaths[0]);
      const stat = fs.lstatSync(filePath);
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Select a regular data-pack ZIP file.');
      await runHorizonCli(['worlds', 'datapack-add', world, filePath, '--instance', instance.id]);
      return { ok: true };
    }
    if (action === 'remove') {
      const pack = validateInstanceName(payload?.pack);
      await runHorizonCli(['worlds', 'datapack-remove', world, pack, '--instance', instance.id]);
      return { ok: true };
    }
    throw new Error('Unsupported Horizon data-pack action.');
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle('horizon:import-pack', async (_event, payload) => {
  try {
    const instance = await resolveHorizonInstance(payload?.instanceId || launcherState.settings?.horizonInstanceId);
    const kind = payload?.kind === 'shader' ? 'shader' : payload?.kind === 'resource' ? 'resource' : '';
    if (!kind) throw new Error('Choose a resource pack or shader pack.');
    const selected = await dialog.showOpenDialog(mainWindow, {
      title: `Add a ${kind === 'shader' ? 'shader' : 'resource'} pack`,
      properties: ['openFile'],
      filters: [{
        name: kind === 'shader' ? 'Horizon shader packs' : 'Minecraft resource packs',
        extensions: kind === 'shader' ? ['zip', 'hshader'] : ['zip'],
      }],
    });
    if (selected.canceled || !selected.filePaths[0]) return { ok: false, canceled: true };
    const filePath = path.resolve(selected.filePaths[0]);
    const stat = fs.lstatSync(filePath);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Select a regular pack file.');
    await runHorizonCli(['packs', 'add', filePath, '--instance', instance.id]);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle('horizon:list-modpacks', async () => {
  try {
    const modpacks = horizonCommandResult(await runHorizonCli(['modpack', 'list']));
    if (!Array.isArray(modpacks)) throw new Error('Horizon returned an invalid modpack list.');
    return { ok: true, modpacks };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

async function confirmHorizonNativeContent(action) {
  const labels = { install: 'Install', update: 'Update', import: 'Import' };
  const label = labels[action] || 'Continue';
  const confirmation = await dialog.showMessageBox(mainWindow, {
    type: 'warning',
    title: `${label} Horizon content?`,
    message: 'This action may add Horizon native .hnmod code.',
    detail: 'Native Horizon mods are not sandboxed and run with your Windows account permissions. Review the source and continue only if you trust it. The content stays in the isolated Horizon data folder.',
    buttons: [label, 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
  });
  return confirmation.response === 0;
}

ipcMain.handle('horizon:install-mod', async (_event, payload) => {
  try {
    const instance = await resolveHorizonInstance(payload?.instanceId || launcherState.settings?.horizonInstanceId);
    const projectId = validateProjectId(payload?.projectId);
    const source = payload?.source === 'horizon' ? 'horizon' : payload?.source === 'modrinth' ? 'modrinth' : '';
    const kind = payload?.kind;
    if (!['mod', 'modpack', 'resource', 'shader', 'datapack'].includes(kind)) {
      throw new Error('Unsupported Horizon content category.');
    }
    const world = payload?.world ? String(payload.world) : undefined;
    if (['mod', 'modpack'].includes(kind) && !(await confirmHorizonNativeContent('install'))) {
      return { ok: false, canceled: true };
    }
    const args = buildHorizonInstallArgs({ projectId, source, kind, instance: instance.id, world });
    const result = await runHorizonCli(args, { timeoutMs: 10 * 60 * 1000, maxOutputBytes: 16 * 1024 * 1024 });
    return { ok: true, output: result.stdout.trim() };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle('horizon:mod-action', async (_event, payload) => {
  try {
    const instance = await resolveHorizonInstance(payload?.instanceId || launcherState.settings?.horizonInstanceId);
    const action = payload?.action;
    if (!['enable', 'disable', 'remove', 'update'].includes(action)) throw new Error('Unsupported Horizon mod action.');
    if (action === 'update') {
      const projectId = payload?.projectId ? validateProjectId(payload.projectId) : '';
      if (!(await confirmHorizonNativeContent('update'))) return { ok: false, canceled: true };
      await runHorizonCli(['mods', 'update', ...(projectId ? [projectId] : []), '--instance', instance.id]);
    } else {
      const projectId = validateProjectId(payload?.projectId);
      if (action !== 'remove') {
        const installed = horizonCommandResult(await runHorizonCli(['mods', 'list', '--instance', instance.id]));
        const entry = Array.isArray(installed) && installed.find(item => item.project === projectId);
        if (String(entry?.file || '').toLowerCase().endsWith('.hnmod')) {
          throw new Error('Horizon native mods do not have an on/off switch. Remove the mod from this instance instead.');
        }
      }
      await runHorizonCli(['mods', action, projectId, '--instance', instance.id]);
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle('horizon:pack-action', async (_event, payload) => {
  try {
    const instance = await resolveHorizonInstance(payload?.instanceId || launcherState.settings?.horizonInstanceId);
    const pack = validateInstanceName(payload?.pack);
    const kind = payload?.kind === 'shader' ? 'shader' : payload?.kind === 'resource' ? 'resource' : '';
    const action = payload?.action;
    if (!kind || !['on', 'off', 'remove'].includes(action)) throw new Error('Unsupported Horizon pack action.');
    const args = action === 'remove'
      ? ['packs', 'remove', pack, '--kind', kind, '--instance', instance.id]
      : ['packs', action, pack, '--kind', kind, '--instance', instance.id];
    await runHorizonCli(args);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle('horizon:import-modpack', async () => {
  try {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Import a Horizon or Java modpack',
      properties: ['openFile'],
      filters: [{ name: 'Modpack archives', extensions: ['mrpack', 'zip'] }],
    });
    if (result.canceled || !result.filePaths[0]) return { ok: false, canceled: true };
    const archivePath = path.resolve(result.filePaths[0]);
    const stat = fs.lstatSync(archivePath);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Select a regular modpack archive.');
    if (!(await confirmHorizonNativeContent('import'))) return { ok: false, canceled: true };
    const output = await runHorizonCli(['instance', 'import', archivePath], { timeoutMs: 10 * 60 * 1000 });
    return { ok: true, output: output.stdout.trim() };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle('horizon:import-java-world', async (_event, payload) => {
  try {
    const profileId = String(payload?.profileId || '');
    const profile = launcherState.profiles.find(item => item.id === profileId);
    if (!profile) throw new Error('Choose a valid Bald Launcher Java profile.');
    if (runningProcesses.has(profile.id)) throw new Error('Close Minecraft before copying one of its worlds.');
    const sourceSaves = path.join(getMinecraftRootFor(profile.id), 'saves');
    const savesStat = fs.lstatSync(sourceSaves);
    if (!savesStat.isDirectory() || savesStat.isSymbolicLink()) throw new Error('The selected Java profile does not have a safe saves folder.');
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose a world to copy into Horizon',
      defaultPath: sourceSaves,
      properties: ['openDirectory'],
    });
    if (result.canceled || !result.filePaths[0]) return { ok: false, canceled: true };
    const sourcePath = path.resolve(result.filePaths[0]);
    const sourceParent = path.resolve(sourceSaves);
    if (process.platform === 'win32'
      ? path.dirname(sourcePath).toLowerCase() !== sourceParent.toLowerCase()
      : path.dirname(sourcePath) !== sourceParent) {
      throw new Error('Choose a world folder directly inside the selected Java profile’s saves folder.');
    }
    const sourceStat = fs.lstatSync(sourcePath);
    if (!sourceStat.isDirectory() || sourceStat.isSymbolicLink()) throw new Error('The selected world is not a regular folder.');
    const levelDat = path.join(sourcePath, 'level.dat');
    const levelStat = fs.lstatSync(levelDat);
    if (!levelStat.isFile() || levelStat.isSymbolicLink()) throw new Error('The selected folder is not a Minecraft world (level.dat is missing).');
    await assertTreeHasNoSymlinks(sourcePath, 'Minecraft world');

    const instance = await resolveHorizonInstance(payload?.instanceId || launcherState.settings?.horizonInstanceId);
    const roots = prepareHorizonHomes();
    const gameHomeReal = fs.realpathSync(roots.gameHome);
    const instanceHomeReal = fs.realpathSync(instance.home);
    const relativeHome = path.relative(gameHomeReal, instanceHomeReal);
    if (relativeHome === '..' || relativeHome.startsWith(`..${path.sep}`) || path.isAbsolute(relativeHome)) {
      throw new Error('The selected Horizon instance is outside the isolated Horizon data folder.');
    }
    const destinationSaves = path.join(instance.home, 'saves');
    fs.mkdirSync(destinationSaves, { recursive: true });
    const destinationStat = fs.lstatSync(destinationSaves);
    if (!destinationStat.isDirectory() || destinationStat.isSymbolicLink()) {
      throw new Error('The Horizon instance saves folder is not a real directory.');
    }
    const destinationReal = fs.realpathSync(destinationSaves);
    const relativeSaves = path.relative(gameHomeReal, destinationReal);
    if (relativeSaves === '..' || relativeSaves.startsWith(`..${path.sep}`) || path.isAbsolute(relativeSaves)) {
      throw new Error('The Horizon world destination is outside the isolated Horizon data folder.');
    }
    const copiedPath = copyPathWithoutOverwrite(sourcePath, destinationSaves);
    return { ok: true, worldName: path.basename(copiedPath), destinationPath: copiedPath };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle('launcher:apply-update', async () => {
  if (!app.isPackaged) return { ok: false, error: 'Updates are available only in the packaged launcher.' };
  if (runningProcesses.size || serverProcesses.size) {
    return { ok: false, error: 'Stop Minecraft and all servers before restarting to install the update.' };
  }
  try {
    const backupRoot = path.join(app.getPath('userData'), 'update-backups');
    createStateSafetySnapshot({ stateFilePath, backupRoot });
  } catch (error) {
    console.error('[Updater] Could not create state safety snapshot:', error);
    return { ok: false, error: 'Could not create a safety snapshot of launcher data. The update was not started.' };
  }
  const playitStop = await playitManager.stop();
  if (!playitStop.ok) {
    return { ok: false, error: `Playit could not be stopped safely. The update was not started. ${playitStop.error || ''}`.trim() };
  }
  quittingAfterPlayitStop = true;
  console.info('[Updater] Installing the downloaded release into:', autoUpdater.installDirectory);
  autoUpdater.quitAndInstall(true, true);
  return { ok: true };
});

ipcMain.handle('launcher:retry-update', async () => {
  if (!app.isPackaged) return { ok: false, error: 'Updates are available only in the packaged launcher.' };
  if (updateCheckPromise) return updateCheckPromise;
  launcherUpdateStatus = { state: 'checking' };
  try {
    updateCheckPromise = autoUpdater.checkForUpdates();
    await updateCheckPromise;
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    launcherUpdateStatus = { state: 'error', message };
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('launcher:update-error', { message });
    return { ok: false, error: message };
  } finally {
    updateCheckPromise = null;
  }
});

ipcMain.handle('launcher:sync-state', async (_event, nextState) => {
  launcherState.settings = normalizeSettings(nextState?.settings || launcherState.settings);
  if (Array.isArray(nextState?.servers)) launcherState.servers = nextState.servers.map(normalizeServer);
  if (Array.isArray(nextState?.accounts)) {
    launcherState.accounts = nextState.accounts.map(normalizeAccount);
    const active = launcherState.accounts.find(item => item.id === nextState.activeAccountId);
    if (active) launcherState.activeAccountId = active.id;
  }
  scheduleStateWrite();
  return launcherState;
});

function getMinecraftTextureUrl(value) {
  const rawUrl = String(value || '').trim();
  const url = rawUrl.replace(/^http:\/\//i, 'https://');
  if (!/^https:\/\/textures\.minecraft\.net\/texture\/[A-Za-z0-9]+$/i.test(url)) return null;
  return url;
}

function getOfficialCosmeticCacheRoot(account) {
  const key = String(account?.uuid || account?.id || '').replace(/[^a-zA-Z0-9._-]/g, '_');
  return path.join(app.getPath('userData'), 'cosmetics', 'official', key);
}

async function cacheOfficialTexture(account, kind, metadata, force = false) {
  const url = getMinecraftTextureUrl(metadata?.url);
  if (!url) return null;
  const root = getOfficialCosmeticCacheRoot(account);
  fs.mkdirSync(root, { recursive: true });
  const extension = kind === 'cape' ? 'cape' : 'skin';
  const filePath = path.join(root, `${extension}-${String(metadata.id || 'current').replace(/[^a-zA-Z0-9._-]/g, '_')}.png`);
  const library = createCosmeticLibrary({ appDataDir: app.getPath('userData') });
  if (!force && fs.existsSync(filePath)) {
    const cachedCheck = library.validatePngBuffer(fs.readFileSync(filePath));
    if (cachedCheck.ok) return filePath;
  }
  const response = await axios.get(url, { responseType: 'arraybuffer', timeout: 15000, maxContentLength: 5 * 1024 * 1024 });
  const buffer = Buffer.from(response.data);
  const pngCheck = library.validatePngBuffer(buffer);
  if (!pngCheck.ok) throw new Error(`Minecraft ${kind} texture is not a valid PNG.`);
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  const validDimensions = kind === 'skin'
    ? [64, 128].includes(width) && [64, 128].includes(height)
    : (width === 64 && height === 32) || (width === 128 && height === 64) || (width === 1024 && height === 512);
  if (!validDimensions) throw new Error(`Minecraft ${kind} texture has unsupported dimensions.`);
  fs.writeFileSync(filePath, buffer);
  return filePath;
}

async function getOfficialMinecraftAppearance(account, force = false) {
  const cosmetics = normalizeAccountCosmetics(account?.cosmetics || {});
  if (!account || account.type === 'Offline') {
    cosmetics.official = { ...cosmetics.official, status: 'offline', error: null };
    account.cosmetics = cosmetics;
    return { ok: true, accountId: account?.id || null, username: account?.name || null, uuid: account?.uuid || null, cosmetics };
  }
  let authorization = account.auth;
  let accessToken = String(authorization?.access_token || '');
  if (!accessToken) {
    cosmetics.official = { ...cosmetics.official, status: 'error', error: 'Minecraft authentication is unavailable.' };
    account.cosmetics = cosmetics;
    scheduleStateWrite();
    return { ok: false, requiresRelink: true, accountId: account.id, error: cosmetics.official.error, cosmetics };
  }
  const cachedAt = Number(cosmetics.official?.fetchedAt || 0);
  const officialCacheRoot = `${path.resolve(getOfficialCosmeticCacheRoot(account))}${path.sep}`.toLowerCase();
  const isUsableOfficialTexture = texture => {
    const filePath = path.resolve(String(texture?.filePath || ''));
    return path.extname(filePath).toLowerCase() === '.png'
      && filePath.toLowerCase().startsWith(officialCacheRoot)
      && fs.existsSync(filePath);
  };
  const hasUsableOfficialTextures = isUsableOfficialTexture(cosmetics.official?.skin)
    && (!cosmetics.official?.cape || isUsableOfficialTexture(cosmetics.official.cape));
  if (!force && cosmetics.official?.status === 'ready' && cachedAt && Date.now() - cachedAt < 10 * 60 * 1000 && hasUsableOfficialTextures) {
    return { ok: true, accountId: account.id, username: account.name, uuid: account.uuid, cosmetics };
  }
  try {
    let response;
    try {
      response = await axios.get('https://api.minecraftservices.com/minecraft/profile', {
        headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
        timeout: 15000,
      });
    } catch (error) {
      const refreshToken = String(authorization?.meta?.refresh || '');
      if (error?.response?.status !== 401 || !refreshToken) throw error;
      const { Auth } = require('msmc');
      const xboxManager = await new Auth('select_account').refresh(refreshToken);
      const refreshedToken = await xboxManager.getMinecraft();
      authorization = refreshedToken.mclc(true);
      accessToken = authorization.access_token;
      account.auth = authorization;
      response = await axios.get('https://api.minecraftservices.com/minecraft/profile', {
        headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
        timeout: 15000,
      });
    }
    const profile = response.data || {};
    const skin = Array.isArray(profile.skins) ? profile.skins.find(item => item?.state === 'ACTIVE') || profile.skins[0] : null;
    const cape = Array.isArray(profile.capes) ? profile.capes.find(item => item?.state === 'ACTIVE') || profile.capes[0] : null;
    const skinPath = skin ? await cacheOfficialTexture(account, 'skin', skin, force) : null;
    const capePath = cape ? await cacheOfficialTexture(account, 'cape', cape, force) : null;
    if (skin && !skinPath) throw new Error('Minecraft returned a skin but its texture could not be cached.');
    const previousOfficialSkin = cosmetics.official?.skin;
    const official = {
      skin: skin && skinPath ? { id: String(skin.id), name: 'Minecraft Account Skin', source: 'official', filePath: skinPath, url: getMinecraftTextureUrl(skin.url), model: skin.variant === 'SLIM' ? 'slim' : 'classic' } : null,
      cape: cape && capePath ? { id: String(cape.id), name: cape.alias || 'Official Minecraft Cape', source: 'official', filePath: capePath, url: getMinecraftTextureUrl(cape.url) } : null,
      fetchedAt: Date.now(),
      status: 'ready',
      error: null,
    };
    if (previousOfficialSkin?.filePath && previousOfficialSkin.id !== official.skin?.id) {
      cosmetics.recentlyUsedSkins = [
        previousOfficialSkin,
        ...(cosmetics.recentlyUsedSkins || []).filter(item => item?.id !== previousOfficialSkin.id),
      ].slice(0, 12);
    }
    cosmetics.official = official;
    cosmetics.model = official.skin?.model || cosmetics.selected?.skin?.model || cosmetics.model || 'classic';
    cosmetics.skin = cosmetics.selected?.skin || official.skin;
    cosmetics.cape = cosmetics.selected?.cape || official.cape;
    account.uuid = profile.id || account.uuid;
    account.name = profile.name || account.name;
    account.cosmetics = cosmetics;
    scheduleStateWrite();
    return { ok: true, accountId: account.id, username: account.name, uuid: account.uuid, cosmetics };
  } catch (error) {
    const message = error?.response?.status === 401
      ? 'Minecraft authentication expired. Relink this Microsoft account.'
      : error instanceof Error ? error.message : String(error);
    cosmetics.official = { ...cosmetics.official, status: 'error', error: message };
    account.cosmetics = cosmetics;
    scheduleStateWrite();
    return { ok: false, requiresRelink: error?.response?.status === 401 || !authorization?.meta?.refresh, accountId: account.id, error: cosmetics.official.error, cosmetics };
  }
}

async function syncMinecraftAccountSkin(account, selection) {
  if (!account || account.type === 'Offline' || selection?.source === 'official') return;
  const filePath = path.resolve(String(selection?.filePath || ''));
  const cosmeticsRoot = path.resolve(path.join(app.getPath('userData'), 'cosmetics'));
  if (!filePath || (filePath !== cosmeticsRoot && !filePath.startsWith(`${cosmeticsRoot}${path.sep}`))) {
    throw new Error('Selected skin is outside the cosmetic library.');
  }
  if (!fs.existsSync(filePath)) throw new Error('Selected skin file is unavailable.');

  const library = createCosmeticLibrary({ appDataDir: app.getPath('userData') });
  const check = library.validatePngBuffer(fs.readFileSync(filePath));
  if (!check.ok) throw new Error(check.error || 'Selected skin is not a valid PNG.');

  let authorization = account.auth;
  let accessToken = String(authorization?.access_token || '');
  if (!accessToken) throw new Error('Minecraft authentication is unavailable. Relink this account.');

  const upload = async token => {
    const form = new FormData();
    form.append('variant', selection?.model === 'slim' ? 'slim' : 'classic');
    form.append('file', fs.createReadStream(filePath), { filename: 'skin.png', contentType: 'image/png' });
    await axios.post('https://api.minecraftservices.com/minecraft/profile/skins', form, {
      headers: { Authorization: `Bearer ${token}`, ...form.getHeaders() },
      timeout: 30000,
      maxBodyLength: 10 * 1024 * 1024,
    });
  };

  try {
    await upload(accessToken);
  } catch (error) {
    const refreshToken = String(authorization?.meta?.refresh || '');
    if (error?.response?.status !== 401 || !refreshToken) throw error;
    const { Auth } = require('msmc');
    const xboxManager = await new Auth('select_account').refresh(refreshToken);
    authorization = (await xboxManager.getMinecraft()).mclc(true);
    account.auth = authorization;
    await upload(authorization.access_token);
  }
  account.cosmetics = normalizeAccountCosmetics(account.cosmetics || {});
  account.cosmetics.official = { ...account.cosmetics.official, status: 'unknown', fetchedAt: 0, error: null };
  scheduleStateWrite();
}

ipcMain.handle('launcher:cosmetics:get', async (_event, payload = {}) => {
  const accountId = String(payload?.accountId || launcherState.activeAccountId || '');
  const account = launcherState.accounts.find(item => item.id === accountId) || launcherState.accounts[0] || null;
  if (!account) return { ok: false, error: 'No account is available for cosmetics.' };
  return getOfficialMinecraftAppearance(account, payload?.force === true);
});

ipcMain.handle('launcher:cosmetics:save-selection', async (_event, payload = {}) => {
  const accountId = String(payload?.accountId || launcherState.activeAccountId || '');
  const account = launcherState.accounts.find(item => item.id === accountId);
  if (!account) return { ok: false, error: 'Target account not found.' };
  const kind = payload?.kind === 'cape' ? 'cape' : 'skin';
  const selection = payload?.selection && typeof payload.selection === 'object' ? payload.selection : null;
  if (kind === 'skin' && selection?.source !== 'official') {
    try {
      await syncMinecraftAccountSkin(account, selection);
    } catch (error) {
      return { ok: false, accountId: account.id, error: error instanceof Error ? error.message : String(error) };
    }
  }
  const updated = setAccountSelection(account, kind, selection);
  account.cosmetics = updated.cosmetics;
  if (kind === 'skin') account.skinPath = selection?.source === 'official' ? null : String(selection?.filePath || '');
  if (selection) {
    const libraryRoot = path.resolve(path.join(app.getPath('userData'), 'cosmetics'));
    const selectedPath = selection.filePath ? path.resolve(String(selection.filePath)) : '';
    const isLocalLibraryAsset = selectedPath === libraryRoot || selectedPath.startsWith(`${libraryRoot}${path.sep}`);
    if (isLocalLibraryAsset && ['local', 'created'].includes(String(selection.source || 'local'))) {
      const collectionKey = kind === 'skin' ? 'importedSkins' : 'importedCapes';
      const collection = Array.isArray(account.cosmetics[collectionKey]) ? account.cosmetics[collectionKey] : [];
      if (!collection.some(item => item?.id === selection.id || (item?.filePath && path.resolve(item.filePath) === selectedPath))) {
        account.cosmetics[collectionKey] = [{ ...selection, filePath: selectedPath }, ...collection].slice(0, 200);
      }
    }
    const recent = pushRecentItem(updated, kind, selection);
    account.cosmetics = recent.cosmetics;
  }
  scheduleStateWrite();
  return { ok: true, accountId: account.id, cosmetics: account.cosmetics };
});

ipcMain.handle('launcher:cosmetics:import', async (_event, payload = {}) => {
  try {
    const kind = payload?.kind === 'cape' ? 'cape' : 'skin';
    const filePath = String(payload?.filePath || '').trim();
    if (!filePath || !fs.existsSync(filePath)) {
      return { ok: false, error: 'No valid file was provided for import.' };
    }
    const library = createCosmeticLibrary({ appDataDir: app.getPath('userData') });
    const created = library.saveAsset(kind, {
      filePath,
      name: String(payload?.name || path.basename(filePath, path.extname(filePath)) || `${kind}-asset`),
      source: 'local',
      model: ['classic', 'slim'].includes(String(payload?.model || 'classic')) ? String(payload.model) : 'classic',
    });
    return { ok: true, asset: created };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle('launcher:cosmetics:read-texture', async (_event, filePath) => {
  try {
    const requested = path.resolve(String(filePath || ''));
    const cosmeticsRoot = path.resolve(path.join(app.getPath('userData'), 'cosmetics'));
    if (requested !== cosmeticsRoot && !requested.startsWith(`${cosmeticsRoot}${path.sep}`)) {
      return { ok: false, error: 'Texture path is outside the cosmetic library.' };
    }
    if (!fs.existsSync(requested) || path.extname(requested).toLowerCase() !== '.png') {
      return { ok: false, error: 'Texture file is unavailable.' };
    }
    const buffer = fs.readFileSync(requested);
    const check = createCosmeticLibrary({ appDataDir: app.getPath('userData') }).validatePngBuffer(buffer);
    if (!check.ok) return { ok: false, error: check.error };
    return { ok: true, dataUrl: `data:image/png;base64,${buffer.toString('base64')}` };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle('launcher:cosmetics:save-created', async (_event, payload = {}) => {
  try {
    const kind = payload?.kind === 'cape' ? 'cape' : 'skin';
    const dataUrl = String(payload?.dataUrl || '');
    const match = dataUrl.match(/^data:image\/png;base64,([A-Za-z0-9+/=]+)$/);
    if (!match) return { ok: false, error: 'Studio output must be a PNG data URL.' };
    const library = createCosmeticLibrary({ appDataDir: app.getPath('userData') });
    const asset = library.saveBuffer(kind, {
      buffer: Buffer.from(match[1], 'base64'),
      name: String(payload?.name || `${kind} creation`).slice(0, 120),
      source: 'created',
      model: payload?.model,
      parentId: payload?.parentId || null,
      version: payload?.version || 1,
      accountId: String(payload?.accountId || launcherState.activeAccountId || ''),
    });
    const account = launcherState.accounts.find(item => item.id === String(payload?.accountId || launcherState.activeAccountId || ''));
    if (account) {
      account.cosmetics = normalizeAccountCosmetics(account.cosmetics || {});
      const key = kind === 'skin' ? 'createdSkins' : 'createdCapes';
      account.cosmetics[key] = [asset, ...(account.cosmetics[key] || []).filter(item => item?.id !== asset.id)].slice(0, 200);
      scheduleStateWrite();
    }
    return { ok: true, asset };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle('launcher:cosmetics:export-created', async (_event, payload = {}) => {
  try {
    const requested = path.resolve(String(payload?.filePath || ''));
    const cosmeticsRoot = path.resolve(path.join(app.getPath('userData'), 'cosmetics'));
    if (requested !== cosmeticsRoot && !requested.startsWith(`${cosmeticsRoot}${path.sep}`)) return { ok: false, error: 'Invalid cosmetic source path.' };
    if (!fs.existsSync(requested)) return { ok: false, error: 'Cosmetic file no longer exists.' };
    const result = await dialog.showSaveDialog(mainWindow, { defaultPath: `${String(payload?.name || 'cosmetic').replace(/[<>:"/\\|?*]+/g, '_')}.png`, filters: [{ name: 'PNG image', extensions: ['png'] }] });
    if (result.canceled || !result.filePath) return { ok: false, canceled: true };
    emitExportProgress(exportId, 12, 'Building export archive');
    fs.copyFileSync(requested, result.filePath);
    return { ok: true, filePath: result.filePath };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle('launcher:cosmetics:rename-created', async (_event, payload = {}) => {
  try {
    const requested = path.resolve(String(payload?.filePath || ''));
    const cosmeticsRoot = path.resolve(path.join(app.getPath('userData'), 'cosmetics'));
    if (requested !== cosmeticsRoot && !requested.startsWith(`${cosmeticsRoot}${path.sep}`)) return { ok: false, error: 'Invalid cosmetic path.' };
    const metadataPath = path.join(path.dirname(requested), `${path.basename(requested, path.extname(requested))}.json`);
    if (!fs.existsSync(metadataPath)) return { ok: false, error: 'Cosmetic metadata was not found.' };
    const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
    metadata.name = String(payload?.name || metadata.name || 'Cosmetic').trim().slice(0, 120) || 'Cosmetic';
    metadata.modifiedAt = new Date().toISOString();
    fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), 'utf8');
    for (const account of launcherState.accounts) {
      account.cosmetics = normalizeAccountCosmetics(account.cosmetics || {});
      for (const key of ['createdSkins', 'createdCapes']) account.cosmetics[key] = account.cosmetics[key].map(item => item?.id === metadata.id ? { ...item, name: metadata.name, modifiedAt: metadata.modifiedAt } : item);
    }
    scheduleStateWrite();
    return { ok: true, asset: metadata };
  } catch (error) { return { ok: false, error: error instanceof Error ? error.message : String(error) }; }
});

ipcMain.handle('launcher:cosmetics:delete-created', async (_event, payload = {}) => {
  try {
    const requested = path.resolve(String(payload?.filePath || ''));
    const cosmeticsRoot = path.resolve(path.join(app.getPath('userData'), 'cosmetics'));
    if (requested !== cosmeticsRoot && !requested.startsWith(`${cosmeticsRoot}${path.sep}`)) return { ok: false, error: 'Invalid cosmetic path.' };
    const metadataPath = path.join(path.dirname(requested), `${path.basename(requested, path.extname(requested))}.json`);
    if (fs.existsSync(requested)) fs.rmSync(requested, { force: true });
    if (fs.existsSync(metadataPath)) fs.rmSync(metadataPath, { force: true });
    for (const account of launcherState.accounts) {
      account.cosmetics = normalizeAccountCosmetics(account.cosmetics || {});
      account.cosmetics.createdSkins = account.cosmetics.createdSkins.filter(item => item?.filePath !== requested);
      account.cosmetics.createdCapes = account.cosmetics.createdCapes.filter(item => item?.filePath !== requested);
      account.cosmetics.recentlyUsedSkins = account.cosmetics.recentlyUsedSkins.filter(item => item?.filePath !== requested);
      account.cosmetics.recentlyUsedCapes = account.cosmetics.recentlyUsedCapes.filter(item => item?.filePath !== requested);
      account.cosmetics.favoriteSkins = account.cosmetics.favoriteSkins.filter(item => item?.filePath !== requested);
      account.cosmetics.favoriteCapes = account.cosmetics.favoriteCapes.filter(item => item?.filePath !== requested);
      if (account.cosmetics.selected?.skin?.filePath === requested) account.cosmetics.selected.skin = null;
      if (account.cosmetics.selected?.cape?.filePath === requested) account.cosmetics.selected.cape = null;
      account.cosmetics.skin = account.cosmetics.selected.skin || account.cosmetics.official.skin || null;
      account.cosmetics.cape = account.cosmetics.selected.cape || account.cosmetics.official.cape || null;
    }
    scheduleStateWrite();
    return { ok: true, state: launcherState };
  } catch (error) { return { ok: false, error: error instanceof Error ? error.message : String(error) }; }
});

// ---------------------------------------------------------------------------
// IPC: themes
// ---------------------------------------------------------------------------
ipcMain.handle('launcher:get-themes', async () => {
  return {
    themes: launcherState.themes || DEFAULT_STATE.themes,
    activeThemeId: launcherState.activeThemeId || '1',
    currentTheme: getActiveTheme(),
  };
});

ipcMain.handle('launcher:set-active-theme', async (_event, themeId) => {
  if (launcherState.themes?.[String(themeId)]) {
    launcherState.activeThemeId = String(themeId);
    scheduleStateWrite();
    return { ok: true, theme: getActiveTheme() };
  }
  return { ok: false, error: 'Theme not found' };
});

ipcMain.handle('launcher:update-theme', async (_event, { themeId, updates }) => {
  const id = String(themeId || launcherState.activeThemeId || '1');
  if (!launcherState.themes?.[id]) return { ok: false, error: 'Theme not found' };
  const existing = normalizeTheme(launcherState.themes[id]);
  launcherState.themes[id] = normalizeTheme({ ...existing, ...updates });
  scheduleStateWrite();
  return { ok: true, theme: launcherState.themes[id] };
});

ipcMain.handle('launcher:duplicate-theme', async (_event, { fromThemeId, toThemeId, name }) => {
  const from = String(fromThemeId || launcherState.activeThemeId || '1');
  const to = String(toThemeId);
  if (!launcherState.themes?.[from]) return { ok: false, error: 'Source theme not found' };
  if (!['1', '2', '3', '4', '5'].includes(to)) return { ok: false, error: 'Invalid target preset' };
  const newTheme = JSON.parse(JSON.stringify(launcherState.themes[from]));
  newTheme.name = String(name || `Preset ${to}`).slice(0, 100);
  launcherState.themes[to] = normalizeTheme(newTheme);
  scheduleStateWrite();
  return { ok: true, theme: launcherState.themes[to] };
});

ipcMain.handle('launcher:rename-theme', async (_event, { themeId, name }) => {
  const id = String(themeId || launcherState.activeThemeId || '1');
  if (!launcherState.themes?.[id]) return { ok: false, error: 'Theme not found' };
  launcherState.themes[id] = normalizeTheme({ ...launcherState.themes[id], name: String(name || '').trim().slice(0, 100) || `Theme ${id}` });
  scheduleStateWrite();
  return { ok: true, theme: launcherState.themes[id] };
});

ipcMain.handle('launcher:delete-theme', async (_event, themeId) => {
  const id = String(themeId || '');
  const ids = Object.keys(launcherState.themes || {});
  if (!launcherState.themes?.[id]) return { ok: false, error: 'Theme not found' };
  if (ids.length <= 1) return { ok: false, error: 'At least one theme must remain' };
  delete launcherState.themes[id];
  if (launcherState.activeThemeId === id) launcherState.activeThemeId = Object.keys(launcherState.themes)[0];
  scheduleStateWrite();
  return { ok: true, activeThemeId: launcherState.activeThemeId, themes: launcherState.themes };
});

ipcMain.handle('launcher:reset-theme', async (_event, themeId) => {
  const id = String(themeId || '1');
  if (!['1', '2', '3', '4', '5'].includes(id)) return { ok: false, error: 'Invalid preset' };
  launcherState.themes[id] = normalizeTheme({ ...DEFAULT_THEME, name: `Preset ${id}` });
  scheduleStateWrite();
  return { ok: true, theme: launcherState.themes[id] };
});

ipcMain.handle('launcher:reset-theme-category', async (_event, { themeId, category }) => {
  const id = String(themeId || '1');
  const allowed = ['colors', 'typography', 'spacing', 'borders', 'background', 'corners', 'shadows', 'effects', 'sidebar', 'buttons', 'cards', 'inputs', 'modals', 'advanced'];
  if (!launcherState.themes?.[id] || !allowed.includes(category)) return { ok: false, error: 'Invalid theme category' };
  launcherState.themes[id] = normalizeTheme({ ...launcherState.themes[id], [category]: JSON.parse(JSON.stringify(DEFAULT_THEME[category])) });
  scheduleStateWrite();
  return { ok: true, theme: launcherState.themes[id] };
});

ipcMain.handle('launcher:export-theme', async (_event, themeId) => {
  const id = String(themeId || launcherState.activeThemeId || '1');
  const theme = launcherState.themes?.[id];
  if (!theme) return { ok: false, error: 'Theme not found' };
  const json = JSON.stringify(normalizeTheme(theme), null, 2);
  return { ok: true, json, name: `${theme.name || `Preset ${id}`}.baldtheme` };
});

ipcMain.handle('launcher:import-theme', async (_event, { themeId, jsonString }) => {
  try {
    const id = String(themeId || '1');
    if (!['1', '2', '3', '4', '5'].includes(id)) return { ok: false, error: 'Invalid target preset' };
    const imported = JSON.parse(String(jsonString || '{}'));
    launcherState.themes[id] = normalizeTheme(imported);
    scheduleStateWrite();
    return { ok: true, theme: launcherState.themes[id] };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Invalid JSON' };
  }
});

ipcMain.handle('launcher:backup-themes', async () => {
  try {
    const backup = JSON.stringify(launcherState.themes || DEFAULT_STATE.themes, null, 2);
    return { ok: true, backup, timestamp: new Date().toISOString() };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Backup failed' };
  }
});

ipcMain.handle('launcher:restore-themes', async (_event, backup) => {
  try {
    const restored = JSON.parse(String(backup || '{}'));
    for (const key in restored) {
      if (['1', '2', '3', '4', '5'].includes(key)) {
        launcherState.themes[key] = normalizeTheme(restored[key]);
      }
    }
    scheduleStateWrite();
    return { ok: true, themes: launcherState.themes };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Restore failed' };
  }
});

// ---------------------------------------------------------------------------
// IPC: accounts
// ---------------------------------------------------------------------------
ipcMain.handle('launcher:set-active-account', async (_event, accountId) => {
  if (launcherState.accounts.some(a => a.id === accountId)) {
    launcherState.activeAccountId = accountId;
    scheduleStateWrite();
  }
  return launcherState;
});

ipcMain.handle('launcher:add-account', async (_event, payload) => {
  const name = String(payload?.name || '').trim();
  if (!name) return { ok: false, error: 'Account name is required' };
  if (launcherState.accounts.some(account => account.name.toLowerCase() === name.toLowerCase())) {
    return { ok: false, error: 'An account with that name already exists' };
  }
  const account = normalizeAccount(payload);
  launcherState.accounts.push(account);
  launcherState.activeAccountId = account.id;
  scheduleStateWrite();
  return { ok: true, ...launcherState };
});

ipcMain.handle('launcher:link-microsoft-account', async () => {
  try {
    const { Auth } = require('msmc');
    const authManager = new Auth('select_account');
    const xboxManager = await authManager.launch('electron');
    const token = await xboxManager.getMinecraft();
    const authorization = token.mclc(true);
    const name = String(authorization.name || token.profile?.name || '').trim().slice(0, 16);
    if (!name) throw new Error('Microsoft login did not return a Minecraft username');
    const duplicateIndex = launcherState.accounts.findIndex(account => account.name.toLowerCase() === name.toLowerCase());
    const account = normalizeAccount({
      name,
      type: 'Microsoft',
      uuid: authorization.uuid,
      auth: authorization,
      id: `microsoft-${authorization.uuid || Date.now()}`,
    });
    if (duplicateIndex === -1) {
      launcherState.accounts.push(account);
      launcherState.activeAccountId = account.id;
    } else {
      const existing = launcherState.accounts[duplicateIndex];
      launcherState.accounts[duplicateIndex] = { ...existing, ...account, id: existing.id, cosmetics: normalizeAccountCosmetics(existing.cosmetics || {}) };
      launcherState.activeAccountId = existing.id;
    }
    scheduleStateWrite();
    return { ok: true, state: launcherState };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle('launcher:choose-skin', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [{ name: 'Minecraft skin', extensions: ['png'] }],
  });
  return result.canceled || !result.filePaths[0]
    ? { ok: false, canceled: true }
    : { ok: true, path: result.filePaths[0] };
});

ipcMain.handle('launcher:delete-account', async (_event, accountId) => {
  if (launcherState.accounts.length <= 1) return { ok: false, error: 'At least one account must remain' };
  if (runningProcesses.size) return { ok: false, error: 'Stop Minecraft before deleting an account' };
  const account = launcherState.accounts.find(item => item.id === accountId);
  if (!account) return { ok: false, error: 'Account not found' };
  launcherState.accounts = launcherState.accounts.filter(item => item.id !== accountId);
  if (launcherState.activeAccountId === accountId) launcherState.activeAccountId = launcherState.accounts[0].id;
  scheduleStateWrite();
  return { ok: true, state: launcherState };
});

// ---------------------------------------------------------------------------
// IPC: profiles
// ---------------------------------------------------------------------------
ipcMain.handle('launcher:get-renderer-options', async (_event, { mcVersion, loader }) => {
  return getRendererOptions(mcVersion, loader);
});

ipcMain.handle('launcher:get-versions', async () => getVersionManifest());

ipcMain.handle('launcher:get-java-installations', async () => {
  try {
    return { ok: true, installations: await discoverJavaInstallations() };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error), installations: [] };
  }
});

ipcMain.handle('launcher:get-loader-versions', async (_event, payload) => {
  try {
    return { ok: true, versions: await getLoaderVersions(payload?.mcVersion, payload?.loader) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle('launcher:custom-skin-loader:resolve', async (_event, payload) => {
  try {
    const profile = payload?.profileId
      ? launcherState.profiles.find(item => item.id === payload.profileId)
      : getActiveProfile();
    if (!profile) return { ok: false, error: 'Profile not found' };
    const result = await resolveCustomSkinLoader({
      mcVersion: profile.mcVersion,
      loader: profile.loader,
      client: axios,
    });
    return { ok: true, profileId: profile.id, ...result };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle('launcher:custom-skin-loader:diagnose', async (_event, payload) => {
  try {
    const profile = payload?.profileId ? launcherState.profiles.find(item => item.id === payload.profileId) : getActiveProfile();
    if (!profile) return { ok: false, error: 'Profile not found' };
    const resolved = await resolveCustomSkinLoader({ mcVersion: profile.mcVersion, loader: profile.loader, client: axios });
    const profileRoot = getMinecraftRootFor(profile.id);
    return { ok: true, profileId: profile.id, ...diagnoseInstallation({ profileRoot, profile, compatibility: resolved.compatibility }) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle('launcher:custom-skin-loader:install', async (_event, payload) => {
  try {
    const profile = payload?.profileId ? launcherState.profiles.find(item => item.id === payload.profileId) : getActiveProfile();
    if (!profile) return { ok: false, error: 'Profile not found' };
    const result = await installCustomSkinLoader({ profileRoot: getMinecraftRootFor(profile.id), profile, client: axios });
    if (result.ok) {
      profile.customSkinLoader = {
        ...(profile.customSkinLoader || {}),
        enabled: result.state === 'ready',
        managed: true,
        state: result.state,
        compatibility: result.compatibility,
        lastError: null,
      };
      scheduleStateWrite();
    }
    return { ...result, profileId: profile.id };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle('launcher:custom-skin-loader:repair', async (_event, payload) => {
  try {
    const profile = payload?.profileId ? launcherState.profiles.find(item => item.id === payload.profileId) : getActiveProfile();
    if (!profile) return { ok: false, error: 'Profile not found' };
    const result = await installCustomSkinLoader({ profileRoot: getMinecraftRootFor(profile.id), profile, client: axios });
    if (result.ok) {
      profile.customSkinLoader = { ...(profile.customSkinLoader || {}), enabled: result.state === 'ready', managed: true, state: result.state, compatibility: result.compatibility, lastError: null };
      scheduleStateWrite();
    }
    return { ...result, profileId: profile.id };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle('launcher:custom-skin-loader:disable', async (_event, payload) => {
  try {
    const profile = payload?.profileId ? launcherState.profiles.find(item => item.id === payload.profileId) : getActiveProfile();
    if (!profile) return { ok: false, error: 'Profile not found' };
    const result = disableCustomSkinLoader({ profileRoot: getMinecraftRootFor(profile.id) });
    if (result.ok) {
      profile.customSkinLoader = { ...(profile.customSkinLoader || {}), enabled: false, state: 'disabled' };
      scheduleStateWrite();
    }
    return { ...result, profileId: profile.id };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle('launcher:custom-skin-loader:remove', async (_event, payload) => {
  try {
    const profile = payload?.profileId ? launcherState.profiles.find(item => item.id === payload.profileId) : getActiveProfile();
    if (!profile) return { ok: false, error: 'Profile not found' };
    const result = removeManagedInstallation({ profileRoot: getMinecraftRootFor(profile.id) });
    if (result.ok) {
      profile.customSkinLoader = { ...(profile.customSkinLoader || {}), enabled: false, managed: false, state: 'disabled', compatibility: null };
      scheduleStateWrite();
    }
    return { ...result, profileId: profile.id };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle('launcher:custom-skin-loader:ownership', async (_event, payload) => {
  const profile = payload?.profileId ? launcherState.profiles.find(item => item.id === payload.profileId) : getActiveProfile();
  if (!profile) return { ok: false, error: 'Profile not found' };
  return { ok: true, profileId: profile.id, ownership: readOwnership(getMinecraftRootFor(profile.id)) };
});

// Resolves the curated bundle's search terms into real Modrinth projects for
// the checklist modal — nothing is installed here, this is preview-only.
ipcMain.handle('launcher:preview-bundle', async (_event, { mcVersion, loader, rendererMode }) => {
  const terms = RENDERER_BUNDLES[rendererMode] || [];
  if (!terms.length) return { ok: true, items: [] };

  const normalizedLoader = normalizeContentLoader(loader);
  const definition = getRendererBundleDefinition(mcVersion, normalizedLoader, rendererMode);
  const allowedProjects = new Set(definition.allowedProjectIds);
  const excludedProjects = new Set(definition.excludedProjectIds);
  const items = [];
  for (const term of terms) {
    const slug = OPTIMIZATION_PROJECT_SLUGS[term];
    if (slug && !allowedProjects.has(slug)) {
      const excluded = excludedProjects.has(slug);
      items.push({
        id: slug,
        name: term,
        desc: excluded
          ? `Excluded from the verified ${rendererMode} compatibility set for Minecraft ${mcVersion}.`
          : `Not verified for the ${rendererMode} compatibility set on Minecraft ${mcVersion}.`,
        type: 'mod',
        selected: false,
        unresolved: true,
        loader: normalizedLoader,
        minecraftVersion: mcVersion,
      });
      continue;
    }
    try {
      if (!slug) {
        items.push({ id: term, name: term, desc: 'This recommendation has no downloadable project mapping.', type: 'mod', selected: false, unresolved: true });
        continue;
      }

      const projectResponse = await axios.get(`${MODRINTH_API}/project/${slug}`, {
        headers: { 'User-Agent': 'BaldLauncher/0.1.0 (contact: none)' },
        timeout: 8000,
      });
      let file = null;
      try {
        file = await resolveModrinthFile(slug, mcVersion, normalizedLoader);
      } catch (_resolverError) {
        file = null;
      }

      const fallbackName = projectResponse?.data?.title || term;
      const fallbackDescription = projectResponse?.data?.description || 'Recommended for this renderer profile.';
      const item = file
        ? {
            id: slug,
            name: fallbackName,
            desc: fallbackDescription,
            iconUrl: projectResponse?.data?.icon_url || null,
            type: 'mod',
            searchTerm: term,
            version: file.filename,
            selected: !OPTIONAL_RENDERER_RECOMMENDATIONS.has(term),
            versionId: file.version.id,
            loader: normalizedLoader,
            minecraftVersion: mcVersion,
          }
        : {
            id: slug,
            name: fallbackName,
            desc: `No compatible ${normalizedLoader} file was found for Minecraft ${mcVersion}.`,
            iconUrl: projectResponse?.data?.icon_url || null,
            type: 'mod',
            searchTerm: term,
            selected: false,
            unresolved: true,
            loader: normalizedLoader,
            minecraftVersion: mcVersion,
          };

      items.push(item);
    } catch (_error) {
      items.push({
        id: slug || term,
        name: term,
        desc: `No compatible ${normalizedLoader} file was found for Minecraft ${mcVersion}.`,
        type: 'mod',
        selected: false,
        unresolved: true,
        loader: normalizedLoader,
        minecraftVersion: mcVersion,
      });
    }
  }

  if (!items.length) {
    for (const term of terms) {
      items.push({ id: OPTIMIZATION_PROJECT_SLUGS[term] || term, name: term, desc: 'No compatible downloadable file was found.', type: 'mod', selected: false, unresolved: true });
    }
  }

  return { ok: true, items };
});

// Installs the checklist's confirmed selections, tagged so a later mode
// switch knows which installed items belong to this bundle.
ipcMain.handle('launcher:apply-bundle', async (_event, payload = {}) => {
  let stagingDirectory = null;
  let committedPaths = [];
  let targetProfile = null;
  let previousMods = null;
  try {
    const { items, rendererMode } = payload;
    const requestedProfileId = payload.profileId;
    const profile = requestedProfileId
      ? launcherState.profiles.find(item => item.id === String(requestedProfileId))
      : getActiveProfile();
    if (!profile) throw new Error('No active profile');
    const definition = getRendererBundleDefinition(profile.mcVersion, profile.loader, rendererMode);
    const selectedProjectIds = validateRendererBundleSelection(
      (Array.isArray(items) ? items : []).map(item => item?.id).filter(Boolean),
      definition.allowedProjectIds,
      definition.excludedProjectIds,
    );
    ensureLauncherGameFolders(getMinecraftRootFor(profile));

    const idx = launcherState.profiles.findIndex(p => p.id === profile.id);
    targetProfile = launcherState.profiles[idx];
    previousMods = targetProfile.mods.slice();
    const selectedItems = new Map((Array.isArray(items) ? items : [])
      .map(item => [String(item?.id || ''), item]));
    const plannedFiles = new Map();
    const resolveTree = async (projectId, versionId = null, visiting = new Set()) => {
      if (visiting.has(projectId)) throw new Error(`A required dependency cycle was found for ${projectId}.`);
      const existing = plannedFiles.get(projectId);
      if (existing) {
        if (versionId && existing.version.id !== versionId) {
          throw new Error(`The selected bundle requires conflicting versions of ${projectId}.`);
        }
        return;
      }
      const file = await resolveModrinthFile(projectId, profile.mcVersion, profile.loader, 'mod', versionId);
      if (!/^[a-f0-9]{128}$/i.test(String(file.hashes?.sha512 || ''))) {
        throw new Error(`Modrinth did not provide a SHA-512 checksum for ${projectId}.`);
      }
      plannedFiles.set(projectId, file);
      const nextVisiting = new Set(visiting);
      nextVisiting.add(projectId);
      for (const dependency of getRequiredModrinthDependencies(file.version)) {
        await resolveTree(dependency.projectId, dependency.versionId, nextVisiting);
      }
    };
    for (const projectId of selectedProjectIds) {
      const item = selectedItems.get(projectId);
      if (item?.unresolved) throw new Error(`${projectId} has no verified compatible release.`);
      await resolveTree(projectId, item?.versionId || null);
    }
    if (profile.loader === 'fabric') {
      const fabricApi = profile.mods.find(mod => mod.id === 'fabric-api' && mod.enabled !== false);
      const fabricApiPath = fabricApi ? resolveInstalledContentPath(profile, fabricApi, false) : null;
      if (!fabricApiPath || !fs.existsSync(fabricApiPath)) await resolveTree('fabric-api');
    }
    for (const [projectId, file] of plannedFiles) {
      const installed = (profile.mods || []).find(mod => mod.id === projectId && mod.enabled !== false);
      if (installed?.versionId && installed.versionId !== file.version.id) {
        throw new Error(`${projectId} is already installed at a different version. Remove or update it separately before applying this bundle.`);
      }
    }

    const comparisonFiles = [...plannedFiles.entries()].map(([projectId, file]) => ({
      projectId: String(file.version.project_id || projectId),
      versionId: file.version.id,
      version: file.version,
    }));
    const installedModrinthEntries = (profile.mods || []).filter(mod => mod.enabled !== false
      && mod.type === 'mod' && mod.source === 'modrinth' && mod.id && mod.versionId
      && !plannedFiles.has(String(mod.id)));
    for (const mod of installedModrinthEntries) {
      const file = await resolveModrinthFile(mod.id, profile.mcVersion, profile.loader, 'mod', mod.versionId);
      comparisonFiles.push({
        projectId: String(file.version.project_id || mod.id),
        versionId: file.version.id,
        version: file.version,
      });
    }
    const conflicts = findModSetConflicts(comparisonFiles);
    if (conflicts.length) {
      throw new Error(`The selected bundle conflicts with itself or enabled installed mods: ${conflicts.map(item => `${item.first} / ${item.second}`).join(', ')}.`);
    }

    const displayNames = new Map(Object.entries(OPTIMIZATION_PROJECT_SLUGS).map(([name, slug]) => [slug, name]));
    const fabricApiPath = getInstalledFilePath(profile, 'mod', 'Fabric API', false);
    stagingDirectory = path.join(path.dirname(fabricApiPath), `.bald-bundle-${crypto.randomUUID()}`);
    fs.mkdirSync(stagingDirectory, { recursive: true });
    const stagedFiles = [];
    const installedEntries = [];
    for (const [projectId, resolvedFile] of plannedFiles) {
      const existing = profile.mods.find(mod => mod.id === projectId && mod.enabled !== false);
      const existingPath = existing ? resolveInstalledContentPath(profile, existing, false) : null;
      if (existingPath && fs.existsSync(existingPath)) continue;
      const item = selectedItems.get(projectId);
      const name = projectId === 'fabric-api' ? 'Fabric API' : (item?.name || displayNames.get(projectId) || projectId);
      const entry = normalizeInstalledContent({
        ...(item || {}),
        id: projectId,
        name,
        type: 'mod',
        enabled: true,
        source: 'modrinth',
        bundleFor: rendererMode,
        versionId: resolvedFile.version.id,
        sha1: resolvedFile.hashes.sha1,
        sha512: resolvedFile.hashes.sha512,
      });
      const filePath = getInstalledFilePath(profile, entry.type, entry.name, false);
      const stagedPath = path.join(stagingDirectory, `${crypto.randomUUID()}.jar`);
      const actualHash = await downloadToFile(resolvedFile.url, stagedPath, entry.name);
      if (actualHash.toLowerCase() !== resolvedFile.hashes.sha1.toLowerCase()
        || (await hashFile(stagedPath, 'sha512')).toLowerCase() !== resolvedFile.hashes.sha512.toLowerCase()) {
        throw new Error(`Checksum verification failed for ${entry.name}.`);
      }
      stagedFiles.push({ stagedPath, targetPath: filePath });
      installedEntries.push(entry);
    }
    committedPaths = commitStagedFiles(stagedFiles);
    targetProfile.mods = [
      ...targetProfile.mods.filter(mod => !installedEntries.some(entry => entry.id === mod.id)),
      ...installedEntries,
    ];
    fs.rmSync(stagingDirectory, { recursive: true, force: true });
    stagingDirectory = null;
    scheduleStateWrite();
    return { ok: true, state: launcherState };
  } catch (error) {
    const rollbackErrors = [];
    for (const filePath of committedPaths.reverse()) {
      try {
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError.message);
      }
    }
    if (targetProfile && previousMods) targetProfile.mods = previousMods;
    if (stagingDirectory) {
      try {
        fs.rmSync(stagingDirectory, { recursive: true, force: true });
      } catch (cleanupError) {
        rollbackErrors.push(cleanupError.message);
      }
    }
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      error: rollbackErrors.length
        ? `${message} Rollback/cleanup was incomplete: ${rollbackErrors.join('; ')}`
        : message,
    };
  }
});

ipcMain.handle('launcher:create-profile', async (_event, payload) => {
  const now = Date.now();
  const id = createProfileId();
  const profile = normalizeProfile({
    ...payload,
    id,
    folderName: getProfileFolderName(payload?.name, id),
    createdAt: now,
    updatedAt: now,
    lastUsedAt: now,
  });
  launcherState.profiles.push(profile);
  launcherState.activeProfileId = profile.id;
  ensureLauncherGameFolders(getMinecraftRootFor(profile.id));
  applyProfileSyncToNewProfile(profile.id);
  scheduleStateWrite();
  if (profile.prewarmEnabled) requestJavaProfilePrewarm(profile.id);
  return launcherState;
});

ipcMain.handle('launcher:duplicate-profile', async (_event, payload) => {
  let duplicateRoot = null;
  try {
    const profileId = typeof payload === 'string' ? payload : payload?.profileId;
    const source = launcherState.profiles.find(item => item.id === profileId);
    if (!source) throw new Error('Profile not found');
    const requestedName = typeof payload === 'object' ? String(payload?.name || '').trim() : '';
    const duplicateName = requestedName.slice(0, 40) || `${source.name} Copy`;
    if (launcherState.profiles.some(item => item.name.toLowerCase() === duplicateName.toLowerCase())) throw new Error('A profile with that name already exists.');
    const duplicateId = createProfileId();
    const duplicate = normalizeProfile({
      ...JSON.parse(JSON.stringify(source)),
      id: duplicateId,
      name: duplicateName,
      folderName: getProfileFolderName(duplicateName, duplicateId),
      optimizationManaged: false,
      optimizationKind: null,
      optimizationSourceProfileId: null,
      optimizationSourceProfileName: null,
      oneClientPackVersionId: null,
      oneClientPackVersionNumber: null,
      optimizationWorldSetupComplete: false,
      optimizationSkippedMods: [],
      optimizationReady: false,
    });
    const sourceRoot = getMinecraftRootFor(source.id);
    duplicateRoot = getMinecraftRootFor(duplicate);
    if (fs.existsSync(duplicateRoot)) throw new Error('A profile with this generated ID already exists.');
    if (fs.existsSync(sourceRoot)) fs.cpSync(sourceRoot, duplicateRoot, { recursive: true, errorOnExist: true });
    else ensureLauncherGameFolders(duplicateRoot);
    launcherState.profiles.push(duplicate);
    launcherState.activeProfileId = duplicate.id;
    applyProfileSyncToNewProfile(duplicate.id);
    scheduleStateWrite();
    if (duplicate.prewarmEnabled) requestJavaProfilePrewarm(duplicate.id);
    return { ok: true, state: launcherState, profile: duplicate };
  } catch (error) {
    if (duplicateRoot) {
      try { fs.rmSync(duplicateRoot, { recursive: true, force: true }); } catch (_cleanupError) {}
    }
    return { ok: false, error: error instanceof Error ? error.message : String(error), state: launcherState };
  }
});

function getProfileContentPath(profile, entry) {
  return resolveInstalledContentPath(profile, entry, entry.enabled === false) || resolveInstalledContentPath(profile, entry, false);
}

async function resolveModrinthPackFile(entry, profile) {
  const versionParams = { game_versions: JSON.stringify([profile.mcVersion]), loaders: JSON.stringify([profile.loader]), limit: 50 };
  const response = await axios.get(`${MODRINTH_API}/project/${encodeURIComponent(entry.id)}/version`, { params: versionParams, timeout: 15000 });
  const versions = Array.isArray(response.data) ? response.data : [];
  const selected = (entry.versionId && versions.find(version => version.id === entry.versionId)) || versions.find(version => version.files?.some(file => file.primary && file.url)) || versions.find(version => version.files?.some(file => file.url));
  const file = selected?.files?.find(item => item.primary && item.url) || selected?.files?.find(item => item.url);
  if (!file?.url) throw new Error(`${entry.name} has no downloadable Modrinth file for ${profile.mcVersion}/${profile.loader}.`);
  return { url: file.url, fileName: file.filename, fileSize: Number(file.size) || null };
}

async function getMrpackDependencies(profile) {
  const dependencies = { minecraft: profile.mcVersion };
  const dependencyKey = {
    fabric: 'fabric-loader',
    quilt: 'quilt-loader',
    forge: 'forge',
    neoforge: 'neoforge',
  }[profile.loader];
  if (dependencyKey) {
    try {
      const versions = await getLoaderVersions(profile.mcVersion, profile.loader);
      const loaderVersion = profile.loaderVersion
        || versions.find(item => item.stable)?.version
        || versions[0]?.version;
      if (loaderVersion) dependencies[dependencyKey] = loaderVersion;
    } catch (_error) {
      emitStatus(`Could not resolve ${profile.loader} loader metadata; exporting Minecraft dependency only.`);
    }
  }
  return dependencies;
}

ipcMain.handle('launcher:export-modpack', async (_event, payload) => {
  const exportId = String(payload?.exportId || `export-${Date.now()}`);
  try {
    emitExportProgress(exportId, 3, 'Preparing Modrinth export');
    const profile = launcherState.profiles.find(item => item.id === payload?.profileId);
    if (!profile) throw new Error('Profile not found');
    const options = { mods: true, configs: true, resourcepacks: true, shaders: true, worlds: false, screenshots: false, ...(payload?.options || {}) };
    const root = getMinecraftRootFor(profile.id);
    const exportName = sanitizeFileName(payload?.name || profile.name) || 'Minecraft Pack';
    const version = String(payload?.version || '1.0.0').trim() || '1.0.0';
    const saveResult = await dialog.showSaveDialog({ title: 'Export Modpack', defaultPath: `${exportName}-${sanitizeFileName(version)}.mrpack`, filters: [{ name: 'Modrinth modpack', extensions: ['mrpack'] }] });
    if (saveResult.canceled || !saveResult.filePath) {
      emitExportProgress(exportId, 100, 'Export canceled');
      return { ok: false, canceled: true };
    }
    emitExportProgress(exportId, 8, 'Building Modrinth archive');
    emitStatus(`Preparing modpack ${exportName}...`);
    const zip = new AdmZip();
    const files = [];
    const warnings = [];
    const selectedPaths = Array.isArray(options.paths) ? options.paths : null;
    const resolveSelectedPath = async relativePath => {
      if (typeof relativePath !== 'string' || !relativePath || path.isAbsolute(relativePath)
        || relativePath.split(/[\\/]+/).includes('..')) return null;
      const resolvedRoot = fs.realpathSync(root);
      const sourcePath = path.resolve(resolvedRoot, relativePath);
      if (!isPathWithin(resolvedRoot, sourcePath) || !fs.existsSync(sourcePath)) return null;
      const realSourcePath = fs.realpathSync(sourcePath);
      if (!isPathWithin(resolvedRoot, realSourcePath)) {
        throw new Error(`Selected export path escapes the profile folder: ${relativePath}`);
      }
      await assertTreeHasNoSymlinks(sourcePath, `Selected export path "${relativePath}"`);
      return {
        sourcePath: realSourcePath,
        relativePath: path.relative(resolvedRoot, sourcePath).split(path.sep).join('/'),
      };
    };
    const copySelectedModrinthPath = async relativePath => {
      const selected = await resolveSelectedPath(relativePath);
      if (!selected) return;
      const destinationPath = path.posix.join('overrides', selected.relativePath);
      const stat = fs.statSync(selected.sourcePath);
      if (stat.isDirectory()) zip.addLocalFolder(selected.sourcePath, destinationPath);
      else if (stat.isFile()) {
        zip.addLocalFile(selected.sourcePath, path.posix.dirname(destinationPath), path.posix.basename(destinationPath));
      }
    };
    if (selectedPaths) {
      emitExportProgress(exportId, 18, `Including ${selectedPaths.length} selected folders`);
      for (const relativePath of selectedPaths) await copySelectedModrinthPath(relativePath);
    } else if (options.mods) {
      for (const entry of profile.mods.filter(item => item.type === 'mod' && item.enabled !== false)) {
        const installedPath = getProfileContentPath(profile, entry);
        if (!installedPath || !fs.existsSync(installedPath)) {
          warnings.push(`${entry.name}: installed file is missing`);
          continue;
        }
        const archiveName = path.basename(installedPath).replace(/\.disabled$/i, '');
        if (entry.source === 'modrinth' && entry.id && !entry.id.startsWith('local-')) {
          try {
            const remote = await resolveModrinthPackFile(entry, profile);
            const buffer = fs.readFileSync(installedPath);
            files.push({ path: `mods/${archiveName}`, hashes: { sha1: crypto.createHash('sha1').update(buffer).digest('hex'), sha512: crypto.createHash('sha512').update(buffer).digest('hex') }, downloads: [remote.url], fileSize: buffer.length });
          } catch (error) {
            warnings.push(`${entry.name}: ${error instanceof Error ? error.message : String(error)}`);
            zip.addLocalFile(installedPath, 'overrides', 'mods');
          }
        } else {
          warnings.push(`${entry.name}: local or non-Modrinth content is included as an override`);
          zip.addLocalFile(installedPath, 'overrides', 'mods');
        }
      }
    }
    const copyFolder = (folderName, enabled, archiveFolder) => {
      if (!enabled) return;
      const folder = path.join(root, folderName);
      if (!fs.existsSync(folder)) return;
      zip.addLocalFolder(folder, path.posix.join('overrides', archiveFolder));
    };
    if (!selectedPaths) {
      copyFolder('config', options.configs, 'config');
      copyFolder('datapacks', options.datapacks, 'datapacks');
      copyFolder('resourcepacks', options.resourcepacks, 'resourcepacks');
      copyFolder('shaderpacks', options.shaders, 'shaderpacks');
      copyFolder('screenshots', options.screenshots, 'screenshots');
      copyFolder('saves', options.worlds, 'saves');
    }
    const manifest = { formatVersion: 1, game: 'minecraft', versionId: profile.mcVersion, name: exportName, summary: String(payload?.description || '').slice(0, 2000), files, dependencies: await getMrpackDependencies(profile) };
    zip.addFile('modrinth.index.json', Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'));
    emitExportProgress(exportId, 86, 'Writing Modrinth archive');
    zip.writeZip(saveResult.filePath);
    const validation = new AdmZip(saveResult.filePath).getEntry('modrinth.index.json');
    if (!validation) throw new Error('The exported archive did not contain modrinth.index.json.');
    const exportedSize = fs.statSync(saveResult.filePath).size;
    if (exportedSize < 256) throw new Error('The exported Modrinth archive is incomplete.');
    emitExportProgress(exportId, 100, 'Modrinth export complete');
    emitStatus(`Modpack exported: ${path.basename(saveResult.filePath)}`);
    return { ok: true, path: saveResult.filePath, warnings, manifest };
  } catch (error) {
    emitExportProgress(exportId, 100, 'Export failed');
    return { ok: false, error: error instanceof Error ? error.message : 'Could not export the modpack.' };
  }
});

ipcMain.handle('launcher:reveal-profile', async (_event, profileId) => {
  const profile = launcherState.profiles.find(item => item.id === profileId);
  if (!profile) return { ok: false, error: 'Profile not found' };
  const root = getMinecraftRootFor(profile.id);
  ensureLauncherGameFolders(root);
  shell.showItemInFolder(root);
  return { ok: true, path: root };
});

ipcMain.handle('launcher:get-profile-export-inventory', async (_event, payload) => {
  try {
    const profile = launcherState.profiles.find(item => item.id === payload?.profileId);
    if (!profile) throw new Error('Profile not found');
    const root = getMinecraftRootFor(profile.id);
    ensureLauncherGameFolders(root);
    const entries = [];
    const preferredFolders = [
      ['mods', 'Mods', 'Installed content and local jars'],
      ['config', 'Config', 'Mod configuration files'],
      ['datapacks', 'Data packs', 'Data packs and world rules'],
      ['resourcepacks', 'Resource packs', 'Textures and visual packs'],
      ['shaderpacks', 'Shader packs', 'Shader configuration packs'],
      ['saves', 'Worlds', 'Saved worlds and local data'],
      ['screenshots', 'Screenshots', 'Captured screenshots'],
      ['logs', 'Logs', 'Minecraft and launcher log files'],
      ['crash-reports', 'Crash reports', 'Crash reports for diagnostics'],
      ['versions', 'Versions', 'Downloaded Minecraft and loader versions'],
      ['libraries', 'Libraries', 'Java library dependencies'],
      ['assets', 'Assets', 'Minecraft assets and resources'],
      ['natives', 'Natives', 'Platform-native libraries'],
    ];
    for (const [relativePath, label, description] of preferredFolders) {
      const absolutePath = path.join(root, relativePath);
      if (!fs.existsSync(absolutePath)) continue;
      const stat = fs.statSync(absolutePath);
      entries.push({
        id: relativePath,
        relativePath,
        label,
        description,
        kind: stat.isDirectory() ? 'folder' : 'file',
        sizeBytes: stat.isDirectory() ? 0 : stat.size,
      });
    }
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory() && !preferredFolders.some(([relativePath]) => relativePath === entry.name)) {
        const absolutePath = path.join(root, entry.name);
        entries.push({
          id: entry.name,
          relativePath: entry.name,
          label: entry.name,
          description: 'Additional profile folder',
          kind: 'folder',
          sizeBytes: 0,
        });
      } else if (entry.isFile()) {
        const absolutePath = path.join(root, entry.name);
        entries.push({
          id: entry.name,
          relativePath: entry.name,
          label: entry.name,
          description: 'Profile file',
          kind: 'file',
          sizeBytes: fs.statSync(absolutePath).size,
        });
      }
    }
    return { ok: true, entries };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error), entries: [] };
  }
});

ipcMain.handle('launcher:open-profile-mods-folder', async (_event, payload) => {
  try {
    const profile = launcherState.profiles.find(item => item.id === payload?.profileId);
    if (!profile) throw new Error('Profile not found');
    const modsPath = path.join(getMinecraftRootFor(profile.id), 'mods');
    fs.mkdirSync(modsPath, { recursive: true });
    if (process.platform === 'win32') execFile('explorer', [modsPath]);
    else if (process.platform === 'darwin') execFile('open', [modsPath]);
    else execFile('xdg-open', [modsPath]);
    return { ok: true, path: modsPath };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

async function readBaldProfileExport(sourcePath) {
  if (path.extname(sourcePath).toLowerCase() !== '.baldprofile') {
    return JSON.parse(await fs.promises.readFile(sourcePath, 'utf8'));
  }
  try {
    const archive = new AdmZip(sourcePath);
    const profileEntry = archive.getEntry('baldprofile.json');
    if (profileEntry) return JSON.parse(profileEntry.getData().toString('utf8'));
  } catch (_error) {}
  return JSON.parse(await fs.promises.readFile(sourcePath, 'utf8'));
}

function extractBaldProfileOverrides(sourcePath, root) {
  if (path.extname(sourcePath).toLowerCase() !== '.baldprofile') return;
  try {
    const archive = new AdmZip(sourcePath);
    for (const entry of archive.getEntries()) {
      if (entry.isDirectory || !entry.entryName.startsWith('overrides/')) continue;
      const relative = entry.entryName.slice('overrides/'.length).replace(/[\\\/]+/g, path.sep);
      if (!relative || relative.split(path.sep).includes('..')) continue;
      const destination = path.join(root, relative);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.writeFileSync(destination, entry.getData());
    }
  } catch (_error) {
    // Plain JSON Bald profile exports do not contain archive overrides.
  }
}

ipcMain.handle('launcher:export-profile', async (_event, profileId) => {
  const payload = typeof profileId === 'string' ? { profileId, format: 'bald' } : (profileId || {});
  const exportId = String(payload.exportId || `export-${Date.now()}`);
  try {
    emitExportProgress(exportId, 3, 'Preparing profile export');
    const profile = launcherState.profiles.find(item => item.id === payload.profileId);
    if (!profile) throw new Error('Profile not found');
    const format = String(payload.format || 'bald').toLowerCase();
    const options = {
      mods: true,
      configs: true,
      datapacks: true,
      resourcepacks: true,
      shaders: true,
      worlds: false,
      screenshots: false,
      ...(payload.options || {}),
    };
    const exportName = sanitizeFileName(payload.name || profile.name) || 'Bald Profile';
    const version = String(payload.version || '1.0.0').trim() || '1.0.0';
    const formatConfig = {
      bald: { title: 'Export Bald profile', name: 'Bald profile', extension: 'baldprofile' },
      curseforge: { title: 'Export CurseForge modpack', name: 'CurseForge modpack', extension: 'zip' },
      prism: { title: 'Export Prism or MultiMC instance', name: 'Prism/MultiMC instance', extension: 'zip' },
      lunar: { title: 'Export Lunar folder bundle', name: 'Lunar folder bundle', extension: 'zip' },
      dawn: { title: 'Export Dawn folder bundle', name: 'Dawn folder bundle', extension: 'zip' },
      oneclient: { title: 'Export OneClient folder bundle', name: 'OneClient folder bundle', extension: 'zip' },
      minecraft: { title: 'Export Minecraft folders', name: 'Minecraft folder archive', extension: 'zip' },
    }[format];
    if (!formatConfig) throw new Error(`Unsupported export format: ${format}`);
    const result = await dialog.showSaveDialog({
      title: formatConfig.title,
      defaultPath: `${exportName}-${sanitizeFileName(version)}.${formatConfig.extension}`,
      filters: [{ name: formatConfig.name, extensions: formatConfig.extension === 'lunarprofile.zip' ? ['zip'] : [formatConfig.extension] }],
    });
    if (result.canceled || !result.filePath) {
      emitExportProgress(exportId, 100, 'Export canceled');
      return { ok: false, canceled: true };
    }
    const root = getMinecraftRootFor(profile.id);
    const zip = new AdmZip();
    const warnings = [];
    const copyFolder = (folderName, enabled, archivePrefix) => {
      if (!enabled) return;
      const folder = path.join(root, folderName);
      if (!fs.existsSync(folder)) return;
      zip.addLocalFolder(folder, archivePrefix);
    };
    const resolveSelectedPath = async relativePath => {
      if (typeof relativePath !== 'string' || !relativePath || path.isAbsolute(relativePath)
        || relativePath.split(/[\\/]+/).includes('..')) return null;
      const resolvedRoot = fs.realpathSync(root);
      const sourcePath = path.resolve(resolvedRoot, relativePath);
      if (!isPathWithin(resolvedRoot, sourcePath) || !fs.existsSync(sourcePath)) return null;
      const realSourcePath = fs.realpathSync(sourcePath);
      if (!isPathWithin(resolvedRoot, realSourcePath)) {
        throw new Error(`Selected export path escapes the profile folder: ${relativePath}`);
      }
      await assertTreeHasNoSymlinks(sourcePath, `Selected export path "${relativePath}"`);
      return {
        sourcePath: realSourcePath,
        relativePath: path.relative(resolvedRoot, sourcePath).split(path.sep).join('/'),
      };
    };
    const copySelectedPath = async (relativePath, archivePrefix) => {
      const selected = await resolveSelectedPath(relativePath);
      if (!selected) return;
      const destinationPath = path.posix.join(archivePrefix.replace(/\\/g, '/'), selected.relativePath);
      const stat = fs.statSync(selected.sourcePath);
      if (stat.isDirectory()) zip.addLocalFolder(selected.sourcePath, destinationPath);
      else if (stat.isFile()) {
        zip.addLocalFile(selected.sourcePath, path.posix.dirname(destinationPath), path.posix.basename(destinationPath));
      }
    };
    if (format === 'bald') {
      zip.addFile('baldprofile.json', Buffer.from(JSON.stringify({
        format: 'baldprofile',
        schemaVersion: BALD_PROFILE_SCHEMA_VERSION,
        exportedAt: new Date().toISOString(),
        profile: JSON.parse(JSON.stringify(profile)),
        references: { profileRoot: 'profiles/<profile-id>', content: profile.mods.map(item => ({ id: item.id, name: item.name, source: item.source || null, fileName: item.fileName || null })) },
        includedFolders: Object.keys(options).filter(key => options[key]),
      }, null, 2), 'utf8'));
      copyFolder('mods', options.mods, 'overrides/mods');
      copyFolder('config', options.configs, 'overrides/config');
      copyFolder('datapacks', options.datapacks, 'overrides/datapacks');
      copyFolder('resourcepacks', options.resourcepacks, 'overrides/resourcepacks');
      copyFolder('saves', options.worlds, 'overrides/saves');
      copyFolder('screenshots', options.screenshots, 'overrides/screenshots');
      copyFolder('shaderpacks', options.shaders, 'overrides/shaderpacks');
    } else if (format === 'curseforge') {
      zip.addFile('manifest.json', Buffer.from(JSON.stringify({
        minecraft: { version: profile.mcVersion, modLoaders: [{ id: `${profile.loader}-${profile.loaderVersion || 'latest'}`, primary: true }] },
        manifestType: 'minecraftModpack',
        manifestVersion: 1,
        name: exportName,
        version,
        author: 'Bald Launcher',
        files: [],
        overrides: 'overrides',
      }, null, 2), 'utf8'));
      copyFolder('mods', options.mods, 'overrides/mods');
      copyFolder('config', options.configs, 'overrides/config');
      copyFolder('datapacks', options.datapacks, 'overrides/datapacks');
      copyFolder('resourcepacks', options.resourcepacks, 'overrides/resourcepacks');
      copyFolder('saves', options.worlds, 'overrides/saves');
      copyFolder('screenshots', options.screenshots, 'overrides/screenshots');
      copyFolder('shaderpacks', options.shaders, 'overrides/shaderpacks');
    } else if (format === 'prism') {
      zip.addFile('instance.cfg', Buffer.from([
        `InstanceType=OneSix`,
        `name=${exportName}`,
        `OverrideCommands=true`,
        `UseCustomJava=false`,
      ].join('\n'), 'utf8'));
      const components = [{ uid: 'net.minecraft', version: profile.mcVersion }];
      if (profile.loader && profile.loader !== 'vanilla') components.push({ uid: `org.${profile.loader}`, version: profile.loaderVersion || 'latest' });
      zip.addFile('mmc-pack.json', Buffer.from(JSON.stringify({ formatVersion: 1, components }, null, 2), 'utf8'));
      copyFolder('mods', options.mods, '.minecraft/mods');
      copyFolder('config', options.configs, '.minecraft/config');
      copyFolder('datapacks', options.datapacks, '.minecraft/datapacks');
      copyFolder('resourcepacks', options.resourcepacks, '.minecraft/resourcepacks');
      copyFolder('saves', options.worlds, '.minecraft/saves');
      copyFolder('screenshots', options.screenshots, '.minecraft/screenshots');
      copyFolder('shaderpacks', options.shaders, '.minecraft/shaderpacks');
    } else if (format === 'lunar') {
      zip.addFile('lunar-profile.json', Buffer.from(JSON.stringify({ name: exportName, minecraftVersion: profile.mcVersion, loader: profile.loader, loaderVersion: profile.loaderVersion || null }, null, 2), 'utf8'));
      copyFolder('mods', options.mods, '.minecraft/mods');
      copyFolder('config', options.configs, '.minecraft/config');
      copyFolder('datapacks', options.datapacks, '.minecraft/datapacks');
      copyFolder('resourcepacks', options.resourcepacks, '.minecraft/resourcepacks');
      copyFolder('saves', options.worlds, '.minecraft/saves');
      copyFolder('screenshots', options.screenshots, '.minecraft/screenshots');
      copyFolder('shaderpacks', options.shaders, '.minecraft/shaderpacks');
    } else if (format === 'dawn') {
      zip.addFile('dawn-profile.json', Buffer.from(JSON.stringify({
        name: exportName,
        version,
        minecraftVersion: profile.mcVersion,
        loader: profile.loader,
        loaderVersion: profile.loaderVersion || null,
        source: 'bald-launcher',
      }, null, 2), 'utf8'));
      copyFolder('mods', options.mods, '.minecraft/mods');
      copyFolder('config', options.configs, '.minecraft/config');
      copyFolder('datapacks', options.datapacks, '.minecraft/datapacks');
      copyFolder('resourcepacks', options.resourcepacks, '.minecraft/resourcepacks');
      copyFolder('saves', options.worlds, '.minecraft/saves');
      copyFolder('screenshots', options.screenshots, '.minecraft/screenshots');
      copyFolder('shaderpacks', options.shaders, '.minecraft/shaderpacks');
    } else if (format === 'oneclient') {
      zip.addFile('oneclient-profile.json', Buffer.from(JSON.stringify({
        name: exportName,
        version,
        minecraftVersion: profile.mcVersion,
        loader: profile.loader,
        loaderVersion: profile.loaderVersion || null,
        source: 'bald-launcher',
      }, null, 2), 'utf8'));
      copyFolder('mods', options.mods, '.minecraft/mods');
      copyFolder('config', options.configs, '.minecraft/config');
      copyFolder('datapacks', options.datapacks, '.minecraft/datapacks');
      copyFolder('resourcepacks', options.resourcepacks, '.minecraft/resourcepacks');
      copyFolder('saves', options.worlds, '.minecraft/saves');
      copyFolder('screenshots', options.screenshots, '.minecraft/screenshots');
      copyFolder('shaderpacks', options.shaders, '.minecraft/shaderpacks');
    } else if (format === 'minecraft') {
      copyFolder('mods', options.mods, 'mods');
      copyFolder('config', options.configs, 'config');
      copyFolder('datapacks', options.datapacks, 'datapacks');
      copyFolder('resourcepacks', options.resourcepacks, 'resourcepacks');
      copyFolder('saves', options.worlds, 'saves');
      copyFolder('screenshots', options.screenshots, 'screenshots');
      copyFolder('shaderpacks', options.shaders, 'shaderpacks');
    }
    if (Array.isArray(options.paths)) {
      emitExportProgress(exportId, 72, `Including ${options.paths.length} selected item${options.paths.length === 1 ? '' : 's'}`);
      const archivePrefix = ['bald','curseforge'].includes(format)
        ? 'overrides'
        : ['prism','lunar','dawn','oneclient'].includes(format)
          ? '.minecraft'
          : '';
      for (const relativePath of options.paths) {
        await copySelectedPath(relativePath, archivePrefix);
      }
    }
    emitExportProgress(exportId, 88, 'Writing export archive');
    zip.writeZip(result.filePath);
    const validation = new AdmZip(result.filePath);
    if (!validation.getEntries().length) throw new Error('The exported archive was empty.');
    if (fs.statSync(result.filePath).size < 256) throw new Error('The exported archive is incomplete.');
    emitExportProgress(exportId, 100, 'Export complete');
    emitStatus(`Profile exported: ${path.basename(result.filePath)}`);
    return { ok: true, path: result.filePath, warnings };
  } catch (error) {
    emitExportProgress(exportId, 100, 'Export failed');
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle('launcher:import-profile', async () => {
  if (profileImportInProgress) return { ok: false, error: 'A profile import is already in progress.' };
  profileImportInProgress = true;
  let createdRoot = '';
  try {
    emitStatus('Importing profile · choosing file...');
    emitProfileImportProgress({ phase: 'select', message: 'Choose a profile or modpack to import', percent: 0 });
    const result = await dialog.showOpenDialog({
      title: 'Import profile or Modrinth modpack',
      properties: ['openFile'],
      filters: [{ name: 'Profile or Modrinth modpack', extensions: ['baldprofile', 'mrpack'] }],
    });
    if (result.canceled || !result.filePaths[0]) {
      emitStatus('Ready');
      return { ok: false, canceled: true };
    }
    const sourcePath = result.filePaths[0];
    const isMrpack = path.extname(sourcePath).toLowerCase() === '.mrpack';
    if (isMrpack) {
      const sourceStats = fs.statSync(sourcePath);
      const twoGb = 2 * 1024 * 1024 * 1024;
      if (sourceStats.size > twoGb) {
        const confirmation = await dialog.showMessageBox(mainWindow, {
          type: 'warning',
          title: 'Large profile import',
          message: 'This profile import file is larger than 2 GB.',
          detail: `The selected file is ${(sourceStats.size / 1024 ** 3).toFixed(2)} GB. Extracted files can require substantially more disk space than the archive. Progress will count files, not bytes. Do you want to proceed?`,
          buttons: ['Proceed', 'Cancel'],
          defaultId: 0,
          cancelId: 1,
          noLink: true,
        });
        if (confirmation.response !== 0) {
          emitStatus('Ready');
          return { ok: false, canceled: true };
        }
      }
      emitStatus(`Importing profile · reading archive · ${path.basename(sourcePath)}`);
      emitProfileImportProgress({ phase: 'read', message: 'Reading modpack manifest', percent: 2 });
      const index = JSON.parse((await readMrpackEntry(sourcePath, 'modrinth.index.json')).toString('utf8'));
      if (index.game !== 'minecraft' || Number(index.formatVersion) !== 1) throw new Error('Unsupported Modrinth modpack format.');
      const dependencies = index.dependencies || {};
      const mcVersion = String(dependencies.minecraft || '');
      if (!/^\d+\.\d+(?:\.\d+)?(?:[-+].*)?$/.test(mcVersion)) throw new Error('The modpack does not specify a valid Minecraft version.');
      const loaderKey = Object.keys(dependencies).find(key => ['fabric-loader', 'forge', 'neoforge', 'quilt-loader'].includes(key));
      const now = Date.now();
      const imported = normalizeProfile({
        id: createProfileId(),
        name: `${String(index.name || path.basename(sourcePath, '.mrpack')).slice(0, 40)} Import`,
        mcVersion,
        loader: loaderKey?.replace(/-loader$/, '') || 'fabric',
        createdAt: now,
        updatedAt: now,
        lastUsedAt: now,
        mods: [],
      });
      imported.folderName = getProfileFolderName(imported.name, imported.id);
      createdRoot = getMinecraftRootFor(imported);
      ensureLauncherGameFolders(createdRoot);
      const files = Array.isArray(index.files) ? index.files : [];
      emitProfileImportProgress({ phase: 'extract-scan', message: 'Scanning archive and estimating disk space', percent: null });
      const archiveInfo = await inspectMrpackOverrides(sourcePath, progress => {
        emitProfileImportProgress({
          phase: 'extract-scan',
          message: `Scanning archive · ${progress.scanned.toLocaleString()} entries checked`,
          percent: null,
        });
      });
      let expectedDownloadBytes = 0;
      let unknownDownloadSizes = 0;
      for (const file of files) {
        const size = Number(file.fileSize);
        if (Number.isSafeInteger(size) && size >= 0) {
          expectedDownloadBytes += size;
          if (!Number.isSafeInteger(expectedDownloadBytes)) throw new Error('The modpack declares an invalid total download size.');
        }
        else unknownDownloadSizes += 1;
      }
      const unknownSizeAllowance = unknownDownloadSizes ? sourceStats.size : 0;
      const requiredBytes = Math.ceil((archiveInfo.uncompressedBytes + expectedDownloadBytes + unknownSizeAllowance) * 1.1);
      let freeBytes = null;
      if (fs.statfsSync) {
        try {
          const stats = fs.statfsSync(createdRoot);
          freeBytes = stats.bsize * stats.bavail;
        } catch (error) {
          console.warn('[Profile import] Could not determine destination disk space.', error);
        }
      }
      if (freeBytes !== null && freeBytes < requiredBytes) {
        throw new Error(`Not enough free disk space for this import. It may need approximately ${(requiredBytes / 1024 ** 3).toFixed(1)} GB; ${(freeBytes / 1024 ** 3).toFixed(1)} GB is available.`);
      }
      const warnings = [];
      const projectCache = new Map();
      const getProject = async projectId => {
        if (!projectId) return null;
        if (!projectCache.has(projectId)) {
          projectCache.set(projectId, axios.get(`${MODRINTH_API}/project/${encodeURIComponent(projectId)}`, {
            timeout: 10000,
            headers: { 'User-Agent': 'BaldLauncher/0.1.0 (contact: none)' },
          }).then(response => response.data).catch(() => null));
        }
        return projectCache.get(projectId);
      };
      emitStatus(`Importing profile · downloading 0/${files.length} files`);
      const downloadResults = await runProfileImportDownloads({
        files,
        destinationRoot: createdRoot,
        concurrency: sourceStats.size > twoGb ? 2 : 4,
        onProgress: progress => {
          const percent = Math.min(88, Math.floor(4 + ((progress.percent / 100) * 84)));
          const fileLabel = progress.currentFile ? ` · ${path.basename(progress.currentFile)}` : '';
          emitProfileImportProgress({
            phase: 'download',
            message: `Downloading ${progress.completed}/${progress.total} files${progress.active > 1 ? ` · ${progress.active} active` : ''}${fileLabel}`,
            percent,
            completed: progress.completed,
            total: progress.total,
            active: progress.active,
          });
          emitStatus(`Importing profile · downloading ${progress.completed}/${progress.total} files${fileLabel}`);
        },
        downloadFile: async (file, destination, onTransfer) => {
          const url = Array.isArray(file.downloads) ? file.downloads.find(item => /^https?:\/\//i.test(item)) : '';
          if (!url) throw new Error('No download URL');
          const response = await axios.get(url, {
            responseType: 'stream',
            timeout: 30000,
            maxContentLength: Infinity,
            maxBodyLength: Infinity,
            headers: { 'User-Agent': 'BaldLauncher/0.1.0 (contact: none)' },
          });
          const temporaryPath = `${destination}.${crypto.randomUUID()}.download`;
          const expected = String(file.hashes?.sha1 || '').toLowerCase();
          const hash = crypto.createHash('sha1');
          const totalBytes = Number(response.headers['content-length']) || 0;
          let loadedBytes = 0;
          const meter = new Transform({
            transform(chunk, _encoding, callback) {
              loadedBytes += chunk.length;
              hash.update(chunk);
              onTransfer({ loaded: loadedBytes, total: totalBytes });
              callback(null, chunk);
            },
          });
          try {
            await fs.promises.mkdir(path.dirname(destination), { recursive: true });
            await pipeline(response.data, meter, fs.createWriteStream(temporaryPath, { flags: 'wx' }));
            if (expected && hash.digest('hex').toLowerCase() !== expected) {
              throw new Error('SHA-1 verification failed');
            }
            await fs.promises.rename(temporaryPath, destination);
          } catch (error) {
            await fs.promises.rm(temporaryPath, { force: true }).catch(cleanupError => {
              console.warn('[Profile import] Could not remove partial download.', cleanupError);
            });
            throw error;
          }
        },
      });
      const importedModResults = downloadResults.filter(result => (
        !result.error
        && result.relative.toLowerCase().startsWith('mods/')
        && result.relative.toLowerCase().endsWith('.jar')
      ));
      emitProfileImportProgress({ phase: 'metadata', message: 'Registering imported mods', percent: null });
      for (const result of downloadResults) {
        if (result.error) warnings.push(`${result.relative}: ${result.error}`);
      }
      let metadataIndex = 0;
      const importedModEntries = new Array(importedModResults.length);
      const metadataWorkers = Array.from({ length: Math.min(6, importedModResults.length) }, async () => {
        while (metadataIndex < importedModResults.length) {
          const index = metadataIndex++;
          const result = importedModResults[index];
          const url = Array.isArray(result.file.downloads) ? result.file.downloads.find(item => /^https?:\/\//i.test(item)) : '';
          const match = url.match(/\/data\/([^/]+)\/versions\/([^/?]+)/i);
          const project = await getProject(match?.[1]);
          importedModEntries[index] = normalizeInstalledContent({
            id: match?.[1] || `local-${crypto.randomUUID()}`,
            name: project?.title || path.basename(result.relative, '.jar'),
            slug: project?.slug || '',
            type: 'mod',
            fileName: path.basename(result.relative),
            source: project ? 'modrinth' : '',
            projectUrl: project?.slug ? `https://modrinth.com/mod/${encodeURIComponent(project.slug)}` : '',
            iconUrl: project?.icon_url || null,
            versionId: match?.[2] || '',
            installedVersion: '',
            enabled: true,
          });
        }
      });
      await Promise.all(metadataWorkers);
      imported.mods.push(...importedModEntries);
      emitStatus('Importing profile · extracting included files...');
      emitProfileImportProgress({ phase: 'extract', message: 'Extracting included files · progress counts archive entries', percent: 88 });
      await extractMrpackOverrides(sourcePath, createdRoot, progress => {
        if (progress.phase === 'scan') {
          emitProfileImportProgress({
            phase: 'extract-scan',
            message: `Scanning archive · ${progress.scanned.toLocaleString()} entries checked`,
            percent: null,
          }, archiveInfo);
          return;
        }
        const percent = Math.min(95, 88 + Math.floor((progress.percent / 100) * 7));
        emitProfileImportProgress({
          phase: 'extract',
          message: `Extracting included files · ${progress.completed.toLocaleString()}/${progress.total.toLocaleString()} archive entries`,
          percent,
          completed: progress.completed,
          total: progress.total,
        });
        emitStatus(`Importing profile · extracting ${progress.completed}/${progress.total} entries`);
      });
      emitProfileImportProgress({ phase: 'finalize', message: 'Finishing profile setup', percent: 96 });
      launcherState.profiles.push(imported);
      launcherState.activeProfileId = imported.id;
      applyProfileSyncToNewProfile(imported.id);
      scheduleStateWrite();
      emitStatus(`Profile imported · ${imported.name}`);
      emitProfileImportProgress({ phase: 'complete', message: `Imported ${imported.name}`, percent: 100 });
      return { ok: true, state: launcherState, profile: imported, warnings };
    }
    emitStatus(`Importing profile · reading ${path.basename(sourcePath)}`);
    emitProfileImportProgress({ phase: 'read', message: 'Reading profile export', percent: 20 });
    const exportedPayload = await readBaldProfileExport(sourcePath);
    const imported = validateProfileExport(exportedPayload);
    const originalName = imported.name;
    imported.id = createProfileId();
    imported.name = `${originalName} Import`;
    imported.folderName = getProfileFolderName(imported.name, imported.id);
    const root = getMinecraftRootFor(imported);
    if (fs.existsSync(root)) throw new Error('The imported profile destination already exists.');
    ensureLauncherGameFolders(root);
    extractBaldProfileOverrides(sourcePath, root);
    launcherState.profiles.push(imported);
    launcherState.activeProfileId = imported.id;
    applyProfileSyncToNewProfile(imported.id);
    scheduleStateWrite();
    emitStatus(`Profile imported · ${imported.name}`);
    emitProfileImportProgress({ phase: 'complete', message: `Imported ${imported.name}`, percent: 100 });
    return { ok: true, state: launcherState, profile: imported };
  } catch (error) {
    let message = error instanceof Error ? error.message : String(error);
    if (createdRoot && fs.existsSync(createdRoot)) {
      try {
        await fs.promises.rm(createdRoot, { recursive: true, force: true });
      } catch (cleanupError) {
        console.error(`[Profile import] Could not clean up failed import at ${createdRoot}.`, cleanupError);
        message += ` The incomplete import could not be removed: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`;
      }
    }
    emitStatus(`Profile import failed · ${message}`);
    emitProfileImportProgress({ phase: 'error', message, percent: null });
    return { ok: false, error: message, state: launcherState };
  } finally {
    profileImportInProgress = false;
    setTimeout(() => emitProfileImportProgress({ phase: 'finished' }), 800);
  }
});

ipcMain.handle('launcher:backup-profile', async (_event, profileId) => {
  try {
    const profile = launcherState.profiles.find(item => item.id === profileId);
    if (!profile) throw new Error('Profile not found');
    const sourceRoot = getMinecraftRootFor(profile.id);
    if (!fs.existsSync(sourceRoot)) ensureLauncherGameFolders(sourceRoot);
    const backupRoot = path.join(getProfileBackupRoot(profile.id), new Date().toISOString().replace(/[:.]/g, '-'));
    fs.mkdirSync(path.dirname(backupRoot), { recursive: true });
    fs.cpSync(sourceRoot, backupRoot, { recursive: true, errorOnExist: true });
    fs.writeFileSync(path.join(backupRoot, 'profile.json'), JSON.stringify(profile, null, 2), 'utf8');
    return { ok: true, path: backupRoot };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

const PROFILE_SYNC_CATEGORIES = Object.freeze({
  options: ['options.txt'],
  keybinds: ['options.txt'],
  servers: ['servers.dat'],
  resourcepacks: ['resourcepacks'],
  shaders: ['shaderpacks'],
  screenshots: ['screenshots'],
  worlds: ['saves'],
  configs: ['config'],
});

function collectProfileSyncFiles(root, category) {
  const entries = PROFILE_SYNC_CATEGORIES[category] || [];
  const files = [];
  for (const entry of entries) {
    const absolute = path.join(root, entry);
    if (!fs.existsSync(absolute)) continue;
    const stat = fs.statSync(absolute);
    const walk = (current, relative) => {
      const currentStat = fs.statSync(current);
      if (currentStat.isDirectory()) {
        for (const child of fs.readdirSync(current)) walk(path.join(current, child), path.join(relative, child));
      } else if (currentStat.isFile()) {
        files.push({ category, relative: relative.replace(/\\/g, '/'), size: currentStat.size });
      }
    };
    walk(absolute, entry);
  }
  return files;
}

function validateProfileSyncProfiles(payload) {
  const source = launcherState.profiles.find(profile => profile.id === String(payload?.sourceProfileId || ''));
  const destination = launcherState.profiles.find(profile => profile.id === String(payload?.destinationProfileId || ''));
  if (!source || !destination) throw new Error('Select a valid source and destination profile.');
  if (source.id === destination.id) throw new Error('Source and destination profiles must be different.');
  const categories = [...new Set(Array.isArray(payload?.categories) ? payload.categories.map(String) : [])]
    .filter(category => Object.prototype.hasOwnProperty.call(PROFILE_SYNC_CATEGORIES, category));
  if (!categories.length) throw new Error('Select at least one synchronization category.');
  return { source, destination, categories };
}

ipcMain.handle('launcher:preview-profile-sync', async (_event, payload = {}) => {
  try {
    const { source, destination, categories } = validateProfileSyncProfiles(payload);
    const sourceRoot = getMinecraftRootFor(source.id);
    const destinationRoot = getMinecraftRootFor(destination.id);
    const files = [...new Map(categories.flatMap(category => collectProfileSyncFiles(sourceRoot, category))
      .map(file => [file.relative, file])).values()].map(file => ({
      ...file,
      conflict: fs.existsSync(path.join(destinationRoot, file.relative)),
    }));
    return {
      ok: true,
      sourceProfileId: source.id,
      destinationProfileId: destination.id,
      categories,
      files,
      totalBytes: files.reduce((sum, file) => sum + file.size, 0),
      conflicts: files.filter(file => file.conflict).length,
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle('launcher:apply-profile-sync', async (_event, payload = {}) => {
  try {
    const preview = validateProfileSyncProfiles(payload);
    const sourceRoot = getMinecraftRootFor(preview.source.id);
    const destinationRoot = getMinecraftRootFor(preview.destination.id);
    const selections = Array.isArray(payload.files) ? payload.files : [];
    let copied = 0;
    let skipped = 0;
    for (const selected of selections) {
      const relative = String(selected?.relative || '').replace(/\//g, path.sep);
      const sourcePath = path.resolve(sourceRoot, relative);
      const destinationPath = path.resolve(destinationRoot, relative);
      if (sourcePath !== sourceRoot && !sourcePath.startsWith(sourceRoot + path.sep)) throw new Error('Invalid source path.');
      if (destinationPath !== destinationRoot && !destinationPath.startsWith(destinationRoot + path.sep)) throw new Error('Invalid destination path.');
      if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) continue;
      if (selected.action === 'skip') { skipped += 1; continue; }
      if (selected.action !== 'replace' && selected.action !== 'copy') throw new Error(`Invalid sync action for ${selected.relative}.`);
      fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
      fs.copyFileSync(sourcePath, destinationPath);
      copied += 1;
    }
    return { ok: true, copied, skipped, sourceProfileId: preview.source.id, destinationProfileId: preview.destination.id };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

const PROFILE_SYNC_SOURCE_PATHS = Object.freeze({
  options: 'options.txt',
  keybinds: 'options.txt',
  servers: 'servers.dat',
  resourcepacks: 'resourcepacks',
  shaders: 'shaderpacks',
  screenshots: 'screenshots',
  worlds: 'saves',
  configs: 'config',
});

function getConfiguredSyncSource(category, config) {
  if (config.sourceMode === 'manual') return config.manualPaths[category] || '';
  const source = launcherState.profiles.find(profile => profile.id === config.sourceProfileId);
  return source ? path.join(getMinecraftRootFor(source.id), PROFILE_SYNC_SOURCE_PATHS[category]) : '';
}

function syncConfiguredFiles(destinationProfileIds, config) {
  const categories = config.categories.filter(category => PROFILE_SYNC_SOURCE_PATHS[category]);
  let copied = 0;
  for (const destinationId of destinationProfileIds) {
    const destination = launcherState.profiles.find(profile => profile.id === destinationId);
    if (!destination) continue;
    const destinationRoot = getMinecraftRootFor(destination.id);
    for (const category of categories) {
      const sourcePath = getConfiguredSyncSource(category, config);
      if (!sourcePath || !fs.existsSync(sourcePath)) continue;
      const destinationPath = path.join(destinationRoot, PROFILE_SYNC_SOURCE_PATHS[category]);
      if (path.resolve(sourcePath) === path.resolve(destinationPath)) {
        throw new Error(`The source and destination are the same for ${category}.`);
      }
      fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
      fs.rmSync(destinationPath, { recursive: true, force: true });
      fs.cpSync(sourcePath, destinationPath, { recursive: true, force: true });
      copied += 1;
    }
  }
  return copied;
}

async function syncConfiguredFilesToHorizon(instanceIds, config) {
  if (!instanceIds.length) return { copiedGroups: 0, copiedFiles: 0, skippedFiles: 0 };
  const selectedCategories = config.horizonCategories.filter(category => (
    ['options', 'keybinds', 'resourcepacks'].includes(category)
  ));
  if (!selectedCategories.length) throw new Error('Select at least one supported Horizon synchronization category.');
  const instances = await getHorizonInstances();
  const roots = getHorizonPaths(app.getPath('userData'));
  let copiedGroups = 0;
  let copiedFiles = 0;
  let skippedFiles = 0;
  for (const instanceId of instanceIds) {
    const instance = instances.find(item => item.id === instanceId);
    if (!instance || instance.java) throw new Error(`Horizon profile "${instanceId}" was not found.`);
    if (horizonProcesses.has(instance.id)) throw new Error(`Stop Horizon profile "${instance.name}" before synchronizing it.`);
    const instanceHome = path.resolve(instance.home);
    const gameHome = path.resolve(roots.gameHome);
    if (!isPathWithin(gameHome, instanceHome)) {
      throw new Error(`Horizon profile "${instance.name}" is outside Bald Launcher's isolated Horizon data folder.`);
    }
    if (!fs.existsSync(instanceHome)) throw new Error(`Horizon profile folder is missing: ${instanceHome}`);
    if (!isPathWithin(fs.realpathSync(gameHome), fs.realpathSync(instanceHome))) {
      throw new Error(`Horizon profile "${instance.name}" resolves outside Bald Launcher's isolated Horizon data folder.`);
    }
    const instanceHomeStat = fs.lstatSync(instanceHome);
    if (!instanceHomeStat.isDirectory() || instanceHomeStat.isSymbolicLink()) {
      throw new Error(`Horizon profile folder is not a regular directory: ${instanceHome}`);
    }
    const sourceOptionsPath = getConfiguredSyncSource('options', config);
    if (selectedCategories.some(category => ['options', 'keybinds'].includes(category))) {
      if (!sourceOptionsPath || !fs.existsSync(sourceOptionsPath)) {
        throw new Error('The selected source does not have an options.txt file to synchronize.');
      }
      const sourceStat = fs.lstatSync(sourceOptionsPath);
      if (!sourceStat.isFile() || sourceStat.isSymbolicLink()) {
        throw new Error('The selected source options.txt must be a regular file.');
      }
      const destinationOptionsPath = path.join(instanceHome, 'options.txt');
      if (fs.existsSync(destinationOptionsPath)
          && (!fs.lstatSync(destinationOptionsPath).isFile() || fs.lstatSync(destinationOptionsPath).isSymbolicLink())) {
        throw new Error(`The Horizon options path is not a regular file: ${destinationOptionsPath}`);
      }
      const merged = mergeHorizonOptions(
        fs.readFileSync(sourceOptionsPath, 'utf8'),
        fs.existsSync(destinationOptionsPath) ? fs.readFileSync(destinationOptionsPath, 'utf8') : '',
        selectedCategories,
      );
      if (merged.merged.length) {
        fs.mkdirSync(instanceHome, { recursive: true });
        const temporaryPath = `${destinationOptionsPath}.${crypto.randomUUID()}.tmp`;
        try {
          fs.writeFileSync(temporaryPath, merged.text, { encoding: 'utf8', flag: 'wx' });
          fs.renameSync(temporaryPath, destinationOptionsPath);
        } finally {
          if (fs.existsSync(temporaryPath)) fs.rmSync(temporaryPath, { force: true });
        }
        copiedGroups += 1;
        copiedFiles += merged.merged.length;
      }
    }
    if (selectedCategories.includes('resourcepacks')) {
      const sourcePacksPath = getConfiguredSyncSource('resourcepacks', config);
      if (sourcePacksPath && fs.existsSync(sourcePacksPath)) {
        const sourceStat = fs.lstatSync(sourcePacksPath);
        const destinationPacksPath = sourceStat.isDirectory()
          ? path.join(instanceHome, 'resourcepacks')
          : path.join(instanceHome, 'resourcepacks', path.basename(sourcePacksPath));
        const result = copyDirectoryWithoutOverwrite(sourcePacksPath, destinationPacksPath, instanceHome);
        if (result.copied) copiedGroups += 1;
        copiedFiles += result.copied;
        skippedFiles += result.skipped;
      }
    }
  }
  return { copiedGroups, copiedFiles, skippedFiles };
}

function applyProfileSyncToNewProfile(profileId) {
  const config = normalizeProfileSync(launcherState.profileSync);
  if ((!config.syncNextNewProfile && !config.autoSyncEveryNewProfile) || profileId === config.sourceProfileId) return;
  try {
    syncConfiguredFiles([profileId], config);
    if (config.syncNextNewProfile && !config.autoSyncEveryNewProfile) {
      launcherState.profileSync = { ...config, syncNextNewProfile: false };
    }
  } catch (error) {
    emitStatus(`Profile synchronization failed · ${error instanceof Error ? error.message : String(error)}`);
  }
}

ipcMain.handle('launcher:configure-profile-sync', async (_event, payload = {}) => {
  try {
    const config = normalizeProfileSync({
      sourceMode: payload.sourceMode,
      sourceProfileId: payload.sourceProfileId,
      manualPaths: payload.manualPaths,
      categories: payload.categories,
      destinationProfileIds: payload.destinationProfileIds,
      horizonDestinationInstanceIds: payload.horizonDestinationInstanceIds,
      horizonCategories: payload.horizonCategories,
      syncNextNewProfile: payload.syncNextNewProfile,
      autoSyncEveryNewProfile: payload.autoSyncEveryNewProfile,
    });
    if (config.sourceMode === 'profile' && !launcherState.profiles.some(profile => profile.id === config.sourceProfileId)) {
      throw new Error('Select a valid source profile.');
    }
    if (config.destinationProfileIds.includes(config.sourceProfileId)) throw new Error('The source profile cannot also be a destination.');
    if (config.destinationProfileIds.length && !config.categories.length) {
      throw new Error('Select at least one Java synchronization category.');
    }
    if (config.horizonDestinationInstanceIds.length && !config.horizonCategories.length) {
      throw new Error('Select at least one supported Horizon synchronization category.');
    }
    if (config.sourceMode === 'manual') {
      const requiredCategories = [...new Set([
        ...config.categories,
        ...(config.horizonDestinationInstanceIds.length && config.horizonCategories.some(category => ['options', 'keybinds'].includes(category))
          ? ['options']
          : []),
        ...(config.horizonDestinationInstanceIds.length && config.horizonCategories.includes('resourcepacks') ? ['resourcepacks'] : []),
      ])];
      const missing = requiredCategories.filter(category => !config.manualPaths[category]);
      if (missing.length) throw new Error(`Choose a manual source path for: ${missing.join(', ')}.`);
      const unavailable = requiredCategories.filter(category => !fs.existsSync(config.manualPaths[category]));
      if (unavailable.length) throw new Error(`These manual source paths do not exist: ${unavailable.join(', ')}.`);
    }
    launcherState.profileSync = config;
    scheduleStateWrite();
    return { ok: true, profileSync: config };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle('launcher:run-profile-sync', async () => {
  try {
    const config = normalizeProfileSync(launcherState.profileSync);
    if (config.sourceMode === 'profile' && !launcherState.profiles.some(profile => profile.id === config.sourceProfileId)) throw new Error('Select a valid source profile.');
    if (!config.destinationProfileIds.length && !config.horizonDestinationInstanceIds.length) throw new Error('Select at least one destination profile.');
    if (config.destinationProfileIds.length && !config.categories.length) throw new Error('Select at least one Java synchronization category.');
    const copied = syncConfiguredFiles(config.destinationProfileIds, config);
    const horizon = await syncConfiguredFilesToHorizon(config.horizonDestinationInstanceIds, config);
    return {
      ok: true,
      copied: copied + horizon.copiedGroups,
      copiedFiles: horizon.copiedFiles,
      skippedFiles: horizon.skippedFiles,
      destinations: config.destinationProfileIds.length + config.horizonDestinationInstanceIds.length,
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle('launcher:restore-profile', async (_event, profileId) => {
  try {
    const profile = launcherState.profiles.find(item => item.id === profileId);
    if (!profile) throw new Error('Profile not found');
    const backupParent = getProfileBackupRoot(profile.id);
    const backups = fs.existsSync(backupParent) ? fs.readdirSync(backupParent, { withFileTypes: true }).filter(item => item.isDirectory()).sort((a, b) => b.name.localeCompare(a.name)) : [];
    const latest = backups[0] ? path.join(backupParent, backups[0].name) : null;
    if (!latest) throw new Error('No backup exists for this profile.');
    const root = getMinecraftRootFor(profile.id);
    fs.rmSync(root, { recursive: true, force: true });
    fs.cpSync(latest, root, { recursive: true, errorOnExist: true });
    const restoredProfilePath = path.join(root, 'profile.json');
    if (fs.existsSync(restoredProfilePath)) fs.rmSync(restoredProfilePath, { force: true });
    scheduleStateWrite();
    return { ok: true, path: latest, state: launcherState };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle('launcher:drop-profile-files', async (_event, payload = {}) => {
  try {
    const profile = launcherState.profiles.find(item => item.id === String(payload?.profileId || ''));
    if (!profile) throw new Error('Profile not found.');
    const sourcePaths = Array.isArray(payload?.sourcePaths) ? payload.sourcePaths : [];
    if (!sourcePaths.length) throw new Error('No files were provided.');
    if (sourcePaths.length > 50) throw new Error('Drop at most 50 items into a profile at a time.');
    const rootPath = getMinecraftRootFor(profile);
    const results = [];
    for (const sourcePath of sourcePaths) {
      const classification = classifyProfileDrop(String(sourcePath || ''));
      if (classification.type === 'unknown') {
        results.push({ sourcePath, ok: false, error: classification.reason, type: 'unknown' });
        continue;
      }
      try {
        const folderByType = {
          mods: 'mods',
          resourcepack: 'resourcepacks',
          shader: 'shaderpacks',
          world: 'saves',
          'world-archive': 'saves',
        };
        const destinationDirectory = path.join(rootPath, folderByType[classification.type]);
        fs.mkdirSync(rootPath, { recursive: true });
        fs.mkdirSync(destinationDirectory, { recursive: true });
        const rootRealPath = fs.realpathSync(rootPath);
        const destinationRealPath = fs.realpathSync(destinationDirectory);
        const relativeDestination = path.relative(rootRealPath, destinationRealPath);
        if (relativeDestination && (relativeDestination.startsWith('..') || path.isAbsolute(relativeDestination))) {
          throw new Error('The profile destination resolves outside the profile folder.');
        }
        const copies = classification.type === 'world-archive'
          ? [{ ok: true, destinationPath: extractWorldArchive(classification.sourcePaths[0], destinationDirectory) }]
          : classification.sourcePaths.map(item => ({ ok: true, destinationPath: copyPathWithoutOverwrite(item, destinationDirectory) }));
        results.push({
          sourcePath,
          type: classification.type,
          ok: true,
          destinations: copies.map(copy => path.relative(rootPath, copy.destinationPath).split(path.sep).join('/')),
        });
      } catch (error) {
        results.push({ sourcePath, type: classification.type, ok: false, error: error instanceof Error ? error.message : String(error) });
      }
    }
    return { ok: true, results };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle('launcher:import-local-content', async (_event, profileId) => {
  try {
    const profile = launcherState.profiles.find(item => item.id === profileId);
    if (!profile) throw new Error('Profile not found');
    const result = await dialog.showOpenDialog({ title: 'Import local Minecraft content', properties: ['openFile'], filters: [{ name: 'Minecraft content', extensions: ['jar'] }] });
    if (result.canceled || !result.filePaths[0]) return { ok: false, canceled: true };
    const sourcePath = result.filePaths[0];
    const fileName = path.basename(sourcePath);
    const header = Buffer.alloc(4);
    const handle = fs.openSync(sourcePath, 'r');
    fs.readSync(handle, header, 0, 4, 0);
    fs.closeSync(handle);
    if (header.toString('hex') !== '504b0304') throw new Error('The selected file is not a valid JAR or ZIP archive.');
    if (profile.loader === 'vanilla') throw new Error('A mod loader is required to import a local mod JAR.');
    const root = getMinecraftRootFor(profile.id);
    ensureLauncherGameFolders(root);
    const destination = path.join(root, 'mods', sanitizeFileName(fileName));
    if (fs.existsSync(destination)) throw new Error('A file with this name is already installed in this profile.');
    fs.copyFileSync(sourcePath, destination);
    const entry = normalizeInstalledContent({ id: `local-${crypto.randomUUID()}`, name: fileName.replace(/\.jar$/i, ''), type: 'mod', fileName, source: '', enabled: true });
    const index = launcherState.profiles.findIndex(item => item.id === profile.id);
    launcherState.profiles[index].mods.push(entry);
    scheduleStateWrite();
    return { ok: true, entry, state: launcherState };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle('launcher:update-profile', async (_event, payload) => {
  const idx = launcherState.profiles.findIndex(p => p.id === payload?.id);
  if (idx === -1) return { state: launcherState, rendererChanged: false, newRendererMode: null };
  if (payload?.loaderVersion !== undefined
    && String(payload.loaderVersion || '').trim()
    && !normalizeLoaderVersion(payload.loaderVersion)) {
    return { ok: false, error: 'Select a valid mod loader version.', state: launcherState };
  }

  const previous = launcherState.profiles[idx];
  if (previous.optimizationManaged
    && (String(payload?.mcVersion || previous.mcVersion) !== previous.mcVersion
      || String(payload?.loader || previous.loader).toLowerCase() !== previous.loader
      || (payload?.loaderVersion !== undefined
        && normalizeLoaderVersion(payload.loaderVersion) !== previous.loaderVersion)
      || String(payload?.rendererMode || previous.rendererMode) !== previous.rendererMode)) {
    return {
      ok: false,
      error: 'The Minecraft version and loader version of an isolated optimization profile are locked to its verified mod set. Duplicate the profile to customize it.',
      state: launcherState,
    };
  }
  const updated = normalizeProfile({
    ...previous,
    ...payload,
    ...(typeof payload?.prewarmEnabled === 'boolean' ? { prewarmOptIn: true } : {}),
    updatedAt: Date.now(),
    lastUsedAt: previous.lastUsedAt,
  });
  const rendererChanged = updated.rendererMode !== previous.rendererMode;

  if (rendererChanged) {
    // Auto-swap: uninstall whatever was tagged as belonging to the old
    // mode's bundle. Manually-added content (bundleFor === null) is left
    // alone. The new bundle is NOT installed here — the renderer asks the
    // user to confirm via a checklist (preview-bundle + apply-bundle) since
    // that's the agreed flow, not a silent install.
    for (const entry of updated.mods.filter(m => m.bundleFor === previous.rendererMode)) {
      for (const disabled of [false, true]) {
        const filePath = getInstalledFilePath(updated, entry.type, entry.name, disabled);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      }
    }
    updated.mods = updated.mods.filter(m => m.bundleFor !== previous.rendererMode);
  }

  launcherState.profiles[idx] = updated;
  scheduleStateWrite();
  return { state: launcherState, rendererChanged, newRendererMode: rendererChanged ? updated.rendererMode : null };
});

ipcMain.handle('launcher:delete-profile', async (_event, payload) => {
  if (launcherState.profiles.length <= 1) {
    return { ok: false, error: 'At least one profile must exist', state: launcherState };
  }
  const profileId = typeof payload === 'string' ? payload : payload?.profileId;
  const pendingPrewarm = javaPrewarmTasks.get(String(profileId || ''));
  if (pendingPrewarm) await pendingPrewarm;
  const activeProcess = runningProcesses.get(profileId);
  if (activeProcess && !activeProcess.prewarming) {
    return { ok: false, error: 'Stop Minecraft with this profile before deleting it.', state: launcherState };
  }
  if (activeProcess?.prewarming) {
    const stopResult = await stopJavaPrewarmedProfile(profileId);
    if (!stopResult.ok) return { ok: false, error: stopResult.error, state: launcherState };
  }
  const deleteFiles = typeof payload === 'string' ? true : payload?.deleteFiles === true;
  const profileRoot = getMinecraftRootFor(profileId);
  launcherState.profiles = launcherState.profiles.filter(p => p.id !== profileId);
  if (launcherState.activeProfileId === profileId) {
    launcherState.activeProfileId = launcherState.profiles[0].id;
  }
  if (deleteFiles) fs.rmSync(profileRoot, { recursive: true, force: true });
  scheduleStateWrite();
  return { ok: true, state: launcherState };
});

ipcMain.handle('launcher:import-world', async (_event, profileId) => {
  const profile = launcherState.profiles.find(item => item.id === String(profileId || ''));
  if (!profile?.optimizationManaged) {
    return { ok: false, error: 'World import is available for isolated optimization profiles.' };
  }
  if (runningProcesses.has(profile.id)) {
    return { ok: false, error: 'Close Minecraft with this profile before importing a world.' };
  }
  const selected = await dialog.showOpenDialog(mainWindow, {
    title: `Choose a world to copy into ${profile.name}`,
    properties: ['openDirectory'],
  });
  if (selected.canceled || !selected.filePaths[0]) return { ok: false, canceled: true };

  try {
    const copied = await copyMinecraftWorld(selected.filePaths[0], profile);
    profile.optimizationWorldSetupComplete = true;
    scheduleStateWrite();
    await dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'World imported',
      message: 'The world copy was verified and is ready to use.',
      detail: `Source: ${copied.sourcePath}\nDestination: ${copied.destinationPath}\nThe original world was not modified.`,
      buttons: ['Continue'],
    });
    return { ok: true, worldName: copied.name };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await dialog.showMessageBox(mainWindow, {
      type: 'error',
      title: 'World import failed',
      message: 'The world could not be copied.',
      detail: message,
      buttons: ['OK'],
    });
    return { ok: false, error: message };
  }
});

ipcMain.handle('launcher:rollback-optimization', async (_event, profileId) => {
  const profile = launcherState.profiles.find(item => item.id === String(profileId || ''));
  if (!profile?.optimizationManaged || profile.optimizationKind !== 'sodium') {
    return { ok: false, error: 'This profile has no managed Sodium optimization rollback.' };
  }
  if (runningProcesses.has(profile.id)) {
    return { ok: false, error: 'Close Minecraft before rolling back optimization updates.' };
  }
  const records = profile.optimizationRollbackFiles || [];
  if (!records.length) return { ok: false, error: 'No previous optimization mod versions are available to restore.' };

  const root = getMinecraftRootFor(profile.id);
  const rollbackRoot = path.join(root, 'optimization-rollback');
  const staged = [];
  const swapped = [];
  try {
    for (const record of records) {
      if (path.basename(record.targetFileName) !== record.targetFileName
        || !record.targetFileName.toLowerCase().endsWith('.jar')
        || path.basename(record.backupName) !== record.backupName
        || ['.', '..'].includes(record.backupName)) {
        throw new Error('The saved rollback manifest contains an invalid file path.');
      }
      const backupPath = path.join(rollbackRoot, record.backupName);
      if (!fs.existsSync(backupPath)) throw new Error(`The previous version of ${record.previousEntry.name} is missing.`);
      const destination = path.join(root, 'mods', `${record.targetFileName}${record.disabled ? '.disabled' : ''}`);
      const stagedPath = `${destination}.${crypto.randomUUID()}.rollback`;
      fs.copyFileSync(backupPath, stagedPath);
      staged.push({ record, destination, stagedPath });
    }

    for (const item of staged) {
      const displacedPath = `${item.destination}.${crypto.randomUUID()}.rollback-old`;
      const hadDestination = fs.existsSync(item.destination);
      if (hadDestination) fs.renameSync(item.destination, displacedPath);
      try {
        fs.renameSync(item.stagedPath, item.destination);
        swapped.push({ ...item, displacedPath: hadDestination ? displacedPath : null });
      } catch (error) {
        if (hadDestination && fs.existsSync(displacedPath)) fs.renameSync(displacedPath, item.destination);
        throw error;
      }
    }

    const restoredEntries = new Map(records.map(record => [record.previousEntry.id, record.previousEntry]));
    profile.mods = [
      ...profile.mods.filter(entry => !restoredEntries.has(entry.id)),
      ...restoredEntries.values(),
    ];
    profile.optimizationRollbackFiles = [];
    profile.updatedAt = Date.now();
    scheduleStateWrite();
    for (const item of swapped) {
      try {
        if (item.displacedPath && fs.existsSync(item.displacedPath)) fs.unlinkSync(item.displacedPath);
      } catch (error) {
        console.warn(`Could not remove replaced optimization file ${path.basename(item.displacedPath || '')}:`, error);
      }
    }
    try {
      fs.rmSync(rollbackRoot, { recursive: true, force: true });
    } catch (error) {
      console.warn(`Could not remove completed optimization rollback files for ${profile.id}:`, error);
    }
    return { ok: true, state: launcherState };
  } catch (error) {
    for (const item of [...swapped].reverse()) {
      try {
        if (fs.existsSync(item.destination)) fs.unlinkSync(item.destination);
        if (item.displacedPath && fs.existsSync(item.displacedPath)) fs.renameSync(item.displacedPath, item.destination);
      } catch (restoreError) {
        console.error(`Could not restore ${path.basename(item.destination)} after a failed optimization rollback:`, restoreError);
      }
    }
    for (const item of staged) {
      try {
        if (fs.existsSync(item.stagedPath)) fs.unlinkSync(item.stagedPath);
      } catch (cleanupError) {
        console.error(`Could not remove staged rollback file ${path.basename(item.stagedPath)}:`, cleanupError);
      }
    }
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle('launcher:ensure-vanilla-profile', async (_event, sourceProfileId) => {
  const source = launcherState.profiles.find(item => item.id === String(sourceProfileId || ''));
  if (!source) return { ok: false, error: 'Source profile not found.' };
  if (source.optimizationManaged && source.optimizationKind === 'vanilla-fallback') {
    return { ok: true, profile: source, state: launcherState };
  }
  const profile = await createManagedVanillaFallback(source);
  try {
    await prepareManagedWorlds(profile, source);
    return { ok: true, profile, state: launcherState };
  } catch (error) {
    return {
      ok: false,
      canceled: error?.code === 'WORLD_SETUP_CANCELED',
      error: error instanceof Error ? error.message : String(error),
      profile,
      state: launcherState,
    };
  }
});

function getServerById(serverId) {
  return launcherState.servers.find(server => server.id === serverId) || null;
}

function ensureServerLogDirectory(serverId) {
  const root = ensureServerRoot(serverId);
  fs.mkdirSync(path.join(root, 'logs'), { recursive: true });
  return root;
}

function updateServerInState(serverId, changes) {
  const index = launcherState.servers.findIndex(server => server.id === serverId);
  if (index === -1) return null;
  launcherState.servers[index] = normalizeServer({ ...launcherState.servers[index], ...changes });
  scheduleStateWrite();
  emitServerState(launcherState.servers[index]);
  return launcherState.servers[index];
}

async function installOrBuildServer(server) {
  const rootPath = ensureServerRoot(server.id);
  const type = normalizeServerType(server.serverType);
  const version = String(server.mcVersion || '1.21.1');

  if (type === 'forge') {
    const installerName = 'forge-installer.jar';
    const installerPath = path.join(rootPath, installerName);
    const metadata = await axios.get('https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml', { timeout: 30000 });
    const forgeVersion = [...String(metadata.data || '').matchAll(/<version>([^<]+)<\/version>/g)]
      .map(match => match[1])
      .filter(candidate => candidate.startsWith(`${version}-`))
      .sort((left, right) => right.localeCompare(left, undefined, { numeric: true, sensitivity: 'base' }))[0];
    if (!forgeVersion) throw new Error(`Forge has no installer for Minecraft ${version}. Choose a compatible game version or server type.`);
    const installerUrl = `https://maven.minecraftforge.net/net/minecraftforge/forge/${forgeVersion}/forge-${forgeVersion}-installer.jar`;
    await downloadDirectWebsiteJar(installerUrl, installerPath);
    const installerJava = await resolveJavaForMinecraft(version, server.javaPath);
    return await new Promise((resolve, reject) => {
      const child = spawn(installerJava, ['-jar', installerPath, '--installServer'], { cwd: rootPath, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
      child.stdout.on('data', chunk => handleServerProcessOutput(server.id, 'info', chunk));
      child.stderr.on('data', chunk => handleServerProcessOutput(server.id, 'info', chunk));
      child.on('close', code => {
        if (code === 0) {
          const argsPath = path.join(rootPath, 'libraries', 'net', 'minecraftforge', 'forge', forgeVersion, 'win_args.txt');
          if (!fs.existsSync(argsPath)) {
            reject(new Error(`Forge ${forgeVersion} installed but did not create its Windows server argument file.`));
            return;
          }
          const fileName = `@${path.relative(rootPath, argsPath).split(path.sep).join('/')}`;
          updateServerInState(server.id, { jarFileName: fileName });
          resolve({ ok: true, fileName });
        } else reject(new Error(`Forge installer exited with code ${code}. Review the preceding installer output for details.`));
      });
      child.on('error', error => reject(error));
    });
  }

  if (type === 'neoforge') {
    const installerName = 'neoforge-installer.jar';
    const installerPath = path.join(rootPath, installerName);
    const versionParts = version.match(/^(\d+)\.(\d+)(?:\.(\d+))?$/);
    if (!versionParts) throw new Error(`NeoForge does not recognize Minecraft version ${version}.`);
    const versionPrefix = version.startsWith('26.')
      ? `${version}.`
      : `${versionParts[2]}.${versionParts[3] || '0'}.`;
    const metadata = await axios.get('https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml', { timeout: 30000 });
    const neoforgeVersion = [...String(metadata.data || '').matchAll(/<version>([^<]+)<\/version>/g)]
      .map(match => match[1])
      .filter(candidate => candidate.startsWith(versionPrefix) && !/(?:alpha|beta|pre|snapshot|rc)/i.test(candidate))
      .sort((left, right) => right.localeCompare(left, undefined, { numeric: true, sensitivity: 'base' }))[0];
    if (!neoforgeVersion) throw new Error(`NeoForge has no stable installer for Minecraft ${version}. Choose a compatible game version or server type.`);
    const installerUrl = `https://maven.neoforged.net/releases/net/neoforged/neoforge/${neoforgeVersion}/neoforge-${neoforgeVersion}-installer.jar`;
    await downloadDirectWebsiteJar(installerUrl, installerPath);
    const installerJava = await resolveJavaForMinecraft(version, server.javaPath);
    return await new Promise((resolve, reject) => {
      const child = spawn(installerJava, ['-jar', installerPath, '--installServer'], { cwd: rootPath, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
      child.stdout.on('data', chunk => handleServerProcessOutput(server.id, 'info', chunk));
      child.stderr.on('data', chunk => handleServerProcessOutput(server.id, 'info', chunk));
      child.on('close', code => {
        if (code === 0) {
          const argsPath = path.join(rootPath, 'libraries', 'net', 'neoforged', 'neoforge', neoforgeVersion, 'win_args.txt');
          if (!fs.existsSync(argsPath)) {
            reject(new Error(`NeoForge ${neoforgeVersion} installed but did not create its Windows server argument file.`));
            return;
          }
          const fileName = `@${path.relative(rootPath, argsPath).split(path.sep).join('/')}`;
          updateServerInState(server.id, { jarFileName: fileName });
          resolve({ ok: true, fileName });
        } else reject(new Error(`NeoForge installer exited with code ${code}. Review the preceding installer output for details.`));
      });
      child.on('error', error => reject(error));
    });
  }

  if (type === 'spigot' || type === 'bukkit') {
    const buildToolsPath = path.join(rootPath, 'BuildTools.jar');
    const buildToolsUrl = 'https://hub.spigotmc.org/jenkins/job/BuildTools/lastSuccessfulBuild/artifact/target/BuildTools.jar';
    await downloadDirectWebsiteJar(buildToolsUrl, buildToolsPath);
    const installerJava = await resolveJavaForMinecraft(version, server.javaPath);
    return await new Promise((resolve, reject) => {
      const child = spawn(installerJava, ['-jar', buildToolsPath, '--rev', version], { cwd: rootPath, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
      child.stdout.on('data', chunk => handleServerProcessOutput(server.id, 'info', chunk));
      child.stderr.on('data', chunk => handleServerProcessOutput(server.id, 'info', chunk));
      child.on('close', code => {
        if (code !== 0) return reject(new Error(`BuildTools exited with code ${code}`));
        const jarName = type === 'bukkit' ? `craftbukkit-${version}.jar` : `spigot-${version}.jar`;
        updateServerInState(server.id, { jarFileName: jarName });
        resolve({ ok: true, fileName: jarName });
      });
      child.on('error', error => reject(error));
    });
  }

  return { ok: false, error: `Unsupported server installation flow for ${type}.` };
}

async function startServerProcess(server, startupTask = null) {
  const cancellationResult = () => startupTask?.cancelled
    ? { ok: false, error: 'Server start canceled.' }
    : null;
  if (cancellationResult()) return cancellationResult();
  let rootPath = path.resolve(server.rootPath || getServerRoot(server.id));
  if (!fs.existsSync(rootPath) || !fs.statSync(rootPath).isDirectory()) {
    return { ok: false, error: `The configured server folder does not exist: ${rootPath}` };
  }
  if (!server.rootPath) {
    server.rootPath = rootPath;
    updateServerInState(server.id, { rootPath });
  }
  ensureServerTypeFolders(server);
  const serverType = String(server?.serverType || 'paper').toLowerCase();
  if (server.networkingMode === 'playit') {
    const playitResult = playitManager.start({
      keepRunningOnClose: launcherState.settings?.playitKeepRunningOnClose === true,
    });
    if (!playitResult?.ok) {
      emitServerConsole(server.id, 'warn', playitResult?.error || 'Playit agent could not be started. The server will remain local-only.');
    }
  }
  const playitEndpoint = server.networkingMode === 'playit' ? getPlayitPublicEndpoint() : null;
  const advertisedAddress = playitEndpoint || server.address || '127.0.0.1:25565';
  if (playitEndpoint && server.address !== playitEndpoint) {
    server.address = playitEndpoint;
    updateServerInState(server.id, { address: playitEndpoint });
  }
  const installedArgsPath = String(server?.jarFileName || '').startsWith('@')
    ? path.join(rootPath, String(server.jarFileName).slice(1))
    : '';
  let foundJar = installedArgsPath && fs.existsSync(installedArgsPath)
    ? server.jarFileName
    : findExistingServerJar(rootPath, server?.jarFileName);
  const paperFamily = ['paper', 'purpur', 'folia'].includes(serverType);
  const invalidPaperJar = paperFamily && foundJar
    && !isPaperServerJar(String(foundJar).startsWith('@') ? path.join(rootPath, String(foundJar).slice(1)) : path.join(rootPath, foundJar));
  if (invalidPaperJar) foundJar = null;
  const detectedServerType = invalidPaperJar ? serverType : inferServerTypeFromJar(foundJar, serverType);
  if (!invalidPaperJar && detectedServerType !== serverType) {
    updateServerInState(server.id, { serverType: detectedServerType });
    server.serverType = detectedServerType;
  }


  if (!foundJar) {
    if (isInstallerBuildServerType(serverType)) {
      try {
        emitServerConsole(server.id, 'info', `${serverType.toUpperCase()} requires its upstream installer/build step. Preparing the server now...`);
        const installResult = await installOrBuildServer(server);
        if (cancellationResult()) return cancellationResult();
        foundJar = installResult.fileName || null;
      } catch (error) {
        fs.writeFileSync(path.join(rootPath, 'server.properties'), '# Generated by Bald Launcher\nserver-port=25565\n', 'utf8');
        fs.writeFileSync(path.join(rootPath, 'eula.txt'), 'eula=true\n', 'utf8');
        fs.mkdirSync(path.join(rootPath, 'logs'), { recursive: true });
        const message = error instanceof Error ? error.message : String(error);
        emitServerConsole(server.id, 'warn', message || 'The installer/build step failed.');
        return { ok: false, error: message || 'The installer/build step failed.' };
      }
    } else {
      emitServerConsole(server.id, 'info', `Checking for a ${serverType.toUpperCase()} ${server.mcVersion} server build...`);
      const jarDownload = await downloadServerJar(server);
      if (cancellationResult()) return cancellationResult();
      if (!jarDownload.ok) {
        emitServerConsole(server.id, 'warn', jarDownload.error || 'No server JAR was available, and startup was aborted.');
        return { ok: false, error: jarDownload.error };
      }
      foundJar = jarDownload.fileName;
    }
  }

  if (cancellationResult()) return cancellationResult();
  const foundJarPath = String(foundJar).startsWith('@')
    ? path.join(rootPath, String(foundJar).slice(1))
    : path.join(rootPath, foundJar);
  if (serverType === 'fabric' && !isFabricServerJar(foundJarPath)) {
    const invalidPath = `${foundJarPath}.not-fabric-${Date.now()}`;
    fs.renameSync(foundJarPath, invalidPath);
    emitServerConsole(server.id, 'warn', `The selected server JAR does not contain Fabric Loader and was preserved as ${path.basename(invalidPath)}. Downloading a valid Fabric server instead.`);
    const jarDownload = await downloadServerJar(server);
    if (!jarDownload.ok) return jarDownload;
    foundJar = jarDownload.fileName;
  }
  if (serverType === 'quilt' && !isQuiltServerJar(foundJarPath)) {
    const invalidPath = `${foundJarPath}.not-quilt-${Date.now()}`;
    fs.renameSync(foundJarPath, invalidPath);
    emitServerConsole(server.id, 'warn', `The selected server JAR does not contain Quilt Loader and was preserved as ${path.basename(invalidPath)}. Downloading a valid Quilt server instead.`);
    const jarDownload = await downloadServerJar(server);
    if (!jarDownload.ok) return jarDownload;
    foundJar = jarDownload.fileName;
  }
  if (paperFamily && !isPaperServerJar(foundJarPath)) {
    return { ok: false, error: `The selected ${serverType} JAR is invalid or incomplete. It was not started as a different server type.` };
  }
  const managedRoot = path.resolve(path.join(app.getPath('userData'), 'servers'));
  const normalizedRoot = path.resolve(rootPath).toLowerCase();
  const isManagedProfile = normalizedRoot === managedRoot.toLowerCase()
    || normalizedRoot.startsWith(`${managedRoot.toLowerCase()}${path.sep}`);
  const worldPath = path.join(rootPath, server.worldName || 'world');
  if (isManagedProfile) {
    const worldCheck = inspectMinecraftWorld(worldPath);
    if (worldCheck.exists && !worldCheck.valid) {
      const decision = await dialog.showMessageBox(mainWindow, {
        type: 'warning',
        title: 'World may be corrupted',
        message: `Bald Launcher could not validate the existing world "${server.worldName || 'world'}".`,
        detail: `${worldCheck.reason}\n\nKeep world: start the server with the existing files unchanged.\nReplace with fresh world: move the existing world to a timestamped backup and let Minecraft create a new one.\nCancel: do not start the server.`,
        buttons: ['Keep world', 'Replace with fresh world', 'Cancel server start'],
        defaultId: 0,
        cancelId: 2,
        noLink: true,
      });
      if (decision.response === 2) return { ok: false, error: 'Server start canceled because the world could not be validated.' };
      if (decision.response === 1) {
        const invalidWorldPath = `${worldPath}.invalid-${Date.now()}`;
        fs.renameSync(worldPath, invalidWorldPath);
        emitServerConsole(server.id, 'warn', `The existing world was identified as invalid and was moved to ${path.basename(invalidWorldPath)}. A fresh world will be created because you chose Replace.`);
      } else {
        emitServerConsole(server.id, 'warn', `The existing world could not be validated, but startup is continuing because you chose Keep.`);
      }
    }
  }

  const serverPort = await chooseServerPort(server, rootPath);
  server.serverPort = serverPort;
  updateServerInState(server.id, { serverPort });
  if (!server.networkingMode || server.networkingMode !== 'playit' || !getPlayitPublicEndpoint()) {
    server.address = `127.0.0.1:${serverPort}`;
    updateServerInState(server.id, { address: server.address });
  }
  server.jarFileName = foundJar;
  updateServerInState(server.id, { jarFileName: foundJar });

  const serverPropertiesPath = path.join(rootPath, 'server.properties');
  const eulaPath = path.join(rootPath, 'eula.txt');
  if (!fs.existsSync(serverPropertiesPath)) {
    fs.writeFileSync(serverPropertiesPath, `# Generated by Bald Launcher\nserver-port=${serverPort}\nmotd=Bald Launcher Server\n`, 'utf8');
  }
  if (!fs.existsSync(eulaPath)) {
    fs.writeFileSync(eulaPath, 'eula=true\n', 'utf8');
  }
  fs.mkdirSync(path.join(rootPath, 'logs'), { recursive: true });

  const javaPath = await resolveJavaForMinecraft(server?.mcVersion || '1.21.1', server.javaPath || server.runtime?.javaPath || '');
  if (cancellationResult()) return cancellationResult();
  updateServerProperties(server, serverPort);
  const javaExecutable = javaPath;
  const customArgs = String(server.javaArgs || '').trim() ? String(server.javaArgs).trim().split(/\s+/) : [];
  const serverMemory = getEffectiveServerMemory(server);
  writeServerStartBatch(rootPath, javaExecutable, serverMemory, customArgs, foundJar);
  const launchToken = crypto.randomUUID();
  const launchArgs = [
    '-Xms512M',
    `-Xmx${serverMemory}G`,
    `-Dbald.launcher.launch-token=${launchToken}`,
    ...customArgs,
    ...(String(foundJar).startsWith('@') ? ['@user_jvm_args.txt', foundJar] : ['-jar', foundJar]),
    'nogui',
  ];
  if (cancellationResult()) return cancellationResult();
  const runtime = {
    pid: null,
    javaPath: javaExecutable,
    jarFileName: foundJar,
    launchArgs,
    cwd: rootPath,
    launchToken,
    startedAt: Date.now(),
    processStartTime: 0,
    lastKnownState: 'starting',
    lastExitCode: null,
    lastExitReason: '',
  };
  const processInfo = spawn(javaExecutable, launchArgs, {
    cwd: rootPath,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
    detached: launcherState.settings?.playitKeepRunningOnClose === true,
  });
  runtime.pid = processInfo.pid || null;
  runtime.processStartTime = Date.now();
  serverProcesses.set(server.id, processInfo);
  serverStartedAt.set(server.id, Date.now());
  updateServerInState(server.id, { status: 'starting', runtime });
  let memoryAllocationFailure = false;

  const markServerReady = line => {
    const text = String(line || '');
    if (!text) return false;
    const readyPatterns = [
      /Done\s*\(/i,
      /Server started/i,
      /Listening on/i,
      /started\s+server/i,
      /for help, type "\/help"/i,
    ];
    if (readyPatterns.some(pattern => pattern.test(text))) {
      updateServerInState(server.id, { status: 'running', address: advertisedAddress, playerCount: 0 });
      emitStatus(`Server ${server.name} is running`);
      return true;
    }
    return false;
  };

  processInfo.stdout.on('data', chunk => {
    handleServerProcessOutput(server.id, 'info', chunk, 'stdout').forEach(markServerReady);
  });
  processInfo.stderr.on('data', chunk => {
    handleServerProcessOutput(server.id, 'info', chunk, 'stderr').forEach(line => {
      if (/insufficient memory|native memory allocation|paging file is too small|out of memory|gc overhead limit/i.test(line)) {
        memoryAllocationFailure = true;
      }
      markServerReady(line);
    });
  });
  processInfo.on('error', error => {
    serverProcesses.delete(server.id);
    serverOutputLineBuffers.delete(`${server.id}:stdout`);
    serverOutputLineBuffers.delete(`${server.id}:stderr`);
    stopServerProcessPoller(server.id);
    const serverEntry = getServerById(server.id);
    const errorText = error instanceof Error ? error.message : String(error);
    if (serverEntry) {
      updateServerInState(server.id, {
        status: 'idle',
        playerCount: 0,
        address: serverEntry.address || '',
        runtime: { ...serverEntry.runtime, pid: null, lastKnownState: 'crashed', lastExitReason: errorText },
      });
      emitServerConsole(server.id, 'warn', `Failed to start server: ${errorText}`);
      emitStatus(`Server ${serverEntry.name} failed to start`);
    }
  });
  processInfo.on('exit', (code, signal) => {
    serverProcesses.delete(server.id);
    serverOutputLineBuffers.delete(`${server.id}:stdout`);
    serverOutputLineBuffers.delete(`${server.id}:stderr`);
    stopServerProcessPoller(server.id);
    serverStartedAt.delete(server.id);
    const serverEntry = getServerById(server.id);
    if (serverEntry) {
      const nextStatus = serverEntry.status === 'stopping' ? 'idle' : 'idle';
      const memoryFailureUpdate = memoryAllocationFailure
        ? { autoRestart: false, javaArgs: serverEntry.javaArgs || '' }
        : {};
      updateServerInState(server.id, {
        status: nextStatus,
        playerCount: 0,
        address: serverEntry.address || '',
        runtime: {
          ...serverEntry.runtime,
          pid: null,
          lastKnownState: serverEntry.status === 'stopping' ? 'stopped' : 'crashed',
          lastExitCode: Number.isInteger(code) ? code : null,
          lastExitReason: signal ? `Process exited from signal ${signal}.` : `Process exited with code ${code ?? 'unknown'}.`,
        },
        ...memoryFailureUpdate,
      });
      emitServerConsole(server.id, 'info', `Server process exited with code ${code ?? 'unknown'}${signal ? ` (signal ${signal})` : ''}`);
      if (memoryAllocationFailure) {
        emitServerConsole(server.id, 'warn', 'Java could not reserve the requested native memory. Auto-restart was disabled; lower the server memory setting or increase the Windows paging file before trying again.');
      }
      emitStatus(`Server ${serverEntry.name} stopped`);
      if (serverEntry.autoRestart && !memoryAllocationFailure && serverEntry.status !== 'stopping' && code !== 0) {
        setTimeout(() => {
          const current = getServerById(server.id);
          if (!current || serverProcesses.has(server.id) || serverStartupTasks.has(server.id)) return;
          void startServerById(server.id).then(result => {
            if (!result.ok) emitServerConsole(server.id, 'warn', `Auto-restart was not started: ${result.error || 'the server could not be safely restarted.'}`);
          }).catch(error => {
            emitServerConsole(server.id, 'warn', `Auto-restart failed: ${error instanceof Error ? error.message : String(error)}`);
          });
        }, 2000);
      }
    }
  });
  updateServerInState(server.id, { status: 'starting', address: advertisedAddress, runtime });
  emitStatus(`Starting server ${server.name}...`);
  return { ok: true, pid: processInfo.pid };
}

function writeServerBackupLog(serverId, line) {
  const logPath = path.join(getServerRoot(serverId), 'logs', 'server-backups.log');
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fs.appendFileSync(logPath, `${new Date().toISOString()} ${line}\n`, 'utf8');
}

function zipFolderToArchive(sourceFolder, archivePath, excludeNames = []) {
  const platform = process.platform;
  if (platform === 'win32') {
    const exclusions = excludeNames.length
      ? `Get-ChildItem -Path "${sourceFolder}" -Exclude ${excludeNames.map(name => `'${name}'`).join(',')} | Compress-Archive -DestinationPath "${archivePath}" -Force`
      : `Compress-Archive -Path "${sourceFolder}\*" -DestinationPath "${archivePath}" -Force`;
    return new Promise((resolve, reject) => {
      execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', exclusions], (error) => {
        if (error) reject(error); else resolve();
      });
    });
  }
  const tarExcludes = (excludeNames || []).map(name => `--exclude=${name}`).join(' ');
  return new Promise((resolve, reject) => {
    execFile('tar', ['-czf', archivePath, ...tarExcludes ? [tarExcludes] : [], '-C', path.dirname(sourceFolder), path.basename(sourceFolder)], (error) => {
      if (error) reject(error); else resolve();
    });
  });
}

async function sendServerConsoleCommandAndWait(serverId, rootPath, command, responsePattern) {
  const processInfo = serverProcesses.get(serverId);
  if (!processInfo?.stdin || processInfo.stdin.destroyed || processInfo.killed) {
    throw new Error('The server console is not available to safely snapshot the world.');
  }
  const logPath = path.join(rootPath, 'logs', 'latest.log');
  let startOffset = 0;
  try {
    startOffset = fs.statSync(logPath).size;
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  await new Promise((resolve, reject) => {
    processInfo.stdin.write(`${command}\n`, error => error ? reject(error) : resolve());
  });
  await waitForLogResponse(logPath, responsePattern, {
    startOffset,
    isRunning: () => serverProcesses.get(serverId) === processInfo && !processInfo.killed,
  });
}

function unzipArchiveToFolder(archivePath, targetFolder) {
  const platform = process.platform;
  if (platform === 'win32') {
    return new Promise((resolve, reject) => {
      execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Expand-Archive -Path "${archivePath}" -DestinationPath "${targetFolder}" -Force`], (error) => {
        if (error) reject(error); else resolve();
      });
    });
  }
  return new Promise((resolve, reject) => {
    execFile('tar', ['-xzf', archivePath, '-C', targetFolder], (error) => {
      if (error) reject(error); else resolve();
    });
  });
}

ipcMain.handle('launcher:create-server', async (_event, payload) => {
  try {
    const name = String(payload?.name || '').trim() || 'New server';
    const serverId = `server-${Date.now()}`;
    const folderName = getUniqueServerFolderName(name);
    const server = normalizeServer({
      id: serverId,
      name,
      folderName,
      mcVersion: payload?.mcVersion || '1.21.1',
      loader: payload?.loader || 'fabric',
      serverType: payload?.serverType || 'paper',
      memoryMax: Number(payload?.memoryMax) || 4,
      networkingMode: payload?.networkingMode || 'playit',
      worldName: payload?.worldName || 'world',
      status: 'idle',
      createdAt: Date.now(),
      address: '',
      playerCount: 0,
      profileId: payload?.profileId || null,
      rootPath: path.join(getServersRoot(), folderName),
      schedules: [
        { id: 'backup-schedule', type: 'backup', enabled: true, intervalMinutes: 60, nextRunAt: Date.now() + 60 * 60 * 1000 },
      ],
    });
    ensureServerRoot(server.id);
    ensureServerTypeFolders(server);
    launcherState.servers.push(server);
    scheduleStateWrite();
    emitServerState(server);
    return { ok: true, server };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle('launcher:rename-server', async (_event, payload) => {
  try {
    const serverId = String(payload?.serverId || '');
    const server = getServerById(serverId);
    if (!server) return { ok: false, error: 'Server not found.' };
    const name = String(payload?.name || '').trim();
    if (!name || name.length > 32 || /[\u0000-\u001f]/.test(name)) {
      return { ok: false, error: 'Enter a server name between 1 and 32 characters.' };
    }
    const updatedServer = updateServerInState(serverId, { name, updatedAt: Date.now() });
    return { ok: true, server: updatedServer };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle('server:choose-folder', async (_event, payload) => {
  const serverId = String(payload?.serverId || '');
  const server = getServerById(serverId);
  if (!server) return { ok: false, error: 'Server not found' };
  if (serverProcesses.has(serverId) || ['starting', 'running', 'stopping'].includes(server.status)
    || ['matched', 'unverified'].includes(inspectPersistedServerProcess(server))) {
    return { ok: false, error: 'Stop the server before changing its folder.' };
  }
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose the existing Minecraft server folder',
    defaultPath: server.rootPath || getServerRoot(server.id),
    properties: ['openDirectory', 'createDirectory'],
  });
  if (result.canceled || !result.filePaths[0]) return { ok: false, canceled: true };
  const selectedPath = path.normalize(result.filePaths[0]);
  if (!fs.existsSync(selectedPath) || !fs.statSync(selectedPath).isDirectory()) {
    return { ok: false, error: 'The selected server folder is not available.' };
  }
  const selectedJar = findExistingServerJar(selectedPath, server.jarFileName);
  const selectedWorldName = findUsableWorldName(selectedPath, server.worldName);
  if (!selectedJar || !selectedWorldName) {
    return { ok: false, error: 'The selected folder must directly contain a server JAR and a world folder with level.dat.' };
  }
  const detectedServerType = inferServerTypeFromJar(selectedJar, server.serverType);
  updateServerInState(server.id, {
    rootPath: selectedPath,
    jarFileName: selectedJar,
    worldName: selectedWorldName,
    serverType: detectedServerType,
  });
  scheduleStateWrite();
  return { ok: true, server: getServerById(server.id), path: selectedPath };
});

async function startServerById(serverId) {
  try {
    const server = getServerById(serverId);
    if (!server) return { ok: false, error: 'Server not found' };
    if (serverProcesses.has(server.id) || serverStartupTasks.has(server.id)) return { ok: false, error: 'A server process is already active or starting for this server' };
    const persistedProcessState = inspectPersistedServerProcess(server);
    if (persistedProcessState === 'matched') {
      monitorPersistedServerProcess(server);
      updateServerInState(server.id, { status: 'running', runtime: { ...server.runtime, lastKnownState: 'process-alive' } });
      return { ok: false, error: 'Server appears to already be running. The existing Java process was detected and no second process was started.', server: getServerById(server.id) };
    }
    if (persistedProcessState === 'unverified') {
      return { ok: false, error: `The saved Java PID ${server.runtime.pid} is alive, but its identity cannot be verified. No server files were changed and no new process was started.` };
    }
    if (server.runtime?.pid) {
      updateServerInState(server.id, {
        runtime: {
          ...server.runtime,
          pid: null,
          lastKnownState: 'unknown',
          lastExitReason: persistedProcessState === 'different-process'
            ? 'The saved PID now belongs to a different process.'
            : 'The previous server process was no longer present.',
        },
      });
    }
    const liveProcess = findLiveServerProcess(server);
    if (liveProcess) {
      if (!canAdoptDiscoveredProcess(server, liveProcess)) {
        return {
          ok: false,
          error: `A Java process using ${server.jarFileName || 'the same server JAR'} is already running (PID ${liveProcess.ProcessId}), but its identity cannot be verified for this server. No duplicate server was started.`,
        };
      }
      const adopted = adoptLiveServerProcess(server, liveProcess);
      return {
        ok: false,
        error: `Server is already running (Java PID ${liveProcess.ProcessId}). The launcher adopted the existing process instead of starting a duplicate.`,
        server: adopted || getServerById(server.id),
      };
    }
    if (hasWorldSessionLock(server) && shouldPromptForStaleWorldLock(server.runtime)) {
      const worldPath = path.join(getServerRoot(server.id), server.worldName || 'world');
      const lockPath = path.join(worldPath, 'session.lock');
      const decision = await dialog.showMessageBox(mainWindow, {
        type: 'warning',
        title: 'Stale world lock detected',
        message: 'No matching Minecraft Java process is running, but this world still has a session lock.',
        detail: 'This usually means the previous server stopped unexpectedly. The lock will only be removed after this explicit confirmation. No world files will be deleted.',
        buttons: ['Cancel', 'Remove stale lock and start'],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      });
      if (decision.response !== 1) return { ok: false, error: 'Server start canceled because the world has a stale session lock.' };
      try {
        if (fs.existsSync(lockPath)) fs.unlinkSync(lockPath);
        emitServerConsole(server.id, 'warn', 'Removed a stale world session lock after confirming that no matching Java server process was running.');
      } catch (error) {
        return { ok: false, error: `The stale world lock could not be removed: ${error.message}` };
      }
    }
    if (server.status === 'starting' || server.status === 'running') {
      updateServerInState(server.id, { status: 'idle', playerCount: 0, address: server.address || '' });
    }
    if (!fs.existsSync(getServerRoot(server.id))) ensureServerRoot(server.id);
    const startupTask = { cancelled: false, promise: null };
    updateServerInState(server.id, {
      status: 'starting',
      runtime: { ...server.runtime, lastKnownState: 'starting', lastExitReason: '' },
    });
    startupTask.promise = Promise.resolve()
      .then(() => startServerProcess(server, startupTask))
      .then(result => {
        if (!result.ok && !startupTask.cancelled) {
          updateServerInState(server.id, {
            status: 'idle',
            runtime: { ...getServerById(server.id)?.runtime, pid: null, lastKnownState: 'crashed', lastExitReason: result.error || 'Server startup failed.' },
          });
          emitServerConsole(server.id, 'warn', result.error || 'Server startup failed.');
        }
      })
      .catch(error => {
        if (startupTask.cancelled) return;
        const message = error instanceof Error ? error.message : String(error);
        updateServerInState(server.id, {
          status: 'idle',
          runtime: { ...getServerById(server.id)?.runtime, pid: null, lastKnownState: 'crashed', lastExitReason: message },
        });
        emitServerConsole(server.id, 'warn', `Failed to start server: ${message}`);
      })
      .finally(() => {
        if (serverStartupTasks.get(server.id) === startupTask) serverStartupTasks.delete(server.id);
      });
    serverStartupTasks.set(server.id, startupTask);
    emitServerConsole(server.id, 'info', `Starting ${server.serverType} server for Minecraft ${server.mcVersion}...`);
    return { ok: true, server: getServerById(server.id) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

ipcMain.handle('launcher:start-server', async (_event, payload) => startServerById(payload?.serverId));

function updateServerProperties(server, port = Number(server?.serverPort) || readServerPort(getServerRoot(server.id))) {
  const rootPath = ensureServerRoot(server.id);
  const propertiesPath = path.join(rootPath, 'server.properties');
  const existing = fs.existsSync(propertiesPath) ? fs.readFileSync(propertiesPath, 'utf8') : '';
  const values = {
    'server-port': port,
    'level-name': server.worldName || 'world',
    'motd': server.motd,
    'max-players': server.maxPlayers,
    'difficulty': server.difficulty,
    'gamemode': server.gamemode,
    'force-gamemode': server.forceGamemode,
    'pvp': server.pvp,
    'white-list': server.whitelist,
    'view-distance': server.viewDistance,
    'simulation-distance': server.simulationDistance,
  };
  const lines = existing.split(/\r?\n/).filter(line => line && !line.startsWith('#'));
  for (const [key, value] of Object.entries(values)) {
    const nextLine = `${key}=${String(value).replace(/[\r\n]+/g, ' ')}`;
    const index = lines.findIndex(line => line.startsWith(`${key}=`));
    if (index >= 0) lines[index] = nextLine; else lines.push(nextLine);
  }
  fs.writeFileSync(propertiesPath, `${lines.join('\n')}\n`, 'utf8');
  if (server.eulaAccepted) fs.writeFileSync(path.join(rootPath, 'eula.txt'), 'eula=true\n', 'utf8');
}

async function stopServerById(serverId) {
  try {
    const server = getServerById(serverId);
    if (!server) return { ok: false, error: 'Server not found' };
    const processInfo = serverProcesses.get(serverId);
    if (!processInfo) {
      const startupTask = serverStartupTasks.get(serverId);
      if (startupTask) {
        startupTask.cancelled = true;
        updateServerInState(serverId, {
          status: 'idle',
          runtime: { ...server.runtime, pid: null, lastKnownState: 'stopped', lastExitReason: 'Startup canceled by the user.' },
        });
        emitServerConsole(serverId, 'info', 'Server startup canceled. Any download already in progress will finish before cleanup can complete.');
        return { ok: true, server: getServerById(serverId) };
      }
      const persistedProcessState = inspectPersistedServerProcess(server);
      if (persistedProcessState === 'unverified') {
        return { ok: false, error: `Java PID ${server.runtime.pid} is alive, but the launcher cannot verify its identity. It was not terminated.` };
      }
      if (persistedProcessState === 'matched') {
        updateServerInState(serverId, { status: 'stopping', runtime: { ...server.runtime, lastKnownState: 'stopping' } });
        emitServerConsole(serverId, 'warn', 'Stopping the adopted server process. Its console stdin could not be reattached after launcher restart.');
        await new Promise(resolve => {
          execFile('taskkill.exe', ['/PID', String(server.runtime.pid), '/T', '/F'], { windowsHide: true }, () => resolve());
        });
        const deadline = Date.now() + 5000;
        while (['matched', 'unverified'].includes(inspectPersistedServerProcess(server)) && Date.now() < deadline) {
          await new Promise(resolve => setTimeout(resolve, 200));
        }
        if (['matched', 'unverified'].includes(inspectPersistedServerProcess(server))) {
          return { ok: false, error: `The adopted Java process ${server.runtime.pid} is still running. The launcher did not mark the server stopped.` };
        }
        stopServerProcessPoller(serverId);
        updateServerInState(serverId, {
          status: 'idle',
          playerCount: 0,
          runtime: {
            ...server.runtime,
            pid: null,
            lastKnownState: 'stopped',
            lastExitCode: 0,
            lastExitReason: 'Stopped by the launcher after restart; console stdin was unavailable.',
          },
        });
        emitServerConsole(serverId, 'info', 'Server process stopped. The world lock was not deleted automatically.');
        return { ok: true, server: getServerById(serverId) };
      }
      if (server.runtime?.pid && persistedProcessState === 'different-process') {
        updateServerInState(serverId, {
          status: 'idle',
          runtime: { ...server.runtime, pid: null, lastKnownState: 'unknown', lastExitReason: 'The saved PID now belongs to a different process and was not terminated.' },
        });
        emitServerConsole(serverId, 'warn', 'Detached a reused Java PID without terminating the unrelated process.');
        return { ok: true, server: getServerById(serverId) };
      }
      updateServerInState(serverId, server.runtime?.pid
        ? { status: 'idle', playerCount: 0, runtime: { ...server.runtime, pid: null, lastKnownState: 'stopped', lastExitReason: 'The saved server process is no longer running.' } }
        : { status: 'idle' });
      return { ok: true, server: getServerById(serverId) };
    }
    updateServerInState(serverId, { status: 'stopping' });
    emitServerConsole(serverId, 'info', 'Stop requested; saving world and shutting down...');
    if (processInfo.stdin && !processInfo.stdin.destroyed) {
      processInfo.stdin.write('stop\n');
    } else {
      processInfo.kill('SIGTERM');
    }

    const waitForExit = timeoutMs => new Promise(resolve => {
    if (!serverProcesses.has(serverId)) return resolve(true);
    const onExit = () => {
      clearTimeout(timeout);
      resolve(true);
    };
    const timeout = setTimeout(() => {
      processInfo.removeListener('exit', onExit);
      resolve(false);
    }, timeoutMs);
    processInfo.once('exit', onExit);
    });
    let exited = await waitForExit(8000);
    if (!exited || serverProcesses.has(serverId)) {
    if (process.platform === 'win32' && processInfo.pid) {
      await new Promise(resolve => {
        execFile('taskkill.exe', ['/PID', String(processInfo.pid), '/T', '/F'], { windowsHide: true }, () => resolve());
        });
      } else {
        processInfo.kill('SIGKILL');
      }
      exited = await waitForExit(5000);
    }
    if (!exited || serverProcesses.has(serverId)) {
      return { ok: false, error: `Server process ${processInfo.pid || ''} did not exit after the stop request. It remains marked as stopping.` };
    }
    return { ok: true, server: getServerById(serverId) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

ipcMain.handle('launcher:stop-server', async (_event, payload) => stopServerById(payload?.serverId));

ipcMain.handle('server:get-console-history', async (_event, payload) => {
  try {
    const serverId = payload?.serverId;
    const server = getServerById(serverId);
    if (!server) return { ok: false, error: 'Server not found' };
    const limit = Math.min(2000, Math.max(1, Number(payload?.limit) || 2000));
    const logPath = path.join(getServerRoot(server.id), 'logs', 'latest.log');
    const sparkHistoryState = { remainingRows: 0 };
    const lines = readTextIfPresent(logPath, 16 * 1024 * 1024).split(/\r?\n/).filter(Boolean)
      .filter(line => !isSparkConsoleHistoryLine(line, sparkHistoryState))
      .slice(-limit)
      .map(line => ({
      type: /\b(?:ERROR|FATAL|Exception)\b/i.test(line) ? 'error' : /\bWARN(?:ING)?\b/i.test(line) ? 'warn' : 'info',
      line: stripAnsi(line).trim(),
    })).filter(entry => entry.line);
    return { ok: true, serverId: server.id, lines };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle('server:list-files', async (_event, payload) => {
  try {
    const serverId = payload?.serverId;
    const server = getServerById(serverId);
    if (!server) return { ok: false, error: 'Server not found' };
    const rootPath = ensureServerRoot(serverId);
    ensureServerTypeFolders(server);
    const currentPath = payload?.path && String(payload.path) !== '.' ? resolveServerScopedPath(serverId, payload.path) : rootPath;
    const rows = [];
    for (const entry of fs.readdirSync(currentPath, { withFileTypes: true })) {
      const full = path.join(currentPath, entry.name);
      const rel = path.relative(rootPath, full).split(path.sep).join('/');
      const stats = entry.isFile() ? fs.statSync(full) : null;
      rows.push({
        name: entry.name,
        path: rel,
        isDirectory: entry.isDirectory(),
        size: stats ? stats.size : null,
        modifiedAt: stats ? stats.mtimeMs : fs.statSync(full).mtimeMs,
        isEditable: entry.isDirectory() ? false : !isBinaryServerFile(full),
      });
    }
    return { ok: true, files: rows, currentPath: path.relative(rootPath, currentPath).split(path.sep).join('/') || '.' };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle('server:read-file', async (_event, payload) => {
  try {
    const serverId = payload?.serverId;
    const filePath = resolveServerScopedPath(serverId, payload?.path || '.');
    if (isBinaryServerFile(filePath)) throw new Error('This file is binary or otherwise not editable as text');
    const stats = fs.statSync(filePath);
    if (!stats.isFile()) throw new Error('Target is not a file');
    const content = fs.readFileSync(filePath, 'utf8');
    return { ok: true, path: path.relative(getServerRoot(serverId), filePath).split(path.sep).join('/'), content };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle('server:write-file', async (_event, payload) => {
  try {
    const serverId = payload?.serverId;
    const filePath = resolveServerScopedPath(serverId, payload?.path || '.');
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, String(payload?.content ?? ''), 'utf8');
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle('server:delete-file', async (_event, payload) => {
  try {
    const serverId = payload?.serverId;
    const filePath = resolveServerScopedPath(serverId, payload?.path || '.');
    const stats = fs.statSync(filePath);
    if (stats.isDirectory()) fs.rmSync(filePath, { recursive: true, force: true });
    else fs.unlinkSync(filePath);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle('server:rename-file', async (_event, payload) => {
  try {
    const serverId = payload?.serverId;
    const fromPath = resolveServerScopedPath(serverId, payload?.from || '.');
    const toPath = resolveServerScopedPath(serverId, payload?.to || '.');
    fs.renameSync(fromPath, toPath);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

async function createServerBackup(serverId, payload = {}) {
  let backupEntry = null;
  let operationError = null;
  let saveRecoveryError = null;
  let saveModeDisabled = false;
  try {
    const server = getServerById(serverId);
    if (!server) return { ok: false, error: 'Server not found' };
    const rootPath = ensureServerRoot(serverId);
    const processInfo = serverProcesses.get(serverId);
    const persistedProcessState = inspectPersistedServerProcess(server);
    if (!processInfo && (['matched', 'unverified'].includes(persistedProcessState) || findLiveServerProcess(server))) {
      throw new Error('Stop the server before backing it up. Its console is not attached, so the world cannot be flushed safely.');
    }
    if (processInfo && ['velocity', 'waterfall', 'bungeecord'].includes(server.serverType)) {
      throw new Error('Stop the proxy server before creating a backup.');
    }
    const backupRoot = path.join(rootPath, 'backups');
    fs.mkdirSync(backupRoot, { recursive: true });
    const customName = String(payload?.name || '').trim();
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const fileStem = customName ? customName.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || `backup-${stamp}` : `backup-${stamp}`;
    let archiveName = `${fileStem}.zip`;
    if (fs.existsSync(path.join(backupRoot, archiveName))) archiveName = `${fileStem}-${stamp}.zip`;
    if (fs.existsSync(path.join(backupRoot, archiveName))) archiveName = `${fileStem}-${stamp}-${crypto.randomUUID()}.zip`;
    const archivePath = path.join(backupRoot, archiveName);
    const temporaryArchivePath = path.join(backupRoot, `.backup-${crypto.randomUUID()}.zip`);
    const worldPath = path.join(rootPath, server.worldName || 'world');
    if (!fs.existsSync(worldPath)) fs.mkdirSync(worldPath, { recursive: true });
    if (processInfo) {
      saveModeDisabled = true;
      await sendServerConsoleCommandAndWait(serverId, rootPath, 'save-off', /automatic saving is now disabled|saving is now disabled/i);
      await sendServerConsoleCommandAndWait(serverId, rootPath, 'save-all flush', /saved the game/i);
    }
    try {
      await zipFolderToArchive(rootPath, temporaryArchivePath, ['backups']);
      fs.renameSync(temporaryArchivePath, archivePath);
    } catch (error) {
      if (fs.existsSync(temporaryArchivePath)) fs.unlinkSync(temporaryArchivePath);
      throw error;
    }
    backupEntry = { id: `backup-${Date.now()}`, name: archiveName, createdAt: Date.now(), size: fs.statSync(archivePath).size };
    const retentionCount = Number(server.retentionCount) > 0 ? Number(server.retentionCount) : 10;
    const existingBackups = fs.readdirSync(backupRoot).filter(file => file.toLowerCase().endsWith('.zip')).sort();
    if (existingBackups.length > retentionCount) {
      for (const fileName of existingBackups.slice(0, Math.max(0, existingBackups.length - retentionCount))) {
        fs.unlinkSync(path.join(backupRoot, fileName));
      }
    }
    writeServerBackupLog(serverId, `Created backup ${backupEntry.name}`);
  } catch (error) {
    operationError = error;
  } finally {
    if (saveModeDisabled) {
      try {
        await sendServerConsoleCommandAndWait(serverId, ensureServerRoot(serverId), 'save-on', /automatic saving is now enabled|saving is now enabled/i);
      } catch (error) {
        saveRecoveryError = error;
        emitServerConsole(serverId, 'error', `Automatic saving could not be re-enabled after the backup attempt: ${error instanceof Error ? error.message : String(error)}. Run "save-on" from the server console immediately.`);
      }
      if (!saveRecoveryError) {
        try {
          writeServerBackupLog(serverId, 'Re-enabled automatic world saving after backup snapshot.');
        } catch (error) {
          operationError ||= new Error(`Automatic world saving was re-enabled, but the backup log could not be written: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
  }
  if (operationError || saveRecoveryError) {
    const reasons = [operationError, saveRecoveryError]
      .filter(Boolean)
      .map(error => error instanceof Error ? error.message : String(error));
    return { ok: false, error: reasons.join(' Additionally, automatic saving could not be confirmed as re-enabled: '), backup: backupEntry };
  }
  return { ok: true, backup: backupEntry };
}

ipcMain.handle('server:backup', async (_event, payload) => createServerBackup(payload?.serverId, payload));

ipcMain.handle('server:list-backups', async (_event, payload) => {
  try {
    const serverId = payload?.serverId;
    const server = getServerById(serverId);
    if (!server) return { ok: false, error: 'Server not found' };
    const backupRoot = path.join(ensureServerRoot(serverId), 'backups');
    fs.mkdirSync(backupRoot, { recursive: true });
    const backups = fs.readdirSync(backupRoot)
      .filter(file => file.toLowerCase().endsWith('.zip'))
      .map(fileName => ({
        id: fileName,
        name: fileName,
        size: fs.statSync(path.join(backupRoot, fileName)).size,
        createdAt: fs.statSync(path.join(backupRoot, fileName)).mtimeMs,
      }))
      .sort((a, b) => b.createdAt - a.createdAt);
    return { ok: true, backups };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle('launcher:delete-server', async (_event, payload) => {
  try {
    const serverId = String(payload?.serverId || '');
    const server = launcherState.servers.find(entry => entry.id === serverId);
    if (!server) return { ok: false, error: 'Server not found.' };
    if (serverProcesses.has(serverId) || ['starting', 'running', 'stopping'].includes(server.status)
      || ['matched', 'unverified'].includes(inspectPersistedServerProcess(server))) {
      return { ok: false, error: 'Stop the server before deleting it.' };
    }

    const serverRoot = path.resolve(getServerRoot(server));
    const serversRoot = path.resolve(getServersRoot());
    const relative = path.relative(serversRoot, serverRoot);
    if (!relative || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
      return { ok: false, error: 'Only Bald Launcher local server folders can be deleted here.' };
    }

    fs.rmSync(serverRoot, { recursive: true, force: true });
    launcherState.servers = launcherState.servers.filter(entry => entry.id !== serverId);
    serverProcesses.delete(serverId);
    serverStartedAt.delete(serverId);
    serverTpsSamples.delete(serverId);
    serverTpsPollRetryAt.delete(serverId);
    tpsPollState.delete(serverId);
    scheduleStateWrite();
    return { ok: true, state: launcherState };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle('server:delete-backup', async (_event, payload) => {
  try {
    const serverId = payload?.serverId;
    const backupName = String(payload?.backupName || payload?.name || '').trim();
    if (!backupName) return { ok: false, error: 'No backup name supplied' };
    const archivePath = resolveServerScopedPath(serverId, path.join('backups', backupName));
    if (!archivePath.toLowerCase().endsWith('.zip')) throw new Error('Backup must be a zip archive');
    fs.unlinkSync(archivePath);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle('server:restore-backup', async (_event, payload) => {
  try {
    const serverId = payload?.serverId;
    const server = getServerById(serverId);
    if (!server) return { ok: false, error: 'Server not found' };
    const archiveName = String(payload?.archiveName || payload?.backupName || payload?.name || '').trim();
    if (!archiveName) return { ok: false, error: 'No backup name supplied' };
    if (serverProcesses.has(serverId) || serverStartupTasks.has(serverId)
      || ['starting', 'running', 'stopping'].includes(server.status)
      || ['matched', 'unverified'].includes(inspectPersistedServerProcess(server))
      || findLiveServerProcess(server)) {
      return { ok: false, error: 'Stop the server completely before restoring a backup. No server process was terminated.' };
    }
    const archivePath = resolveServerScopedPath(serverId, path.join('backups', archiveName));
    if (!archiveName.toLowerCase().endsWith('.zip') || !fs.statSync(archivePath).isFile()) {
      return { ok: false, error: 'The selected backup is not a ZIP archive.' };
    }
    const rootPath = ensureServerRoot(serverId);
    const restored = restoreWorldFromZip(
      archivePath,
      rootPath,
      server.worldName || 'world',
      candidate => inspectMinecraftWorld(candidate).valid,
    );
    writeServerBackupLog(serverId, `Restored world from backup ${path.basename(archivePath)}`);
    return { ok: true, rollbackPath: restored.rollbackPath };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle('server:create-folder', async (_event, payload) => {
  try {
    const serverId = payload?.serverId;
    const targetPath = resolveServerScopedPath(serverId, payload?.path || '.');
    const folderName = String(payload?.name || '').trim();
    if (!folderName) throw new Error('Folder name is required');
    const folderDir = path.join(targetPath, folderName);
    fs.mkdirSync(folderDir, { recursive: true });
    return { ok: true, path: path.relative(ensureServerRoot(serverId), folderDir).split(path.sep).join('/') };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle('server:create-file', async (_event, payload) => {
  try {
    const serverId = payload?.serverId;
    const folderPath = resolveServerScopedPath(serverId, payload?.path || '.');
    const fileName = sanitizeFileName(String(payload?.name || '').trim());
    if (!fileName) throw new Error('File name is required');
    const filePath = resolveServerScopedPath(serverId, path.join(path.relative(getServerRoot(serverId), folderPath), fileName));
    if (fs.existsSync(filePath)) throw new Error('A file with that name already exists');
    fs.writeFileSync(filePath, '', 'utf8');
    return { ok: true, path: path.relative(getServerRoot(serverId), filePath).split(path.sep).join('/') };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle('server:write-settings', async (_event, payload) => {
  try {
    const server = getServerById(payload?.serverId);
    if (!server) throw new Error('Server not found');
    updateServerProperties(server);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle('server:upload-icon', async (_event, payload) => {
  try {
    const server = getServerById(payload?.serverId);
    if (!server) throw new Error('Server not found');
    const result = await dialog.showOpenDialog(mainWindow, { properties: ['openFile'], filters: [{ name: 'PNG image', extensions: ['png'] }] });
    if (result.canceled || !result.filePaths[0]) return { ok: false, canceled: true };
    const rootPath = ensureServerRoot(server.id);
    const target = path.join(rootPath, 'server-icon.png');
    fs.copyFileSync(result.filePaths[0], target);
    updateServerInState(server.id, { serverIconPath: target });
    return { ok: true, path: target };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle('server:upload-file', async (_event, payload) => {
  try {
    const serverId = payload?.serverId;
    const server = getServerById(serverId);
    if (!server) throw new Error('Server not found');
    const result = await dialog.showOpenDialog(mainWindow, { properties: ['openFile'] });
    if (result.canceled || !result.filePaths[0]) return { ok: false, canceled: true };
    const sourcePath = result.filePaths[0];
    const folderPath = resolveServerScopedPath(serverId, payload?.path || '.');
    const destination = resolveServerScopedPath(serverId, path.join(path.relative(getServerRoot(serverId), folderPath), path.basename(sourcePath)));
    fs.copyFileSync(sourcePath, destination);
    return { ok: true, path: path.relative(getServerRoot(serverId), destination).split(path.sep).join('/') };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle('server:drop-files', async (_event, payload = {}) => {
  try {
    const serverId = String(payload?.serverId || '');
    if (!getServerById(serverId)) throw new Error('Server not found.');
    const sourcePaths = Array.isArray(payload?.sourcePaths) ? payload.sourcePaths : [];
    if (!sourcePaths.length) throw new Error('No files were provided.');
    if (sourcePaths.length > 100) throw new Error('Drop at most 100 items into a server folder at a time.');
    const destinationDirectory = resolveServerScopedPath(serverId, payload?.path || '.');
    if (!fs.statSync(destinationDirectory).isDirectory()) throw new Error('The selected server destination is not a folder.');
    const serverRootRealPath = fs.realpathSync(getServerRoot(serverId));
    const destinationRealPath = fs.realpathSync(destinationDirectory);
    const relativeDestination = path.relative(serverRootRealPath, destinationRealPath);
    if (relativeDestination && (relativeDestination.startsWith('..') || path.isAbsolute(relativeDestination))) {
      throw new Error('The selected server destination resolves outside the server folder.');
    }
    const results = copyDropItems(sourcePaths, destinationDirectory).map(result => ({
      ...result,
      destinationPath: result.ok
        ? path.relative(getServerRoot(serverId), result.destinationPath).split(path.sep).join('/')
        : undefined,
    }));
    return { ok: true, results };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle('server:download-file', async (_event, payload) => {
  try {
    const serverId = payload?.serverId;
    const sourcePath = resolveServerScopedPath(serverId, payload?.path || '.');
    if (!fs.statSync(sourcePath).isFile()) throw new Error('Only files can be downloaded');
    const result = await dialog.showSaveDialog(mainWindow, { defaultPath: path.basename(sourcePath) });
    if (result.canceled || !result.filePath) return { ok: false, canceled: true };
    fs.copyFileSync(sourcePath, result.filePath);
    return { ok: true, path: result.filePath };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle('server:download-archive', async (_event, payload) => {
  try {
    const serverId = payload?.serverId;
    const rootPath = ensureServerRoot(serverId);
    const result = await dialog.showSaveDialog(mainWindow, { defaultPath: `${getServerById(serverId)?.name || 'server'}.zip` });
    if (result.canceled || !result.filePath) return { ok: false, canceled: true };
    await zipFolderToArchive(rootPath, result.filePath, ['backups']);
    return { ok: true, path: result.filePath };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle('server:reveal-path', async (_event, payload) => {
  try {
    const targetPath = resolveServerScopedPath(payload?.serverId, payload?.path || '.');
    if (!fs.existsSync(targetPath)) throw new Error('Path does not exist');
    if (process.platform === 'win32') {
      const stats = fs.statSync(targetPath);
      if (stats.isDirectory()) execFile('explorer.exe', [targetPath]);
      else execFile('explorer.exe', [`/select,${targetPath}`]);
    } else if (process.platform === 'darwin') {
      execFile('open', [fs.statSync(targetPath).isDirectory() ? targetPath : '-R', targetPath]);
    } else {
      execFile('xdg-open', [fs.statSync(targetPath).isDirectory() ? targetPath : path.dirname(targetPath)]);
    }
    return { ok: true, path: targetPath };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle('server:send-command', async (_event, payload) => {
  try {
    const serverId = payload?.serverId;
    const command = String(payload?.command || '').trim().replace(/^\/+/, '');
    if (!command) return { ok: false, error: 'No command supplied' };
    const processInfo = serverProcesses.get(serverId);
    if (!processInfo || !processInfo.stdin || processInfo.killed) return { ok: false, error: 'Server is not running' };
    processInfo.stdin.write(`${command}\n`);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle('server:get-tps', async (_event, payload) => {
  const serverId = payload?.serverId;
  let poll;
  try {
    const server = getServerById(serverId);
    const config = getServerTpsConfig(server);
    const command = config.command;
    const processInfo = serverProcesses.get(serverId);
    const checked = Boolean(server && processInfo?.stdin && !processInfo.killed);
    if (!server || !command || !processInfo?.stdin || processInfo.killed) return { ok: true, checked, available: Boolean(command), kind: config.kind, command: command || null, tps: null, mspt: null };
    const retryAt = serverTpsPollRetryAt.get(serverId) || 0;
    if (retryAt > Date.now()) {
      const sample = serverTpsSamples.get(serverId);
      return { ok: true, checked: true, available: true, kind: config.kind, command, tps: sample?.value ?? null, mspt: sample?.mspt ?? null, recordedAt: sample?.recordedAt ?? null, commandFailed: true, retryAfterMs: retryAt - Date.now() };
    }
    const activePoll = tpsPollState.get(serverId);
    if (activePoll?.inFlight) {
      const sample = serverTpsSamples.get(serverId);
      return { ok: true, checked: true, available: true, kind: config.kind, command, tps: sample?.value ?? null, mspt: sample?.mspt ?? null, recordedAt: sample?.recordedAt ?? null };
    }
    poll = { buffer: [], inFlight: true, kind: config.kind, command, tps: null, mspt: null, awaitingTps: false, awaitingMspt: false, awaitingCpu: false, sawSparkResponse: false, commandFailed: false, resolve: () => {} };
    tpsPollState.set(serverId, poll);
    const result = await new Promise(resolve => {
      let settled = false;
      const finish = value => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve(value);
      };
      poll.resolve = finish;
      const timeout = setTimeout(() => finish({
        tps: poll.tps,
        mspt: poll.mspt,
        commandFailed: poll.commandFailed || (poll.tps == null && poll.mspt == null),
      }), 5000);
      processInfo.stdin.write(`${command}\n`, error => {
        if (error) finish({ tps: null, mspt: null, commandFailed: true });
      });
    });
    if (result.commandFailed) serverTpsPollRetryAt.set(serverId, Date.now() + 15000);
    else serverTpsPollRetryAt.delete(serverId);
    if (result.tps != null || result.mspt != null) {
      const previous = serverTpsSamples.get(serverId);
      serverTpsSamples.set(serverId, {
        value: result.tps ?? previous?.value ?? null,
        mspt: result.mspt ?? previous?.mspt ?? null,
        recordedAt: Date.now(),
      });
    }
    const sample = serverTpsSamples.get(serverId);
    return { ok: true, checked: true, available: true, kind: config.kind, command, tps: sample?.value ?? null, mspt: sample?.mspt ?? null, recordedAt: sample?.recordedAt ?? null, commandFailed: Boolean(result.commandFailed) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error), checked: false, available: false, tps: null, mspt: null };
  } finally {
    if (poll && tpsPollState.get(serverId) === poll) tpsPollState.delete(serverId);
  }
});

ipcMain.handle('server:get-memory', async (_event, payload) => {
  try {
    const serverId = payload?.serverId;
    const processInfo = serverProcesses.get(serverId);
    const server = getServerById(serverId);
    if (!processInfo || !processInfo.pid) return { ok: true, memoryMb: null, rssMb: null, cpuPercent: null, uptimeSeconds: null, diskFreeGb: null, diskTotalGb: null, networkAddress: server?.address || null, playerCount: null, mspt: null };
    const stats = await pidusage(processInfo.pid);
    const root = ensureServerRoot(serverId);
    const cpuPercent = normalizeServerCpuPercent(stats.cpu);
    const playerStatus = await ServerStats.queryMinecraftStatus('127.0.0.1', server.serverPort);
    let disk = { freeGb: null, totalGb: null };
    if (fs.statfsSync) {
      try { const info = fs.statfsSync(root); disk = { freeGb: Number((info.bsize * info.bavail / 1073741824).toFixed(1)), totalGb: Number((info.bsize * info.blocks / 1073741824).toFixed(1)) }; } catch (_error) {}
    }
    const tpsSample = serverTpsSamples.get(serverId);
    return { ok: true, memoryMb: Number((stats.memory || 0) / (1024 * 1024)).toFixed(1), rssMb: Number((stats.memory || 0) / (1024 * 1024)).toFixed(1), cpuPercent, uptimeSeconds: Math.max(0, Math.floor((Date.now() - (serverStartedAt.get(serverId) || Date.now())) / 1000)), diskFreeGb: disk.freeGb, diskTotalGb: disk.totalGb, networkAddress: server?.address || null, playerCount: playerStatus?.online ?? null, playerLimit: playerStatus?.maximum ?? null, mspt: tpsSample?.mspt ?? null, msptRecordedAt: tpsSample?.recordedAt ?? null };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error), memoryMb: null, rssMb: null, cpuPercent: null, uptimeSeconds: null, diskFreeGb: null, diskTotalGb: null, networkAddress: null, playerCount: null, playerLimit: null, mspt: null };
  }
});

function applyServerSchedule(server) {
  return runDueSchedules([server], {
    execute: async (scheduledServer, schedule) => {
      if (schedule.type === 'start') return startServerById(scheduledServer.id);
      if (schedule.type === 'stop') return stopServerById(scheduledServer.id);
      if (schedule.type === 'backup') return createServerBackup(scheduledServer.id, { name: schedule.name || undefined });
      const command = String(schedule.command || '').trim();
      const processInfo = serverProcesses.get(scheduledServer.id);
      if (!processInfo?.stdin || processInfo.stdin.destroyed || processInfo.killed) {
        return { ok: false, error: 'Cannot run the scheduled command because the server is not running.' };
      }
      processInfo.stdin.write(`${command}\n`);
      return { ok: true };
    },
    persist: scheduleStateWrite,
    onError: (scheduledServer, schedule, error) => {
      emitServerConsole(scheduledServer.id, 'warn', `Scheduled ${schedule.type} action failed: ${error instanceof Error ? error.message : String(error)}`);
    },
  });
}

setInterval(() => {
  for (const server of launcherState.servers || []) void applyServerSchedule(server).catch(error => {
    emitStatus(`Scheduled server action error: ${error instanceof Error ? error.message : String(error)}`);
  });
}, 30000);

ipcMain.handle('launcher:set-active-profile', async (_event, profileId) => {
  const profile = launcherState.profiles.find(p => p.id === profileId);
  if (profile) {
    launcherState.activeProfileId = profileId;
    scheduleStateWrite();
  }
  return launcherState;
});

// ---------------------------------------------------------------------------
// IPC: content (Modrinth search + install/remove into the active profile)
// ---------------------------------------------------------------------------
function getCurseForgeClassId(type) {
  if (type === 'plugin') return 5;
  if (type === 'mod') return 6;
  if (type === 'resourcepack') return 12;
  if (type === 'shader') return 6552;
  if (type === 'datapack') return 6945;
  return undefined;
}

function getCurseForgeLoaderType(loader) {
  if (loader === 'fabric') return 4;
  if (loader === 'quilt') return 5;
  if (loader === 'forge') return 1;
  if (loader === 'neoforge') return 6;
  return undefined;
}

function getModpackLoaderKey(loader) {
  return loader === 'neoforge' ? 'neoforge' : loader === 'forge' ? 'forge' : loader === 'quilt' ? 'quilt' : 'fabric';
}

async function getModrinthModpackVersions(projectId, mcVersion, loader) {
  const response = await axios.get(`${MODRINTH_API}/project/${encodeURIComponent(projectId)}/version`, {
    params: { game_versions: JSON.stringify([mcVersion]), loaders: JSON.stringify([getModpackLoaderKey(loader)]), limit: 100 },
    timeout: 15000,
    headers: { 'User-Agent': 'BaldLauncher/0.1.0 (contact: none)' },
  });
  return sortCompatibleModrinthModpackVersions(response.data, mcVersion, getModpackLoaderKey(loader));
}

async function getCurseForgeModpackFile(projectId, mcVersion, loader) {
  const apiKey = getCurseForgeApiKey();
  if (!apiKey) throw new Error('Set CURSEFORGE_API_KEY in your user environment and restart Bald Launcher.');
  const response = await axios.get(`${CURSEFORGE_API}/mods/${encodeURIComponent(projectId)}/files`, {
    params: { gameVersion: mcVersion, modLoaderType: getCurseForgeLoaderType(loader), pageSize: 50, sortField: 3, sortOrder: 'desc' },
    timeout: 15000,
    headers: { 'x-api-key': apiKey, Accept: 'application/json', 'User-Agent': 'BaldLauncher/0.1.0' },
  });
  return (response.data?.data || []).find(file => file.downloadUrl && file.isAvailable !== false && /\.zip$/i.test(file.fileName || ''));
}

async function getModpackProjectIcon(source, projectId) {
  try {
    if (source === 'modrinth') {
      const response = await axios.get(`${MODRINTH_API}/project/${encodeURIComponent(projectId)}`, {
        timeout: 10000,
        headers: { 'User-Agent': 'BaldLauncher/0.1.0 (contact: none)' },
      });
      return response.data?.icon_url || null;
    }
    const apiKey = getCurseForgeApiKey();
    if (!apiKey) return null;
    const response = await axios.get(`${CURSEFORGE_API}/mods/${encodeURIComponent(projectId)}`, {
      timeout: 10000,
      headers: { 'x-api-key': apiKey, 'User-Agent': 'BaldLauncher/0.1.0' },
    });
    return response.data?.data?.logo?.url || null;
  } catch (error) {
    console.warn('[Modpack] Could not load project icon.', { source, projectId, message: error?.message || String(error) });
    return null;
  }
}

function isCurseForgeDistributionAllowed(item) {
  if (!item || item.isAvailable === false) return false;
  for (const key of ['allowModDistribution', 'allowDistribution', 'thirdPartyDistributionAllowed']) {
    if (item[key] === false) return false;
  }
  return true;
}

function mapCurseForgeContent(hit, projectType, loader) {
  const slug = hit.slug || String(hit.id);
  const curseForgePath = {
    mod: 'mc-mods',
    resourcepack: 'texture-packs',
    shader: 'shaders',
    datapack: 'data-packs',
    plugin: 'bukkit-plugins',
  }[projectType || 'mod'] || 'mc-mods';
  return {
    id: String(hit.id),
    name: hit.name,
    author: Array.isArray(hit.authors) && hit.authors.length ? hit.authors.map(author => author.name).filter(Boolean).join(', ') : 'Unknown creator',
    desc: hit.summary || '',
    downloads: hit.downloadCount || 0,
    iconUrl: hit.logo?.url || null,
    type: projectType || 'mod',
    minecraftVersion: hit.gameVersions?.find(version => /^\d+\.\d+(?:\.\d+)?$/.test(version)) || '',
    loader: loader || '',
    side: getCurseForgeSideLabel(hit),
    slug,
    projectUrl: hit.links?.websiteUrl || `https://www.curseforge.com/minecraft/${curseForgePath}/${encodeURIComponent(slug)}`,
    source: 'curseforge',
    distributionAllowed: isCurseForgeDistributionAllowed(hit),
  };
}

function isModpackServer(server) {
  return ['fabric', 'forge', 'neoforge', 'quilt'].includes(String(server?.serverType || server?.loader || '').toLowerCase());
}

function modpackCompatibility(server, metadata) {
  if (!isModpackServer(server)) return { compatible: false, reason: 'This server loader does not support modpacks.' };
  if (String(server.mcVersion) !== String(metadata.minecraftVersion)) return { compatible: false, reason: `Minecraft ${metadata.minecraftVersion} required (server is ${server.mcVersion}).` };
  const serverLoader = getModpackLoaderKey(server.loader || server.serverType);
  return serverLoader === getModpackLoaderKey(metadata.loader)
    ? { compatible: true, reason: 'Compatible' }
    : { compatible: false, reason: `${String(metadata.loader).replace(/^./, c => c.toUpperCase())} loader required.` };
}

function hasServerInstallableModrinthFiles(manifest) {
  const files = Array.isArray(manifest?.files) ? manifest.files : [];
  return files.some(file => String(file?.env?.server || 'optional').toLowerCase() !== 'unsupported')
    || files.length === 0;
}

ipcMain.handle('launcher:search-modpacks', async (_event, { query = '', source = 'modrinth', page = 1, mcVersion = '', loader = '' } = {}) => {
  try {
    const provider = source === 'curseforge' ? 'curseforge' : 'modrinth';
    const offset = Math.max(0, Number(page) - 1) * 20;
    if (provider === 'curseforge') {
      const apiKey = getCurseForgeApiKey();
      if (!apiKey) throw new Error('Set CURSEFORGE_API_KEY in your user environment and restart Bald Launcher.');
      const response = await axios.get(`${CURSEFORGE_API}/mods/search`, {
        params: { gameId: 432, classId: 4471, searchFilter: String(query || '').trim() || undefined, gameVersion: mcVersion || undefined, modLoaderType: getCurseForgeLoaderType(loader) || undefined, pageSize: 20, index: offset, sortField: query ? undefined : 2, sortOrder: query ? undefined : 'desc' },
        timeout: 15000, headers: { 'x-api-key': apiKey, 'User-Agent': 'BaldLauncher/0.1.0' },
      });
      return { ok: true, source: provider, hits: (response.data?.data || []).map(hit => ({ id: String(hit.id), name: hit.name, desc: hit.summary || '', iconUrl: hit.logo?.url || null, downloads: hit.downloadCount || 0, source: provider, projectUrl: hit.links?.websiteUrl || '', minecraftVersion: mcVersion, loader: loader || 'fabric' })), page: Number(page), totalHits: Number(response.data?.pagination?.totalCount) || 0 };
    }
    const facets = [['project_type:modpack']];
    if (mcVersion) facets.push([`versions:${mcVersion}`]);
    if (loader) facets.push([`categories:${getModpackLoaderKey(loader)}`]);
    const response = await axios.get(`${MODRINTH_API}/search`, {
      params: { query: String(query || '').trim() || undefined, facets: JSON.stringify(facets), limit: 20, offset },
      timeout: 15000, headers: { 'User-Agent': 'BaldLauncher/0.1.0 (contact: none)' },
    });
    return { ok: true, source: provider, hits: (response.data?.hits || []).map(hit => ({ id: String(hit.project_id), name: hit.title, desc: hit.description || '', iconUrl: hit.icon_url || null, downloads: hit.downloads || 0, source: provider, projectUrl: `https://modrinth.com/modpack/${encodeURIComponent(hit.slug || hit.project_id)}`, minecraftVersion: mcVersion, loader: loader || 'fabric' })), page: Number(page), totalHits: Number(response.data?.total_hits) || 0 };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error), hits: [] };
  }
});

ipcMain.handle('launcher:install-modpack-to-server', async (_event, payload = {}) => {
  let archivePath = '';
  let stagingRoot = '';
  try {
    const server = getServerById(payload.serverId);
    if (!server) throw new Error('Server not found.');
    if (!isModpackServer(server)) throw new Error('Modpacks can only be installed on Fabric, Forge, NeoForge, or Quilt servers.');
    if (['starting', 'process-alive', 'running'].includes(String(server.runtime?.lastKnownState || ''))) throw new Error('Stop the server before installing a modpack.');
    const source = payload.source === 'curseforge' ? 'curseforge' : 'modrinth';
    const projectId = String(payload.projectId || payload.id || '');
    if (!projectId) throw new Error('A modpack project is required.');
    const mcVersion = String(server.mcVersion);
    const loader = getModpackLoaderKey(server.loader || server.serverType);
    let archiveUrl = '';
    let packName = String(payload.name || projectId);
    if (source === 'modrinth') {
      const versions = await getModrinthModpackVersions(projectId, mcVersion, loader);
      const version = versions[0];
      if (!version) throw new Error(`No ${loader} modpack release supports Minecraft ${mcVersion}.`);
      const file = version.files.find(item => item.primary !== false && /\.mrpack$/i.test(item.filename || '')) || version.files[0];
      archiveUrl = file.url;
      packName = version.name || packName;
    } else {
      const file = await getCurseForgeModpackFile(projectId, mcVersion, loader);
      if (!file) throw new Error(`No ${loader} modpack release supports Minecraft ${mcVersion}.`);
      archiveUrl = file.downloadUrl;
      packName = file.displayName || packName;
    }
    const compatibility = modpackCompatibility(server, { minecraftVersion: mcVersion, loader });
    if (!compatibility.compatible) throw new Error(compatibility.reason);
    const root = ensureServerRoot(server.id);
    archivePath = path.join(root, `.bald-modpack-${crypto.randomUUID()}.zip`);
    await downloadToFile(archiveUrl, archivePath, `${packName} modpack`);
    const manifestName = source === 'modrinth' ? 'modrinth.index.json' : 'manifest.json';
    const manifest = JSON.parse((await readMrpackEntry(archivePath, manifestName)).toString('utf8'));
    if (source === 'modrinth' && (manifest.game !== 'minecraft' || Number(manifest.formatVersion) !== 1)) throw new Error('Unsupported Modrinth modpack format.');
    if (source === 'curseforge' && String(manifest.manifestType || '') !== 'minecraftModpack') throw new Error('Unsupported CurseForge modpack format.');
    if (source === 'modrinth' && !hasServerInstallableModrinthFiles(manifest)) throw new Error('This modpack is client-only and cannot be installed on a server.');
    stagingRoot = path.join(root, `.bald-modpack-staging-${crypto.randomUUID()}`);
    fs.mkdirSync(stagingRoot, { recursive: true });
    let installed = 0;
    if (source === 'modrinth') {
      for (const file of Array.isArray(manifest.files) ? manifest.files : []) {
        if (file?.env?.server === 'unsupported') continue;
        const relative = String(file?.path || '').replace(/\\/g, '/');
        if (!relative || relative.startsWith('/') || relative.split('/').includes('..')) throw new Error(`Unsafe modpack path: ${relative}`);
        const url = Array.isArray(file.downloads) ? file.downloads.find(item => /^https?:\/\//i.test(item)) : '';
        if (!url) continue;
        const destination = path.join(stagingRoot, relative);
        await downloadToFile(url, destination, `${packName} · ${path.basename(relative)}`);
        const expected = String(file.hashes?.sha1 || '').toLowerCase();
        if (expected && crypto.createHash('sha1').update(fs.readFileSync(destination)).digest('hex') !== expected) throw new Error(`Hash verification failed for ${relative}.`);
        installed += 1;
      }
      await extractMrpackOverrides(archivePath, stagingRoot);
    } else {
      const apiKey = getCurseForgeApiKey();
      for (const file of Array.isArray(manifest.files) ? manifest.files : []) {
        const detail = await axios.get(`${CURSEFORGE_API}/mods/${encodeURIComponent(file.projectID)}/files/${encodeURIComponent(file.fileID)}`, { timeout: 15000, headers: { 'x-api-key': apiKey, 'User-Agent': 'BaldLauncher/0.1.0' } });
        const url = detail.data?.data?.downloadUrl;
        if (!url) continue;
        const destination = path.join(stagingRoot, 'mods', path.basename(detail.data.data.fileName || `mod-${file.fileID}.jar`));
        await downloadToFile(url, destination, `${packName} · ${path.basename(destination)}`);
        installed += 1;
      }
      await extractMrpackOverrides(archivePath, stagingRoot);
    }
    for (const entry of fs.readdirSync(stagingRoot, { withFileTypes: true })) fs.cpSync(path.join(stagingRoot, entry.name), path.join(root, entry.name), { recursive: true, force: true });
    updateServerInState(server.id, { installedContent: [], modpack: { name: packName, source, projectId, minecraftVersion: mcVersion, loader, installedAt: Date.now() } });
    emitStatus(`Modpack installed · ${packName} · ${installed} files`);
    return { ok: true, server: getServerById(server.id), installed };
  } catch (error) {
    emitStatus(`Modpack install failed · ${error instanceof Error ? error.message : String(error)}`);
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    if (archivePath && fs.existsSync(archivePath)) fs.rmSync(archivePath, { force: true });
    if (stagingRoot && fs.existsSync(stagingRoot)) fs.rmSync(stagingRoot, { recursive: true, force: true });
  }
});

ipcMain.handle('launcher:install-modpack-to-profile', async (_event, payload = {}) => {
  let archivePath = '';
  let stagingRoot = '';
  let createdProfile = false;
  let profileRoot = '';
  let profileRootCreated = false;
  let profilePersisted = false;
  if (profileImportInProgress) return { ok: false, error: 'A profile import or modpack install is already in progress.' };
  profileImportInProgress = true;
  try {
    const source = payload.source === 'curseforge' ? 'curseforge' : 'modrinth';
    const projectId = String(payload.projectId || '');
    if (!projectId) throw new Error('A modpack project is required.');
    const mcVersion = String(payload.mcVersion || '1.21.1');
    const loader = getModpackLoaderKey(payload.loader || 'fabric');
    const oneClientInstall = payload.optimizationKind === 'oneclient';
    if (oneClientInstall && (source !== 'modrinth'
      || projectId !== ONECLIENT_MODPACK_PROJECT_ID
      || loader !== 'fabric'
      || payload.profileId)) {
      throw new Error('OneClient must be installed as a separate Fabric profile from the official Modrinth pack.');
    }
    const sourceProfile = oneClientInstall
      ? launcherState.profiles.find(item => item.id === String(payload.optimizationSourceProfileId || ''))
      : null;
    if (oneClientInstall && (!sourceProfile || String(sourceProfile.mcVersion) !== mcVersion)) {
      throw new Error('The selected source profile is unavailable or uses a different Minecraft version.');
    }
    emitProfileImportProgress({ phase: 'prepare', message: `Finding a compatible ${oneClientInstall ? 'OneClient ' : ''}${loader} release for Minecraft ${mcVersion}…`, percent: 2 });
    const packIconUrl = oneClientInstall ? null : await getModpackProjectIcon(source, projectId);
    let archiveUrl = '';
    let packName = String(payload.name || projectId);
    let version = null;
    let archiveFile = null;
    if (source === 'modrinth') {
      const versions = await getModrinthModpackVersions(projectId, mcVersion, loader);
      version = versions[0];
      if (!version) throw new Error(`No ${loader} modpack release supports Minecraft ${mcVersion}.`);
      archiveFile = version.files.find(item => item.primary !== false && /\.mrpack$/i.test(item.filename || '')) || version.files[0];
      archiveUrl = archiveFile?.url || '';
      if (!archiveUrl) throw new Error('The selected Modrinth release does not provide a downloadable .mrpack file.');
      packName = version.name || packName;
    } else {
      const file = await getCurseForgeModpackFile(projectId, mcVersion, loader);
      if (!file) throw new Error(`No ${loader} modpack release supports Minecraft ${mcVersion}.`);
      archiveUrl = file.downloadUrl;
      packName = file.displayName || packName;
    }
    if (oneClientInstall) {
      const existingOneClient = launcherState.profiles.find(item => item.optimizationKind === 'oneclient'
        && item.optimizationSourceProfileId === sourceProfile.id
        && String(item.mcVersion) === mcVersion
        && item.oneClientPackVersionId === version.id);
      if (existingOneClient) {
        if (existingOneClient.optimizationReady && fs.existsSync(getMinecraftRootFor(existingOneClient))) {
          launcherState.activeProfileId = existingOneClient.id;
          scheduleStateWrite();
          emitProfileImportProgress({ phase: 'complete', message: 'Using the existing OneClient profile.', percent: 100 });
          return { ok: true, profile: existingOneClient, installed: 0, addedMods: 0, reused: true, state: launcherState };
        }
        throw new Error(`An incomplete OneClient profile already exists: ${existingOneClient.name}. It was left untouched; delete it before retrying.`);
      }
      packName = `OneClient ${mcVersion} ${version.version_number || ''}`.trim();
    }
    const existingProfile = payload.profileId
      ? launcherState.profiles.find(item => item.id === String(payload.profileId))
      : null;
    if (oneClientInstall && existingProfile) throw new Error('OneClient must be installed into a new profile, not an existing profile.');
    if (payload.profileId && !existingProfile) throw new Error('Profile not found.');
    if (existingProfile && (String(existingProfile.mcVersion) !== mcVersion || String(existingProfile.loader) !== loader)) {
      throw new Error(`The modpack requires Minecraft ${mcVersion} with ${loader}; the selected profile uses ${existingProfile.mcVersion} with ${existingProfile.loader}.`);
    }
    const now = Date.now();
    const oneClientMetadata = oneClientInstall
      ? createOneClientProfileMetadata(sourceProfile, version)
      : {};
    const profile = existingProfile || normalizeProfile({
      id: createProfileId(),
      name: oneClientInstall ? packName : String(payload.name || packName),
      mcVersion,
      loader,
      createdAt: now,
      updatedAt: now,
      lastUsedAt: now,
      mods: [],
      modpackIconUrl: packIconUrl,
      ...oneClientMetadata,
    });
    createdProfile = !existingProfile;
    if (!existingProfile) profile.folderName = getProfileFolderName(profile.name, profile.id);
    profileRoot = getMinecraftRootFor(profile);
    if (createdProfile && fs.existsSync(profileRoot)) throw new Error('The new profile folder already exists; no files were changed.');
    if (createdProfile) {
      fs.mkdirSync(path.dirname(profileRoot), { recursive: true });
      fs.mkdirSync(profileRoot);
      profileRootCreated = true;
    } else {
      fs.mkdirSync(profileRoot, { recursive: true });
    }
    ensureLauncherGameFolders(profileRoot);
    archivePath = path.join(profileRoot, `.bald-modpack-${crypto.randomUUID()}.zip`);
    const archiveHash = await downloadToFile(
      archiveUrl,
      archivePath,
      `${packName} modpack`,
      null,
      oneClientInstall ? progress => emitProfileImportProgress({
        phase: 'archive',
        message: `Downloading OneClient pack · ${(progress.loaded / 1048576).toFixed(1)} MB${progress.total ? ` / ${(progress.total / 1048576).toFixed(1)} MB` : ''}`,
        percent: progress.total ? Math.min(10, Math.floor(3 + (progress.loaded / progress.total) * 7)) : 3,
      }) : undefined,
    );
    const expectedArchiveHash = String(archiveFile?.hashes?.sha1 || '').toLowerCase();
    if (expectedArchiveHash && archiveHash.toLowerCase() !== expectedArchiveHash) {
      throw new Error('The downloaded modpack archive failed SHA-1 verification.');
    }
    const manifestName = source === 'modrinth' ? 'modrinth.index.json' : 'manifest.json';
    const manifest = JSON.parse((await readMrpackEntry(archivePath, manifestName)).toString('utf8'));
    if (source === 'modrinth' && (manifest.game !== 'minecraft' || Number(manifest.formatVersion) !== 1)) throw new Error('Unsupported Modrinth modpack format.');
    if (source === 'curseforge' && String(manifest.manifestType || '') !== 'minecraftModpack') throw new Error('Unsupported CurseForge modpack format.');
    const dependencies = manifest.dependencies && typeof manifest.dependencies === 'object' ? manifest.dependencies : {};
    if (source === 'modrinth') {
      const packDependencies = validateModrinthPackDependencies(dependencies, mcVersion, loader, oneClientInstall);
      if (oneClientInstall) {
        profile.loaderVersion = normalizeLoaderVersion(packDependencies.loaderVersion);
        if (!profile.loaderVersion) throw new Error('The OneClient archive contains an invalid Fabric loader version.');
      }
    }
    stagingRoot = path.join(profileRoot, `.bald-modpack-staging-${crypto.randomUUID()}`);
    fs.mkdirSync(stagingRoot, { recursive: true });
    let installed = 0;
    const modpackMods = [];
    if (source === 'modrinth') {
      const packFiles = (Array.isArray(manifest.files) ? manifest.files : []).filter(file => file?.env?.client !== 'unsupported');
      if (oneClientInstall) {
        if (!packFiles.some(file => /^mods\/.+\.jar$/i.test(String(file?.path || '')))) {
          throw new Error('The OneClient archive does not contain any supported client mods.');
        }
        const archiveInfo = await inspectMrpackOverrides(archivePath, progress => emitProfileImportProgress({
          phase: 'inspect',
          message: 'Checking OneClient archive paths and extracted size…',
          percent: Math.min(12, 10 + Math.floor((progress.percent || 0) * 0.02)),
        }));
        const knownDownloadBytes = packFiles.reduce((sum, file) => sum + Math.max(0, Number(file.fileSize) || 0), 0);
        const unknownDownloadCount = packFiles.filter(file => !(Number(file.fileSize) > 0)).length;
        const requiredBytes = Math.ceil((
          (knownDownloadBytes + archiveInfo.uncompressedBytes) * 2
          + unknownDownloadCount * 12 * 1024 * 1024
        ) * 1.15);
        if (fs.statfsSync) {
          const stats = fs.statfsSync(profileRoot);
          const freeBytes = stats.bsize * stats.bavail;
          if (freeBytes < requiredBytes) {
            throw new Error(`Not enough free disk space for OneClient. It needs approximately ${(requiredBytes / 1024 ** 3).toFixed(1)} GB; ${(freeBytes / 1024 ** 3).toFixed(1)} GB is available.`);
          }
        }
        const results = await runProfileImportDownloads({
          files: packFiles,
          destinationRoot: stagingRoot,
          concurrency: 4,
          onProgress: progress => {
            const percent = Math.min(88, Math.floor(12 + (progress.percent * 0.76)));
            const fileLabel = progress.currentFile ? ` · ${path.basename(progress.currentFile)}` : '';
            emitProfileImportProgress({
              phase: 'download',
              message: `Downloading OneClient ${progress.completed}/${progress.total} files${progress.active > 1 ? ` · ${progress.active} active` : ''}${fileLabel}`,
              percent,
              completed: progress.completed,
              total: progress.total,
              active: progress.active,
            });
          },
          downloadFile: async (file, destination, onTransfer) => {
            const relative = String(file?.path || '').replace(/\\/g, '/');
            const url = Array.isArray(file?.downloads) ? file.downloads.find(item => /^https?:\/\//i.test(item)) : '';
            if (!url) throw new Error('No download URL');
            const actualHash = await downloadToFile(url, destination, `OneClient · ${path.basename(relative)}`, null, onTransfer);
            const expectedHash = String(file.hashes?.sha1 || '').toLowerCase();
            if (expectedHash && actualHash.toLowerCase() !== expectedHash) {
              await fs.promises.rm(destination, { force: true });
              throw new Error('SHA-1 verification failed');
            }
          },
        });
        const failedDownloads = results.filter(result => result.error);
        if (failedDownloads.length) {
          const firstFailure = failedDownloads[0];
          throw new Error(`Could not download ${failedDownloads.length} OneClient file(s); ${firstFailure.relative}: ${firstFailure.error}`);
        }
        installed = results.length;
        for (const result of results) {
          if (/^mods\//i.test(result.relative) && /\.jar$/i.test(result.relative)) {
            modpackMods.push({
              fileName: path.basename(result.relative),
              relative: result.relative,
              source: 'modrinth',
              versionId: '',
              iconUrl: null,
            });
          }
        }
        if (!modpackMods.length) throw new Error('The OneClient pack did not install any client mods.');
      } else {
        for (const file of packFiles) {
          const relative = String(file?.path || '').replace(/\\/g, '/');
          if (!relative || relative.startsWith('/') || relative.split('/').includes('..')) throw new Error(`Unsafe modpack path: ${relative}`);
          const url = Array.isArray(file.downloads) ? file.downloads.find(item => /^https?:\/\//i.test(item)) : '';
          if (!url) continue;
          const destination = path.join(stagingRoot, relative);
          await downloadToFile(url, destination, `${packName} · ${path.basename(relative)}`);
          const expected = String(file.hashes?.sha1 || '').toLowerCase();
          if (expected && crypto.createHash('sha1').update(fs.readFileSync(destination)).digest('hex') !== expected) throw new Error(`Hash verification failed for ${relative}.`);
          if (/^mods\//i.test(relative) && /\.jar$/i.test(relative)) {
            modpackMods.push({ fileName: path.basename(relative), relative, source: 'modrinth', versionId: '', iconUrl: packIconUrl });
          }
          installed += 1;
        }
      }
      await extractMrpackOverrides(archivePath, stagingRoot, progress => {
        if (oneClientInstall) {
          emitProfileImportProgress({
            phase: 'extract',
            message: `Extracting OneClient overrides · ${progress.completed}/${progress.total}`,
            percent: Math.min(97, 88 + Math.floor((progress.percent || 0) * 0.09)),
          });
        }
      });
    } else {
      const apiKey = getCurseForgeApiKey();
      for (const file of Array.isArray(manifest.files) ? manifest.files : []) {
        const detail = await axios.get(`${CURSEFORGE_API}/mods/${encodeURIComponent(file.projectID)}/files/${encodeURIComponent(file.fileID)}`, { timeout: 15000, headers: { 'x-api-key': apiKey, 'User-Agent': 'BaldLauncher/0.1.0' } });
        const url = detail.data?.data?.downloadUrl;
        if (!url) continue;
        const destination = path.join(stagingRoot, 'mods', path.basename(detail.data.data.fileName || `mod-${file.fileID}.jar`));
        await downloadToFile(url, destination, `${packName} · ${path.basename(destination)}`);
        modpackMods.push({ fileName: path.basename(destination), relative: `mods/${path.basename(destination)}`, source: 'curseforge', fileId: String(file.fileID), iconUrl: packIconUrl });
        installed += 1;
      }
      await extractMrpackOverrides(archivePath, stagingRoot);
    }
    emitProfileImportProgress({ phase: 'install', message: `Installing ${packName} into the separate profile…`, percent: 98 });
    for (const entry of fs.readdirSync(stagingRoot, { withFileTypes: true })) fs.cpSync(path.join(stagingRoot, entry.name), path.join(profileRoot, entry.name), { recursive: true, force: true });
    const trackedPaths = new Set((profile.mods || []).map(item => String(item.fileName || '').toLowerCase()));
    const extractedEntries = [];
    const collectExtracted = directory => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const absolute = path.join(directory, entry.name);
        if (entry.isDirectory()) collectExtracted(absolute);
        else {
          const relative = path.relative(stagingRoot, absolute).replace(/\\/g, '/');
          if (/^(mods|resourcepacks|shaderpacks|datapacks)\//i.test(relative) && /\.(jar|zip)$/i.test(relative)) extractedEntries.push(relative);
        }
      }
    };
    collectExtracted(stagingRoot);
    for (const relative of extractedEntries) {
      if (!modpackMods.some(item => item.relative.toLowerCase() === relative.toLowerCase())) {
        modpackMods.push({ fileName: path.basename(relative), relative, source, iconUrl: packIconUrl });
      }
    }
    const markerEntries = modpackMods
      .filter(item => !trackedPaths.has(item.fileName.toLowerCase()))
      .map(item => normalizeInstalledContent({
        id: `modpack:${source}:${projectId}:${item.fileName}`,
        name: item.fileName.replace(/\.(jar|zip)$/i, ''),
        type: item.relative.toLowerCase().startsWith('resourcepacks/')
          ? 'resourcepack'
          : item.relative.toLowerCase().startsWith('shaderpacks/')
            ? 'shader'
            : item.relative.toLowerCase().startsWith('datapacks/')
              ? 'datapack'
              : 'mod',
        fileName: item.fileName,
        source: item.source,
        versionId: item.versionId || '',
        fileId: item.fileId || '',
        iconUrl: item.iconUrl || packIconUrl,
        minecraftVersion: mcVersion,
        loader,
        enabled: true,
        modpack: true,
        modpackName: packName,
        modpackProjectId: projectId,
      }));
    profile.mods = [...(profile.mods || []), ...markerEntries];
    profile.modpackIconUrl = oneClientInstall ? null : packIconUrl || profile.modpackIconUrl || null;
    if (oneClientInstall) profile.optimizationReady = true;
    profile.updatedAt = now;
    if (createdProfile) {
      launcherState.profiles.push(profile);
      profilePersisted = true;
    }
    launcherState.activeProfileId = profile.id;
    scheduleStateWrite();
    emitProfileImportProgress({ phase: 'complete', message: `${packName} profile is ready.`, percent: 100 });
    emitStatus(`${createdProfile ? 'Profile created' : 'Mods added to profile'} from modpack · ${packName} · ${installed} files`);
    return { ok: true, profile, installed, addedMods: markerEntries.length, state: launcherState };
  } catch (error) {
    let message = error instanceof Error ? error.message : String(error);
    if (createdProfile && profileRootCreated && !profilePersisted && profileRoot) {
      try {
        const rootStats = await fs.promises.lstat(profileRoot);
        if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) {
          throw new Error('The new profile directory is no longer a regular directory.');
        }
        await fs.promises.rm(profileRoot, { recursive: true, force: true });
      } catch (cleanupError) {
        if (cleanupError.code !== 'ENOENT') {
          console.error('[Modpack] Could not clean up the failed profile directory.', cleanupError);
          message += ' The partial profile folder could not be removed automatically.';
        }
      }
    }
    emitProfileImportProgress({ phase: 'error', message, percent: 0 });
    emitStatus(`Modpack profile creation failed · ${message}`);
    return { ok: false, error: message };
  } finally {
    try {
      if (archivePath && fs.existsSync(archivePath)) fs.rmSync(archivePath, { force: true });
      if (stagingRoot && fs.existsSync(stagingRoot)) fs.rmSync(stagingRoot, { recursive: true, force: true });
    } finally {
      profileImportInProgress = false;
    }
  }
});

async function getCurseForgeFiles(projectId, mcVersion, loader, type, includeAll = false, signal = null) {
  const apiKey = getCurseForgeApiKey();
  if (!apiKey) throw new Error('Set CURSEFORGE_API_KEY in your user environment and restart Bald Launcher.');
  const files = [];
  const pageSize = 50;
  for (let pageIndex = 0; ; pageIndex += 1) {
    const response = await axios.get(`${CURSEFORGE_API}/mods/${encodeURIComponent(projectId)}/files`, {
      params: {
        gameVersion: mcVersion,
        pageSize,
        index: pageIndex * pageSize,
        modLoaderType: type === 'mod' ? getCurseForgeLoaderType(loader) : undefined,
      },
      timeout: 15000,
      signal: signal || undefined,
      headers: { 'x-api-key': apiKey, Accept: 'application/json', 'User-Agent': 'BaldLauncher/0.1.0' },
    });
    const page = response.data?.data || [];
    files.push(...page);
    const totalCount = Number(response.data?.pagination?.totalCount);
    if (!includeAll || !page.length || page.length < pageSize || (Number.isFinite(totalCount) && (pageIndex + 1) * pageSize >= totalCount)) break;
  }
  return files.filter(file => {
    if (!file.downloadUrl || !isCurseForgeDistributionAllowed(file)) return false;
    if (Array.isArray(file.gameVersions) && !file.gameVersions.includes(mcVersion)) return false;
    return true;
  });
}

async function resolveCurseForgeFile(projectId, mcVersion, loader, type, fileId = null, requireServerCompatible = false, signal = null) {
  const projectResponse = await axios.get(`${CURSEFORGE_API}/mods/${encodeURIComponent(projectId)}`, {
    timeout: 10000,
    signal: signal || undefined,
    headers: { 'x-api-key': getCurseForgeApiKey(), Accept: 'application/json', 'User-Agent': 'BaldLauncher/0.1.0' },
  });
  if (!isCurseForgeDistributionAllowed(projectResponse.data?.data)) {
    throw new Error('CurseForge does not permit third-party distribution of this project.');
  }
  const files = await getCurseForgeFiles(projectId, mcVersion, loader, type, Boolean(fileId), signal);
  const compatibleFiles = requireServerCompatible && type === 'mod'
    ? files.filter(isCurseForgeServerCompatible)
    : files;
  const file = selectCurseForgeFile(compatibleFiles, fileId);
  if (!file) throw new Error(`CurseForge has no compatible downloadable file for Minecraft ${mcVersion}.`);
  return file;
}

async function installCurseForgeContent(projectId, mcVersion, loader, type, filePath, name, fileId = null, requireServerCompatible = false, signal = null) {
  const file = await resolveCurseForgeFile(projectId, mcVersion, loader, type, fileId, requireServerCompatible, signal);
  const expectedSha1 = getCurseForgeSha1(file);
  if (!expectedSha1) throw new Error(`CurseForge did not provide a SHA-1 checksum for ${name}; download was not installed.`);
  const actualSha1 = await downloadToFile(file.downloadUrl, filePath, name, signal);
  if (actualSha1.toLowerCase() !== expectedSha1.toLowerCase()) {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    throw new Error(`SHA-1 verification failed for ${name}`);
  }
  return {
    fileId: String(file.id),
    installedVersion: String(file.fileName || file.displayName || ''),
    versionType: Number(file.releaseType) === 1 ? 'release' : Number(file.releaseType) === 2 ? 'beta' : 'alpha',
    side: getCurseForgeSideLabel(file),
    sha1: expectedSha1,
    fileName: path.basename(filePath),
    requiredDependencies: (Array.isArray(file.dependencies) ? file.dependencies : [])
      .filter(dependency => Number(dependency?.relationType) === 3 && dependency?.modId)
      .map(dependency => ({
        projectId: String(dependency.modId),
        fileId: dependency.fileId ? String(dependency.fileId) : null,
        source: 'curseforge',
      })),
  };
}

ipcMain.handle('launcher:get-content-versions', async (_event, payload = {}) => {
  try {
    const server = payload.serverId ? getServerById(payload.serverId) : null;
    const profile = payload.profileId
      ? launcherState.profiles.find(item => item.id === String(payload.profileId))
      : getActiveProfile();
    if (payload.serverId && !server) throw new Error('Server not found');
    if (!server && !profile) throw new Error('Profile not found');
    const type = String(payload.type || 'mod').toLowerCase();
    const source = payload.source === 'curseforge' ? 'curseforge' : 'modrinth';
    const mcVersion = String(server?.mcVersion || profile?.mcVersion || '');
    const loader = String(server
      ? (SERVER_CONTENT_TYPES[String(server.serverType || '').toLowerCase()]?.loader || server.serverType || server.loader || '')
      : profile?.loader || '').toLowerCase();
    const projectId = String(payload.id || '');
    if (!projectId) throw new Error('No project ID was provided');
    let versions;
    if (source === 'curseforge') {
      const files = await getCurseForgeFiles(projectId, mcVersion, loader, type, true);
      versions = files.map(file => ({
        id: String(file.id),
        versionId: String(file.id),
        name: file.displayName || file.fileName,
        versionNumber: file.fileName,
        versionType: Number(file.releaseType) === 1 ? 'release' : Number(file.releaseType) === 2 ? 'beta' : 'alpha',
        publishedAt: file.fileDate || '',
        fileName: file.fileName,
        side: getCurseForgeSideLabel(file),
      }));
    } else {
      let rows = await getModrinthVersions(projectId, mcVersion, loader, type, true);
      const mapVersions = candidates => candidates.map(version => {
        const selected = selectModrinthVersion([version], version.id);
        return selected ? {
          id: version.id,
          versionId: version.id,
          name: version.name || version.version_number,
          versionNumber: version.version_number,
          versionType: version.version_type,
          publishedAt: version.date_published || '',
          fileName: selected.file.filename,
          side: getModrinthSideLabel(version),
        } : null;
      }).filter(Boolean);
      versions = mapVersions(rows);
      if (server && loader && versions.length === 0) {
        const unfilteredRows = await getModrinthVersions(projectId, mcVersion, '', type, true);
        const serverType = String(server.serverType || '').toLowerCase();
        const compatibleLoaders = ['paper', 'purpur', 'folia', 'spigot', 'bukkit'].includes(serverType)
          ? ['paper', 'purpur', 'folia', 'spigot', 'bukkit']
          : ['velocity', 'waterfall', 'bungeecord'].includes(serverType)
            ? ['velocity', 'waterfall', 'bungeecord']
            : [loader];
        rows = unfilteredRows.filter(version => !Array.isArray(version.loaders)
          || version.loaders.some(item => compatibleLoaders.includes(String(item).toLowerCase())));
        versions = mapVersions(rows);
      }
    }
    if (server && type === 'mod' && source === 'modrinth') {
      versions = versions.filter(version => version.side === 'Server only' || version.side === 'Server or Client' || version.side === 'Server optional');
    } else if (server && type === 'mod' && source === 'curseforge') {
      versions = versions.filter(isCurseForgeServerCompatible);
    }
    return { ok: true, versions, source, minecraftVersion: mcVersion, loader };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error), versions: [] };
  }
});

function getServerContentRules(serverType) {
  const type = String(serverType || 'paper').toLowerCase();
  const config = SERVER_CONTENT_TYPES[type] || SERVER_CONTENT_TYPES.paper;
  return { allowed: config.projectTypes, loaders: config.loader ? [config.loader] : [], projectTypes: config.projectTypes };
}

ipcMain.handle('launcher:get-installed-mods', async (_event, payload = {}) => {
  try {
    let modsFolder;
    if (payload?.serverId) {
      const server = getServerById(payload.serverId);
      if (!server) throw new Error('Server not found');
      modsFolder = path.join(getServerRoot(server), 'mods');
    } else if (payload?.profileId) {
      const profile = launcherState.profiles.find(item => item.id === String(payload.profileId));
      if (!profile) throw new Error('Profile not found');
      modsFolder = getContentFolder('mod', getMinecraftRootFor(profile.id));
    } else {
      throw new Error('A server or profile is required to inspect installed mods');
    }

    return { ok: true, ...await readInstalledModInventory(modsFolder) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

async function identifyModrinthFileByHash(filePath) {
  const stat = fs.statSync(filePath);
  const cacheKey = `${filePath}\0${stat.size}\0${stat.mtimeMs}`;
  const cachedHash = installedContentHashCache.get(cacheKey);
  if (cachedHash) return cachedHash;
  const hash = await new Promise((resolve, reject) => {
    const digest = crypto.createHash('sha1');
    const stream = fs.createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', chunk => digest.update(chunk));
    stream.on('end', () => resolve(digest.digest('hex')));
  });
  if (modrinthHashCache.has(hash)) {
    const result = { ...modrinthHashCache.get(hash), sha1: hash };
    installedContentHashCache.set(cacheKey, result);
    return result;
  }
  try {
    const response = await axios.get(`${MODRINTH_API}/version_file/${hash}`, {
      params: { algorithm: 'sha1' },
      timeout: 10000,
      headers: { 'User-Agent': 'BaldLauncher/0.1.0 (contact: none)' },
    });
    const version = response.data;
    const result = {
      id: String(version?.project_id || ''),
      versionId: String(version?.id || ''),
      installedVersion: String(version?.version_number || ''),
      versionType: String(version?.version_type || ''),
      publishedAt: String(version?.date_published || ''),
      environment: String(version?.environment?.server || ''),
      side: getModrinthSideLabel(version),
    };
    modrinthHashCache.set(hash, result);
    const identified = { ...result, sha1: hash };
    installedContentHashCache.set(cacheKey, identified);
    return identified;
  } catch (error) {
    if (error?.response?.status !== 404) {
      console.warn('[Content] Modrinth hash lookup failed.', {
        status: error?.response?.status || null,
        message: error?.message || String(error),
      });
    }
    const unidentified = { sha1: hash };
    modrinthHashCache.set(hash, { id: '', versionId: '', installedVersion: '', versionType: '', publishedAt: '', environment: '', side: '' });
    installedContentHashCache.set(cacheKey, unidentified);
    return unidentified;
  }
}

async function getInstalledCurseForgeFingerprint(filePath) {
  const stat = await fs.promises.stat(filePath);
  const cacheKey = `${filePath}\0${stat.size}\0${stat.mtimeMs}`;
  const cached = installedContentFingerprintCache.get(cacheKey);
  if (cached != null) return cached;
  const buffer = await fs.promises.readFile(filePath);
  const fingerprint = getCurseForgeFingerprint(buffer);
  installedContentFingerprintCache.set(cacheKey, fingerprint);
  return fingerprint;
}

async function identifyCurseForgeFilesByFingerprint(entries) {
  const matches = new Map();
  const apiKey = getCurseForgeApiKey();
  if (!apiKey || !entries.length) return { matches, issues: [] };
  const fingerprints = [...new Set(entries.map(entry => entry.fingerprint).filter(value => Number.isFinite(value) && value > 0))];
  const issues = [];
  const now = Date.now();
  const uncached = fingerprints.filter(fingerprint => {
    const cached = installedCurseForgeMatchCache.get(fingerprint);
    return !cached || cached.expiresAt <= now;
  });
  for (let start = 0; start < uncached.length; start += 100) {
    const batch = uncached.slice(start, start + 100);
    try {
      const response = await axios.post(`${CURSEFORGE_API}/fingerprints/432`, { fingerprints: batch }, {
        timeout: 15000,
        headers: { 'x-api-key': apiKey, Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'BaldLauncher/0.1.0' },
      });
      const batchMatches = new Map();
      for (const match of response.data?.data?.exactMatches || []) {
        const file = match?.file || {};
        const fingerprint = Number(file.fileFingerprint ?? file.fingerprint ?? match.fingerprint);
        const projectId = String(match.id || file.modId || '');
        if (!fingerprint || !projectId || !file.id) continue;
        batchMatches.set(fingerprint, {
          id: projectId,
          fileId: String(file.id),
          versionId: String(file.id),
          installedVersion: String(file.fileName || file.displayName || ''),
          versionType: Number(file.releaseType) === 1 ? 'release' : Number(file.releaseType) === 2 ? 'beta' : 'alpha',
          publishedAt: String(file.fileDate || ''),
          side: getCurseForgeSideLabel(file),
          sha1: getCurseForgeSha1(file) || '',
        });
      }
      for (const fingerprint of batch) {
        installedCurseForgeMatchCache.set(fingerprint, {
          value: batchMatches.get(fingerprint) || null,
          expiresAt: Date.now() + 10 * 60 * 1000,
        });
      }
    } catch (error) {
      console.warn('[Content] CurseForge fingerprint lookup failed.', {
        status: error?.response?.status || null,
        message: error?.response?.data?.message || error?.message || String(error),
      });
      issues.push('CurseForge fingerprint lookup');
      for (const fingerprint of batch) {
        installedCurseForgeMatchCache.set(fingerprint, { value: null, expiresAt: Date.now() + 30 * 1000 });
      }
    }
  }
  for (const entry of entries) {
    const cached = installedCurseForgeMatchCache.get(entry.fingerprint);
    if (cached?.value) matches.set(entry.fileName, cached.value);
  }
  return { matches, issues: [...new Set(issues)] };
}

async function getCachedModrinthLatest(projectId, mcVersion, loader, type) {
  const key = JSON.stringify([projectId, mcVersion, loader, type]);
  const cached = modrinthVersionsCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const versions = await getModrinthVersions(projectId, mcVersion, loader, type);
  const selected = selectModrinthVersion(versions);
  const value = selected ? {
    versionId: selected.version.id,
    version: selected.version.version_number,
    versionType: selected.version.version_type,
    publishedAt: selected.version.date_published || '',
  } : null;
  modrinthVersionsCache.set(key, { value, expiresAt: Date.now() + 10 * 60 * 1000 });
  return value;
}

async function getCachedCurseForgeLatest(projectId, mcVersion, loader, type) {
  const key = JSON.stringify([projectId, mcVersion, loader, type]);
  const cached = curseForgeVersionsCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const files = await getCurseForgeFiles(projectId, mcVersion, loader, type);
  const selected = selectCurseForgeFile(files);
  const value = selected ? {
    versionId: String(selected.id),
    version: String(selected.fileName || selected.displayName || ''),
  } : null;
  curseForgeVersionsCache.set(key, { value, expiresAt: Date.now() + 10 * 60 * 1000 });
  return value;
}

ipcMain.handle('launcher:sync-profile-content', async (_event, profileId) => {
  try {
    const index = launcherState.profiles.findIndex(item => item.id === String(profileId || ''));
    if (index < 0) throw new Error('Profile not found');
    const profile = launcherState.profiles[index];
    const root = getMinecraftRootFor(profile.id);
    const oldEntries = Array.isArray(profile.mods) ? profile.mods.map(normalizeInstalledContent) : [];
    const candidates = [];
    const modsFolder = getContentFolder('mod', root);
    const inventory = await readInstalledModInventory(modsFolder);
    const findPreviousEntry = file => oldEntries.find(entry => entry.fileName
      && contentIdentity(path.basename(entry.fileName).replace(/\.disabled$/i, '')) === contentIdentity(path.basename(file.fileName).replace(/\.disabled$/i, '')))
      || oldEntries.find(entry => entry.type === 'mod' && contentIdentity(entry.name) === contentIdentity(file.name));
    const fingerprintEntries = [];
    const fingerprintIssues = [];
    if (getCurseForgeApiKey()) {
      for (const file of inventory.mods) {
        const previous = findPreviousEntry(file);
        if (previous?.source && !previous.external) continue;
        const filePath = path.join(modsFolder, file.fileName);
        try {
          fingerprintEntries.push({ fileName: file.fileName, fingerprint: await getInstalledCurseForgeFingerprint(filePath) });
        } catch (error) {
          console.warn('[Content] Could not fingerprint an installed mod for CurseForge matching.', {
            fileName: file.fileName,
            message: error?.message || String(error),
          });
          fingerprintIssues.push(file.fileName);
        }
      }
    }
    const curseForgeMatches = await identifyCurseForgeFilesByFingerprint(fingerprintEntries);
    const syncIssues = [...inventory.issues, ...fingerprintIssues, ...curseForgeMatches.issues];
    for (const file of inventory.mods) {
      const previous = findPreviousEntry(file);
      const filePath = path.join(modsFolder, file.fileName);
      const candidate = normalizeInstalledContent({
        ...(previous || {}),
        id: previous?.id || `local:${file.fileName}`,
        name: previous?.name && !previous.external ? previous.name : file.name,
        type: 'mod',
        fileName: file.fileName.replace(/\.disabled$/i, ''),
        enabled: file.enabled,
        installedVersion: previous?.installedVersion || file.modVersion || '',
        external: previous ? previous.external : true,
      });
      if (!candidate.versionId || !candidate.source || previous?.external) {
        const identified = await identifyModrinthFileByHash(filePath);
        if (identified.id && identified.versionId) {
          const projectResponse = await axios.get(`${MODRINTH_API}/project/${encodeURIComponent(identified.id)}`, {
            timeout: 10000,
            headers: { 'User-Agent': 'BaldLauncher/0.1.0 (contact: none)' },
          }).catch(error => {
            console.warn('[Content] Could not load Modrinth project metadata for an installed mod.', {
              projectId: identified.id,
              message: error?.message || String(error),
            });
            return null;
          });
          Object.assign(candidate, identified, {
            source: 'modrinth',
            slug: projectResponse?.data?.slug || '',
            name: projectResponse?.data?.title || file.name,
            author: projectResponse?.data?.author || '',
            iconUrl: projectResponse?.data?.icon_url || null,
            projectUrl: projectResponse?.data?.slug ? `https://modrinth.com/mod/${encodeURIComponent(projectResponse.data.slug)}` : '',
            external: previous ? previous.external : true,
          });
        } else {
          const curseForgeMatch = curseForgeMatches.matches.get(file.fileName);
          if (curseForgeMatch) {
            Object.assign(candidate, curseForgeMatch, {
              source: 'curseforge',
              external: true,
            });
          }
        }
      } else if (previous?.source === 'modrinth') {
        const identified = await identifyModrinthFileByHash(filePath);
        if (identified.versionId) Object.assign(candidate, identified);
      }
      if (candidate.source === 'modrinth' && candidate.id && candidate.versionId) {
        try {
          const latest = await getCachedModrinthLatest(candidate.id, profile.mcVersion, profile.loader, 'mod');
          candidate.latestVersionId = latest?.versionId || '';
          candidate.latestVersion = latest?.version || '';
          candidate.updateAvailable = Boolean(latest?.versionId && latest.versionId !== candidate.versionId
            && (!candidate.publishedAt || !latest.publishedAt || Date.parse(latest.publishedAt) > Date.parse(candidate.publishedAt)));
        } catch (error) {
          console.warn('[Content] Could not check for a mod update.', {
            projectId: candidate.id,
            message: error?.message || String(error),
          });
        }
      } else if (candidate.source === 'curseforge' && candidate.id && candidate.fileId) {
        try {
          const latest = await getCachedCurseForgeLatest(candidate.id, profile.mcVersion, profile.loader, candidate.type);
          candidate.latestVersionId = latest?.versionId || '';
          candidate.latestVersion = latest?.version || '';
          candidate.updateAvailable = Boolean(latest?.versionId && latest.versionId !== candidate.fileId);
        } catch (error) {
          console.warn('[Content] Could not check for a CurseForge mod update.', {
            projectId: candidate.id,
            message: error?.message || String(error),
          });
        }
      }
      candidates.push(candidate);
    }
    for (const type of ['resourcepack', 'shader']) {
      const folder = getContentFolder(type, root);
      if (!fs.existsSync(folder)) continue;
      for (const item of fs.readdirSync(folder, { withFileTypes: true })) {
        if (!item.isFile() || !/\.zip(?:\.disabled)?$/i.test(item.name)) continue;
        const previous = oldEntries.find(entry => entry.type === type && entry.fileName
          && contentIdentity(path.basename(entry.fileName).replace(/\.disabled$/i, '')) === contentIdentity(path.basename(item.name).replace(/\.disabled$/i, '')));
        const iconUrl = type === 'resourcepack'
          ? (readResourcePackIcon(path.join(folder, item.name)) || previous?.iconUrl || null)
          : (previous?.iconUrl || null);
        candidates.push(normalizeInstalledContent({
          ...(previous || {}),
          id: previous?.id || `local:${type}:${item.name}`,
          name: previous?.name || path.basename(item.name).replace(/\.zip(?:\.disabled)?$/i, ''),
          type,
          fileName: item.name.replace(/\.disabled$/i, ''),
          enabled: !/\.disabled$/i.test(item.name),
          iconUrl,
          external: !previous,
        }));
      }
    }
    const nextJson = JSON.stringify(candidates);
    if (JSON.stringify(oldEntries) !== nextJson) {
      launcherState.profiles[index].mods = candidates;
      scheduleStateWrite();
    }
    return { ok: true, mods: candidates, issues: [...new Set(syncIssues)] };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle('launcher:sync-server-content', async (_event, serverId) => {
  try {
    const server = getServerById(serverId);
    if (!server) throw new Error('Server not found');
    const root = getServerRoot(server.id);
    const oldEntries = Array.isArray(server.installedContent) ? server.installedContent.map(normalizeInstalledContent) : [];
    const candidates = [];
    const syncIssues = [];
    const loader = String(SERVER_CONTENT_TYPES[String(server.serverType || '').toLowerCase()]?.loader || server.serverType || '').toLowerCase();

    for (const type of ['mod', 'plugin']) {
      const folder = getServerContentFolder(server, type, root);
      if (!fs.existsSync(folder)) continue;
      let files;
      if (type === 'mod') {
        const inventory = await readInstalledModInventory(folder);
        files = inventory.mods;
        syncIssues.push(...inventory.issues);
      } else {
        files = fs.readdirSync(folder, { withFileTypes: true })
          .filter(item => item.isFile() && /\.jar(?:\.disabled)?$/i.test(item.name))
          .map(item => ({
            fileName: item.name,
            name: path.basename(item.name).replace(/\.jar(?:\.disabled)?$/i, ''),
            modIds: [],
            modVersion: '',
            enabled: !/\.disabled$/i.test(item.name),
          }));
      }

      const fingerprintEntries = [];
      const fingerprintIssues = [];
      const typeCandidates = [];
      for (const file of files) {
        const normalizedFileName = path.basename(String(file.fileName || '')).replace(/\.disabled$/i, '');
        const previous = oldEntries.find(entry => entry.type === type && entry.fileName
          && contentIdentity(path.basename(entry.fileName).replace(/\.disabled$/i, '')) === contentIdentity(normalizedFileName))
          || oldEntries.find(entry => entry.type === type && contentIdentity(entry.name) === contentIdentity(file.name));
        const filePath = path.join(folder, file.fileName);
        const candidate = normalizeInstalledContent({
          ...(previous || {}),
          id: previous?.id || `local:${type}:${normalizedFileName}`,
          name: previous?.name && !previous.external ? previous.name : file.name,
          type,
          fileName: normalizedFileName,
          enabled: file.enabled,
          installedVersion: previous?.installedVersion || file.modVersion || '',
          external: previous ? previous.external : true,
          updateAvailable: false,
        });

        try {
          const identified = await identifyModrinthFileByHash(filePath);
          if (identified.id && identified.versionId) {
            const response = await axios.get(`${MODRINTH_API}/project/${encodeURIComponent(identified.id)}`, {
              timeout: 10000,
              headers: { 'User-Agent': 'BaldLauncher/0.1.0 (contact: none)' },
            });
            const project = response.data;
            if (project?.project_type === type) {
              Object.assign(candidate, identified, {
                id: identified.id,
                source: 'modrinth',
                slug: project.slug || '',
                name: project.title || file.name,
                author: project.author || candidate.author,
                iconUrl: project.icon_url || candidate.iconUrl,
                projectUrl: project.slug ? `https://modrinth.com/${type}/${encodeURIComponent(project.slug)}` : candidate.projectUrl,
              });
            }
          } else if (getCurseForgeApiKey()) {
            fingerprintEntries.push({ fileName: file.fileName, fingerprint: await getInstalledCurseForgeFingerprint(filePath) });
          }
        } catch (error) {
          console.warn('[Content] Could not identify an installed server jar.', {
            type,
            fileName: file.fileName,
            message: error?.message || String(error),
          });
          if (getCurseForgeApiKey()) {
            try {
              fingerprintEntries.push({ fileName: file.fileName, fingerprint: await getInstalledCurseForgeFingerprint(filePath) });
            } catch (fingerprintError) {
              fingerprintIssues.push(file.fileName);
              console.warn('[Content] Could not fingerprint an installed server jar.', {
                type,
                fileName: file.fileName,
                message: fingerprintError?.message || String(fingerprintError),
              });
            }
          }
        }
        typeCandidates.push({ candidate, file });
      }

      const curseForgeMatches = await identifyCurseForgeFilesByFingerprint(fingerprintEntries);
      syncIssues.push(...fingerprintIssues, ...curseForgeMatches.issues);
      for (const { candidate, file } of typeCandidates) {
        if ((!candidate.source || !candidate.versionId) && curseForgeMatches.matches.has(file.fileName)) {
          const match = curseForgeMatches.matches.get(file.fileName);
          try {
            const response = await axios.get(`${CURSEFORGE_API}/mods/${encodeURIComponent(match.id)}`, {
              timeout: 10000,
              headers: { 'x-api-key': getCurseForgeApiKey(), Accept: 'application/json', 'User-Agent': 'BaldLauncher/0.1.0' },
            });
            const project = response.data?.data;
            if (mapCurseForgeProjectType(project?.classId) === type && isCurseForgeDistributionAllowed(project)) {
              const projectUrl = project.links?.websiteUrl || '';
              Object.assign(candidate, match, {
                id: String(project.id || match.id),
                source: 'curseforge',
                slug: String(project.slug || ''),
                name: String(project.name || candidate.name),
                author: String(project.authors?.[0]?.name || candidate.author || ''),
                iconUrl: project.logo?.url || candidate.iconUrl,
                projectUrl,
              });
            }
          } catch (error) {
            console.warn('[Content] Could not load CurseForge metadata for an installed server jar.', {
              projectId: match.id,
              fileName: file.fileName,
              message: error?.message || String(error),
            });
            syncIssues.push(`CurseForge metadata: ${file.fileName}`);
          }
        }

        if (candidate.source === 'modrinth' && candidate.id && candidate.versionId) {
          try {
            let versions = await getModrinthVersions(candidate.id, server.mcVersion, loader, type);
            if (versions.length === 0 && loader) {
              const allGameVersions = await getModrinthVersions(candidate.id, server.mcVersion, '', type);
              const serverType = String(server.serverType || '').toLowerCase();
              const compatibleLoaders = ['paper', 'purpur', 'folia', 'spigot', 'bukkit'].includes(serverType)
                ? ['paper', 'purpur', 'folia', 'spigot', 'bukkit']
                : ['velocity', 'waterfall', 'bungeecord'].includes(serverType)
                  ? ['velocity', 'waterfall', 'bungeecord']
                  : [loader];
              versions = allGameVersions.filter(version => Array.isArray(version.loaders)
                && version.loaders.some(item => compatibleLoaders.includes(String(item).toLowerCase())));
            }
            if (type === 'mod') versions = versions.filter(isModrinthServerCompatible);
            const latest = selectModrinthVersion(versions);
            candidate.latestVersionId = latest?.version.id || '';
            candidate.latestVersion = latest?.version.version_number || '';
            candidate.updateAvailable = Boolean(latest?.version.id && latest.version.id !== candidate.versionId
              && (!candidate.publishedAt || !latest.version.date_published || Date.parse(latest.version.date_published) > Date.parse(candidate.publishedAt)));
          } catch (error) {
            console.warn('[Content] Could not check a server content update.', {
              projectId: candidate.id,
              message: error?.message || String(error),
            });
            syncIssues.push(`Update check: ${candidate.name}`);
          }
        } else if (candidate.source === 'curseforge' && candidate.id && candidate.fileId) {
          try {
            let compatibleFiles = await getCurseForgeFiles(candidate.id, server.mcVersion, loader, type);
            if (type === 'mod') compatibleFiles = compatibleFiles.filter(isCurseForgeServerCompatible);
            const latest = selectCurseForgeFile(compatibleFiles);
            candidate.latestVersionId = latest ? String(latest.id) : '';
            candidate.latestVersion = latest ? String(latest.fileName || latest.displayName || '') : '';
            candidate.updateAvailable = Boolean(latest && String(latest.id) !== candidate.fileId);
          } catch (error) {
            console.warn('[Content] Could not check a CurseForge server content update.', {
              projectId: candidate.id,
              message: error?.message || String(error),
            });
            syncIssues.push(`Update check: ${candidate.name}`);
          }
        }
        candidates.push(candidate);
      }
    }

    const nextEntries = [
      ...oldEntries.filter(entry => !['mod', 'plugin'].includes(entry.type)),
      ...candidates,
    ];
    const updatedServer = JSON.stringify(oldEntries) === JSON.stringify(nextEntries)
      ? server
      : updateServerInState(server.id, { installedContent: nextEntries });
    return { ok: true, server: updatedServer, issues: [...new Set(syncIssues)] };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle('launcher:search-content', async (_event, { query, type, mcVersion, loader, page = 1, serverType, source = 'modrinth' }) => {
  const rawType = String(type || 'all').toLowerCase();
  const effectiveServerType = String(serverType || '').toLowerCase();
  const serverRules = effectiveServerType ? getServerContentRules(effectiveServerType) : null;
  const serverFacets = serverRules ? buildSearchFacets(effectiveServerType, rawType) : null;
  if (serverRules && !serverFacets) return { ok: false, error: 'This content type is not supported by this server' };
  let projectType = rawType === 'all' || !rawType ? null : rawType;
  if (serverRules && rawType === 'all') {
    projectType = null;
  } else if (serverRules && rawType !== 'all') {
    const normalized = rawType === 'plugin' || rawType === 'mod' || rawType === 'datapack' || rawType === 'shader' || rawType === 'resourcepack' ? rawType : null;
    if (normalized && !serverRules.projectTypes.includes(normalized)) {
      projectType = null;
    } else {
      projectType = normalized;
    }
  }
  const offset = Math.max(0, Number(page) - 1) * 20;
  const hits = [];
  let totalHits = 0;
  const requestedSource = source === 'curseforge' ? 'curseforge' : 'modrinth';
  const searchCacheKey = JSON.stringify({ query: String(query || '').trim(), type: rawType, mcVersion: String(mcVersion || ''), loader: String(loader || ''), page: Number(page), serverType: effectiveServerType, source: requestedSource });
  const cachedSearch = contentSearchCache.get(searchCacheKey);
  if (cachedSearch && cachedSearch.expiresAt > Date.now()) return cachedSearch.result;
  if (cachedSearch) contentSearchCache.delete(searchCacheKey);
  const curseForgeApiKey = getCurseForgeApiKey();
  const isCurseForgeBlocked = error => {
    const status = Number(error?.response?.status ?? error?.status ?? 0);
    const message = String(error?.response?.data?.message || error?.message || '');
    return status === 401 || status === 403 || status === 429 || /forbidden|unauthorized|api key|x-api-key/i.test(message);
  };

  if (requestedSource === 'curseforge') {
    if (!curseForgeApiKey) {
      return { ok: false, error: 'Set CURSEFORGE_API_KEY in your user environment and restart Bald Launcher to browse CurseForge content.' };
    }
    try {
      const response = await axios.get(`${CURSEFORGE_API}/mods/search`, {
        params: {
          gameId: 432,
          searchFilter: query || undefined,
          pageSize: 20,
          index: offset,
          sortField: query ? undefined : 'popularity',
          sortOrder: query ? undefined : 'desc',
          gameVersion: mcVersion || undefined,
          classId: getCurseForgeClassId(projectType),
          modLoaderType: projectType === 'mod' ? getCurseForgeLoaderType(loader) : undefined,
        },
        timeout: 8000,
        headers: { 'x-api-key': curseForgeApiKey, 'User-Agent': 'BaldLauncher/0.1.0' },
      });
      totalHits = Number(response.data?.pagination?.totalCount) || 0;
      const allowedTypes = serverRules?.allowed || null;
      const mappedHits = (response.data?.data || []).map(hit => {
        const mappedType = mapCurseForgeProjectType(hit.classId);
        return mappedType ? mapCurseForgeContent(hit, mappedType, loader) : null;
      }).filter(hit => hit && (!projectType || hit.type === projectType) && (!allowedTypes || allowedTypes.includes(hit.type))
        && (!serverRules || hit.type !== 'mod' || isCurseForgeServerCompatible(hit)));
      const result = {
        ok: true,
        hits: mappedHits,
        page: Number(page), totalHits, totalPages: Math.max(1, Math.ceil(totalHits / 20)), hasMore: offset + 20 < totalHits, source: 'curseforge',
      };
      contentSearchCache.set(searchCacheKey, { result, expiresAt: Date.now() + CONTENT_SEARCH_CACHE_TTL_MS });
      return result;
    } catch (error) {
      if (isCurseForgeBlocked(error)) {
        console.warn('[CurseForge] search rejected by API.', {
          status: error?.response?.status || error?.status || null,
          message: error?.response?.data?.message || error?.message || String(error),
        });
        return { ok: false, error: 'CurseForge is unavailable right now. Check your API key and try again.' };
      }
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
  try {
    const facets = serverFacets || [];
    if (!serverRules && projectType) facets.push([`project_type:${projectType}`]);
    if (loader === 'vanilla' && !projectType) facets.push(['project_type:shader', 'project_type:resourcepack', 'project_type:datapack']);
    if (mcVersion) facets.push([`versions:${mcVersion}`]);
    if (!serverRules && loader && loader !== 'vanilla' && (!projectType || projectType === 'mod')) {
      facets.push([`categories:${loader}`]);
    }

    console.info('[Modrinth] server content search', { query: query || '', serverType: effectiveServerType || null, projectType, loader: effectiveServerType || loader || null, facets });

    const response = await axios.get(`${MODRINTH_API}/search`, {
      params: {
        query: query || '',
        limit: serverRules ? 100 : 20,
        offset,
        facets: facets.length ? JSON.stringify(facets) : undefined,
      },
      headers: { 'User-Agent': 'BaldLauncher/0.1.0 (contact: none)' },
      timeout: 8000,
    });
    totalHits = Number(response.data?.total_hits) || 0;
    console.info('[Modrinth] server content response', { status: response.status, totalHits, returned: response.data?.hits?.length || 0 });

    const allowedProjectTypes = serverRules ? SERVER_CONTENT_TYPES[effectiveServerType]?.projectTypes || [] : null;
    hits.push(...(response.data?.hits || []).map(hit => {
      const categories = Array.isArray(hit.categories) ? hit.categories.map(category => String(category).toLowerCase()) : [];
      const mappedType = serverRules && hit.project_type === 'mod'
        ? rawType === 'datapack' && categories.includes('datapack') && !categories.includes(serverRules.loader || effectiveServerType)
          ? 'datapack'
          : allowedProjectTypes?.includes('plugin') && categories.includes(serverRules.loader || effectiveServerType)
            ? 'plugin'
            : hit.project_type
        : hit.project_type;
      return { hit, mappedType, categories };
    }).filter(({ hit, mappedType }) => (!allowedProjectTypes || allowedProjectTypes.includes(mappedType))
      && (!serverRules || mappedType !== 'mod' || isModrinthServerCompatible(hit))).slice(0, 20).map(({ hit, mappedType }) => ({
      id: hit.project_id || hit.slug,
      name: hit.title,
      author: hit.author || 'Unknown creator',
      desc: hit.description,
      downloads: hit.downloads,
      iconUrl: hit.icon_url || null,
      type: mappedType,
      slug: hit.slug,
      minecraftVersion: mcVersion || '',
      loader: loader || '',
      side: getModrinthSideLabel(hit),
      projectUrl: `https://modrinth.com/${mappedType === 'mod' ? 'mod' : mappedType}/${encodeURIComponent(hit.slug)}`,
      source: 'modrinth',
    })));
  } catch (error) {
    console.error('[Modrinth] content search failed', error?.response?.status || '', error?.response?.data || error?.message || error);
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
  const result = { ok: true, hits, page: Number(page), totalHits, totalPages: Math.max(1, Math.ceil(totalHits / 20)), hasMore: offset + 20 < totalHits, source: 'modrinth' };
  contentSearchCache.set(searchCacheKey, { result, expiresAt: Date.now() + CONTENT_SEARCH_CACHE_TTL_MS });
  return result;
});

function getInstalledFilePath(profile, type, name, disabled) {
  const minecraftRoot = getMinecraftRootFor(profile.id);
  const folderPath = getContentFolder(type, minecraftRoot);
  const extension = type === 'mod' || type === 'plugin' ? '.jar' : '.zip';
  const suffix = disabled ? '.disabled' : '';
  return path.join(folderPath, `${sanitizeFileName(name)}${extension}${suffix}`);
}

function resolveInstalledContentPath(profile, entry, disabled) {
  const folderPath = getContentFolder(entry.type, getMinecraftRootFor(profile.id));
  const suffix = disabled ? '.disabled' : '';
  const candidates = [];
  if (entry.fileName) candidates.push(path.join(folderPath, `${entry.fileName}${suffix}`));
  candidates.push(getInstalledFilePath(profile, entry.type, entry.name, disabled));
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  if (!fs.existsSync(folderPath)) return null;
  const identityParts = [entry.id, entry.name].map(contentIdentity).filter(value => value.length >= 4);
  const files = fs.readdirSync(folderPath).filter(file => /\.(?:jar|zip)(?:\.disabled)?$/i.test(file));
  const match = files.find(file => {
    const identity = contentIdentity(file);
    return identityParts.some(part => identity.includes(part));
  });
  return match ? path.join(folderPath, match) : null;
}

// ---------------------------------------------------------------------------
// Resource Pack Studio data sourcing.
//
// Everything below is sourced from either (a) Mojang's own official version
// manifest / client jar downloads (the same official endpoints Bald Launcher
// already uses to install and launch Minecraft), or (b) PrismarineJS's
// open-source `minecraft-data` / `minecraft-assets` projects, which publish
// permissively-licensed per-version Minecraft metadata for exactly this kind
// of tooling. Neither depends on any third-party resource-pack editor's site
// or private endpoints.
const vanillaClientModelCache = new Map();
const vanillaClientArchiveCache = new Map();
const jarTextureCatalogCache = new Map();
const resourcePackItemDefinitionCache = new Map();
const JAR_TEXTURE_CATEGORIES = {
  block: 'Blocks', blocks: 'Blocks', item: 'Items', items: 'Items',
  entity: 'Entity Textures', gui: 'HUD & Menus',
  particle: 'Particles', painting: 'Paintings', trims: 'Armor Trims',
  mob_effect: 'Mob Effects', map: 'Maps', environment: 'Environment',
  misc: 'Misc', font: 'Fonts', colormap: 'Colormaps', effect: 'Effects',
  models: 'Misc',
};
const DEFAULT_BLOCK_PROPERTY_VALUES = {
  axis: 'y', east: 'none', facing: 'north', half: 'bottom', hinge: 'left',
  in_wall: 'false', lit: 'false', north: 'none', open: 'false', part: 'foot',
  powered: 'false', shape: 'straight', south: 'none', type: 'bottom',
  up: 'true', waterlogged: 'false', west: 'none',
};

function canonicalTexturePath(texturePath) {
  return String(texturePath || '').replace(/^assets\/minecraft\/textures\//, '')
    .replace(/^blocks\//, 'block/').replace(/^items\//, 'item/');
}

function collectBlockstateProperties(blockstate) {
  const valuesByName = new Map();
  const add = (name, values) => {
    if (!name) return;
    const valuesSet = valuesByName.get(name) || new Set();
    String(values).split('|').filter(Boolean).forEach(value => valuesSet.add(value));
    valuesByName.set(name, valuesSet);
  };
  const collectCondition = condition => {
    if (!condition || typeof condition !== 'object') return;
    for (const [key, value] of Object.entries(condition)) {
      if (key === 'OR' || key === 'AND') {
        if (Array.isArray(value)) value.forEach(collectCondition);
      } else add(key, value);
    }
  };
  for (const key of Object.keys(blockstate?.variants || {})) {
    if (!key) continue;
    for (const selector of key.split(',')) {
      const separator = selector.indexOf('=');
      if (separator > 0) add(selector.slice(0, separator), selector.slice(separator + 1));
    }
  }
  (blockstate?.multipart || []).forEach(part => collectCondition(part.when));
  return [...valuesByName].map(([name, values]) => ({ name, values: [...values] }));
}

function readJarJson(jar, assetPath) {
  const entry = jar?.getEntry(assetPath);
  if (!entry) return null;
  try { return JSON.parse(entry.getData().toString('utf8')); }
  catch (error) {
    console.warn(`[ResourcePackStudio] Could not parse ${assetPath}: ${error.message}`);
    return null;
  }
}

function staticItemModelReferences(node, result = [], seen = new Set()) {
  if (!node || typeof node !== 'object' || seen.has(node)) return result;
  seen.add(node);
  const type = String(node.type || '').replace(/^minecraft:/, '');
  if (type === 'model' && typeof node.model === 'string') {
    result.push(node.model);
  } else if (type === 'condition') {
    staticItemModelReferences(node.on_false || node.on_true, result, seen);
  } else if (type === 'range_dispatch') {
    const first = [...(node.entries || [])].sort((left, right) => Number(left.threshold) - Number(right.threshold))[0];
    staticItemModelReferences(first?.model, result, seen);
  } else if (type === 'select') {
    staticItemModelReferences(node.fallback || node.cases?.[0]?.model, result, seen);
  } else if (type === 'composite') {
    (node.models || []).forEach(model => staticItemModelReferences(model, result, seen));
  }
  return result;
}

async function resolveVersionManifestEntry(version) {
  const manifest = (await axios.get(VERSION_MANIFEST_URL, { timeout: 15000 })).data;
  return (manifest.versions || []).find(entry => entry.id === version)
    || (manifest.versions || []).find(entry => entry.type === 'release' && entry.id.startsWith(String(version).split('.')[0] + '.'));
}

// Downloads (once per version, then reuses the in-memory cache) the official
// Mojang client jar for a version and returns it as an AdmZip archive. This
// is the same download Bald Launcher performs to install Minecraft itself,
// just also kept around briefly so the resource-pack catalog/model/texture
// handlers can read real, authoritative assets straight out of it.
async function getClientJar(version) {
  const match = await resolveVersionManifestEntry(version);
  if (!match?.url) return null;
  let jar = vanillaClientArchiveCache.get(match.id);
  if (!jar) {
    const versionData = (await axios.get(match.url, { timeout: 15000 })).data;
    const clientUrl = versionData.downloads?.client?.url;
    if (!clientUrl) return null;
    jar = new AdmZip(Buffer.from((await axios.get(clientUrl, { responseType: 'arraybuffer', timeout: 120000 })).data));
    vanillaClientArchiveCache.set(match.id, jar);
  }
  return jar;
}

async function loadVanillaClientModel(version, model, kind) {
  const cacheKey = `${version}:${kind}:${model}`;
  if (vanillaClientModelCache.has(cacheKey)) return vanillaClientModelCache.get(cacheKey);
  const jar = await getClientJar(version);
  if (!jar) return null; // jar unavailable entirely -- distinct from "not found in jar"
  let missingParent = null;
  const read = (name, seen = new Set()) => {
    const normalized = String(name || '').replace(/^minecraft:/, '').replace(/\.json$/i, '');
    if (!normalized || seen.has(normalized)) return {};
    const isReferencedParent = seen.size > 0;
    seen.add(normalized);
    const path = `assets/minecraft/models/${normalized}.json`;
    const entry = jar.getEntry(path);
    if (!entry) { if (isReferencedParent && !normalized.startsWith('builtin/')) missingParent = normalized; return normalized.startsWith('builtin/') ? { __builtin: normalized } : {}; }
    let source;
    try { source = JSON.parse(entry.getData().toString('utf8')); }
    catch (error) { missingParent = `${normalized} (invalid JSON: ${error.message})`; return {}; }
    const parent = read(source.parent, seen);
    return { ...parent, ...source, textures: { ...(parent.textures || {}), ...(source.textures || {}) } };
  };
  const data = read(`${kind}/${model}`);
  const wrapped = Object.keys(data).length ? { data, found: true, missingParent } : { data: null, found: false, missingParent: null };
  vanillaClientModelCache.set(cacheKey, wrapped);
  return wrapped;
}

// Enumerates every texture Mojang actually ships for a version, straight out
// of the official client jar. This is the catalog's source of truth for
// every category the community PrismarineJS datasets don't cover (HUD/GUI,
// particles, paintings, armor trims, mob effects, maps, environment, misc,
// fonts, colormaps, effects) and a resilient fallback for blocks/items/
// entities if the community data is ever unreachable.
async function getJarTextureCatalog(version) {
  if (jarTextureCatalogCache.has(version)) return jarTextureCatalogCache.get(version);
  const jar = await getClientJar(version);
  if (!jar) return [];
  const entries = jar.getEntries().filter(entry => !entry.isDirectory && /^assets\/minecraft\/textures\/.+\.png$/i.test(entry.entryName));
  const catalog = entries.map(entry => {
    const relative = entry.entryName.replace(/^assets\/minecraft\/textures\//, '');
    const parts = relative.replace(/\.png$/i, '').split('/');
    const category = parts[0];
    const normalizedCategory = category === 'blocks' ? 'block' : category === 'items' ? 'item' : category;
    const leaf = parts[parts.length - 1];
    return {
      id: `jar_${relative.replace(/\.png$/i, '').replace(/[^a-zA-Z0-9_-]+/g, '_')}`,
      name: jarTextureName(category, parts.length > 1 ? parts.slice(1).join(' ') : leaf),
      category: JAR_TEXTURE_CATEGORIES[category] || 'Misc',
      path: `assets/minecraft/textures/${relative}`,
      texturePath: relative,
      modelName: normalizedCategory === 'block' || normalizedCategory === 'item' ? `${normalizedCategory}/${parts.slice(1).join('/')}` : undefined,
      browseCategory: category,
      shape: normalizedCategory === 'block' ? 'flat' : normalizedCategory === 'item' ? 'item' : category === 'entity' ? 'entity' : 'flat',
    };
  });
  jarTextureCatalogCache.set(version, catalog);
  return catalog;
}

function getJarBlockstateCatalog(jar, knownBlocks = new Set()) {
  if (!jar) return [];
  const entries = [];
  for (const file of jar.getEntries()) {
    const match = file.entryName.match(/^assets\/minecraft\/blockstates\/([\w./-]+)\.json$/);
    if (file.isDirectory || !match || match[1].split('/').some(part => part === '.' || part === '..')) continue;
    const name = match[1];
    if (knownBlocks.has(name) || ['air', 'cave_air', 'void_air'].includes(name)) continue;
    const blockstate = readJarJson(jar, file.entryName);
    if (!blockstate) continue;
    entries.push({
      id: name,
      minecraftId: name,
      name: name.split('/').pop().replace(/[_-]+/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase()),
      category: 'Blocks',
      path: `assets/minecraft/textures/block/${name}.png`,
      texturePath: `block/${name}.png`,
      modelName: name,
      stateProperties: collectBlockstateProperties(blockstate),
      shape: 'model',
    });
  }
  return entries;
}

function collectSpecialItemModels(node, result = [], seen = new Set()) {
  if (!node || typeof node !== 'object' || seen.has(node)) return result;
  seen.add(node);
  const type = String(node.type || '').replace(/^minecraft:/, '');
  if (type === 'special') {
    result.push(node);
    return result;
  }
  if (type === 'select') {
    collectSpecialItemModels(node.fallback, result, seen);
    (node.cases || []).forEach(entry => collectSpecialItemModels(entry.model, result, seen));
    return result;
  }
  if (type === 'condition') {
    collectSpecialItemModels(node.on_false, result, seen);
    collectSpecialItemModels(node.on_true, result, seen);
    return result;
  }
  if (type === 'composite') {
    (node.models || []).forEach(model => collectSpecialItemModels(model, result, seen));
    return result;
  }
  Object.values(node).forEach(value => collectSpecialItemModels(value, result, seen));
  return result;
}

function specialItemTexturePath(jar, itemName, itemDefinition) {
  for (const special of collectSpecialItemModels(itemDefinition?.model)) {
    const specialModel = special.model || {};
    const type = String(specialModel.type || '').replace(/^minecraft:/, '');
    let texturePath = '';
    if (type === 'chest' && typeof specialModel.texture === 'string') {
      const textureName = specialModel.texture.replace(/^minecraft:/, '').replace(/\.png$/i, '');
      if (/^(?:normal|trapped|christmas)$/.test(textureName)) texturePath = `entity/chest/${textureName}.png`;
    } else if (type === 'shield') {
      texturePath = 'entity/shield/shield_base_nopattern.png';
    } else if (typeof specialModel.texture === 'string') {
      const normalized = specialModel.texture
        .replace(/^minecraft:/, '')
        .replace(/^assets\/minecraft\/textures\//, '')
        .replace(/^textures\//, '')
        .replace(/\.png$/i, '');
      if (/^(?:item|items|block|blocks|entity)\/[\w./-]+$/i.test(normalized)) texturePath = `${normalized}.png`;
    }
    if (textureExistsInJar(jar, texturePath)) return texturePath;
  }
  return '';
}

function getJarItemCatalog(jar, knownItems = new Set()) {
  if (!jar) return [];
  const entries = [];
  for (const file of jar.getEntries()) {
    const match = file.entryName.match(/^assets\/minecraft\/items\/([\w./-]+)\.json$/);
    if (file.isDirectory || !match || match[1].split('/').some(part => part === '.' || part === '..')) continue;
    const name = match[1];
    if (knownItems.has(name) || name === 'air') continue;
    const definition = readJarJson(jar, file.entryName);
    if (!definition) continue;
    const modelNames = staticItemModelReferences(definition.model);
    const specialBase = definition.model?.type === 'minecraft:special' ? definition.model.base : null;
    entries.push({
      id: `item_${name}`,
      minecraftId: name,
      name: name.split('/').pop().replace(/[_-]+/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase()),
      category: 'Items',
      path: `assets/minecraft/textures/item/${name}.png`,
      texturePath: specialItemTexturePath(jar, name, definition) || undefined,
      modelName: modelNames[0] || specialBase || `item/${name}`,
      itemDefinition: true,
      specialItem: definition.model?.type === 'minecraft:special',
      shape: 'item',
    });
  }
  return entries;
}

function defaultStateProperties(block) {
  const stateProperties = block.states || [];
  let stateIndex = Number(block.defaultState) - Number(block.minStateId);
  if (!Number.isInteger(stateIndex) || stateIndex < 0 || !stateProperties.length) {
    return Object.fromEntries(stateProperties.map(property => {
      const values = property.values || [];
      const preferred = DEFAULT_BLOCK_PROPERTY_VALUES[property.name];
      const fallback = preferred && values.includes(preferred) ? preferred : values[0];
      return [property.name, String(fallback ?? '')];
    }).filter(([, value]) => value !== ''));
  }
  const properties = {};
  for (let index = stateProperties.length - 1; index >= 0; index -= 1) {
    const property = stateProperties[index];
    const values = property.values || (property.type === 'bool' ? ['true', 'false'] : []);
    const count = Number(property.num_values) || values.length;
    if (!count) continue;
    const valueIndex = stateIndex % count;
    stateIndex = Math.floor(stateIndex / count);
    if (values[valueIndex] !== undefined) properties[property.name] = String(values[valueIndex]);
  }
  return properties;
}

function blockstateConditionMatches(condition, properties) {
  if (!condition || typeof condition !== 'object') return true;
  if (Array.isArray(condition.OR) && !condition.OR.some(child => blockstateConditionMatches(child, properties))) return false;
  if (Array.isArray(condition.AND) && !condition.AND.every(child => blockstateConditionMatches(child, properties))) return false;
  return Object.entries(condition)
    .filter(([key]) => key !== 'OR' && key !== 'AND')
    .every(([key, value]) => String(value).split('|').includes(String(properties[key])));
}

function defaultBlockstateModels(blockstate, properties) {
  if (blockstate?.variants && typeof blockstate.variants === 'object') {
    const variants = Object.entries(blockstate.variants).map(([key, value]) => {
      const selectors = key ? key.split(',').map(pair => pair.split('=')) : [];
      const matches = selectors.filter(([name, expected]) => properties[name] === expected).length;
      return { value, matches, mismatches: selectors.length - matches, selectorCount: selectors.length };
    }).sort((left, right) => left.mismatches - right.mismatches || right.matches - left.matches || left.selectorCount - right.selectorCount);
    const value = variants[0]?.value;
    return (Array.isArray(value) ? value.slice(0, 1) : value ? [value] : []).map(part => part.model).filter(Boolean);
  }
  if (Array.isArray(blockstate?.multipart)) {
    return blockstate.multipart
      .filter(part => blockstateConditionMatches(part.when, properties))
      .flatMap(part => Array.isArray(part.apply) ? part.apply.slice(0, 1) : [part.apply])
      .map(part => part?.model)
      .filter(Boolean);
  }
  return [];
}

function resolveModelTexture(textures, preferredKeys = ['texture', 'all', 'side', 'top', 'front', 'bottom'], includeParticle = true) {
  const textureKeys = [...preferredKeys.filter(key => textures?.[key]), ...Object.keys(textures || {}).filter(key => !preferredKeys.includes(key) && key !== 'particle'), ...(includeParticle ? ['particle'] : [])];
  for (const key of textureKeys) {
    let value = textures?.[key];
    if (value && typeof value === 'object') value = value.sprite || '';
    value = String(value || '');
    const seen = new Set();
    while (value.startsWith('#') && !seen.has(value)) {
      seen.add(value);
      value = textures?.[value.slice(1)];
      if (value && typeof value === 'object') value = value.sprite || '';
      value = String(value || '');
    }
    if (value && !value.startsWith('#')) return value;
  }
  return '';
}

function textureExistsInJar(jar, texturePath) {
  const relativePath = String(texturePath || '');
  return Boolean(relativePath && (
    jar?.getEntry(`assets/minecraft/textures/${relativePath}`)
    || jar?.getEntry(`assets/minecraft/textures/${relativePath.replace(/^block\//, 'blocks/').replace(/^item\//, 'items/')}`)
    || jar?.getEntry(`assets/minecraft/textures/${relativePath.replace(/^blocks\//, 'block/').replace(/^items\//, 'item/')}`)
  ));
}

function loadBlockModelFromJar(jar, requestedModel, cache) {
  const namespaceMatch = String(requestedModel || '').match(/^([a-z0-9_.-]+):(.+)$/i);
  if (namespaceMatch && namespaceMatch[1] !== 'minecraft') return null;
  let path = namespaceMatch ? namespaceMatch[2] : String(requestedModel || '');
  const kind = path.startsWith('item/') ? 'item' : 'block';
  path = path.replace(/^(?:block|item)\//, '');
  const cacheKey = `${kind}:${path}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey);
  const read = (modelPath, seen = new Set()) => {
    const normalized = String(modelPath || '').replace(/^minecraft:/, '').replace(/\.json$/i, '');
    if (!normalized || seen.has(normalized)) return {};
    seen.add(normalized);
    const match = normalized.match(/^(block|item)\/(.+)$/);
    if (!match) return {};
    const entry = jar.getEntry(`assets/minecraft/models/${match[1]}/${match[2]}.json`);
    if (!entry) return {};
    let source;
    try { source = JSON.parse(entry.getData().toString('utf8')); } catch { return {}; }
    const parent = source.parent ? read(source.parent, seen) : {};
    return { ...parent, ...source, textures: { ...(parent.textures || {}), ...(source.textures || {}) } };
  };
  const model = read(`${kind}/${path}`);
  cache.set(cacheKey, model);
  return model;
}

function defaultBlockTexturePath(jar, block, fallbackTexturePath, modelCache) {
  if (!jar || !block) return fallbackTexturePath;
  const blockName = block.minecraftId || block.id || block.name;
  if (!blockName) return fallbackTexturePath;
  const bannerTexturePath = 'entity/banner/base.png';
  if (/_banner$/.test(blockName) && textureExistsInJar(jar, bannerTexturePath)) return bannerTexturePath;
  const blockstateEntry = jar.getEntry(`assets/minecraft/blockstates/${blockName}.json`);
  if (!blockstateEntry) return fallbackTexturePath;
  let blockstate;
  try { blockstate = JSON.parse(blockstateEntry.getData().toString('utf8')); } catch { return fallbackTexturePath; }
  const modelNames = defaultBlockstateModels(blockstate, defaultStateProperties(block));
  for (const modelName of modelNames) {
    const model = loadBlockModelFromJar(jar, modelName, modelCache);
    const texture = resolveModelTexture(model?.textures);
    const texturePath = texture ? minecraftAssetPath(texture, 'blocks', blockName) : '';
    if (textureExistsInJar(jar, texturePath)) return texturePath;
  }
  return fallbackTexturePath;
}

function verifiedBlockTexturePath(jar, block, fallbackTexturePath, modelCache) {
  const preferred = defaultBlockTexturePath(jar, block, fallbackTexturePath, modelCache);
  if (textureExistsInJar(jar, preferred)) return preferred;

  const blockName = block?.minecraftId || block?.id || block?.name;
  if (!blockName) return fallbackTexturePath;
  const blockstate = readJarJson(jar, `assets/minecraft/blockstates/${blockName}.json`);
  if (!blockstate) return fallbackTexturePath;
  const modelNames = new Set(defaultBlockstateModels(blockstate, defaultStateProperties(block)));
  const collectModelNames = value => {
    if (Array.isArray(value)) {
      value.forEach(collectModelNames);
    } else if (value && typeof value === 'object' && typeof value.model === 'string') {
      modelNames.add(value.model);
    }
  };
  Object.values(blockstate.variants || {}).forEach(collectModelNames);
  (blockstate.multipart || []).forEach(part => collectModelNames(part.apply));

  for (const modelName of modelNames) {
    const model = loadBlockModelFromJar(jar, modelName, modelCache);
    const texture = resolveModelTexture(model?.textures);
    const texturePath = texture ? minecraftAssetPath(texture, 'blocks', blockName) : '';
    if (textureExistsInJar(jar, texturePath)) return texturePath;
  }
  return fallbackTexturePath;
}

function defaultItemTexturePath(jar, item, modelName, blocksByName, fallbackTexturePath, modelCache, includeParticle = false) {
  if (!jar) return fallbackTexturePath;
  const itemId = item.name;
  const bannerTexturePath = 'entity/banner/base.png';
  if (/_banner$/.test(itemId) && textureExistsInJar(jar, bannerTexturePath)) return bannerTexturePath;
  const candidates = [modelName];
  if (/_spawn_egg$/.test(itemId)) candidates.push('item/template_spawn_egg');
  if (/_banner$/.test(itemId)) candidates.push('item/template_banner');
  if (/(?:_head|_skull)$/.test(itemId)) candidates.push('item/template_skull');
  candidates.push(`block/${itemId}_inventory`);
  for (const candidate of candidates) {
    const model = loadBlockModelFromJar(jar, candidate, modelCache);
    const texture = resolveModelTexture(model?.textures, ['layer0', 'texture', 'all', 'side', 'top', 'front', 'bottom'], includeParticle);
    const texturePath = texture ? minecraftAssetPath(texture, 'items', itemId) : '';
    if (textureExistsInJar(jar, texturePath)) return texturePath;
  }

  const block = blocksByName.get(itemId);
  if (block) {
    const blockstateEntry = jar.getEntry(`assets/minecraft/blockstates/${itemId}.json`);
    if (blockstateEntry) {
      try {
        const blockstate = JSON.parse(blockstateEntry.getData().toString('utf8'));
        const modelNames = defaultBlockstateModels(blockstate, defaultStateProperties(block));
        for (const modelRef of modelNames) {
          const model = loadBlockModelFromJar(jar, modelRef, modelCache);
          const texture = resolveModelTexture(model?.textures, ['layer0', 'texture', 'all', 'side', 'top', 'front', 'bottom'], false);
          const texturePath = texture ? minecraftAssetPath(texture, 'items', itemId) : '';
          if (textureExistsInJar(jar, texturePath)) return texturePath;
        }
      } catch (error) {
        console.warn(`[ResourcePackStudio] Could not resolve the default-state texture for ${itemId}: ${error.message}`);
      }
    }
  }
  return fallbackTexturePath;
}

ipcMain.handle('launcher:get-resource-pack-catalog', async (_event, requestedVersion) => {
  const version = String(requestedVersion || '1.21.4');
  if (resourcePackCatalogCache.has(version)) return resourcePackCatalogCache.get(version);
  const base = `https://raw.githubusercontent.com/PrismarineJS/minecraft-data/master/data/pc/${encodeURIComponent(version)}`;
  let communityCatalog = [];
  try {
    const responses = await Promise.allSettled([
      axios.get(`${base}/items.json`, { timeout: 15000 }),
      axios.get(`${base}/blocks.json`, { timeout: 15000 }),
      axios.get(`${base}/entities.json`, { timeout: 15000 }),
      axios.get(`https://raw.githubusercontent.com/PrismarineJS/minecraft-assets/master/data/${encodeURIComponent(version)}/items_textures.json`, { timeout: 15000 }),
      axios.get(`https://raw.githubusercontent.com/PrismarineJS/minecraft-assets/master/data/${encodeURIComponent(version)}/blocks_textures.json`, { timeout: 15000 }),
    ]);
    const responseData = index => responses[index]?.status === 'fulfilled' ? responses[index].value?.data : [];
    const items = Array.isArray(responseData(0)) ? responseData(0) : [];
    const blocks = Array.isArray(responseData(1)) ? responseData(1) : [];
    const entities = Array.isArray(responseData(2)) ? responseData(2) : [];
    const itemTextures = Array.isArray(responseData(3)) ? responseData(3) : [];
    const blockTextures = Array.isArray(responseData(4)) ? responseData(4) : [];
    const itemTextureByName = new Map(itemTextures.map(entry => [entry.name, entry]));
    const blockTextureByName = new Map(blockTextures.map(entry => [entry.name, entry]));
    const isInvisibleAirBlock = block => ['air', 'cave_air', 'void_air'].includes(block.name);
    const blockNames = new Set(blocks.filter(block => !isInvisibleAirBlock(block)).map(block => block.name));
    const blockByName = new Map(blocks.map(block => [block.name, block]));
    const isDistinctItem = item => {
      const itemTexture = itemTextureByName.get(item.name);
      const blockTexture = blockTextureByName.get(item.name);
      if (!blockNames.has(item.name) || !blockTexture) return true;
      const normalizeModel = model => String(model || '')
        .replace(/^minecraft:/, '').replace(/^items?\//, '').replace(/^blocks?\//, '').split('/').pop();
      const itemModel = normalizeModel(itemTexture?.model);
      const blockModel = normalizeModel(blockTexture?.model);
      const itemPath = minecraftAssetPath(itemTexture?.texture, 'items', item.name);
      const blockPath = minecraftAssetPath(blockTexture?.texture, 'blocks', item.name);
      return Boolean(itemModel && blockModel && itemModel !== blockModel) || itemPath !== blockPath;
    };
    let modelTextureJar = null;
    try { modelTextureJar = await getClientJar(version); }
    catch (error) { console.warn(`[ResourcePackStudio] Could not resolve model-face textures for ${version}: ${error.message}`); }
    const modelTextureCache = new Map();
    const itemCatalogEntries = items.filter(item => item.name !== 'air' && isDistinctItem(item)).map(item => {
      const texture = itemTextureByName.get(item.name);
      const itemDefinition = readJarJson(modelTextureJar, `assets/minecraft/items/${item.name}.json`);
      const definitionModels = staticItemModelReferences(itemDefinition?.model);
      const specialBase = itemDefinition?.model?.type === 'minecraft:special' ? itemDefinition.model.base : null;
      const modelName = definitionModels[0]
        || specialBase
        || `item/${texture?.model?.replace(/^minecraft:items?\//, '') || item.name}`;
      const fallbackTexturePath = minecraftAssetPath(texture?.texture, 'items', item.name);
      return {
        id: blockNames.has(item.name) ? `item_${item.name}` : item.name,
        minecraftId: item.name, name: item.displayName || item.name, category: 'Items',
        path: `assets/minecraft/textures/item/${item.name}.png`,
        texturePath: specialItemTexturePath(modelTextureJar, item.name, itemDefinition) || defaultItemTexturePath(
            modelTextureJar,
            item,
            modelName,
            blockByName,
            fallbackTexturePath,
            modelTextureCache,
            itemDefinition?.model?.type === 'minecraft:special',
          ),
        modelName,
        shape: 'item',
      };
    });
    const blockCatalogEntries = await Promise.all(blocks.filter(block => !isInvisibleAirBlock(block)).map(async block => {
      const fallbackTexturePath = minecraftAssetPath(blockTextureByName.get(block.name)?.texture, 'blocks', block.name);
      const texturePath = verifiedBlockTexturePath(modelTextureJar, blockByName.get(block.name) || block, fallbackTexturePath, modelTextureCache);
      return {
        id: block.name, minecraftId: block.name, name: block.displayName || block.name, category: 'Blocks',
        path: `assets/minecraft/textures/block/${block.name}.png`, texturePath,
        modelName: block.name,
        stateProperties: blockByName.get(block.name)?.states || [],
        defaultState: blockByName.get(block.name)?.defaultState,
        minStateId: blockByName.get(block.name)?.minStateId,
        shape: block.boundingBox === 'empty' ? 'flat' : block.boundingBox === 'block' ? 'cube' : 'model',
      };
    }));
    communityCatalog = [
      ...itemCatalogEntries,
      ...blockCatalogEntries,
      ...(await (async () => {
        let entityPathByBasename = null;
        try {
          const jarEntries = await getJarTextureCatalog(version);
          entityPathByBasename = new Map();
          jarEntries.filter(entry => entry.browseCategory === 'entity').forEach(entry => {
            const basename = entry.texturePath.split('/').pop().replace(/\.png$/i, '');
            if (!entityPathByBasename.has(basename) || entry.texturePath.length < entityPathByBasename.get(basename).length) {
              entityPathByBasename.set(basename, entry.texturePath);
            }
          });
        } catch (error) {
          console.warn(`[ResourcePackStudio] Could not resolve real entity texture paths for ${version}, falling back to flat guesses: ${error.message}`);
        }
        return entities.map(entity => {
          const flatGuess = `entity/${entity.name}.png`;
          const strippedBasename = entity.name.replace(/_chest_boat$/, '').replace(/_boat$/, '');
          const resolvedRelative = !entityPathByBasename ? flatGuess
            : entityPathByBasename.has(entity.name) ? entityPathByBasename.get(entity.name)
            : entityPathByBasename.has(strippedBasename) ? entityPathByBasename.get(strippedBasename)
            : null;
          return {
            id: `entity_${entity.name}`, name: entity.displayName || entity.name, category: 'Entity Textures',
            minecraftId: entity.name,
            path: `assets/minecraft/textures/${resolvedRelative || flatGuess}`, texturePath: resolvedRelative || undefined,
            shape: 'entity', unresolved: !resolvedRelative,
            width: Number(entity.width) || 1, height: Number(entity.height) || 1, entityType: entity.type,
          };
        });
      })()),
    ];
  } catch (error) {
    console.warn(`[ResourcePackStudio] Community catalog data unavailable for ${version}: ${error.message}`);
  }
  let jarCatalog = [];
  let catalogJar = null;
  try {
    catalogJar = await getClientJar(version);
    jarCatalog = await getJarTextureCatalog(version);
  } catch (error) {
    console.warn(`[ResourcePackStudio] Client-jar catalog unavailable for ${version}: ${error.message}`);
  }
  // Prefer the community dataset's nicer display names/model refs for
  // blocks, items and entities; use the jar for every other category (and
  // as a full fallback if the community dataset failed outright).
  const knownBlocks = new Set(communityCatalog.filter(entry => entry.category === 'Blocks').map(entry => entry.minecraftId || entry.id));
  const knownItems = new Set(communityCatalog.filter(entry => entry.category === 'Items').map(entry => entry.minecraftId || entry.id.replace(/^item_/, '')));
  const jarBlockEntries = getJarBlockstateCatalog(catalogJar, knownBlocks).map(block => ({
    ...block,
    texturePath: verifiedBlockTexturePath(catalogJar, block, `block/${block.minecraftId}.png`, new Map()),
  }));
  const jarItemEntries = getJarItemCatalog(catalogJar, knownItems).map(item => ({
    ...item,
    texturePath: item.texturePath || defaultItemTexturePath(
      catalogJar,
      { name: item.minecraftId },
      item.modelName || `item/${item.minecraftId}`,
      new Map(),
      `items/${item.minecraftId}.png`,
      new Map(),
      item.specialItem === true,
    ),
  }));
  const jarBlockDefinitions = new Map(
    getJarBlockstateCatalog(catalogJar).map(block => [block.minecraftId, block]),
  );
  const blockTextureModelCache = new Map();
  const verifiedCommunityCatalog = communityCatalog.map(entry => {
    if (entry.category !== 'Blocks' || !entry.minecraftId) return entry;
    const block = jarBlockDefinitions.get(entry.minecraftId) || {
      name: entry.minecraftId,
      states: entry.stateProperties || [],
    };
    const texturePath = verifiedBlockTexturePath(
      catalogJar,
      block,
      entry.texturePath || `block/${entry.minecraftId}.png`,
      blockTextureModelCache,
    );
    return texturePath ? { ...entry, texturePath } : entry;
  });
  const preferredCatalog = [...verifiedCommunityCatalog, ...jarBlockEntries, ...jarItemEntries];
  const preferredTexturePaths = new Set(preferredCatalog.map(entry => canonicalTexturePath(entry.texturePath || entry.path)));
  const supplementalJarCatalog = jarCatalog.filter(entry => !preferredTexturePaths.has(canonicalTexturePath(entry.texturePath || entry.path)));
  const normalizedSupplemental = supplementalJarCatalog.map(entry => entry.category === 'Blocks'
    ? { ...entry, modelName: undefined, shape: 'flat' }
    : entry);
  const rawCatalog = [...preferredCatalog, ...normalizedSupplemental];
  if (!rawCatalog.length) {
    return { ok: false, version, catalog: [], error: `Minecraft ${version} data could not be loaded from either the community dataset or the official client jar.` };
  }
  const identity = entry => [entry.category, entry.id, entry.path, entry.modelName || '', canonicalTexturePath(entry.texturePath || '')].join('|');
  const seen = new Set();
  const catalog = rawCatalog.filter(entry => {
    const key = identity(entry);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((left, right) => String(left.category).localeCompare(String(right.category)) || String(left.name).localeCompare(String(right.name)));
  console.info(`[ResourcePackStudio] catalog raw=${rawCatalog.length} normalized=${catalog.length} duplicatesRemoved=${rawCatalog.length - catalog.length} source=${communityCatalog.length ? 'community+jar' : 'jar-only'}`);
  const result = { ok: true, version, catalog, source: communityCatalog.length ? 'community+jar' : 'jar-only' };
  resourcePackCatalogCache.set(version, result);
  return result;
});

ipcMain.handle('launcher:get-resource-pack-asset', async (_event, requestedVersion, requestedPath) => {
  const version = String(requestedVersion || '1.21.4');
  const assetPath = String(requestedPath || '').replace(/^[/\\]+/, '').replace(/\.\.(?:[/\\]|$)/g, '');
  const jarCategories = 'block|item|entity|gui|particle|painting|trims|mob_effect|map|environment|misc|font|colormap|effect|models';
  const communityCategories = 'items|blocks|entity|models|gui|environment|particle|painting|font|misc|colormap';
  if (!new RegExp(`^(?:${jarCategories}|${communityCategories})/[\\w./-]+\\.png$`, 'i').test(assetPath)) {
    return { ok: false, error: 'Invalid Minecraft asset path.' };
  }
  const key = `${version}:${assetPath}`;
  if (resourcePackAssetCache.has(key)) return resourcePackAssetCache.get(key);
  // Fast path: community-hosted single-file fetch for the common
  // block/item textures referenced while resolving a model's face textures.
  if (/^(?:items|blocks)\//i.test(assetPath)) {
    try {
      const response = await axios.get(`https://raw.githubusercontent.com/PrismarineJS/minecraft-assets/master/data/${encodeURIComponent(version)}/${assetPath}`, { responseType: 'arraybuffer', timeout: 20000 });
      const result = { ok: true, path: assetPath, dataUrl: `data:image/png;base64,${Buffer.from(response.data).toString('base64')}` };
      resourcePackAssetCache.set(key, result);
      return result;
    } catch (_error) {
      // fall through to the client jar below.
    }
  }
  try {
    const jar = await getClientJar(version);
    if (!jar) throw new Error('Client jar unavailable.');
    const singularPath = assetPath.replace(/^items\//i, 'item/').replace(/^blocks\//i, 'block/');
    const pluralPath = assetPath.replace(/^item\//i, 'items/').replace(/^block\//i, 'blocks/');
    const entry = [singularPath, pluralPath].map(relative => jar.getEntry(`assets/minecraft/textures/${relative}`)).find(Boolean);
    if (!entry) throw new Error(`Texture not present in the ${version} client jar.`);
    const result = { ok: true, path: assetPath, dataUrl: `data:image/png;base64,${entry.getData().toString('base64')}` };
    resourcePackAssetCache.set(key, result);
    return result;
  } catch (error) {
    return { ok: false, path: assetPath, error: `Vanilla texture could not be loaded: ${error.message}` };
  }
});

ipcMain.handle('launcher:get-resource-pack-item-definition', async (_event, requestedVersion, requestedItem) => {
  const version = String(requestedVersion || '1.21.4');
  const itemName = String(requestedItem || '').replace(/^minecraft:/, '');
  if (!/^[\w./-]+$/.test(itemName) || itemName.split('/').some(part => !part || part === '.' || part === '..')) {
    return { ok: false, reason: 'invalid-name', error: 'Invalid Minecraft item name.' };
  }
  const key = `${version}:${itemName}`;
  if (resourcePackItemDefinitionCache.has(key)) return resourcePackItemDefinitionCache.get(key);
  try {
    const jar = await getClientJar(version);
    const data = readJarJson(jar, `assets/minecraft/items/${itemName}.json`);
    if (!data) {
      const result = { ok: false, reason: 'not-found', error: `No item model definition named "${itemName}" was found for ${version}.` };
      resourcePackItemDefinitionCache.set(key, result);
      return result;
    }
    const result = { ok: true, itemName, source: 'minecraft-client.jar', data };
    resourcePackItemDefinitionCache.set(key, result);
    return result;
  } catch (error) {
    return { ok: false, reason: 'error', error: `Item model definition could not be loaded: ${error.message}` };
  }
});

ipcMain.handle('launcher:get-resource-pack-blockstate', async (_event, requestedVersion, requestedBlock) => {
  const version = String(requestedVersion || '1.21.4');
  const blockName = String(requestedBlock || '').replace(/^minecraft:/, '');
  if (!/^[\w./-]+$/.test(blockName) || blockName.split('/').some(part => !part || part === '.' || part === '..')) {
    return { ok: false, reason: 'invalid-name', error: 'Invalid Minecraft blockstate name.' };
  }
  const key = `${version}:${blockName}`;
  if (resourcePackBlockstateCache.has(key)) return resourcePackBlockstateCache.get(key);
  try {
    const jar = await getClientJar(version);
    const entry = jar?.getEntry(`assets/minecraft/blockstates/${blockName}.json`);
    if (!entry) {
      const result = { ok: false, reason: 'not-found', error: `No blockstate named "${blockName}" was found in the ${version} client jar.` };
      resourcePackBlockstateCache.set(key, result);
      return result;
    }
    const blockstate = JSON.parse(entry.getData().toString('utf8'));
    const result = { ok: true, blockName, source: 'minecraft-client.jar', data: blockstate };
    resourcePackBlockstateCache.set(key, result);
    return result;
  } catch (error) {
    return { ok: false, reason: 'error', error: `Blockstate could not be loaded: ${error.message}` };
  }
});

ipcMain.handle('launcher:get-resource-pack-model', async (_event, requestedVersion, requestedModel) => {
  const version = String(requestedVersion || '1.21.4');
  const raw = String(requestedModel || '');
  const namespaceMatch = raw.match(/^([a-z0-9_.-]+):(.+)$/i);
  const namespace = namespaceMatch ? namespaceMatch[1] : 'minecraft';
  const requested = namespaceMatch ? namespaceMatch[2] : raw;
  const model = requested.replace(/^(?:block|blocks|item|items)\//, '');
  if (!/^[\w./-]+$/.test(model)) return { ok: false, reason: 'invalid-name', error: 'Invalid Minecraft model name.' };
  if (namespace !== 'minecraft') {
    // A non-vanilla namespace can only ever come from the user's own
    // imported/custom project data, which this main-process handler has no
    // visibility into. The renderer is expected to resolve project-owned
    // namespaces itself and only call this IPC for the vanilla ones.
    return { ok: false, reason: 'unsupported-namespace', error: `"${namespace}" isn't a vanilla namespace -- this model has to come from an imported resource pack or a custom model, not Mojang's client.` };
  }
  const modelKind = requested.startsWith('item/') || requested.startsWith('items/') ? 'item' : 'block';
  const key = `${version}:${modelKind}:${model}`;
  if (resourcePackModelCache.has(key)) return resourcePackModelCache.get(key);
  try {
    // The actual client jar is the authoritative source -- it's Mojang's own
    // JSON verbatim, so display transforms/ambientocclusion/anything a
    // flattened third-party dataset might drop are preserved. Only fall back
    // to the community dataset if the jar genuinely doesn't have the model
    // (or isn't available at all).
    const jarResult = await loadVanillaClientModel(version, model, modelKind);
    if (jarResult?.found) {
      const result = { ok: true, model, source: 'minecraft-client.jar', data: jarResult.data, missingParent: jarResult.missingParent || null };
      resourcePackModelCache.set(key, result);
      return result;
    }
    const sources = modelKind === 'item' ? ['items_models.json', 'blocks_models.json'] : ['blocks_models.json', 'items_models.json'];
    let response, sourceName;
    for (const candidate of sources) {
      try {
        const attempt = await axios.get(`https://raw.githubusercontent.com/PrismarineJS/minecraft-assets/master/data/${encodeURIComponent(version)}/${candidate}`, { timeout: 20000 });
        if (attempt.data?.[model]) { response = attempt; sourceName = candidate; break; }
      } catch { /* try the other source before giving up */ }
    }
    if (!response?.data?.[model]) {
      return { ok: false, model, reason: 'not-found', error: `No Minecraft model named "${model}" was found for ${version} (checked the client jar and the community dataset).` };
    }
    let missingParent = null;
    const resolveModel = (name, seen = new Set()) => {
      const parentKey = String(name || '').replace(/^minecraft:(?:block|item)\//, '').replace(/^(?:block|item)\//, '');
      if (!parentKey || seen.has(parentKey)) return {};
      const isReferencedParent = seen.size > 0;
      seen.add(parentKey);
      const source = response.data?.[parentKey];
      if (!source) { if (isReferencedParent && !parentKey.startsWith('builtin/')) missingParent = parentKey; return parentKey.startsWith('builtin/') ? { __builtin: parentKey } : {}; }
      const parent = resolveModel(source.parent, seen);
      return { ...parent, ...source, textures: { ...(parent.textures || {}), ...(source.textures || {}) } };
    };
    const resolved = resolveModel(model);
    const result = { ok: true, model, source: sourceName, data: resolved, missingParent };
    resourcePackModelCache.set(key, result);
    return result;
  } catch (error) {
    return { ok: false, model, reason: 'error', error: `Model could not be loaded: ${error.message}` };
  }
});

ipcMain.handle('launcher:import-resource-pack', async () => {
  try {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Import Minecraft resource pack',
      properties: ['openFile'],
      filters: [{ name: 'Minecraft resource pack', extensions: ['zip'] }],
    });
    if (result.canceled || !result.filePaths[0]) return { ok: false, canceled: true };
    const sourcePath = result.filePaths[0];
    const zip = new AdmZip(sourcePath);
    // Import everything (models, blockstates, lang files, sounds, fonts,
    // etc.), not just PNGs + pack.mcmeta -- an importer that only keeps
    // textures silently destroys the rest of the pack on the next export.
    // Text-ish assets are kept as UTF-8 text (editable, small); everything
    // else (including PNGs) as a base64 data URL.
    const TEXT_ASSET_PATTERN = /\.(?:json|mcmeta|lang|txt|properties|cfg|toml|mf)$/i;
    const entries = zip.getEntries()
      .filter(entry => !entry.isDirectory)
      .map(entry => {
        const cleanPath = String(entry.entryName || '').replace(/\\/g, '/').replace(/^\/+/, '').replace(/\.\.(?:\/|$)/g, '');
        if (!cleanPath) return null;
        if (/\.png$/i.test(cleanPath)) return { path: cleanPath, data: `data:image/png;base64,${entry.getData().toString('base64')}` };
        if (TEXT_ASSET_PATTERN.test(cleanPath)) return { path: cleanPath, data: entry.getData().toString('utf8') };
        return { path: cleanPath, data: `data:application/octet-stream;base64,${entry.getData().toString('base64')}` };
      })
      .filter(Boolean);
    const metaEntry = entries.find(entry => entry.path === 'pack.mcmeta');
    let packMeta = null;
    if (metaEntry) {
      try { packMeta = JSON.parse(metaEntry.data); } catch (_error) { packMeta = null; }
    }
    return { ok: true, fileName: path.basename(sourcePath), entries, packMeta };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle('launcher:export-resource-pack', async (_event, payload) => {
  try {
    const packName = sanitizeFileName(payload?.packName || 'resource-pack') || 'resource-pack';
    const version = String(payload?.version || '1.21.11');
    const packFormat = RESOURCE_PACK_FORMATS[version];
    if (!packFormat) throw new Error(`Minecraft Java ${version} is not supported for resource-pack export.`);
    const zip = new AdmZip();
    const description = String(payload?.description || payload?.packName || 'Bald Launcher Resource Pack');
    zip.addFile('pack.mcmeta', Buffer.from(JSON.stringify({ pack: { ...packFormat, description }, author: String(payload?.author || '') }, null, 2)));
    if (typeof payload?.iconDataUrl === 'string' && payload.iconDataUrl.startsWith('data:image/png;base64,')) {
      zip.addFile('pack.png', Buffer.from(payload.iconDataUrl.slice('data:image/png;base64,'.length), 'base64'));
    }
    for (const entry of Array.isArray(payload?.entries) ? payload.entries : []) {
      if (!entry?.path || typeof entry.dataUrl !== 'string') continue;
      const relativePath = String(entry.path).replace(/^[/\\]+/, '').replace(/\.\.(?:[/\\]|$)/g, '');
      if (!relativePath || relativePath === 'pack.mcmeta') continue;
      // Accepts any `data:<mime>;base64,...` payload (textures, or any other
      // binary asset carried through import), and falls back to writing the
      // string as plain UTF-8 text for JSON/lang/model-style entries that
      // were never encoded as a data URL in the first place.
      const base64Match = entry.dataUrl.match(/^data:[^;]+;base64,([\s\S]*)$/);
      const buffer = base64Match ? Buffer.from(base64Match[1], 'base64') : Buffer.from(entry.dataUrl, 'utf8');
      zip.addFile(relativePath, buffer);
    }
    let filePath;
    if (payload?.install) {
      const profile = getActiveProfile();
      if (!profile) throw new Error('No active profile');
      const folder = getContentFolder('resourcepack', getMinecraftRootFor(profile.id));
      fs.mkdirSync(folder, { recursive: true });
      filePath = path.join(folder, `${packName}.zip`);
    } else {
      const result = await dialog.showSaveDialog(mainWindow, { title: 'Export resource pack', defaultPath: `${packName}.zip`, filters: [{ name: 'Minecraft resource pack', extensions: ['zip'] }] });
      if (result.canceled || !result.filePath) return { ok: false, error: 'Export canceled.' };
      filePath = result.filePath.toLowerCase().endsWith('.zip') ? result.filePath : `${result.filePath}.zip`;
    }
    zip.writeZip(filePath);
    if (payload?.install) {
      const profile = getActiveProfile();
      const entry = normalizeInstalledContent({ id: `bald-resource-pack:${packName}`, name: packName, type: 'resourcepack', enabled: true, source: 'bald-launcher' });
      if (profile && !profile.mods.some(item => item.id === entry.id)) {
        profile.mods.push(entry);
        scheduleStateWrite();
      }
    }
    return { ok: true, path: filePath };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle('launcher:install-content', async (_event, payload) => {
  const dependencyInstallId = typeof payload?.dependencyInstallId === 'string' && /^[\w-]{1,100}$/.test(payload.dependencyInstallId)
    ? payload.dependencyInstallId
    : null;
  if (dependencyInstallId && dependencyInstallControllers.has(dependencyInstallId)) {
    return { ok: false, error: 'This dependency download is already running.' };
  }
  const dependencyController = dependencyInstallId ? new AbortController() : null;
  if (dependencyInstallId && dependencyController) dependencyInstallControllers.set(dependencyInstallId, dependencyController);
  try {
    if (payload?.serverId) {
      const server = getServerById(payload.serverId);
      if (!server) throw new Error('Server not found');
      const rules = getServerContentRules(server.serverType);
      const entry = {
        id: String(payload.id || ''),
        name: String(payload.name || 'content'),
        slug: String(payload.slug || ''),
        type: String(payload.type || ''),
        versionId: String(payload.versionId || ''),
        fileId: String(payload.fileId || ''),
      };
      if (!entry.id || !rules.allowed.includes(entry.type)) throw new Error('This content type is not supported by this server');
      const rootPath = ensureServerRoot(server.id);
      const extension = entry.type === 'plugin' || entry.type === 'mod' ? '.jar' : '.zip';
      const filePath = path.join(getServerContentFolder(server, entry.type, rootPath), `${sanitizeFileName(entry.name)}${extension}`);
      if (entry.type === 'mod') {
        const inventory = await readInstalledModInventory(path.join(rootPath, 'mods'));
        if (isInstalledModContent(inventory.mods, server.installedContent, entry) || fs.existsSync(filePath)) {
          throw new Error(`${entry.name} is already installed on this server.`);
        }
        const staleRecords = (server.installedContent || []).filter(item =>
          item.type !== 'mod' || isInstalledModContent(inventory.mods, server.installedContent, item));
        if (staleRecords.length !== (server.installedContent || []).length) {
          updateServerInState(server.id, { installedContent: staleRecords });
        }
      } else if (isContentInstalled(server.installedContent, entry) || fs.existsSync(filePath)) {
        throw new Error(`${entry.name} is already installed on this server.`);
      }
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      let installedVersion = {};
      if (payload?.source === 'curseforge') {
        installedVersion = await installCurseForgeContent(entry.id, server.mcVersion, server.serverType || server.loader, entry.type, filePath, entry.name, entry.fileId || null, true, dependencyController?.signal);
      } else {
        installedVersion = await installServerModrinthContent(server, entry, filePath, entry.versionId || null, dependencyController?.signal);
      }
      const installedEntry = {
        ...normalizeInstalledContent({ ...payload, ...installedVersion, enabled: true, fileName: path.basename(filePath) }),
        type: entry.type,
      };
      const installedContent = [...(server.installedContent || []).filter(item => !isContentInstalled([item], installedEntry)), installedEntry];
      const updatedServer = updateServerInState(server.id, { installedContent });
      return { ok: true, path: filePath, entry: installedEntry, server: updatedServer, requiredDependencies: installedVersion.requiredDependencies || [] };
    }
    const profile = payload?.profileId
      ? launcherState.profiles.find(item => item.id === String(payload.profileId))
      : getActiveProfile();
    if (!profile) throw new Error('No active profile');
    const minecraftRoot = getMinecraftRootFor(profile.id);
    ensureLauncherGameFolders(minecraftRoot);

    const entry = normalizeInstalledContent({ ...payload, enabled: true });
    if (isContentInstalled(profile.mods, entry) || hasInstalledContentFile(profile, entry)) return { ok: false, error: `${entry.name} is already installed in this profile.` };
    if (profile.loader === 'vanilla' && entry.type === 'mod') {
      throw new Error('Mods require a mod loader; resource packs, shaders, and data packs are supported for vanilla profiles');
    }
    const filePath = getInstalledFilePath(profile, entry.type, entry.name, false);
    let installedVersion = {};
    if (payload?.source === 'curseforge') {
      installedVersion = await installCurseForgeContent(entry.id, profile.mcVersion, profile.loader, entry.type, filePath, entry.name, payload.fileId || null, false, dependencyController?.signal);
    } else {
      installedVersion = await installModrinthContent(profile, entry, filePath, payload.versionId || null, dependencyController?.signal);
    }

    const idx = launcherState.profiles.findIndex(p => p.id === profile.id);
    if (idx !== -1 && !launcherState.profiles[idx].mods.some(m => m.id === entry.id)) {
      launcherState.profiles[idx].mods.push(normalizeInstalledContent({ ...entry, ...payload, ...installedVersion, fileName: path.basename(filePath), enabled: true }));
      scheduleStateWrite();
    }

    return {
      ok: true,
      path: filePath,
      entry: normalizeInstalledContent({ ...entry, ...payload, ...installedVersion, fileName: path.basename(filePath), enabled: true }),
      requiredDependencies: installedVersion.requiredDependencies || [],
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    if (dependencyInstallId && dependencyInstallControllers.get(dependencyInstallId) === dependencyController) {
      dependencyInstallControllers.delete(dependencyInstallId);
    }
  }
});

ipcMain.handle('launcher:cancel-dependency-install', async (_event, dependencyInstallId) => {
  const id = String(dependencyInstallId || '');
  const controller = dependencyInstallControllers.get(id);
  if (!controller) return { ok: true, canceled: false };
  controller.abort(new Error('Dependency download canceled.'));
  return { ok: true, canceled: true };
});

ipcMain.handle('launcher:update-content', async (_event, payload = {}) => {
  let stagingPath = '';
  let backupPath = '';
  let pendingOptimizationBackupPath = '';
  let currentPath = '';
  try {
    const server = payload.serverId ? getServerById(payload.serverId) : null;
    const profile = payload.profileId
      ? launcherState.profiles.find(item => item.id === String(payload.profileId))
      : getActiveProfile();
    if (payload.serverId && !server) throw new Error('Server not found');
    if (!server && !profile) throw new Error('Profile not found');
    const collection = server ? server.installedContent || [] : profile.mods || [];
    const entry = collection.find(item => String(item.id) === String(payload.id)
      || (payload.fileName && path.basename(String(item.fileName || '')) === path.basename(String(payload.fileName))));
    if (!entry) throw new Error('Installed content was not found in this profile or server.');
    const source = entry.source || payload.source;
    if (!['modrinth', 'curseforge'].includes(source)) throw new Error('This local file has no verified provider project to update.');
    const type = String(entry.type || payload.type || 'mod');
    const root = server ? ensureServerRoot(server.id) : getMinecraftRootFor(profile.id);
    const folder = server ? getServerContentFolder(server, type, root) : getContentFolder(type, root);
    const oldName = path.basename(String(entry.fileName || `${sanitizeFileName(entry.name)}${type === 'mod' || type === 'plugin' ? '.jar' : '.zip'}`));
    currentPath = path.join(folder, oldName);
    if (!fs.existsSync(currentPath) && fs.existsSync(`${currentPath}.disabled`)) {
      currentPath = `${currentPath}.disabled`;
    }
    const wasDisabled = /\.disabled$/i.test(currentPath);
    if (!fs.existsSync(currentPath)) throw new Error(`Installed file for ${entry.name} was not found.`);
    const updateToken = crypto.randomUUID();
    stagingPath = `${currentPath}.${updateToken}.bald-update`;
    backupPath = `${currentPath}.${updateToken}.bald-backup`;
    const mcVersion = String(server?.mcVersion || profile?.mcVersion || '');
    const loader = String(server?.serverType || server?.loader || profile?.loader || '');
    let installedVersion;
    if (source === 'curseforge') {
      installedVersion = await installCurseForgeContent(
        entry.id,
        mcVersion,
        loader,
        type,
        stagingPath,
        entry.name,
        payload.fileId || entry.latestVersionId || null,
        Boolean(server),
      );
    } else if (server) {
      installedVersion = await installServerModrinthContent(
        server,
        { ...entry, type },
        stagingPath,
        payload.versionId || entry.latestVersionId || null,
      );
    } else {
      installedVersion = await installModrinthContent(profile, { ...entry, type }, stagingPath, payload.versionId || entry.latestVersionId || null);
    }
    const managedSodiumProfile = !server && profile.optimizationManaged && profile.optimizationKind === 'sodium';
    const existingRollback = managedSodiumProfile
      ? (profile.optimizationRollbackFiles || []).find(record => record.targetFileName === oldName)
      : null;
    if (managedSodiumProfile && !existingRollback) {
      const rollbackRoot = path.join(root, 'optimization-rollback');
      fs.mkdirSync(rollbackRoot, { recursive: true });
      pendingOptimizationBackupPath = path.join(rollbackRoot, `${crypto.randomUUID()}.jar`);
      fs.copyFileSync(currentPath, pendingOptimizationBackupPath);
    }
    if (fs.existsSync(backupPath)) fs.unlinkSync(backupPath);
    fs.renameSync(currentPath, backupPath);
    try {
      fs.renameSync(stagingPath, currentPath.replace(/\.disabled$/i, ''));
      if (wasDisabled) fs.renameSync(currentPath.replace(/\.disabled$/i, ''), currentPath);
    } catch (error) {
      if (fs.existsSync(currentPath.replace(/\.disabled$/i, ''))) fs.unlinkSync(currentPath.replace(/\.disabled$/i, ''));
      fs.renameSync(backupPath, currentPath);
      throw error;
    }
    if (managedSodiumProfile && !existingRollback && pendingOptimizationBackupPath) {
      profile.optimizationRollbackFiles.push({
        targetFileName: oldName,
        disabled: wasDisabled,
        backupName: path.basename(pendingOptimizationBackupPath),
        previousEntry: normalizeInstalledContent(entry),
      });
      pendingOptimizationBackupPath = '';
    }
    try {
      fs.unlinkSync(backupPath);
    } catch (error) {
      console.warn('[Content] Updated file, but could not remove its backup.', {
        fileName: path.basename(backupPath),
        message: error?.message || String(error),
      });
    }
    const updatedEntry = normalizeInstalledContent({
      ...entry,
      ...installedVersion,
      fileName: path.basename(currentPath).replace(/\.disabled$/i, ''),
      enabled: !wasDisabled,
      updateAvailable: false,
      latestVersionId: '',
      latestVersion: '',
    });
    if (server) {
      const installedContent = collection.map(item => item === entry ? updatedEntry : item);
      const updatedServer = updateServerInState(server.id, { installedContent });
      return { ok: true, entry: updatedEntry, server: updatedServer };
    }
    const profileIndex = launcherState.profiles.findIndex(item => item.id === profile.id);
    launcherState.profiles[profileIndex].mods = collection.map(item => item === entry ? updatedEntry : item);
    scheduleStateWrite();
    return { ok: true, entry: updatedEntry, state: launcherState };
  } catch (error) {
    if (stagingPath && fs.existsSync(stagingPath)) fs.unlinkSync(stagingPath);
    if (backupPath && fs.existsSync(backupPath) && currentPath && !fs.existsSync(currentPath)) fs.renameSync(backupPath, currentPath);
    if (pendingOptimizationBackupPath && fs.existsSync(pendingOptimizationBackupPath)) {
      fs.unlinkSync(pendingOptimizationBackupPath);
    }
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle('launcher:remove-content', async (_event, payload) => {
  try {
    const profile = payload?.profileId
      ? launcherState.profiles.find(item => item.id === String(payload.profileId))
      : getActiveProfile();
    if (!profile) throw new Error('No active profile');
    const existing = profile.mods.find(m => m.id === payload?.id);
    if (profile.optimizationManaged && profile.optimizationKind === 'sodium' && existing?.id === 'sodium') {
      throw new Error('Sodium is required by this managed performance profile. Use a separate profile to remove it.');
    }
    if (existing) {
      for (const disabled of [false, true]) {
        const filePath = resolveInstalledContentPath(profile, existing, disabled)
          || getInstalledFilePath(profile, existing.type, existing.name, disabled);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      }
    }

    const idx = launcherState.profiles.findIndex(p => p.id === profile.id);
    if (idx !== -1) {
      launcherState.profiles[idx].mods = launcherState.profiles[idx].mods.filter(m => m.id !== payload?.id);
      scheduleStateWrite();
    }

    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

// Disabling content renames the file on disk (adds/removes a `.disabled`
// suffix) rather than deleting it — the standard approach so re-enabling
// doesn't require a re-download.
ipcMain.handle('launcher:toggle-content', async (_event, payload) => {
  try {
    const profile = payload?.profileId
      ? launcherState.profiles.find(item => item.id === String(payload.profileId))
      : getActiveProfile();
    if (!profile) throw new Error('No active profile');
    const idx = launcherState.profiles.findIndex(p => p.id === profile.id);
    if (idx === -1) throw new Error('Profile not found');
    const modIdx = launcherState.profiles[idx].mods.findIndex(m => m.id === payload?.id);
    if (modIdx === -1) throw new Error('Content not found in profile');

    const entry = launcherState.profiles[idx].mods[modIdx];
    const currentEnabled = entry.enabled !== false;
    if (profile.optimizationManaged && profile.optimizationKind === 'sodium' && entry.id === 'sodium') {
      throw new Error('Sodium is required by this managed performance profile and cannot be disabled.');
    }
    const actualFromPath = resolveInstalledContentPath(profile, entry, !currentEnabled) || resolveInstalledContentPath(profile, entry, currentEnabled);
    if (!actualFromPath) throw new Error(`Installed file for ${entry.name} was not found`);
    const nextEnabled = !currentEnabled;
    const toPath = `${actualFromPath.replace(/\.disabled$/i, '')}${nextEnabled ? '' : '.disabled'}`;
    if (actualFromPath !== toPath) fs.renameSync(actualFromPath, toPath);

    launcherState.profiles[idx].mods[modIdx] = { ...entry, enabled: nextEnabled, fileName: path.basename(toPath).replace(/\.disabled$/i, '') };
    scheduleStateWrite();
    return { ok: true, enabled: nextEnabled };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle('launcher:open-folder', async (_event, folderType) => {
  try {
    const profile = getActiveProfile();
    const minecraftRoot = getMinecraftRootFor(profile.id);
    ensureLauncherGameFolders(minecraftRoot);
    const folderPath = getContentFolder(folderType, minecraftRoot);
    fs.mkdirSync(folderPath, { recursive: true });

    if (process.platform === 'win32') execFile('explorer', [folderPath]);
    else if (process.platform === 'darwin') execFile('open', [folderPath]);
    else execFile('xdg-open', [folderPath]);

    return { ok: true, path: folderPath };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle('launcher:get-diagnostics', async () => {
  const profile = getActiveProfile();
  const processRecord = profile && runningProcesses.get(profile.id);
  const profileRoot = profile ? getMinecraftRootFor(profile.id) : null;
  const processProbe = process.platform === 'win32' && profile
    ? await queryWindowsMinecraftProcess(processRecord?.pid || null, profileRoot)
    : { ok: false, error: 'Active process inspection is supported on Windows only.' };
  const javaPath = processProbe.ok && processProbe.process?.executablePath
    ? processProbe.process.executablePath
    : processRecord?.javaPath
      || await resolveJavaForMinecraft(profile?.mcVersion || '1.21.1', profile?.javaPath || '');
  const javaVersion = await new Promise(resolve => execFile(javaPath, ['-version'], (error, stdout, stderr) => resolve(error ? 'Unavailable' : `${stdout || ''}${stderr || ''}`.trim())));
  const gpuAdapters = await new Promise(resolve => {
    if (process.platform !== 'win32') return resolve([]);
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', 'Get-CimInstance Win32_VideoController | Select-Object Name,DriverVersion,AdapterRAM | ConvertTo-Json -Compress'],
      { timeout: 8000, windowsHide: true, maxBuffer: 1024 * 1024 },
      (error, stdout) => {
        if (error || !stdout.trim()) return resolve([]);
        try {
          const parsed = JSON.parse(stdout);
          const adapters = Array.isArray(parsed) ? parsed : [parsed];
          resolve(adapters.map(adapter => ({
            name: String(adapter.Name || 'Unknown adapter'),
            driverVersion: String(adapter.DriverVersion || 'Unavailable'),
            memoryBytes: Number(adapter.AdapterRAM) || null,
          })));
        } catch {
          resolve([]);
        }
      },
    );
  });
  const gpu = gpuAdapters.map(adapter => adapter.name).join(', ') || 'Unavailable';
  const gpuPreference = await readWindowsGpuPreference(javaPath);
  const diagnosticPid = processRecord?.pid || processProbe.process?.pid || null;
  const diagnosticCpu = diagnosticPid ? await readProcessUsage(diagnosticPid, 'cpu') : null;
  const diagnosticMemory = diagnosticPid ? await readProcessUsage(diagnosticPid, 'memory') : null;
  const disk = profileRoot && fs.statfsSync ? (() => { try { const info = fs.statfsSync(profileRoot); return { freeGB: Math.round((info.bsize * info.bavail) / 1073741824), totalGB: Math.round((info.bsize * info.blocks) / 1073741824) }; } catch (_error) { return null; } })() : null;
  const internet = await new Promise(resolve => { const request = require('https').get('https://api.modrinth.com/v2', { timeout: 4000 }, response => { response.resume(); resolve(response.statusCode >= 200 && response.statusCode < 500); }); request.on('error', () => resolve(false)); request.on('timeout', () => { request.destroy(); resolve(false); }); });
  return {
    cpu: os.cpus()[0]?.model || 'Unknown',
    logicalCores: os.cpus().length,
    memoryGB: Math.round(os.totalmem() / 1073741824),
    availableMemoryGB: Number((os.freemem() / 1073741824).toFixed(1)),
    recommendedMemoryGB: recommendMinecraftMemoryGb(
      os.totalmem(),
      os.freemem(),
      ['sodium', 'oneclient'].includes(profile?.optimizationKind),
    ),
    platform: `${process.platform} ${process.arch}`,
    operatingSystem: `${os.type()} ${os.release()}`,
    javaPath,
    javaVersion,
    javaMajorVersion: parseJavaMajorVersion(javaPath) || null,
    minecraftProcess: processProbe.ok && processProbe.process ? {
      pid: processProbe.process.pid,
      executablePath: processProbe.process.executablePath,
      processType: processProbe.process.isClient ? 'Minecraft client' : 'Java process (not identified as a Minecraft client)',
      launchArguments: redactLaunchArguments(parseWindowsCommandLine(processProbe.process.commandLine || '')),
      cpuPercent: diagnosticCpu,
      memoryMb: diagnosticMemory,
      gpu3dPercent: processProbe.process.gpu3dPercent,
      gpuAdaptersInUse: processProbe.process.gpuAdaptersInUse || [],
      gpu3dMeasurement: processProbe.process.gpu3dPercent == null
        ? processProbe.process.gpuError || 'Windows GPU Engine counters were unavailable for this process.'
        : 'Maximum reported 3D-engine utilization for this process; not total GPU utilization.',
    } : null,
    minecraftGpuPreference: gpuPreference,
    processDetection: processProbe.ok
      ? processProbe.process ? 'The Java process was inspected through Windows process metadata.' : 'No Java process was found for this profile.'
      : processProbe.error,
    gpu,
    gpuAdapters,
    gpuDetection: gpu === 'Unavailable'
      ? 'GPU model detection failed; Minecraft active adapter and GPU capabilities are not available from this check.'
      : 'Installed adapter names only; the active Minecraft adapter and GPU capabilities are not verified.',
    profile: profile?.name || null,
    minecraft: profile?.mcVersion || null,
    loader: profile?.loader || null,
    renderer: profile?.rendererMode || null,
    jvmArguments: getJvmArguments(normalizeSettings({ ...launcherState.settings, ...(profile || {}) }), parseJavaMajorVersion(javaPath)),
    launchArguments: processRecord?.launchArguments || (processProbe.ok && processProbe.process
      ? redactLaunchArguments(parseWindowsCommandLine(processProbe.process.commandLine || ''))
      : []),
    checks: {
      java: javaPath !== 'java' && javaVersion !== 'Unavailable' ? 'good' : 'warning',
      profileDirectory: profileRoot && fs.existsSync(profileRoot) ? 'good' : 'problem',
      modDirectory: profileRoot && fs.existsSync(path.join(profileRoot, 'mods')) ? 'good' : 'warning',
      serverDirectory: fs.existsSync(path.join(app.getPath('userData'), 'servers')) ? 'good' : 'warning',
      internet: internet ? 'good' : 'warning',
      disk: disk && disk.freeGB >= 5 ? 'good' : 'warning',
      gpu: gpu && gpu !== 'Unavailable' ? 'good' : 'warning',
      permissions: (() => { try { const testFile = path.join(app.getPath('userData'), '.diagnostic-write-test'); fs.writeFileSync(testFile, 'ok'); fs.rmSync(testFile, { force: true }); return 'good'; } catch (_error) { return 'problem'; } })(),
    },
    disk,
    latestCrash: profile ? getSession(profile.id)?.crashAnalysis || null : null,
  };
});

ipcMain.handle('launcher:analyze-crash', async (_event, profileId) => {
  try {
    const profile = launcherState.profiles.find(item => item.id === profileId) || getActiveProfile();
    if (!profile) return { ok: false, error: 'No profile selected.' };
    const session = getSession(profile.id);
    const report = analyzeMinecraftFailure(profile, session, session?.exitCode ?? null);
    if (session) { session.crashAnalysis = report; scheduleStateWrite(); }
    return { ok: true, report };
  } catch (error) {
    console.error('[Crash resolver] Profile analysis failed:', error);
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle('server:analyze-crash', async (_event, payload = {}) => {
  try {
    const server = getServerById(payload.serverId);
    if (!server) return { ok: false, error: 'Server not found.' };
    return { ok: true, report: analyzeServerFailure(server) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle('launcher:open-crash-evidence', async (_event, payload = {}) => {
  try {
    const sourceId = String(payload.sourceId || '');
    if (!['latest-log', 'crash-report'].includes(sourceId)) throw new Error('Unsupported crash evidence source.');
    let root;
    if (payload.serverId) {
      const server = getServerById(payload.serverId);
      if (!server) throw new Error('Server not found.');
      root = getServerRoot(server.id);
    } else {
      const profile = launcherState.profiles.find(item => item.id === String(payload.profileId || ''));
      if (!profile) throw new Error('Profile not found.');
      root = getMinecraftRootFor(profile.id);
    }
    const filePath = sourceId === 'latest-log'
      ? path.join(root, 'logs', 'latest.log')
      : newestTextFile(path.join(root, 'crash-reports'));
    if (!filePath) throw new Error('No crash report is available for this analysis.');
    const resolvedRoot = fs.realpathSync(root);
    const resolvedFile = fs.realpathSync(filePath);
    const relativeFile = path.relative(resolvedRoot, resolvedFile);
    if (relativeFile === '..' || relativeFile.startsWith(`..${path.sep}`) || path.isAbsolute(relativeFile)) {
      throw new Error('Crash evidence resolved outside the selected profile or server folder.');
    }
    return { ok: true, ...readCrashEvidenceAtOffset(filePath, payload.byteOffset, payload.expectedLine || '') };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

async function readProcessUsage(pid, metric) {
  try {
    const stats = await pidusage(pid);
    return metric === 'cpu'
      ? Number(Number(stats.cpu || 0).toFixed(1))
      : Number((Number(stats.memory || 0) / 1048576).toFixed(1));
  } catch (error) {
    console.warn(`[Performance] Could not read process ${metric}:`, error);
    return null;
  }
}

async function queryWindowsMinecraftProcess(pid, profileRoot) {
  if (process.platform !== 'win32') return { ok: false, error: 'Windows process/GPU inspection is unavailable on this platform.' };
  const numericPid = Number(pid);
  const encodedRoot = Buffer.from(String(profileRoot || ''), 'utf8').toString('base64');
  const script = [
    '$ErrorActionPreference = "Stop"',
    `$targetPid = ${Number.isInteger(numericPid) && numericPid > 0 ? numericPid : 0}`,
    `$profileRoot = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String("${encodedRoot}"))`,
    'if ($targetPid -gt 0) { $target = Get-CimInstance Win32_Process -Filter "ProcessId=$targetPid" } else { $target = Get-CimInstance Win32_Process | Where-Object { $_.Name -match "^javaw?\\.exe$" -and $_.CommandLine -and $_.CommandLine.Contains($profileRoot) } | Select-Object -First 1 }',
    'if (-not $target) { @{ process = $null; error = $null } | ConvertTo-Json -Compress; exit 0 }',
    '$gpuEngines = @(); $gpuError = $null',
    'try { $paths = (Get-Counter -ListSet "GPU Engine").PathsWithInstances | Where-Object { $_ -match "pid_$($target.ProcessId)(_|\\))" -and $_ -match "engtype_3D" }; if ($paths) { $counterSets = Get-Counter -Counter $paths -SampleInterval 1 -MaxSamples 2; $samples = $counterSets[-1].CounterSamples; foreach ($sample in $samples) { if ($sample.InstanceName -match "engtype_3D") { $gpuEngines += @{ instanceName = [string]$sample.InstanceName; utilizationPercent = [math]::Round([double]$sample.CookedValue, 1) } } } } } catch { $gpuError = $_.Exception.Message }',
    '$command = [string]$target.CommandLine',
    '$client = ($command -match "net\\.minecraft\\.client\\.main\\.Main|--gameDir") -and ($command -notmatch "fabric-server-launch|net\\.minecraft\\.server\\.Main")',
    '@{ process = @{ pid = [int]$target.ProcessId; executablePath = [string]$target.ExecutablePath; commandLine = $command; isClient = [bool]$client; gpuEngines = @($gpuEngines); gpuError = $gpuError }; error = $null } | ConvertTo-Json -Depth 5 -Compress',
  ].join('; ');
  return new Promise(resolve => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      timeout: 15000,
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    }, (error, stdout) => {
      if (error || !stdout.trim()) return resolve({ ok: false, error: error?.message || 'Windows process inspection returned no data.' });
      try {
        const parsed = JSON.parse(stdout);
        if (!parsed.process) return resolve({ ok: true, process: null });
        const engines = Array.isArray(parsed.process.gpuEngines)
          ? parsed.process.gpuEngines
          : parsed.process.gpuEngines
            ? [parsed.process.gpuEngines]
            : [];
        const gpuAdaptersInUse = summarizeGpuEngineSamples(engines, Number(parsed.process.pid));
        resolve({
          ok: true,
          process: {
            ...parsed.process,
            gpuAdaptersInUse,
            gpu3dPercent: gpuAdaptersInUse.length
              ? Math.max(...gpuAdaptersInUse.map(adapter => adapter.max3dEnginePercent))
              : null,
          },
        });
      } catch (parseError) {
        resolve({ ok: false, error: `Windows process inspection returned invalid data: ${parseError.message}` });
      }
    });
  });
}

async function hashDirectoryTree(folderPath) {
  if (!fs.existsSync(folderPath)) return crypto.createHash('sha256').update('missing').digest('hex');
  await assertTreeHasNoSymlinks(folderPath, 'Benchmark resource files');
  const hash = crypto.createHash('sha256');
  const appendDirectory = async (directory, relative = '') => {
    const entries = await fs.promises.readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const entryRelative = path.posix.join(relative.split(path.sep).join('/'), entry.name);
      const entryPath = path.join(directory, entry.name);
      hash.update(entryRelative);
      if (entry.isDirectory()) {
        hash.update('directory');
        await appendDirectory(entryPath, entryRelative);
      } else if (entry.isFile()) {
        hash.update(await hashFile(entryPath));
      } else {
        throw new Error(`Benchmark resource "${entryRelative}" is not a regular file or directory.`);
      }
    }
  };
  await appendDirectory(folderPath);
  return hash.digest('hex');
}

async function hashActiveMods(profile) {
  const modsDirectory = path.join(getMinecraftRootFor(profile.id), 'mods');
  if (!fs.existsSync(modsDirectory)) {
    return { sha256: crypto.createHash('sha256').update('no-active-mods').digest('hex'), entries: [] };
  }
  await assertTreeHasNoSymlinks(modsDirectory, 'Minecraft mods');
  const files = [];
  const walk = async (directory, relative = '') => {
    for (const entry of await fs.promises.readdir(directory, { withFileTypes: true })) {
      const entryRelative = path.posix.join(relative.split(path.sep).join('/'), entry.name);
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(entryPath, entryRelative);
      } else if (entry.isFile() && /\.jar$/i.test(entry.name) && !/\.disabled$/i.test(entry.name)) {
        files.push({ path: entryRelative, sha256: await hashFile(entryPath) });
      }
    }
  };
  await walk(modsDirectory);
  files.sort((left, right) => left.path.localeCompare(right.path));
  return { sha256: crypto.createHash('sha256').update(JSON.stringify(files)).digest('hex'), entries: files };
}

async function getBenchmarkContext(profile, sceneId, activeProcess) {
  const sourceProfile = profile.optimizationManaged
    ? launcherState.profiles.find(item => item.id === profile.optimizationSourceProfileId)
    : profile;
  if (!sourceProfile) throw new Error('The optimized profile no longer has its source profile.');
  const optionsPath = path.join(getMinecraftRootFor(profile.id), 'options.txt');
  if (!fs.existsSync(optionsPath)) throw new Error('Minecraft options.txt is missing; launch the selected profile once before benchmarking.');
  await assertTreeHasNoSymlinks(optionsPath, 'Minecraft options');
  const optionsSha256 = await hashFile(optionsPath);
  const resourcesSha256 = crypto.createHash('sha256').update(JSON.stringify({
    resourcepacks: await hashDirectoryTree(path.join(getMinecraftRootFor(profile.id), 'resourcepacks')),
    shaderpacks: await hashDirectoryTree(path.join(getMinecraftRootFor(profile.id), 'shaderpacks')),
    irisConfig: await (async () => {
      const irisConfig = path.join(getMinecraftRootFor(profile.id), 'config', 'iris.properties');
      if (!fs.existsSync(irisConfig)) return 'missing';
      await assertTreeHasNoSymlinks(irisConfig, 'Iris shader settings');
      return hashFile(irisConfig);
    })(),
  })).digest('hex');
  const activeMods = await hashActiveMods(profile);
  const gpuNames = Array.isArray(activeProcess?.installedAdapters)
    ? activeProcess.installedAdapters.map(adapter => typeof adapter === 'string' ? adapter : adapter.name).filter(Boolean).sort().join(',')
    : '';
  const optionsText = await fs.promises.readFile(optionsPath, 'utf8');
  const selectedShaderPack = optionsText.split(/\r?\n/).some(line => /^shaderPack:/i.test(line)
    && Boolean(line.slice(line.indexOf(':') + 1).trim()));
  const profileModsPath = path.join(getMinecraftRootFor(profile.id), 'mods');
  const hasIris = (profile.mods || []).some(mod => mod.id === 'iris' && mod.enabled !== false)
    || (fs.existsSync(profileModsPath) && fs.readdirSync(profileModsPath).some(file => /^iris(?:[-_ ].*)?\.jar$/i.test(file)));
  const shaderRuntime = selectedShaderPack && hasIris ? 'iris-selected'
    : hasIris ? 'iris-installed'
      : selectedShaderPack ? 'selected-without-iris'
        : 'no-selected-shader';
  const cpu = os.cpus();
  const hardware = JSON.stringify({
    platform: process.platform,
    architecture: process.arch,
    operatingSystem: `${os.type()} ${os.release()}`,
    cpu: cpu[0]?.model || 'unknown',
    logicalCores: cpu.length,
    memoryBytes: os.totalmem(),
    installedGpuModels: gpuNames,
  });
  const actualJavaPath = activeProcess?.process?.executablePath || activeProcess?.javaPath || '';
  if (!actualJavaPath) throw new Error('The running Minecraft Java executable could not be identified.');
  const javaMajor = parseJavaMajorVersion(actualJavaPath) || activeProcess?.javaMajor || null;
  if (!javaMajor) throw new Error('The running Java major version could not be determined.');
  const javaVersionExecutable = path.basename(actualJavaPath).toLowerCase() === 'javaw.exe'
    ? path.join(path.dirname(actualJavaPath), 'java.exe')
    : actualJavaPath;
  const javaRuntime = await new Promise(resolve => execFile(
    fs.existsSync(javaVersionExecutable) ? javaVersionExecutable : actualJavaPath,
    ['-version'],
    {
    timeout: 5000,
    windowsHide: true,
    },
    (error, stdout, stderr) => {
      const output = `${stdout || ''}${stderr || ''}`.trim();
      resolve(!error && output ? output : '');
    },
  ));
  if (!javaRuntime) {
    throw new Error('The exact running Java runtime version could not be queried; benchmark comparison is disabled.');
  }
  const launchArguments = Array.isArray(activeProcess?.launchArguments)
    ? activeProcess.launchArguments
    : [];
  const launchArgumentsSha256 = crypto.createHash('sha256')
    .update(JSON.stringify(launchArguments))
    .digest('hex');
  const loaderVersion = activeProcess?.loaderVersion
    || (profile.loader === 'vanilla'
      ? profile.mcVersion
      : getLoaderVersionId(profile, profile.mcVersion, profile.loader, profile.loaderVersion))
    || 'unknown';
  if (loaderVersion === 'unknown') throw new Error('The selected loader version could not be identified for benchmark comparison.');
  const jvmConfigurationSha256 = crypto.createHash('sha256').update(JSON.stringify({
    arguments: Array.isArray(activeProcess?.jvmArguments) ? activeProcess.jvmArguments : [],
    memoryMaxGb: activeProcess?.memoryMaxGb ?? null,
  })).digest('hex');
  const signature = createBenchmarkSignature({
    machineId: launcherState.performanceMachineId,
    hardware,
    sourceProfileId: sourceProfile.id,
    sceneId,
    minecraft: profile.mcVersion,
    loader: profile.loader,
    loaderVersion,
    renderer: profile.rendererMode,
    javaMajor,
    javaPath: path.resolve(actualJavaPath).toLowerCase(),
    javaRuntime,
    jvmConfigurationSha256,
    shaderRuntime,
    optionsSha256,
    resourcesSha256,
  });
  const configurationSignature = createBenchmarkConfigurationSignature({
    loader: profile.loader,
    loaderVersion,
    renderer: profile.rendererMode,
    activeModsSha256: activeMods.sha256,
  });
  return {
    sourceProfile,
    sourceProfileId: sourceProfile.id,
    sceneId,
    javaMajor,
    javaPath: path.resolve(actualJavaPath),
    javaRuntime,
    launchArguments,
    launchArgumentsSha256,
    jvmConfigurationSha256,
    loaderVersion,
    activeModsSha256: activeMods.sha256,
    activeMods: activeMods.entries,
    configurationSignature,
    shaderRuntime,
    optionsSha256,
    resourcesSha256,
    signature,
    hardware,
  };
}

async function findPresentMonExecutable() {
  const configuredPath = String(process.env.PRESENTMON_PATH || '');
  if (configuredPath && fs.existsSync(configuredPath)) return configuredPath;
  const candidates = [
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Intel', 'PresentMon', 'PresentMon.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'PresentMon', 'PresentMon.exe'),
  ].filter(candidate => candidate && fs.existsSync(candidate));
  if (candidates.length) return candidates[0];
  if (process.platform !== 'win32') return null;
  return new Promise(resolve => execFile('where.exe', ['PresentMon.exe'], { windowsHide: true, timeout: 5000 }, (error, stdout) => {
    resolve(!error && stdout.trim() ? stdout.trim().split(/\r?\n/)[0] : null);
  }));
}

async function startPresentMonCapture(executable, processId, durationSeconds) {
  const directory = fs.mkdtempSync(path.join(app.getPath('temp'), 'bald-presentmon-'));
  const csvPath = path.join(directory, 'frames.csv');
  let child;
  try {
    child = spawn(executable, [
      '--process_id', String(processId),
      '--output_file', csvPath,
      '--delay', '30',
      '--timed', String(durationSeconds),
      '--terminate_after_timed',
      '--no_console_stats',
    ], { windowsHide: true, stdio: 'ignore' });
  } catch (error) {
    fs.rmSync(directory, { recursive: true, force: true });
    return { directory: null, csvPath, child: null, closed: Promise.resolve(null), spawnError: error };
  }
  let spawnError = null;
  const closed = new Promise(resolve => child.once('close', (code, signal) => resolve({ code, signal })));
  try {
    await new Promise((resolve, reject) => {
      child.once('spawn', resolve);
      child.once('error', reject);
    });
  } catch (error) {
    spawnError = error;
  }
  return { directory, csvPath, child, closed, spawnError };
}

async function waitForMilliseconds(durationMs) {
  await new Promise(resolve => setTimeout(resolve, durationMs));
}

function getPerformanceHistory(profile) {
  const sourceId = profile.optimizationManaged ? profile.optimizationSourceProfileId : profile.id;
  return launcherState.profiles
    .filter(item => item.id === sourceId || item.optimizationSourceProfileId === sourceId)
    .flatMap(item => (item.benchmarkHistory || []).map(result => ({ ...result })))
    .sort((left, right) => String(left.startedAt).localeCompare(String(right.startedAt)))
    .slice(-60);
}

function getBenchmarkComparison(history, result) {
  const matching = history.filter(item => item.signature === result.signature);
  return compareBenchmarkGroups(
    matching.filter(item => item.role === 'baseline'),
    matching.filter(item => item.role === 'optimized'),
  );
}

async function collectPerformanceSnapshot(profile, includeWindowsTelemetry = false) {
  const processRecord = runningProcesses.get(profile.id);
  const processProbe = includeWindowsTelemetry && process.platform === 'win32' && processRecord?.pid
    ? await queryWindowsMinecraftProcess(processRecord.pid, getMinecraftRootFor(profile.id))
    : includeWindowsTelemetry && process.platform === 'win32'
      ? await queryWindowsMinecraftProcess(null, getMinecraftRootFor(profile.id))
      : null;
  const pid = processRecord?.pid || processProbe?.process?.pid || null;
  const [cpuPercent, memoryMb] = pid
    ? await Promise.all([readProcessUsage(pid, 'cpu'), readProcessUsage(pid, 'memory')])
    : [null, null];
  return {
    recordedAt: new Date().toISOString(),
    profileId: profile.id,
    profileName: profile.name,
    minecraft: profile.mcVersion,
    loader: profile.loader,
    renderer: profile.rendererMode,
    shaderState: 'Unavailable: Minecraft does not expose shader state to the launcher',
    fps: null,
    frameTimeMs: null,
    onePercentLow: null,
    zeroPointOnePercentLow: null,
    cpuPercent,
    memoryMb,
    gpu3dPercent: processProbe?.process?.gpu3dPercent ?? null,
    gpuAdaptersInUse: processProbe?.process?.gpuAdaptersInUse || [],
    gpu3dMeasurement: processProbe?.process?.gpu3dPercent == null
      ? 'Not sampled; refresh live metrics to request Windows GPU Engine counters.'
      : 'Windows process-specific 3D-engine samples and adapter identifiers; not total GPU utilization.',
    vramMb: null,
    pid,
    java: processRecord?.javaPath || profile.javaPath || 'Automatic Java detection',
    javaMajor: processRecord?.javaMajor || null,
    processType: processProbe?.process
      ? processProbe.process.isClient ? 'Minecraft client' : 'Java process; not identified as a Minecraft client'
      : processRecord?.pid ? 'Tracked Java process' : 'No tracked process',
    processDetection: processProbe?.error || null,
    launchArguments: processRecord?.launchArguments || [],
    estimatedMetrics: ['fps', 'frameTimeMs', 'onePercentLow', 'zeroPointOnePercentLow', 'vramMb'],
  };
}

ipcMain.handle('launcher:get-performance', async (_event, profileId) => {
  const profile = launcherState.profiles.find(item => item.id === profileId) || getActiveProfile();
  if (!profile) return { ok: false, error: 'No profile selected.' };
  const snapshot = await collectPerformanceSnapshot(profile, true);
  const adapters = await getInstalledGpuModels();
  const history = getPerformanceHistory(profile);
  for (const result of history) result.comparison = getBenchmarkComparison(history, result);
  return {
    ok: true,
    running: runningProcesses.has(profile.id),
    snapshot,
    history,
    installedAdapters: adapters,
  };
});

ipcMain.handle('launcher:get-gpu-preference', async (_event, profileId) => {
  try {
    if (process.platform !== 'win32') {
      return { ok: false, error: 'Windows graphics preferences are only available on Windows.' };
    }
    const profile = launcherState.profiles.find(item => item.id === String(profileId || '')) || getActiveProfile();
    if (!profile) return { ok: false, error: 'No profile selected.' };
    const processRecord = runningProcesses.get(profile.id);
    const processProbe = process.platform === 'win32'
      ? await queryWindowsMinecraftProcess(processRecord?.pid || null, getMinecraftRootFor(profile.id))
      : { ok: false, process: null, error: 'Windows GPU preference is not supported on this platform.' };
    const minimumJava = getRequiredJavaVersion(profile.mcVersion);
    let javaPath = processProbe.ok && processProbe.process?.executablePath
      ? processProbe.process.executablePath
      : processRecord?.javaPath || '';
    if (!javaPath && profile.javaPath && fs.existsSync(profile.javaPath)
      && parseJavaMajorVersion(profile.javaPath) >= minimumJava) {
      javaPath = profile.javaPath;
    }
    if (!javaPath) {
      const discoveredJava = await getJavaPath(minimumJava, false);
      javaPath = fs.existsSync(discoveredJava) ? discoveredJava : '';
    }
    const preference = await readWindowsGpuPreference(javaPath);
    return {
      ok: true,
      profileId: profile.id,
      javaPath,
      preference,
      running: Boolean(processProbe.ok && processProbe.process),
      processType: processProbe.process?.isClient ? 'Minecraft client' : processProbe.process ? 'Java process' : null,
      gpuAdaptersInUse: processProbe.process?.gpuAdaptersInUse || [],
      gpu3dPercent: processProbe.process?.gpu3dPercent ?? null,
      gpuError: processProbe.process?.gpuError || processProbe.error || null,
    };
  } catch (error) {
    console.error('[Performance] Could not inspect Windows GPU preference:', error);
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle('launcher:open-windows-gpu-settings', async () => {
  if (process.platform !== 'win32') {
    return { ok: false, error: 'Windows graphics preferences are only available on Windows.' };
  }
  try {
    await shell.openExternal('ms-settings:display-advancedgraphics');
    return { ok: true };
  } catch (error) {
    console.error('[Performance] Could not open Windows Graphics settings:', error);
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle('launcher:run-benchmark', async (_event, payload) => {
  const profile = launcherState.profiles.find(item => item.id === payload?.profileId) || getActiveProfile();
  if (!profile) return { ok: false, error: 'No profile selected.' };
  const processRecord = runningProcesses.get(profile.id);
  if (!processRecord?.pid) return { ok: false, error: 'Launch Minecraft with this profile before running a benchmark.' };
  const role = payload?.role === 'optimized' ? 'optimized' : payload?.role === 'baseline' ? 'baseline' : '';
  if (!role) return { ok: false, error: 'Choose whether this is a baseline or optimized-profile run.' };
  if (role === 'optimized' && !(profile.optimizationManaged && ['sodium', 'oneclient'].includes(profile.optimizationKind))) {
    return { ok: false, error: 'An optimized run must use an isolated, launcher-managed OneClient or Sodium profile.' };
  }
  if (role === 'baseline' && profile.optimizationManaged) {
    return { ok: false, error: 'A baseline run must use the original, non-managed profile.' };
  }
  const sceneId = String(payload?.sceneId || '').trim().slice(0, 120);
  if (sceneId.length < 3) return { ok: false, error: 'Enter the same world and test scene label for both runs.' };
  const durationSeconds = Math.min(120, Math.max(15, Math.round(Number(payload?.durationSeconds) || 60)));
  const durationMs = durationSeconds * 1000;
  const activeProcess = await queryWindowsMinecraftProcess(processRecord.pid, getMinecraftRootFor(profile.id));
  if (process.platform === 'win32' && (!activeProcess.ok || !activeProcess.process)) {
    return { ok: false, error: `Could not verify the Minecraft process before capture: ${activeProcess.error || 'no matching Java process was found'}` };
  }
  if (activeProcess.ok && activeProcess.process && !activeProcess.process.isClient) {
    return { ok: false, error: 'The tracked Java process was not identified as a Minecraft client; server and other Java processes cannot be FPS benchmarked.' };
  }
  const context = await getBenchmarkContext(profile, sceneId, {
    ...activeProcess,
    javaPath: processRecord.javaPath,
    javaMajor: processRecord.javaMajor,
    launchArguments: processRecord.launchArguments,
    jvmArguments: processRecord.jvmArguments,
    memoryMaxGb: processRecord.memoryMaxGb,
    loaderVersion: processRecord.versionNumber,
    installedAdapters: await getInstalledGpuModels(),
  });
  const presentMon = process.platform === 'win32' ? await findPresentMonExecutable() : null;
  let capture = null;
  if (presentMon) capture = await startPresentMonCapture(presentMon, processRecord.pid, durationSeconds);
  emitStatus(capture
    ? `Benchmark warm-up · ${profile.name} · 30 seconds, then ${durationSeconds} seconds of frame capture`
    : `Sampling CPU/RAM · ${profile.name} · PresentMon was not found; FPS will remain unavailable`);
  const samples = [];
  const startedAt = Date.now();
  let captureError = capture?.spawnError ? `PresentMon could not start: ${capture.spawnError.message}` : null;
  emitStatus(`Benchmark warm-up · ${profile.name}`);
  await waitForMilliseconds(30000);
  const measurementStartedAt = Date.now();
  while (Date.now() - measurementStartedAt < durationMs && runningProcesses.has(profile.id)) {
    samples.push(await collectPerformanceSnapshot(profile));
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  if (!runningProcesses.has(profile.id)) {
    captureError = captureError || 'Minecraft exited before the requested benchmark interval completed.';
    if (capture?.child && capture.child.exitCode == null) capture.child.kill();
  }
  let frameMetrics = null;
  if (capture && !captureError) {
    const closeResult = await Promise.race([
      capture.closed,
      waitForMilliseconds(15000).then(() => null),
    ]);
    if (!closeResult && capture.child.exitCode == null) {
      capture.child.kill();
      await Promise.race([capture.closed, waitForMilliseconds(5000)]);
    }
    try {
      if (closeResult?.code !== 0) throw new Error(`PresentMon exited with code ${closeResult?.code ?? 'unknown'}.`);
      frameMetrics = parsePresentMonCsv(await fs.promises.readFile(capture.csvPath, 'utf8'), processRecord.pid);
    } catch (error) {
      captureError = `FPS capture failed: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
  if (capture?.directory && fs.existsSync(capture.directory)) fs.rmSync(capture.directory, { recursive: true, force: true });
  const measuredCpu = samples.filter(sample => sample.cpuPercent != null).map(sample => sample.cpuPercent);
  const measuredMemory = samples.filter(sample => sample.memoryMb != null).map(sample => sample.memoryMb);
  const result = {
    id: `benchmark-${crypto.randomUUID()}`,
    startedAt: new Date(startedAt).toISOString(),
    durationMs: Date.now() - measurementStartedAt,
    role,
    sceneId,
    averageFps: frameMetrics?.averageFps ?? null,
    onePercentLow: frameMetrics?.onePercentLow ?? null,
    zeroPointOnePercentLow: frameMetrics?.zeroPointOnePercentLow ?? null,
    frameTimeMs: frameMetrics?.frameTimeMs ?? null,
    frameTimeSamples: frameMetrics?.sampleCount ?? 0,
    captureError: captureError || (presentMon ? null : 'PresentMon was not found. Install PresentMon and relaunch Bald Launcher to measure FPS.'),
    presentMonPath: presentMon,
    pid: processRecord.pid,
    javaMajor: context.javaMajor,
    sourceProfileId: context.sourceProfileId,
    signature: context.signature,
    optionsSha256: context.optionsSha256,
    resourcesSha256: context.resourcesSha256,
    activeModsSha256: context.activeModsSha256,
    activeMods: context.activeMods,
    configurationSignature: context.configurationSignature,
    loaderVersion: context.loaderVersion,
    rendererMode: profile.rendererMode,
    javaPath: context.javaPath,
    javaRuntime: context.javaRuntime,
    launchArguments: context.launchArguments,
    launchArgumentsSha256: context.launchArgumentsSha256,
    jvmConfigurationSha256: context.jvmConfigurationSha256,
    machineId: launcherState.performanceMachineId,
    averageCpuPercent: measuredCpu.length ? Number((measuredCpu.reduce((sum, value) => sum + value, 0) / measuredCpu.length).toFixed(1)) : null,
    peakMemoryMb: measuredMemory.length ? Math.max(...measuredMemory) : null,
    gpu3dPercent: activeProcess.process?.gpu3dPercent ?? null,
    metricsUnavailable: [
      ...(!frameMetrics ? ['averageFps', 'onePercentLow', 'zeroPointOnePercentLow', 'frameTimeMs'] : []),
      'vramMb',
    ],
    profileId: profile.id,
    profileName: profile.name,
    settings: {
      rendererMode: profile.rendererMode,
      mcVersion: profile.mcVersion,
      loader: profile.loader,
      sceneId,
      shaderRuntime: context.shaderRuntime,
      optionsSha256: context.optionsSha256,
    },
  };
  profile.benchmarkHistory = [...(profile.benchmarkHistory || []), result].slice(-30);
  const history = getPerformanceHistory(profile);
  result.comparison = getBenchmarkComparison(history, result);
  profile.benchmarkHistory[profile.benchmarkHistory.length - 1] = result;
  if (!launcherState.performanceMachineId) launcherState.performanceMachineId = crypto.randomUUID();
  scheduleStateWrite();
  emitStatus(`Benchmark complete · ${profile.name}`);
  return { ok: true, result, history: getPerformanceHistory(profile) };
});

// ---------------------------------------------------------------------------
// IPC: launch
// ---------------------------------------------------------------------------
async function launchJavaProfile(payload) {
  const prewarming = payload?.prewarming === true;
  const requestedProfileId = payload?.profileId || null;
  const requestedAccountId = payload?.accountId || null;
  let launchProfileId = requestedProfileId;
  let baldMenuBridge = null;
  let baldMenuConfigPath = null;
  let libSession = null;
  let javaPrewarmWindowController = null;
  let releaseJavaPrewarmCover = () => {};
  let javaPrewarmChild = null;
  let javaPrewarmReady = false;
  try {
    const account = launcherState.accounts.find(item => item.id === requestedAccountId) || getActiveAccount();
    if (!account) throw new Error('No account selected');
    launcherState.activeAccountId = account.id;
    const sourceProfile = launcherState.profiles.find(item => item.id === requestedProfileId) || getActiveProfile();
    let profile = sourceProfile;
    if (!profile) throw new Error('No active profile');
    if (prewarming) {
      if (horizonPrewarmShutdownRequested) return { ok: false, error: 'Launcher is shutting down.' };
      if (profile.prewarmEnabled !== true) return { ok: false, skipped: true, error: 'Prewarm is disabled for this profile.' };
      if (process.platform !== 'win32') return { ok: false, skipped: true, error: 'Background game prewarm is supported on Windows only.' };
      const headroom = getPrewarmMemoryHeadroomGb(profile.memoryMax);
      if (!headroom.allowed) {
        return {
          ok: false,
          skipped: true,
          error: `Prewarm needs about ${headroom.requiredGb.toFixed(1)} GB free RAM; ${headroom.freeGb.toFixed(1)} GB is free.`,
        };
      }
      if (runningProcesses.has(profile.id)) return { ok: true, skipped: true, profileId: profile.id };
    } else {
      const warmState = javaPrewarmedProcesses.get(profile.id);
      if (warmState?.prewarming && !warmState.child.killed && warmState.child.exitCode === null) {
        try {
          await warmState.windowController.control(warmState.child.pid, 'restore-process-limits', {
            timeoutMs: 8_000,
            waitForWindow: false,
          });
        } catch (error) {
          console.warn(`[Prewarm] Could not restore normal CPU use for ${profile.name}:`, error.message);
        }
        const restored = await warmState.windowController.control(warmState.child.pid, 'restore-process', {
          timeoutMs: 8_000,
          waitForWindow: false,
        });
        if (!restored.windows) throw new Error('The prewarmed Minecraft window could not be restored.');
        blurLauncherWindowForGame();
        warmState.prewarming = false;
        warmState.activated = true;
        const runningRecord = runningProcesses.get(profile.id);
        if (runningRecord) runningRecord.prewarming = false;
        warmState.session.running = true;
        warmState.session.pid = warmState.child.pid || null;
        profile.lastUsedAt = Date.now();
        scheduleStateWrite();
        startProfilePlaytimeTracking(profile, warmState.session);
        try {
          os.setPriority(warmState.child.pid, os.constants.priority.PRIORITY_NORMAL);
        } catch (error) {
          console.warn(`[Prewarm] Could not restore normal process priority for ${profile.name}:`, error.message);
        }
        emitProcessState(true, profile, warmState.child.pid);
        emitStatus(`Running · ${profile.name} · ${warmState.accountName}`);
        warmState.releaseWindowCover?.();
        warmState.releaseWindowCover = null;
        await warmState.windowController.close().catch(error => {
          console.warn(`[Prewarm] Could not stop Java window controller for ${profile.name}:`, error.message);
        });
        return {
          ok: true,
          profileId: profile.id,
          profileName: profile.name,
          version: warmState.versionNumber,
          accountName: warmState.accountName,
          pid: warmState.child.pid || null,
          prewarmed: true,
        };
      }
    }
    const settings = normalizeSettings({ ...launcherState.settings, ...profile, ...(payload?.settings || {}) });
    if (isOptimizationOptedIn(settings) && !profile.optimizationManaged && payload?.skipAutoOptimization !== true) {
      const sourceModDirectory = path.join(getMinecraftRootFor(sourceProfile.id), 'mods');
      const hasActiveJar = fs.existsSync(sourceModDirectory)
        && !fs.lstatSync(sourceModDirectory).isSymbolicLink()
        && fs.statSync(sourceModDirectory).isDirectory()
        && fs.readdirSync(sourceModDirectory).some(file => /\.jar$/i.test(file));
      if (!canCreateOptimizationProfile(sourceProfile) || hasActiveJar) {
        emitLog(sourceProfile.name, 'warn', 'Automatic optimization was skipped because this profile has active mods or an unsupported loader. The selected profile will launch unchanged.', sourceProfile.id);
      } else {
        try {
          profile = await createManagedSodiumProfile(sourceProfile);
          emitLog(profile.name, 'info', `Using isolated Sodium profile for ${sourceProfile.name}.`, profile.id);
          if (profile.optimizationSkippedMods.length) {
            emitLog(profile.name, 'info', `Skipped optional mods without an exact verified release: ${profile.optimizationSkippedMods.join(', ')}.`, profile.id);
          }
          launchProfileId = profile.id;
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          emitStatus(`Optional optimization unavailable for Minecraft ${sourceProfile.mcVersion}; launching the original profile unchanged.`);
          emitLog(sourceProfile.name, 'warn', `Automatic Sodium profile unavailable: ${reason}`, sourceProfile.id);
          profile = sourceProfile;
          launchProfileId = sourceProfile.id;
        }
      }
    }
    if (profile.optimizationManaged && profile.optimizationKind === 'sodium') {
      const sodium = profile.mods.find(item => item.id === 'sodium');
      const sodiumPath = sodium && sodium.enabled !== false
        ? resolveInstalledContentPath(profile, sodium, false)
        : null;
      if (!sodiumPath) {
        const optimizationSource = launcherState.profiles.find(item => item.id === profile.optimizationSourceProfileId);
        if (!optimizationSource) throw new Error('Sodium is missing or disabled, and the original source profile is unavailable.');
        emitLog(profile.name, 'warn', 'Sodium is missing or disabled; the original source profile will launch unchanged.', profile.id);
        profile = optimizationSource;
        launchProfileId = profile.id;
      }
    }
    if (profile.optimizationManaged && !profile.optimizationWorldSetupComplete) {
      const optimizationSource = launcherState.profiles.find(item => item.id === profile.optimizationSourceProfileId);
      if (!optimizationSource) throw new Error('The source profile for this isolated optimization profile no longer exists.');
      await prepareManagedWorlds(profile, optimizationSource);
    }
    if (runningProcesses.has(profile.id)) throw new Error(`${profile.name} is already running`);
    if (!prewarming) {
      profile.lastUsedAt = Date.now();
      scheduleStateWrite();
    }

    const memoryMax = settings.memoryMaxAuto
      ? recommendMinecraftMemoryGb(os.totalmem(), os.freemem(), ['sodium', 'oneclient'].includes(profile.optimizationKind))
      : Math.min(32, Math.max(1, Number(settings.memoryMax) || 6));
    const minecraftRoot = getMinecraftRootFor(profile.id);
    fs.mkdirSync(minecraftRoot, { recursive: true });
    const profileRootStat = fs.lstatSync(minecraftRoot);
    if (!profileRootStat.isDirectory() || profileRootStat.isSymbolicLink()) {
      throw new Error('The profile folder must be a real directory before reconciling the Bald Client mod.');
    }
    const modsDirectory = path.join(minecraftRoot, 'mods');
    if (fs.existsSync(modsDirectory)) {
      const modsDirectoryStat = fs.lstatSync(modsDirectory);
      if (!modsDirectoryStat.isDirectory() || modsDirectoryStat.isSymbolicLink()) {
        throw new Error('The profile mods folder must be a real directory before reconciling the Bald Client mod.');
      }
    }
    ensureLauncherGameFolders(minecraftRoot);
    const vanillaPerformanceBackup = path.join(
      app.getPath('userData'),
      'performance-backups',
      `${crypto.createHash('sha256').update(profile.id).digest('hex').slice(0, 24)}.json`,
    );
    const vanillaPerformanceResult = setVanillaPerformancePreset({
      enabled: settings.vanillaPerformancePresetEnabled,
      optionsPath: path.join(minecraftRoot, 'options.txt'),
      backupPath: vanillaPerformanceBackup,
    });
    if (vanillaPerformanceResult.changed) {
      emitLog(profile.name, 'info', vanillaPerformanceResult.enabled
        ? 'Applied the reversible vanilla FPS video preset (no performance mods added).'
        : 'Restored saved video options where they were not changed in Minecraft.', profile.id);
    }
    const baldMenuSettings = normalizeBaldMenuSettings(settings);
    let baldMenuModInstalled = false;
    const baldMenuSupported = isSupportedBaldMenuTarget(profile);
    const modPath = app.isPackaged
      ? path.join(process.resourcesPath, 'baldlauncher', 'bald-launcher-client.jar')
      : path.join(__dirname, 'minecraft-mod', 'build', 'libs', 'bald-launcher-client-0.1.0.jar');
    if (baldMenuSettings.minecraftClientModEnabled && baldMenuSupported) {
      if (!fs.existsSync(modPath)) {
        throw new Error('The Bald in-game menu mod is missing. Rebuild Bald Launcher with its Minecraft mod target.');
      }
    }
    const modReconciliation = reconcileBaldMenuMod({
      enabled: baldMenuSettings.minecraftClientModEnabled,
      supportedTarget: baldMenuSupported,
      sourceJar: baldMenuSettings.minecraftClientModEnabled && baldMenuSupported ? modPath : undefined,
      modsDirectory,
    });
    baldMenuModInstalled = modReconciliation.installed;
    if (baldMenuModInstalled) {
      emitLog(profile.name, 'info', 'Bald Client is enabled for Fabric 1.21.11.', profile.id);
    } else {
      if (modReconciliation.removed) {
        emitLog(profile.name, 'info', 'Removed only Bald Launcher’s managed client mod; it will not load on this launch.', profile.id);
      }
      if (!baldMenuSettings.minecraftClientModEnabled) {
        emitLog(profile.name, 'info', 'Bald Client is disabled for this profile. This applies to this launch; an already-running Minecraft process cannot unload mods.', profile.id);
      } else if (!baldMenuSupported) {
        emitLog(profile.name, 'info', 'Bald Client currently supports Fabric 1.21.11 only; this profile will launch without the managed Bald Client mod.', profile.id);
      }
    }
    const sharedCacheRoot = getSharedCacheRoot();
    fs.mkdirSync(path.join(sharedCacheRoot, 'assets'), { recursive: true });
    fs.mkdirSync(path.join(sharedCacheRoot, 'libraries'), { recursive: true });
    const loaderLibraryPaths = getLoaderLibraryPaths(profile.loader, minecraftRoot, sharedCacheRoot);
    fs.mkdirSync(loaderLibraryPaths.libraryRoot, { recursive: true });
    launcherState.sessions = launcherState.sessions.filter(session => session.profileId !== profile.id);
    const session = { profileId: profile.id, profileName: profile.name, pid: null, running: !prewarming, stopRequested: false, logs: [] };
    launcherState.sessions.push(session);
    scheduleStateWrite();
    emitLog(profile.name, 'normal', `${prewarming ? 'Prewarming' : 'Starting'} ${profile.mcVersion} with ${profile.loader}`, profile.id);
    if (!prewarming) emitStatus(`Preparing ${profile.mcVersion} (${profile.loader}, ${profile.rendererMode}) for ${account.name}...`);
    emitLog(profile.name, 'normal', 'Authenticating account...', profile.id);
    const authorization = await getLaunchAuthorization(account);
    if (profile.rendererMode !== 'vanilla' && !['fabric', 'quilt'].includes(profile.loader)) {
      emitStatus(`Warning: ${profile.rendererMode} requires a Fabric or Quilt loader profile`);
    }
    emitLog(profile.name, 'normal', 'Checking Minecraft and loader metadata...', profile.id);
    const versionNumber = await installLoader(profile);
    emitLog(profile.name, 'normal', `Loader profile ready: ${versionNumber}`, profile.id);
    if (!prewarming) emitStatus(`Preparing ${profile.mcVersion} (${profile.loader}, ${profile.rendererMode}) · resolving game files...`);
    emitLog(profile.name, 'info', `RAM maximum: ${memoryMax} GB (initial heap: ${prewarming ? '512 MB' : '1 GB'})`, profile.id);

    const profileLauncher = new MCLC.Client();
    profileLauncher.on('debug', message => emitLog(profile.name, classifyLogLine(message), message, profile.id));
    profileLauncher.on('progress', progress => {
      const label = progress?.type || 'download';
      const current = Number(progress?.task || 0);
      const total = Number(progress?.total || 0);
      emitStatus(`Preparing ${profile.mcVersion} (${profile.loader}, ${profile.rendererMode}) · ${label} ${current}/${total || '?'}`);
    });
    profileLauncher.on('download-status', progress => {
      if (!progress?.name) return;
      const current = Number(progress.current || 0);
      const total = Number(progress.total || 0);
      emitStatus(`Preparing ${profile.mcVersion} (${profile.loader}, ${profile.rendererMode}) · ${progress.type || 'download'} ${progress.name} ${total ? `${Math.round((current / total) * 100)}%` : ''}`);
    });
    profileLauncher.on('data', line => emitLog(profile.name, classifyLogLine(line), line, profile.id));
    let profileLaunchArguments = [];
    profileLauncher.on('arguments', args => {
      profileLaunchArguments = redactLaunchArguments(args);
      emitLog(profile.name, 'info', `Final launch command: java ${profileLaunchArguments.join(' ')}`, profile.id);
    });
    const javaExecutable = await resolveJavaForMinecraft(profile.mcVersion, profile.javaPath);
    const javaMajor = parseJavaMajorVersion(javaExecutable);
    const jvmArguments = getJvmArguments(settings, javaMajor);
    if (settings.jvmProfile === 'zgc' && javaMajor < 21) {
      emitLog(profile.name, 'warn', `ZGC generational mode requires Java 21 or newer; using the Java ${javaMajor || 'default'} garbage collector.`, profile.id);
    }
    const loaderJvmArguments = getLoaderJvmArguments(
      path.join(minecraftRoot, 'versions', versionNumber, `${versionNumber}.json`),
      {
        libraryDirectory: loaderLibraryPaths.libraryDirectory,
        nativesDirectory: path.join(minecraftRoot, 'natives'),
        versionName: versionNumber,
      },
    );
    const baldMenuJvmArguments = [];
    if (baldMenuModInstalled) {
      baldMenuBridge = await createBaldMenuBridge({
        profileId: profile.id,
        accounts: launcherState.accounts,
        onAction: emitBaldMenuAction,
      });
      const runtimeDirectory = path.join(app.getPath('userData'), 'bald-menu-runtime');
      fs.mkdirSync(runtimeDirectory, { recursive: true });
      baldMenuConfigPath = path.join(runtimeDirectory, `${crypto.randomUUID()}.json`);
      const baldMenuConfig = buildBaldMenuConfig({
        profileId: profile.id,
        settings: baldMenuSettings,
        activeAccountId: account.id,
        accounts: launcherState.accounts,
        bridge: baldMenuBridge,
      });
      fs.writeFileSync(baldMenuConfigPath, JSON.stringify(baldMenuConfig), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
      baldMenuJvmArguments.push(`-Dbaldlauncher.config=${baldMenuConfigPath}`);
    }
    const agentEnabled = libLaunch && await libLaunch.isEnabled(profile.id);
    if (agentEnabled) {
      try {
        libSession = await libLaunch.prepare(profile, profile.loader);
        emitLog(profile.name, 'info',
          `[Bald Agent] Prepared ${profile.loader} agent; passing -javaagent to Minecraft.`, profile.id);
      } catch (error) {
        if (error.code !== 'LIB_ARTIFACT_MISSING') throw error;
        emitLog(profile.name, 'warn', `${error.message} Launching without the library agent.`, profile.id);
      }
    } else {
      emitLog(profile.name, 'warn', '[Bald Agent] Not enabled for this profile; Minecraft will launch without it.', profile.id);
    }
    if (prewarming) {
      const currentProfile = launcherState.profiles.find(item => item.id === profile.id);
      if (!currentProfile || currentProfile.prewarmEnabled !== true || horizonPrewarmShutdownRequested) {
        session.running = false;
        scheduleStateWrite();
        return { ok: false, skipped: true, error: 'Prewarm was disabled before Minecraft started.' };
      }
      javaPrewarmWindowController = createHorizonWindowController();
      await javaPrewarmWindowController.ready;
      releaseJavaPrewarmCover = acquireHorizonPrewarmCover();
    }
    const child = await profileLauncher.launch({
      root: minecraftRoot,
      version: versionNumber === profile.mcVersion
        ? { number: profile.mcVersion, type: 'release' }
        : { number: profile.mcVersion, type: 'custom', custom: versionNumber },
      memory: { min: prewarming ? '512M' : '1G', max: `${Math.min(32, Math.max(1, memoryMax))}G` },
      javaPath: javaExecutable,
      customArgs: [...jvmArguments, ...loaderJvmArguments, ...baldMenuJvmArguments, ...(libSession ? libSession.args : [])],
      authorization,
      overrides: {
        gameDirectory: minecraftRoot,
        assetRoot: path.join(sharedCacheRoot, 'assets'),
        libraryRoot: loaderLibraryPaths.libraryRoot,
        maxSockets: Math.min(16, Math.max(8, os.cpus().length)),
        assetConcurrency: Math.min(24, Math.max(8, os.cpus().length)),
        assetValidationCachePath: path.join(app.getPath('userData'), 'minecraft-asset-validation-cache.json'),
        natives: path.join(minecraftRoot, 'natives'),
      },
    });
    javaPrewarmChild = child || null;

    if (child) {
      const prewarmState = prewarming ? {
        child,
        profile,
        session,
        windowController: javaPrewarmWindowController,
        releaseWindowCover: releaseJavaPrewarmCover,
        prewarming: true,
        activated: false,
        accountName: account.name,
        versionNumber,
      } : null;
      if (prewarmState) javaPrewarmedProcesses.set(profile.id, prewarmState);
      runningProcesses.set(profile.id, {
        child,
        pid: child.pid,
        profile,
        javaPath: javaExecutable,
        javaMajor,
        launchArguments: profileLaunchArguments,
        jvmArguments,
        memoryMaxGb: memoryMax,
        versionNumber,
        baldMenuBridge,
        baldMenuConfigPath,
        prewarming,
      });
      session.pid = prewarming ? null : child.pid || null;
      session.running = !prewarming;
      if (prewarming) {
        try {
          os.setPriority(child.pid, os.constants.priority.PRIORITY_BELOW_NORMAL);
        } catch (error) {
          console.warn(`[Prewarm] Could not lower process priority for ${profile.name}:`, error.message);
        }
      } else {
        startProfilePlaytimeTracking(profile, session);
      }
      scheduleStateWrite();
      emitLog(profile.name, 'info', `Java ${getRequiredJavaVersion(profile.mcVersion)}: ${javaExecutable}`, profile.id);
      emitLog(profile.name, 'info', `JVM arguments: ${jvmArguments.join(' ') || 'Java defaults'}`, profile.id);
      if (!prewarming) {
        emitProcessState(true, profile, child.pid);
        emitStatus(`Running · ${profile.name} · ${account.name}`);
        activateMinecraftWindow(child.pid, profile.name);
      }
      child.stdout?.on('data', data => String(data).split(/\r?\n/).forEach(line => emitLog(profile.name, 'normal', line, profile.id)));
      child.stderr?.on('data', data => String(data).split(/\r?\n/).forEach(line => emitLog(profile.name, 'warn', line, profile.id)));
      child.on('exit', (code, signal) => {
        const prewarmState = javaPrewarmedProcesses.get(profile.id);
        const backgroundPrewarmExit = Boolean(prewarmState && !prewarmState.activated);
        if (!backgroundPrewarmExit) stopProfilePlaytimeTracking(profile.id);
        if (prewarmState?.child === child) {
          javaPrewarmedProcesses.delete(profile.id);
          prewarmState.releaseWindowCover?.();
          void prewarmState.windowController?.close().catch(error => {
            console.warn(`[Prewarm] Could not stop Java window controller for ${profile.name}:`, error.message);
          });
          if (prewarmState.activated && profile.prewarmEnabled === true && !horizonPrewarmShutdownRequested) {
            setTimeout(() => {
              if (!horizonPrewarmShutdownRequested && profile.prewarmEnabled === true) {
                requestJavaProfilePrewarm(profile.id);
              }
            }, 500);
          }
        }
        if (baldMenuBridge) {
          baldMenuBridge.close().catch(error => console.error('[Bald Menu] Could not close the local bridge:', error));
          baldMenuBridge = null;
        }
        if (baldMenuConfigPath) {
          try {
            fs.unlinkSync(baldMenuConfigPath);
          } catch (error) {
            if (error.code !== 'ENOENT') console.error('[Bald Menu] Could not remove temporary menu configuration:', error);
          }
          baldMenuConfigPath = null;
        }
        if (libSession) { libSession.cleanup(); libSession = null; }
        runningProcesses.delete(profile.id);
        session.running = false;
        session.pid = null;
        session.exitCode = code ?? null;
        session.exitSignal = signal || null;
        const launchFailed = !session.stopRequested && (code !== 0 || Boolean(signal));
        session.crashAnalysis = launchFailed ? analyzeMinecraftFailure(profile, session, code ?? null) : null;
        if (code === 0 && profile.optimizationManaged && profile.optimizationRollbackFiles.length) {
          try {
            fs.rmSync(path.join(getMinecraftRootFor(profile.id), 'optimization-rollback'), { recursive: true, force: true });
            profile.optimizationRollbackFiles = [];
          } catch (error) {
            console.error(`Could not clear verified optimization rollback files for ${profile.id}:`, error);
          }
        }
        scheduleStateWrite();
        if (!backgroundPrewarmExit) {
          emitProcessState(false, profile, child.pid, {
            exitCode: code,
            exitSignal: signal || null,
            launchFailed,
            optimizationManaged: profile.optimizationManaged,
            optimizationSourceProfileId: profile.optimizationSourceProfileId,
          });
        }
        const exitSummary = code === null ? `signal ${signal || 'unknown'}` : `code ${code}`;
        emitLog(profile.name, launchFailed ? 'err' : 'info', `Minecraft exited with ${exitSummary}`, profile.id);
        if (!backgroundPrewarmExit) emitStatus(`Minecraft exited with ${exitSummary}`);
      });
      if (prewarming) {
        const hidden = await javaPrewarmWindowController.control(child.pid, 'hide-process', {
          timeoutMs: 30_000,
          waitForWindow: true,
        });
        if (!hidden.windows) throw new Error('Minecraft did not create a window to keep prewarmed.');
        if (child.exitCode !== null) throw new Error('Minecraft exited before its prewarm completed.');
        try {
          const limited = await javaPrewarmWindowController.control(child.pid, 'limit-process-tree', {
            timeoutMs: 8_000,
            waitForWindow: false,
          });
          if (!limited.windows) console.warn(`[Prewarm] Could not apply the CPU limit to Minecraft for ${profile.name}.`);
        } catch (error) {
          console.warn(`[Prewarm] Could not cap background CPU use for ${profile.name}:`, error.message);
        }
        javaPrewarmReady = true;
        console.info(`[Prewarm] Java profile ${profile.name} is ready in the background.`);
        emitStatus(`Prewarm complete: Java profile ${profile.name} is ready.`);
        releaseJavaPrewarmCover();
        releaseJavaPrewarmCover = () => {};
      }
    }

    if (!child) {
      session.running = false;
      scheduleStateWrite();
      throw new Error('Minecraft did not start. Open this profile\'s Logs tab for the MCLC failure details.');
    }

    return { ok: true, profileId: profile.id, profileName: profile.name, version: versionNumber, accountName: account.name, pid: child?.pid || null };
  } catch (error) {
    if (baldMenuBridge) {
      await baldMenuBridge.close().catch(closeError => console.error('[Bald Menu] Could not close the local bridge after launch failure:', closeError));
    }
    if (baldMenuConfigPath) {
      try {
        fs.unlinkSync(baldMenuConfigPath);
      } catch (cleanupError) {
        if (cleanupError.code !== 'ENOENT') console.error('[Bald Menu] Could not remove temporary menu configuration:', cleanupError);
      }
    }
    if (libSession) { libSession.cleanup(); libSession = null; }
    const message = error instanceof Error ? error.message : String(error);
    const failedSession = launchProfileId && getSession(launchProfileId);
    if (failedSession && !runningProcesses.has(launchProfileId)) {
      failedSession.running = false;
      failedSession.pid = null;
      scheduleStateWrite();
    }
    const failedProfile = launcherState.profiles.find(item => item.id === launchProfileId) || getActiveProfile();
    if (prewarming) {
      const messageIsAuthFailure = error?.code === 'MINECRAFT_SESSION_REFRESH_FAILED'
        || /^(?:No account selected|Microsoft account .* is not linked|Could not refresh the Minecraft session)/i.test(message);
      console.warn(`[Prewarm] ${messageIsAuthFailure ? 'Paused' : 'Skipped'} Java profile ${failedProfile?.name || launchProfileId || 'unknown'}: ${message}`);
      return {
        ok: false,
        skipped: true,
        code: messageIsAuthFailure ? 'PREWARM_AUTH_FAILED' : 'PREWARM_FAILED',
        profileId: launchProfileId,
        error: message,
      };
    }
    if (failedProfile) emitLog(failedProfile.name, 'err', `Launch failed: ${message}`, failedProfile.id);
    emitStatus(`Launch failed · ${message}`);
    return { ok: false, canceled: error?.code === 'WORLD_SETUP_CANCELED', profileId: launchProfileId, error: message };
  } finally {
    if (prewarming && !javaPrewarmReady) {
      if (javaPrewarmedProcesses.get(String(requestedProfileId || ''))?.child === javaPrewarmChild) {
        javaPrewarmedProcesses.delete(String(requestedProfileId || ''));
      }
      if (javaPrewarmChild && javaPrewarmChild.exitCode === null && !javaPrewarmChild.killed) {
        javaPrewarmChild.kill();
      }
      if (launchProfileId) {
        runningProcesses.delete(launchProfileId);
        const session = getSession(launchProfileId);
        if (session) {
          session.running = false;
          session.pid = null;
          session.stopRequested = true;
          scheduleStateWrite();
        }
      }
      releaseJavaPrewarmCover();
      await javaPrewarmWindowController?.close().catch(error => {
        console.warn('[Prewarm] Could not stop Java window controller after an incomplete warm-up:', error.message);
      });
    }
  }
}

ipcMain.handle('launcher:launch', async (_event, payload) => {
  const profileId = String(payload?.profileId || '');
  if (payload?.prewarming === true) {
    const existing = javaPrewarmTasks.get(profileId);
    if (existing) return existing;
    const task = launchJavaProfile(payload);
    javaPrewarmTasks.set(profileId, task);
    try {
      return await task;
    } finally {
      if (javaPrewarmTasks.get(profileId) === task) javaPrewarmTasks.delete(profileId);
    }
  }
  const pendingPrewarm = javaPrewarmTasks.get(profileId);
  if (pendingPrewarm) {
    const warmState = javaPrewarmedProcesses.get(profileId);
    if (warmState?.prewarming && Number.isSafeInteger(warmState.child.pid)) {
      try {
        os.setPriority(warmState.child.pid, os.constants.priority.PRIORITY_NORMAL);
      } catch (error) {
        console.warn(`[Prewarm] Could not prioritize the requested Java profile ${profileId}:`, error.message);
      }
    }
    await pendingPrewarm;
  }
  return launchJavaProfile(payload);
});

ipcMain.handle('launcher:stop-prewarm', async (_event, payload = {}) => {
  const profileId = String(payload?.profileId || '');
  const pending = javaPrewarmTasks.get(profileId);
  if (pending) await pending;
  return stopJavaPrewarmedProfile(profileId);
});

ipcMain.handle('launcher:stop', async (_event, payload) => {
  const profileId = payload?.profileId;
  const processRecord = runningProcesses.get(profileId);
  const session = getSession(profileId);
  const child = processRecord?.child;
  const profile = launcherState.profiles.find(item => item.id === profileId);
  if (!child && !session?.pid) return { ok: true, running: false };
  emitStatus('Closing Minecraft safely...');
  emitLog(profile?.name || 'Profile', 'normal', 'Stop requested; allowing Minecraft to save and close...', profileId);
  const pid = child?.pid || session?.pid;
  if (session) session.stopRequested = true;
  try {
    if (child && !child.killed) child.kill('SIGTERM');
    await new Promise(resolve => {
      let settled = false;
      const finish = () => { if (!settled) { settled = true; resolve(); } };
      if (child) child.once('exit', finish);
      setTimeout(() => {
        if (settled) return;
        if (process.platform === 'win32') {
          execFile('taskkill', ['/PID', String(pid), '/T', '/F'], () => finish());
        } else if (child && !child.killed) {
          child.kill('SIGKILL');
          finish();
        } else {
          finish();
        }
      }, 750);
    });
  } catch (error) {
    console.error('Failed to stop Minecraft:', error);
  }
  runningProcesses.delete(profileId);
  stopProfilePlaytimeTracking(profileId);
  if (session) { session.running = false; session.pid = null; scheduleStateWrite(); }
  emitLauncherStateChanged();
  emitProcessState(false, profile, pid);
  emitStatus('Ready');
  return { ok: true, running: false };
});

function restoreRunningSessions() {
  for (const session of launcherState.sessions) {
    if (!session.running || !session.pid) continue;
    try {
      process.kill(Number(session.pid), 0);
      const profile = launcherState.profiles.find(item => item.id === session.profileId);
      if (profile) startProfilePlaytimeTracking(profile, session, Date.now());
    } catch {
      stopProfilePlaytimeTracking(session.profileId);
      session.running = false;
      session.pid = null;
    }
  }
  scheduleStateWrite();
}

app.whenReady().then(async () => {
  stateFilePath = getStateFilePath();
  launcherState = readStateFromDisk();
  const assignedRoots = new Map();
  let repairedServerAssignments = false;
  const serversByAge = [...launcherState.servers]
    .sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0))
  for (const server of serversByAge) {
    const root = path.isAbsolute(server.rootPath || '') ? path.normalize(server.rootPath) : '';
    if (root) {
      const key = root.toLowerCase();
      if (!assignedRoots.has(key)) assignedRoots.set(key, server.id);
      else {
        repairedServerAssignments = true;
        server.rootPath = '';
        server.jarFileName = '';
        server.status = 'idle';
        server.playerCount = 0;
      }
    }
  }
  if (repairedServerAssignments) scheduleStateWrite();
  reconcilePersistedServerProcesses();
  restoreRunningSessions();
  reconcileProfileFolders();
  watchProfileFolders();
  createWindow();
  if (app.isPackaged) {
    const installDirectory = path.dirname(app.getPath('exe'));
    autoUpdater.disableDifferentialDownload = true;
    if (configureUpdaterFeed(autoUpdater, {
      isPackaged: true,
      resourcesPath: process.resourcesPath,
      installDirectory,
    })) {
      console.warn('[Updater] app-update.yml is missing; using the configured GitHub release feed.');
    }
    console.info('[Updater] Update installer will replace the running installation at:', autoUpdater.installDirectory);
    autoUpdater.on('update-available', info => {
      launcherUpdateStatus = { state: 'available', version: info.version };
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('launcher:update-available', { version: info.version });
    });
    autoUpdater.on('update-not-available', info => {
      launcherUpdateStatus = { state: 'current', version: info?.version || app.getVersion() };
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('launcher:update-not-available', launcherUpdateStatus);
    });
    autoUpdater.on('update-downloaded', info => {
      const version = info?.version || launcherUpdateStatus.version;
      launcherUpdateStatus = { state: 'downloaded', ...(version ? { version } : {}) };
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('launcher:update-ready', { version });
    });
    autoUpdater.on('download-progress', info => {
      const version = info?.version || launcherUpdateStatus.version;
      launcherUpdateStatus = {
        state: 'downloading',
        percent: Number(info.percent || 0),
        ...(version ? { version } : {}),
      };
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('launcher:update-progress', {
        percent: Number(info.percent || 0),
        transferred: Number(info.transferred || 0),
        total: Number(info.total || 0),
        bytesPerSecond: Number(info.bytesPerSecond || 0),
        version,
      });
    });
    autoUpdater.on('error', error => {
      const message = error instanceof Error ? error.message : String(error);
      launcherUpdateStatus = { state: 'error', message };
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('launcher:update-error', { message });
    });
    launcherUpdateStatus = { state: 'checking' };
    updateCheckPromise = autoUpdater.checkForUpdatesAndNotify()
      .catch(error => {
        const message = error instanceof Error ? error.message : String(error);
        launcherUpdateStatus = { state: 'error', message };
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('launcher:update-error', { message });
        console.warn('[Updater] update check failed:', message);
      })
      .finally(() => { updateCheckPromise = null; });
  }
  mainWindow.webContents.once('did-finish-load', () => {
    for (const session of launcherState.sessions.filter(item => item.running && item.pid)) {
      const profile = launcherState.profiles.find(item => item.id === session.profileId);
      if (profile) emitProcessState(true, profile, session.pid);
    }
  });
  watchLauncherFile();
  const profile = getActiveProfile();
  if (profile && profile.rendererMode !== 'vanilla' && (!['fabric', 'quilt'].includes(profile.loader)
    || !getLoaderVersionId(profile, profile.mcVersion, profile.loader, profile.loaderVersion))) {
    mainWindow.webContents.once('did-finish-load', () => emitStatus(`Warning: ${profile.rendererMode} is selected but ${profile.loader} is not installed yet`));
  }
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}).catch(error => {
  reportStartupFailure(error, 'app startup');
  app.quit();
});

let quittingAfterManagedShutdown = false;
let managedShutdownPending = false;

app.on('before-quit', event => {
  launcherStateStore.clearWriteTimer();
  if (writeStatePending) flushStateWrite();
  horizonPrewarmShutdownRequested = true;
  if (quittingAfterManagedShutdown) return;
  const playitState = playitManager.state();
  const keepPlayitRunning = playitState.pid
    && launcherState.settings?.playitKeepRunningOnClose === true
    && playitState.persistent;
  if (keepPlayitRunning) {
    playitManager.detach();
  }
  const shouldStopPlayit = Boolean(playitState.pid) && !keepPlayitRunning;
  const shouldStopHorizonPrewarm = [...horizonPrewarmedProcesses.values()]
    .some(state => !state.child.killed && state.child.exitCode === null);
  const shouldStopJavaPrewarm = [...javaPrewarmedProcesses.values()]
    .some(state => state.prewarming && !state.child.killed && state.child.exitCode === null);
  if (!shouldStopPlayit && !shouldStopHorizonPrewarm && !shouldStopJavaPrewarm) return;
  event.preventDefault();
  if (managedShutdownPending) return;
  managedShutdownPending = true;
  void (async () => {
    if (shouldStopPlayit) {
      try {
        const result = await playitManager.stop();
        if (!result.ok) {
          emitStatus(`Playit did not stop cleanly; the launcher is closing anyway. ${result.error || ''}`.trim());
          console.warn('[Shutdown] Playit did not stop cleanly; continuing launcher shutdown:', result.error || 'unknown error');
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        emitStatus(`Unable to stop Playit cleanly; the launcher is closing anyway. ${message}`);
        console.warn('[Shutdown] Unable to stop Playit cleanly; continuing launcher shutdown:', message);
      }
    }
    if (shouldStopHorizonPrewarm) await stopHorizonPrewarmedProcesses();
    if (shouldStopJavaPrewarm) await stopJavaPrewarmedProfiles();
    managedShutdownPending = false;
    quittingAfterManagedShutdown = true;
    app.quit();
  })();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
