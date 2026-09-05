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
  deleteAccount: accountId => ipcRenderer.invoke('launcher:delete-account', accountId),

  // profiles
  getRendererOptions: (mcVersion, loader) => ipcRenderer.invoke('launcher:get-renderer-options', { mcVersion, loader }),
  getVersions: () => ipcRenderer.invoke('launcher:get-versions'),
  createProfile: profile => ipcRenderer.invoke('launcher:create-profile', profile),
  updateProfile: profile => ipcRenderer.invoke('launcher:update-profile', profile),
  deleteProfile: profileId => ipcRenderer.invoke('launcher:delete-profile', profileId),
  setActiveProfile: profileId => ipcRenderer.invoke('launcher:set-active-profile', profileId),
  previewBundle: params => ipcRenderer.invoke('launcher:preview-bundle', params),
  applyBundle: payload => ipcRenderer.invoke('launcher:apply-bundle', payload),

  // content
  searchContent: params => ipcRenderer.invoke('launcher:search-content', params),
  installContent: payload => ipcRenderer.invoke('launcher:install-content', payload),
  removeContent: payload => ipcRenderer.invoke('launcher:remove-content', payload),
  toggleContent: payload => ipcRenderer.invoke('launcher:toggle-content', payload),
  openFolder: folderType => ipcRenderer.invoke('launcher:open-folder', folderType),

  // launch
  launch: payload => ipcRenderer.invoke('launcher:launch', payload),
  stop: profileId => ipcRenderer.invoke('launcher:stop', { profileId }),
  getDiagnostics: () => ipcRenderer.invoke('launcher:get-diagnostics'),

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
});
