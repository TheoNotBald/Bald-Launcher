const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const { execFile, execFileSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const axios = require('axios');
const AdmZip = require('adm-zip');
const pidusage = require('pidusage');
const MCLC = require('minecraft-launcher-core');
const { autoUpdater } = require('electron-updater');
const { createPlayitManager } = require('./playit-manager');
const { createStateStore } = require('./src/shared/state-store');

app.commandLine.appendSwitch('disable-features', 'DIPS');

const htmlPath = path.join(__dirname, 'bald_launcher_v7.html');
const launcher = new MCLC.Client();
let mainWindow;
let reloadTimer;
let stateFilePath;
let writeStatePending = false;
const contentSearchCache = new Map();
const CONTENT_SEARCH_CACHE_TTL_MS = 5 * 60 * 1000;
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
const SODIUM_BUNDLE = ['lithium', 'ferrite-core', 'immediatelyfast', 'modernfix', 'entityculling', 'moreculling'];

function createSodiumDatabaseEntry(mcVersion) {
  return {
    status: 'recommended',
    label: 'Sodium',
    project: 'sodium',
    optimizationMods: SODIUM_BUNDLE,
    dependencies: ['fabric-api'],
    excludedMods: ['vulkanmod', 'not-enough-vulkan', 'entityculling', 'moreculling', 'immediatelyfast', 'modernfix', 'noisium', 'particle-core'],
    compatibility: Object.fromEntries(['sodium', ...SODIUM_BUNDLE].map(project => [project, 'SUPPORTED'])),
    mcVersion,
  };
}

function getRendererDatabaseEntry(mcVersion, loader, renderer) {
  const normalizedLoader = String(loader || '').toLowerCase();
  const exact = RENDERER_DATABASE[`${mcVersion}:${normalizedLoader}:${renderer}`]
    || (mcVersion.startsWith('26.1') ? RENDERER_DATABASE[`26.1.1:${normalizedLoader}:${renderer}`] : null)
    || (mcVersion.startsWith('26.2') ? RENDERER_DATABASE[`26.2:${normalizedLoader}:${renderer}`] : null);
  if (exact) return exact;
  if (renderer === 'sodium' && mcVersion.startsWith('1.21') && ['fabric', 'quilt', 'neoforge'].includes(normalizedLoader)) {
    return createSodiumDatabaseEntry(mcVersion);
  }
  return null;
}

function getVulkanDatabaseEntry(mcVersion, loader) {
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
  if (versionManifestCache && now - versionManifestFetchedAt < VERSION_CACHE_TTL_MS) return normalizeVersionList(versionManifestCache);
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
      options.push({ id: 'sodium', label: 'Sodium', note: 'Wide mod/shader compatibility' });
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
  sodium: ['Sodium', 'Lithium', 'FerriteCore', 'ImmediatelyFast', 'ModernFix', 'EntityCulling', 'MoreCulling'],
  'sodium-native-vulkan': ['Sodium', 'Lithium', 'FerriteCore', 'ImmediatelyFast', 'ModernFix', 'EntityCulling', 'MoreCulling'],
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
  Sodium: 'sodium',
  Embeddium: 'embeddium',
};

const OPTIONAL_RENDERER_RECOMMENDATIONS = new Set(['EntityCulling', 'MoreCulling']);


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
    },
  ],
  activeProfileId: 'default',
  settings: {
    memoryMax: 6,
    resolution: '1920×1080',
    fpsCap: 'Unlimited',
    renderDistance: 12,
    simulationDistance: 8,
    performancePreset: 'balanced-pvp',
    jvmProfile: 'default',
    customJvmArgs: '',
    processPriority: 'normal',
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
};

let launcherState = cloneDefaultState();
const launcherStateStore = createStateStore({
  getStateFilePath: () => getStateFilePath(),
  initialState: launcherState,
  normalizeState: rawState => {
    if (!rawState || typeof rawState !== 'object') return cloneDefaultState();
    if (rawState && Array.isArray(rawState.profiles) && rawState.profiles.length) {
      return {
        accounts: Array.isArray(rawState.accounts) && rawState.accounts.length ? rawState.accounts.map(normalizeAccount) : DEFAULT_STATE.accounts.map(normalizeAccount),
        activeAccountId: rawState.activeAccountId || DEFAULT_STATE.activeAccountId,
        profiles: rawState.profiles,
        activeProfileId: rawState.activeProfileId || rawState.profiles[0].id,
        settings: normalizeSettings(rawState.settings),
        sessions: Array.isArray(rawState.sessions) ? rawState.sessions : [],
        servers: Array.isArray(rawState.servers) ? rawState.servers.map(normalizeServer) : [],
        themes: rawState.themes || DEFAULT_STATE.themes,
        activeThemeId: rawState.activeThemeId || DEFAULT_STATE.activeThemeId,
      };
    }
    return cloneDefaultState();
  },
  onPersistError: error => console.error('State persistence error:', error),
});
const runningProcesses = new Map();
const serverProcesses = new Map();
const serverStartedAt = new Map();
const serverTpsSamples = new Map();
const tpsPollState = new Map();
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
    'server.jar',
    'minecraft_server.jar',
    'paperclip.jar',
    'fabric-server-launch.jar',
    'quilt-server-launch.jar',
    `${type}.jar`,
  ];
}

function getServerTpsCommand(server) {
  const type = String(server?.serverType || '').toLowerCase();
  const installed = [
    ...(Array.isArray(server?.mods) ? server.mods : []),
    ...(Array.isArray(server?.content) ? server.content : []),
    ...(Array.isArray(server?.installedContent) ? server.installedContent : []),
  ];
  const profile = server?.profileId ? launcherState.profiles.find(item => item.id === server.profileId) : null;
  if (profile?.mods) installed.push(...profile.mods);
  const hasSparkEntry = installed.some(item => {
    const identity = `${item?.id || ''} ${item?.slug || ''} ${item?.name || ''}`.toLowerCase();
    return identity.includes('spark');
  });
  let hasSparkFile = false;
  try {
    for (const folder of ['plugins', 'mods']) {
      const folderPath = path.join(getServerRoot(server.id), folder);
      if (fs.existsSync(folderPath) && fs.readdirSync(folderPath).some(name => /spark/i.test(name))) {
        hasSparkFile = true;
        break;
      }
    }
  } catch (_error) {}
  if (type === 'purpur' || hasSparkEntry || hasSparkFile) return 'spark tps';
  if (['paper', 'folia', 'spigot', 'bukkit'].includes(type)) return 'tps';
  if (type === 'forge') return 'forge tps';
  if (type === 'neoforge') return 'neoforge tps';
  const reporter = installed.find(item => {
    const identity = `${item?.id || ''} ${item?.slug || ''} ${item?.name || ''}`.toLowerCase();
    return identity.includes('fabric-tps') || identity.includes('fabric_tps');
  });
  if (reporter) return 'tps';
  return null;
}

function parseServerTpsOutput(line) {
  const text = stripAnsi(String(line || ''));
  const match = text.match(/\bTPS\b.*?:\s*([0-9]+(?:\.[0-9]+)?)/i)
    || text.match(/\bTPS\b\s*[:=]?\s*([0-9]+(?:\.[0-9]+)?)/i);
  return match ? Number(match[1]) : null;
}

function stripAnsi(value) {
  return String(value || '').replace(/[\u001b\u009b]\[[0-?]*[ -\/]*[@-~]/g, '');
}

function recordServerTpsOutput(serverId, line) {
  const value = parseServerTpsOutput(line);
  if (value != null) serverTpsSamples.set(serverId, { value, recordedAt: Date.now() });
}

function isTpsTelemetryLine(line) {
  const text = stripAnsi(line).trim();
  return parseServerTpsOutput(text) != null || /^(?:>|\s*)\/?(?:spark\s+tps|tps|forge tps|neoforge tps)\s*$/i.test(text);
}

function isTpsPollLine(line) {
  const text = stripAnsi(line).trim();
  return isTpsTelemetryLine(text) || /^(?:>|\s*)\/?(?:spark\s+)?tps\b/i.test(text);
}

function handleServerProcessOutput(serverId, type, chunk) {
  const lines = String(chunk || '').split(/\r?\n/).filter(Boolean);
  const state = tpsPollState.get(serverId);
  for (const line of lines) {
    recordServerTpsOutput(serverId, line);
    if (state && Date.now() < state.suppressUntil) {
      state.buffer.push(line);
      continue;
    }
    emitServerConsole(serverId, type, line);
  }
}
let lastLaunchArguments = [];

function cloneDefaultState() {
  return {
    accounts: DEFAULT_STATE.accounts.map(normalizeAccount),
    activeAccountId: DEFAULT_STATE.activeAccountId,
    profiles: DEFAULT_STATE.profiles.map(p => ({ ...p, mods: [...p.mods] })),
    activeProfileId: DEFAULT_STATE.activeProfileId,
    settings: { ...DEFAULT_STATE.settings },
    sessions: [],
    servers: Array.isArray(DEFAULT_STATE.servers) ? DEFAULT_STATE.servers.map(normalizeServer) : [],
  };
}

function getMinecraftRootFor(profileId) {
  return path.join(app.getPath('userData'), 'profiles', profileId);
}

const BALD_PROFILE_SCHEMA_VERSION = 1;

function createProfileId() {
  return `profile-${crypto.randomUUID()}`;
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
  const root = getMinecraftRootFor(profile.id);
  const latestLogPath = path.join(root, 'logs', 'latest.log');
  const crashRoot = path.join(root, 'crash-reports');
  const crashFiles = fs.existsSync(crashRoot)
    ? fs.readdirSync(crashRoot).filter(file => file.endsWith('.txt')).sort().reverse()
    : [];
  const crashPath = crashFiles[0] ? path.join(crashRoot, crashFiles[0]) : null;
  const latestLog = readTextIfPresent(latestLogPath);
  const crashReport = crashPath ? readTextIfPresent(crashPath) : '';
  const launcherLog = (session?.logs || []).map(entry => entry.line || '').join('\n');
  const combined = `${crashReport}\n${latestLog}\n${launcherLog}`;
  const evidence = [];
  const findings = [];
  const addFinding = (cause, confidence, text, fix, kind = 'problem') => findings.push({ cause, confidence, evidence: text, suggestedFix: fix, kind });

  if (/requires .* but .* is missing|missing (?:dependency|required mod)|could not find required mod|no such dependency/i.test(combined)) {
    const match = combined.match(/(?:requires|missing|required mod)[: ]+([^\n.]+)/i);
    const text = match ? match[0].trim() : 'The log reports a missing required dependency.';
    evidence.push(text); addFinding('Missing mod dependency', 96, text, 'Install the required dependency for this Minecraft version and loader.');
  }
  if (/MixinApplyError|mixin .* failed|failed to apply mixin|org\.spongepowered\.asm\.mixin/i.test(combined)) {
    const lines = combined.split(/\r?\n/).filter(line => /mixin/i.test(line)).slice(0, 3).join(' ');
    evidence.push(lines); addFinding('Incompatible mod or mixin failure', 91, lines || 'A mixin failed during startup.', 'Disable the named mod or update it and its dependencies for this Minecraft version.');
  }
  if (/unsupported class file major version|class file version|java version|requires java [0-9]+|not a valid java runtime/i.test(combined)) {
    const text = combined.split(/\r?\n/).find(line => /java|class file/i.test(line)) || 'The Java runtime rejected the game or loader.';
    evidence.push(text); addFinding('Java version problem', 94, text, 'Select a compatible Java installation for this Minecraft version.');
  }
  if (/OutOfMemoryError|could not reserve enough space|unable to create native thread|Java heap space/i.test(combined)) {
    const text = combined.split(/\r?\n/).find(line => /memory|heap|reserve|thread/i.test(line)) || 'The Java process ran out of memory.';
    evidence.push(text); addFinding('Insufficient memory allocation', 95, text, 'Increase the profile RAM allocation or reduce memory-heavy mods and settings.');
  }
  if (/OpenGL|GLFW|LWJGL|Vulkan|graphics driver|NoSuchMethodError.*render/i.test(combined)) {
    const text = combined.split(/\r?\n/).find(line => /OpenGL|GLFW|LWJGL|Vulkan|driver/i.test(line)) || 'The log contains graphics initialization errors.';
    evidence.push(text); addFinding('Graphics driver or renderer problem', 82, text, 'Update the graphics driver or switch this profile to a compatible renderer.');
  }
  if (/NoSuchFileException|FileNotFoundException|Could not find .*\.jar|corrupt|zip END header not found|Invalid or corrupt jarfile/i.test(combined)) {
    const text = combined.split(/\r?\n/).find(line => /FileNotFound|corrupt|jar|NoSuchFile/i.test(line)) || 'A required game file could not be read.';
    evidence.push(text); addFinding('Corrupted or missing game file', 88, text, 'Use the profile folder and reinstall the affected mod or repair the Minecraft files.');
  }
  const modFiles = fs.existsSync(path.join(root, 'mods')) ? fs.readdirSync(path.join(root, 'mods')).filter(file => /\.jar(?:\.disabled)?$/i.test(file)) : [];
  const duplicateNames = modFiles.map(file => file.replace(/\.disabled$/i, '').replace(/[-_ ]?(?:fabric|forge|neoforge|quilt)?[-_ ]?\d.*$/i, '').toLowerCase()).filter((name, index, list) => name && list.indexOf(name) !== index);
  if (duplicateNames.length) addFinding('Duplicate mod files', 86, `Duplicate-looking mod names: ${[...new Set(duplicateNames)].join(', ')}`, 'Remove duplicate copies from the profile mods folder.');
  if (!findings.length && exitCode !== 0) addFinding('Minecraft process failure', 45, `Minecraft exited with code ${exitCode ?? 'unknown'} and no specific rule matched the available logs.`, 'Open the latest log and crash report, then review recently changed mods.', 'warning');
  return {
    crashed: exitCode !== null && exitCode !== 0,
    exitCode,
    profileId: profile.id,
    profileName: profile.name,
    crashReportPath: crashPath,
    latestLogPath: fs.existsSync(latestLogPath) ? latestLogPath : null,
    findings,
    evidence,
    analyzedAt: new Date().toISOString(),
  };
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

function getServerRoot(serverId) {
  return path.join(app.getPath('userData'), 'servers', String(serverId || 'unknown'));
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
  if (fs.existsSync(targetPath)) return { ok: true, fileName };

  const version = String(server.mcVersion || '1.21.1');

  if (type === 'fabric') {
    try {
      const loaderList = await axios.get(`https://meta.fabricmc.net/v2/versions/loader/${version}`, { timeout: 30000, headers: { 'User-Agent': 'Mozilla/5.0' } });
      const stable = (loaderList.data || []).find(item => item?.stable) || (loaderList.data || [])[0];
      if (stable?.loader?.version) {
        const jarUrl = `https://meta.fabricmc.net/v2/versions/loader/${version}/${stable.loader.version}/server/jar`;
        const jarResponse = await axios.get(jarUrl, { timeout: 120000, responseType: 'arraybuffer', headers: { 'User-Agent': 'Mozilla/5.0' } });
        fs.writeFileSync(targetPath, Buffer.from(jarResponse.data));
        return { ok: true, fileName };
      }
    } catch (_error) {
      // Fall through to vanilla as a last resort.
    }
  }

  if (type === 'quilt') {
    try {
      const loaderList = await axios.get(`https://meta.quiltmc.org/v3/versions/loader/${version}`, { timeout: 30000, headers: { 'User-Agent': 'Mozilla/5.0' } });
      const stable = (loaderList.data || []).find(item => item?.stable) || (loaderList.data || [])[0];
      const loaderVersion = stable?.loader?.version || stable?.version || stable?.id;
      if (loaderVersion) {
        const jarUrl = `https://meta.quiltmc.org/v3/versions/loader/${version}/${loaderVersion}/server/jar`;
        const jarResponse = await axios.get(jarUrl, { timeout: 120000, responseType: 'arraybuffer', headers: { 'User-Agent': 'Mozilla/5.0' } });
        fs.writeFileSync(targetPath, Buffer.from(jarResponse.data));
        return { ok: true, fileName };
      }
    } catch (_error) {
      // Fall through to vanilla as a last resort.
    }
  }

  if (['paper', 'folia', 'velocity', 'waterfall'].includes(type)) {
    try {
      const projectMap = {
        paper: 'paper',
        folia: 'folia',
        velocity: 'velocity',
        waterfall: 'waterfall',
      };
      const project = projectMap[type];
      const response = await axios.get(`https://fill.papermc.io/v3/projects/${project}/versions/${version}/builds`, { timeout: 30000, headers: { 'User-Agent': 'Mozilla/5.0' } });
      const builds = Array.isArray(response.data?.builds) ? response.data.builds : [];
      const preferred = [...builds].reverse().find(item => String(item?.channel || '').toUpperCase() === 'STABLE') || builds[builds.length - 1];
      const downloadUrl = preferred?.downloads?.['server:default']?.url || preferred?.downloads?.['server']?.url || preferred?.downloads?.server?.url || null;
      if (downloadUrl) {
        const jarResponse = await axios.get(downloadUrl, { timeout: 120000, responseType: 'arraybuffer', headers: { 'User-Agent': 'Mozilla/5.0' } });
        fs.writeFileSync(targetPath, Buffer.from(jarResponse.data));
        return { ok: true, fileName };
      }
    } catch (_error) {
      // Keep falling back to legacy endpoints if needed.
    }
  }

  if (type === 'purpur') {
    try {
      const downloadUrl = `https://api.purpurmc.org/v2/purpur/${version}/latest/download`;
      const jarResponse = await axios.get(downloadUrl, { timeout: 120000, responseType: 'arraybuffer', headers: { 'User-Agent': 'Mozilla/5.0' } });
      fs.writeFileSync(targetPath, Buffer.from(jarResponse.data));
      return { ok: true, fileName };
    } catch (_error) {
      // Fall through to vanilla as a last resort.
    }
  }

  if (type === 'bungeecord') {
    try {
      const downloadUrl = 'https://ci.md-5.net/job/BungeeCord/lastSuccessfulBuild/artifact/bootstrap/target/BungeeCord.jar';
      const jarResponse = await axios.get(downloadUrl, { timeout: 120000, responseType: 'arraybuffer', headers: { 'User-Agent': 'Mozilla/5.0' } });
      fs.writeFileSync(targetPath, Buffer.from(jarResponse.data));
      return { ok: true, fileName };
    } catch (_error) {
      // Fall through to vanilla as a last resort.
    }
  }

  if (type === 'waterfall') {
    try {
      const response = await axios.get(`https://api.papermc.io/v2/projects/waterfall/versions/${version}/builds`, { timeout: 30000, headers: { 'User-Agent': 'Mozilla/5.0' } });
      const builds = Array.isArray(response.data?.builds) ? response.data.builds : [];
      const latestBuild = builds[builds.length - 1];
      const downloadName = latestBuild?.downloads?.application?.name || latestBuild?.downloads?.server?.name || null;
      const downloadUrl = downloadName ? `https://api.papermc.io/v2/projects/waterfall/versions/${version}/builds/${latestBuild.build}/downloads/${downloadName}` : null;
      if (downloadUrl) {
        const jarResponse = await axios.get(downloadUrl, { timeout: 120000, responseType: 'arraybuffer', headers: { 'User-Agent': 'Mozilla/5.0' } });
        fs.writeFileSync(targetPath, Buffer.from(jarResponse.data));
        return { ok: true, fileName };
      }
    } catch (_error) {
      // Fall through to vanilla as a last resort.
    }
  }

  if (type === 'vanilla') {
    try {
      await downloadVanillaServerJar(version, targetPath);
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
  const memoryMax = Math.min(32, Math.max(2, Number(server?.memoryMax) || 4));
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
  const address = normalizeServerAddress(server?.address);
  return {
    id,
    name: name.slice(0, 32),
    mcVersion,
    loader,
    serverType,
    memoryMax,
    motd: String(server?.motd || 'Bald Launcher Server'),
    maxPlayers: Math.max(1, Number(server?.maxPlayers) || 20),
    difficulty,
    gamemode,
    forceGamemode: server?.forceGamemode === true,
    pvp: server?.pvp !== false,
    whitelist: server?.whitelist === true,
    viewDistance: Math.max(2, Number(server?.viewDistance) || 10),
    simulationDistance: Math.max(2, Number(server?.simulationDistance) || 10),
    autoRestart: server?.autoRestart === true,
    autoStart: server?.autoStart === true,
    javaArgs: String(server?.javaArgs || ''),
    javaPath: String(server?.javaPath || ''),
    eulaAccepted: server?.eulaAccepted === true,
    serverIconPath: String(server?.serverIconPath || ''),
    networkingMode,
    worldName: String(server?.worldName || 'world').trim() || 'world',
    status: ['idle', 'starting', 'running', 'stopping'].includes(String(server?.status || 'idle')) ? String(server.status) : 'idle',
    address,
    jarFileName: jarFileName || '',
    createdAt: Number(server?.createdAt || Date.now()),
    playerCount: Number(server?.playerCount || 0),
    schedules: scheduleList,
    retentionCount: Number(server?.retentionCount) > 0 ? Number(server.retentionCount) : 10,
  };
}

function ensureServerRoot(serverId) {
  const rootPath = getServerRoot(serverId);
  fs.mkdirSync(rootPath, { recursive: true });
  fs.mkdirSync(path.join(rootPath, 'backups'), { recursive: true });
  fs.mkdirSync(path.join(rootPath, 'world'), { recursive: true });
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
    fs.mkdirSync(path.join(rootPath, server.worldName || 'world', 'datapacks'), { recursive: true });
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

function emitProcessState(running, profile = null, pid = null) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('launcher:process-state', {
      running,
      profileId: profile?.id || null,
      profileName: profile?.name || null,
      pid,
    });
  }
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
  return {
    id: account?.id || `${type.toLowerCase()}-${Date.now()}`,
    name, type, initials, accent, fg,
    uuid: account?.uuid || (type === 'Offline' ? crypto.randomUUID() : null),
    auth: type === 'Microsoft' ? (account?.auth || null) : null,
    skinPath: account?.skinPath || null,
  };
}

function normalizeProfile(profile) {
  const requestedVersion = String(profile?.mcVersion || '').trim();
  const mcVersion = /^\d+\.\d+(?:\.\d+)?(?:[-+].*)?$/.test(requestedVersion) ? requestedVersion : COMMON_VERSIONS[0];
  const loader = LOADERS.includes(String(profile?.loader).toLowerCase()) ? String(profile.loader).toLowerCase() : 'fabric';
  const validRenderers = getRendererOptions(mcVersion, loader).map(o => o.id);
  const rendererMode = validRenderers.includes(profile?.rendererMode) ? profile.rendererMode : validRenderers[0];
  const name = String(profile?.name || '').trim().slice(0, 40) || 'New profile';
  return {
    id: profile?.id || `profile-${Date.now()}`,
    name,
    mcVersion,
    loader,
    rendererMode,
    icon: String(profile?.icon || name.slice(0, 1).toUpperCase()).slice(0, 2),
    javaPath: String(profile?.javaPath || '').trim(),
    memoryMax: Math.min(32, Math.max(1, Number(profile?.memoryMax) || DEFAULT_STATE.settings.memoryMax)),
    jvmProfile: ['default', 'zgc', 'custom'].includes(profile?.jvmProfile) ? profile.jvmProfile : 'default',
    customJvmArgs: String(profile?.customJvmArgs || ''),
    benchmarkHistory: Array.isArray(profile?.benchmarkHistory) ? profile.benchmarkHistory.slice(-30) : [],
    // Each entry is the installed content's own record, not just an id, so the
    // Content tab can render a real installed-library list (name/type/enabled)
    // without needing a live Modrinth lookup every time the profile opens.
    mods: Array.isArray(profile?.mods) ? profile.mods.map(normalizeInstalledContent) : [],
  };
}

function normalizeInstalledContent(entry) {
  const type = ['resourcepack', 'shader', 'datapack'].includes(entry?.type) ? entry.type : 'mod';
  return {
    id: String(entry?.id || `content-${Date.now()}`),
    name: String(entry?.name || 'Unknown content').slice(0, 80),
    type,
    iconUrl: entry?.iconUrl || null,
    author: String(entry?.author || '').slice(0, 160),
    description: String(entry?.description || entry?.desc || '').slice(0, 1000),
    minecraftVersion: String(entry?.minecraftVersion || '').slice(0, 32),
    loader: String(entry?.loader || '').slice(0, 32),
    projectUrl: String(entry?.projectUrl || '').slice(0, 500),
    fileName: String(entry?.fileName || '').replace(/[<>:"/\\|?*]+/g, '_').trim().slice(0, 240),
    source: entry?.source === 'curseforge' ? 'curseforge' : entry?.source === 'modrinth' ? 'modrinth' : '',
    enabled: entry?.enabled !== false,
    // Which renderer-mode bundle this came from (if any) — lets the
    // launcher clean up/swap the right mods when the mode changes later.
    // Manually-added content (via Add content) leaves this null.
    bundleFor: entry?.bundleFor || null,
  };
}

function contentIdentity(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function isContentInstalled(entries, candidate) {
  const candidateId = contentIdentity(candidate?.id);
  const candidateName = contentIdentity(candidate?.name);
  return (entries || []).some(entry => {
    const sameId = candidateId && contentIdentity(entry?.id) === candidateId;
    const sameName = candidateName && contentIdentity(entry?.name) === candidateName;
    return sameId || sameName;
  });
}

function hasInstalledContentFile(profile, entry) {
  return fs.existsSync(getInstalledFilePath(profile, entry.type, entry.name, false))
    || fs.existsSync(getInstalledFilePath(profile, entry.type, entry.name, true));
}

function normalizeSettings(settings) {
  return {
    memoryMax: Math.min(32, Math.max(1, Number(settings?.memoryMax) || DEFAULT_STATE.settings.memoryMax)),
    resolution: String(settings?.resolution || DEFAULT_STATE.settings.resolution),
    fpsCap: String(settings?.fpsCap || DEFAULT_STATE.settings.fpsCap),
    renderDistance: Number(settings?.renderDistance || DEFAULT_STATE.settings.renderDistance),
    simulationDistance: Number(settings?.simulationDistance || DEFAULT_STATE.settings.simulationDistance),
    performancePreset: ['max-fps-pvp', 'balanced-pvp', 'quality'].includes(settings?.performancePreset) ? settings.performancePreset : 'balanced-pvp',
    jvmProfile: ['default', 'zgc', 'custom'].includes(settings?.jvmProfile) ? settings.jvmProfile : 'default',
    customJvmArgs: String(settings?.customJvmArgs || ''),
    processPriority: settings?.processPriority === 'above-normal' ? 'above-normal' : 'normal',
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

function getJvmArguments(settings) {
  const tunedG1Args = [
    '-XX:+UseG1GC', '-XX:+ParallelRefProcEnabled', '-XX:MaxGCPauseMillis=130',
    '-XX:+UnlockExperimentalVMOptions', '-XX:+DisableExplicitGC',
    '-XX:G1NewSizePercent=30', '-XX:G1MaxNewSizePercent=40', '-XX:G1HeapRegionSize=8M',
    '-XX:G1ReservePercent=20', '-XX:G1HeapWastePercent=5', '-XX:G1MixedGCCountTarget=4',
    '-XX:InitiatingHeapOccupancyPercent=15', '-XX:G1MixedGCLiveThresholdPercent=90',
    '-XX:G1RSetUpdatingPauseTimePercent=5', '-XX:SurvivorRatio=32', '-XX:+PerfDisableSharedMem',
    '-XX:MaxTenuringThreshold=1',
  ];
  if (settings.jvmProfile === 'custom') return settings.customJvmArgs.trim().split(/\s+/).filter(Boolean);
  if (settings.jvmProfile === 'zgc') return ['-XX:+UseZGC', '-XX:+ZGenerational'];
  return tunedG1Args;
}

function parseJavaMajorVersion(javaExecutable) {
  try {
    const output = execFileSync(javaExecutable, ['-version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    const text = `${output || ''}`;
    const match = text.match(/version\s+"?(\d+)(?:\.\d+)?(?:\.\d+)?/i);
    return match ? Number(match[1]) : 0;
  } catch (_error) {
    return 0;
  }
}

async function getJavaPath(minimumVersion = 21) {
  const javaHome = process.env.JAVA_HOME;
  const candidate = javaHome && path.join(javaHome, 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
  if (candidate && fs.existsSync(candidate)) {
    const major = parseJavaMajorVersion(candidate);
    if (major >= minimumVersion) return candidate;
  }

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

  return new Promise(resolve => execFile(process.platform === 'win32' ? 'where.exe' : 'which', ['java'], (error, stdout) => {
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
      .sort((a, b) => b.version - a.version);

    resolve(ranked[0]?.path || javaCandidates.sort((a, b) => parseJavaMajorVersion(b) - parseJavaMajorVersion(a))[0] || 'java');
  }));
}

function setProcessPriority(child, priority) {
  if (process.platform !== 'win32' || priority !== 'above-normal' || !child?.pid) return;
  execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `$p=Get-Process -Id ${Number(child.pid)} -ErrorAction SilentlyContinue; if ($p) {$p.PriorityClass='AboveNormal'}`], () => {});
}

function getActiveAccount() {
  return launcherState.accounts.find(a => a.id === launcherState.activeAccountId) || launcherState.accounts[0] || null;
}

function getActiveProfile() {
  return launcherState.profiles.find(p => p.id === launcherState.activeProfileId) || launcherState.profiles[0] || null;
}

function getLoaderCachePath(profile, mcVersion, loader) {
  return path.join(getMinecraftRootFor(profile.id), 'versions', `.bald-${loader}-${mcVersion}.json`);
}

function getLoaderVersionId(profile, mcVersion, loader) {
  const cachePath = getLoaderCachePath(profile, mcVersion, loader);
  try {
    const cached = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    if (cached.versionId && fs.existsSync(path.join(getMinecraftRootFor(profile.id), 'versions', cached.versionId, `${cached.versionId}.json`))) {
      return cached.versionId;
    }
  } catch (_error) {
    // A missing or stale cache is repaired by the installer path.
  }
  return null;
}

async function downloadToFile(url, filePath, label) {
  const temporaryPath = `${filePath}.download`;
  const response = await axios.get(url, {
    responseType: 'stream',
    timeout: 30000,
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
    headers: { 'User-Agent': 'BaldLauncher/0.1.0 (contact: none)' },
  });
  const total = Number(response.headers['content-length']) || 0;
  let received = 0;
  const hash = crypto.createHash('sha1');
  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  try {
    await new Promise((resolve, reject) => {
      const output = fs.createWriteStream(temporaryPath);
      response.data.on('data', chunk => {
        received += chunk.length;
        hash.update(chunk);
        const progress = total ? ` ${Math.round((received / total) * 100)}%` : '';
        emitStatus(`Downloading ${label} · ${(received / 1048576).toFixed(1)} MB${total ? ` / ${(total / 1048576).toFixed(1)} MB` : ''}${progress}`);
      });
      response.data.on('error', reject);
      output.on('error', reject);
      output.on('finish', resolve);
      response.data.pipe(output);
    });
    fs.renameSync(temporaryPath, filePath);
    return hash.digest('hex');
  } catch (error) {
    if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
    throw error;
  }
}

async function resolveModrinthFile(projectId, mcVersion, loader) {
  if (!projectId) throw new Error('No Modrinth project id was provided');
  const query = new URLSearchParams({ game_versions: JSON.stringify([mcVersion]) });
  if (loader && loader !== 'vanilla') query.set('loaders', JSON.stringify([loader]));
  const response = await axios.get(`${MODRINTH_API}/project/${encodeURIComponent(projectId)}/version?${query}`, {
    timeout: 15000,
    headers: { 'User-Agent': 'BaldLauncher/0.1.0 (contact: none)' },
  });
  const version = response.data?.[0];
  const file = version?.files?.[0];
  if (!file?.url || !file?.hashes?.sha1) {
    throw new Error(`No compatible Modrinth file found for ${projectId}`);
  }
  return file;
}

async function installModrinthContent(profile, entry, filePath) {
  const file = await resolveModrinthFile(entry.id, profile.mcVersion, profile.loader);
  emitStatus(`Downloading ${entry.name}...`);
  const actualHash = await downloadToFile(file.url, filePath, entry.name);
  if (actualHash.toLowerCase() !== file.hashes.sha1.toLowerCase()) {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    throw new Error(`SHA-1 verification failed for ${entry.name}`);
  }
}

async function installServerModrinthContent(server, entry, filePath) {
  const loader = entry.type === 'datapack' ? null : String(server.serverType || server.loader || '').toLowerCase();
  const file = await resolveModrinthFile(entry.id, server.mcVersion, loader);
  emitStatus(`Downloading ${entry.name}...`);
  const actualHash = await downloadToFile(file.url, filePath, entry.name);
  if (actualHash.toLowerCase() !== file.hashes.sha1.toLowerCase()) {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    throw new Error(`SHA-1 verification failed for ${entry.name}`);
  }
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
  return new Promise((resolve, reject) => {
    const child = execFile(javaPath, ['-jar', installerPath, ...args], { cwd, windowsHide: true }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`${error.message}${stderr ? `: ${stderr.trim()}` : ''}`));
        return;
      }
      resolve(`${stdout || ''}${stderr || ''}`);
    });
    child.stdout?.on('data', data => emitStatus(String(data).trim().split(/\r?\n/).pop()));
    child.stderr?.on('data', data => emitStatus(String(data).trim().split(/\r?\n/).pop()));
  });
}

function findInstalledVersionId(rootPath, mcVersion, loader, before) {
  const versionsPath = path.join(rootPath, 'versions');
  const matchesLoader = name => loader === 'neoforge'
    ? name.toLowerCase().startsWith('neoforge-') || name.toLowerCase().startsWith(`${mcVersion}-neoforge-`)
    : loader === 'fabric'
      ? name.toLowerCase().startsWith(`fabric-loader-`) && name.toLowerCase().endsWith(`-${mcVersion}`)
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
  const cachedVersionId = getLoaderVersionId(profile, mcVersion, loader);
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
    loaderVersion = await getLoaderManifest(mcVersion, loader);
    installerUrl = loader === 'fabric'
      ? 'https://maven.fabricmc.net/net/fabricmc/fabric-installer/1.0.3/fabric-installer-1.0.3.jar'
      : 'https://maven.quiltmc.org/repository/release/org/quiltmc/quilt-installer/0.8.1/quilt-installer-0.8.1.jar';
    installerArgs = loader === 'fabric'
      ? ['client', '-dir', rootPath, '-mcversion', mcVersion, '-loader', loaderVersion, '-noprofile']
      : ['install', 'client', mcVersion, loaderVersion, '--dir', rootPath];
  } else {
    const metadataUrl = loader === 'forge'
      ? 'https://files.minecraftforge.net/net/minecraftforge/forge/maven-metadata.json'
      : 'https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml';
    const metadata = (await axios.get(metadataUrl, { timeout: 15000 })).data;
    if (loader === 'forge') {
      const versions = metadata?.versions || [];
      loaderVersion = versions.reverse().find(version => version.startsWith(`${mcVersion}-`));
      if (!loaderVersion) throw new Error(`No Forge version is available for Minecraft ${mcVersion}`);
      installerUrl = `https://maven.minecraftforge.net/net/minecraftforge/forge/${loaderVersion}/forge-${loaderVersion}-installer.jar`;
      installerArgs = ['--installClient', rootPath];
    } else {
      const versions = [...String(metadata).matchAll(/<version>([^<]+)<\/version>/g)].map(match => match[1]);
      const neoMinecraftLine = mcVersion.split('.').slice(1).join('.');
      loaderVersion = versions.reverse().find(version => version.startsWith(`${neoMinecraftLine}.`));
      if (!loaderVersion) throw new Error(`No NeoForge version is available for Minecraft ${mcVersion}`);
      installerUrl = `https://maven.neoforged.net/releases/net/neoforged/neoforge/${loaderVersion}/neoforge-${loaderVersion}-installer.jar`;
      installerArgs = ['--install-client', rootPath];
    }
  }

  const installerPath = path.join(rootPath, LOADER_INSTALLER_DIR, `${loader}-${loaderVersion}.jar`);
  if (!fs.existsSync(installerPath)) {
    emitStatus(`Downloading ${loader} installer...`);
    await downloadToFile(installerUrl, installerPath, `${loader} installer`);
  }
  emitStatus(`Installing ${loader} ${loaderVersion}...`);
  await runInstaller(javaPath, installerPath, installerArgs, rootPath);
  const versionId = findInstalledVersionId(rootPath, mcVersion, loader === 'neoforge' ? 'neoforge' : loader, before);
  if (!versionId) throw new Error(`${loader} installer completed but no launch profile was created`);
  fs.writeFileSync(getLoaderCachePath(profile, mcVersion, loader), JSON.stringify({ loaderVersion, versionId }, null, 2));
  return versionId;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1560,
    height: 900,
    minWidth: 1280,
    minHeight: 720,
    backgroundColor: '#0d0d0d',
    title: 'Bald Launcher',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.removeMenu();
  mainWindow.webContents.on('console-message', (_event, details) => {
    console.error(`[renderer:${details.level}] ${details.sourceId}:${details.lineNumber} ${details.message}`);
  });
  mainWindow.loadFile(htmlPath);
  mainWindow.once('ready-to-show', () => mainWindow.show());

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
    await downloadToFile(asset.browser_download_url, agentPath, 'Playit agent');
    if (process.platform !== 'win32') fs.chmodSync(agentPath, 0o755);
    return { ok: true, playit: playitManager.state() };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle('server:playit-start', async () => playitManager.start());
ipcMain.handle('server:playit-stop', async () => playitManager.stop());
ipcMain.handle('server:playit-restart', async () => playitManager.restart());
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

ipcMain.handle('launcher:apply-update', () => {
  if (!app.isPackaged) return { ok: false, error: 'Updates are available only in the packaged launcher.' };
  autoUpdater.quitAndInstall();
  return { ok: true };
});

ipcMain.handle('launcher:sync-state', async (_event, nextState) => {
  launcherState.settings = normalizeSettings(nextState?.settings || launcherState.settings);
  if (Array.isArray(nextState?.servers)) launcherState.servers = nextState.servers.map(normalizeServer);
  scheduleStateWrite();
  return launcherState;
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
    const authorization = token.mclc();
    const name = String(authorization.name || token.profile?.name || '').trim().slice(0, 16);
    if (!name) throw new Error('Microsoft login did not return a Minecraft username');
    const duplicateIndex = launcherState.accounts.findIndex(account => account.name.toLowerCase() === name.toLowerCase());
    if (duplicateIndex !== -1 && launcherState.accounts[duplicateIndex].auth) {
      throw new Error('An account with that name is already linked');
    }
    const account = normalizeAccount({
      name,
      type: 'Microsoft',
      uuid: authorization.uuid,
      auth: authorization,
      id: `microsoft-${authorization.uuid || Date.now()}`,
    });
    if (duplicateIndex === -1) launcherState.accounts.push(account);
    else launcherState.accounts[duplicateIndex] = { ...account, id: launcherState.accounts[duplicateIndex].id };
    launcherState.activeAccountId = account.id;
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

// Resolves the curated bundle's search terms into real Modrinth projects for
// the checklist modal — nothing is installed here, this is preview-only.
ipcMain.handle('launcher:preview-bundle', async (_event, { mcVersion, loader, rendererMode }) => {
  const terms = RENDERER_BUNDLES[rendererMode] || [];
  if (!terms.length) return { ok: true, items: [] };

  const items = [];
  for (const term of terms) {
    const slug = OPTIMIZATION_PROJECT_SLUGS[term];
    try {
      if (!slug) {
        items.push({ id: term, name: term, desc: 'Recommended for this renderer profile', type: 'mod', selected: true });
        continue;
      }

      const projectResponse = await axios.get(`${MODRINTH_API}/project/${slug}`, {
        headers: { 'User-Agent': 'BaldLauncher/0.1.0 (contact: none)' },
        timeout: 8000,
      });
      let file = null;
      try {
        file = await resolveModrinthFile(slug, mcVersion, loader);
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
          }
        : {
            id: slug,
            name: fallbackName,
            desc: 'Version lookup unavailable for this MC version/loader; still recommended for this renderer profile.',
            iconUrl: projectResponse?.data?.icon_url || null,
            type: 'mod',
            searchTerm: term,
            selected: !OPTIONAL_RENDERER_RECOMMENDATIONS.has(term),
            unresolved: false,
          };

      items.push(item);
    } catch (_error) {
      items.push({
        id: slug || term,
        name: term,
        desc: 'Lookup failed but this recommendation remains in the curated bundle.',
        type: 'mod',
        selected: !OPTIONAL_RENDERER_RECOMMENDATIONS.has(term),
        unresolved: false,
      });
    }
  }

  if (!items.length) {
    for (const term of terms) {
      items.push({ id: OPTIMIZATION_PROJECT_SLUGS[term] || term, name: term, desc: 'Recommended for this renderer profile', type: 'mod', selected: true });
    }
  }

  return { ok: true, items };
});

// Installs the checklist's confirmed selections, tagged so a later mode
// switch knows which installed items belong to this bundle.
ipcMain.handle('launcher:apply-bundle', async (_event, { items, rendererMode }) => {
  try {
    const profile = getActiveProfile();
    if (!profile) throw new Error('No active profile');
    const databaseEntry = rendererMode === 'vulkan'
      ? getVulkanDatabaseEntry(profile.mcVersion, profile.loader)
      : getRendererDatabaseEntry(profile.mcVersion, profile.loader, rendererMode);
    const fallbackProjects = (RENDERER_BUNDLES[rendererMode] || []).map(term => OPTIMIZATION_PROJECT_SLUGS[term]).filter(Boolean);
    const allowedProjects = new Set([
      ...(databaseEntry ? [databaseEntry.project, ...(databaseEntry.optimizationMods || [])] : []),
      ...fallbackProjects,
    ]);
    ensureLauncherGameFolders(getMinecraftRootFor(profile.id));

    const idx = launcherState.profiles.findIndex(p => p.id === profile.id);
    for (const item of items || []) {
      const itemId = String(item?.id || '');
      if (!allowedProjects.has(itemId)) continue;
      const entry = normalizeInstalledContent({ ...item, enabled: true, bundleFor: rendererMode });
      if (isContentInstalled(profile.mods, entry) || hasInstalledContentFile(profile, entry)) continue;
      const filePath = getInstalledFilePath(profile, entry.type, entry.name, false);
      await installModrinthContent(profile, entry, filePath);
      if (!launcherState.profiles[idx].mods.some(m => m.id === entry.id)) {
        launcherState.profiles[idx].mods.push(entry);
      }
    }
    scheduleStateWrite();
    return { ok: true, state: launcherState };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle('launcher:create-profile', async (_event, payload) => {
  const profile = normalizeProfile(payload);
  await ensureFabricApi(profile);
  launcherState.profiles.push(profile);
  launcherState.activeProfileId = profile.id;
  ensureLauncherGameFolders(getMinecraftRootFor(profile.id));
  scheduleStateWrite();
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
    const duplicate = normalizeProfile({ ...JSON.parse(JSON.stringify(source)), id: createProfileId(), name: duplicateName });
    const sourceRoot = getMinecraftRootFor(source.id);
    duplicateRoot = getMinecraftRootFor(duplicate.id);
    if (fs.existsSync(duplicateRoot)) throw new Error('A profile with this generated ID already exists.');
    if (fs.existsSync(sourceRoot)) fs.cpSync(sourceRoot, duplicateRoot, { recursive: true, errorOnExist: true });
    else ensureLauncherGameFolders(duplicateRoot);
    launcherState.profiles.push(duplicate);
    launcherState.activeProfileId = duplicate.id;
    scheduleStateWrite();
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
  if (profile.loader === 'fabric' || profile.loader === 'quilt') {
    try {
      const loaderResponse = await axios.get(`https://meta.${profile.loader}mc.net/v2/versions/loader/${encodeURIComponent(profile.mcVersion)}`, { timeout: 10000 });
      const loaderVersion = loaderResponse.data?.[0]?.loader?.version;
      if (loaderVersion) dependencies[`${profile.loader}-loader`] = loaderVersion;
    } catch (_error) {
      emitStatus(`Could not resolve ${profile.loader} loader metadata; exporting Minecraft dependency only.`);
    }
  }
  return dependencies;
}

ipcMain.handle('launcher:export-modpack', async (_event, payload) => {
  try {
    const profile = launcherState.profiles.find(item => item.id === payload?.profileId);
    if (!profile) throw new Error('Profile not found');
    const options = { mods: true, configs: true, resourcepacks: true, shaders: true, worlds: false, screenshots: false, ...(payload?.options || {}) };
    const root = getMinecraftRootFor(profile.id);
    const exportName = sanitizeFileName(payload?.name || profile.name) || 'Minecraft Pack';
    const version = String(payload?.version || '1.0.0').trim() || '1.0.0';
    const saveResult = await dialog.showSaveDialog({ title: 'Export Modpack', defaultPath: `${exportName}-${sanitizeFileName(version)}.mrpack`, filters: [{ name: 'Modrinth modpack', extensions: ['mrpack'] }] });
    if (saveResult.canceled || !saveResult.filePath) return { ok: false, canceled: true };
    emitStatus(`Preparing modpack ${exportName}...`);
    const zip = new AdmZip();
    const files = [];
    const warnings = [];
    if (options.mods) {
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
      for (const file of fs.readdirSync(folder, { withFileTypes: true })) {
        if (file.isFile()) zip.addLocalFile(path.join(folder, file.name), 'overrides', archiveFolder);
      }
    };
    copyFolder('config', options.configs, 'config');
    copyFolder('resourcepacks', options.resourcepacks, 'resourcepacks');
    copyFolder('shaderpacks', options.shaders, 'shaderpacks');
    copyFolder('screenshots', options.screenshots, 'screenshots');
    copyFolder('saves', options.worlds, 'saves');
    const manifest = { formatVersion: 1, game: 'minecraft', versionId: profile.mcVersion, name: exportName, summary: String(payload?.description || '').slice(0, 2000), files, dependencies: await getMrpackDependencies(profile) };
    zip.addFile('modrinth.index.json', Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'));
    zip.writeZip(saveResult.filePath);
    const validation = new AdmZip(saveResult.filePath).getEntry('modrinth.index.json');
    if (!validation) throw new Error('The exported archive did not contain modrinth.index.json.');
    emitStatus(`Modpack exported: ${path.basename(saveResult.filePath)}`);
    return { ok: true, path: saveResult.filePath, warnings, manifest };
  } catch (error) {
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

ipcMain.handle('launcher:export-profile', async (_event, profileId) => {
  try {
    const profile = launcherState.profiles.find(item => item.id === profileId);
    if (!profile) throw new Error('Profile not found');
    const result = await dialog.showSaveDialog({
      title: 'Export Bald profile',
      defaultPath: `${sanitizeFileName(profile.name)}.baldprofile`,
      filters: [{ name: 'Bald profile', extensions: ['baldprofile'] }],
    });
    if (result.canceled || !result.filePath) return { ok: false, canceled: true };
    const payload = {
      format: 'baldprofile',
      schemaVersion: BALD_PROFILE_SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      profile: JSON.parse(JSON.stringify(profile)),
      references: { profileRoot: 'profiles/<profile-id>', content: profile.mods.map(item => ({ id: item.id, name: item.name, source: item.source || null, fileName: item.fileName || null })) },
    };
    fs.writeFileSync(result.filePath, JSON.stringify(payload, null, 2), 'utf8');
    return { ok: true, path: result.filePath };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle('launcher:import-profile', async () => {
  try {
    const result = await dialog.showOpenDialog({ title: 'Import Bald profile', properties: ['openFile'], filters: [{ name: 'Bald profile', extensions: ['baldprofile'] }] });
    if (result.canceled || !result.filePaths[0]) return { ok: false, canceled: true };
    const imported = validateProfileExport(JSON.parse(fs.readFileSync(result.filePaths[0], 'utf8')));
    const originalName = imported.name;
    imported.id = createProfileId();
    imported.name = `${originalName} Import`;
    const root = getMinecraftRootFor(imported.id);
    if (fs.existsSync(root)) throw new Error('The imported profile destination already exists.');
    ensureLauncherGameFolders(root);
    launcherState.profiles.push(imported);
    launcherState.activeProfileId = imported.id;
    scheduleStateWrite();
    return { ok: true, state: launcherState, profile: imported };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error), state: launcherState };
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

  const previous = launcherState.profiles[idx];
  const updated = normalizeProfile({ ...previous, ...payload });
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
  await ensureFabricApi(updated);
  scheduleStateWrite();
  return { state: launcherState, rendererChanged, newRendererMode: rendererChanged ? updated.rendererMode : null };
});

ipcMain.handle('launcher:delete-profile', async (_event, payload) => {
  if (launcherState.profiles.length <= 1) {
    return { ok: false, error: 'At least one profile must exist', state: launcherState };
  }
  const profileId = typeof payload === 'string' ? payload : payload?.profileId;
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
    const installerUrl = `https://files.minecraftforge.net/maven/net/minecraftforge/forge/${version}-${version}/forge-${version}-installer.jar`;
    await downloadDirectWebsiteJar(installerUrl, installerPath);
    return await new Promise((resolve, reject) => {
      const child = spawn(process.platform === 'win32' ? 'java.exe' : 'java', ['-jar', installerPath, '--installServer'], { cwd: rootPath, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
      child.stdout.on('data', chunk => handleServerProcessOutput(server.id, 'info', chunk));
      child.stderr.on('data', chunk => handleServerProcessOutput(server.id, 'warn', chunk));
      child.on('close', code => {
        if (code === 0) {
          updateServerInState(server.id, { jarFileName: 'forge-server.jar' });
          resolve({ ok: true, fileName: 'forge-server.jar' });
        } else reject(new Error(`Forge installer exited with code ${code}`));
      });
      child.on('error', error => reject(error));
    });
  }

  if (type === 'neoforge') {
    const installerName = 'neoforge-installer.jar';
    const installerPath = path.join(rootPath, installerName);
    const installerUrl = `https://maven.neoforged.net/releases/net/neoforged/neoforge/${version}/neoforge-${version}-installer.jar`;
    await downloadDirectWebsiteJar(installerUrl, installerPath);
    return await new Promise((resolve, reject) => {
      const child = spawn(process.platform === 'win32' ? 'java.exe' : 'java', ['-jar', installerPath, '--installServer'], { cwd: rootPath, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
      child.stdout.on('data', chunk => handleServerProcessOutput(server.id, 'info', chunk));
      child.stderr.on('data', chunk => handleServerProcessOutput(server.id, 'warn', chunk));
      child.on('close', code => {
        if (code === 0) {
          updateServerInState(server.id, { jarFileName: 'server.jar' });
          resolve({ ok: true, fileName: 'server.jar' });
        } else reject(new Error(`NeoForge installer exited with code ${code}`));
      });
      child.on('error', error => reject(error));
    });
  }

  if (type === 'spigot' || type === 'bukkit') {
    const buildToolsPath = path.join(rootPath, 'BuildTools.jar');
    const buildToolsUrl = 'https://hub.spigotmc.org/jenkins/job/BuildTools/lastSuccessfulBuild/artifact/target/BuildTools.jar';
    await downloadDirectWebsiteJar(buildToolsUrl, buildToolsPath);
    return await new Promise((resolve, reject) => {
      const child = spawn(process.platform === 'win32' ? 'java.exe' : 'java', ['-jar', buildToolsPath, '--rev', version], { cwd: rootPath, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
      child.stdout.on('data', chunk => handleServerProcessOutput(server.id, 'info', chunk));
      child.stderr.on('data', chunk => handleServerProcessOutput(server.id, 'warn', chunk));
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

async function startServerProcess(server) {
  ensureServerTypeFolders(server);
  const rootPath = ensureServerRoot(server.id);
  const serverType = String(server?.serverType || 'paper').toLowerCase();
  if (server.networkingMode === 'playit') {
    const playitResult = playitManager.start();
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
  let foundJar = String(server?.jarFileName || '').trim();

  if (foundJar && !fs.existsSync(path.join(rootPath, foundJar))) {
    foundJar = '';
  }

  if (!foundJar) {
    foundJar = getServerJarCandidates(serverType).find(name => fs.existsSync(path.join(rootPath, name)))
      || fs.readdirSync(rootPath).find(name => name.toLowerCase().endsWith('.jar')) || null;
  }

  if (!foundJar) {
    if (isInstallerBuildServerType(serverType)) {
      try {
        emitServerConsole(server.id, 'info', `${serverType.toUpperCase()} requires its upstream installer/build step. Preparing the server now...`);
        const installResult = await installOrBuildServer(server);
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
      const jarDownload = await downloadServerJar(server);
      if (!jarDownload.ok) {
        fs.writeFileSync(path.join(rootPath, 'server.properties'), '# Generated by Bald Launcher\nserver-port=25565\n', 'utf8');
        fs.writeFileSync(path.join(rootPath, 'eula.txt'), 'eula=true\n', 'utf8');
        fs.mkdirSync(path.join(rootPath, 'logs'), { recursive: true });
        emitServerConsole(server.id, 'warn', jarDownload.error || 'No server JAR was available, and startup was aborted.');
        return { ok: false, error: jarDownload.error };
      }
      foundJar = jarDownload.fileName;
    }
  }

  server.jarFileName = foundJar;
  updateServerInState(server.id, { jarFileName: foundJar });

  const serverPropertiesPath = path.join(rootPath, 'server.properties');
  const eulaPath = path.join(rootPath, 'eula.txt');
  if (!fs.existsSync(serverPropertiesPath)) {
    fs.writeFileSync(serverPropertiesPath, '# Generated by Bald Launcher\nserver-port=25565\nmotd=Bald Launcher Server\n', 'utf8');
  }
  if (!fs.existsSync(eulaPath)) {
    fs.writeFileSync(eulaPath, 'eula=true\n', 'utf8');
  }
  fs.mkdirSync(path.join(rootPath, 'logs'), { recursive: true });

  const minimumJavaVersion = (() => {
    const major = Number(String(server?.mcVersion || '1.21.1').split('.')[0]);
    if (String(server?.mcVersion || '1.21.1').startsWith('26.') || String(server?.mcVersion || '1.21.1').startsWith('25.')) return 25;
    if (String(server?.mcVersion || '1.21.1').startsWith('24.') || String(server?.mcVersion || '1.21.1').startsWith('23.')) return 22;
    return major >= 26 ? 25 : 21;
  })();
  const javaPath = await getJavaPath(minimumJavaVersion);
  const jarPath = path.join(rootPath, foundJar);
  updateServerProperties(server);
  const javaExecutable = server.javaPath || javaPath;
  const customArgs = String(server.javaArgs || '').trim() ? String(server.javaArgs).trim().split(/\s+/) : [];
  const serverMemory = Math.max(2, Number(server.memoryMax) || 4);
  const processInfo = spawn(javaExecutable, [`-Xms${serverMemory}G`, `-Xmx${serverMemory}G`, ...customArgs, '-jar', jarPath, 'nogui'], {
    cwd: rootPath,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  serverProcesses.set(server.id, processInfo);
  serverStartedAt.set(server.id, Date.now());

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
    String(chunk).split(/\r?\n/).filter(Boolean).forEach(markServerReady);
    handleServerProcessOutput(server.id, 'info', chunk);
  });
  processInfo.stderr.on('data', chunk => {
    String(chunk).split(/\r?\n/).filter(Boolean).forEach(markServerReady);
    handleServerProcessOutput(server.id, 'warn', chunk);
  });
  processInfo.on('error', error => {
    serverProcesses.delete(server.id);
    const serverEntry = getServerById(server.id);
    const errorText = error instanceof Error ? error.message : String(error);
    if (serverEntry) {
      updateServerInState(server.id, { status: 'idle', playerCount: 0, address: serverEntry.address || '' });
      emitServerConsole(server.id, 'warn', `Failed to start server: ${errorText}`);
      emitStatus(`Server ${serverEntry.name} failed to start`);
    }
  });
  processInfo.on('exit', (code, signal) => {
    serverProcesses.delete(server.id);
    serverStartedAt.delete(server.id);
    const serverEntry = getServerById(server.id);
    if (serverEntry) {
      const nextStatus = serverEntry.status === 'stopping' ? 'idle' : 'idle';
      updateServerInState(server.id, { status: nextStatus, playerCount: 0, address: serverEntry.address || '' });
      emitServerConsole(server.id, 'info', `Server process exited with code ${code ?? 'unknown'}${signal ? ` (signal ${signal})` : ''}`);
      emitStatus(`Server ${serverEntry.name} stopped`);
      if (serverEntry.autoRestart && serverEntry.status !== 'stopping' && code !== 0) {
        setTimeout(() => {
          const current = getServerById(server.id);
          if (current && !serverProcesses.has(server.id)) startServerProcess(current).catch(error => emitServerConsole(server.id, 'warn', `Auto-restart failed: ${error.message}`));
        }, 2000);
      }
    }
  });
  updateServerInState(server.id, { status: 'starting', address: advertisedAddress });
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
    const server = normalizeServer({
      id: `server-${Date.now()}`,
      name,
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

ipcMain.handle('launcher:start-server', async (_event, payload) => {
  try {
    const serverId = payload?.serverId;
    const server = getServerById(serverId);
    if (!server) return { ok: false, error: 'Server not found' };
    if (serverProcesses.has(server.id)) return { ok: false, error: 'A server process is already active for this server' };
    if (server.status === 'starting' || server.status === 'running') {
      updateServerInState(server.id, { status: 'idle', playerCount: 0, address: server.address || '' });
    }
    if (!fs.existsSync(getServerRoot(server.id))) ensureServerRoot(server.id);
    const result = await startServerProcess(server);
    if (!result.ok) {
      updateServerInState(server.id, { status: 'idle' });
      return { ok: false, error: result.error };
    }
    return { ok: true, pid: result.pid, server: updateServerInState(server.id, { status: 'starting', address: server.address || '127.0.0.1:25565' }) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

function updateServerProperties(server) {
  const rootPath = ensureServerRoot(server.id);
  const propertiesPath = path.join(rootPath, 'server.properties');
  const existing = fs.existsSync(propertiesPath) ? fs.readFileSync(propertiesPath, 'utf8') : '';
  const values = {
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
    const nextLine = `${key}=${String(value)}`;
    const index = lines.findIndex(line => line.startsWith(`${key}=`));
    if (index >= 0) lines[index] = nextLine; else lines.push(nextLine);
  }
  fs.writeFileSync(propertiesPath, `${lines.join('\n')}\n`, 'utf8');
  if (server.eulaAccepted) fs.writeFileSync(path.join(rootPath, 'eula.txt'), 'eula=true\n', 'utf8');
}

ipcMain.handle('launcher:stop-server', async (_event, payload) => {
  try {
    const serverId = payload?.serverId;
    const server = getServerById(serverId);
    if (!server) return { ok: false, error: 'Server not found' };
    const processInfo = serverProcesses.get(serverId);
    if (!processInfo) {
      updateServerInState(serverId, { status: 'idle' });
      return { ok: true, server: getServerById(serverId) };
    }
    updateServerInState(serverId, { status: 'stopping' });
    emitServerConsole(serverId, 'info', 'Stop requested; saving world and shutting down...');
    processInfo.kill('SIGTERM');
    await new Promise(resolve => setTimeout(resolve, 4000));
    if (!serverProcesses.has(serverId)) return { ok: true, server: getServerById(serverId) };
    processInfo.kill('SIGKILL');
    await new Promise(resolve => setTimeout(resolve, 500));
    return { ok: true, server: getServerById(serverId) };
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

ipcMain.handle('server:backup', async (_event, payload) => {
  try {
    const serverId = payload?.serverId;
    const server = getServerById(serverId);
    if (!server) return { ok: false, error: 'Server not found' };
    const rootPath = ensureServerRoot(serverId);
    const backupRoot = path.join(rootPath, 'backups');
    fs.mkdirSync(backupRoot, { recursive: true });
    const customName = String(payload?.name || '').trim();
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const fileStem = customName ? customName.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || `backup-${stamp}` : `backup-${stamp}`;
    const archiveName = `${fileStem}.zip`;
    const archivePath = path.join(backupRoot, archiveName);
    const worldPath = path.join(rootPath, server.worldName || 'world');
    if (!fs.existsSync(worldPath)) fs.mkdirSync(worldPath, { recursive: true });
    await zipFolderToArchive(rootPath, archivePath, ['backups']);
    const backupEntry = { id: `backup-${Date.now()}`, name: archiveName, createdAt: Date.now(), size: fs.statSync(archivePath).size };
    const retentionCount = Number(server.retentionCount) > 0 ? Number(server.retentionCount) : 10;
    const existingBackups = fs.readdirSync(backupRoot).filter(file => file.toLowerCase().endsWith('.zip')).sort();
    if (existingBackups.length > retentionCount) {
      for (const fileName of existingBackups.slice(0, Math.max(0, existingBackups.length - retentionCount))) {
        fs.unlinkSync(path.join(backupRoot, fileName));
      }
    }
    writeServerBackupLog(serverId, `Created backup ${backupEntry.name}`);
    return { ok: true, backup: backupEntry };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

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
    const archiveName = payload?.archiveName || payload?.backupName || payload?.name;
    if (!archiveName) return { ok: false, error: 'No backup name supplied' };
    const archivePath = resolveServerScopedPath(serverId, path.join('backups', archiveName));
    const rootPath = ensureServerRoot(serverId);
    const worldPath = path.join(rootPath, server.worldName || 'world');
    const processInfo = serverProcesses.get(serverId);
    if (processInfo) {
      processInfo.kill('SIGTERM');
      await new Promise(resolve => setTimeout(resolve, 1500));
    }
    if (fs.existsSync(worldPath)) fs.rmSync(worldPath, { recursive: true, force: true });
    fs.mkdirSync(worldPath, { recursive: true });
    await unzipArchiveToFolder(archivePath, rootPath);
    return { ok: true };
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
  try {
    const serverId = payload?.serverId;
    const server = getServerById(serverId);
    const command = getServerTpsCommand(server);
    const processInfo = serverProcesses.get(serverId);
    if (!server || !command || !processInfo?.stdin || processInfo.killed) return { ok: true, tps: null };
    const activePoll = tpsPollState.get(serverId);
    if (activePoll?.inFlight) {
      const sample = serverTpsSamples.get(serverId);
      return { ok: true, tps: sample?.value ?? null, recordedAt: sample?.recordedAt ?? null };
    }
    const poll = { suppressUntil: Date.now() + 2000, buffer: [], inFlight: true };
    tpsPollState.set(serverId, poll);
    processInfo.stdin.write(`${command}\n`);
    await new Promise(resolve => setTimeout(resolve, 1500));
    const tpsValue = poll.buffer.map(parseServerTpsOutput).find(value => value != null);
    if (tpsValue != null) serverTpsSamples.set(serverId, { value: tpsValue, recordedAt: Date.now() });
    const sample = serverTpsSamples.get(serverId);
    tpsPollState.delete(serverId);
    return { ok: true, tps: sample?.value ?? null, recordedAt: sample?.recordedAt ?? null };
  } catch (error) {
    tpsPollState.delete(payload?.serverId);
    return { ok: true, tps: null };
  }
});

ipcMain.handle('server:get-memory', async (_event, payload) => {
  try {
    const serverId = payload?.serverId;
    const processInfo = serverProcesses.get(serverId);
    const server = getServerById(serverId);
    if (!processInfo || !processInfo.pid) return { ok: true, memoryMb: null, rssMb: null, cpuPercent: null, uptimeSeconds: null, diskFreeGb: null, diskTotalGb: null, networkAddress: server?.address || null, mspt: null };
    const stats = await pidusage(processInfo.pid);
    const root = ensureServerRoot(serverId);
    let disk = { freeGb: null, totalGb: null };
    if (fs.statfsSync) {
      try { const info = fs.statfsSync(root); disk = { freeGb: Number((info.bsize * info.bavail / 1073741824).toFixed(1)), totalGb: Number((info.bsize * info.blocks / 1073741824).toFixed(1)) }; } catch (_error) {}
    }
    return { ok: true, memoryMb: Number((stats.memory || 0) / (1024 * 1024)).toFixed(1), rssMb: Number((stats.memory || 0) / (1024 * 1024)).toFixed(1), cpuPercent: Number(stats.cpu || 0).toFixed(1), uptimeSeconds: Math.max(0, Math.floor((Date.now() - (serverStartedAt.get(serverId) || Date.now())) / 1000)), diskFreeGb: disk.freeGb, diskTotalGb: disk.totalGb, networkAddress: server?.address || null, mspt: null };
  } catch (error) {
    return { ok: true, memoryMb: 0, rssMb: 0 };
  }
});

function applyServerSchedule(server) {
  const serverId = server.id;
  const scheduled = Array.isArray(server.schedules) ? server.schedules : [];
  for (const schedule of scheduled) {
    if (!schedule.enabled) continue;
    if (schedule.nextRunAt && Number(schedule.nextRunAt) <= Date.now()) {
      if (schedule.type === 'start') {
        ipcMain.emit('launcher:start-server', { serverId });
      } else if (schedule.type === 'stop') {
        ipcMain.emit('launcher:stop-server', { serverId });
      } else if (schedule.type === 'backup') {
        ipcMain.emit('server:backup', { serverId, name: schedule.name || undefined });
      } else if (schedule.type === 'command') {
        const processInfo = serverProcesses.get(serverId);
        if (processInfo && processInfo.stdin) processInfo.stdin.write(`${String(schedule.command || '').trim()}\n`);
      }
      const intervalMs = schedule.type === 'command' && Number(schedule.intervalMinutes) ? Number(schedule.intervalMinutes) * 60 * 1000 : (Number(schedule.intervalMinutes) || 60) * 60 * 1000;
      schedule.nextRunAt = Date.now() + intervalMs;
    }
  }
}

setInterval(() => {
  for (const server of launcherState.servers || []) {
    applyServerSchedule(server);
  }
}, 30000);

ipcMain.handle('launcher:set-active-profile', async (_event, profileId) => {
  if (launcherState.profiles.some(p => p.id === profileId)) {
    launcherState.activeProfileId = profileId;
    scheduleStateWrite();
  }
  return launcherState;
});

// ---------------------------------------------------------------------------
// IPC: content (Modrinth search + install/remove into the active profile)
// ---------------------------------------------------------------------------
function getCurseForgeClassId(type) {
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
    slug,
    projectUrl: hit.links?.websiteUrl || `https://www.curseforge.com/minecraft/${curseForgePath}/${encodeURIComponent(slug)}`,
    source: 'curseforge',
    distributionAllowed: isCurseForgeDistributionAllowed(hit),
  };
}

function getServerContentRules(serverType) {
  const type = String(serverType || 'paper').toLowerCase();
  const config = SERVER_CONTENT_TYPES[type] || SERVER_CONTENT_TYPES.paper;
  return { allowed: config.projectTypes, loaders: config.loader ? [config.loader] : [], projectTypes: config.projectTypes };
}

ipcMain.handle('launcher:search-content', async (_event, { query, type, mcVersion, loader, page = 1, serverType, source = 'modrinth' }) => {
  const rawType = String(type || 'all').toLowerCase();
  const effectiveServerType = String(serverType || loader || '').toLowerCase();
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
      const curseForgeType = projectType || 'mod';
      const result = {
        ok: true,
        hits: (response.data?.data || []).map(hit => mapCurseForgeContent(hit, curseForgeType, loader)),
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
    }).filter(({ mappedType }) => !allowedProjectTypes || allowedProjectTypes.includes(mappedType)).slice(0, 20).map(({ hit, mappedType }) => ({
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
      projectUrl: `https://modrinth.com/${mappedType === 'mod' ? 'mod' : mappedType}/${encodeURIComponent(hit.slug)}`,
      source: 'modrinth',
    })));
  } catch (error) {
    console.error('[Modrinth] content search failed', error?.response?.status || '', error?.response?.data || error?.message || error);
    if (!getCurseForgeApiKey()) return { ok: false, error: error instanceof Error ? error.message : String(error) };
    emitStatus('Modrinth search unavailable; checking CurseForge...');
  }

  const curseForgeFallbackApiKey = getCurseForgeApiKey();
  if (curseForgeFallbackApiKey && !serverRules) {
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
        headers: { 'x-api-key': curseForgeFallbackApiKey, Accept: 'application/json', 'User-Agent': 'BaldLauncher/0.1.0' },
      });
      totalHits = Math.max(totalHits, Number(response.data?.pagination?.totalCount) || 0);
      hits.push(...(response.data?.data || []).map(hit => mapCurseForgeContent(hit, projectType || 'mod', loader)));
    } catch (error) {
      if (!hits.length) return { ok: false, error: error instanceof Error ? error.message : String(error) };
      emitStatus('CurseForge search unavailable; showing Modrinth results.');
    }
  }
  const result = { ok: true, hits, page: Number(page), totalHits, totalPages: Math.max(1, Math.ceil(totalHits / 20)), hasMore: offset + 20 < totalHits, source: hits.some(hit => hit.source === 'curseforge') ? 'mixed' : 'modrinth' };
  contentSearchCache.set(searchCacheKey, { result, expiresAt: Date.now() + CONTENT_SEARCH_CACHE_TTL_MS });
  return result;
});

function getInstalledFilePath(profile, type, name, disabled) {
  const minecraftRoot = getMinecraftRootFor(profile.id);
  const folderPath = getContentFolder(type, minecraftRoot);
  const extension = type === 'mod' ? '.jar' : '.zip';
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

ipcMain.handle('launcher:install-content', async (_event, payload) => {
  try {
    if (payload?.serverId) {
      const server = getServerById(payload.serverId);
      if (!server) throw new Error('Server not found');
      const rules = getServerContentRules(server.serverType);
      const entry = { id: String(payload.id || ''), name: String(payload.name || 'content'), type: String(payload.type || '') };
      if (!entry.id || !rules.allowed.includes(entry.type)) throw new Error('This content type is not supported by this server');
      const rootPath = ensureServerRoot(server.id);
      const extension = entry.type === 'plugin' || entry.type === 'mod' ? '.jar' : '.zip';
      const filePath = path.join(getServerContentFolder(server, entry.type, rootPath), `${sanitizeFileName(entry.name)}${extension}`);
      if (isContentInstalled(server.installedContent, entry) || fs.existsSync(filePath)) throw new Error(`${entry.name} is already installed on this server.`);
      if (payload?.source === 'curseforge') {
        const curseForgeApiKey = getCurseForgeApiKey();
        if (!curseForgeApiKey) throw new Error('Set CURSEFORGE_API_KEY in your user environment and restart Bald Launcher to install CurseForge content.');
        const projectResponse = await axios.get(`${CURSEFORGE_API}/mods/${encodeURIComponent(entry.id)}`, {
          timeout: 10000,
          headers: { 'x-api-key': curseForgeApiKey, Accept: 'application/json', 'User-Agent': 'BaldLauncher/0.1.0' },
        });
        if (!isCurseForgeDistributionAllowed(projectResponse.data?.data)) throw new Error('CurseForge does not permit third-party distribution of this project.');
        const filesResponse = await axios.get(`${CURSEFORGE_API}/mods/${encodeURIComponent(entry.id)}/files`, {
          params: { gameVersion: server.mcVersion, modLoaderType: entry.type === 'mod' ? getCurseForgeLoaderType(server.loader) : undefined, pageSize: 50 },
          timeout: 10000,
          headers: { 'x-api-key': curseForgeApiKey, Accept: 'application/json', 'User-Agent': 'BaldLauncher/0.1.0' },
        });
        const file = (filesResponse.data?.data || []).find(candidate => candidate.downloadUrl && isCurseForgeDistributionAllowed(candidate));
        if (!file?.downloadUrl) throw new Error('CurseForge did not provide a compatible downloadable file for this project.');
        await downloadToFile(file.downloadUrl, filePath, entry.name);
      } else {
        await installServerModrinthContent(server, entry, filePath);
      }
      return { ok: true, path: filePath, entry };
    }
    const profile = getActiveProfile();
    if (!profile) throw new Error('No active profile');
    const minecraftRoot = getMinecraftRootFor(profile.id);
    ensureLauncherGameFolders(minecraftRoot);

    const entry = normalizeInstalledContent({ ...payload, enabled: true });
    if (isContentInstalled(profile.mods, entry) || hasInstalledContentFile(profile, entry)) return { ok: false, error: `${entry.name} is already installed in this profile.` };
    if (profile.loader === 'vanilla' && entry.type === 'mod') {
      throw new Error('Mods require a mod loader; resource packs, shaders, and data packs are supported for vanilla profiles');
    }
    const filePath = getInstalledFilePath(profile, entry.type, entry.name, false);
    if (payload?.source === 'curseforge') {
      const curseForgeApiKey = getCurseForgeApiKey();
      if (!curseForgeApiKey) throw new Error('Set CURSEFORGE_API_KEY in your user environment and restart Bald Launcher to install CurseForge content.');
      const projectResponse = await axios.get(`${CURSEFORGE_API}/mods/${encodeURIComponent(entry.id)}`, {
        timeout: 10000,
        headers: { 'x-api-key': curseForgeApiKey, 'User-Agent': 'BaldLauncher/0.1.0' },
      });
      if (!isCurseForgeDistributionAllowed(projectResponse.data?.data)) throw new Error('CurseForge does not permit third-party distribution of this project.');
      const filesResponse = await axios.get(`${CURSEFORGE_API}/mods/${encodeURIComponent(entry.id)}/files`, {
        params: { gameVersion: profile.mcVersion, modLoaderType: entry.type === 'mod' ? getCurseForgeLoaderType(profile.loader) : undefined, pageSize: 50 },
        timeout: 10000,
        headers: { 'x-api-key': curseForgeApiKey, 'User-Agent': 'BaldLauncher/0.1.0' },
      });
      const file = (filesResponse.data?.data || []).find(candidate => candidate.downloadUrl && isCurseForgeDistributionAllowed(candidate));
      if (!file?.downloadUrl) throw new Error('CurseForge did not provide a compatible downloadable file for this project.');
      await downloadToFile(file.downloadUrl, filePath, entry.name);
    } else {
      await installModrinthContent(profile, entry, filePath);
    }

    const idx = launcherState.profiles.findIndex(p => p.id === profile.id);
    if (idx !== -1 && !launcherState.profiles[idx].mods.some(m => m.id === entry.id)) {
      launcherState.profiles[idx].mods.push(entry);
      scheduleStateWrite();
    }

    return { ok: true, path: filePath, entry };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle('launcher:remove-content', async (_event, payload) => {
  try {
    const profile = getActiveProfile();
    if (!profile) throw new Error('No active profile');
    const existing = profile.mods.find(m => m.id === payload?.id);
    if (existing) {
      for (const disabled of [false, true]) {
        const filePath = getInstalledFilePath(profile, existing.type, existing.name, disabled);
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
    const profile = getActiveProfile();
    if (!profile) throw new Error('No active profile');
    const idx = launcherState.profiles.findIndex(p => p.id === profile.id);
    if (idx === -1) throw new Error('Profile not found');
    const modIdx = launcherState.profiles[idx].mods.findIndex(m => m.id === payload?.id);
    if (modIdx === -1) throw new Error('Content not found in profile');

    const entry = launcherState.profiles[idx].mods[modIdx];
    const currentEnabled = entry.enabled !== false;
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
  const javaPath = await getJavaPath();
  const javaVersion = await new Promise(resolve => execFile(javaPath, ['-version'], (error, stdout, stderr) => resolve(error ? 'Unavailable' : `${stdout || ''}${stderr || ''}`.trim())));
  const gpu = await new Promise(resolve => {
    if (process.platform !== 'win32') return resolve('Unavailable');
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty Name'], (error, stdout) => resolve(error ? 'Unavailable' : stdout.trim()));
  });
  const profile = getActiveProfile();
  const profileRoot = profile ? getMinecraftRootFor(profile.id) : null;
  const disk = profileRoot && fs.statfsSync ? (() => { try { const info = fs.statfsSync(profileRoot); return { freeGB: Math.round((info.bsize * info.bavail) / 1073741824), totalGB: Math.round((info.bsize * info.blocks) / 1073741824) }; } catch (_error) { return null; } })() : null;
  const internet = await new Promise(resolve => { const request = require('https').get('https://api.modrinth.com/v2', { timeout: 4000 }, response => { response.resume(); resolve(response.statusCode >= 200 && response.statusCode < 500); }); request.on('error', () => resolve(false)); request.on('timeout', () => { request.destroy(); resolve(false); }); });
  return {
    cpu: os.cpus()[0]?.model || 'Unknown',
    logicalCores: os.cpus().length,
    memoryGB: Math.round(os.totalmem() / 1073741824),
    platform: `${process.platform} ${process.arch}`,
    javaPath,
    javaVersion,
    gpu,
    profile: profile?.name || null,
    minecraft: profile?.mcVersion || null,
    loader: profile?.loader || null,
    renderer: profile?.rendererMode || null,
    jvmArguments: getJvmArguments(normalizeSettings({ ...launcherState.settings, ...(profile || {}) })),
    launchArguments: lastLaunchArguments,
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
  const profile = launcherState.profiles.find(item => item.id === profileId) || getActiveProfile();
  if (!profile) return { ok: false, error: 'No profile selected.' };
  const session = getSession(profile.id);
  const report = analyzeMinecraftFailure(profile, session, session?.exitCode ?? null);
  if (session) { session.crashAnalysis = report; scheduleStateWrite(); }
  return { ok: true, report };
});

async function collectPerformanceSnapshot(profile) {
  const processRecord = runningProcesses.get(profile.id);
  let cpuPercent = null;
  let memoryMb = null;
  if (processRecord?.pid) {
    try {
      const stats = await pidusage(processRecord.pid);
      cpuPercent = Number(Number(stats.cpu || 0).toFixed(1));
      memoryMb = Number((Number(stats.memory || 0) / 1048576).toFixed(1));
    } catch (_error) {}
  }
  const diagnostics = await new Promise(resolve => {
    if (!mainWindow || mainWindow.isDestroyed()) return resolve({ gpu: 'Unavailable' });
    resolve({ gpu: 'Unavailable' });
  });
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
    gpu: diagnostics.gpu,
    vramMb: null,
    java: profile.javaPath || 'Automatic Java detection',
    estimatedMetrics: ['fps', 'frameTimeMs', 'onePercentLow', 'zeroPointOnePercentLow', 'vramMb'],
  };
}

ipcMain.handle('launcher:get-performance', async (_event, profileId) => {
  const profile = launcherState.profiles.find(item => item.id === profileId) || getActiveProfile();
  if (!profile) return { ok: false, error: 'No profile selected.' };
  return { ok: true, running: runningProcesses.has(profile.id), snapshot: await collectPerformanceSnapshot(profile), history: profile.benchmarkHistory || [] };
});

ipcMain.handle('launcher:run-benchmark', async (_event, payload) => {
  const profile = launcherState.profiles.find(item => item.id === payload?.profileId) || getActiveProfile();
  if (!profile) return { ok: false, error: 'No profile selected.' };
  if (!runningProcesses.has(profile.id)) return { ok: false, error: 'Launch Minecraft with this profile before running a benchmark.' };
  const durationMs = Math.min(60000, Math.max(5000, Number(payload?.durationMs) || 15000));
  emitStatus(`Benchmarking ${profile.name}...`);
  const samples = [];
  const startedAt = Date.now();
  while (Date.now() - startedAt < durationMs && runningProcesses.has(profile.id)) {
    samples.push(await collectPerformanceSnapshot(profile));
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  const measuredCpu = samples.filter(sample => sample.cpuPercent != null).map(sample => sample.cpuPercent);
  const measuredMemory = samples.filter(sample => sample.memoryMb != null).map(sample => sample.memoryMb);
  const result = {
    id: `benchmark-${crypto.randomUUID()}`,
    startedAt: new Date(startedAt).toISOString(),
    durationMs: Date.now() - startedAt,
    averageFps: null,
    onePercentLow: null,
    zeroPointOnePercentLow: null,
    frameTimeMs: null,
    averageCpuPercent: measuredCpu.length ? Number((measuredCpu.reduce((sum, value) => sum + value, 0) / measuredCpu.length).toFixed(1)) : null,
    peakMemoryMb: measuredMemory.length ? Math.max(...measuredMemory) : null,
    metricsUnavailable: ['averageFps', 'onePercentLow', 'zeroPointOnePercentLow', 'frameTimeMs', 'vramMb'],
    profileId: profile.id,
    profileName: profile.name,
    settings: { memoryMax: profile.memoryMax, rendererMode: profile.rendererMode, mcVersion: profile.mcVersion, loader: profile.loader },
  };
  profile.benchmarkHistory = [...(profile.benchmarkHistory || []), result].slice(-30);
  scheduleStateWrite();
  emitStatus(`Benchmark complete · ${profile.name}`);
  return { ok: true, result, history: profile.benchmarkHistory };
});

// ---------------------------------------------------------------------------
// IPC: launch
// ---------------------------------------------------------------------------
ipcMain.handle('launcher:launch', async (_event, payload) => {
  const requestedProfileId = payload?.profileId || null;
  try {
    const account = getActiveAccount();
    if (!account) throw new Error('No account selected');
    const profile = launcherState.profiles.find(item => item.id === requestedProfileId) || getActiveProfile();
    if (!profile) throw new Error('No active profile');
    if (runningProcesses.has(profile.id)) throw new Error(`${profile.name} is already running`);

    const settings = normalizeSettings({ ...launcherState.settings, ...profile, ...(payload?.settings || {}) });
    const memoryMax = Math.min(32, Math.max(1, Number(settings.memoryMax) || 6));
    const minecraftRoot = getMinecraftRootFor(profile.id);
    ensureLauncherGameFolders(minecraftRoot);
    const sharedCacheRoot = getSharedCacheRoot();
    fs.mkdirSync(path.join(sharedCacheRoot, 'assets'), { recursive: true });
    fs.mkdirSync(path.join(sharedCacheRoot, 'libraries'), { recursive: true });
    launcherState.sessions = launcherState.sessions.filter(session => session.profileId !== profile.id);
    const session = { profileId: profile.id, profileName: profile.name, pid: null, running: true, logs: [] };
    launcherState.sessions.push(session);
    scheduleStateWrite();
    emitLog(profile.name, 'normal', `Starting ${profile.mcVersion} with ${profile.loader}`, profile.id);
    emitStatus(`Preparing ${profile.mcVersion} (${profile.loader}, ${profile.rendererMode}) for ${account.name}...`);
    emitLog(profile.name, 'normal', 'Authenticating account...', profile.id);
    const authorization = account.type === 'Offline'
      ? {
          access_token: '',
          client_token: account.id,
          uuid: account.uuid,
          name: account.name,
          user_properties: '{}',
          meta: { type: 'mojang' },
        }
      : account.auth;
    if (!authorization) throw new Error('Microsoft account is not linked. Link it from the Accounts screen first.');
    if (profile.rendererMode !== 'vanilla' && !['fabric', 'quilt'].includes(profile.loader)) {
      emitStatus(`Warning: ${profile.rendererMode} requires a Fabric or Quilt loader profile`);
    }
    emitLog(profile.name, 'normal', 'Checking Minecraft and loader metadata...', profile.id);
    const versionNumber = await installLoader(profile);
    emitLog(profile.name, 'normal', `Loader profile ready: ${versionNumber}`, profile.id);
    emitStatus(`Preparing ${profile.mcVersion} (${profile.loader}, ${profile.rendererMode}) · resolving game files...`);
    emitLog(profile.name, 'info', `RAM maximum: ${memoryMax} GB (initial heap: 1 GB)`, profile.id);

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
    profileLauncher.on('arguments', args => {
      lastLaunchArguments = Array.isArray(args) ? args : [];
      emitLog(profile.name, 'info', `Final launch command: java ${lastLaunchArguments.join(' ')}`, profile.id);
    });
    const child = await profileLauncher.launch({
      root: minecraftRoot,
      version: versionNumber === profile.mcVersion
        ? { number: profile.mcVersion, type: 'release' }
        : { number: profile.mcVersion, type: 'custom', custom: versionNumber },
      memory: { min: '1G', max: `${Math.min(32, Math.max(1, memoryMax))}G` },
      javaPath: profile.javaPath || await getJavaPath(),
      customArgs: getJvmArguments(settings),
      authorization,
      overrides: {
        gameDirectory: minecraftRoot,
        assetRoot: path.join(sharedCacheRoot, 'assets'),
        libraryRoot: path.join(sharedCacheRoot, 'libraries'),
        maxSockets: 8,
        natives: path.join(minecraftRoot, 'natives'),
      },
      window: {
        width: settings.resolution.includes('3840') ? 3840 : settings.resolution.includes('1920') ? 1920 : 1280,
        height: settings.resolution.includes('2160') ? 2160 : settings.resolution.includes('1080') ? 1080 : 720,
      },
    });

    if (child) {
      runningProcesses.set(profile.id, { child, pid: child.pid, profile });
      session.pid = child.pid || null;
      session.running = true;
      scheduleStateWrite();
      setProcessPriority(child, settings.processPriority);
      emitLog(profile.name, 'info', `Java: ${await getJavaPath()}`, profile.id);
      emitLog(profile.name, 'info', `JVM arguments: ${getJvmArguments(settings).join(' ') || 'MCLC defaults'}`, profile.id);
      emitProcessState(true, profile, child.pid);
      emitStatus(`Running · ${profile.name} · ${account.name}`);
      child.stdout?.on('data', data => String(data).split(/\r?\n/).forEach(line => emitLog(profile.name, 'normal', line, profile.id)));
      child.stderr?.on('data', data => String(data).split(/\r?\n/).forEach(line => emitLog(profile.name, 'warn', line, profile.id)));
      child.on('exit', code => {
        runningProcesses.delete(profile.id);
        session.running = false;
        session.pid = null;
        session.exitCode = code ?? null;
        session.crashAnalysis = code === 0 ? null : analyzeMinecraftFailure(profile, session, code ?? null);
        scheduleStateWrite();
        emitProcessState(false, profile, child.pid);
        emitLog(profile.name, code === 0 ? 'info' : 'err', `Minecraft exited with code ${code ?? 0}`, profile.id);
        emitStatus(`Minecraft exited with code ${code ?? 0}`);
      });
    }

    if (!child) {
      session.running = false;
      scheduleStateWrite();
      throw new Error('Minecraft did not start. Open this profile\'s Logs tab for the MCLC failure details.');
    }

    return { ok: true, profileName: profile.name, version: versionNumber, accountName: account.name, pid: child?.pid || null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const failedSession = requestedProfileId && getSession(requestedProfileId);
    if (failedSession && !runningProcesses.has(requestedProfileId)) {
      failedSession.running = false;
      failedSession.pid = null;
      scheduleStateWrite();
    }
    const failedProfile = launcherState.profiles.find(item => item.id === requestedProfileId) || getActiveProfile();
    if (failedProfile) emitLog(failedProfile.name, 'err', `Launch failed: ${message}`, failedProfile.id);
    emitStatus(`Launch failed · ${message}`);
    return { ok: false, error: message };
  }
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
  if (session) { session.running = false; session.pid = null; scheduleStateWrite(); }
  emitProcessState(false, profile, pid);
  emitStatus('Ready');
  return { ok: true, running: false };
});

function restoreRunningSessions() {
  for (const session of launcherState.sessions) {
    if (!session.running || !session.pid) continue;
    try {
      process.kill(Number(session.pid), 0);
    } catch {
      session.running = false;
      session.pid = null;
    }
  }
  scheduleStateWrite();
}

app.whenReady().then(async () => {
  stateFilePath = getStateFilePath();
  launcherState = readStateFromDisk();
  restoreRunningSessions();
  createWindow();
  if (app.isPackaged) {
    autoUpdater.on('update-available', info => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('launcher:update-available', { version: info.version });
    });
    autoUpdater.on('update-downloaded', () => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('launcher:update-ready');
    });
    autoUpdater.checkForUpdatesAndNotify().catch(error => console.warn('[Updater] update check failed:', error.message));
  }
  for (const server of launcherState.servers.filter(item => item.autoStart)) {
    startServerProcess(server).catch(error => emitServerConsole(server.id, 'warn', `Auto-start failed: ${error.message}`));
  }
  mainWindow.webContents.once('did-finish-load', () => {
    for (const session of launcherState.sessions.filter(item => item.running && item.pid)) {
      const profile = launcherState.profiles.find(item => item.id === session.profileId);
      if (profile) emitProcessState(true, profile, session.pid);
    }
  });
  watchLauncherFile();
  for (const profile of launcherState.profiles) {
    if (profile.loader !== 'fabric') continue;
    try {
      emitStatus(`Checking Fabric API for ${profile.name}...`);
      if (await ensureFabricApi(profile)) scheduleStateWrite();
    } catch (error) {
      emitLog(profile.name, 'err', `Fabric API preinstall failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const profile = getActiveProfile();
  if (profile && profile.rendererMode !== 'vanilla' && (!['fabric', 'quilt'].includes(profile.loader) || !getLoaderVersionId(profile, profile.mcVersion, profile.loader))) {
    mainWindow.webContents.once('did-finish-load', () => emitStatus(`Warning: ${profile.rendererMode} is selected but ${profile.loader} is not installed yet`));
  }
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', () => {
  launcherStateStore.clearWriteTimer();
  if (writeStatePending) flushStateWrite();
  playitManager.stop();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

