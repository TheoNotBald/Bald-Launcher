'use strict';

function selectForgeVersion(metadata, minecraftVersion) {
  const requestedVersion = String(minecraftVersion || '').trim();
  if (!requestedVersion || !metadata || typeof metadata !== 'object') return null;

  const candidates = Array.isArray(metadata[requestedVersion])
    ? metadata[requestedVersion]
    : Array.isArray(metadata.versions)
      ? metadata.versions
      : [];
  return candidates
    .filter(version => typeof version === 'string' && version.startsWith(`${requestedVersion}-`))
    .filter(version => !/(?:alpha|beta|pre|snapshot|rc)/i.test(version))
    .sort((left, right) => right.localeCompare(left, undefined, { numeric: true, sensitivity: 'base' }))[0] || null;
}

module.exports = { selectForgeVersion };
