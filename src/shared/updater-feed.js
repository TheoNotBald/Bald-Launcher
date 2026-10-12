'use strict';

const fs = require('node:fs');
const path = require('node:path');

const GITHUB_UPDATER_FEED = Object.freeze({
  provider: 'github',
  owner: 'TheoNotBald',
  repo: 'Bald-Launcher',
});

function configureUpdaterFeed(updater, { isPackaged, resourcesPath, installDirectory }) {
  if (!isPackaged) return false;
  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = false;
  if (typeof installDirectory === 'string' && installDirectory.length > 0) {
    updater.installDirectory = installDirectory;
  }
  if (fs.existsSync(path.join(resourcesPath, 'app-update.yml'))) return false;
  updater.setFeedURL(GITHUB_UPDATER_FEED);
  return true;
}

module.exports = { configureUpdaterFeed };
