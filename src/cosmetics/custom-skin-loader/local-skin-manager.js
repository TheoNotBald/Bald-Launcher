const fs = require('fs');
const path = require('path');

const IDENTIFIER_PATTERN = /^[a-zA-Z0-9._-]{1,80}$/;

function safeIdentifier(value) {
  const identifier = String(value || '').trim();
  if (!IDENTIFIER_PATTERN.test(identifier) || identifier === '.' || identifier === '..') {
    throw new Error('The cosmetic identifier contains invalid path characters.');
  }
  return identifier;
}

function getLocalSkinPaths(profileRoot) {
  const root = path.join(profileRoot, 'CustomSkinLoader', 'LocalSkin');
  return {
    root,
    skins: path.join(root, 'skins'),
    capes: path.join(root, 'capes'),
    elytras: path.join(root, 'elytras'),
  };
}

function ensureLocalSkinDirectories(profileRoot) {
  const directories = getLocalSkinPaths(profileRoot);
  for (const directory of Object.values(directories)) fs.mkdirSync(directory, { recursive: true });
  return directories;
}

function getCosmeticPath(profileRoot, type, identifier) {
  const directories = getLocalSkinPaths(profileRoot);
  const folder = type === 'skin' ? directories.skins : type === 'cape' ? directories.capes : type === 'elytra' ? directories.elytras : null;
  if (!folder) throw new Error('Unsupported CustomSkinLoader cosmetic type.');
  const safeName = safeIdentifier(identifier);
  const result = path.resolve(folder, `${safeName}.png`);
  if (!result.startsWith(`${path.resolve(folder)}${path.sep}`)) throw new Error('Cosmetic path escaped the profile directory.');
  return result;
}

module.exports = { safeIdentifier, getLocalSkinPaths, ensureLocalSkinDirectories, getCosmeticPath };
