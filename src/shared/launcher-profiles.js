'use strict';

const fs = require('node:fs');
const path = require('node:path');

function ensureLauncherProfilesFile(rootPath) {
  const launcherProfilesPath = path.join(rootPath, 'launcher_profiles.json');
  const microsoftStoreProfilesPath = path.join(rootPath, 'launcher_profiles_microsoft_store.json');
  if (fs.existsSync(launcherProfilesPath) || fs.existsSync(microsoftStoreProfilesPath)) return false;

  fs.mkdirSync(rootPath, { recursive: true });
  try {
    fs.writeFileSync(launcherProfilesPath, JSON.stringify({
      profiles: {},
      settings: {},
      version: 3,
    }, null, 2), { flag: 'wx' });
    return true;
  } catch (error) {
    if (error.code === 'EEXIST') return false;
    throw error;
  }
}

module.exports = { ensureLauncherProfilesFile };
