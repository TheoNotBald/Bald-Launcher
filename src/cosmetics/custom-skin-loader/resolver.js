const CUSTOM_SKIN_LOADER_PROJECT_ID = 'idMHQ4n2';
const CUSTOM_SKIN_LOADER_PROJECT_SLUG = 'customskinloader';
const SUPPORTED_LOADERS = new Set(['fabric', 'forge', 'neoforge', 'quilt']);

function normalizeLoader(loader) {
  const value = String(loader || '').trim().toLowerCase();
  return SUPPORTED_LOADERS.has(value) ? value : '';
}

function versionSortKey(version) {
  return String(version || '')
    .split(/[.-]/)
    .map(part => (/^\d+$/.test(part) ? Number(part) : part))
    .map(part => typeof part === 'number' ? part.toString().padStart(8, '0') : part)
    .join('.');
}

function selectCompatibleVersion(versions, mcVersion, loader) {
  const candidates = (Array.isArray(versions) ? versions : [])
    .filter(version => version && version.version_type === 'release')
    .filter(version => Array.isArray(version.game_versions) && version.game_versions.includes(mcVersion))
    .filter(version => Array.isArray(version.loaders) && version.loaders.includes(loader))
    .filter(version => Array.isArray(version.files) && version.files.some(file => file && file.url && file.primary !== false))
    .sort((left, right) => {
      const published = String(right.date_published || '').localeCompare(String(left.date_published || ''));
      if (published !== 0) return published;
      return versionSortKey(right.version_number).localeCompare(versionSortKey(left.version_number));
    });
  const selected = candidates[0] || null;
  if (!selected) return null;
  const file = selected.files.find(item => item && item.url && item.primary !== false) || selected.files.find(item => item && item.url);
  return {
    projectId: CUSTOM_SKIN_LOADER_PROJECT_ID,
    projectSlug: CUSTOM_SKIN_LOADER_PROJECT_SLUG,
    versionId: String(selected.id || ''),
    versionNumber: String(selected.version_number || ''),
    gameVersion: mcVersion,
    loader,
    fileName: String(file.filename || ''),
    downloadUrl: String(file.url),
    sha1: file.hashes?.sha1 ? String(file.hashes.sha1) : null,
    fileSize: Number.isFinite(Number(file.size)) ? Number(file.size) : null,
    publishedAt: selected.date_published || null,
    runtimeCompatibility: 'unverified',
  };
}

async function resolveCustomSkinLoader({ mcVersion, loader, client }) {
  const gameVersion = String(mcVersion || '').trim();
  const normalizedLoader = normalizeLoader(loader);
  if (!gameVersion || !normalizedLoader) {
    return {
      state: 'unsupported',
      reason: 'CustomSkinLoader requires a supported Minecraft version and client loader.',
      compatibility: null,
    };
  }
  if (!client || typeof client.get !== 'function') {
    throw new Error('CustomSkinLoader resolver requires an HTTP client.');
  }

  const response = await client.get(
    `https://api.modrinth.com/v2/project/${CUSTOM_SKIN_LOADER_PROJECT_ID}/version`,
    {
      params: {
        game_versions: JSON.stringify([gameVersion]),
        loaders: JSON.stringify([normalizedLoader]),
      },
      timeout: 15000,
      headers: { 'User-Agent': 'BaldLauncher/0.1.0' },
    },
  );
  const compatibility = selectCompatibleVersion(response.data, gameVersion, normalizedLoader);
  if (!compatibility) {
    return {
      state: 'unsupported',
      reason: `No verified CustomSkinLoader release was found for Minecraft ${gameVersion} with ${normalizedLoader}.`,
      compatibility: null,
    };
  }
  return {
    state: 'available',
    reason: 'A release tagged for this exact Minecraft version and loader is available.',
    compatibility,
  };
}

module.exports = {
  CUSTOM_SKIN_LOADER_PROJECT_ID,
  CUSTOM_SKIN_LOADER_PROJECT_SLUG,
  normalizeLoader,
  selectCompatibleVersion,
  resolveCustomSkinLoader,
};
