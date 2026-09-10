const fs = require('fs');
const path = require('path');

const METADATA_FILE = '.bald-customskinloader.json';

function metadataPath(profileRoot) {
  return path.join(profileRoot, METADATA_FILE);
}

function readOwnership(profileRoot) {
  try {
    const value = JSON.parse(fs.readFileSync(metadataPath(profileRoot), 'utf8'));
    return value && typeof value === 'object' ? value : null;
  } catch (_error) {
    return null;
  }
}

function writeOwnership(profileRoot, metadata) {
  const target = metadataPath(profileRoot);
  const temporary = `${target}.tmp`;
  fs.mkdirSync(profileRoot, { recursive: true });
  fs.writeFileSync(temporary, JSON.stringify(metadata, null, 2), 'utf8');
  fs.renameSync(temporary, target);
}

function removeOwnership(profileRoot) {
  const target = metadataPath(profileRoot);
  if (fs.existsSync(target)) fs.unlinkSync(target);
}

function isManagedPath(profileRoot, value) {
  if (!value) return false;
  const root = path.resolve(profileRoot);
  const candidate = path.resolve(value);
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

module.exports = { METADATA_FILE, metadataPath, readOwnership, writeOwnership, removeOwnership, isManagedPath };
