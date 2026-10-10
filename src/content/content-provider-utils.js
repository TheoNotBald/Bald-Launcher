const CURSEFORGE_PROJECT_TYPES = Object.freeze({
  5: 'plugin',
  6: 'mod',
  12: 'resourcepack',
  6552: 'shader',
  6945: 'datapack',
});

function normalizeContentLoader(loader) {
  const value = String(loader || '').trim().toLowerCase();
  const normalized = value.replace(/[\s_-]+/g, '');
  if (normalized === 'neoforge' || normalized === 'neo') return 'neoforge';
  if (['fabric', 'forge', 'quilt', 'vanilla'].includes(normalized)) return normalized;
  return value;
}

function selectModrinthVersion(versions, versionId = null) {
  const list = Array.isArray(versions) ? versions : [];
  const selected = versionId
    ? list.find(version => version.id === versionId)
    : list.find(version => version.version_type === 'release') || list[0];
  if (!selected) return null;
  const files = Array.isArray(selected.files) ? selected.files : [];
  const file = files.find(item => item.primary && item.url) || files.find(item => item.url);
  return file ? { version: selected, file } : null;
}

function selectCurseForgeFile(files, fileId = null) {
  const list = (Array.isArray(files) ? files : []).filter(file =>
    file?.downloadUrl && file.isAvailable !== false);
  const selected = fileId
    ? list.find(file => String(file.id) === String(fileId))
    : list.find(file => Number(file.releaseType) === 1) || list[0];
  return selected || null;
}

function mapCurseForgeProjectType(classId) {
  return CURSEFORGE_PROJECT_TYPES[Number(classId)] || null;
}

function isModrinthServerCompatible(entry) {
  const environment = typeof entry?.environment === 'string'
    ? entry.environment.toLowerCase()
    : '';
  if (environment) {
    if (environment === 'client_only') return false;
    if (environment === 'server_only'
      || environment === 'client_or_server'
      || environment === 'client_or_server_prefers_both'
      || environment === 'client_or_server_prefers_client') return true;
    // Version responses can report "unknown" even when the project itself
    // is server-compatible. Do not hide every version in that case.
    if (environment === 'unknown') return true;
  }
  const side = String(entry?.server_side || entry?.environment?.server || '').toLowerCase();
  return side === 'required' || side === 'optional';
}

function getModrinthSideLabel(entry) {
  const environment = typeof entry?.environment === 'string'
    ? entry.environment.toLowerCase()
    : '';
  if (environment === 'server_only') return 'Server only';
  if (environment === 'client_or_server'
    || environment === 'client_or_server_prefers_both'
    || environment === 'client_or_server_prefers_client') return 'Server or Client';
  if (environment === 'client_only') return 'Client only';
  const client = String(entry?.client_side || entry?.environment?.client || '').toLowerCase();
  const server = String(entry?.server_side || entry?.environment?.server || '').toLowerCase();
  if ((server === 'required' || server === 'optional') && (client === 'required' || client === 'optional')) {
    return 'Server or Client';
  }
  if (server === 'required' && client === 'unsupported') return 'Server only';
  if (server === 'optional' && client === 'unsupported') return 'Server optional';
  if (server === 'unsupported' && (client === 'required' || client === 'optional')) return 'Client only';
  return 'Unknown side';
}

function getCurseForgeSideLabel(entry) {
  const client = String(entry?.clientSide || '').toLowerCase();
  const server = String(entry?.serverSide || '').toLowerCase();
  if (server && client) {
    if (server === 'required' && client === 'unsupported') return 'Server only';
    if (server === 'unsupported' && client !== 'unsupported') return 'Client only';
    if (server !== 'unsupported' && client !== 'unsupported') return 'Server or Client';
  }
  return 'Unknown side';
}

function isCurseForgeServerCompatible(entry) {
  const side = typeof entry === 'string' ? entry : getCurseForgeSideLabel(entry);
  return side !== 'Client only';
}

function getCurseForgeFingerprint(buffer) {
  const data = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []);
  let length = 0;
  for (let i = 0; i < data.length; i++) {
    const byte = data[i];
    if (byte === 9 || byte === 10 || byte === 13 || byte === 32) continue;
    data[length++] = byte;
  }

  const multiplier = 0x5bd1e995;
  let hash = (1 ^ length) >>> 0;
  let offset = 0;
  let remaining = length;
  while (remaining >= 4) {
    let chunk = (data[offset] | (data[offset + 1] << 8) | (data[offset + 2] << 16) | (data[offset + 3] << 24)) >>> 0;
    chunk = Math.imul(chunk, multiplier);
    chunk ^= chunk >>> 24;
    chunk = Math.imul(chunk, multiplier);
    hash = (Math.imul(hash, multiplier) ^ chunk) >>> 0;
    offset += 4;
    remaining -= 4;
  }
  if (remaining >= 3) hash ^= data[offset + 2] << 16;
  if (remaining >= 2) hash ^= data[offset + 1] << 8;
  if (remaining >= 1) {
    hash ^= data[offset];
    hash = Math.imul(hash, multiplier) >>> 0;
  }
  hash ^= hash >>> 13;
  hash = Math.imul(hash, multiplier) >>> 0;
  hash ^= hash >>> 15;
  return hash >>> 0;
}

function getCurseForgeSha1(file) {
  const hashes = file?.hashes;
  if (Array.isArray(hashes)) {
    return hashes.find(hash => Number(hash?.algo) === 1)?.value || null;
  }
  if (hashes && typeof hashes === 'object') {
    return hashes.sha1 || hashes.SHA1 || null;
  }
  return null;
}

module.exports = {
  getCurseForgeSha1,
  getCurseForgeFingerprint,
  isCurseForgeServerCompatible,
  getCurseForgeSideLabel,
  getModrinthSideLabel,
  isModrinthServerCompatible,
  mapCurseForgeProjectType,
  normalizeContentLoader,
  selectCurseForgeFile,
  selectModrinthVersion,
};
