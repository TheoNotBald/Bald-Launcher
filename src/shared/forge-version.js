'use strict';

function getForgeVersions(metadata, minecraftVersion) {
  const requestedVersion = String(minecraftVersion || '').trim();
  if (!requestedVersion || !metadata || typeof metadata !== 'object') return [];

  const candidates = Array.isArray(metadata[requestedVersion])
    ? metadata[requestedVersion]
    : Array.isArray(metadata.versions)
      ? metadata.versions
      : [];
  return candidates
    .filter(version => typeof version === 'string' && version.startsWith(`${requestedVersion}-`))
    .sort((left, right) => right.localeCompare(left, undefined, { numeric: true, sensitivity: 'base' }));
}

function selectForgeVersion(metadata, minecraftVersion) {
  return getForgeVersions(metadata, minecraftVersion)
    .find(version => !/(?:alpha|beta|pre|snapshot|rc)/i.test(version)) || null;
}

module.exports = { getForgeVersions, selectForgeVersion };
