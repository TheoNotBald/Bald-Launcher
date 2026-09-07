'use strict';

function emptyAccountCosmetics() {
  return {
    skin: null,
    cape: null,
    official: { skin: null, cape: null, fetchedAt: 0, status: 'unknown', error: null },
    selected: { skin: null, cape: null },
    model: 'classic',
    favoriteSkins: [],
    favoriteCapes: [],
    recentlyUsedSkins: [],
    recentlyUsedCapes: [],
    importedSkins: [],
    importedCapes: [],
    createdSkins: [],
    createdCapes: [],
  };
}

function normalizeAccountCosmetics(value) {
  const source = value && typeof value === 'object' ? value : {};
  const cosmetics = emptyAccountCosmetics();
  const normalizeSkin = (entry, fallbackSource = 'local') => entry && typeof entry === 'object' ? {
    ...entry,
    id: String(entry.id || `skin-${Date.now()}`),
    model: ['classic', 'slim'].includes(entry.model) ? entry.model : 'classic',
    source: String(entry.source || fallbackSource),
  } : null;
  const normalizeCape = (entry, fallbackSource = 'local') => entry && typeof entry === 'object' ? {
    ...entry,
    id: String(entry.id || `cape-${Date.now()}`),
    source: String(entry.source || fallbackSource),
  } : null;
  const official = source.official && typeof source.official === 'object' ? source.official : {};
  const selected = source.selected && typeof source.selected === 'object' ? source.selected : {};
  cosmetics.official = {
    skin: normalizeSkin(official.skin, 'official'),
    cape: normalizeCape(official.cape, 'official'),
    fetchedAt: Number(official.fetchedAt) || 0,
    status: ['ready', 'loading', 'error', 'offline', 'unknown'].includes(official.status) ? official.status : 'unknown',
    error: official.error ? String(official.error) : null,
  };
  cosmetics.selected = {
    skin: normalizeSkin(selected.skin || (source.skin?.source === 'official' ? null : source.skin)),
    cape: normalizeCape(selected.cape || (source.cape?.source === 'official' ? null : source.cape)),
  };
  cosmetics.skin = cosmetics.selected.skin || cosmetics.official.skin;
  cosmetics.cape = cosmetics.selected.cape || cosmetics.official.cape;
  cosmetics.model = ['classic', 'slim'].includes(source.model) ? source.model : cosmetics.official.skin?.model || cosmetics.selected.skin?.model || 'classic';
  cosmetics.favoriteSkins = Array.isArray(source.favoriteSkins) ? source.favoriteSkins.slice(0, 200) : [];
  cosmetics.favoriteCapes = Array.isArray(source.favoriteCapes) ? source.favoriteCapes.slice(0, 200) : [];
  cosmetics.recentlyUsedSkins = Array.isArray(source.recentlyUsedSkins) ? source.recentlyUsedSkins.slice(0, 50) : [];
  cosmetics.recentlyUsedCapes = Array.isArray(source.recentlyUsedCapes) ? source.recentlyUsedCapes.slice(0, 50) : [];
  cosmetics.importedSkins = Array.isArray(source.importedSkins) ? source.importedSkins.slice(0, 200) : [];
  cosmetics.importedCapes = Array.isArray(source.importedCapes) ? source.importedCapes.slice(0, 200) : [];
  cosmetics.createdSkins = Array.isArray(source.createdSkins) ? source.createdSkins.slice(0, 200) : [];
  cosmetics.createdCapes = Array.isArray(source.createdCapes) ? source.createdCapes.slice(0, 200) : [];
  return cosmetics;
}

function ensureAccountCosmetics(accountLike) {
  const next = accountLike && typeof accountLike === 'object' ? accountLike : {};
  next.cosmetics = normalizeAccountCosmetics(next.cosmetics || {});
  return next;
}

function getAccountCosmetics(accountLike) {
  if (!accountLike || typeof accountLike !== 'object') return emptyAccountCosmetics();
  return normalizeAccountCosmetics(accountLike.cosmetics || {});
}

function setAccountSelection(accountLike, kind, entry) {
  const normalized = ensureAccountCosmetics(accountLike);
  const safeKind = kind === 'cape' ? 'cape' : 'skin';
  const value = entry && typeof entry === 'object' ? { ...entry } : null;
  normalized.cosmetics.selected[safeKind] = value ? { ...value, model: value.model || normalized.cosmetics.model || 'classic' } : null;
  normalized.cosmetics[safeKind] = normalized.cosmetics.selected[safeKind] || normalized.cosmetics.official[safeKind] || null;
  if (safeKind === 'skin' && value) {
    normalized.cosmetics.model = ['classic', 'slim'].includes(value.model) ? value.model : normalized.cosmetics.model || 'classic';
  }
  return normalized;
}

function pushRecentItem(accountLike, kind, entry) {
  const normalized = ensureAccountCosmetics(accountLike);
  const key = kind === 'cape' ? 'recentlyUsedCapes' : 'recentlyUsedSkins';
  const list = Array.isArray(normalized.cosmetics[key]) ? normalized.cosmetics[key] : [];
  const nextEntry = entry && typeof entry === 'object' ? { ...entry } : null;
  if (!nextEntry || !nextEntry.id) return normalized;
  normalized.cosmetics[key] = [nextEntry, ...list.filter(item => item && item.id && item.id !== nextEntry.id)].slice(0, 12);
  return normalized;
}

module.exports = {
  emptyAccountCosmetics,
  normalizeAccountCosmetics,
  ensureAccountCosmetics,
  getAccountCosmetics,
  setAccountSelection,
  pushRecentItem,
};
