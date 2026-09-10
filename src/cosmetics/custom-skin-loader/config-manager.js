const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');

const CONFIG_DIRECTORY = 'CustomSkinLoader';
const CONFIG_FILE_NAME = 'CustomSkinLoader.json';
const SCHEMA_ID = 'legacy-loadlist-v1';
const LOCAL_SKIN_PROVIDER = {
  name: 'LocalSkin',
  type: 'Legacy',
  checkPNG: false,
  model: 'auto',
  skin: 'LocalSkin/skins/{USERNAME}.png',
  cape: 'LocalSkin/capes/{USERNAME}.png',
  elytra: 'LocalSkin/elytras/{USERNAME}.png',
};

function configPath(profileRoot) {
  return path.join(profileRoot, CONFIG_DIRECTORY, CONFIG_FILE_NAME);
}

function findConfigPath(profileRoot) {
  const target = configPath(profileRoot);
  return fs.existsSync(target) ? target : null;
}

function readConfig(profileRoot) {
  const filePath = findConfigPath(profileRoot);
  if (!filePath) {
    return { exists: false, valid: false, schema: null, path: configPath(profileRoot), value: null, issue: 'Configuration file was not found.' };
  }
  try {
    const value = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const schema = detectConfigSchema(value);
    if (!schema) throw new Error('The configuration does not match the verified CustomSkinLoader loadlist schema.');
    return { exists: true, valid: true, schema, path: filePath, value, issue: null };
  } catch (error) {
    return { exists: true, valid: false, schema: null, path: filePath, value: null, issue: error instanceof Error ? error.message : String(error) };
  }
}

function detectConfigSchema(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !Array.isArray(value.loadlist)) return null;
  if (value.loadlist.some(entry => !entry || typeof entry !== 'object' || Array.isArray(entry))) return null;
  return SCHEMA_ID;
}

function detectJarSchema(jarFile) {
  try {
    const zip = new AdmZip(jarFile);
    const hasConfigClass = Boolean(zip.getEntry('customskinloader/config/Config.class'));
    const hasLegacyLoader = Boolean(zip.getEntry('customskinloader/loader/LegacyLoader.class'));
    return hasConfigClass && hasLegacyLoader ? SCHEMA_ID : null;
  } catch (_error) {
    return null;
  }
}

function createConfig(versionNumber) {
  return {
    version: String(versionNumber || ''),
    buildNumber: 0,
    loadlist: [],
  };
}

function configureLocalSkin(profileRoot, { jarFile, versionNumber }) {
  const jarSchema = detectJarSchema(jarFile);
  if (jarSchema !== SCHEMA_ID) {
    return { ok: false, state: 'unverified', reason: 'UNVERIFIED_CONFIGURATION: the installed JAR does not expose the verified CustomSkinLoader configuration classes.' };
  }

  const current = readConfig(profileRoot);
  if (current.exists && !current.valid) return { ok: false, state: 'invalid', reason: current.issue };
  const value = current.value || createConfig(versionNumber);
  const existing = value.loadlist.find(entry => entry.name === LOCAL_SKIN_PROVIDER.name && entry.type === LOCAL_SKIN_PROVIDER.type);
  const provider = existing || {};
  Object.assign(provider, LOCAL_SKIN_PROVIDER);
  if (!existing) value.loadlist.unshift(provider);
  else {
    value.loadlist = [provider, ...value.loadlist.filter(entry => entry !== provider)];
  }
  if (!value.version) value.version = String(versionNumber || '');
  if (!Number.isInteger(value.buildNumber)) value.buildNumber = 0;
  if (!Array.isArray(value.loadlist) || value.loadlist[0] !== provider) {
    return { ok: false, state: 'invalid', reason: 'LocalSkin provider ordering could not be validated.' };
  }
  return {
    ok: true,
    schema: SCHEMA_ID,
    path: configPath(profileRoot),
    value,
    provider,
    existed: current.exists,
  };
}

function writeConfigAtomic(result) {
  if (!result?.ok || !result.path || !result.value) throw new Error('No verified CustomSkinLoader configuration is available to write.');
  fs.mkdirSync(path.dirname(result.path), { recursive: true });
  const temporary = `${result.path}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(result.value, null, 2)}\n`, 'utf8');
  fs.renameSync(temporary, result.path);
}

function validateConfig(profileRoot, expected = {}) {
  const current = readConfig(profileRoot);
  if (!current.valid) return current;
  const provider = current.value.loadlist.find(entry => entry.name === LOCAL_SKIN_PROVIDER.name && entry.type === LOCAL_SKIN_PROVIDER.type);
  const pointsToLocalSkin = Boolean(provider
    && provider.skin === LOCAL_SKIN_PROVIDER.skin
    && provider.cape === LOCAL_SKIN_PROVIDER.cape
    && provider.elytra === LOCAL_SKIN_PROVIDER.elytra
    && current.value.loadlist[0] === provider);
  const jarSchema = expected.jarFile ? detectJarSchema(expected.jarFile) : SCHEMA_ID;
  return {
    ...current,
    schema: current.schema,
    provider: provider || null,
    pointsToLocalSkin,
    valid: current.schema === SCHEMA_ID && jarSchema === SCHEMA_ID && pointsToLocalSkin,
    issue: pointsToLocalSkin ? null : 'The verified LocalSkin provider is missing, incomplete, or not first in the load list.',
  };
}

module.exports = {
  CONFIG_DIRECTORY,
  CONFIG_FILE_NAME,
  SCHEMA_ID,
  LOCAL_SKIN_PROVIDER,
  configPath,
  findConfigPath,
  readConfig,
  detectConfigSchema,
  detectJarSchema,
  configureLocalSkin,
  writeConfigAtomic,
  validateConfig,
};
