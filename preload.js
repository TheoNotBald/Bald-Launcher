const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('launcherAPI', {
  // state
  getState: () => ipcRenderer.invoke('launcher:get-state'),
  syncState: state => ipcRenderer.invoke('launcher:sync-state', state),

  // accounts
  setActiveAccount: accountId => ipcRenderer.invoke('launcher:set-active-account', accountId),
  addAccount: account => ipcRenderer.invoke('launcher:add-account', account),
  linkMicrosoftAccount: () => ipcRenderer.invoke('launcher:link-microsoft-account'),
  chooseSkin: () => ipcRenderer.invoke('launcher:choose-skin'),
  getCosmetics: payload => ipcRenderer.invoke('launcher:cosmetics:get', payload),
  getCurrentMinecraftAppearance: payload => ipcRenderer.invoke('launcher:cosmetics:get', payload),
  saveCosmeticSelection: payload => ipcRenderer.invoke('launcher:cosmetics:save-selection', payload),
  importCosmeticAsset: payload => ipcRenderer.invoke('launcher:cosmetics:import', payload),
  readCosmeticTexture: filePath => ipcRenderer.invoke('launcher:cosmetics:read-texture', filePath),
  saveCreatedCosmetic: payload => ipcRenderer.invoke('launcher:cosmetics:save-created', payload),
  exportCreatedCosmetic: payload => ipcRenderer.invoke('launcher:cosmetics:export-created', payload),
  renameCreatedCosmetic: payload => ipcRenderer.invoke('launcher:cosmetics:rename-created', payload),
  deleteCreatedCosmetic: payload => ipcRenderer.invoke('launcher:cosmetics:delete-created', payload),
  deleteAccount: accountId => ipcRenderer.invoke('launcher:delete-account', accountId),

  // profiles
  getRendererOptions: (mcVersion, loader) => ipcRenderer.invoke('launcher:get-renderer-options', { mcVersion, loader }),
  getVersions: () => ipcRenderer.invoke('launcher:get-versions'),
  resolveCustomSkinLoader: profileId => ipcRenderer.invoke('launcher:custom-skin-loader:resolve', { profileId }),
  diagnoseCustomSkinLoader: profileId => ipcRenderer.invoke('launcher:custom-skin-loader:diagnose', { profileId }),
  installCustomSkinLoader: profileId => ipcRenderer.invoke('launcher:custom-skin-loader:install', { profileId }),
  repairCustomSkinLoader: profileId => ipcRenderer.invoke('launcher:custom-skin-loader:repair', { profileId }),
  disableCustomSkinLoader: profileId => ipcRenderer.invoke('launcher:custom-skin-loader:disable', { profileId }),
  removeCustomSkinLoader: profileId => ipcRenderer.invoke('launcher:custom-skin-loader:remove', { profileId }),
  getCustomSkinLoaderOwnership: profileId => ipcRenderer.invoke('launcher:custom-skin-loader:ownership', { profileId }),
  createProfile: profile => ipcRenderer.invoke('launcher:create-profile', profile),
  updateProfile: profile => ipcRenderer.invoke('launcher:update-profile', profile),
  duplicateProfile: (profileId, name) => ipcRenderer.invoke('launcher:duplicate-profile', { profileId, name }),
  exportProfile: profileId => ipcRenderer.invoke('launcher:export-profile', profileId),
  exportModpack: payload => ipcRenderer.invoke('launcher:export-modpack', payload),
  importProfile: () => ipcRenderer.invoke('launcher:import-profile'),
  backupProfile: profileId => ipcRenderer.invoke('launcher:backup-profile', profileId),
  restoreProfile: profileId => ipcRenderer.invoke('launcher:restore-profile', profileId),
  revealProfile: profileId => ipcRenderer.invoke('launcher:reveal-profile', profileId),
  importLocalContent: profileId => ipcRenderer.invoke('launcher:import-local-content', profileId),
  deleteProfile: (profileId, deleteFiles) => ipcRenderer.invoke('launcher:delete-profile', { profileId, deleteFiles: deleteFiles === true }),
  setActiveProfile: profileId => ipcRenderer.invoke('launcher:set-active-profile', profileId),
  previewBundle: params => ipcRenderer.invoke('launcher:preview-bundle', params),
  applyBundle: payload => ipcRenderer.invoke('launcher:apply-bundle', payload),

  // content
  searchContent: params => ipcRenderer.invoke('launcher:search-content', params),
  installContent: payload => ipcRenderer.invoke('launcher:install-content', payload),
  exportResourcePack: payload => ipcRenderer.invoke('launcher:export-resource-pack', payload),
  importResourcePack: () => ipcRenderer.invoke('launcher:import-resource-pack'),
  getResourcePackCatalog: version => ipcRenderer.invoke('launcher:get-resource-pack-catalog', version),
  getResourcePackAsset: (version, assetPath) => ipcRenderer.invoke('launcher:get-resource-pack-asset', version, assetPath),
  getResourcePackModel: (version, modelName) => ipcRenderer.invoke('launcher:get-resource-pack-model', version, modelName),
  removeContent: payload => ipcRenderer.invoke('launcher:remove-content', payload),
  toggleContent: payload => ipcRenderer.invoke('launcher:toggle-content', payload),
  openFolder: folderType => ipcRenderer.invoke('launcher:open-folder', folderType),

  // launch
  launch: payload => ipcRenderer.invoke('launcher:launch', payload),
  stop: profileId => ipcRenderer.invoke('launcher:stop', { profileId }),
  getDiagnostics: () => ipcRenderer.invoke('launcher:get-diagnostics'),
  analyzeCrash: profileId => ipcRenderer.invoke('launcher:analyze-crash', profileId),
  getPerformance: profileId => ipcRenderer.invoke('launcher:get-performance', profileId),
  runBenchmark: payload => ipcRenderer.invoke('launcher:run-benchmark', payload),

  createServer: server => ipcRenderer.invoke('launcher:create-server', server),
  startServer: serverId => ipcRenderer.invoke('launcher:start-server', { serverId }),
  stopServer: serverId => ipcRenderer.invoke('launcher:stop-server', { serverId }),
  listServerFiles: params => ipcRenderer.invoke('server:list-files', typeof params === 'string' ? { serverId: params } : params),
  readServerFile: params => ipcRenderer.invoke('server:read-file', params),
  writeServerFile: params => ipcRenderer.invoke('server:write-file', params),
  deleteServerFile: params => ipcRenderer.invoke('server:delete-file', params),
  renameServerFile: params => ipcRenderer.invoke('server:rename-file', params),
  backupServer: params => ipcRenderer.invoke('server:backup', params),
  listServerBackups: serverId => ipcRenderer.invoke('server:list-backups', { serverId }),
  deleteServerBackup: params => ipcRenderer.invoke('server:delete-backup', params),
  restoreServerBackup: params => ipcRenderer.invoke('server:restore-backup', params),
  sendServerCommand: params => ipcRenderer.invoke('server:send-command', params),
  getServerTps: serverId => ipcRenderer.invoke('server:get-tps', { serverId }),
  getServerMemory: serverId => ipcRenderer.invoke('server:get-memory', { serverId }),
  createServerFolder: params => ipcRenderer.invoke('server:create-folder', params),
  createServerFile: params => ipcRenderer.invoke('server:create-file', params),
  uploadServerFile: params => ipcRenderer.invoke('server:upload-file', params),
  downloadServerFile: params => ipcRenderer.invoke('server:download-file', params),
  downloadServerArchive: params => ipcRenderer.invoke('server:download-archive', params),
  revealServerPath: params => ipcRenderer.invoke('server:reveal-path', params),
  writeServerSettings: params => ipcRenderer.invoke('server:write-settings', params),
  uploadServerIcon: params => ipcRenderer.invoke('server:upload-icon', params),
  getPlayitStatus: () => ipcRenderer.invoke('server:playit-status'),
  installPlayitAgent: () => ipcRenderer.invoke('server:playit-install'),
  startPlayitAgent: () => ipcRenderer.invoke('server:playit-start'),
  stopPlayitAgent: () => ipcRenderer.invoke('server:playit-stop'),
  restartPlayitAgent: () => ipcRenderer.invoke('server:playit-restart'),
  writePlayitInput: data => ipcRenderer.invoke('server:playit-input', data),
  resizePlayit: (cols, rows) => ipcRenderer.invoke('server:playit-resize', { cols, rows }),
  clearPlayitTerminal: () => ipcRenderer.invoke('server:playit-clear'),
  openPlayitLink: url => ipcRenderer.invoke('server:playit-open-link', url),
  openExternalUrl: url => ipcRenderer.invoke('launcher:open-external-url', url),
  applyUpdate: () => ipcRenderer.invoke('launcher:apply-update'),
  onPlayitData: callback => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('server:playit-data', handler);
    return () => ipcRenderer.removeListener('server:playit-data', handler);
  },
  onPlayitState: callback => {
    const handler = (_event, state) => callback(state);
    ipcRenderer.on('server:playit-state', handler);
    return () => ipcRenderer.removeListener('server:playit-state', handler);
  },
  onPlayitExit: callback => {
    const handler = (_event, state) => callback(state);
    ipcRenderer.on('server:playit-exit', handler);
    return () => ipcRenderer.removeListener('server:playit-exit', handler);
  },
  onPlayitClear: callback => {
    const handler = () => callback();
    ipcRenderer.on('server:playit-clear', handler);
    return () => ipcRenderer.removeListener('server:playit-clear', handler);
  },

  onStatus: callback => {
    const handler = (_event, message) => callback(message);
    ipcRenderer.on('launcher:status', handler);
    return () => ipcRenderer.removeListener('launcher:status', handler);
  },
  onLog: callback => {
    const handler = (_event, entry) => callback(entry);
    ipcRenderer.on('launcher:log', handler);
    return () => ipcRenderer.removeListener('launcher:log', handler);
  },
  onProcessState: callback => {
    const handler = (_event, state) => callback(state);
    ipcRenderer.on('launcher:process-state', handler);
    return () => ipcRenderer.removeListener('launcher:process-state', handler);
  },
  onUpdateAvailable: callback => {
    const handler = (_event, update) => callback(update);
    ipcRenderer.on('launcher:update-available', handler);
    return () => ipcRenderer.removeListener('launcher:update-available', handler);
  },
  onUpdateReady: callback => {
    const handler = () => callback();
    ipcRenderer.on('launcher:update-ready', handler);
    return () => ipcRenderer.removeListener('launcher:update-ready', handler);
  },
  onServerState: callback => {
    const handler = (_event, state) => callback(state);
    ipcRenderer.on('launcher:server-state', handler);
    return () => ipcRenderer.removeListener('launcher:server-state', handler);
  },
  onServerConsole: callback => {
    const handler = (_event, entry) => callback(entry);
    ipcRenderer.on('launcher:server-console', handler);
    return () => ipcRenderer.removeListener('launcher:server-console', handler);
  },

  // themes
  getThemes: () => ipcRenderer.invoke('launcher:get-themes'),
  setActiveTheme: themeId => ipcRenderer.invoke('launcher:set-active-theme', themeId),
  updateTheme: (themeId, updates) => ipcRenderer.invoke('launcher:update-theme', { themeId, updates }),
  duplicateTheme: (fromThemeId, toThemeId, name) => ipcRenderer.invoke('launcher:duplicate-theme', { fromThemeId, toThemeId, name }),
  renameTheme: (themeId, name) => ipcRenderer.invoke('launcher:rename-theme', { themeId, name }),
  deleteTheme: themeId => ipcRenderer.invoke('launcher:delete-theme', themeId),
  resetTheme: themeId => ipcRenderer.invoke('launcher:reset-theme', themeId),
  resetThemeCategory: (themeId, category) => ipcRenderer.invoke('launcher:reset-theme-category', { themeId, category }),
  exportTheme: themeId => ipcRenderer.invoke('launcher:export-theme', themeId),
  importTheme: (themeId, jsonString) => ipcRenderer.invoke('launcher:import-theme', { themeId, jsonString }),
  backupThemes: () => ipcRenderer.invoke('launcher:backup-themes'),
  restoreThemes: backup => ipcRenderer.invoke('launcher:restore-themes', backup),
});
