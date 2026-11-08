'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const { randomBytes } = require('crypto');
const { app } = require('electron');

const ARTIFACTS = { fabric: 'agent-fabric.jar', quilt: 'agent-fabric.jar', vanilla: 'agent-vanilla.jar' };

let storePromise = null;
async function store() {
  if (!storePromise) {
    storePromise = import('electron-store').then(({ default: Store }) => new Store({ name: 'lib' }));
  }
  return storePromise;
}

function artifactFor(loader) {
  return ARTIFACTS[String(loader || 'vanilla').toLowerCase()] || ARTIFACTS.vanilla;
}

function artifactPath(name) {
  const packaged = path.join(process.resourcesPath, 'lib', name);
  return fs.existsSync(packaged) ? packaged : path.join(__dirname, '..', '..', 'lib', 'build', 'libs', name);
}

async function readProfiles() {
  const value = (await store()).get('libProfiles', {});
  return value && typeof value === 'object' ? value : {};
}

async function isEnabled(profileId) {
  return Boolean(profileId) && (await readProfiles())[profileId] === true;
}

async function status(profileIds) {
  const enabled = await readProfiles();
  const fabric = fs.existsSync(artifactPath('agent-fabric.jar'));
  const vanilla = fs.existsSync(artifactPath('agent-vanilla.jar'));
  const profiles = {};
  for (const id of profileIds || Object.keys(enabled)) {
    profiles[id] = { enabled: enabled[id] === true, fabric, vanilla };
  }
  return { version: app.getVersion(), profiles };
}

async function prepare(profile, loader) {
  const artifact = artifactFor(loader);
  const source = artifactPath(artifact);
  if (!fs.existsSync(source)) {
    const error = new Error(`The ${artifact} agent artifact is missing. Build the client library before enabling it.`);
    error.code = 'LIB_ARTIFACT_MISSING';
    throw error;
  }
  const jar = path.join(os.tmpdir(), `lib${randomBytes(4).toString('hex')}.jar`);
  const cfg = path.join(os.tmpdir(), `lib${randomBytes(4).toString('hex')}.cfg`);
  await fsp.copyFile(source, jar);
  const payload = { profile: profile.id, loader: loader || 'vanilla' };
  await fsp.writeFile(cfg, Buffer.from(JSON.stringify(payload), 'utf8').toString('base64'), 'utf8');
  return {
    args: [`-javaagent:${jar}`, `-Dlib.cfg=${cfg}`],
    cleanup() {
      for (const file of [jar, cfg]) {
        try { fs.unlinkSync(file); } catch (error) { if (error.code !== 'ENOENT') console.error('[lib] cleanup', error); }
      }
    },
  };
}

function register(ipcMain) {
  ipcMain.handle('launcher:lib:get-profiles', async (_event, profileIds) => status(profileIds));
  ipcMain.handle('launcher:lib:set-profile', async (_event, payload) => {
    const current = { ...(await readProfiles()) };
    if (payload?.enabled === true) current[payload.profileId] = true;
    else delete current[payload.profileId];
    (await store()).set('libProfiles', current);
    return { ok: true, profiles: current };
  });
  ipcMain.handle('launcher:lib:get-status', async (_event, profileIds) => status(profileIds));
}

module.exports = { register, isEnabled, prepare, status };