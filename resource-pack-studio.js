'use strict';

(function () {
  const STORAGE_KEY = 'bald:resource-pack-studio:v3';
  const LEGACY_STORAGE_KEY = 'bald:resource-pack-studio:v2';
  const JAVA_VERSIONS = ['26.2', '26.1', '1.21.11', '1.21.4', '1.21.1', '1.20.6', '1.20.4', '1.20.1', '1.19.4', '1.18.2', '1.16.5', '1.12.2', '1.8.9', '1.7.10'];
  const RESOLUTIONS = [16, 32, 64, 128, 256, 512];
  const state = {
    view: 'library',
    activeProjectId: null,
    projects: [],
    catalog: [],
    catalogVersion: null,
    catalogError: null,
    libraryQuery: '',
    libraryFilter: 'All packs',
    librarySort: 'Recently edited',
    query: '',
    category: 'All resources',
    sort: 'Name (A-Z)',
    browserScrollTop: 0,
    selectedId: null,
    selectedPath: null,
    selectedTab: 'workspace',
    editorMode: 'texture',
    version: '1.21.4',
    packName: 'My Resource Pack',
    description: '',
    author: '',
    iconDataUrl: null,
    resolution: 16,
    scale: 1,
    color: '#72e64b',
    tool: 'pencil',
    brushSize: 1,
    opacity: 1,
    showGrid: true,
    showCheckerboard: true,
    symmetry: 'none',
    selection: null,
    clipboard: null,
    palette: [],
    modelOverrides: {},
    layers: {},
    animations: {},
    modelUndo: [],
    modelRedo: [],
    alphaLock: false,
    tiled: false,
    autoRotate: false,
    modelCameraZoom: 1,
    showModelGrid: true,
    showModelAxes: false,
    showModelBounds: false,
    modelInteractionMode: 'paint',
    animationPlaying: false,
    selectedElementIndex: null,
    selectedElementSide: null,
    cameraZoom: 1,
    buffers: {},
    textureDimensions: {},
    vanillaLoaded: {},
    modifiedResources: {},
    modelCache: {},
    modelDiagnostics: {},
    modelTextureCache: {},
    modelThumbnailCache: {},
    thumbnailCache: {},
    favorites: {},
    customResources: [],
    recentResources: [],
    looks: [],
    resourceLimit: 240,
    undo: [],
    redo: [],
    dirty: false,
    importSummary: null,
    requestGeneration: 0,
  };
  // Runtime-only cache: the resource id -> rank used by sort modes that
  // depend on mutable state (recency, modified time, favorites). It is
  // snapshotted explicitly (catalog load, sort/category change, a resource
  // becoming newly favorited/custom) rather than recomputed on every
  // render, so merely opening a resource to look at it does not reshuffle
  // the list out from under the user's scroll position. See computeSortOrder().
  let sortOrderRank = new Map();
  let catalogRequest = null;
  let modelThumbnailRenderer = null;
  let modelThumbnailCanvas = null;
  let modelThumbnailQueue = [];
  let modelThumbnailActive = 0;
  let modelThumbnailRenderQueue = Promise.resolve();
  const modelThumbnailRequests = new Map();
  const MODEL_THUMBNAIL_CONCURRENCY = 4;
  let preview = null;
  let previewGeneration = 0;
  let modelRebuildGeneration = 0;
  let activeHistoryAction = null;
  let activeModelHistoryAction = null;
  let selectionDrag = null;
  let smudgeCarry = null;
  let searchDebounceTimer = null;

  const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
  const now = () => new Date().toISOString();
  const project = () => state.projects.find(entry => entry.id === state.activeProjectId);
  // Do not implicitly select the first catalog entry: opening a pack should
  // show the browser first, matching the browse-then-edit workflow.
  const item = () => state.catalog.find(entry => entry.id === state.selectedId) || state.catalog.find(entry => entry.path === state.selectedPath) || null;
  const modifiedCount = pack => Object.keys(pack?.data?.modifiedResources || {}).length;
  // Category counts are computed straight from the actual loaded catalog,
  // never hard-coded — a version with a different resource set (or one still
  // loading) simply produces different numbers here.
  function categoryCounts() {
    const counts = new Map();
    state.catalog.forEach(entry => { const key = entry.category || 'Misc'; counts.set(key, (counts.get(key) || 0) + 1); });
    const names = [...counts.keys()].sort((left, right) => left.localeCompare(right));
    return [['All resources', state.catalog.length], ...names.map(name => [name, counts.get(name)])];
  }
  const resourcePath = entry => entry?.texturePath || (entry?.path?.match(/textures\/(.+\.png)$/)?.[1] || '');
  const textureAssetPath = entry => {
    const path = resourcePath(entry);
    if (!path) return entry?.path || `minecraft:${entry?.id || 'unknown'}`;
    return path.startsWith('assets/') ? path : `assets/minecraft/textures/${path}`;
  };
  // A resource only has a real Minecraft Java model file behind it (and
  // therefore a real UV-mapped 3D preview) when the catalog marked it as a
  // cube/item/model shape. Everything else (GUI, particles, fonts, misc,
  // colormaps, effects, plain entity textures, etc.) has no resource-pack
  // model JSON to resolve — showing the 3D pane for those would just spin
  // forever on a model request that can never succeed, which is exactly the
  // "fake it" failure mode the brief calls out.
  function hasMinecraftModel(entry) {
    return entry?.category === 'Blocks'
      ? Boolean(entry.minecraftId || entry.modelName)
      : entry?.shape === 'cube' || entry?.shape === 'item' || entry?.shape === 'model';
  }

  function defaultEditor(name, version) {
    return {
      version,
      packName: name,
      description: '',
      author: '',
      iconDataUrl: null,
      favorite: false,
      buffers: {},
      modifiedResources: {},
      favorites: {},
      customResources: [],
      recentResources: [],
      looks: [],
      resolution: 16,
      scale: 1,
      showGrid: true,
      palette: [],
      modelOverrides: {},
      layers: {},
      animations: {},
      importedEntries: [],
      dirty: false,
    };
  }

  // Buffers are persisted as base64 of their raw RGBA bytes rather than a
  // JSON array of numbers. A JSON array costs ~4-5 characters per byte; base64
  // costs ~1.33, so this alone cuts stored project size by roughly 3-4x and
  // keeps `persist()` well clear of the localStorage quota as packs grow past
  // a handful of edited textures. It stays synchronous (no PNG decode/async
  // Image round-trip) so the rest of the load/save flow doesn't need to change.
  function bufferToBase64(buffer) {
    if (!buffer || !buffer.length) return '';
    if (typeof buffer === 'string') return buffer;
    if (!buffer.subarray) buffer = Uint8ClampedArray.from(buffer);
    let binary = '';
    const chunkSize = 0x8000;
    for (let index = 0; index < buffer.length; index += chunkSize) {
      binary += String.fromCharCode.apply(null, buffer.subarray(index, Math.min(index + chunkSize, buffer.length)));
    }
    return btoa(binary);
  }

  function base64ToBuffer(base64) {
    if (!base64) return new Uint8ClampedArray(0);
    const binary = atob(base64);
    const buffer = new Uint8ClampedArray(binary.length);
    for (let index = 0; index < binary.length; index += 1) buffer[index] = binary.charCodeAt(index);
    return buffer;
  }

  function serializeEditor(editor) {
    if (!editor) return null;
    return { ...editor, buffers: Object.fromEntries(Object.entries(editor.buffers || {}).map(([key, value]) => [key, bufferToBase64(value)])) };
  }

  function reviveEditor(editor) {
    const revived = { ...editor };
    // Accepts both the current base64 format and the original (v2) raw
    // JSON-array format, so packs saved before this change keep loading.
    revived.buffers = Object.fromEntries(Object.entries(editor?.buffers || {}).map(([key, value]) => [
      key,
      typeof value === 'string' ? base64ToBuffer(value) : new Uint8ClampedArray(value || []),
    ]));
    revived.textureDimensions ||= {};
    revived.modifiedResources ||= {};
    revived.favorites ||= {};
    revived.customResources ||= [];
    revived.recentResources ||= [];
    revived.looks ||= [];
    revived.palette ||= [];
    revived.modelOverrides ||= {};
    revived.layers ||= {};
    revived.animations ||= {};
    return revived;
  }

  function persist() {
    syncProject();
    const snapshot = {
      projects: state.projects.map(entry => ({ ...entry, data: serializeEditor(entry.data) })),
      libraryQuery: state.libraryQuery,
      libraryFilter: state.libraryFilter,
      librarySort: state.librarySort,
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
    } catch (error) {
      // Surface this instead of letting it throw silently out of whatever UI
      // action triggered the save (painting, undo, importing, etc.).
      console.error('[ResourcePackStudio] Failed to save resource pack projects.', error);
      setStatus('Could not save changes locally (storage is full). Export this pack to avoid losing work.', true);
    }
  }

  function syncProject() {
    const current = project();
    if (!current || state.view === 'library') return;
    current.name = state.packName.trim() || 'Untitled Resource Pack';
    current.version = state.version;
    current.updatedAt = now();
    current.data = editorSnapshot();
  }

  function editorSnapshot() {
    return {
      version: state.version,
      packName: state.packName,
      description: state.description,
      author: state.author,
      iconDataUrl: state.iconDataUrl,
      favorite: state.favorite,
      buffers: state.buffers,
      textureDimensions: state.textureDimensions,
      modifiedResources: state.modifiedResources,
      favorites: state.favorites || {},
      customResources: state.customResources || [],
      recentResources: state.recentResources,
      looks: state.looks || [],
      resolution: state.resolution,
      scale: state.scale,
      showGrid: state.showGrid,
      palette: state.palette || [],
      modelOverrides: state.modelOverrides || {},
      layers: state.layers || {},
      animations: state.animations || {},
      importedEntries: state.importedEntries || [],
      dirty: state.dirty,
    };
  }

  function restore() {
    try {
      let raw = localStorage.getItem(STORAGE_KEY);
      let migratingFromV2 = false;
      if (!raw) {
        raw = localStorage.getItem(LEGACY_STORAGE_KEY);
        migratingFromV2 = Boolean(raw);
      }
      const parsed = JSON.parse(raw || 'null');
      if (!parsed) return;
      state.projects = (parsed.projects || []).map(entry => ({ ...entry, data: reviveEditor(entry.data || defaultEditor(entry.name, entry.version)) }));
      state.libraryQuery = parsed.libraryQuery || '';
      state.libraryFilter = parsed.libraryFilter || 'All packs';
      state.librarySort = parsed.librarySort || 'Recently edited';
      if (migratingFromV2) {
        // v2 stored texture buffers as raw JSON arrays; reviveEditor already
        // reads that format above. Re-save immediately in the compact v3
        // format under the new key. The old v2 entry is left untouched.
        console.info('[ResourcePackStudio] Migrated resource pack projects from storage v2 to v3.');
        persist();
      }
    } catch (error) {
      console.warn('Resource Pack Studio state could not be restored.', error);
    }
  }

  async function createProject(name, version, description = '', author = '', iconDataUrl = null) {
    syncProject();
    const id = `resource-pack-${Date.now()}`;
    const data = defaultEditor(name, version);
    data.description = description;
    data.author = author;
    data.iconDataUrl = iconDataUrl;
    state.projects.push({ id, name, version, createdAt: now(), updatedAt: now(), data });
    await openProject(id);
  }

  async function openProject(id) {
    stopAnimationPlayback();
    const selected = state.projects.find(entry => entry.id === id);
    if (!selected) return;
    state.requestGeneration += 1;
    const generation = state.requestGeneration;
    const editor = reviveEditor(selected.data || defaultEditor(selected.name, selected.version));
    Object.assign(state, editor, {
      view: 'browser',
      activeProjectId: id,
      version: selected.version || editor.version || '1.21.4',
      packName: selected.name || editor.packName,
      // Seed the catalog with the project's own custom/imported resources
      // immediately so they're visible even before the vanilla catalog
      // finishes loading, and so they never depend on that network/IPC
      // round-trip to exist in the browser at all.
      catalog: [...(editor.customResources || [])],
      catalogVersion: null,
      selectedId: null,
      selectedPath: null,
      query: '',
      category: 'All resources',
      browserScrollTop: 0,
      selectedTab: 'workspace',
      undo: [],
      redo: [],
      modelUndo: [],
      modelRedo: [],
      selectedElementIndex: null,
      selectedElementSide: null,
    });
    sortOrderRank = new Map();
    computeSortOrder();
    persist();
    render();
    try {
      await loadCatalog(state.version, generation);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error), true);
    }
  }

  function openLibrary() {
    stopAnimationPlayback(); // leaving the editor entirely -- never leave a playback timer running
    syncProject();
    state.view = 'library';
    state.activeProjectId = null;
    persist();
    render();
  }

  function openBrowser() {
    if (!project()) return openLibrary();
    stopAnimationPlayback();
    syncProject();
    state.view = 'browser';
    persist();
    render();
  }

  async function duplicateProject(id) {
    const source = state.projects.find(entry => entry.id === id);
    if (!source) return;
    const copy = JSON.parse(JSON.stringify(source));
    copy.id = `resource-pack-${Date.now()}`;
    copy.name = `${source.name} Copy`;
    copy.createdAt = now();
    copy.updatedAt = copy.createdAt;
    state.projects.push(copy);
    persist();
    render();
  }

  function deleteProject(id) {
    const selected = state.projects.find(entry => entry.id === id);
    if (!selected || !window.confirm(`Delete "${selected.name}"? This cannot be undone.`)) return;
    state.projects = state.projects.filter(entry => entry.id !== id);
    persist();
    render();
  }

  function togglePackFavorite(id) {
    const selected = state.projects.find(entry => entry.id === id);
    if (!selected) return;
    selected.data ||= defaultEditor(selected.name, selected.version);
    selected.data.favorite = !selected.data.favorite;
    selected.updatedAt = now();
    persist();
    render();
  }

  async function loadCatalog(version, generation = state.requestGeneration) {
    if (!window.launcherAPI?.getResourcePackCatalog) return;
    state.catalogError = null;
    if (catalogRequest && state.catalogVersion === version) return catalogRequest;
    catalogRequest = window.launcherAPI.getResourcePackCatalog(version).then(result => {
      if (!result?.ok || !Array.isArray(result.catalog)) throw new Error(result?.error || `No vanilla resources were found for Minecraft ${version}.`);
      if (generation !== state.requestGeneration || state.version !== version) return;
      state.catalogError = null;
      // Custom/imported project resources are not part of the vanilla
      // catalog response and must never be dropped when it (re)loads.
      const customIds = new Set((state.customResources || []).map(entry => entry.id));
      state.catalog = [...(state.customResources || []), ...result.catalog.filter(entry => !customIds.has(entry.id))];
      state.catalogVersion = version;
      if (state.selectedId && !state.catalog.some(entry => entry.id === state.selectedId)) {
        state.selectedId = null;
        state.selectedPath = null;
      }
      computeSortOrder();
      render();
    }).catch(error => {
      if (generation !== state.requestGeneration || state.version !== version) return;
      state.catalog = [];
      state.catalogVersion = version;
      state.catalogError = error.message;
      render();
      setStatus(error.message, true);
    }).finally(() => { catalogRequest = null; });
    return catalogRequest;
  }

  const SORT_MODES = ['Name (A-Z)', 'Name (Z-A)', 'Recently modified', 'Recently used', 'Favorites first', 'Resource type'];

  function filteredResources() {
    const query = state.query.trim().toLowerCase();
    const results = state.catalog.filter(entry => {
      if (state.category !== 'All resources' && entry.category !== state.category) return false;
      if (!query) return true;
      return [entry.name, entry.id, entry.path, entry.category, entry.browseCategory, entry.modelName].some(value => String(value || '').toLowerCase().includes(query));
    });
    return results.sort((left, right) => {
      const byName = (leftEntry, rightEntry) => String(leftEntry.name).localeCompare(String(rightEntry.name));
      if (state.sort === 'Name (A-Z)') return byName(left, right);
      if (state.sort === 'Name (Z-A)') return byName(right, left);
      if (state.sort === 'Resource type') return String(left.category || '').localeCompare(String(right.category || '')) || byName(left, right);
      if (state.sort === 'Favorites first') {
        const favoriteDelta = Number(Boolean(state.favorites[right.id])) - Number(Boolean(state.favorites[left.id]));
        if (favoriteDelta) return favoriteDelta;
        return sortRank(left) - sortRank(right) || byName(left, right);
      }
      // 'Recently modified' / 'Recently used': ranked from the snapshot taken
      // at the last explicit catalog/sort/category change (see
      // computeSortOrder), not recomputed live, so viewing/editing a resource
      // does not silently reorder the list the user is currently scrolled
      // through.
      return sortRank(left) - sortRank(right) || byName(left, right);
    });
  }

  function sortRank(entry) {
    const rank = sortOrderRank.get(entry.id);
    return rank === undefined ? -1 : rank; // unranked (e.g. brand new) sorts first
  }

  // Recomputes the snapshot used by recency/favorite-aware sort modes. Call
  // this on catalog load and on explicit sort/category changes only â€”
  // never from selectResource/markModified, or the act of opening or
  // editing a resource would reshuffle the list under the user.
  function computeSortOrder() {
    const list = [...state.catalog];
    if (state.sort === 'Recently used') {
      list.sort((left, right) => recentIndex(left) - recentIndex(right));
    } else {
      // 'Recently modified' and every other mode fall back to modified-time
      // ranking here; Name/Type/Favorites modes don't consult this map.
      list.sort((left, right) => modifiedRank(left) - modifiedRank(right));
    }
    sortOrderRank = new Map(list.map((entry, index) => [entry.id, index]));
  }

  function recentIndex(entry) {
    const index = state.recentResources.indexOf(entry.id);
    return index < 0 ? Number.MAX_SAFE_INTEGER : index;
  }

  function modifiedTimestamp(entry) {
    const value = state.modifiedResources[entry?.path] ?? state.modifiedResources[resourcePath(entry)] ?? state.modifiedResources[entry?.id];
    return typeof value === 'number' ? value : (value ? 0 : null);
  }

  function modifiedRank(entry) {
    const timestamp = modifiedTimestamp(entry);
    return timestamp === null ? Number.MAX_SAFE_INTEGER : -timestamp; // most-recently-modified first
  }

  function isModified(entry) {
    return modifiedTimestamp(entry) !== null;
  }

  function filteredProjects() {
    const query = state.libraryQuery.trim().toLowerCase();
    const results = state.projects.filter(entry => {
      if (state.libraryFilter === 'Favorites' && !entry.data?.favorite) return false;
      if (state.libraryFilter === 'Modified' && modifiedCount(entry) === 0) return false;
      return !query || [entry.name, entry.version, entry.data?.author, modifiedCount(entry)].some(value => String(value || '').toLowerCase().includes(query));
    });
    return results.sort((left, right) => {
      if (state.librarySort === 'Name') return left.name.localeCompare(right.name);
      if (state.librarySort === 'Most modified') return modifiedCount(right) - modifiedCount(left);
      if (state.librarySort === 'Recently created') return new Date(right.createdAt) - new Date(left.createdAt);
      return new Date(right.updatedAt) - new Date(left.updatedAt);
    });
  }

  function versionOptions(selected) {
    return [...new Set([selected, ...JAVA_VERSIONS])].filter(Boolean).map(version => `<option value="${esc(version)}"${version === selected ? ' selected' : ''}>${esc(version)}</option>`).join('');
  }

  function render() {
    const root = document.getElementById('resourcePackStudioRoot');
    if (!root) return;
    const browser = root.querySelector('.rp-browser');
    const activeSearch = document.activeElement?.id === 'rpSearch' ? document.activeElement : null;
    const searchSelection = activeSearch ? [activeSearch.selectionStart, activeSearch.selectionEnd] : null;
    root.style.maxWidth = 'none';
    root.style.padding = '0';
    root.innerHTML = state.view === 'library' ? renderLibrary() : state.view === 'browser' ? renderBrowser() : renderEditor();
    if (state.view === 'library') bindLibraryEvents();
    else if (state.view === 'browser') bindBrowserEvents();
    else bindEditorEvents();
    if (state.view === 'browser') {
      const nextBrowser = root.querySelector('.rp-browser');
      if (nextBrowser) nextBrowser.scrollTop = state.browserScrollTop;
      if (searchSelection) {
        const nextSearch = root.querySelector('#rpSearch');
        if (nextSearch) { nextSearch.focus(); nextSearch.setSelectionRange(searchSelection[0], searchSelection[1]); }
      }
      loadVisibleThumbnails();
    }
  }

  function renderLibrary() {
    const packs = filteredProjects();
    return `
      <section class="rp-shell">
        <header class="rp-topbar">
          <div><div class="rp-eyebrow">BALD LAUNCHER / RESOURCE PACKS</div><h1>Resource Pack Studio</h1><p>Build, browse, and install Java resource packs without leaving the launcher.</p></div>
          <div class="rp-toolbar"><button class="modal-btn" data-rp-action="import">Import ZIP</button><button class="modal-btn primary" data-rp-action="show-create" onclick="window.resourcePackStudio?.showCreateForm?.()">Create resource pack</button></div>
        </header>
        <div class="rp-library-controls">
          <input class="modal-input" id="rpLibrarySearch" placeholder="Search your packs..." value="${esc(state.libraryQuery)}">
          <div class="rp-segment">${['All packs', 'Favorites', 'Modified'].map(filter => `<button class="${state.libraryFilter === filter ? 'active' : ''}" data-rp-filter="${esc(filter)}">${esc(filter)}</button>`).join('')}</div>
          <select class="modal-select" id="rpLibrarySort">${['Recently edited', 'Recently created', 'Name', 'Most modified'].map(sort => `<option${sort === state.librarySort ? ' selected' : ''}>${sort}</option>`).join('')}</select>
        </div>
        <div id="rpCreateCard" class="rp-create-card" hidden>
          <div class="rp-section-title">Start a new pack</div>
          <div class="rp-create-grid">
            <label>Pack name<input class="modal-input" id="rpNewName" value="My Resource Pack"></label>
            <label>Minecraft Java version<select class="modal-select" id="rpNewVersion">${versionOptions(state.version)}</select></label>
            <label>Description <span class="rp-optional">optional</span><input class="modal-input" id="rpNewDescription" placeholder="Short description"></label>
            <label>Author <span class="rp-optional">optional</span><input class="modal-input" id="rpNewAuthor" placeholder="Your name"></label>
            <label>Pack icon <span class="rp-optional">optional PNG</span><input class="modal-input" id="rpNewIcon" type="file" accept="image/png"></label>
          </div>
          <div class="rp-create-actions"><button class="modal-btn" data-rp-action="hide-create">Cancel</button><button class="modal-btn primary" data-rp-action="create" onclick="window.resourcePackStudio?.createFromForm?.()">Create and open</button></div>
        </div>
        <div class="rp-library-heading"><div><div class="rp-section-title">Your resource packs</div><div class="rp-muted">${packs.length} pack${packs.length === 1 ? '' : 's'} · each project remembers its Minecraft version</div></div></div>
        <div class="rp-pack-grid">${packs.map(renderPackCard).join('') || `<div class="rp-empty"><strong>No resource packs yet</strong><span>Create a pack to start browsing vanilla resources for a specific Minecraft version.</span><button class="modal-btn primary" data-rp-action="show-create" onclick="window.resourcePackStudio?.showCreateForm?.()">Create resource pack</button></div>`}</div>
      </section>`;
  }

  function renderPackCard(entry) {
    const iconDataUrl = getPackIconDataUrl(entry);
    const icon = iconDataUrl
      ? `<img src="${esc(iconDataUrl)}" alt="" class="rp-pack-icon" onerror="this.hidden=true;this.nextElementSibling.hidden=false"><div class="rp-pack-icon rp-pack-icon-empty" hidden>◆</div>`
      : '<div class="rp-pack-icon rp-pack-icon-empty">◆</div>';
    return `<article class="rp-pack-card">
      <div class="rp-pack-card-head">${icon}<div class="rp-pack-card-title"><strong>${esc(entry.name)}</strong><span>Minecraft Java ${esc(entry.version)}</span></div><button class="rp-icon-button" data-rp-favorite="${esc(entry.id)}">${entry.data?.favorite ? '♥' : '♡'}</button></div>
      <p>${esc(entry.data?.description || 'No description yet.')}</p>
      <div class="rp-pack-stats"><span>${modifiedCount(entry)} modified</span><span>Edited ${relativeDate(entry.updatedAt)}</span></div>
      <div class="rp-card-actions"><button class="modal-btn primary" data-rp-open="${esc(entry.id)}" onclick="window.resourcePackStudio?.openProject?.('${esc(entry.id)}')">Browse</button><button class="modal-btn" data-rp-export="${esc(entry.id)}">Export</button><button class="modal-btn" data-rp-install="${esc(entry.id)}">Install</button></div>
      <div class="rp-card-actions rp-card-actions-secondary"><button class="rp-text-button" data-rp-rename="${esc(entry.id)}">Rename</button><button class="rp-text-button" data-rp-duplicate="${esc(entry.id)}">Duplicate</button><button class="rp-text-button" data-rp-delete="${esc(entry.id)}">Delete</button></div>
    </article>`;
  }

  function getPackIconDataUrl(entry) {
    const direct = String(entry?.data?.iconDataUrl || '');
    if (/^data:image\/png;base64,[a-z0-9+/=]+$/i.test(direct)) return direct;
    const iconEntry = (entry?.data?.importedEntries || [])
      .filter(item => /(?:^|\/)pack\.png$/i.test(String(item?.path || '')))
      .sort((left, right) => String(left.path).length - String(right.path).length)[0];
    const imported = String(iconEntry?.data || '');
    return /^data:image\/png;base64,[a-z0-9+/=]+$/i.test(imported) ? imported : '';
  }

  function renderBrowser() {
    const categories = categoryCounts();
    const resources = filteredResources();
    const visible = resources.slice(0, state.resourceLimit);
    const tabs = [['workspace', 'Browse assets'], ['looks', 'Snapshots'], ['files', 'Pack files']];
    return `<div class="rp-studio rp-catalog-view">
      <header class="rp-editor-bar rp-catalog-bar">
        <div class="rp-editor-nav">
          <button class="rp-back" data-rp-action="library" title="Back to resource packs">&larr; Packs</button>
          <div class="rp-editor-title"><strong>${esc(state.packName)}</strong><span>Minecraft Java ${esc(state.version)}</span></div>
          <span class="rp-save-state">${state.dirty ? 'Unsaved changes' : 'Saved'}</span>
        </div>
        <div class="rp-toolbar">
          <button class="modal-btn" data-rp-action="metadata">Pack settings</button>
          <button class="modal-btn" data-rp-action="save">Save</button>
          <button class="modal-btn" data-rp-action="export">Export ZIP</button>
          <button class="modal-btn primary" data-rp-action="install">Install to profile</button>
        </div>
      </header>
      <div class="rp-tabs">${tabs.map(([id, label]) => `<button class="${state.selectedTab === id ? 'active' : ''}" data-rp-tab="${id}">${esc(label)}</button>`).join('')}</div>
      ${state.selectedTab !== 'workspace' ? renderProjectTab() : `
      <div class="rp-catalog-layout">
        <aside class="rp-catalog-sidebar">
          <div class="rp-catalog-sidebar-heading"><strong>Categories</strong><span>${state.catalog.length} assets</span></div>
          <nav class="rp-category-list" aria-label="Resource categories">
            ${categories.map(([name, count]) => `<button class="rp-category-button${state.category === name ? ' active' : ''}" data-rp-category="${esc(name)}"><span>${esc(name)}</span><small>${count}</small></button>`).join('')}
          </nav>
        </aside>
        <section class="rp-catalog-content">
          <div class="rp-catalog-toolbar">
            <label class="rp-catalog-search"><span>Search textures</span><input class="modal-input rp-search" id="rpSearch" placeholder="Search blocks, items, mobs, or GUI..." value="${esc(state.query)}"></label>
            <div class="rp-catalog-toolbar-actions">
              <span class="rp-resource-count">${resources.length} result${resources.length === 1 ? '' : 's'}${state.catalogError ? ' &middot; catalog error' : ''}</span>
              <select class="modal-select" id="rpSort" aria-label="Sort resources">${SORT_MODES.map(sort => `<option${sort === state.sort ? ' selected' : ''}>${esc(sort)}</option>`).join('')}</select>
              <button class="modal-btn" data-rp-action="new-custom-texture">+ Custom</button>
              <button class="modal-btn" data-rp-action="upload-texture">Upload PNG</button>
              <input type="file" id="rpUploadTexture" accept="image/png" hidden>
            </div>
          </div>
          <div class="rp-browser">
            <div class="rp-resource-grid">
              ${visible.map(renderResourceTile).join('') || (state.catalogError ? `<div class="rp-empty-small">${esc(state.catalogError)}</div>` : '<div class="rp-empty-small">No resources match this search.</div>')}
            </div>
            ${resources.length > visible.length ? '<button class="modal-btn rp-load-more" data-rp-action="load-more-resources">Load more resources</button>' : ''}
          </div>
        </section>
      </div>`}
    </div>`;
  }

  function renderEditor() {
    const current = item();
    if (!current) return `<div class="rp-studio rp-resource-editor"><div class="rp-stage-empty"><strong>No resource selected</strong><button class="modal-btn" data-rp-action="browser">Back to browser</button></div></div>`;
    return `<div class="rp-studio rp-resource-editor">
      <header class="rp-editor-bar">
        <div class="rp-editor-nav">
          <button class="rp-back" data-rp-action="browser" title="Back to texture browser">&larr; Back</button>
          <div class="rp-editor-title"><strong>${esc(current.name)}</strong><span>textures/${esc(resourcePath(current) || current.path?.split('/').pop() || current.id)}</span></div>
          <span class="rp-editor-category">${esc(current.category || 'Resource')}</span>
        </div>
        <div class="rp-toolbar">
          <span class="rp-save-state">${state.dirty ? 'Unsaved changes' : 'Saved'}</span>
          <button class="modal-btn" data-rp-action="save">Save</button>
          <button class="modal-btn" data-rp-action="export">Export ZIP</button>
          <button class="modal-btn primary" data-rp-action="install">Install to profile</button>
        </div>
      </header>
      ${renderTextureToolbar()}
      <div class="rp-workspace">
        <div class="rp-edit-stage">${renderSelectedResource(current)}</div>
        <div class="rp-inspector">${renderInspector(current)}</div>
      </div>`;
  }

  function renderProjectTab() {
    if (state.selectedTab === 'looks') {
      const looks = state.looks || [];
      return `<div class="rp-project-tab">
        <div class="rp-eyebrow">PACK SNAPSHOTS</div>
        <h2>Saved snapshots</h2>
        <p>Save a named snapshot of every edited texture in this pack and switch back to it later. This is a whole-pack checkpoint, not per-block Java blockstate/named-look variants yet &mdash; that export-time wiring isn't implemented.</p>
        <div class="rp-look-grid">${looks.length ? looks.map(look => `<button class="rp-look-card" data-rp-load-look="${esc(look.id)}"><strong>${esc(look.name)}</strong><span>${esc(relativeDate(look.createdAt))} &middot; ${Object.keys(look.buffers || {}).length} textures</span></button>`).join('') : '<div class="rp-empty-small">No snapshots saved yet.</div>'}</div>
        <div class="rp-create-actions"><button class="modal-btn primary" data-rp-action="save-look">Save current state as a snapshot</button></div>
      </div>`;
    }
    return `<div class="rp-project-tab"><div class="rp-eyebrow">PACK CONTENTS</div><h2>Pack files</h2><p>Imported files and generated assets that will be included in the next export.</p><div class="rp-file-list">${(project()?.data?.importedEntries || []).map(entry => `<div><span>${esc(entry.path)}</span><small>Imported</small></div>`).join('') || '<div class="rp-empty-small">No additional files imported yet.</div>'}</div><button class="modal-btn" data-rp-action="import">Import ZIP contents</button></div>`;
  }

  function renderResourceTile(entry) {
    const selected = entry.id === state.selectedId;
    const modified = isModified(entry);
    const favorite = Boolean(state.favorites[entry.id]);
    const role = resourceRole(entry);
    const resourceId = resourceIdentityLabel(entry);
    return `<button class="rp-resource-tile${selected ? ' selected' : ''}" data-rp-resource="${esc(entry.id)}" title="${esc(`${entry.name} · ${role} · ${resourceId}`)}">
      <span class="rp-thumb">${texturePreview(entry)}<span class="rp-resource-role">${esc(role)}</span></span><span class="rp-tile-name">${esc(entry.name)}</span><span class="rp-tile-id">${esc(resourceId)}</span>${modified ? '<i class="rp-modified-dot"></i>' : ''}${favorite ? '<span class="rp-favorite-mark">♥</span>' : ''}</button>`;
  }

  function resourceIdentityLabel(entry) {
    if (entry.minecraftId) return `minecraft:${entry.minecraftId}`;
    if (entry.custom) return entry.path || entry.id;
    if (entry.id.startsWith('jar_')) return entry.texturePath || entry.path || entry.id;
    return `minecraft:${entry.id}`;
  }

  function resourceRole(entry) {
    if (entry.custom) return 'CUSTOM';
    if (entry.category === 'Blocks') return 'BLOCK';
    if (entry.category === 'Items') return 'HELD ITEM';
    if (entry.category === 'Entity Textures') return 'ENTITY';
    if (entry.category === 'HUD & Menus') return 'GUI';
    if (entry.category === 'Mob Effects') return 'EFFECT';
    return String(entry.category || 'TEXTURE').replace(/\s+Textures?$/i, '').toUpperCase();
  }

  function texturePreview(entry) {
    const modelThumbnail = shouldUseModelThumbnail(entry) ? state.modelThumbnailCache[modelThumbnailKey(entry)] : null;
    if (modelThumbnail?.dataUrl) return `<img src="${modelThumbnail.dataUrl}" alt="" class="rp-thumb-image rp-model-thumb-image">`;
    const buffer = state.buffers[bufferKey(entry)];
    if (buffer) {
      const canvas = document.createElement('canvas');
      const dimensions = dimensionsFor(entry);
      canvas.width = dimensions.width; canvas.height = dimensions.height;
      canvas.getContext('2d').putImageData(createImageData(entry), 0, 0);
      return `<img src="${canvas.toDataURL()}" alt="" class="rp-thumb-image">`;
    }
    const cached = state.thumbnailCache[entry.id];
    return cached?.dataUrl ? `<img src="${cached.dataUrl}" alt="" class="rp-thumb-image">` : `<span class="rp-thumb-placeholder">${cached?.error ? 'Asset unavailable' : 'Loading…'}</span>`;
  }

  async function loadThumbnail(entry, tile) {
    if (!entry) return;
    if (shouldUseModelThumbnail(entry)) {
      loadModelThumbnail(entry, tile);
      return;
    }
    if (state.thumbnailCache[entry.id] || !window.launcherAPI?.getResourcePackAsset) return;
    const path = resourcePath(entry);
    if (!path) {
      state.thumbnailCache[entry.id] = { error: true };
      if (tile) tile.querySelector('.rp-thumb').innerHTML = '<span class="rp-thumb-placeholder">Asset unavailable</span>';
      return;
    }
    const generation = state.requestGeneration;
    const result = await window.launcherAPI.getResourcePackAsset(state.version, path);
    if (generation !== state.requestGeneration) return;
    state.thumbnailCache[entry.id] = result?.ok ? { dataUrl: result.dataUrl } : { error: true };
    if (!tile?.isConnected) return;
    tile.querySelector('.rp-thumb').innerHTML = result?.ok
      ? `<img src="${result.dataUrl}" alt="" class="rp-thumb-image">`
      : '<span class="rp-thumb-placeholder">Asset unavailable</span>';
  }

  const shouldUseModelThumbnail = entry => entry?.category === 'Blocks' && Boolean(entry.modelName);
  const modelThumbnailKey = entry => `${state.version}:${entry?.id || entry?.path || 'missing'}:${entry?.modelName || ''}`;

  function setModelThumbnailTile(tile, dataUrl, message) {
    if (!tile?.isConnected) return;
    const thumb = tile.querySelector('.rp-thumb');
    if (!thumb) return;
    const badge = thumb.querySelector('.rp-resource-role');
    thumb.innerHTML = dataUrl
      ? `<img src="${dataUrl}" alt="" class="rp-thumb-image rp-model-thumb-image">`
      : `<span class="rp-thumb-placeholder">${esc(message || '3D preview unavailable')}</span>`;
    if (badge) thumb.appendChild(badge);
  }

  function scheduleModelThumbnail(task) {
    return new Promise((resolve, reject) => {
      modelThumbnailQueue.push({ task, resolve, reject });
      pumpModelThumbnailQueue();
    });
  }

  function pumpModelThumbnailQueue() {
    while (modelThumbnailActive < MODEL_THUMBNAIL_CONCURRENCY && modelThumbnailQueue.length) {
      const job = modelThumbnailQueue.shift();
      modelThumbnailActive += 1;
      Promise.resolve().then(job.task).then(job.resolve, job.reject).finally(() => {
        modelThumbnailActive -= 1;
        pumpModelThumbnailQueue();
      });
    }
  }

  function loadModelThumbnail(entry, tile) {
    const key = modelThumbnailKey(entry);
    const cached = state.modelThumbnailCache[key];
    if (cached) {
      if (cached.dataUrl || cached.error) setModelThumbnailTile(tile, cached.dataUrl, cached.error ? '3D preview unavailable' : '');
      return;
    }
    if (modelThumbnailRequests.has(key)) return;
    const version = state.version;
    const projectId = state.activeProjectId;
    const requestGeneration = state.requestGeneration;
    const task = scheduleModelThumbnail(async () => {
      const model = await loadCatalogModel(entry, version, projectId);
      if (version !== state.version || projectId !== state.activeProjectId || requestGeneration !== state.requestGeneration) return;
      if (!model) {
        const dataUrl = await matchingHeldItemPreview(entry, version, projectId);
        state.modelThumbnailCache[key] = dataUrl ? { dataUrl } : { error: true };
        setModelThumbnailTile(tile, dataUrl, dataUrl ? '' : '3D preview unavailable');
        return;
      }
      const meshes = buildModelMeshes(model, entry, true);
      if (!meshes.length) {
        const dataUrl = await matchingHeldItemPreview(entry, version, projectId);
        state.modelThumbnailCache[key] = dataUrl ? { dataUrl } : { error: true };
        setModelThumbnailTile(tile, dataUrl, dataUrl ? '' : '3D preview unavailable');
        return;
      }
      const pendingTextures = meshes.flatMap(mesh => {
        const materialList = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        return materialList.map(material => material?.map?.userData?.loadPromise).filter(Boolean);
      });
      if (pendingTextures.length) await Promise.all(pendingTextures);
      if (version !== state.version || projectId !== state.activeProjectId || requestGeneration !== state.requestGeneration) {
        disposeModelThumbnailMeshes(meshes);
        return;
      }
      let dataUrl;
      const renderTask = modelThumbnailRenderQueue.then(() => renderModelThumbnail(meshes));
      modelThumbnailRenderQueue = renderTask.catch(() => null);
      try {
        dataUrl = await renderTask;
      } finally {
        disposeModelThumbnailMeshes(meshes);
      }
      state.modelThumbnailCache[key] = dataUrl ? { dataUrl } : { error: true };
      setModelThumbnailTile(tile, dataUrl, dataUrl ? '' : '3D preview unavailable');
    }).catch(error => {
      console.warn('[ResourcePackStudio] Model thumbnail failed.', { entryId: entry.id, error: error?.message || String(error) });
      state.modelThumbnailCache[key] = { error: true };
      setModelThumbnailTile(tile, null, '3D preview unavailable');
    }).finally(() => modelThumbnailRequests.delete(key));
    modelThumbnailRequests.set(key, task);
  }

  async function matchingHeldItemPreview(entry, version, projectId) {
    if (!entry.minecraftId || !window.launcherAPI?.getResourcePackAsset) return null;
    const itemIds = new Set([entry.minecraftId, entry.minecraftId.replace(/_wall_/, '_')]);
    const itemEntry = state.catalog.find(candidate => candidate.category === 'Items' && itemIds.has(candidate.minecraftId));
    if (!itemEntry) return null;
    const result = await window.launcherAPI.getResourcePackAsset(version, resourcePath(itemEntry));
    if (version !== state.version || projectId !== state.activeProjectId) return null;
    return result?.ok ? result.dataUrl : null;
  }

  async function loadCatalogModel(entry, version, projectId) {
    if (state.modelOverrides[entry.id]) return state.modelOverrides[entry.id];
    const key = modelKey(entry);
    if (state.modelCache[key]) return state.modelCache[key];
    const result = await resolveEntryModel(entry);
    if (version !== state.version || projectId !== state.activeProjectId) return null;
    if (!result.data || !Object.keys(result.data).length) return null;
    state.modelDiagnostics[entry.id] = result.missingParent
      ? { state: 'parent-missing', message: `Parent model "${result.missingParent}" could not be found -- showing what did resolve.` }
      : result.diagnostic || null;
    state.modelCache[key] = result.data;
    return result.data;
  }

  function loadVisibleThumbnails() {
    const browser = document.querySelector('#resourcePackStudioRoot .rp-browser');
    if (!browser) return;
    const tiles = [...browser.querySelectorAll('[data-rp-resource]')];
    const load = tile => {
      const entry = state.catalog.find(candidate => candidate.id === tile.dataset.rpResource);
      if (entry) loadThumbnail(entry, tile);
    };
    // Keep the first render bounded. More thumbnails are loaded as the user
    // scrolls instead of starting hundreds of IPC/network requests at once.
    tiles.slice(0, 24).forEach(load);
    if (!('IntersectionObserver' in window)) return;
    const observer = new IntersectionObserver(entries => entries.filter(entry => entry.isIntersecting).forEach(entry => {
      load(entry.target);
      observer.unobserve(entry.target);
    }), { root: browser, rootMargin: '120px' });
    tiles.slice(24).forEach(tile => observer.observe(tile));
  }

  function renderSelectedResource(entry) {
    const resetAction = entry.custom
      ? '<button class="modal-btn" data-rp-action="delete-custom">Delete custom texture</button>'
      : '<button class="modal-btn" data-rp-action="reset">Reset vanilla</button>';
    // Only resources with a real, resolvable Minecraft model file get the 3D
    // pane. Everything else (GUI, particles, fonts, misc, colormaps,
    // effects, plain entity/custom textures) gets an honest note instead of
    // a model viewport that would spin on a request that can never resolve.
    const modelPane = hasMinecraftModel(entry)
      ? `<div class="rp-unified-model">${renderModelEditor(entry)}</div>`
      : `<div class="rp-unified-model rp-model-unavailable"><div class="rp-model-editor"><div class="rp-model-editor-head"><div><div class="rp-eyebrow">NO JAVA MODEL FILE</div><h3>2D-only resource</h3><p>${esc(entry.category)} resources of this type aren't backed by a block/item model JSON in the resource-pack format, so there's no real 3D geometry to preview here &mdash; only the flat texture. Editing the texture below still updates the exported resource correctly.</p></div></div></div></div>`;
    return `<div class="rp-edit-header"><div><div class="rp-eyebrow">${esc(entry.category)} / ${esc(entry.shape || 'RESOURCE')}</div><h2>${esc(entry.name)}</h2><span>${esc(textureAssetPath(entry))}</span></div><div class="rp-resource-actions"><button class="rp-icon-button" data-rp-action="favorite-resource">${state.favorites[entry.id] ? '♥' : '♡'}</button>${resetAction}</div></div>
      <div class="rp-unified-editor">
        ${modelPane}
        <div class="rp-unified-texture">${renderTextureEditor(entry)}</div>
      </div>`;
  }

  function renderTextureEditor(entry) {
    const symmetryLabels = { none: 'Symmetry: off', horizontal: 'Symmetry: ↔', vertical: 'Symmetry: ↕', both: 'Symmetry: ↔↕' };
    const selection = state.selection;
    const selectionActions = state.tool === 'select' ? `<div class="rp-canvas-options"><span class="rp-check">${selection ? `Selection ${selection.w}×${selection.h}` : 'Drag on the canvas to select a region'}</span>${selection ? `<button class="modal-btn" data-rp-action="selection-copy">Copy</button><button class="modal-btn" data-rp-action="selection-cut">Cut</button><button class="modal-btn" data-rp-action="selection-duplicate">Duplicate</button><button class="modal-btn" data-rp-action="selection-delete">Delete</button>` : ''}${state.clipboard ? `<button class="modal-btn" data-rp-action="selection-paste">Paste</button>` : ''}${selection ? `<button class="rp-icon-button" data-rp-action="selection-clear" title="Deselect">✕</button>` : ''}</div>` : '';
    return `<div class="rp-canvas-panel">
      ${renderLayers(entry)}
      ${renderAnimation(entry)}
      <div class="rp-canvas-options"><label class="rp-check"><input id="rpGrid" type="checkbox"${state.showGrid ? ' checked' : ''}> Pixel grid</label><button class="rp-option-toggle ${state.showCheckerboard ? 'active' : ''}" data-rp-toggle="showCheckerboard">Checkerboard</button><button class="rp-option-toggle ${state.symmetry !== 'none' ? 'active' : ''}" data-rp-action="cycle-symmetry" title="Click to cycle">${symmetryLabels[state.symmetry] || symmetryLabels.none}</button><button class="rp-option-toggle ${state.alphaLock ? 'active' : ''}" data-rp-toggle="alphaLock">Alpha lock</button><button class="rp-option-toggle ${state.tiled ? 'active' : ''}" data-rp-toggle="tiled">Tiled</button><button class="rp-icon-button" data-rp-action="zoom-out" title="Zoom out">&minus;</button><span class="rp-zoom-label">Zoom ${Math.round(state.cameraZoom * 100)}%</span><button class="rp-icon-button" data-rp-action="zoom-in" title="Zoom in">+</button><button class="rp-icon-button" data-rp-action="zoom-reset" title="Reset zoom to 100%">&#8635;</button></div>
      ${selectionActions}
      <div class="rp-canvas-wrap${state.showCheckerboard ? '' : ' rp-no-checkerboard'}"><div class="rp-canvas-scroll" id="rpCanvasScroll" style="overflow:auto;width:100%;height:100%;max-width:100%;max-height:100%;"><canvas id="rpPaintCanvas" width="256" height="256"></canvas></div><div class="rp-canvas-caption">Drag to paint &middot; right-click or Eraser removes pixels &middot; Pan tool drags the view &middot; wheel zooms</div>${state.tiled ? '<div class="rp-tiled-preview"><canvas id="rpTiledPreview" width="171" height="171"></canvas><span>Tiled preview (3&times;3)</span></div>' : ''}</div>
      <div class="rp-edit-footer"><div><strong>${textureLabel(entry)}</strong><span>Texture resolution</span></div><select class="modal-select" id="rpResolution"><option value="">Resize&hellip;</option>${RESOLUTIONS.map(size => `<option value="${size}">${size} × ${size}</option>`).join('')}</select><select class="modal-select" id="rpResizeMode" title="How to resize"><option value="scale">Scale pixels</option><option value="blank">New blank canvas</option></select><button class="modal-btn" data-rp-action="flip-horizontal">Flip ↔</button><button class="modal-btn" data-rp-action="flip-vertical">Flip ↕</button><button class="modal-btn" data-rp-action="rotate-left">Rotate ↺</button><button class="modal-btn" data-rp-action="rotate-right">Rotate ↻</button></div></div>`;
  }

  function renderTextureToolbar() {
    const tools = [['pencil', '✎', 'Pencil'], ['eraser', '⌫', 'Eraser'], ['line', '╱', 'Line'], ['rectangle', '□', 'Rectangle'], ['ellipse', '○', 'Ellipse'], ['fill', '▧', 'Fill'], ['replace', '↺', 'Replace'], ['shade', '◒', 'Shade'], ['fade', '◐', 'Fade'], ['smudge', '≈', 'Smudge'], ['gradient', '▤', 'Gradient'], ['eyedropper', '⌕', 'Eyedropper'], ['spray', '⁙', 'Spray'], ['select', '▭', 'Select'], ['pan', '✥', 'Pan']];
    return `<div class="rp-global-toolbar"><div class="rp-canvas-toolbar"><div class="rp-tool-palette">${tools.map(([tool, icon, label]) => `<button class="rp-tool-button ${state.tool === tool ? 'active' : ''}" data-rp-tool="${tool}" title="${label}"><b>${icon}</b><span>${label}</span></button>`).join('')}</div><div class="rp-color-controls"><button class="modal-btn rp-history-button" data-rp-action="undo" title="Undo last edit">Undo</button><button class="modal-btn rp-history-button" data-rp-action="redo" title="Redo last undone edit">Redo</button><input id="rpColor" type="color" value="${esc(toHex6(state.color))}" title="Paint color"><input id="rpColorHex" class="modal-input rp-hex-input" type="text" value="${esc(state.color)}" maxlength="9" title="Hex RGBA, e.g. #FFAA00 or #FFAA0080" spellcheck="false"><select class="modal-select" id="rpBrushSize">${[1, 2, 4, 8, 16].map(size => `<option value="${size}"${size === state.brushSize ? ' selected' : ''}>${size}px</option>`).join('')}</select><label class="rp-opacity">Opacity <input id="rpOpacity" type="range" min="0.05" max="1" step="0.05" value="${state.opacity}"></label></div></div>
      <div class="rp-palette-row"><div class="rp-palette-swatches">${(state.palette || []).map(hex => `<button class="rp-palette-swatch ${hex === state.color ? 'active' : ''}" data-rp-palette-pick="${esc(hex)}" style="background:${esc(toHex6(hex))}" title="${esc(hex)}"><span data-rp-palette-remove="${esc(hex)}" title="Remove from palette">×</span></button>`).join('')}</div><button class="rp-icon-button" data-rp-action="palette-add" title="Add current color to palette">+</button></div></div>`;
  }

  function renderModelEditor(entry) {
    const model = state.modelCache[modelKey(entry)];
    const elements = modelElementCount(model);
    const textures = modelTextureCount(model);
    const compositeParts = model?.__compositeItem ? model.__blockstateParts?.length || 0 : 0;
    const canSelectElements = elements > 0 && !compositeParts;
    const interactionMode = canSelectElements ? state.modelInteractionMode : 'paint';
    const diagnostic = state.modelDiagnostics[entry.id];
    const resolvedModelLabel = modelLabel(entry, model);
    const statusLine = diagnostic
      ? `<span class="rp-model-diagnostic">${esc(diagnostic.message)}</span>`
      : model ? `${elements} cuboids &middot; ${textures} texture slots${compositeParts ? ` &middot; composite item (${compositeParts} parts; component geometry is read-only)` : ''} &middot; click a face to paint its UV pixels` : 'Loading model elements and texture references&hellip;';
    return `<div class="rp-model-editor"><div class="rp-model-editor-head"><div><div class="rp-eyebrow">RESOLVED MINECRAFT MODEL</div><h3>${esc(resolvedModelLabel)}</h3><p>${statusLine}</p></div><div class="rp-model-view-toggles"><button class="rp-option-toggle ${interactionMode === 'select' ? 'active' : ''}" data-rp-action="toggle-model-mode"${canSelectElements ? '' : ' disabled title="This preview has no editable element list."'}>${interactionMode === 'select' ? 'Select mode' : 'Paint mode'}</button><label class="rp-check"><input type="checkbox" id="rpModelGrid"${state.showModelGrid ? ' checked' : ''}> Grid</label><label class="rp-check"><input type="checkbox" id="rpModelAxes"${state.showModelAxes ? ' checked' : ''}> Axes</label><label class="rp-check"><input type="checkbox" id="rpModelBounds"${state.showModelBounds ? ' checked' : ''}> Bounds</label><button class="modal-btn" data-rp-action="reset-camera">Reset view</button></div></div><div class="rp-model-viewport"><canvas id="rp3dCanvas"></canvas><span>${interactionMode === 'select' ? 'Left click selects an element/face' : 'Left click paints'} &middot; right drag orbits &middot; wheel zooms &middot; middle drag pans</span></div></div>`;
  }

  function renderDetails(entry) {
    const model = state.modelOverrides[entry.id] || state.modelCache[modelKey(entry)];
    return `<div class="rp-details"><div><span>Resource ID</span><strong>minecraft:${esc(entry.id)}</strong></div><div><span>Asset path</span><strong>${esc(entry.path || 'Version-specific')}</strong></div><div><span>Category</span><strong>${esc(entry.category || 'Other')}</strong></div><div><span>Model</span><strong>${esc(modelLabel(entry, model) || entry.shape || 'Vanilla')}</strong></div></div>`;
  }

  function renderInspector(entry) {
    const model = state.modelCache[modelKey(entry)];
    const modelSection = hasMinecraftModel(entry) ? `
      <div class="rp-inspector-heading"><strong>Model preview</strong><button class="rp-icon-button" data-rp-action="auto-rotate">${state.autoRotate ? '⏸' : '↻'}</button></div>
      <div class="rp-model-facts">${preview?.bounds && item()?.id === entry.id
        ? `<span>${modelElementCount(model)} cuboids</span><span>${modelTextureCount(model)} textures</span><span>${(preview.bounds.size.x * 16).toFixed(1)} &times; ${(preview.bounds.size.y * 16).toFixed(1)} &times; ${(preview.bounds.size.z * 16).toFixed(1)}</span>`
        : `<span>${modelElementCount(model)} cuboids</span><span>${modelTextureCount(model)} textures</span>`}</div>
      ${renderElementInfo(entry)}
      <div class="rp-inspector-section"><div class="rp-pane-heading"><strong>Display</strong></div><label class="rp-range-label">In-game scale <b>${Math.round(state.scale * 100)}%</b></label><input id="rpScale" type="range" min=".5" max="4" step=".05" value="${state.scale}"><p class="rp-muted">Visual scale changes preview only. Texture resolution stays ${state.resolution}px.</p></div>` : '';
    const dimensions = dimensionsFor(entry);
    const texturePath = textureAssetPath(entry);
    const catalogPath = entry.path || `minecraft:${entry.id}`;
    const details = [
      ['Texture path', texturePath],
      ...(catalogPath !== texturePath ? [['Catalog path', catalogPath]] : []),
      ['Category', entry.category || 'Misc'],
      ['Type', entry.shape || 'texture'],
      ['Resolution', `${dimensions.width} × ${dimensions.height}`],
      ['Minecraft version', state.version],
      ['Modified', isModified(entry) ? 'Yes' : 'No'],
      ['Source', entry.custom ? 'Custom / generated' : 'Vanilla'],
    ];
    return `${modelSection}
      <div class="rp-inspector-section"><div class="rp-pane-heading"><strong>Resource details</strong></div><div class="rp-details">${details.map(([label, value]) => `<div><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`).join('')}</div></div>
      <div class="rp-inspector-section"><div class="rp-pane-heading"><strong>Pack changes</strong><span>${Object.keys(state.modifiedResources).length}</span></div><p class="rp-muted">${isModified(entry) ? 'This resource will be included in the next export.' : 'This resource is still vanilla.'}</p><button class="modal-btn" data-rp-action="metadata" style="width:100%">Edit pack metadata</button></div>
      <div id="rpStatus" class="rp-status"></div>`;
  }

  function bindLibraryEvents() {
    const root = document.getElementById('resourcePackStudioRoot');
    root.querySelector('[data-rp-action="hide-create"]')?.addEventListener('click', () => { const card = document.getElementById('rpCreateCard'); if (card) card.hidden = true; });
    root.querySelector('[data-rp-action="import"]')?.addEventListener('click', importProject);
    root.querySelector('#rpLibrarySearch')?.addEventListener('input', event => { state.libraryQuery = event.target.value; render(); document.getElementById('rpLibrarySearch')?.focus(); });
    root.querySelector('#rpLibrarySort')?.addEventListener('change', event => { state.librarySort = event.target.value; persist(); render(); });
    root.querySelectorAll('[data-rp-filter]').forEach(button => button.addEventListener('click', () => { state.libraryFilter = button.dataset.rpFilter; persist(); render(); }));
    root.querySelectorAll('[data-rp-export]').forEach(button => button.addEventListener('click', () => runProjectAction(button.dataset.rpExport, false)));
    root.querySelectorAll('[data-rp-install]').forEach(button => button.addEventListener('click', () => runProjectAction(button.dataset.rpInstall, true)));
    root.querySelectorAll('[data-rp-rename]').forEach(button => button.addEventListener('click', () => renameProject(button.dataset.rpRename)));
    root.querySelectorAll('[data-rp-duplicate]').forEach(button => button.addEventListener('click', () => duplicateProject(button.dataset.rpDuplicate)));
    root.querySelectorAll('[data-rp-delete]').forEach(button => button.addEventListener('click', () => deleteProject(button.dataset.rpDelete)));
    root.querySelectorAll('[data-rp-favorite]').forEach(button => button.addEventListener('click', () => togglePackFavorite(button.dataset.rpFavorite)));
  }

  function bindBrowserEvents() {
    const root = document.getElementById('resourcePackStudioRoot');
    root.querySelector('.rp-browser')?.addEventListener('scroll', event => { state.browserScrollTop = event.currentTarget.scrollTop; }, { passive: true });
    root.querySelector('[data-rp-action="library"]')?.addEventListener('click', openLibrary);
    root.querySelector('[data-rp-action="save"]')?.addEventListener('click', () => { state.dirty = false; persist(); render(); setStatus('Saved.'); });
    root.querySelector('[data-rp-action="export"]')?.addEventListener('click', () => exportPack(false));
    root.querySelector('[data-rp-action="install"]')?.addEventListener('click', () => exportPack(true));
    root.querySelector('[data-rp-action="metadata"]')?.addEventListener('click', editMetadata);
    root.querySelector('[data-rp-action="refresh"]')?.addEventListener('click', () => { state.catalogVersion = null; loadCatalog(state.version); });
    root.querySelectorAll('[data-rp-tab]').forEach(button => button.addEventListener('click', () => { state.selectedTab = button.dataset.rpTab; render(); }));
    root.querySelectorAll('[data-rp-category]').forEach(button => button.addEventListener('click', () => {
      state.category = button.dataset.rpCategory;
      state.resourceLimit = 240;
      state.browserScrollTop = 0;
      render();
    }));
    root.querySelector('#rpSearch')?.addEventListener('input', event => {
      const value = event.target.value;
      window.clearTimeout(searchDebounceTimer);
      searchDebounceTimer = window.setTimeout(() => {
        state.query = value;
        state.resourceLimit = 240;
        state.browserScrollTop = 0;
        render();
      }, 150);
    });
    root.querySelector('#rpSort')?.addEventListener('change', event => {
      state.sort = event.target.value;
      state.resourceLimit = 240;
      state.browserScrollTop = 0;
      computeSortOrder();
      render();
    });
    root.querySelector('[data-rp-action="load-more-resources"]')?.addEventListener('click', () => { state.resourceLimit += 240; render(); });
    root.querySelectorAll('[data-rp-resource]').forEach(button => {
      button.addEventListener('mousedown', event => event.preventDefault());
      button.addEventListener('click', () => selectResource(button.dataset.rpResource));
    });
    root.querySelector('[data-rp-action="new-custom-texture"]')?.addEventListener('click', () => {
      const name = window.prompt('Name this texture', 'My Texture');
      if (name === null) return;
      const resolutionInput = window.prompt('Resolution (16, 32, 64, 128, 256, or 512)', '16');
      createCustomTexture(name, Number(resolutionInput));
    });
    root.querySelector('[data-rp-action="upload-texture"]')?.addEventListener('click', () => document.getElementById('rpUploadTexture')?.click());
    root.querySelector('#rpUploadTexture')?.addEventListener('change', async event => {
      const file = event.target.files?.[0];
      if (!file) return;
      const dataUrl = await readFileAsDataUrl(file);
      await createCustomTextureFromImage(file.name.replace(/\.png$/i, '') || 'Uploaded Texture', dataUrl);
    });
    root.querySelector('[data-rp-action="save-look"]')?.addEventListener('click', saveLook);
    root.querySelectorAll('[data-rp-load-look]').forEach(button => button.addEventListener('click', () => loadLook(button.dataset.rpLoadLook)));
  }

  function showCreateForm() {
    const card = document.getElementById('rpCreateCard');
    if (card) card.hidden = false;
    document.getElementById('rpNewName')?.focus();
  }

  async function createFromForm() {
    const iconFile = document.getElementById('rpNewIcon')?.files?.[0];
    const iconDataUrl = iconFile ? await readFileAsDataUrl(iconFile) : null;
    await createProject(
      document.getElementById('rpNewName')?.value.trim() || 'My Resource Pack',
      document.getElementById('rpNewVersion')?.value || '1.21.4',
      document.getElementById('rpNewDescription')?.value.trim() || '',
      document.getElementById('rpNewAuthor')?.value.trim() || '',
      iconDataUrl,
    );
  }

  async function runProjectAction(id, install) {
    const selected = state.projects.find(entry => entry.id === id);
    if (!selected) return;
    await openProject(id);
    await exportPack(install);
    openLibrary();
  }

  function renameProject(id) {
    const selected = state.projects.find(entry => entry.id === id);
    if (!selected) return;
    const name = window.prompt('Resource pack name', selected.name);
    if (name === null) return;
    selected.name = name.trim() || selected.name;
    selected.data ||= defaultEditor(selected.name, selected.version);
    selected.data.packName = selected.name;
    selected.updatedAt = now();
    persist();
    render();
  }

  function bindEditorEvents() {
    const root = document.getElementById('resourcePackStudioRoot');
    bindElementInfoEvents();
    bindLayersPanelEvents();
    bindAnimationPanelEvents();
    drawFrameThumbnails(item());
    root.querySelector('[data-rp-action="browser"]')?.addEventListener('click', openBrowser);
    root.querySelector('[data-rp-action="save"]')?.addEventListener('click', () => { state.dirty = false; persist(); render(); setStatus('Saved.'); });
    root.querySelector('[data-rp-action="export"]')?.addEventListener('click', () => exportPack(false));
    root.querySelector('[data-rp-action="install"]')?.addEventListener('click', () => exportPack(true));
    root.querySelector('[data-rp-action="metadata"]')?.addEventListener('click', editMetadata);
    root.querySelector('[data-rp-action="hide-metadata"]')?.addEventListener('click', () => { const modal = document.getElementById('rpMetadataModal'); if (modal) modal.hidden = true; });
    root.querySelector('[data-rp-action="save-metadata"]')?.addEventListener('click', () => {
      const name = document.getElementById('rpMetaName')?.value.trim() || state.packName;
      const desc = document.getElementById('rpMetaDesc')?.value || '';
      const author = document.getElementById('rpMetaAuthor')?.value || '';
      state.packName = name;
      state.description = desc;
      state.author = author;
      state.dirty = true;
      persist();
      const modal = document.getElementById('rpMetadataModal');
      if (modal) modal.hidden = true;
      render();
      setStatus('Pack settings saved.');
    });
    root.querySelector('[data-rp-action="refresh"]')?.addEventListener('click', () => { state.catalogVersion = null; loadCatalog(state.version); });
    root.querySelector('[data-rp-action="load-more-resources"]')?.addEventListener('click', () => { state.resourceLimit += 240; render(); });
    root.querySelector('#rpSearch')?.addEventListener('input', event => {
      // Debounced: typing doesn't trigger a full innerHTML rebuild on every
      // keystroke. The native input keeps showing what was typed during the
      // debounce window since nothing touches the DOM until it fires.
      const value = event.target.value;
      window.clearTimeout(searchDebounceTimer);
      searchDebounceTimer = window.setTimeout(() => { state.query = value; state.resourceLimit = 240; render(); }, 150);
    });
    root.querySelector('#rpCategory')?.addEventListener('change', event => { state.category = event.target.value; state.resourceLimit = 240; render(); });
    root.querySelector('#rpSort')?.addEventListener('change', event => { state.sort = event.target.value; computeSortOrder(); render(); });
    root.querySelector('#rpResolution')?.addEventListener('change', event => {
      const size = Number(event.target.value);
      if (!size) return;
      const mode = root.querySelector('#rpResizeMode')?.value || 'scale';
      resizeTexture(item(), size, mode);
      render();
    });
    root.querySelector('#rpBrushSize')?.addEventListener('change', event => { state.brushSize = Number(event.target.value); });
    root.querySelector('#rpColor')?.addEventListener('input', event => {
      state.color = event.target.value;
      const hexField = document.getElementById('rpColorHex');
      if (hexField) hexField.value = state.color;
    });
    root.querySelector('#rpColorHex')?.addEventListener('change', event => {
      const raw = event.target.value.trim().replace(/^#/, '');
      if (!/^[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(raw)) { event.target.value = state.color; return; }
      state.color = `#${raw.slice(0, 6)}`;
      if (raw.length === 8) state.opacity = Math.round((parseInt(raw.slice(6, 8), 16) / 255) * 100) / 100;
      render();
    });
    root.querySelector('#rpOpacity')?.addEventListener('input', event => { state.opacity = Number(event.target.value); });
    root.querySelector('#rpGrid')?.addEventListener('change', event => { state.showGrid = event.target.checked; drawPainter(); });
    root.querySelector('#rpScale')?.addEventListener('input', event => { state.scale = Number(event.target.value); updatePreview(); });
    root.querySelectorAll('[data-rp-tab]').forEach(button => button.addEventListener('click', () => { state.selectedTab = button.dataset.rpTab; render(); }));
    root.querySelectorAll('[data-rp-toggle]').forEach(button => button.addEventListener('click', () => {
      const key = button.dataset.rpToggle;
      state[key] = !state[key];
      render();
    }));
    root.querySelectorAll('[data-rp-tool]').forEach(button => button.addEventListener('click', () => {
      state.tool = button.dataset.rpTool;
      state.shapePreview = null;
      if (state.tool !== 'select') { state.selection = null; state.selectionDraft = null; }
      render();
    }));
    root.querySelectorAll('[data-rp-resource]').forEach(button => {
      button.addEventListener('mousedown', event => event.preventDefault());
      button.addEventListener('click', () => selectResource(button.dataset.rpResource));
    });
    root.querySelector('[data-rp-action="favorite-resource"]')?.addEventListener('click', () => {
      state.favorites[state.selectedId] = !state.favorites[state.selectedId];
      if (!state.favorites[state.selectedId]) delete state.favorites[state.selectedId];
      persist();
      render();
    });
    root.querySelector('[data-rp-action="reset"]')?.addEventListener('click', resetResource);
    root.querySelector('[data-rp-action="delete-custom"]')?.addEventListener('click', () => deleteCustomResource(item()));
    root.querySelector('[data-rp-action="flip-horizontal"]')?.addEventListener('click', () => transformTexture('flip-horizontal'));
    root.querySelector('[data-rp-action="flip-vertical"]')?.addEventListener('click', () => transformTexture('flip-vertical'));
    root.querySelector('[data-rp-action="rotate-left"]')?.addEventListener('click', () => transformTexture('rotate-left'));
    root.querySelector('[data-rp-action="rotate-right"]')?.addEventListener('click', () => transformTexture('rotate-right'));
    root.querySelector('[data-rp-action="cycle-symmetry"]')?.addEventListener('click', () => {
      const order = ['none', 'horizontal', 'vertical', 'both'];
      state.symmetry = order[(order.indexOf(state.symmetry) + 1) % order.length];
      render();
    });
    root.querySelector('[data-rp-action="palette-add"]')?.addEventListener('click', () => {
      state.palette = [state.color, ...(state.palette || []).filter(hex => hex !== state.color)].slice(0, 24);
      persist();
      render();
    });
    root.querySelectorAll('[data-rp-palette-pick]').forEach(button => button.addEventListener('click', event => {
      if (event.target.closest('[data-rp-palette-remove]')) return;
      state.color = button.dataset.rpPalettePick;
      render();
    }));
    root.querySelectorAll('[data-rp-palette-remove]').forEach(element => element.addEventListener('click', event => {
      event.stopPropagation();
      state.palette = (state.palette || []).filter(hex => hex !== element.dataset.rpPaletteRemove);
      persist();
      render();
    }));
    root.querySelector('[data-rp-action="selection-copy"]')?.addEventListener('click', copySelection);
    root.querySelector('[data-rp-action="selection-cut"]')?.addEventListener('click', cutSelectionToClipboard);
    root.querySelector('[data-rp-action="selection-paste"]')?.addEventListener('click', pasteClipboard);
    root.querySelector('[data-rp-action="selection-duplicate"]')?.addEventListener('click', duplicateSelection);
    root.querySelector('[data-rp-action="selection-delete"]')?.addEventListener('click', deleteSelection);
    root.querySelector('[data-rp-action="selection-clear"]')?.addEventListener('click', () => { state.selection = null; render(); });
    root.querySelector('[data-rp-action="undo"]')?.addEventListener('click', undo);
    root.querySelector('[data-rp-action="redo"]')?.addEventListener('click', redo);
    root.querySelector('[data-rp-action="auto-rotate"]')?.addEventListener('click', () => { state.autoRotate = !state.autoRotate; render(); setupPreview(); });
    root.querySelector('[data-rp-action="toggle-model-mode"]')?.addEventListener('click', () => {
      state.modelInteractionMode = state.modelInteractionMode === 'select' ? 'paint' : 'select';
      render();
    });
    root.querySelector('[data-rp-action="reset-camera"]')?.addEventListener('click', () => { state.modelCameraZoom = 1; preview?.root?.rotation && (preview.root.rotation.set(0, 0, 0)); preview?.frameCamera?.(); });
    root.querySelector('#rpModelGrid')?.addEventListener('change', event => { state.showModelGrid = event.target.checked; if (preview?.grid) preview.grid.visible = state.showModelGrid; });
    root.querySelector('#rpModelAxes')?.addEventListener('change', event => { state.showModelAxes = event.target.checked; if (preview?.axes) preview.axes.visible = state.showModelAxes; });
    root.querySelector('#rpModelBounds')?.addEventListener('change', event => { state.showModelBounds = event.target.checked; if (preview?.boundsBox) preview.boundsBox.visible = state.showModelBounds; });
    root.querySelector('[data-rp-action="new-custom-texture"]')?.addEventListener('click', () => {
      const name = window.prompt('Name this texture', 'My Texture');
      if (name === null) return;
      const resolutionInput = window.prompt('Resolution (16, 32, 64, 128, 256, or 512)', '16');
      createCustomTexture(name, Number(resolutionInput));
    });
    root.querySelector('[data-rp-action="upload-texture"]')?.addEventListener('click', () => document.getElementById('rpUploadTexture')?.click());
    root.querySelector('#rpUploadTexture')?.addEventListener('change', async event => {
      const file = event.target.files?.[0];
      if (!file) return;
      const dataUrl = await readFileAsDataUrl(file);
      await createCustomTextureFromImage(file.name.replace(/\.png$/i, '') || 'Uploaded Texture', dataUrl);
    });
    root.querySelector('[data-rp-action="zoom-in"]')?.addEventListener('click', () => setZoom(state.cameraZoom * 1.5));
    root.querySelector('[data-rp-action="zoom-out"]')?.addEventListener('click', () => setZoom(state.cameraZoom / 1.5));
    root.querySelector('[data-rp-action="zoom-reset"]')?.addEventListener('click', () => setZoom(1));
    root.querySelector('[data-rp-action="save-look"]')?.addEventListener('click', saveLook);
    root.querySelectorAll('[data-rp-load-look]').forEach(button => button.addEventListener('click', () => loadLook(button.dataset.rpLoadLook)));
    setupPainter();
    const selectedEntry = item();
    if (!selectedEntry) return;
    setupPreview();
    const selectedId = selectedEntry.id;
    const modelWasLoaded = Boolean(state.modelCache[modelKey(item())]);
    loadModel(selectedEntry).then(() => {
      if (item()?.id !== selectedId) return;
      if (modelWasLoaded) setupPreview();
      else render();
    });
    loadVanillaTexture(item());
  }

  async function selectResource(id) {
    stopAnimationPlayback(); // never leave a playback timer running against the resource we're navigating away from
    const scrollTop = document.querySelector('#resourcePackStudioRoot .rp-browser')?.scrollTop || 0;
    state.browserScrollTop = scrollTop || state.browserScrollTop;
    state.selectedId = id;
    state.selectedPath = null;
    state.selection = null;
    state.selectionDraft = null;
    state.shapePreview = null;
    state.recentResources = [id, ...state.recentResources.filter(entry => entry !== id)].slice(0, 30);
    state.selectedTab = 'workspace';
    state.view = 'editor';
    state.requestGeneration += 1;
    persist();
    render();
    const browser = document.querySelector('#resourcePackStudioRoot .rp-browser');
    if (browser) browser.scrollTop = scrollTop;
    // Don't spend an IPC round-trip asking for a model that this resource
    // type can never have (see hasMinecraftModel/renderSelectedResource).
    if (hasMinecraftModel(item())) await loadModel(item());
    await loadVanillaTexture(item());
  }

  function modelKey(entry) {
    if (entry?.category === 'Blocks' && entry.minecraftId) {
      return `${state.version}:blockstate:${entry.minecraftId}`;
    }
    return `${state.version}:${entry?.modelName || entry?.id || 'missing'}`;
  }

  function modelLabel(entry, model) {
    return model?.__blockstateParts?.[0]?.modelPath
      || model?.__sourceModelPath
      || (entry?.category === 'Blocks' && entry.minecraftId ? `minecraft:block/${entry.minecraftId}` : entry?.modelName || entry?.id || 'unknown');
  }

  function modelElementCount(model) {
    if (Array.isArray(model?.__blockstateParts)) {
      return model.__blockstateParts.reduce((count, part) => count + modelElementCount(part.model), 0);
    }
    return model?.elements?.length || 0;
  }

  function modelTextureCount(model) {
    if (Array.isArray(model?.__blockstateParts)) {
      return model.__blockstateParts.reduce((count, part) => count + modelTextureCount(part.model), 0);
    }
    return Object.keys(model?.textures || {}).length;
  }

  // Finds a model JSON the user's own project supplies -- an imported
  // resource pack's assets/<namespace>/models/<kind>/<name>.json -- as raw
  // text (import already stores .json files as plain UTF-8, not base64).
  function findImportedModelJson(namespace, kind, name) {
    const path = `assets/${namespace}/models/${kind}/${name}.json`;
    const entry = (state.importedEntries || []).find(candidate => candidate.path === path);
    if (!entry) return null;
    try { return JSON.parse(entry.data); } catch { return { __parseError: true }; }
  }

  // Resolves a model honoring project-owned data first: an imported pack's
  // own model file, and its own parent chain, take priority over vanilla --
  // and a parent reference the project doesn't override falls through to
  // the (already deep-resolved) vanilla IPC. This is what lets a custom
  // namespace, or a vanilla-namespace override that only replaces one link
  // in a parent chain, work correctly instead of only ever seeing vanilla.
  async function resolveProjectModel(namespace, requestedPath, seen = new Set()) {
    const chainKey = `${namespace}:${requestedPath}`;
    if (seen.has(chainKey)) return { data: {}, missingParent: null, source: 'cycle' };
    seen.add(chainKey);
    // "builtin/..." is a sentinel Minecraft's own client special-cases in
    // code (generated items, chests/shields/etc rendered by the entity
    // renderer) -- it is never a real model file in any namespace, so it's
    // not a resolution failure. The marker survives every merge above it
    // in the chain via the generic object spread (see buildGeneratedOrBuiltinMeshes).
    if (requestedPath.startsWith('builtin/')) return { data: { __builtin: requestedPath }, missingParent: null, source: 'builtin' };
    const parts = requestedPath.split('/');
    const kind = parts[0] === 'item' ? 'item' : 'block';
    const name = (parts[0] === 'item' || parts[0] === 'block' ? parts.slice(1) : parts).join('/') || parts[0];
    const raw = findImportedModelJson(namespace, kind, name);
    if (raw) {
      if (raw.__parseError) return { data: {}, missingParent: `${chainKey} (invalid JSON in imported pack)`, source: 'project' };
      let parentResult = { data: {}, missingParent: null };
      if (raw.parent) {
        const parentNamespaceMatch = String(raw.parent).match(/^([a-z0-9_.-]+):(.+)$/i);
        const parentNamespace = parentNamespaceMatch ? parentNamespaceMatch[1] : namespace;
        let parentPath = parentNamespaceMatch ? parentNamespaceMatch[2] : raw.parent;
        if (!/^(?:block|item|builtin)\//.test(parentPath)) parentPath = `${kind}/${parentPath}`;
        parentResult = await resolveProjectModel(parentNamespace, parentPath, seen);
      }
      const merged = { ...parentResult.data, ...raw, textures: { ...(parentResult.data.textures || {}), ...(raw.textures || {}) } };
      delete merged.__parseError;
      return { data: merged, missingParent: parentResult.missingParent, source: 'project' };
    }
    if (namespace !== 'minecraft') {
      // No project file for a non-vanilla namespace -- there's nowhere else
      // this can legitimately come from.
      return { data: {}, missingParent: chainKey, source: 'project', reason: 'not-found' };
    }
    const vanillaResult = await window.launcherAPI.getResourcePackModel(state.version, requestedPath);
    if (!vanillaResult?.ok) return { data: {}, missingParent: chainKey, source: 'vanilla', error: vanillaResult?.error, reason: vanillaResult?.reason };
    return { data: vanillaResult.data || {}, missingParent: vanillaResult.missingParent || null, source: vanillaResult.source };
  }

  const DEFAULT_BLOCK_PROPERTIES = {
    axis: 'y', east: 'none', facing: 'north', half: 'bottom', hinge: 'left',
    in_wall: 'false', lit: 'false', north: 'none', open: 'false', part: 'foot',
    powered: 'false', shape: 'straight', south: 'none', type: 'bottom',
    up: 'true', waterlogged: 'false', west: 'none',
  };

  function defaultBlockProperties(entry) {
    const properties = entry.stateProperties || [];
    const defaultState = Number(entry.defaultState);
    const minStateId = Number(entry.minStateId);
    if (Number.isInteger(defaultState) && Number.isInteger(minStateId) && defaultState >= minStateId && properties.length) {
      let stateIndex = defaultState - minStateId;
      const values = new Array(properties.length);
      for (let index = properties.length - 1; index >= 0; index -= 1) {
        const property = properties[index];
        const propertyValues = property.values || (property.type === 'bool' ? ['true', 'false'] : []);
        const count = Number(property.num_values) || propertyValues.length;
        if (!count) continue;
        const valueIndex = stateIndex % count;
        stateIndex = Math.floor(stateIndex / count);
        values[index] = propertyValues[valueIndex] ?? DEFAULT_BLOCK_PROPERTIES[property.name] ?? '';
      }
      return Object.fromEntries(properties.map((property, index) => [property.name, String(values[index] ?? '')])
        .filter(([, value]) => value !== ''));
    }
    return Object.fromEntries(properties.map(property => {
      const propertyValues = property.values || (property.type === 'bool' ? ['true', 'false'] : []);
      const preferred = DEFAULT_BLOCK_PROPERTIES[property.name];
      const value = propertyValues.includes(preferred) ? preferred : propertyValues[0];
      return [property.name, String(value ?? '')];
    }).filter(([, value]) => value !== ''));
  }

  function blockstateConditionMatches(condition, properties) {
    if (!condition || typeof condition !== 'object') return true;
    if (Array.isArray(condition.OR) && !condition.OR.some(child => blockstateConditionMatches(child, properties))) return false;
    if (Array.isArray(condition.AND) && !condition.AND.every(child => blockstateConditionMatches(child, properties))) return false;
    return Object.entries(condition)
      .filter(([key]) => key !== 'OR' && key !== 'AND')
      .every(([key, allowed]) => String(allowed).split('|').includes(String(properties[key])));
  }

  function selectBlockstateParts(blockstate, entry) {
    const properties = defaultBlockProperties(entry);
    if (blockstate?.variants && typeof blockstate.variants === 'object') {
      const variants = Object.entries(blockstate.variants);
      const scored = variants.map(([key, value]) => {
        const selectors = key ? key.split(',').map(part => part.split('=')) : [];
        const matches = selectors.filter(([name, expected]) => properties[name] === expected).length;
        const mismatches = selectors.length - matches;
        return { value, matches, mismatches, selectorCount: selectors.length };
      }).sort((left, right) => left.mismatches - right.mismatches || right.matches - left.matches || left.selectorCount - right.selectorCount);
      const selected = scored[0]?.value;
      const choices = Array.isArray(selected) ? selected : selected ? [selected] : [];
      return choices.slice(0, 1).map(choice => ({ ...choice }));
    }
    if (Array.isArray(blockstate?.multipart)) {
      return blockstate.multipart
        .filter(part => blockstateConditionMatches(part.when, properties))
        .flatMap(part => Array.isArray(part.apply) ? part.apply.slice(0, 1) : [part.apply])
        .filter(Boolean)
        .map(part => ({ ...part }));
    }
    return [];
  }

  function findImportedBlockstate(blockName) {
    const path = `assets/minecraft/blockstates/${blockName}.json`;
    const entry = (state.importedEntries || []).find(candidate => candidate.path === path);
    if (!entry) return null;
    try { return JSON.parse(entry.data); } catch { return { __parseError: true }; }
  }

  function findImportedItemDefinition(itemName) {
    const path = `assets/minecraft/items/${itemName}.json`;
    const entry = (state.importedEntries || []).find(candidate => candidate.path === path);
    if (!entry) return null;
    try { return JSON.parse(entry.data); } catch { return { __parseError: true }; }
  }

  async function resolveItemModel(entry, namespace, path) {
    if (namespace !== 'minecraft') return resolveProjectModel(namespace, path);
    const itemId = entry.minecraftId
      || (entry.id.startsWith('jar_') ? resourcePath(entry).split('/').pop().replace(/\.png$/i, '') : entry.id);
    const importedDefinition = findImportedItemDefinition(itemId);
    if (importedDefinition?.__parseError) {
      return {
        data: {},
        source: 'project',
        reason: 'invalid-json',
        error: `Imported item definition for "${itemId}" contains invalid JSON.`,
      };
    }
    const definitionResult = importedDefinition
      ? { ok: true, source: 'project', data: importedDefinition }
      : await window.launcherAPI?.getResourcePackItemDefinition?.(state.version, itemId);
    if (definitionResult?.ok) {
      const itemDefinition = definitionResult.data?.model;
      const specialItemDefinition = defaultSpecialItemModel(itemDefinition);
      if (specialItemDefinition) {
        const baseRef = String(specialItemDefinition.base || '').replace(/^minecraft:/, '');
        const baseResult = baseRef ? await resolveProjectModel('minecraft', baseRef) : null;
        const baseTextures = baseResult?.data?.textures || {};
        const specialModel = specialItemDefinition.model || {};
        const specialType = String(specialModel.type || 'special').replace(/^minecraft:/, '');
        const declaredTexture = String(specialModel.texture || '')
          .replace(/^minecraft:/, '')
          .replace(/^assets\/minecraft\/textures\//, '')
          .replace(/^textures\//, '')
          .replace(/\.png$/i, '');
        const specialTexture = specialType === 'banner' || /_banner$/.test(itemId)
          ? 'entity/banner/base'
          : specialType === 'shulker_box' || /_shulker_box$/.test(itemId)
            ? `block/${itemId}`
            : specialType === 'shield'
              ? 'entity/shield/shield_base_nopattern'
              : specialType === 'chest' && /^(?:normal|trapped|christmas)$/.test(declaredTexture.replace(/^minecraft:/, ''))
                ? `entity/chest/${declaredTexture.replace(/^minecraft:/, '')}`
                : /^(?:item|items|block|blocks|entity)\/[\w./-]+$/i.test(declaredTexture)
                  ? declaredTexture
                  : '';
        const textureSlot = ['layer0', 'texture', 'all', 'side', 'top', 'front', 'bottom', 'particle']
          .find(key => baseTextures[key]);
        const textureRef = specialTexture
          || (textureSlot
          ? resolveTexture(baseTextures, `#${textureSlot}`)
          : resourcePath(entry).replace(/\.png$/i, '')
            .replace(/^items\//, 'item/').replace(/^blocks\//, 'block/'));
        const data = textureRef && textureRef !== 'block/missing'
          ? {
            parent: 'item/generated',
            __builtin: 'builtin/generated',
            __sourceModelPath: baseRef || `item/${itemId}`,
            __specialRenderer: specialType,
            textures: { layer0: `minecraft:${textureRef}` },
            ...(itemDefinition.model?.color ? { __itemTintColor: itemDyeColor(itemDefinition.model.color) } : {}),
          }
          : { ...baseResult?.data, __specialRenderer: specialType, __sourceModelPath: baseRef || `item/${itemId}` };
        const message = `Minecraft renders this item with its special ${specialType} renderer; showing its official base texture as a flat sprite. Runtime animation, pose, and custom pattern layers are not simulated.`;
        return {
          data,
          missingParent: baseResult?.missingParent || null,
          source: 'minecraft-client.jar:item-definition',
          diagnostic: { state: 'builtin-entity', message },
        };
      }

      const modelReferences = staticItemModelReferences(itemDefinition);
      const resolvedModels = await Promise.all(modelReferences.map(reference => {
        const match = reference.model.match(/^([a-z0-9_.-]+):(.+)$/i);
        return resolveProjectModel(match ? match[1] : 'minecraft', match ? match[2] : reference.model);
      }));
      const parts = resolvedModels
        .map((result, index) => result.data && Object.keys(result.data).length
          ? {
            model: result.data,
            modelPath: modelReferences[index].model,
            transformation: modelReferences[index].transformation,
            missingParent: result.missingParent,
          }
          : null)
        .filter(Boolean);
      if (parts.length) {
        const dynamicSelection = itemDefinitionHasDynamicSelection(itemDefinition);
        const isCompositeItem = String(itemDefinition?.type || '').replace(/^minecraft:/, '') === 'composite'
          && parts.length > 1;
        return {
          data: {
            ...parts[0].model,
            __blockstateParts: parts,
            ...(isCompositeItem ? { __compositeItem: true } : {}),
            ...(dynamicSelection ? {
              __itemDefinitionDiagnostic: `Showing a static model from Minecraft's item definition for "${itemId}"; runtime-dependent model selection and animation are not simulated.`,
            } : {}),
            __sourceModelPath: `item/${itemId}`,
          },
          missingParent: parts.find(part => part.missingParent)?.missingParent || null,
          source: 'minecraft-client.jar:item-definition',
          diagnostic: dynamicSelection ? {
            state: 'item-model-definition',
            message: `Showing a static model from Minecraft's item definition for "${itemId}"; runtime-dependent model selection is not simulated.`,
          } : null,
        };
      }
    }

    const direct = await resolveProjectModel(namespace, path);
    if (direct.data && Object.keys(direct.data).length) return direct;
    if (direct.reason !== 'not-found') return direct;
    if (definitionResult?.reason === 'error') {
      return {
        data: {},
        source: 'minecraft-client.jar',
        reason: 'error',
        error: definitionResult.error || `Item model definition for "${itemId}" could not be loaded.`,
      };
    }

    const candidates = [];
    if (/_spawn_egg$/.test(itemId)) candidates.push('item/template_spawn_egg');
    if (/_banner$/.test(itemId)) candidates.push('item/template_banner');
    if (/(?:_head|_skull)$/.test(itemId)) candidates.push('item/template_skull');
    candidates.push(`block/${itemId}_inventory`);
    for (const candidate of candidates) {
      const result = await resolveProjectModel('minecraft', candidate);
      if (result.data && Object.keys(result.data).length) {
        return {
          ...result,
          data: { ...result.data, __sourceModelPath: `item/${itemId}` },
          diagnostic: {
            state: 'item-model-fallback',
            message: `The direct item model "${path}" is absent; showing Minecraft's "${candidate}" model instead.`,
          },
        };
      }
    }

    const matchingBlock = state.catalog.find(candidate => candidate.category === 'Blocks' && candidate.minecraftId === itemId);
    if (matchingBlock) {
      const result = await resolveEntryModel(matchingBlock);
      if (result.data && Object.keys(result.data).length) {
        return {
          ...result,
          data: { ...result.data, __sourceModelPath: `item/${itemId}` },
          diagnostic: {
            state: 'item-model-fallback',
            message: `The direct item model "${path}" is absent; showing the block's default-state model.`,
          },
        };
      }
    }

    const textureRef = resourcePath(entry).replace(/\.png$/i, '')
      .replace(/^items\//, 'item/').replace(/^blocks\//, 'block/');
    if (!textureRef) return direct;
    return {
      data: { parent: 'item/generated', __builtin: 'builtin/generated', __sourceModelPath: `item/${itemId}`, textures: { layer0: `minecraft:${textureRef}` } },
      source: 'generated-item-fallback',
      diagnostic: {
        state: 'item-model-fallback',
        message: `No dedicated 3D model exists for "${itemId}"; showing its own texture as a flat item preview.`,
      },
    };
  }

  async function resolveEntryModel(entry) {
    const modelName = entry.modelName || entry.id;
    const namespaceMatch = String(modelName).match(/^([a-z0-9_.-]+):(.+)$/i);
    const namespace = namespaceMatch ? namespaceMatch[1] : 'minecraft';
    const path = namespaceMatch ? namespaceMatch[2] : modelName;
    if (entry.category === 'Items') return resolveItemModel(entry, namespace, path);
    if (entry.category !== 'Blocks' || !entry.minecraftId || namespace !== 'minecraft') {
      return resolveProjectModel(namespace, path);
    }

    let blockstate = findImportedBlockstate(entry.minecraftId);
    let blockstateSource = blockstate ? 'project' : 'minecraft-client.jar';
    if (blockstate?.__parseError) {
      return { data: {}, source: 'project', reason: 'invalid-blockstate', error: `Imported blockstate for "${entry.minecraftId}" contains invalid JSON.` };
    }
    if (!blockstate) {
      const result = await window.launcherAPI?.getResourcePackBlockstate?.(state.version, entry.minecraftId);
      if (result?.ok) blockstate = result.data;
      else if (result?.reason !== 'not-found') {
        return { data: {}, source: 'vanilla', reason: result?.reason || 'error', error: result?.error || `Blockstate for "${entry.minecraftId}" could not be loaded.` };
      }
    }
    if (!blockstate) {
      const fallback = await resolveProjectModel(namespace, path);
      if (fallback.data && Object.keys(fallback.data).length) {
        fallback.diagnostic = {
          state: 'blockstate-missing',
          message: `The blockstate for "${entry.minecraftId}" was not available; showing its base model as an approximation.`,
        };
      }
      return fallback;
    }

    const selectedParts = selectBlockstateParts(blockstate, entry);
    if (!selectedParts.length) {
      return { data: {}, source: 'minecraft-client.jar', reason: 'empty-blockstate', error: `No default model variant was found for "${entry.minecraftId}".` };
    }
    const resolved = await Promise.all(selectedParts.map(async part => {
      const partModel = String(part.model || '');
      const match = partModel.match(/^([a-z0-9_.-]+):(.+)$/i);
      const partNamespace = match ? match[1] : 'minecraft';
      const partPath = match ? match[2] : partModel;
      const modelResult = await resolveProjectModel(partNamespace, partPath);
      return modelResult.data ? { ...part, model: modelResult.data, modelPath: partModel, missingParent: modelResult.missingParent } : null;
    }));
    const parts = resolved.filter(Boolean);
    if (!parts.length) {
      return { data: {}, source: 'minecraft-client.jar', reason: 'blockstate-model-missing', error: `The selected blockstate models for "${entry.minecraftId}" could not be loaded.` };
    }
    const firstModel = parts[0].model;
    const data = {
      ...firstModel,
      __blockstateParts: parts,
      __blockstateName: entry.minecraftId,
      __blockstateSource: blockstateSource,
    };
    const missingParent = parts.find(part => part.missingParent)?.missingParent || null;
    return { data, missingParent, source: data.__blockstateSource };
  }

  function linkPrimaryBlockstateModel(model) {
    const primary = model?.__blockstateParts?.[0]?.model;
    if (primary) {
      primary.elements = model.elements;
      primary.textures = model.textures;
    }
    return model;
  }

  async function loadModel(entry) {
    if (!entry) return null;
    // A materialized project override (from element/UV editing) is
    // authoritative and resource-specific -- it deliberately bypasses
    // state.modelCache, which is keyed by model *name* and can be shared by
    // multiple catalog entries that happen to reference the same model
    // file. Reading the override straight past that shared cache is what
    // keeps an edit to one resource's model from leaking onto another
    // resource that references the same underlying model.
    if (state.modelOverrides[entry.id]) {
      state.modelDiagnostics[entry.id] = null;
      return linkPrimaryBlockstateModel(state.modelOverrides[entry.id]);
    }
    const key = modelKey(entry);
    if (state.modelCache[key]) { state.modelDiagnostics[entry.id] = state.modelDiagnostics[entry.id] || null; return state.modelCache[key]; }
    const generation = state.requestGeneration;
    console.info('[RP Studio] loading model', { version: state.version, entryId: entry.id, modelName: entry.modelName, blockstate: entry.category === 'Blocks' ? entry.minecraftId : undefined });
    const result = await resolveEntryModel(entry);
    if (generation !== state.requestGeneration || item()?.id !== entry.id) return null;
    if (!result.data || !Object.keys(result.data).length) {
      const reasonLabels = { 'unsupported-namespace': 'Custom namespace, no matching project model', 'not-found': 'Model not found', 'invalid-name': 'Invalid model name', error: 'Model failed to load' };
      const diagnosticState = reasonLabels[result.reason] ? result.reason : 'not-found';
      const message = result.error || `No Minecraft model exists for "${entry.modelName || entry.id}".`;
      console.warn('[RP Studio] model load failed', { entryId: entry.id, modelName: entry.modelName, result });
      state.modelDiagnostics[entry.id] = { state: diagnosticState, message };
      setStatus(message, true);
      return null;
    }
    state.modelDiagnostics[entry.id] = result.missingParent
      ? { state: 'parent-missing', message: `Parent model "${result.missingParent}" could not be found -- showing what did resolve.` }
      : result.diagnostic || null;
    state.modelCache[key] = result.data;
    console.info('[RP Studio] model loaded', {
      version: state.version,
      entryId: entry.id,
      modelName: entry.modelName || entry.id,
      source: result.source,
      elements: result.data?.elements?.length || 0,
      textures: Object.keys(result.data?.textures || {}).length,
      missingParent: result.missingParent || null,
    });
    return state.modelCache[key];
  }

  // Derives {namespace, kind, name} for a resource's model reference --
  // used by both the exporter (to compute the correct output path) and
  // materializeModelOverride (to know what kind of default element to use).
  function modelPathInfo(entry, model) {
    const modelName = model?.__blockstateParts?.[0]?.modelPath || model?.__sourceModelPath || entry?.modelName || entry?.id || '';
    const namespaceMatch = String(modelName).match(/^([a-z0-9_.-]+):(.+)$/i);
    const namespace = namespaceMatch ? namespaceMatch[1] : 'minecraft';
    const path = namespaceMatch ? namespaceMatch[2] : modelName;
    const kind = path.startsWith('item/') ? 'item' : 'block';
    const name = path.replace(/^(?:item|block)\//, '');
    return { namespace, kind, name };
  }

  // The first element/UV edit "forks" the resource's model into project-
  // owned data -- a full, standalone copy of whatever was resolved
  // (vanilla, parent-inherited, or already project-overridden), the same
  // way Stage 3's first pixel edit forks a texture into state.buffers.
  // From then on this resource's model no longer depends on re-resolving
  // parents/vanilla at all.
  function materializeModelOverride(entry) {
    if (!state.modelOverrides[entry.id]) {
      const resolved = state.modelCache[modelKey(entry)];
      state.modelOverrides[entry.id] = resolved ? JSON.parse(JSON.stringify(resolved)) : { elements: [], textures: {} };
    }
    return linkPrimaryBlockstateModel(state.modelOverrides[entry.id]);
  }

  function createBuffer(size, entry) {
    const dimensions = state.textureDimensions[entry?.id] || { width: size, height: size };
    return new Uint8ClampedArray(dimensions.width * dimensions.height * 4);
  }

  async function loadVanillaTexture(entry) {
    if (!entry || !window.launcherAPI?.getResourcePackAsset) return;
    const generation = state.requestGeneration;
    const path = resourcePath(entry);
    if (!path || !/\.png$/i.test(path)) { drawPainter(); setupPreview(); return; }
    const key = bufferKey(entry);
    if (state.vanillaLoaded[key]) { drawPainter(); setupPreview(); return; }
    const result = await window.launcherAPI.getResourcePackAsset(state.version, path);
    if (!result?.ok) {
      setStatus(result?.error || 'Vanilla texture unavailable.', true);
      return false;
    }
    return new Promise(resolve => {
      const image = new Image();
      image.onload = () => {
        if (generation !== state.requestGeneration || item()?.id !== entry.id) {
          resolve(false);
          return;
        }
        try {
          const scratch = document.createElement('canvas');
          state.textureDimensions[entry.id] = { width: image.naturalWidth || image.width, height: image.naturalHeight || image.height };
          scratch.width = state.textureDimensions[entry.id].width; scratch.height = state.textureDimensions[entry.id].height;
          const context = scratch.getContext('2d');
          context.imageSmoothingEnabled = false;
          context.drawImage(image, 0, 0);
          const pixels = context.getImageData(0, 0, scratch.width, scratch.height).data;
          if (!state.buffers[key] || !isModified(entry)) state.buffers[key] = pixels;
          state.vanillaLoaded[key] = true;
          // Auto-detect an imported pack's .mcmeta for this exact texture path
          // and load it into the animation timeline (item 23) -- but only once,
          // and only if this resource hasn't already been set up as animated
          // (by this detection or by the user), so reopening the project or
          // reselecting the resource doesn't re-run the conversion repeatedly.
          if (!animationFor(entry)?.enabled) {
            const mcmetaEntry = (state.importedEntries || []).find(candidate => candidate.path === `assets/minecraft/textures/${path}.mcmeta`);
            if (mcmetaEntry) importAnimationMetadata(entry, mcmetaEntry.data);
          }
          render();
          resolve(true);
        } catch (error) {
          console.error('[RP Studio] Failed to decode vanilla texture.', error);
          setStatus('Vanilla texture could not be decoded.', true);
          resolve(false);
        }
      };
      image.onerror = () => {
        setStatus('Vanilla texture could not be loaded.', true);
        resolve(false);
      };
      image.src = result.dataUrl;
    });
  }

  function setupPainter() {
    const canvas = document.getElementById('rpPaintCanvas');
    if (!canvas) return;
    const scroll = document.getElementById('rpCanvasScroll');
    drawPainter();
    let drawing = false;
    let lastPoint = null;
    let panOrigin = null;
    const pointFor = event => {
      const rect = canvas.getBoundingClientRect();
      const dimensions = dimensionsFor(item());
      return {
        x: Math.max(0, Math.min(dimensions.width - 1, Math.floor((event.clientX - rect.left) / rect.width * dimensions.width))),
        y: Math.max(0, Math.min(dimensions.height - 1, Math.floor((event.clientY - rect.top) / rect.height * dimensions.height))),
      };
    };
    const paint = event => {
      if (!drawing) return;
      if (state.tool === 'pan') {
        if (!panOrigin || !scroll) return;
        scroll.scrollLeft = panOrigin.scrollLeft - (event.clientX - panOrigin.x);
        scroll.scrollTop = panOrigin.scrollTop - (event.clientY - panOrigin.y);
        return;
      }
      const point = pointFor(event);
      if (state.tool === 'eyedropper') {
        const dimensions = dimensionsFor(item()), buffer = getBuffer(item());
        const index = (point.y * dimensions.width + point.x) * 4;
        state.color = `#${[0, 1, 2].map(offset => buffer[index + offset].toString(16).padStart(2, '0')).join('')}`;
        const colorPicker = document.getElementById('rpColor');
        const colorHex = document.getElementById('rpColorHex');
        if (colorPicker) colorPicker.value = state.color;
        if (colorHex) colorHex.value = state.color;
        drawing = false;
        return;
      }
      if (state.tool === 'fill') {
        const entry = item();
        beginHistoryAction();
        recordMutation(entry);
        floodFill(getBuffer(entry), dimensionsFor(entry), point.x, point.y, hexToRgba(state.color, state.opacity));
        commitHistoryAction('Fill texture');
        drawing = false;
      } else if (state.tool === 'replace') {
        const entry = item();
        beginHistoryAction();
        recordMutation(entry);
        replaceColor(getBuffer(entry), dimensionsFor(entry), point.x, point.y, hexToRgba(state.color, state.opacity));
        commitHistoryAction('Replace color');
        drawing = false;
      } else if (state.tool === 'line' || state.tool === 'rectangle' || state.tool === 'ellipse' || state.tool === 'gradient') {
        // Preview only -- the real buffer is untouched until finish() commits
        // it once. See shapePoints()/applyShape() and the note in drawPainter().
        if (!lastPoint) lastPoint = point;
        const shapeType = state.tool === 'rectangle' && event.shiftKey ? 'rectangle-filled'
          : state.tool === 'ellipse' && event.shiftKey ? 'ellipse-filled'
          : state.tool;
        state.shapePreview = { type: shapeType, start: lastPoint, end: point };
      } else if (state.tool === 'select') {
        if (!lastPoint) lastPoint = point;
        if (selectionDrag) {
          moveSelectionTo(point);
        } else {
          const left = Math.min(lastPoint.x, point.x), right = Math.max(lastPoint.x, point.x);
          const top = Math.min(lastPoint.y, point.y), bottom = Math.max(lastPoint.y, point.y);
          state.selectionDraft = { x: left, y: top, w: right - left + 1, h: bottom - top + 1 };
        }
      } else {
        const entry = item();
        if (state.tool === 'shade' || state.tool === 'fade') {
          applyTone(entry, point.x, point.y, state.tool);
        } else if (state.tool === 'spray') {
          applySpray(entry, point.x, point.y);
        } else if (state.tool === 'smudge') {
          applySmudge(entry, point.x, point.y);
        } else {
          applyBrush(entry, point.x, point.y);
        }
      }
      // Recomposite before every redraw, not just on commit -- with 2+
      // layers, live feedback during a drag needs the freshly-blended
      // result, not just the active layer's own pixels (single-layer
      // resources already see this for free via the shared array
      // reference ensureLayers() sets up, but this keeps both cases
      // correct through one path rather than relying on that coincidence).
      recomposite(item());
      drawPainter(); updatePreview(); updatePreviewTexture();
    };
    canvas.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      if (state.tool === 'pan') {
        panOrigin = { x: event.clientX, y: event.clientY, scrollLeft: scroll?.scrollLeft || 0, scrollTop: scroll?.scrollTop || 0 };
        drawing = true;
        canvas.setPointerCapture(event.pointerId);
        return;
      }
      const point = pointFor(event);
      if (state.tool === 'select' && state.selection && pointInSelection(point)) {
        // Dragging inside an existing selection moves the pixels under it
        // (cut from the old spot, pasted at the new one) instead of starting
        // a brand new selection.
        selectionDrag = { origin: point, startSelection: { ...state.selection }, buffer: cutSelectionPixels(state.selection) };
      } else {
        selectionDrag = null;
        state.selection = null;
      }
      drawing = true; lastPoint = point; beginHistoryAction();
      smudgeCarry = null;
      canvas.setPointerCapture(event.pointerId); paint(event);
    });
    canvas.addEventListener('pointermove', paint);
    const finish = () => {
      if (!drawing) return;
      drawing = false;
      panOrigin = null;
      if (state.shapePreview) {
        const entry = item();
        if (state.shapePreview.type === 'gradient') {
          applyGradient(entry, state.shapePreview.start, state.shapePreview.end);
          commitHistoryAction('Gradient fill');
        } else {
          applyShape(entry, state.shapePreview.start, state.shapePreview.end, state.shapePreview.type);
          commitHistoryAction(`${state.tool} shape`);
        }
        state.shapePreview = null;
      } else if (state.tool === 'select') {
        if (selectionDrag) {
          commitHistoryAction('Move selection');
          selectionDrag = null;
        } else if (state.selectionDraft && state.selectionDraft.w >= 1 && state.selectionDraft.h >= 1) {
          state.selection = state.selectionDraft;
        }
        state.selectionDraft = null;
        activeHistoryAction = null; // selection alone changes no pixels; nothing to commit
      } else if (!['eyedropper', 'fill', 'replace', 'pan'].includes(state.tool)) {
        commitHistoryAction(`${state.tool} stroke`);
      }
      lastPoint = null;
      if (state.tool === 'select') render();
      else drawPainter();
    };
    canvas.addEventListener('pointerup', finish);
    canvas.addEventListener('pointercancel', finish);
    canvas.addEventListener('lostpointercapture', finish);
    canvas.addEventListener('contextmenu', event => event.preventDefault());
    canvas.addEventListener('wheel', event => {
      event.preventDefault();
      setZoom(state.cameraZoom * (event.deltaY < 0 ? 1.2 : 1 / 1.2));
    }, { passive: false });
  }

  function pointInSelection(point) {
    const selection = state.selection;
    return Boolean(selection) && point.x >= selection.x && point.x < selection.x + selection.w && point.y >= selection.y && point.y < selection.y + selection.h;
  }

  function clampSelectionToBounds(selection, dimensions) {
    const x = Math.max(0, Math.min(selection.x, dimensions.width - 1));
    const y = Math.max(0, Math.min(selection.y, dimensions.height - 1));
    return { x, y, w: Math.min(selection.w, dimensions.width - x), h: Math.min(selection.h, dimensions.height - y) };
  }

  function clearBufferRect(buffer, dimensions, rect) {
    const clamped = clampSelectionToBounds(rect, dimensions);
    for (let y = 0; y < clamped.h; y += 1) for (let x = 0; x < clamped.w; x += 1) {
      const index = ((clamped.y + y) * dimensions.width + (clamped.x + x)) * 4;
      buffer[index] = 0; buffer[index + 1] = 0; buffer[index + 2] = 0; buffer[index + 3] = 0;
    }
  }

  function pasteBlockAt(buffer, dimensions, block, x, y) {
    for (let row = 0; row < block.height; row += 1) for (let col = 0; col < block.width; col += 1) {
      const targetX = x + col, targetY = y + row;
      if (targetX < 0 || targetY < 0 || targetX >= dimensions.width || targetY >= dimensions.height) continue;
      const targetIndex = (targetY * dimensions.width + targetX) * 4, sourceIndex = (row * block.width + col) * 4;
      buffer[targetIndex] = block.data[sourceIndex];
      buffer[targetIndex + 1] = block.data[sourceIndex + 1];
      buffer[targetIndex + 2] = block.data[sourceIndex + 2];
      buffer[targetIndex + 3] = block.data[sourceIndex + 3];
    }
  }

  // Extracts the pixels under a selection into an in-memory block and clears
  // them from the buffer (the "lift" half of a drag-move). Called once at
  // the start of a selection drag; recordMutation() here is what makes the
  // whole drag -- lift, N intermediate repaints, final drop -- collapse into
  // a single undo entry when finish() calls commitHistoryAction.
  function cutSelectionPixels(selection) {
    const entry = item(), buffer = getBuffer(entry), dimensions = dimensionsFor(entry);
    recordMutation(entry);
    const clamped = clampSelectionToBounds(selection, dimensions);
    const data = new Uint8ClampedArray(clamped.w * clamped.h * 4);
    for (let y = 0; y < clamped.h; y += 1) for (let x = 0; x < clamped.w; x += 1) {
      const sourceIndex = ((clamped.y + y) * dimensions.width + (clamped.x + x)) * 4;
      data.set(buffer.slice(sourceIndex, sourceIndex + 4), (y * clamped.w + x) * 4);
    }
    clearBufferRect(buffer, dimensions, clamped);
    return { width: clamped.w, height: clamped.h, data };
  }

  function moveSelectionTo(point) {
    if (!selectionDrag) return;
    const entry = item(), buffer = getBuffer(entry), dimensions = dimensionsFor(entry);
    const dx = point.x - selectionDrag.origin.x, dy = point.y - selectionDrag.origin.y;
    const newX = selectionDrag.startSelection.x + dx, newY = selectionDrag.startSelection.y + dy;
    if (selectionDrag.lastPastedRect) clearBufferRect(buffer, dimensions, selectionDrag.lastPastedRect);
    pasteBlockAt(buffer, dimensions, selectionDrag.buffer, newX, newY);
    selectionDrag.lastPastedRect = { x: newX, y: newY, w: selectionDrag.buffer.width, h: selectionDrag.buffer.height };
    state.selection = { x: newX, y: newY, w: selectionDrag.buffer.width, h: selectionDrag.buffer.height };
  }

  function copySelection() {
    const selection = state.selection; if (!selection) return;
    const entry = item(), buffer = getBuffer(entry), dimensions = dimensionsFor(entry);
    const clamped = clampSelectionToBounds(selection, dimensions);
    const data = new Uint8ClampedArray(clamped.w * clamped.h * 4);
    for (let y = 0; y < clamped.h; y += 1) for (let x = 0; x < clamped.w; x += 1) {
      const sourceIndex = ((clamped.y + y) * dimensions.width + (clamped.x + x)) * 4;
      data.set(buffer.slice(sourceIndex, sourceIndex + 4), (y * clamped.w + x) * 4);
    }
    state.clipboard = { width: clamped.w, height: clamped.h, data };
    render();
  }

  function cutSelectionToClipboard() {
    const selection = state.selection; if (!selection) return;
    const entry = item();
    beginHistoryAction();
    state.clipboard = cutSelectionPixels(selection);
    state.selection = null;
    commitHistoryAction('Cut selection');
    drawPainter(); updatePreviewTexture(); render();
  }

  function deleteSelection() {
    const selection = state.selection; if (!selection) return;
    const entry = item(), dimensions = dimensionsFor(entry);
    beginHistoryAction();
    recordMutation(entry);
    clearBufferRect(getBuffer(entry), dimensions, selection);
    commitHistoryAction('Delete selection');
    drawPainter(); updatePreviewTexture(); render();
  }

  function duplicateSelection() {
    const selection = state.selection; if (!selection) return;
    const entry = item(), dimensions = dimensionsFor(entry);
    beginHistoryAction();
    const block = (() => {
      const buffer = getBuffer(entry);
      recordMutation(entry);
      const clamped = clampSelectionToBounds(selection, dimensions);
      const data = new Uint8ClampedArray(clamped.w * clamped.h * 4);
      for (let y = 0; y < clamped.h; y += 1) for (let x = 0; x < clamped.w; x += 1) {
        const sourceIndex = ((clamped.y + y) * dimensions.width + (clamped.x + x)) * 4;
        data.set(buffer.slice(sourceIndex, sourceIndex + 4), (y * clamped.w + x) * 4);
      }
      return { width: clamped.w, height: clamped.h, data };
    })();
    const offset = 4;
    pasteBlockAt(getBuffer(entry), dimensions, block, selection.x + offset, selection.y + offset);
    state.selection = { x: selection.x + offset, y: selection.y + offset, w: block.width, h: block.height };
    commitHistoryAction('Duplicate selection');
    drawPainter(); updatePreviewTexture(); render();
  }

  function pasteClipboard() {
    const clipboard = state.clipboard; if (!clipboard) return;
    const entry = item(), dimensions = dimensionsFor(entry);
    const x = Math.max(0, Math.floor((dimensions.width - clipboard.width) / 2));
    const y = Math.max(0, Math.floor((dimensions.height - clipboard.height) / 2));
    beginHistoryAction();
    recordMutation(entry);
    pasteBlockAt(getBuffer(entry), dimensions, clipboard, x, y);
    state.selection = { x, y, w: clipboard.width, h: clipboard.height };
    commitHistoryAction('Paste');
    drawPainter(); updatePreviewTexture(); render();
  }

  function setZoom(value) {
    state.cameraZoom = Math.max(0.25, Math.min(32, +value.toFixed(2)));
    const label = document.querySelector('.rp-zoom-label');
    if (label) label.textContent = `Zoom ${Math.round(state.cameraZoom * 100)}%`;
    drawPainter();
  }

  // Backing-store pixels per texel. Computed so a single texel always maps
  // to an integer number of backing-store pixels in BOTH axes -- the only way
  // to guarantee a square, undistorted pixel grid for textures that aren't
  // themselves square (e.g. multi-frame animation strips).
  function paintCellSize(dimensions) {
    const maxDimension = Math.max(dimensions.width, dimensions.height, 1);
    const fitCell = Math.max(2, Math.floor(320 / maxDimension));
    return Math.max(1, Math.round(fitCell * state.cameraZoom));
  }

  function drawPainter() {
    const canvas = document.getElementById('rpPaintCanvas');
    const entry = item();
    if (!canvas || !entry) return;
    const context = canvas.getContext('2d');
    const dimensions = dimensionsFor(entry);
    const cell = paintCellSize(dimensions);
    const targetWidth = dimensions.width * cell, targetHeight = dimensions.height * cell;
    if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
      canvas.width = targetWidth;
      canvas.height = targetHeight;
    }
    canvas.style.width = `${targetWidth}px`;
    canvas.style.height = `${targetHeight}px`;
    canvas.style.maxWidth = 'none';
    canvas.style.maxHeight = 'none';
    canvas.style.display = 'block';
    const image = createImageData(entry);
    const scratch = document.createElement('canvas'); scratch.width = dimensions.width; scratch.height = dimensions.height;
    scratch.getContext('2d').putImageData(image, 0, 0);
    context.imageSmoothingEnabled = false;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(scratch, 0, 0, canvas.width, canvas.height);
    if (state.showGrid && cell >= 3) {
      context.strokeStyle = 'rgba(255,255,255,.16)'; context.lineWidth = 1;
      for (let line = 0; line <= dimensions.width; line += 1) { context.beginPath(); context.moveTo(line * cell, 0); context.lineTo(line * cell, canvas.height); context.stroke(); }
      for (let line = 0; line <= dimensions.height; line += 1) { context.beginPath(); context.moveTo(0, line * cell); context.lineTo(canvas.width, line * cell); context.stroke(); }
    }
    // Live shape preview: line/rectangle/ellipse are drawn here, on top of
    // the committed pixels, without ever touching the actual texture buffer.
    // The buffer is only mutated once, in finish(), when the drag ends -- see
    // the "one continuous drag = one undo transaction, one final image, no
    // stray intermediate marks burned into the texture" requirement.
    if (state.shapePreview) {
      const { type, start, end } = state.shapePreview;
      if (type === 'gradient') {
        // The actual fill is computed over every pixel in applyGradient(); this
        // preview only indicates the gradient's axis and direction.
        context.save();
        context.strokeStyle = hexWithAlpha(state.color, 1);
        context.lineWidth = Math.max(1, cell * .12);
        context.beginPath();
        context.moveTo(start.x * cell + cell / 2, start.y * cell + cell / 2);
        context.lineTo(end.x * cell + cell / 2, end.y * cell + cell / 2);
        context.stroke();
        context.fillStyle = hexWithAlpha(state.color, 1);
        context.beginPath(); context.arc(start.x * cell + cell / 2, start.y * cell + cell / 2, Math.max(2, cell * .25), 0, Math.PI * 2); context.fill();
        context.beginPath(); context.arc(end.x * cell + cell / 2, end.y * cell + cell / 2, Math.max(2, cell * .25), 0, Math.PI * 2); context.stroke();
        context.restore();
      } else {
        const previewPoints = shapePoints(start, end, type);
        const allPreviewPoints = state.symmetry === 'none' ? previewPoints : previewPoints.flatMap(point => symmetryPoints(point.x, point.y, dimensions));
        context.fillStyle = state.tool === 'eraser' ? 'rgba(255,80,80,.85)' : hexWithAlpha(state.color, state.opacity);
        allPreviewPoints.forEach(point => {
          if (point.x < 0 || point.y < 0 || point.x >= dimensions.width || point.y >= dimensions.height) return;
          context.fillRect(point.x * cell, point.y * cell, cell, cell);
        });
      }
    }
    if (state.selection || state.selectionDraft) {
      const { x, y, w, h } = state.selectionDraft || state.selection;
      context.save();
      context.strokeStyle = '#7ef15e'; context.lineWidth = 1.5; context.setLineDash([cell >= 6 ? 4 : 2, cell >= 6 ? 3 : 2]);
      context.strokeRect(x * cell + 0.75, y * cell + 0.75, w * cell - 1.5, h * cell - 1.5);
      context.restore();
    }
    drawTiledPreview(entry, dimensions);
  }

  function hexWithAlpha(hex, opacity) {
    const [r, g, b] = hexToRgb(hex);
    return `rgba(${r},${g},${b},${opacity})`;
  }

  function drawTiledPreview(entry, dimensions) {
    const tiledCanvas = document.getElementById('rpTiledPreview');
    if (!tiledCanvas || !state.tiled) return;
    const context = tiledCanvas.getContext('2d');
    context.imageSmoothingEnabled = false;
    context.clearRect(0, 0, tiledCanvas.width, tiledCanvas.height);
    const scratch = document.createElement('canvas'); scratch.width = dimensions.width; scratch.height = dimensions.height;
    scratch.getContext('2d').putImageData(createImageData(entry), 0, 0);
    const tileSize = Math.floor(tiledCanvas.width / 3);
    for (let row = 0; row < 3; row += 1) for (let col = 0; col < 3; col += 1) {
      context.drawImage(scratch, col * tileSize, row * tileSize, tileSize, tileSize);
    }
    context.strokeStyle = 'rgba(126,241,94,.7)'; context.lineWidth = 1;
    context.strokeRect(tileSize + 0.5, tileSize + 0.5, tileSize - 1, tileSize - 1);
  }

  // Disposes everything GPU-side that a model rebuild is about to discard.
  // Cached vanilla textures in state.modelTextureCache are intentionally
  // NOT touched here -- they're meant to be reused across model loads --
  // only per-mesh geometries/materials (always rebuilt fresh every call)
  // and the one ad-hoc DataTexture built for the resource's own live
  // (Stage-3-edited) buffer, which textureFor() creates new every time and
  // was never being freed.
  function disposePreviewResources(previewInstance) {
    if (!previewInstance?.root) return;
    previewInstance.root.traverse(node => {
      if (!node.isMesh) return;
      node.geometry?.dispose?.();
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      materials.forEach(material => {
        if (material?.map?.isDataTexture) material.map.dispose();
        material?.dispose?.();
      });
    });
  }

  function addModelPreviewLighting(scene) {
    scene.add(new THREE.HemisphereLight(0xffffff, 0x858585, 1.6));
    const keyLight = new THREE.DirectionalLight(0xffffff, 1.2);
    keyLight.position.set(3, 5, 4);
    scene.add(keyLight);
  }

  async function setupPreview() {
    const canvas = document.getElementById('rp3dCanvas');
    const entry = item();
    if (!canvas) {
      console.warn('[RP Studio] 3D canvas missing');
      return;
    }
    if (!window.THREE) {
      console.error('[RP Studio] Three.js is unavailable; renderer bootstrap failed.');
      setStatus('Three.js did not initialize. 3D preview cannot render.', true);
      return;
    }
    if (!entry) {
      console.warn('[RP Studio] no selected resource for 3D preview');
      return;
    }
    const generation = ++previewGeneration;
    ++modelRebuildGeneration; // invalidate any in-flight targeted rebuild -- a full preview re-setup supersedes it
    disposePreviewResources(preview);
    preview?.stop?.();
    preview = null;
    const requestGeneration = state.requestGeneration;
    console.info('[RP Studio] setup preview', { entryId: entry.id, modelName: entry.modelName, version: state.version, canvasWidth: canvas.clientWidth, canvasHeight: canvas.clientHeight });
    const model = await loadModel(entry);
    if (generation !== previewGeneration || requestGeneration !== state.requestGeneration || item()?.id !== entry.id) {
      return;
    }
    const width = Math.max(260, canvas.parentElement?.clientWidth || canvas.clientWidth || 260);
    const height = Math.max(260, canvas.parentElement?.clientHeight || canvas.clientHeight || 260);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(34, width / height, .01, 100);
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2)); renderer.setSize(width, height, false);
    addModelPreviewLighting(scene);
    const root = new THREE.Group();
    const meshes = buildModelMeshes(model, entry);
    const canSelectElements = modelElementCount(model) > 0 && !model?.__compositeItem;
    const textureLoads = meshes
      .map(mesh => {
        const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
        return material?.map?.userData?.loadPromise;
      })
      .filter(Boolean);
    // Texture requests are asynchronous and Three.js will otherwise render
    // the first frame with an empty image. Wait for all referenced textures
    // (including failed requests, whose promises are deliberately settled)
    // before exposing the preview. This removes the intermittent black model
    // state while retaining the renderer's live animation/update loop.
    if (textureLoads.length) await Promise.allSettled(textureLoads);
    if (generation !== previewGeneration || requestGeneration !== state.requestGeneration || item()?.id !== entry.id) {
      disposeModelThumbnailMeshes(meshes);
      return;
    }
    meshes.forEach(mesh => root.add(mesh));
    if (!meshes.length && !state.modelDiagnostics[entry.id]) {
      state.modelDiagnostics[entry.id] = { state: 'empty', message: 'This model resolved but has no elements to render.' };
    }
    scene.add(root);
    // Real bounds-based framing (spec: "do not assume every model is a full
    // block"): measure the actual generated geometry rather than assuming a
    // fixed 16x16x16 cube, so a torch, a partial-block element, or anything
    // oversized still gets centered and fit in view correctly.
    root.updateMatrixWorld(true);
    const rawBox = meshes.length ? new THREE.Box3().setFromObject(root) : new THREE.Box3(new THREE.Vector3(-.5, -.5, -.5), new THREE.Vector3(.5, .5, .5));
    const center = rawBox.getCenter(new THREE.Vector3());
    const size = rawBox.getSize(new THREE.Vector3());
    root.position.copy(center).negate();
    const bounds = { min: rawBox.min.clone().sub(center), max: rawBox.max.clone().sub(center), size: size.clone(), elementCount: modelElementCount(model) };
    const maxDimension = Math.max(size.x, size.y, size.z, 0.08);
    const frameCamera = () => {
      const distance = Math.max(.5, maxDimension * 2.35) / Math.max(.2, state.modelCameraZoom);
      camera.position.set(distance * .62, distance * .5, distance * .82);
      camera.lookAt(0, 0, 0);
    };
    frameCamera();
    // Editor-only visualization aids -- never part of the exported model,
    // just Object3D helpers toggled on/off in the scene.
    const grid = new THREE.GridHelper(Math.max(1.4, maxDimension * 2.4), 12, 0x4a6a45, 0x263028);
    grid.position.y = bounds.min.y;
    grid.visible = state.showModelGrid;
    scene.add(grid);
    const axes = new THREE.AxesHelper(Math.max(.35, maxDimension * .7));
    axes.visible = state.showModelAxes;
    root.add(axes); // child of root: always marks Minecraft's true model origin, and rotates with the model
    const boundsBox = new THREE.Box3Helper(new THREE.Box3(bounds.min, bounds.max), new THREE.Color(0x7ef15e));
    boundsBox.visible = state.showModelBounds;
    root.add(boundsBox);
    let stopped = false;
    const stop = () => {
      stopped = true;
      renderer.dispose();
    };
    // Renders every frame regardless of auto-rotate -- previously a
    // non-auto-rotating viewport rendered exactly once and then froze, so
    // dragging to orbit/pan or scrolling to zoom updated internal state but
    // never visibly moved anything. Only the model's own spin is
    // conditional; the render call itself is not.
    const animate = () => {
      if (stopped || generation !== previewGeneration || !document.getElementById('rp3dCanvas')) {
        stop();
        return;
      }
      if (state.autoRotate) root.rotation.y += .008;
      root.scale.setScalar(state.scale);
      renderer.render(scene, camera);
      requestAnimationFrame(animate);
    };
    preview = { renderer, scene, camera, mesh: root, root, grid, axes, boundsBox, bounds, frameCamera, stop };
    animate();
    canvas.onwheel = event => {
      event.preventDefault();
      state.modelCameraZoom = Math.max(.3, Math.min(6, state.modelCameraZoom + event.deltaY * -.0016));
      frameCamera();
    };
    let dragging = false; let panMode = false; let lastX = 0; let lastY = 0;
    let painting = false;
    canvas.onpointerdown = event => {
      if (event.button === 0) {
        if (state.modelInteractionMode === 'select' && canSelectElements) {
          selectModelElementAt(event);
        } else {
          painting = true;
          beginHistoryAction();
          paintModelAt(event);
        }
      } else if (event.button === 2 || event.button === 1) {
        dragging = true; panMode = event.button === 1; lastX = event.clientX; lastY = event.clientY;
      }
      canvas.setPointerCapture(event.pointerId);
    };
    canvas.onpointermove = event => {
      if (painting) paintModelAt(event);
      if (!dragging) return;
      if (panMode) {
        camera.position.x -= (event.clientX - lastX) * .006 * maxDimension;
        camera.position.y += (event.clientY - lastY) * .006 * maxDimension;
      } else {
        root.rotation.y += (event.clientX - lastX) * .01;
        root.rotation.x = Math.max(-1.2, Math.min(1.2, root.rotation.x + (event.clientY - lastY) * .01));
      }
      lastX = event.clientX; lastY = event.clientY;
    };
    const finishPreviewPointer = () => {
      if (painting) commitHistoryAction('3D paint stroke');
      painting = false; dragging = false; panMode = false;
    };
    canvas.onpointerup = finishPreviewPointer;
    canvas.onpointercancel = finishPreviewPointer;
    canvas.onlostpointercapture = finishPreviewPointer;
    canvas.oncontextmenu = event => event.preventDefault();
  }

  // Distinguishes three real cases Stage 4's single fallback plane
  // conflated: a proper "generated" flat item (which Minecraft renders as
  // one flat quad per layerN texture, stacked with a tiny depth offset --
  // not just layer0), a "builtin/entity" special model (chests, shields,
  // banners, beds, decorated pots -- rendered by Minecraft's Java entity
  // renderer, which has no resource-pack model JSON representation at
  // all), and a genuinely unsupported/empty model. Each gets its own
  // honest outcome instead of one generic plane standing in for all three.
  function buildGeneratedOrBuiltinMeshes(model, entry, catalogThumbnail = false) {
    if (model?.__builtin === 'builtin/entity') {
      const texturePath = resourcePath(entry).replace(/\.png$/i, '')
        .replace(/^items\//, 'item/').replace(/^blocks\//, 'block/');
      if (!texturePath) {
        state.modelDiagnostics[entry.id] = { state: 'builtin-entity', message: 'Minecraft renders this item with its special entity renderer; the client JAR does not provide a standalone item sprite or resource-pack model to preview.' };
        return [];
      }
      const dimensions = dimensionsFor(entry);
      const geometry = new THREE.PlaneGeometry(Math.max(.35, dimensions.width / Math.max(1, dimensions.height)), 1);
      const material = new THREE.MeshStandardMaterial({
        map: textureFor(`minecraft:${texturePath}`, entry, catalogThumbnail),
        color: 0xffffff,
        roughness: .88,
        side: THREE.DoubleSide,
        transparent: true,
        alphaTest: .05,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.userData = { textureRef: `minecraft:${texturePath}`, elementIndex: 0, side: 'special-item', entryId: entry.id };
      state.modelDiagnostics[entry.id] = { state: 'builtin-entity', message: 'Minecraft renders this item with a special Java renderer; showing its official texture as a flat sprite because the client JAR contains no equivalent block-model geometry.' };
      return [mesh];
    }
    const layerKeys = Object.keys(model?.textures || {}).filter(key => /^layer\d+$/.test(key)).sort((a, b) => Number(a.slice(5)) - Number(b.slice(5)));
    if (model?.__builtin === 'builtin/generated' || layerKeys.length) {
      const dimensions = dimensionsFor(entry);
      const aspect = dimensions.width / Math.max(1, dimensions.height);
      const keys = layerKeys.length ? layerKeys : ['layer0'];
      const meshes = keys.map((layerKey, index) => {
        const textureRef = resolveTexture(model?.textures || {}, `#${layerKey}`);
        const geometry = new THREE.PlaneGeometry(Math.max(.35, aspect), 1);
        const material = new THREE.MeshStandardMaterial({
          map: textureFor(textureRef, entry, catalogThumbnail),
          color: model.__itemTintColor ?? 0xffffff,
          roughness: .88,
          side: THREE.DoubleSide,
          transparent: true,
          alphaTest: .05,
        });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.z = index * (1 / 16); // Minecraft stacks generated-item layers ~1/16 apart to avoid z-fighting
        mesh.userData = { textureRef, elementIndex: 0, side: layerKey, entryId: entry.id };
        return mesh;
      });
      state.modelDiagnostics[entry.id] = model.__specialRenderer
        ? { state: 'builtin-entity', message: `Minecraft renders this item with its special ${model.__specialRenderer} renderer; showing its official, dyed base texture as a flat sprite. Runtime animation, pose, and custom pattern layers are not simulated.` }
        : { state: 'generated', message: `Generated item (${keys.length} layer${keys.length === 1 ? '' : 's'}) -- flat sprite, not a 3D block model.` };
      return meshes;
    }
    state.modelDiagnostics[entry.id] = { state: 'unsupported', message: 'This model has no elements and no recognized generated/builtin form -- there is nothing valid to render.' };
    return [];
  }

  function buildModelMeshes(model, entry, catalogThumbnail = false) {
    if (Array.isArray(model?.__blockstateParts)) {
      const meshes = model.__blockstateParts.flatMap(part => {
        const meshes = buildModelMeshes(part.model, entry, catalogThumbnail);
        const xRotation = Number(part.x) || 0;
        const yRotation = Number(part.y) || 0;
        const hasBlockRotation = xRotation % 360 !== 0 || yRotation % 360 !== 0;
        const transformation = part.transformation;
        if (!hasBlockRotation && !transformation) return meshes;
        const rotation = hasBlockRotation
          ? new THREE.Matrix4()
            .makeRotationY(THREE.MathUtils.degToRad(yRotation))
            .multiply(new THREE.Matrix4().makeRotationX(THREE.MathUtils.degToRad(xRotation)))
          : null;
        const itemTransform = transformation ? new THREE.Matrix4()
          .compose(
            new THREE.Vector3(...(transformation.translation || [0, 0, 0]).map(value => Number(value) / 16)),
            new THREE.Quaternion().fromArray(transformation.left_rotation || [0, 0, 0, 1]),
            new THREE.Vector3(...(transformation.scale || [1, 1, 1]).map(value => Number.isFinite(Number(value)) ? Number(value) : 1)),
          )
          .multiply(new THREE.Matrix4().makeRotationFromQuaternion(
            new THREE.Quaternion().fromArray(transformation.right_rotation || [0, 0, 0, 1]),
          )) : null;
        meshes.forEach(mesh => {
          if (rotation) {
            mesh.geometry.applyMatrix4(rotation);
            const uvLockAngle = part.uvlock === true ? blockstateUvLockAngle(mesh.userData.side, rotation) : 0;
            if (Math.abs(uvLockAngle) > 1e-6) rotateFaceUvs(mesh.geometry, uvLockAngle);
            mesh.userData.blockstateRotation = { x: xRotation, y: yRotation, uvlock: part.uvlock === true };
          }
          if (itemTransform) mesh.geometry.applyMatrix4(itemTransform);
          mesh.geometry.computeVertexNormals();
          mesh.userData.blockstateModel = part.modelPath;
        });
        return meshes;
      });
      if (model.__itemDefinitionDiagnostic) {
        state.modelDiagnostics[entry.id] = { state: 'item-model-definition', message: model.__itemDefinitionDiagnostic };
      }
      return meshes;
    }
    if (!model?.elements?.length) {
      return buildGeneratedOrBuiltinMeshes(model, entry, catalogThumbnail);
    }
    const meshes = [];
    model.elements.forEach((element, elementIndex) => {
      const from = element.from || [0, 0, 0], to = element.to || [16, 16, 16];
      Object.entries(element.faces || {}).forEach(([side, face]) => {
        let positions = faceVertices(from, to, side);
        if (!positions) return;
        positions = applyElementRotation(positions, element.rotation);
        const geometry = new THREE.BufferGeometry();
        const textureRef = resolveTexture(model.textures || {}, face.texture);
        const textureOptions = resolveTextureOptions(model.textures || {}, face.texture);
        const target = textureEntryForRef(textureRef, entry) || entry;
        const dimensions = dimensionsFor(target);
        const uv = face.uv || defaultFaceUv(side, from, to, dimensions);
        const u0 = Number(uv?.[0] ?? 0) / dimensions.width, v0 = 1 - Number(uv?.[1] ?? dimensions.height) / dimensions.height;
        const u1 = Number(uv?.[2] ?? dimensions.width) / dimensions.width, v1 = 1 - Number(uv?.[3] ?? dimensions.height) / dimensions.height;
        const turns = ((Number(face.rotation) || 0) / 90) % 4;
        const order = turns === 1 ? [1, 2, 3, 0] : turns === 2 ? [2, 3, 0, 1] : turns === 3 ? [3, 0, 1, 2] : [0, 1, 2, 3];
        const pos = [positions[order[0]], positions[order[1]], positions[order[2]], positions[order[0]], positions[order[2]], positions[order[3]]].flat();
        const uvs = [u0, v0, u1, v0, u1, v1, u0, v0, u1, v1, u0, v1];
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
        geometry.computeVertexNormals();
        const material = new THREE.MeshStandardMaterial({
          map: textureFor(textureRef, entry, catalogThumbnail),
          color: 0xffffff,
          roughness: .88,
          side: THREE.DoubleSide,
          transparent: textureOptions.force_translucent === true,
          alphaTest: textureOptions.force_translucent === true ? 0 : .05,
        });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.userData = { textureRef, elementIndex, side, entryId: entry.id };
        meshes.push(mesh);
      });
    });
    return meshes;
  }

  function blockstateUvLockAngle(side, rotation) {
    const normals = {
      down: new THREE.Vector3(0, -1, 0), up: new THREE.Vector3(0, 1, 0),
      north: new THREE.Vector3(0, 0, -1), south: new THREE.Vector3(0, 0, 1),
      west: new THREE.Vector3(-1, 0, 0), east: new THREE.Vector3(1, 0, 0),
    };
    const localUps = {
      down: new THREE.Vector3(0, 0, 1), up: new THREE.Vector3(0, 0, -1),
      north: new THREE.Vector3(0, 1, 0), south: new THREE.Vector3(0, 1, 0),
      west: new THREE.Vector3(0, 1, 0), east: new THREE.Vector3(0, 1, 0),
    };
    const normal = normals[side];
    const localUp = localUps[side];
    if (!normal || !localUp) return 0;
    const rotatedNormal = normal.clone().transformDirection(rotation);
    const rotatedUp = localUp.clone().transformDirection(rotation);
    const worldUp = new THREE.Vector3(0, 1, 0);
    const projectedWorldUp = worldUp.clone().addScaledVector(rotatedNormal, -worldUp.dot(rotatedNormal));
    if (projectedWorldUp.lengthSq() < .01) {
      projectedWorldUp.copy(rotatedNormal.y > 0 ? localUps.up : localUps.down);
    } else {
      projectedWorldUp.normalize();
    }
    return Math.atan2(rotatedUp.cross(projectedWorldUp).dot(rotatedNormal), rotatedUp.dot(projectedWorldUp));
  }

  function rotateFaceUvs(geometry, angle) {
    const uvs = geometry.getAttribute('uv');
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);
    for (let index = 0; index < uvs.count; index += 1) {
      const u = uvs.getX(index) - .5;
      const v = uvs.getY(index) - .5;
      uvs.setXY(index, .5 + u * cosine - v * sine, .5 + u * sine + v * cosine);
    }
    uvs.needsUpdate = true;
  }

  function disposeModelThumbnailMeshes(meshes) {
    meshes.forEach(mesh => {
      mesh.geometry?.dispose?.();
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      materials.forEach(material => {
        if (material?.map?.isDataTexture) material.map.dispose();
        material?.dispose?.();
      });
    });
  }

  function renderModelThumbnail(meshes) {
    if (!meshes.length || !window.THREE) return null;
    if (!modelThumbnailRenderer) {
      modelThumbnailCanvas = document.createElement('canvas');
      modelThumbnailCanvas.width = 112;
      modelThumbnailCanvas.height = 112;
      const renderer = new THREE.WebGLRenderer({ canvas: modelThumbnailCanvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.setPixelRatio(1);
      renderer.setSize(112, 112, false);
      renderer.setClearColor(0x000000, 0);
      const scene = new THREE.Scene();
      addModelPreviewLighting(scene);
      const camera = new THREE.PerspectiveCamera(32, 1, .01, 100);
      modelThumbnailRenderer = { renderer, scene, camera };
    }
    const { renderer, scene, camera } = modelThumbnailRenderer;
    const root = new THREE.Group();
    meshes.forEach(mesh => root.add(mesh));
    scene.add(root);
    root.rotation.y = .62;
    root.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(root);
    const center = bounds.getCenter(new THREE.Vector3());
    const size = bounds.getSize(new THREE.Vector3());
    root.position.sub(center);
    root.updateMatrixWorld(true);
    const distance = Math.max(.75, Math.max(size.x, size.y, size.z, .2) * 2.8);
    camera.position.set(distance * .72, distance * .56, distance * .82);
    camera.lookAt(0, 0, 0);
    renderer.render(scene, camera);
    const dataUrl = modelThumbnailCanvas.toDataURL('image/png');
    scene.remove(root);
    meshes.forEach(mesh => root.remove(mesh));
    return dataUrl;
  }

  function applyElementRotation(positions, rotation) {
    if (!rotation?.axis || !Number.isFinite(Number(rotation.angle))) return positions;
    const origin = new THREE.Vector3(...(rotation.origin || [8, 8, 8]).map(value => Number(value) / 16 - .5));
    const axis = new THREE.Vector3(
      rotation.axis === 'x' ? 1 : 0,
      rotation.axis === 'y' ? 1 : 0,
      rotation.axis === 'z' ? 1 : 0,
    );
    const quaternion = new THREE.Quaternion().setFromAxisAngle(axis, THREE.MathUtils.degToRad(Number(rotation.angle)));
    return positions.map(values => {
      const point = new THREE.Vector3(...values).sub(origin).applyQuaternion(quaternion).add(origin);
      return [point.x, point.y, point.z];
    });
  }

  function resolveTexture(textures, reference) {
    let value = String(reference || '').replace(/^#/, '');
    const seen = new Set();
    while (value.startsWith('#') || textures[value]) {
      if (seen.has(value)) break;
      seen.add(value);
      value = textures[value];
      if (value && typeof value === 'object') value = value.sprite || '';
      value = String(value || '').replace(/^#/, '');
      if (!textures[value]) break;
    }
    return value.replace(/^minecraft:/, '').replace(/^textures\//, '').replace(/\.png$/i, '') || 'block/missing';
  }

  function resolveTextureOptions(textures, reference) {
    let value = String(reference || '').replace(/^#/, '');
    const seen = new Set();
    while (textures?.[value] !== undefined && !seen.has(value)) {
      seen.add(value);
      const resolved = textures[value];
      if (resolved && typeof resolved === 'object') return resolved;
      value = String(resolved || '').replace(/^#/, '');
    }
    return {};
  }

  function staticItemModelReferences(node, result = [], seen = new Set()) {
    if (!node || typeof node !== 'object' || seen.has(node)) return result;
    seen.add(node);
    const type = String(node.type || '').replace(/^minecraft:/, '');
    if (type === 'model' && typeof node.model === 'string') {
      result.push({ model: node.model, transformation: node.transformation || null });
    } else if (type === 'condition') {
      staticItemModelReferences(node.on_false || node.on_true, result, seen);
    } else if (type === 'range_dispatch') {
      const first = [...(node.entries || [])].sort((left, right) => Number(left.threshold) - Number(right.threshold))[0];
      staticItemModelReferences(first?.model, result, seen);
    } else if (type === 'select') {
      staticItemModelReferences(node.fallback || node.cases?.[0]?.model, result, seen);
    } else if (type === 'composite') {
      (node.models || []).forEach(model => staticItemModelReferences(model, result, seen));
    }
    return result;
  }

  function defaultSpecialItemModel(node, seen = new Set()) {
    if (!node || typeof node !== 'object' || seen.has(node)) return null;
    seen.add(node);
    const type = String(node.type || '').replace(/^minecraft:/, '');
    if (type === 'special') return node;
    if (type === 'condition') {
      return defaultSpecialItemModel(node.on_false, seen) || defaultSpecialItemModel(node.on_true, seen);
    }
    if (type === 'select') {
      return defaultSpecialItemModel(node.fallback, seen)
        || defaultSpecialItemModel(node.cases?.[0]?.model, seen);
    }
    if (type === 'range_dispatch') {
      const first = [...(node.entries || [])].sort((left, right) => Number(left.threshold) - Number(right.threshold))[0];
      return defaultSpecialItemModel(first?.model, seen);
    }
    if (type === 'composite') {
      for (const model of node.models || []) {
        const special = defaultSpecialItemModel(model, seen);
        if (special) return special;
      }
    }
    return null;
  }

  function itemDefinitionHasDynamicSelection(node, seen = new Set()) {
    if (!node || typeof node !== 'object' || seen.has(node)) return false;
    seen.add(node);
    const type = String(node.type || '').replace(/^minecraft:/, '');
    if (type === 'condition' || type === 'range_dispatch' || type === 'select') return true;
    return (node.models || []).some(model => itemDefinitionHasDynamicSelection(model, seen))
      || (node.cases || []).some(entry => itemDefinitionHasDynamicSelection(entry.model, seen))
      || itemDefinitionHasDynamicSelection(node.fallback, seen)
      || itemDefinitionHasDynamicSelection(node.on_false, seen)
      || itemDefinitionHasDynamicSelection(node.on_true, seen);
  }

  function itemDyeColor(name) {
    const colors = {
      white: 0xf9fffe, orange: 0xf9801d, magenta: 0xc74ebd, light_blue: 0x3ab3da,
      yellow: 0xfed83d, lime: 0x80c71f, pink: 0xf38baa, gray: 0x474f52,
      light_gray: 0x9d9d97, cyan: 0x169c9c, purple: 0x8932b8, blue: 0x3c44aa,
      brown: 0x835432, green: 0x5e7c16, red: 0xb02e26, black: 0x1d1d21,
    };
    return colors[String(name || '').replace(/^minecraft:/, '')] || 0xffffff;
  }

  // Which project-owned buffer (if any) should back this texture reference,
  // and whether it should read the *live*, currently-editable buffer versus
  // a static fetch. Previously only the resource actually open in the 2D
  // editor got its edited pixels in the 3D preview; a *different* catalog
  // resource that the model also references (e.g. cube_column's separate
  // top/side textures) always re-fetched vanilla, silently ignoring any
  // edits made to it in an earlier session. Now any texture this model
  // references that the project has modified or created gets its project
  // buffer, not just the one currently open.
  // Finds a texture PNG the project itself supplies for a non-vanilla
  // namespace -- an imported pack's assets/<namespace>/textures/<path>.png,
  // stored as a base64 data: URL by the import handler already.
  function findImportedTexturePng(namespace, path) {
    const key = `assets/${namespace}/textures/${path}.png`;
    return (state.importedEntries || []).find(candidate => candidate.path === key) || null;
  }

  function configureModelTexture(texture) {
    // Minecraft PNGs and project buffers use top-left pixel coordinates and
    // sRGB channel values. Normalize both THREE.Texture and DataTexture here:
    // Three.js defaults their flipY values differently, and neither defaults
    // to a color space, which otherwise makes edited 3D previews diverge from
    // the 2D canvas as soon as a project buffer is used.
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.flipY = true;
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;
    return texture;
  }

  function textureFor(textureRef, entry, catalogThumbnail = false) {
    const namespaceMatch = String(textureRef || '').match(/^([a-z0-9_.-]+):(.+)$/i);
    const namespace = namespaceMatch ? namespaceMatch[1] : 'minecraft';
    const bareRef = namespaceMatch ? namespaceMatch[2] : String(textureRef || '');
    if (namespace !== 'minecraft') {
      // Custom namespaces never resolve from Mojang's assets -- only the
      // project's own imported pack data can supply them.
      const cacheKey = `project-ns:${namespace}:${bareRef}`;
      const cached = state.modelTextureCache[cacheKey];
      if (cached) return cached;
      const texture = configureModelTexture(new THREE.Texture());
      let finishLoad;
      texture.userData.loadPromise = new Promise(resolve => { finishLoad = resolve; });
      const importedEntry = findImportedTexturePng(namespace, bareRef);
      if (!importedEntry) {
        if (!state.modelDiagnostics[entry.id]) state.modelDiagnostics[entry.id] = { state: 'texture-missing', message: `Texture "${namespace}:${bareRef}" was not found in the imported pack.` };
        finishLoad();
      } else {
        const image = new Image();
        image.onload = () => { texture.image = image; texture.needsUpdate = true; finishLoad(); };
        image.onerror = finishLoad;
        image.src = importedEntry.data;
      }
      state.modelTextureCache[cacheKey] = texture;
      return texture;
    }
    const target = textureEntryForRef(bareRef, entry) || entry;
    const dimensions = dimensionsFor(target);
    const usesProjectBuffer = Boolean(target?.custom) || isModified(target)
      || (!catalogThumbnail && target === entry && Boolean(state.vanillaLoaded[bufferKey(target)]));
    if (usesProjectBuffer) {
      const buffer = state.buffers[bufferKey(target)] || getBuffer(target);
      const texture = configureModelTexture(new THREE.DataTexture(buffer, dimensions.width, dimensions.height, THREE.RGBAFormat));
      texture.needsUpdate = true;
      return texture;
    }
    const key = `${state.version}:${bareRef}:${dimensions.width}x${dimensions.height}`;
    const cached = state.modelTextureCache[key];
    if (cached) return cached;
    const texture = configureModelTexture(new THREE.Texture());
    let finishLoad;
    texture.userData.loadPromise = new Promise(resolve => { finishLoad = resolve; });
    const assetPath = /^(?:items|blocks|entity)\//.test(bareRef)
      ? `${bareRef}.png`
      : bareRef.startsWith('item/') ? `items/${bareRef.slice('item/'.length)}.png`
        : bareRef.startsWith('block/') ? `blocks/${bareRef.slice('block/'.length)}.png`
          : `blocks/${bareRef}.png`;
    window.launcherAPI?.getResourcePackAsset?.(state.version, assetPath).then(result => {
      if (!result?.ok) {
        // Honest per the brief: don't leave a texture silently blank forever
        // with no indication anything went wrong.
        const existing = state.modelDiagnostics[entry.id];
        if (!existing) state.modelDiagnostics[entry.id] = { state: 'texture-missing', message: `Texture "${bareRef}" could not be found for ${state.version}.` };
        finishLoad();
        return;
      }
      const image = new Image();
      image.onload = () => { texture.image = image; texture.needsUpdate = true; finishLoad(); };
      image.onerror = finishLoad;
      image.src = result.dataUrl;
    }).catch(error => {
      const existing = state.modelDiagnostics[entry.id];
      if (!existing) state.modelDiagnostics[entry.id] = { state: 'texture-missing', message: `Texture "${bareRef}" could not be loaded: ${error.message}` };
      finishLoad();
    });
    state.modelTextureCache[key] = texture;
    return texture;
  }

  function faceVertices(from, to, side) {
    const [x0, y0, z0] = from.map(value => Number(value) / 16 - .5);
    const [x1, y1, z1] = to.map(value => Number(value) / 16 - .5);
    const values = {
      down: [x0, y0, z1, x1, y0, z1, x1, y0, z0, x0, y0, z0],
      up: [x0, y1, z0, x1, y1, z0, x1, y1, z1, x0, y1, z1],
      north: [x1, y1, z0, x0, y1, z0, x0, y0, z0, x1, y0, z0],
      south: [x0, y1, z1, x1, y1, z1, x1, y0, z1, x0, y0, z1],
      west: [x0, y1, z0, x0, y1, z1, x0, y0, z1, x0, y0, z0],
      east: [x1, y1, z1, x1, y1, z0, x1, y0, z0, x1, y0, z1]
    }[side];
    return values ? [values.slice(0, 3), values.slice(3, 6), values.slice(6, 9), values.slice(9, 12)] : null;
  }

  function defaultFaceUv(side, from, to, dimensions = { width: 16, height: 16 }) {
    const [x0, y0, z0] = from, [x1, y1, z1] = to;
    const scaleX = dimensions.width / 16, scaleY = dimensions.height / 16;
    if (side === 'up' || side === 'down') return [x0 * scaleX, z0 * scaleY, x1 * scaleX, z1 * scaleY];
    if (side === 'north' || side === 'south') return [x0 * scaleX, dimensions.height - y1 * scaleY, x1 * scaleX, dimensions.height - y0 * scaleY];
    return [z0 * scaleX, dimensions.height - y1 * scaleY, z1 * scaleX, dimensions.height - y0 * scaleY];
  }

  function raycastModel(event) {
    if (!preview?.root) return null;
    const canvas = event.currentTarget, rect = canvas.getBoundingClientRect();
    const pointer = new THREE.Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    const raycaster = new THREE.Raycaster(); raycaster.setFromCamera(pointer, preview.camera);
    return raycaster.intersectObject(preview.root, true).find(result => result.uv) || null;
  }

  function paintModelAt(event) {
    if (!item()) return;
    const hit = raycastModel(event);
    if (!hit?.uv) return;
    const textureRef = hit.object?.userData?.textureRef;
    const target = textureEntryForRef(textureRef, item()) || item();
    const dimensions = dimensionsFor(target);
    const x = Math.max(0, Math.min(dimensions.width - 1, Math.floor(hit.uv.x * dimensions.width)));
    const y = Math.max(0, Math.min(dimensions.height - 1, Math.floor((1 - hit.uv.y) * dimensions.height)));
    paintPixel(target, x, y);
  }

  // Model-element/face selection is a distinct concept from texture
  // selection (Part 10): it identifies which Minecraft model element and
  // face the user clicked, for inspection, without touching any pixels.
  // Applies a highlight directly to the hit mesh's material rather than
  // triggering a full page render, so the user's current camera
  // orbit/zoom is never disturbed by selecting an element.
  function selectModelElementAt(event) {
    const hit = raycastModel(event);
    if (!preview?.root) return;
    state.selectedElementIndex = hit ? (hit.object.userData?.elementIndex ?? null) : null;
    state.selectedElementSide = hit ? (hit.object.userData?.side ?? null) : null;
    applyElementHighlight(item());
    renderElementInfoPanel();
  }

  const MODEL_FACES = ['north', 'south', 'east', 'west', 'up', 'down'];

  function currentModelFor(entry) {
    return linkPrimaryBlockstateModel(state.modelOverrides[entry.id] || state.modelCache[modelKey(entry)]);
  }

  // Targeted DOM update for the element-info panel only (see comment
  // above) -- deliberately does NOT call the full render()/setupPreview()
  // pipeline. Re-binds its own delegated listeners since outerHTML
  // replacement destroys whatever was attached to the old node.
  function renderElementInfoPanel() {
    const container = document.querySelector('#rpElementInfo');
    if (!container) return;
    container.outerHTML = renderElementInfo(item());
    bindElementInfoEvents();
  }

  function renderElementInfo(entry) {
    const model = currentModelFor(entry);
    const compositePartCount = model?.__compositeItem ? model.__blockstateParts?.length || 0 : 0;
    const elements = compositePartCount ? [] : (model?.elements || []);
    const index = state.selectedElementIndex;
    const element = index != null ? elements[index] : null;
    const diagnosticState = state.modelDiagnostics[entry.id]?.state;
    const isGeneratedModel = diagnosticState === 'generated' || model?.__builtin === 'builtin/generated';
    const isBuiltinEntityModel = diagnosticState === 'builtin-entity' || model?.__builtin === 'builtin/entity';
    // Generated-item and builtin/entity models render through a completely
    // different path (buildGeneratedOrBuiltinMeshes, Pass 1) that has
    // nothing to do with an `elements` array. Offering "Add Element" here
    // would silently convert them into an ordinary 3D block model instead
    // of editing what they actually are -- exactly what this pass's audit
    // flagged. Neither has a real element-editing representation yet, so
    // the honest move is to disable the affordance, not fake one.
    const canAddElements = !compositePartCount && !isGeneratedModel && !isBuiltinEntityModel;
    const listHtml = `<div class="rp-element-list">${elements.map((_, elementIndex) => `<button class="rp-element-chip${elementIndex === index ? ' active' : ''}" data-rp-model-action="select-element" data-index="${elementIndex}">#${elementIndex}</button>`).join('')}${canAddElements ? `<button class="rp-icon-button" data-rp-model-action="add-element" title="Add element (default cube)">+</button>` : ''}</div>`;
    const historyHtml = state.modelUndo.length || state.modelRedo.length
      ? `<div class="rp-model-undo-row"><button class="modal-btn" data-rp-model-action="undo-model"${state.modelUndo.length ? '' : ' disabled'}>Undo model</button><button class="modal-btn" data-rp-model-action="redo-model"${state.modelRedo.length ? '' : ' disabled'}>Redo model</button></div>`
      : '';
    if (!element) {
      const emptyMessage = compositePartCount ? `This item combines ${compositePartCount} component models. Their combined geometry is shown in the preview; editing component geometry is not supported yet.`
        : elements.length ? 'Select an element above, or switch the viewport to Select mode and click a face.'
        : isBuiltinEntityModel ? 'This item is rendered by Minecraft\u2019s special entity renderer, not a resource-pack element model -- there is no element list to build here.'
        : isGeneratedModel ? 'This is a generated (flat sprite) item. Per-layer editing isn\u2019t implemented yet, so element editing is disabled here rather than silently turning it into an unrelated 3D block model.'
        : 'This model has no elements yet -- add one to start building geometry.';
      const displayedElementCount = compositePartCount ? modelElementCount(model) : elements.length;
      return `<div id="rpElementInfo" class="rp-inspector-section"><div class="rp-pane-heading"><strong>Model elements</strong><span>${displayedElementCount}</span></div>${listHtml}<p class="rp-muted">${emptyMessage}</p>${historyHtml}</div>`;
    }
    const from = element.from || [0, 0, 0], to = element.to || [16, 16, 16];
    const size = from.map((value, axis) => Math.abs((to[axis] ?? 16) - value));
    const rotation = element.rotation;
    const side = state.selectedElementSide;
    const face = side ? element.faces?.[side] : null;
    const vectorRow = (label, key, values) => `<div class="rp-model-vec-row"><span>${label}</span>${['X', 'Y', 'Z'].map((axisLabel, axis) => `<input class="modal-input" type="number" step="0.5" data-rp-model-field="${key}${axisLabel}" title="${axisLabel}" value="${values[axis]}">`).join('')}</div>`;
    // UV is its own 4-field row (U0,V0,U1,V1) -- deliberately not reusing
    // vectorRow, which is X/Y/Z-shaped and would silently drop the 4th value.
    const uvRow = values => `<div class="rp-model-vec-row"><span>UV</span>${['U0', 'V0', 'U1', 'V1'].map((label, uvIndex) => `<input class="modal-input" type="number" step="1" data-rp-model-field="uv${uvIndex}" title="${label}" value="${values[uvIndex]}">`).join('')}</div>`;
    const rotationBlock = rotation ? `
      <div class="rp-model-vec-row"><span>Axis</span><select class="modal-select" data-rp-model-field="rotationAxis">${['x', 'y', 'z'].map(axisName => `<option value="${axisName}"${rotation.axis === axisName ? ' selected' : ''}>${axisName}</option>`).join('')}</select><input class="modal-input" type="number" step="22.5" data-rp-model-field="rotationAngle" title="Angle" value="${rotation.angle ?? 0}"><label class="rp-check"><input type="checkbox" data-rp-model-field="rotationRescale"${rotation.rescale ? ' checked' : ''}> Rescale</label></div>
      ${vectorRow('Origin', 'rotationOrigin', rotation.origin || [8, 8, 8])}` : '';
    const faceButtons = `<div class="rp-element-list">${MODEL_FACES.map(faceSide => `<button class="rp-element-chip${faceSide === side ? ' active' : ''}${element.faces?.[faceSide] ? '' : ' rp-face-missing'}" data-rp-model-action="select-face" data-side="${faceSide}" title="${element.faces?.[faceSide] ? faceSide : `${faceSide} (no face)`}">${faceSide.slice(0, 1).toUpperCase()}</button>`).join('')}</div>`;
    const faceDetail = !side ? ''
      : face ? `
        ${uvRow(face.uv || [0, 0, 16, 16])}
        <label class="rp-block-label">Texture ref<input class="modal-input" type="text" data-rp-model-field="texture" value="${esc(face.texture || '')}" spellcheck="false"></label>
        <div class="rp-model-vec-row"><span>Rotation</span><select class="modal-select" data-rp-model-field="faceRotation">${[0, 90, 180, 270].map(angle => `<option value="${angle}"${(face.rotation || 0) === angle ? ' selected' : ''}>${angle}&deg;</option>`).join('')}</select><select class="modal-select" data-rp-model-field="cullface"><option value=""${!face.cullface ? ' selected' : ''}>No cullface</option>${MODEL_FACES.map(cf => `<option value="${cf}"${face.cullface === cf ? ' selected' : ''}>${cf}</option>`).join('')}</select></div>
        <label class="rp-block-label">Tintindex<input class="modal-input" type="number" data-rp-model-field="tintindex" value="${face.tintindex ?? ''}" placeholder="none"></label>
        <button class="modal-btn" data-rp-model-action="remove-face">Remove ${side} face</button>`
      : `<button class="modal-btn" data-rp-model-action="add-face">Add ${side} face</button>`;
    return `<div id="rpElementInfo" class="rp-inspector-section">
      <div class="rp-pane-heading"><strong>Model elements</strong><span>${elements.length}</span></div>
      ${listHtml}
      <div class="rp-pane-heading"><strong>Element #${index}</strong><span>${size.map(value => value.toFixed(1)).join(' \u00d7 ')}</span></div>
      ${vectorRow('From', 'from', from)}
      ${vectorRow('To', 'to', to)}
      <label class="rp-check"><input type="checkbox" data-rp-model-field="rotationEnabled"${rotation ? ' checked' : ''}> Rotation</label>
      ${rotationBlock}
      <div class="rp-pane-heading"><strong>Face</strong><span>${side || 'none selected'}</span></div>
      ${faceButtons}
      ${faceDetail}
      <button class="modal-btn rp-danger" data-rp-model-action="delete-element">Delete element</button>
      <div class="rp-model-undo-row"><button class="modal-btn" data-rp-model-action="undo-model">Undo model</button><button class="modal-btn" data-rp-model-action="redo-model">Redo model</button></div>
    </div>`;
  }

  function bindElementInfoEvents() {
    const container = document.querySelector('#rpElementInfo');
    if (!container) return;
    const entry = item(); if (!entry) return;
    container.querySelectorAll('[data-rp-model-action]').forEach(button => button.addEventListener('click', () => {
      const action = button.dataset.rpModelAction;
      if (action === 'select-element') { state.selectedElementIndex = Number(button.dataset.index); state.selectedElementSide = null; applyElementHighlight(entry); renderElementInfoPanel(); }
      else if (action === 'select-face') { state.selectedElementSide = button.dataset.side; applyElementHighlight(entry); renderElementInfoPanel(); }
      else if (action === 'add-element') addModelElement(entry);
      else if (action === 'delete-element') deleteModelElement(entry, state.selectedElementIndex);
      else if (action === 'add-face') updateFaceField(entry, state.selectedElementIndex, state.selectedElementSide, 'add');
      else if (action === 'remove-face') updateFaceField(entry, state.selectedElementIndex, state.selectedElementSide, 'remove');
      else if (action === 'undo-model') undoModel();
      else if (action === 'redo-model') redoModel();
    }));
    container.querySelectorAll('[data-rp-model-field]').forEach(input => input.addEventListener('change', () => {
      const field = input.dataset.rpModelField;
      const index = state.selectedElementIndex, side = state.selectedElementSide;
      const numeric = () => Number(input.value);
      if (field.startsWith('from') || field.startsWith('to')) {
        const key = field.startsWith('from') ? 'from' : 'to';
        const axis = { X: 0, Y: 1, Z: 2 }[field.slice(-1)];
        updateElementVector(entry, index, key, axis, numeric());
      } else if (field === 'rotationEnabled') updateElementRotation(entry, index, 'enabled', input.checked);
      else if (field === 'rotationAxis') updateElementRotation(entry, index, 'axis', input.value);
      else if (field === 'rotationAngle') updateElementRotation(entry, index, 'angle', numeric());
      else if (field === 'rotationRescale') updateElementRotation(entry, index, 'rescale', input.checked);
      else if (field.startsWith('rotationOrigin')) updateElementRotation(entry, index, `origin${field.slice(-1)}`, numeric());
      else if (field.startsWith('uv')) updateFaceField(entry, index, side, field, numeric());
      else if (field === 'texture') updateFaceField(entry, index, side, 'texture', input.value);
      else if (field === 'faceRotation') updateFaceField(entry, index, side, 'rotation', numeric());
      else if (field === 'cullface') updateFaceField(entry, index, side, 'cullface', input.value);
      else if (field === 'tintindex') updateFaceField(entry, index, side, 'tintindex', input.value);
      renderElementInfoPanel();
    }));
  }

  function applyElementHighlight(entry) {
    if (!preview?.root) return;
    preview.root.traverse(node => {
      if (!node.isMesh) return;
      const isSelected = node.userData?.elementIndex === state.selectedElementIndex && node.userData?.side === state.selectedElementSide;
      node.material?.emissive?.setHex?.(isSelected ? 0x2f6b3f : 0x000000);
    });
  }

  function beginHistoryAction() {
    if (!activeHistoryAction) activeHistoryAction = { changes: new Map() };
  }

  function recordMutation(entry, explicitKey) {
    if (!entry) return;
    beginHistoryAction();
    const targetKey = explicitKey || activeLayerKey(entry);
    const dedupeKey = explicitKey || bufferKey(entry); // one snapshot per (resource, key) per action
    if (!activeHistoryAction.changes.has(dedupeKey)) {
      activeHistoryAction.changes.set(dedupeKey, {
        entryId: entry.id,
        bufferKey: targetKey,
        before: new Uint8ClampedArray(state.buffers[targetKey] || getBuffer(entry)),
        beforeDimensions: { ...dimensionsFor(entry) },
      });
    }
  }

  function commitHistoryAction(description) {
    const action = activeHistoryAction;
    activeHistoryAction = null;
    if (!action) return;
    const changes = [];
    action.changes.forEach(change => {
      const entry = state.catalog.find(candidate => candidate.id === change.entryId);
      if (!entry) return;
      const after = new Uint8ClampedArray(state.buffers[change.bufferKey] || getBuffer(entry));
      if (after.length !== change.before.length || after.some((value, index) => value !== change.before[index])) {
        changes.push({ ...change, after, afterDimensions: { ...dimensionsFor(entry) } });
        markModified(entry, false);
        recomposite(entry); // keep the base/composite key in sync now that a layer's pixels actually changed
      }
    });
    let layerStructure = null;
    if (action.layerStructure) {
      const after = state.layers[action.layerStructure.contextKey] ? JSON.parse(JSON.stringify(state.layers[action.layerStructure.contextKey])) : null;
      if (JSON.stringify(action.layerStructure.before) !== JSON.stringify(after)) {
        layerStructure = { entryId: action.layerStructure.entryId, contextKey: action.layerStructure.contextKey, before: action.layerStructure.before, after };
      }
    }
    if (!changes.length && !layerStructure) return;
    state.undo.push({ type: 'texture-edit', changes, layerStructure, description });
    state.redo = [];
    persist();
  }

  // Layer *structure* changes (add/delete/rename/visibility/opacity/order)
  // reuse the exact same state.undo/state.redo stack pixel edits use,
  // rather than a second dedicated history -- per the brief's own
  // preference for extending the existing texture-history architecture
  // where possible. beginLayerStructureAction/commitHistoryAction snapshot
  // state.layers[contextKey] (tiny plain JSON, not pixel data) the same way
  // recordMutation snapshots a pixel buffer. contextKey (see layerContext(),
  // Pass 4) is the plain entryId for a static resource, or
  // `${entryId}#f#${frameId}` for the currently active frame of an
  // animated one -- so undoing a layer edit always targets whichever
  // frame it was actually made on.
  function beginLayerStructureAction(entry) {
    beginHistoryAction();
    if (!activeHistoryAction.layerStructure) {
      const contextKey = layerContext(entry);
      activeHistoryAction.layerStructure = { entryId: entry.id, contextKey, before: state.layers[contextKey] ? JSON.parse(JSON.stringify(state.layers[contextKey])) : null };
    }
  }

  function addLayer(entry) {
    ensureLayers(entry);
    beginLayerStructureAction(entry);
    const layerSet = state.layers[layerContext(entry)];
    const nextNumber = layerSet.order.length + 1;
    const layerId = `layer-${Date.now().toString(36)}`;
    const dimensions = dimensionsFor(entry);
    state.buffers[layerBufferKey(entry, layerId)] = new Uint8ClampedArray(dimensions.width * dimensions.height * 4); // new layer starts fully transparent
    layerSet.byId[layerId] = { name: `Layer ${nextNumber}`, visible: true, opacity: 1 };
    layerSet.order.push(layerId);
    layerSet.activeId = layerId;
    commitHistoryAction('Add layer');
    recomposite(entry);
    drawPainter();
    renderLayersPanel();
  }

  // Restores state.layers[contextKey] to a prior structural snapshot on
  // undo/redo. This function was called by undo()/redo() but never actually
  // defined -- a real bug from Pass 3 that `node --check` cannot catch
  // (missing-function is a runtime ReferenceError, not a syntax error, and
  // this environment has no runtime to have caught it sooner). Found while
  // auditing the undo path during this pass's own work and fixed here.
  function restoreLayerStructure(layerStructure, which) {
    const snapshot = layerStructure[which];
    if (snapshot) state.layers[layerStructure.contextKey] = JSON.parse(JSON.stringify(snapshot));
    else delete state.layers[layerStructure.contextKey];
    recomposite(entryById(layerStructure.entryId));
  }

  function deleteLayer(entry, layerId) {
    const layerSet = ensureLayers(entry);
    if (layerSet.order.length <= 1) return; // never allow zero layers -- last one is not deletable
    beginLayerStructureAction(entry);
    layerSet.order = layerSet.order.filter(id => id !== layerId);
    delete layerSet.byId[layerId];
    delete state.buffers[layerBufferKey(entry, layerId)];
    if (layerSet.activeId === layerId) layerSet.activeId = layerSet.order[layerSet.order.length - 1];
    commitHistoryAction('Delete layer');
    recomposite(entry);
    drawPainter();
    updatePreviewTexture();
    renderLayersPanel();
  }

  function selectLayer(entry, layerId) {
    const layerSet = ensureLayers(entry);
    if (!layerSet.byId[layerId] || layerSet.activeId === layerId) return;
    layerSet.activeId = layerId; // which layer paint tools write to -- not a pixel/structural change worth its own undo entry
    persist();
    renderLayersPanel();
  }

  function renameLayer(entry, layerId, name) {
    const layerSet = ensureLayers(entry);
    if (!layerSet.byId[layerId]) return;
    beginLayerStructureAction(entry);
    layerSet.byId[layerId].name = name.trim() || layerSet.byId[layerId].name;
    commitHistoryAction('Rename layer');
    renderLayersPanel();
  }

  function toggleLayerVisibility(entry, layerId) {
    const layerSet = ensureLayers(entry);
    if (!layerSet.byId[layerId]) return;
    beginLayerStructureAction(entry);
    layerSet.byId[layerId].visible = !layerSet.byId[layerId].visible;
    commitHistoryAction('Toggle layer visibility');
    recomposite(entry);
    drawPainter();
    updatePreviewTexture();
    renderLayersPanel();
  }

  function setLayerOpacity(entry, layerId, opacity) {
    const layerSet = ensureLayers(entry);
    if (!layerSet.byId[layerId]) return;
    beginLayerStructureAction(entry);
    layerSet.byId[layerId].opacity = Math.max(0, Math.min(1, opacity));
    commitHistoryAction('Layer opacity');
    recomposite(entry);
    drawPainter();
    updatePreviewTexture();
  }

  function moveLayer(entry, layerId, direction) {
    const layerSet = ensureLayers(entry);
    const index = layerSet.order.indexOf(layerId);
    const targetIndex = index + direction;
    if (index < 0 || targetIndex < 0 || targetIndex >= layerSet.order.length) return;
    beginLayerStructureAction(entry);
    [layerSet.order[index], layerSet.order[targetIndex]] = [layerSet.order[targetIndex], layerSet.order[index]];
    commitHistoryAction('Reorder layers');
    recomposite(entry);
    drawPainter();
    updatePreviewTexture();
    renderLayersPanel();
  }

  // Displayed top-to-bottom (matches the common convention that the top of
  // the list paints in front); state.layers[].order is stored bottom-to-top
  // since that's the order recomposite() blends in.
  function renderLayersPanel() {
    const container = document.querySelector('#rpLayersPanel');
    if (!container) return;
    const entry = item();
    container.outerHTML = renderLayers(entry);
    bindLayersPanelEvents();
  }

  function renderLayers(entry) {
    if (!entry) return '<div id="rpLayersPanel"></div>';
    const layerSet = state.layers[layerContext(entry)]; // read-only peek -- do NOT materialize just by rendering the panel
    const order = layerSet ? layerSet.order : ['layer-1'];
    const byId = layerSet ? layerSet.byId : { 'layer-1': { name: 'Layer 1', visible: true, opacity: 1 } };
    const activeId = layerSet ? layerSet.activeId : 'layer-1';
    const rows = [...order].reverse().map(layerId => {
      const meta = byId[layerId];
      return `<div class="rp-layer-row${layerId === activeId ? ' active' : ''}" data-rp-layer-select="${layerId}">
        <button class="rp-icon-button" data-rp-layer-action="toggle-visible" data-layer="${layerId}" title="Toggle visibility">${meta.visible ? '\u{1F441}' : '\u2013'}</button>
        <input class="rp-layer-name" type="text" value="${esc(meta.name)}" data-rp-layer-action="rename" data-layer="${layerId}" spellcheck="false">
        <input class="rp-layer-opacity" type="range" min="0" max="1" step="0.05" value="${meta.opacity}" data-rp-layer-action="opacity" data-layer="${layerId}" title="Opacity ${Math.round(meta.opacity * 100)}%">
        <button class="rp-icon-button" data-rp-layer-action="move-up" data-layer="${layerId}" title="Move up" ${order.indexOf(layerId) === order.length - 1 ? 'disabled' : ''}>&uarr;</button>
        <button class="rp-icon-button" data-rp-layer-action="move-down" data-layer="${layerId}" title="Move down" ${order.indexOf(layerId) === 0 ? 'disabled' : ''}>&darr;</button>
        <button class="rp-icon-button" data-rp-layer-action="delete" data-layer="${layerId}" title="Delete layer" ${order.length <= 1 ? 'disabled' : ''}>&times;</button>
      </div>`;
    }).join('');
    return `<div id="rpLayersPanel" class="rp-inspector-section"><div class="rp-pane-heading"><strong>Layers</strong><button class="rp-icon-button" data-rp-layer-action="add" title="Add layer">+</button></div><div class="rp-layer-list">${rows}</div></div>`;
  }

  function bindLayersPanelEvents() {
    const container = document.querySelector('#rpLayersPanel');
    if (!container) return;
    const entry = item(); if (!entry) return;
    container.querySelectorAll('[data-rp-layer-select]').forEach(row => row.addEventListener('click', event => {
      if (event.target.closest('[data-rp-layer-action]')) return; // row also contains action buttons/inputs; let those handle their own clicks
      selectLayer(entry, row.dataset.rpLayerSelect);
    }));
    container.querySelectorAll('[data-rp-layer-action]').forEach(control => {
      const action = control.dataset.rpLayerAction;
      const layerId = control.dataset.layer;
      if (action === 'add') control.addEventListener('click', () => addLayer(entry));
      else if (action === 'delete') control.addEventListener('click', () => deleteLayer(entry, layerId));
      else if (action === 'toggle-visible') control.addEventListener('click', () => toggleLayerVisibility(entry, layerId));
      else if (action === 'move-up') control.addEventListener('click', () => moveLayer(entry, layerId, 1));
      else if (action === 'move-down') control.addEventListener('click', () => moveLayer(entry, layerId, -1));
      else if (action === 'rename') control.addEventListener('change', () => renameLayer(entry, layerId, control.value));
      else if (action === 'opacity') control.addEventListener('change', () => setLayerOpacity(entry, layerId, Number(control.value)));
    });
  }

  // Shared by every paint operation (brush/tone/spray/shape) so 'both'
  // reliably produces all four quadrant points instead of each tool
  // reimplementing its own subset of the mirroring logic.
  function symmetryPoints(x, y, dimensions) {
    const points = [{ x, y }];
    const mirrorX = dimensions.width - 1 - x, mirrorY = dimensions.height - 1 - y;
    if (state.symmetry === 'horizontal' || state.symmetry === 'both') points.push({ x: mirrorX, y });
    if (state.symmetry === 'vertical' || state.symmetry === 'both') points.push({ x, y: mirrorY });
    if (state.symmetry === 'both') points.push({ x: mirrorX, y: mirrorY });
    // De-dupe: on an odd-sized texture the center row/column mirrors onto
    // itself, which would otherwise draw/record the same pixel twice.
    const seen = new Set();
    return points.filter(point => { const key = `${point.x},${point.y}`; if (seen.has(key)) return false; seen.add(key); return true; });
  }

  function applyBrush(entry, x, y) {
    recordMutation(entry);
    const dimensions = dimensionsFor(entry), buffer = getBuffer(entry);
    const rgba = state.tool === 'eraser' ? [0, 0, 0, 0] : [...hexToRgb(state.color), Math.round(state.opacity * 255)];
    const points = symmetryPoints(x, y, dimensions);
    const setAt = (targetX, targetY) => {
      if (state.tiled) {
        targetX = ((targetX % dimensions.width) + dimensions.width) % dimensions.width;
        targetY = ((targetY % dimensions.height) + dimensions.height) % dimensions.height;
      } else if (targetX < 0 || targetY < 0 || targetX >= dimensions.width || targetY >= dimensions.height) {
        return;
      }
      const index = (targetY * dimensions.width + targetX) * 4;
      if (state.alphaLock && buffer[index + 3] === 0) return;
      rgba.forEach((value, offset) => { buffer[index + offset] = value; });
    };
    for (const point of points) for (let offsetY = -state.brushSize + 1; offsetY < state.brushSize; offsetY += 1) {
      for (let offsetX = -state.brushSize + 1; offsetX < state.brushSize; offsetX += 1) {
        setAt(point.x + offsetX, point.y + offsetY);
      }
    }
  }

  function applyTone(entry, x, y, mode) {
    recordMutation(entry);
    const dimensions = dimensionsFor(entry), buffer = getBuffer(entry);
    const points = symmetryPoints(x, y, dimensions);
    for (const point of points) for (let offsetY = -state.brushSize + 1; offsetY < state.brushSize; offsetY += 1) {
      for (let offsetX = -state.brushSize + 1; offsetX < state.brushSize; offsetX += 1) {
        const targetX = point.x + offsetX, targetY = point.y + offsetY;
        if (targetX < 0 || targetY < 0 || targetX >= dimensions.width || targetY >= dimensions.height) continue;
        const index = (targetY * dimensions.width + targetX) * 4;
        if (buffer[index + 3] === 0) continue;
        for (let channel = 0; channel < 3; channel += 1) {
          const value = buffer[index + channel];
          buffer[index + channel] = mode === 'shade'
            ? Math.max(0, Math.round(value * 0.85))
            : Math.min(255, Math.round(value + (255 - value) * 0.25));
        }
      }
    }
  }

  // Smudge: at stroke start, samples the pixel under the cursor as the
  // "carried" color; every subsequent point blends that carried color into
  // the destination pixel (weighted by Opacity) and the *result* becomes
  // the new carried color, so color drags/smears along the stroke the way
  // a real smudge tool does, rather than just re-painting one fixed color.
  function applySmudge(entry, x, y) {
    recordMutation(entry);
    const dimensions = dimensionsFor(entry), buffer = getBuffer(entry);
    for (const point of symmetryPoints(x, y, dimensions)) {
      const index = (point.y * dimensions.width + point.x) * 4;
      if (index < 0 || index >= buffer.length) continue;
      if (!smudgeCarry) smudgeCarry = [buffer[index], buffer[index + 1], buffer[index + 2], buffer[index + 3]];
      if (state.alphaLock && buffer[index + 3] === 0) continue;
      const mix = state.opacity;
      const blended = [0, 1, 2, 3].map(offset => Math.round(buffer[index + offset] * (1 - mix) + smudgeCarry[offset] * mix));
      blended.forEach((value, offset) => { buffer[index + offset] = value; });
      smudgeCarry = blended;
    }
  }

  // Gradient: linear fade from the current color at full Opacity (at the
  // drag start) to fully transparent (at the drag end), applied across the
  // active selection if one exists, otherwise the whole canvas. One commit
  // on release -- no separate live fill preview (see the report), but the
  // operation itself is real and correctly a single undo transaction.
  function applyGradient(entry, start, end) {
    recordMutation(entry);
    const dimensions = dimensionsFor(entry), buffer = getBuffer(entry);
    const bounds = state.selection ? clampSelectionToBounds(state.selection, dimensions) : { x: 0, y: 0, w: dimensions.width, h: dimensions.height };
    const dx = end.x - start.x, dy = end.y - start.y;
    const lengthSq = Math.max(1, dx * dx + dy * dy);
    const [r, g, b] = hexToRgb(state.color);
    for (let y = bounds.y; y < bounds.y + bounds.h; y += 1) for (let x = bounds.x; x < bounds.x + bounds.w; x += 1) {
      const t = Math.max(0, Math.min(1, ((x - start.x) * dx + (y - start.y) * dy) / lengthSq));
      const index = (y * dimensions.width + x) * 4;
      if (state.alphaLock && buffer[index + 3] === 0) continue;
      buffer[index] = r; buffer[index + 1] = g; buffer[index + 2] = b;
      buffer[index + 3] = Math.round(state.opacity * (1 - t) * 255);
    }
  }

  function applySpray(entry, x, y) {
    recordMutation(entry);
    const dimensions = dimensionsFor(entry), buffer = getBuffer(entry);
    const radius = Math.max(1, state.brushSize * 2);
    const rgba = state.tool === 'eraser' ? [0, 0, 0, 0] : [...hexToRgb(state.color), Math.round(state.opacity * 255)];
    const centers = symmetryPoints(x, y, dimensions);
    for (const center of centers) for (let attempt = 0; attempt < 6; attempt += 1) {
      const angle = Math.random() * Math.PI * 2, distance = Math.random() * radius;
      const targetX = Math.round(center.x + Math.cos(angle) * distance), targetY = Math.round(center.y + Math.sin(angle) * distance);
      if (targetX < 0 || targetY < 0 || targetX >= dimensions.width || targetY >= dimensions.height) continue;
      const index = (targetY * dimensions.width + targetX) * 4;
      if (state.alphaLock && buffer[index + 3] === 0) continue;
      rgba.forEach((value, offset) => { buffer[index + offset] = value; });
    }
  }

  function replaceColor(buffer, dimensions, startX, startY, rgba) {
    const startIndex = (startY * dimensions.width + startX) * 4;
    const target = Array.from(buffer.slice(startIndex, startIndex + 4));
    if (target.every((value, index) => value === rgba[index])) return;
    for (let index = 0; index < buffer.length; index += 4) {
      if (target.every((value, offset) => buffer[index + offset] === value)) {
        rgba.forEach((value, offset) => { buffer[index + offset] = value; });
      }
    }
  }

  // Pure point generator shared by applyShape (commits pixels) and the live
  // preview overlay drawn during a drag (drawPainter) so the two can never
  // drift out of sync with each other.
  function shapePoints(start, end, type) {
    const points = [];
    if (type === 'line') {
      let x = start.x, y = start.y;
      const dx = Math.abs(end.x - x), sx = x < end.x ? 1 : -1;
      const dy = -Math.abs(end.y - y), sy = y < end.y ? 1 : -1;
      let error = dx + dy;
      while (true) {
        points.push({ x, y });
        if (x === end.x && y === end.y) break;
        const twice = 2 * error;
        if (twice >= dy) { error += dy; x += sx; }
        if (twice <= dx) { error += dx; y += sy; }
      }
      return points;
    }
    if (type === 'ellipse' || type === 'ellipse-filled') {
      const centerX = (start.x + end.x) / 2, centerY = (start.y + end.y) / 2;
      const radiusX = Math.max(0.5, Math.abs(end.x - start.x) / 2), radiusY = Math.max(0.5, Math.abs(end.y - start.y) / 2);
      if (type === 'ellipse-filled') {
        const left = Math.floor(centerX - radiusX), right = Math.ceil(centerX + radiusX);
        const top = Math.floor(centerY - radiusY), bottom = Math.ceil(centerY + radiusY);
        for (let y = top; y <= bottom; y += 1) for (let x = left; x <= right; x += 1) {
          const nx = (x - centerX) / radiusX, ny = (y - centerY) / radiusY;
          if (nx * nx + ny * ny <= 1) points.push({ x, y });
        }
        return points;
      }
      const steps = Math.max(36, Math.round((radiusX + radiusY) * 4));
      for (let step = 0; step <= steps; step += 1) {
        const angle = (step / steps) * Math.PI * 2;
        points.push({ x: Math.round(centerX + Math.cos(angle) * radiusX), y: Math.round(centerY + Math.sin(angle) * radiusY) });
      }
      return points;
    }
    // rectangle (outline; filled variant is 'rectangle-filled')
    const left = Math.min(start.x, end.x), right = Math.max(start.x, end.x);
    const top = Math.min(start.y, end.y), bottom = Math.max(start.y, end.y);
    for (let y = top; y <= bottom; y += 1) for (let x = left; x <= right; x += 1) {
      if (type === 'rectangle-filled' || x === left || x === right || y === top || y === bottom) points.push({ x, y });
    }
    return points;
  }

  function applyShape(entry, start, end, type) {
    const dimensions = dimensionsFor(entry), buffer = getBuffer(entry);
    recordMutation(entry);
    const rgba = state.tool === 'eraser' ? [0, 0, 0, 0] : [...hexToRgb(state.color), Math.round(state.opacity * 255)];
    const basePoints = shapePoints(start, end, type);
    const allPoints = state.symmetry === 'none' ? basePoints : basePoints.flatMap(point => symmetryPoints(point.x, point.y, dimensions));
    for (const { x, y } of allPoints) {
      if (x < 0 || y < 0 || x >= dimensions.width || y >= dimensions.height) continue;
      const index = (y * dimensions.width + x) * 4;
      rgba.forEach((value, offset) => { buffer[index + offset] = value; });
    }
  }

  function floodFill(buffer, dimensions, startX, startY, rgba) {
    const startIndex = (startY * dimensions.width + startX) * 4;
    const target = Array.from(buffer.slice(startIndex, startIndex + 4));
    if (target.every((value, index) => value === rgba[index])) return;
    const stack = [[startX, startY]];
    const seen = new Set();
    while (stack.length) {
      const [x, y] = stack.pop();
      if (x < 0 || y < 0 || x >= dimensions.width || y >= dimensions.height) continue;
      const key = y * dimensions.width + x;
      if (seen.has(key)) continue;
      seen.add(key);
      const index = key * 4;
      if (target.some((value, offset) => buffer[index + offset] !== value)) continue;
      rgba.forEach((value, offset) => { buffer[index + offset] = value; });
      stack.push([x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]);
    }
  }

  function paintPixel(entry, x, y) {
    const dimensions = dimensionsFor(entry), buffer = getBuffer(entry), index = (y * dimensions.width + x) * 4;
    recordMutation(entry);
    if (state.tool === 'eraser') buffer[index + 3] = 0;
    else { const rgb = hexToRgb(state.color); buffer[index] = rgb[0]; buffer[index + 1] = rgb[1]; buffer[index + 2] = rgb[2]; buffer[index + 3] = Math.round(state.opacity * 255); }
    drawPainter(); updatePreviewTexture();
  }

  function updatePreview() {
    if (preview?.mesh) preview.mesh.scale.setScalar(state.scale);
  }

  function updatePreviewTexture() {
    if (!preview?.root) return;
    preview.root.traverse(node => {
      const textureRef = node.userData?.textureRef;
      if (!textureRef || !node.material?.map?.isDataTexture) return;
      const target = textureEntryForRef(textureRef, item()) || item();
      // The composited result (bufferKey, kept fresh by recomposite()), not
      // getBuffer()'s active-layer buffer -- the 3D preview (like the 2D
      // canvas and export) must show every visible layer blended together,
      // not just whichever single layer is currently being painted on.
      node.material.map.image.data = state.buffers[bufferKey(target)] || getBuffer(target);
      node.material.map.image.width = dimensionsFor(target).width;
      node.material.map.image.height = dimensionsFor(target).height;
      node.material.map.needsUpdate = true;
      node.material.needsUpdate = true;
    });
  }

  function dimensionsFor(entry) {
    const stored = state.textureDimensions[entry?.id];
    const width = Number(stored?.width) || Number(state.resolution) || 16;
    const height = Number(stored?.height) || Number(state.resolution) || 16;
    return {
      width: Math.max(1, Math.floor(width)),
      height: Math.max(1, Math.floor(height)),
    };
  }

  function bufferForImageData(entry) {
    const dimensions = dimensionsFor(entry);
    const expectedLength = dimensions.width * dimensions.height * 4;
    const current = state.buffers[bufferKey(entry)];
    if (current?.length === expectedLength) return current;
    const normalized = new Uint8ClampedArray(expectedLength);
    if (current) normalized.set(current.slice(0, expectedLength));
    state.buffers[bufferKey(entry)] = normalized;
    return normalized;
  }

  function createImageData(entry) {
    const dimensions = dimensionsFor(entry);
    return new ImageData(bufferForImageData(entry), dimensions.width, dimensions.height);
  }
  function textureLabel(entry) { const dimensions = dimensionsFor(entry); return `${dimensions.width} × ${dimensions.height}`; }
  function updateTextureResolutionDisplay(entry) {
    if (!entry) return;
    const dimensions = dimensionsFor(entry);
    if (dimensions.width === dimensions.height) state.resolution = dimensions.width;
    if (item()?.id !== entry?.id) return;
    const label = document.querySelector('#resourcePackStudioRoot .rp-edit-footer strong');
    if (label) label.textContent = textureLabel(entry);
  }
  function normalizedTexturePath(reference) {
    return String(reference || '')
      .replace(/^#/, '')
      .replace(/^minecraft:/, '')
      .replace(/^assets\/minecraft\/textures\//, '')
      .replace(/^textures\//, '')
      .replace(/\.png$/i, '')
      .replace(/^items?\//, 'item/')
      .replace(/^blocks?\//, 'block/');
  }

  function textureEntryForRef(reference, preferredEntry = null) {
    const normalized = normalizedTexturePath(reference);
    if (!normalized) return null;
    if (preferredEntry && normalizedTexturePath(resourcePath(preferredEntry)) === normalized) return preferredEntry;
    const candidates = state.catalog.filter(entry => normalizedTexturePath(resourcePath(entry)) === normalized);
    return candidates.find(entry => normalizedTexturePath(entry.path) === normalized) || candidates[0] || null;
  }
  function hexToRgba(value, opacity) { const rgb = hexToRgb(value); return [...rgb, Math.round(opacity * 255)]; }
  function fillBuffer(buffer, dimensions, rgba) { for (let index = 0; index < buffer.length; index += 4) rgba.forEach((value, offset) => { buffer[index + offset] = value; }); }
  // Resizing preserves the texture's existing aspect ratio (scaling both
  // axes by the same factor) rather than forcing a square target -- lots of
  // real Minecraft textures aren't square (animation strips, some GUI/item
  // overlays), and forcing them to N×N would silently distort them, which
  // the brief explicitly rules out.
  // Resize/flip/rotate are whole-texture, dimension-changing operations --
  // unlike ordinary painting (which only ever touches the active layer),
  // these must apply to EVERY layer so they all stay the same size/orientation
  // as each other (a resize that only resized the active layer would leave
  // the other layers the wrong dimensions for recomposite() to blend at all).
  // Falls back to just the plain buffer key when the resource has no layer
  // system engaged yet -- identical to Pass 3's pre-layers behavior.
  // Resize/flip/rotate are whole-texture, dimension-changing operations --
  // unlike ordinary painting (which only ever touches the active layer of
  // the active frame), these must apply to EVERY layer of EVERY frame so
  // they all stay the same size/orientation (a resize that only touched the
  // active frame would leave other frames the wrong dimensions to stack
  // into a valid Minecraft animation sheet at all, let alone recomposite).
  // Falls back to just the plain buffer key when the resource has no layer
  // system engaged yet -- identical to Pass 3's pre-layers behavior.
  function layerKeysFor(entry) {
    const animation = animationFor(entry);
    if (animation?.enabled) {
      return animation.frameOrder.flatMap(frameId => {
        const context = `${entry.id}#f#${frameId}`;
        const layerSet = state.layers[context];
        return layerSet ? layerSet.order.map(layerId => layerBufferKeyForContext(context, layerId)) : [];
      });
    }
    const layerSet = state.layers[layerContext(entry)];
    return layerSet ? layerSet.order.map(layerId => layerBufferKey(entry, layerId)) : [bufferKey(entry)];
  }

  function resizeTexture(entry, targetWidth, mode) {
    if (!entry) return;
    const beforeDimensions = dimensionsFor(entry);
    let width, height;
    if (mode === 'blank') { width = targetWidth; height = targetWidth; }
    else { const factor = targetWidth / beforeDimensions.width; width = targetWidth; height = Math.max(1, Math.round(beforeDimensions.height * factor)); }
    beginHistoryAction();
    layerKeysFor(entry).forEach(key => {
      recordMutation(entry, key);
      const before = state.buffers[key] || getBuffer(entry);
      let after;
      if (mode === 'blank') { after = new Uint8ClampedArray(width * height * 4); }
      else {
        const factor = targetWidth / beforeDimensions.width;
        after = new Uint8ClampedArray(width * height * 4);
        for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
          const sourceX = Math.min(beforeDimensions.width - 1, Math.floor(x / factor));
          const sourceY = Math.min(beforeDimensions.height - 1, Math.floor(y / factor));
          const sourceIndex = (sourceY * beforeDimensions.width + sourceX) * 4;
          after.set(before.slice(sourceIndex, sourceIndex + 4), (y * width + x) * 4);
        }
      }
      state.buffers[key] = after;
    });
    state.textureDimensions[entry.id] = { width, height };
    if (width === height) state.resolution = width;
    commitHistoryAction(mode === 'blank' ? 'New blank canvas' : 'Resize texture');
    recomposite(entry);
    drawPainter();
    updatePreviewTexture();
  }

  function transformTexture(operation) {
    const entry = item();
    if (!entry) return;
    const dimensions = dimensionsFor(entry);
    const rotating = operation === 'rotate-left' || operation === 'rotate-right';
    const width = rotating ? dimensions.height : dimensions.width;
    const height = rotating ? dimensions.width : dimensions.height;
    beginHistoryAction();
    layerKeysFor(entry).forEach(key => {
      recordMutation(entry, key);
      const before = state.buffers[key] || getBuffer(entry);
      const after = new Uint8ClampedArray(width * height * 4);
      for (let y = 0; y < dimensions.height; y += 1) for (let x = 0; x < dimensions.width; x += 1) {
        const source = (y * dimensions.width + x) * 4;
        let targetPoint;
        if (operation === 'rotate-right') targetPoint = { x: dimensions.height - 1 - y, y: x };
        else if (operation === 'rotate-left') targetPoint = { x: y, y: dimensions.width - 1 - x };
        else if (operation === 'flip-vertical') targetPoint = { x, y: dimensions.height - 1 - y };
        else targetPoint = { x: dimensions.width - 1 - x, y }; // flip-horizontal
        after.set(before.slice(source, source + 4), (targetPoint.y * width + targetPoint.x) * 4);
      }
      state.buffers[key] = after;
    });
    state.textureDimensions[entry.id] = { width, height };
    commitHistoryAction(rotating ? 'Rotate texture' : 'Flip texture');
    recomposite(entry);
    render();
    drawPainter();
    updatePreviewTexture();
  }

  function getBuffer(entry) {
    const key = activeLayerKey(entry);
    if (!state.buffers[key]) state.buffers[key] = createBuffer(state.resolution, entry);
    return state.buffers[key];
  }

  function bufferKey(entry) { return `${entry?.id || 'unknown'}`; }

  // ---- Layers (Stage 5 Pass 3) --------------------------------------
  // Editor-side pixel layers, NOT to be confused with Minecraft generated-
  // item model layers (layer0/layer1/... texture variables, handled
  // entirely separately by buildGeneratedOrBuiltinMeshes since Pass 1).
  //
  // Design: state.layers[contextKey] holds only structure (order, names,
  // visibility, opacity, active id) -- persisted directly since it's tiny
  // plain JSON. Layer PIXEL DATA is NOT a new storage system: each layer's
  // buffer lives in the *existing* state.buffers map (the same one Stage 1
  // already persists as base64), keyed by `${contextKey}#${layerId}`. This is
  // what "don't duplicate the whole texture per layer" and "don't create a
  // second storage system" both come down to in practice.
  //
  // contextKey (Pass 4): plain entryId for a static resource, or
  // `${entryId}#f#${frameId}` for the currently active frame of an animated
  // one (see layerContext() below) -- so each animation frame has its own
  // independent layer stack, per the brief's explicit "frames and layers
  // are distinct, don't flatten one into the other" requirement.
  //
  // The resource's plain bufferKey(entry) (`entryId`, no suffix) is
  // repurposed as the COMPOSITE/flattened result of the *active frame*
  // once layers exist. Every pre-Pass-3 function that reads
  // state.buffers[bufferKey(entry)] directly for *display* purposes --
  // createImageData/bufferForImageData (2D canvas), textureFor's
  // project-buffer branch (3D + export) -- keeps working completely
  // unchanged, because recomposite() below keeps that key in sync. Only
  // getBuffer() (what every paint tool calls to get the buffer it mutates)
  // changes, to resolve to the *active layer's* key instead -- which is
  // what makes every existing tool layer-aware for free, without touching
  // applyBrush/applyShape/floodFill/etc. individually.
  // ---- Animation (Stage 5 Pass 4) ------------------------------------
  // Frames are a distinct concept from layers (per the brief's explicit
  // requirement not to conflate them, and not to reinterpret Minecraft's
  // generated-item layer0/layer1 as either). Each frame of an animated
  // resource gets its OWN independent layer stack: layerContext() below is
  // the single seam that makes this true everywhere layers are addressed,
  // by folding the active frame into the same context-key scheme Pass 3
  // already used for the (until now, always-static) resource id.
  function animationFor(entry) { return state.animations[entry?.id]; }

  function activeFrameId(entry) {
    const animation = animationFor(entry);
    if (!animation?.enabled || !animation.frameOrder.length) return null;
    return animation.frameOrder.includes(animation.activeFrameId) ? animation.activeFrameId : animation.frameOrder[0];
  }

  // The single seam: everywhere Pass 3 addressed a resource's layer set by
  // plain entryId, it now goes through this instead. For a non-animated
  // resource this returns entry.id exactly as before (zero behavior change
  // -- confirmed by construction, not by assumption: activeFrameId()
  // returns null whenever animation isn't enabled).
  function layerContext(entry) {
    const frameId = activeFrameId(entry);
    return frameId ? `${entry.id}#f#${frameId}` : entry.id;
  }

  function layerBufferKeyForContext(context, layerId) { return `${context}#${layerId}`; }
  function layerBufferKey(entry, layerId) { return layerBufferKeyForContext(layerContext(entry), layerId); }

  // Whole-slice snapshot/restore for animation *structural* operations
  // (enable/disable, add/delete/duplicate/reorder frame, static<->animated
  // conversion). These touch state.animations, potentially several
  // state.layers contexts, and their buffers all at once -- rather than
  // trying to build a more granular diff (higher risk of a subtle partial-
  // restore bug under this pass's time budget), each such operation
  // snapshots the resource's entire animation+layers+buffers slice before
  // and after, and undo/redo just swaps the whole slice back in. Still
  // reuses state.undo/state.redo (a new field on the same action shape
  // pixel/layer edits already use), not a second history.
  function snapshotEntryLayerState(entry) {
    const animation = state.animations[entry.id];
    const contexts = [entry.id, ...(animation ? animation.frameOrder.map(frameId => `${entry.id}#f#${frameId}`) : [])];
    const layers = {}; const buffers = {};
    contexts.forEach(context => {
      if (!state.layers[context]) return;
      layers[context] = JSON.parse(JSON.stringify(state.layers[context]));
      state.layers[context].order.forEach(layerId => {
        const key = layerBufferKeyForContext(context, layerId);
        if (state.buffers[key]) buffers[key] = new Uint8ClampedArray(state.buffers[key]);
      });
    });
    return { entryId: entry.id, animation: animation ? JSON.parse(JSON.stringify(animation)) : null, layers, buffers, dimensions: { ...dimensionsFor(entry) } };
  }

  function restoreEntryLayerState(snapshot) {
    const entry = entryById(snapshot.entryId);
    if (!entry) return;
    const currentAnimation = state.animations[entry.id];
    const currentContexts = [entry.id, ...(currentAnimation ? currentAnimation.frameOrder.map(frameId => `${entry.id}#f#${frameId}`) : [])];
    currentContexts.forEach(context => {
      if (!state.layers[context]) return;
      state.layers[context].order.forEach(layerId => delete state.buffers[layerBufferKeyForContext(context, layerId)]);
      delete state.layers[context];
    });
    if (snapshot.animation) state.animations[entry.id] = JSON.parse(JSON.stringify(snapshot.animation)); else delete state.animations[entry.id];
    Object.entries(snapshot.layers).forEach(([context, layerSet]) => { state.layers[context] = JSON.parse(JSON.stringify(layerSet)); });
    Object.entries(snapshot.buffers).forEach(([key, buffer]) => { state.buffers[key] = new Uint8ClampedArray(buffer); });
    state.textureDimensions[entry.id] = { ...snapshot.dimensions };
    recomposite(entry);
  }

  function commitAnimationStructureAction(entry, before, description) {
    const after = snapshotEntryLayerState(entry);
    const beforeKey = JSON.stringify({ animation: before.animation, layers: before.layers });
    const afterKey = JSON.stringify({ animation: after.animation, layers: after.layers });
    if (beforeKey === afterKey) return; // nothing structurally changed
    markModified(entry, false);
    state.undo.push({ type: 'animation-structure', changes: [], layerStructure: null, animationStructure: { before, after }, description });
    state.redo = [];
    state.dirty = true;
    persist();
  }

  function convertToAnimated(entry) {
    if (animationFor(entry)?.enabled) return;
    stopAnimationPlayback();
    const before = snapshotEntryLayerState(entry);
    ensureLayers(entry); // guarantees a static layer set exists to hand off to Frame 0
    const frameId = 'frame-0';
    const staticLayerSet = state.layers[entry.id];
    const newContext = `${entry.id}#f#${frameId}`;
    state.layers[newContext] = staticLayerSet;
    staticLayerSet.order.forEach(layerId => {
      const oldKey = layerBufferKeyForContext(entry.id, layerId);
      const newKey = layerBufferKeyForContext(newContext, layerId);
      state.buffers[newKey] = state.buffers[oldKey];
      delete state.buffers[oldKey];
    });
    delete state.layers[entry.id];
    state.animations[entry.id] = { enabled: true, frameOrder: [frameId], frameById: { [frameId]: { duration: 1 } }, activeFrameId: frameId, defaultFrametime: 1 };
    commitAnimationStructureAction(entry, before, 'Convert to animated');
    recomposite(entry);
    render();
  }

  function convertToStatic(entry, keepFrameId) {
    const animation = animationFor(entry);
    if (!animation?.enabled) return;
    stopAnimationPlayback();
    if (animation.frameOrder.length > 1 && !window.confirm(`Convert to a static texture using this frame? The other ${animation.frameOrder.length - 1} frame(s) will be discarded.`)) return;
    const before = snapshotEntryLayerState(entry);
    const frameId = keepFrameId || animation.activeFrameId || animation.frameOrder[0];
    const oldContext = `${entry.id}#f#${frameId}`;
    const layerSet = state.layers[oldContext];
    animation.frameOrder.forEach(otherFrameId => {
      if (otherFrameId === frameId) return;
      const context = `${entry.id}#f#${otherFrameId}`;
      if (state.layers[context]) { state.layers[context].order.forEach(layerId => delete state.buffers[layerBufferKeyForContext(context, layerId)]); delete state.layers[context]; }
    });
    if (layerSet) {
      state.layers[entry.id] = layerSet;
      layerSet.order.forEach(layerId => {
        const oldKey = layerBufferKeyForContext(oldContext, layerId);
        const newKey = layerBufferKeyForContext(entry.id, layerId);
        state.buffers[newKey] = state.buffers[oldKey];
        delete state.buffers[oldKey];
      });
      delete state.layers[oldContext];
    }
    delete state.animations[entry.id];
    commitAnimationStructureAction(entry, before, 'Convert to static');
    recomposite(entry);
    render();
  }

  function addFrame(entry, mode) {
    const animation = animationFor(entry);
    if (!animation?.enabled) return;
    stopAnimationPlayback();
    const before = snapshotEntryLayerState(entry);
    const frameId = `frame-${Date.now().toString(36)}`;
    if (mode === 'duplicate' && animation.activeFrameId) {
      const sourceContext = `${entry.id}#f#${animation.activeFrameId}`;
      const sourceLayerSet = state.layers[sourceContext];
      if (sourceLayerSet) {
        const newContext = `${entry.id}#f#${frameId}`;
        state.layers[newContext] = JSON.parse(JSON.stringify(sourceLayerSet));
        // A real pixel copy, deliberately -- a duplicated frame must never
        // share a mutable array with its source (painting Frame 2 must not
        // silently repaint Frame 1).
        sourceLayerSet.order.forEach(layerId => {
          const sourceBuffer = state.buffers[layerBufferKeyForContext(sourceContext, layerId)];
          if (sourceBuffer) state.buffers[layerBufferKeyForContext(newContext, layerId)] = new Uint8ClampedArray(sourceBuffer);
        });
      }
    }
    animation.frameOrder.push(frameId);
    animation.frameById[frameId] = { duration: animation.defaultFrametime || 1 };
    animation.activeFrameId = frameId;
    // ensureLayers()/recomposite() MUST run before the commit below, not
    // after -- commitAnimationStructureAction's "after" snapshot must
    // capture the COMPLETE post-operation state (frame + its layer
    // structure + its pixel buffer), not a partial state that's missing
    // the new frame's layers entirely. Fixed in Pass 4.2: this used to run
    // after the commit, so undo/redo of a blank "Add Frame" would restore
    // an "after" snapshot with the frame present in frameOrder but no
    // layer structure for it at all.
    ensureLayers(entry); // materializes a blank Layer 1 for a genuinely new (non-duplicated) frame; a no-op for duplicate mode, which already created its layers above
    recomposite(entry);
    commitAnimationStructureAction(entry, before, mode === 'duplicate' ? 'Duplicate frame' : 'Add frame');
    render();
  }

  function deleteFrame(entry, frameId) {
    const animation = animationFor(entry);
    if (!animation?.enabled || animation.frameOrder.length <= 1) return; // must keep >=1 frame; use convertToStatic to fully exit animation
    stopAnimationPlayback();
    const before = snapshotEntryLayerState(entry);
    const context = `${entry.id}#f#${frameId}`;
    if (state.layers[context]) { state.layers[context].order.forEach(layerId => delete state.buffers[layerBufferKeyForContext(context, layerId)]); delete state.layers[context]; }
    animation.frameOrder = animation.frameOrder.filter(id => id !== frameId);
    delete animation.frameById[frameId];
    if (animation.activeFrameId === frameId) animation.activeFrameId = animation.frameOrder[animation.frameOrder.length - 1];
    commitAnimationStructureAction(entry, before, 'Delete frame');
    recomposite(entry);
    render();
  }

  function moveFrame(entry, frameId, direction) {
    const animation = animationFor(entry);
    if (!animation?.enabled) return;
    stopAnimationPlayback();
    const index = animation.frameOrder.indexOf(frameId);
    const targetIndex = index + direction;
    if (index < 0 || targetIndex < 0 || targetIndex >= animation.frameOrder.length) return;
    const before = snapshotEntryLayerState(entry);
    [animation.frameOrder[index], animation.frameOrder[targetIndex]] = [animation.frameOrder[targetIndex], animation.frameOrder[index]];
    commitAnimationStructureAction(entry, before, 'Reorder frames');
    render();
  }

  function setFrameDuration(entry, frameId, duration) {
    const animation = animationFor(entry);
    if (!animation?.frameById[frameId]) return;
    stopAnimationPlayback();
    const before = snapshotEntryLayerState(entry);
    animation.frameById[frameId].duration = normalizeFrametime(duration, animation.frameById[frameId].duration || 1);
    commitAnimationStructureAction(entry, before, 'Frame duration');
    render();
  }

  function setDefaultFrametime(entry, value) {
    const animation = animationFor(entry);
    if (!animation) return;
    stopAnimationPlayback();
    const before = snapshotEntryLayerState(entry);
    animation.defaultFrametime = normalizeFrametime(value, animation.defaultFrametime || 1);
    commitAnimationStructureAction(entry, before, 'Default frame time');
    render();
  }

  // Selecting which frame is being viewed/edited is NOT itself a
  // structural change worth its own undo entry (same precedent as
  // selectLayer) -- but it's also what animation *playback* drives every
  // tick, and playback must never touch undo history, dirty state, or
  // persistence at all (explicit requirement). The `silent` flag is what
  // playback uses; ordinary frame-picker clicks leave it off.
  function selectFrame(entry, frameId, { silent } = {}) {
    const animation = animationFor(entry);
    if (!animation?.enabled || !animation.frameOrder.includes(frameId) || animation.activeFrameId === frameId) return;
    animation.activeFrameId = frameId;
    ensureLayers(entry);
    recomposite(entry);
    drawPainter();
    updatePreviewTexture();
    if (!silent) { persist(); renderAnimationPanel(); }
  }

  let animationPlaybackTimer = null;

  function stopAnimationPlayback() {
    if (animationPlaybackTimer) { clearTimeout(animationPlaybackTimer); animationPlaybackTimer = null; }
    state.animationPlaying = false;
  }

  function playAnimation(entry) {
    stopAnimationPlayback(); // never more than one timer
    const animation = animationFor(entry);
    if (!animation?.enabled || animation.frameOrder.length < 2) return;
    state.animationPlaying = true;
    const tick = () => {
      const anim = animationFor(entry);
      if (!state.animationPlaying || !anim?.enabled || item()?.id !== entry.id) { stopAnimationPlayback(); renderAnimationPanel(); return; }
      const currentIndex = anim.frameOrder.indexOf(anim.activeFrameId);
      const nextFrameId = anim.frameOrder[(currentIndex + 1) % anim.frameOrder.length];
      selectFrame(entry, nextFrameId, { silent: true });
      updateFrameIndicatorOnly();
      const durationTicks = anim.frameById[nextFrameId]?.duration || anim.defaultFrametime || 1;
      animationPlaybackTimer = setTimeout(tick, durationTicks * 50); // Minecraft's frametime unit is 1 game tick = 1/20s = 50ms
    };
    const durationTicks = animation.frameById[animation.activeFrameId]?.duration || animation.defaultFrametime || 1;
    animationPlaybackTimer = setTimeout(tick, durationTicks * 50);
    renderAnimationPanel();
  }

  function pauseAnimation() { stopAnimationPlayback(); renderAnimationPanel(); }

  function stopAnimation(entry) {
    stopAnimationPlayback();
    const animation = animationFor(entry);
    if (animation?.enabled) selectFrame(entry, animation.frameOrder[0], { silent: true });
    renderAnimationPanel();
  }

  // Lightweight, playback-safe DOM update: toggles which frame thumbnail is
  // marked current without re-rendering the whole panel (still cheap here,
  // but written separately from renderAnimationPanel to make the "never do
  // expensive work per playback tick" requirement structurally explicit).
  function updateFrameIndicatorOnly() {
    const entry = item(); const animation = entry && animationFor(entry);
    if (!animation) return;
    document.querySelectorAll('.rp-frame-thumb').forEach(node => node.classList.toggle('active', node.dataset.frame === animation.activeFrameId));
  }

  // Builds the Minecraft vertical frame sheet (single-frame W x full-sheet
  // H*frameCount) by temporarily walking the active-frame pointer across
  // every frame and reusing the exact same recomposite() path 2D display
  // already uses -- not a second blending implementation. Restores
  // whatever frame the user was actually looking at before returning, so
  // exporting never changes what's on screen.
  function buildAnimationSheet(entry) {
    const animation = animationFor(entry);
    const dimensions = dimensionsFor(entry);
    const frameCount = animation.frameOrder.length;
    const frameBytes = dimensions.width * dimensions.height * 4;
    const sheet = new Uint8ClampedArray(frameBytes * frameCount);
    const savedActiveFrame = animation.activeFrameId;
    animation.frameOrder.forEach((frameId, index) => {
      animation.activeFrameId = frameId;
      ensureLayers(entry);
      recomposite(entry);
      const frameBuffer = state.buffers[bufferKey(entry)];
      if (frameBuffer) sheet.set(frameBuffer.slice(0, frameBytes), index * frameBytes);
    });
    animation.activeFrameId = savedActiveFrame;
    recomposite(entry);
    return { sheet, width: dimensions.width, height: dimensions.height * frameCount };
  }

  // Standard Java Edition animation metadata. Per-frame `time` is only
  // written when it differs from the default frametime, matching vanilla
  // .mcmeta conventions (an explicit index-only frame list entry means
  // "use the default"). Unknown fields preserved from an imported .mcmeta
  // (see importAnimationMetadata) are merged in without letting them
  // clobber the fields this editor actively manages.
  function buildAnimationMcmeta(entry) {
    const animation = animationFor(entry);
    const frames = animation.frameOrder.map((frameId, index) => {
      const duration = animation.frameById[frameId]?.duration;
      return duration && duration !== animation.defaultFrametime ? { index, time: duration } : index;
    });
    const meta = { animation: { ...(animation.unknownFields || {}), frametime: animation.defaultFrametime || 1, frames } };
    if (animation.interpolate) meta.animation.interpolate = true;
    return meta;
  }

  // Parses a .mcmeta an imported pack supplied for one of this project's
  // textures into the editor's own frame timeline, WITHOUT discarding
  // properties this editor doesn't actively manage (stored in
  // `unknownFields` and merged back in verbatim on export).
  // Same tick normalization the UI setters (setFrameDuration/
  // setDefaultFrametime) already apply, now used consistently at import
  // time too: Minecraft's frametime is discrete positive integer ticks, so
  // 0/negative/NaN/Infinity/non-numeric all fall back to a safe default,
  // and a decimal is rounded rather than silently accepted as fractional
  // (a format the .mcmeta spec doesn't define behavior for).
  function normalizeFrametime(value, fallback = 1) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) return fallback;
    return Math.max(1, Math.round(number));
  }

  function importAnimationMetadata(entry, mcmetaJson) {
    let parsed;
    try { parsed = JSON.parse(mcmetaJson); } catch { return; }
    const source = parsed?.animation; if (!source) return;
    const defaultFrametime = normalizeFrametime(source.frametime, 1);
    const dimensions = dimensionsFor(entry);
    const importedBuffer = state.buffers[bufferKey(entry)];
    const frameArea = dimensions.width * dimensions.width * 4;
    // Only trust the sheet-derived frame count when the buffer divides
    // evenly into square frames -- a texture that merely happens to be
    // taller than it is wide (not an exact multiple) is not a valid
    // animation sheet, and guessing a frame count from it would slice
    // frames at the wrong byte offsets.
    const dividesEvenly = Boolean(importedBuffer) && frameArea > 0 && importedBuffer.length % frameArea === 0;
    const sheetFrameCount = dividesEvenly ? Math.max(1, importedBuffer.length / frameArea) : 1;
    const hasExplicitFrames = Array.isArray(source.frames) && source.frames.length > 0;
    // An animation block with no frame list and only one derivable sheet
    // slot (or an empty {} block, or a texture that isn't actually a valid
    // multi-frame sheet) carries no real animation information -- treat it
    // as a no-op rather than silently converting an ordinary static
    // texture into a "1-frame animation" nobody asked for.
    if (!hasExplicitFrames && sheetFrameCount <= 1) return;
    stopAnimationPlayback();
    const frameIndices = hasExplicitFrames ? source.frames : Array.from({ length: sheetFrameCount }, (_, index) => index);
    const before = snapshotEntryLayerState(entry);
    const frameOrder = [];
    const frameById = {};
    frameIndices.forEach((frameSpec, orderIndex) => {
      const rawIndex = typeof frameSpec === 'number' ? frameSpec : frameSpec?.index;
      // Validate against the actual number of physical frame slots in the
      // sheet (per this pass's audit) -- an out-of-range or negative index
      // is clamped into range rather than silently producing a
      // wrong-length buffer or reading the wrong region of the sheet.
      // Never invents pixel data: clamping still reads a real slice of the
      // real imported sheet, just the nearest valid one.
      const sheetIndex = Number.isInteger(rawIndex) ? Math.max(0, Math.min(sheetFrameCount - 1, rawIndex)) : 0;
      const duration = typeof frameSpec === 'object' && frameSpec !== null && frameSpec.time != null ? normalizeFrametime(frameSpec.time, defaultFrametime) : defaultFrametime;
      const frameId = `frame-${orderIndex}`;
      frameOrder.push(frameId);
      frameById[frameId] = { duration };
      // Slice this frame's pixels out of the imported vertical sheet into
      // its own Layer 1, mirroring the same "Layer 1 = the pixels" pattern
      // ensureLayers() already uses for ordinary migration.
      const context = `${entry.id}#f#${frameId}`;
      const frameBuffer = importedBuffer ? new Uint8ClampedArray(importedBuffer.slice(sheetIndex * frameArea, (sheetIndex + 1) * frameArea)) : new Uint8ClampedArray(frameArea);
      state.layers[context] = { order: ['layer-1'], byId: { 'layer-1': { name: 'Layer 1', visible: true, opacity: 1 } }, activeId: 'layer-1' };
      state.buffers[layerBufferKeyForContext(context, 'layer-1')] = frameBuffer;
    });
    const { frametime, frames, interpolate, ...unknownFields } = source;
    state.animations[entry.id] = { enabled: true, frameOrder, frameById, activeFrameId: frameOrder[0], defaultFrametime, interpolate: Boolean(interpolate), unknownFields };
    state.textureDimensions[entry.id] = { width: dimensions.width, height: dimensions.width }; // per-frame square dimensions for editing
    delete state.buffers[bufferKey(entry)]; // no longer meaningful as "the" buffer -- recomposite() will repopulate it from Frame 0
    commitAnimationStructureAction(entry, before, 'Imported animation');
    recomposite(entry);
  }


  // wipes every frame's layer stack (not just the currently active one)
  // plus the animation entry itself, so nothing stale survives to corrupt
  // a later paint/recomposite once the resource reloads from vanilla or is
  // gone entirely.
  function renderAnimationPanel() {
    const container = document.querySelector('#rpAnimationPanel');
    if (!container) return;
    const entry = item();
    container.outerHTML = renderAnimation(entry);
    bindAnimationPanelEvents();
    drawFrameThumbnails(entry);
  }

  function renderAnimation(entry) {
    if (!entry) return '<div id="rpAnimationPanel"></div>';
    const animation = animationFor(entry);
    if (!animation?.enabled) {
      return `<div id="rpAnimationPanel" class="rp-inspector-section"><div class="rp-pane-heading"><strong>Animation</strong><button class="modal-btn" data-rp-anim-action="convert-animated">Make animated</button></div><p class="rp-muted">This is a static texture. "Make animated" creates Frame 0 from the current pixels -- nothing is lost.</p></div>`;
    }
    const activeDuration = animation.frameById[animation.activeFrameId]?.duration || animation.defaultFrametime || 1;
    return `<div id="rpAnimationPanel" class="rp-inspector-section">
      <div class="rp-pane-heading"><strong>Animation</strong><button class="modal-btn" data-rp-anim-action="convert-static">Make static</button></div>
      <div class="rp-frame-strip">${animation.frameOrder.map(frameId => `<button class="rp-frame-thumb${frameId === animation.activeFrameId ? ' active' : ''}" data-frame="${frameId}" data-rp-anim-action="select-frame" data-frame-id="${frameId}" title="${animation.frameById[frameId]?.duration || 1} tick(s)"><canvas width="28" height="28" data-frame-thumb="${frameId}"></canvas></button>`).join('')}<button class="rp-icon-button" data-rp-anim-action="add-blank" title="Add blank frame">+</button><button class="rp-icon-button" data-rp-anim-action="add-duplicate" title="Duplicate current frame">&#10697;</button></div>
      <div class="rp-canvas-options">
        <button class="rp-icon-button" data-rp-anim-action="move-left" title="Move frame left">&larr;</button>
        <button class="rp-icon-button" data-rp-anim-action="move-right" title="Move frame right">&rarr;</button>
        <button class="rp-icon-button" data-rp-anim-action="delete-frame" title="Delete frame"${animation.frameOrder.length <= 1 ? ' disabled' : ''}>&times;</button>
        <label class="rp-check">Frame ticks <input class="modal-input rp-anim-number" type="number" min="1" data-rp-anim-action="frame-duration" value="${activeDuration}"></label>
        <label class="rp-check">Default <input class="modal-input rp-anim-number" type="number" min="1" data-rp-anim-action="default-duration" value="${animation.defaultFrametime || 1}"></label>
        ${state.animationPlaying ? '<button class="rp-icon-button" data-rp-anim-action="pause" title="Pause">&#10073;&#10073;</button>' : '<button class="rp-icon-button" data-rp-anim-action="play" title="Play">&#9654;</button>'}
        <button class="rp-icon-button" data-rp-anim-action="stop" title="Stop">&#9632;</button>
      </div>
      <p class="rp-muted">1 tick = 1/20s (Minecraft's own animation time unit). ${animation.frameOrder.length} frame${animation.frameOrder.length === 1 ? '' : 's'}.</p>
    </div>`;
  }

  function drawFrameThumbnails(entry) {
    const animation = entry && animationFor(entry);
    if (!animation?.enabled) return;
    const dimensions = dimensionsFor(entry);
    const savedActiveFrame = animation.activeFrameId;
    document.querySelectorAll('[data-frame-thumb]').forEach(canvas => {
      const frameId = canvas.dataset.frameThumb;
      animation.activeFrameId = frameId;
      ensureLayers(entry);
      recomposite(entry);
      const buffer = state.buffers[bufferKey(entry)];
      if (!buffer) return;
      const scratch = document.createElement('canvas'); scratch.width = dimensions.width; scratch.height = dimensions.height;
      scratch.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(buffer), dimensions.width, dimensions.height), 0, 0);
      const context = canvas.getContext('2d'); context.imageSmoothingEnabled = false;
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(scratch, 0, 0, canvas.width, canvas.height);
    });
    animation.activeFrameId = savedActiveFrame;
    recomposite(entry);
  }

  function bindAnimationPanelEvents() {
    const container = document.querySelector('#rpAnimationPanel');
    if (!container) return;
    const entry = item(); if (!entry) return;
    container.querySelectorAll('[data-rp-anim-action]').forEach(control => {
      const action = control.dataset.rpAnimAction;
      if (action === 'convert-animated') control.addEventListener('click', () => convertToAnimated(entry));
      else if (action === 'convert-static') control.addEventListener('click', () => convertToStatic(entry));
      else if (action === 'select-frame') control.addEventListener('click', () => selectFrame(entry, control.dataset.frameId));
      else if (action === 'add-blank') control.addEventListener('click', () => addFrame(entry, 'blank'));
      else if (action === 'add-duplicate') control.addEventListener('click', () => addFrame(entry, 'duplicate'));
      else if (action === 'delete-frame') control.addEventListener('click', () => { const animation = animationFor(entry); if (animation) deleteFrame(entry, animation.activeFrameId); });
      else if (action === 'move-left') control.addEventListener('click', () => { const animation = animationFor(entry); if (animation) moveFrame(entry, animation.activeFrameId, -1); });
      else if (action === 'move-right') control.addEventListener('click', () => { const animation = animationFor(entry); if (animation) moveFrame(entry, animation.activeFrameId, 1); });
      else if (action === 'frame-duration') control.addEventListener('change', () => { const animation = animationFor(entry); if (animation) setFrameDuration(entry, animation.activeFrameId, Number(control.value)); });
      else if (action === 'default-duration') control.addEventListener('change', () => setDefaultFrametime(entry, Number(control.value)));
      else if (action === 'play') control.addEventListener('click', () => playAnimation(entry));
      else if (action === 'pause') control.addEventListener('click', () => pauseAnimation());
      else if (action === 'stop') control.addEventListener('click', () => stopAnimation(entry));
    });
  }

  function discardAllLayersAndAnimation(entry) {
    const animation = state.animations[entry.id];
    const contexts = [entry.id, ...(animation ? animation.frameOrder.map(frameId => `${entry.id}#f#${frameId}`) : [])];
    contexts.forEach(context => {
      const layerSet = state.layers[context];
      if (!layerSet) return;
      layerSet.order.forEach(layerId => delete state.buffers[layerBufferKeyForContext(context, layerId)]);
      delete state.layers[context];
    });
    delete state.animations[entry.id];
  }

  function activeLayerKey(entry) {
    const layerSet = state.layers[layerContext(entry)];
    if (!layerSet) return bufferKey(entry); // layers never engaged for this resource/frame -- the plain key IS the (only) buffer
    const activeId = layerSet.activeId && layerSet.byId[layerSet.activeId] ? layerSet.activeId : layerSet.order[0];
    return layerBufferKey(entry, activeId);
  }

  // Lazy, backward-compatible migration: only runs the first time a
  // resource's (or, for an animated resource, the active frame's) layer
  // structure is actually needed. An old project's existing single buffer
  // becomes "Layer 1" by *reference*, not by copying -- state.buffers[the
  // new layer key] is assigned the exact same array the plain key already
  // pointed at, so there is zero duplication and no visual change.
  function ensureLayers(entry) {
    const context = layerContext(entry);
    if (state.layers[context]) return state.layers[context];
    const layerId = 'layer-1';
    const key = layerBufferKey(entry, layerId);
    state.buffers[key] = state.buffers[bufferKey(entry)] || getBuffer(entry);
    state.layers[context] = { order: [layerId], byId: { [layerId]: { name: 'Layer 1', visible: true, opacity: 1 } }, activeId: layerId };
    return state.layers[context];
  }

  // The one authoritative compositing path (bottom layer first, normal
  // "over" alpha blending, opacity applied to source alpha only -- never
  // baked destructively into a layer's own stored pixels). Writes the
  // result into the plain bufferKey(entry) slot so every pre-existing
  // display/export/3D-texture consumer picks it up with no changes of
  // their own. Short-circuits when there's zero or one layer (the common
  // case, especially right after migration) to avoid any per-pixel work.
  function recomposite(entry) {
    if (!entry) return;
    const layerSet = state.layers[layerContext(entry)];
    const baseKey = bufferKey(entry);
    if (!layerSet) return; // no layer system engaged for this resource/frame -- base key is already the only buffer
    if (layerSet.order.length <= 1) {
      const onlyKey = layerBufferKey(entry, layerSet.order[0] ?? 'layer-1');
      if (state.buffers[onlyKey]) state.buffers[baseKey] = state.buffers[onlyKey];
      return;
    }
    const dimensions = dimensionsFor(entry);
    const composite = new Uint8ClampedArray(dimensions.width * dimensions.height * 4);
    layerSet.order.forEach(layerId => {
      const meta = layerSet.byId[layerId];
      if (!meta?.visible) return;
      const buffer = state.buffers[layerBufferKey(entry, layerId)];
      if (!buffer || buffer.length !== composite.length) return;
      const opacity = Math.max(0, Math.min(1, meta.opacity ?? 1));
      for (let index = 0; index < composite.length; index += 4) {
        const srcAlpha = (buffer[index + 3] / 255) * opacity;
        if (srcAlpha <= 0) continue;
        const dstAlpha = composite[index + 3] / 255;
        const outAlpha = srcAlpha + dstAlpha * (1 - srcAlpha);
        if (outAlpha <= 0) continue;
        for (let channel = 0; channel < 3; channel += 1) {
          composite[index + channel] = Math.round((buffer[index + channel] * srcAlpha + composite[index + channel] * dstAlpha * (1 - srcAlpha)) / outAlpha);
        }
        composite[index + 3] = Math.round(outAlpha * 255);
      }
    });
    state.buffers[baseKey] = composite;
  }

  function entryById(id) { return state.catalog.find(candidate => candidate.id === id); }
  function markModified(entry, shouldPersist = true) {
    // A timestamp (not a bare boolean) so "Recently modified" sorting has
    // something real to rank on. isModified()/modifiedTimestamp() treat any
    // truthy legacy `true` value from older saved projects as "modified,
    // unknown time" so nothing is lost on upgrade.
    state.modifiedResources[entry.path || resourcePath(entry) || entry.id] = Date.now();
    state.dirty = true;
    if (shouldPersist) persist();
  }
  function hexToRgb(value) { const normalized = String(value).replace('#', ''); return [parseInt(normalized.slice(0, 2), 16) || 0, parseInt(normalized.slice(2, 4), 16) || 0, parseInt(normalized.slice(4, 6), 16) || 0]; }
  // Normalizes any hex string (6 or 8 digit, with/without '#') down to the
  // 6-digit '#rrggbb' form the native <input type=color> and palette swatch
  // backgrounds require. state.color itself is always kept 6-digit; this
  // exists for defensive rendering of values that might not be (e.g. a
  // palette entry saved before this stage, or a stray 8-digit hex typed
  // into the hex field before it gets normalized on change).
  function toHex6(value) {
    const digits = String(value || '').replace('#', '').padEnd(6, '0').slice(0, 6);
    return `#${digits}`;
  }
  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(reader.error || new Error('Could not read the selected icon.'));
      reader.readAsDataURL(file);
    });
  }

  function nextCustomId(name) {
    const cleanName = String(name || 'custom_texture').trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '') || 'custom_texture';
    let id = `custom_${cleanName}`, suffix = 1;
    while (state.catalog.some(entry => entry.id === id)) { id = `custom_${cleanName}_${suffix}`; suffix += 1; }
    return { id, cleanName };
  }

  function registerCustomEntry(id, cleanName, displayName) {
    const entry = {
      id, name: (displayName || 'Custom Texture').trim() || 'Custom Texture', category: 'Custom',
      path: `assets/minecraft/textures/custom/${cleanName}.png`, texturePath: `custom/${cleanName}.png`,
      shape: 'flat', custom: true,
    };
    state.catalog = [entry, ...state.catalog];
    // Persisted alongside the project (see editorSnapshot/reviveEditor), not
    // just held in the in-memory catalog â€” otherwise the entry (and with it
    // the ability to find/export its texture buffer at all) would vanish the
    // next time the vanilla catalog reloads or the project reopens.
    state.customResources = [entry, ...(state.customResources || []).filter(candidate => candidate.id !== entry.id)];
    state.vanillaLoaded[bufferKey(entry)] = true;
    state.recentResources = [entry.id, ...state.recentResources.filter(candidate => candidate !== entry.id)].slice(0, 30);
    markModified(entry, false);
    computeSortOrder();
    return entry;
  }

  function deleteCustomResource(entry) {
    if (!entry?.custom) return;
    if (!window.confirm(`Delete custom texture "${entry.name}"? This cannot be undone.`)) return;
    state.catalog = state.catalog.filter(candidate => candidate.id !== entry.id);
    state.customResources = (state.customResources || []).filter(candidate => candidate.id !== entry.id);
    delete state.buffers[bufferKey(entry)];
    discardAllLayersAndAnimation(entry);
    delete state.modifiedResources[entry.path || resourcePath(entry) || entry.id];
    delete state.textureDimensions[entry.id];
    delete state.favorites[entry.id];
    if (state.selectedId === entry.id) { state.selectedId = null; state.selectedPath = null; }
    state.dirty = true;
    computeSortOrder();
    persist();
    render();
  }

  function createCustomTexture(name, resolution) {
    const size = RESOLUTIONS.includes(Number(resolution)) ? Number(resolution) : 16;
    const { id, cleanName } = nextCustomId(name);
    const entry = registerCustomEntry(id, cleanName, name);
    state.textureDimensions[entry.id] = { width: size, height: size };
    state.buffers[bufferKey(entry)] = new Uint8ClampedArray(size * size * 4);
    persist();
    selectResource(entry.id);
  }

  function createCustomTextureFromImage(name, dataUrl) {
    return new Promise(resolve => {
      const image = new Image();
      image.onload = () => {
        const width = image.naturalWidth || 16, height = image.naturalHeight || 16;
        const { id, cleanName } = nextCustomId(name);
        const entry = registerCustomEntry(id, cleanName, name);
        state.textureDimensions[entry.id] = { width, height };
        const scratch = document.createElement('canvas'); scratch.width = width; scratch.height = height;
        const context = scratch.getContext('2d'); context.imageSmoothingEnabled = false; context.drawImage(image, 0, 0);
        state.buffers[bufferKey(entry)] = context.getImageData(0, 0, width, height).data;
        persist();
        selectResource(entry.id);
        resolve(entry);
      };
      image.src = dataUrl;
    });
  }

  function saveLook() {
    const defaultName = `Snapshot ${(state.looks || []).length + 1}`;
    const name = window.prompt('Name this snapshot', defaultName);
    if (name === null) return;
    const look = {
      id: `look-${Date.now()}`,
      name: name.trim() || defaultName,
      createdAt: now(),
      buffers: Object.fromEntries(Object.entries(state.buffers).map(([key, value]) => [key, bufferToBase64(value)])),
      textureDimensions: { ...state.textureDimensions },
    };
    state.looks = [...(state.looks || []), look];
    persist();
    render();
    setStatus('Snapshot saved.');
  }

  function loadLook(id) {
    const look = (state.looks || []).find(entry => entry.id === id);
    if (!look) return;
    beginHistoryAction();
    Object.keys(look.buffers || {}).forEach(key => {
      const entry = state.catalog.find(candidate => bufferKey(candidate) === key);
      if (entry) recordMutation(entry);
    });
    Object.entries(look.buffers || {}).forEach(([key, value]) => {
      state.buffers[key] = base64ToBuffer(value);
      state.modifiedResources[key] = Date.now();
    });
    Object.assign(state.textureDimensions, look.textureDimensions || {});
    commitHistoryAction(`Load snapshot: ${look.name}`);
    state.dirty = true;
    persist();
    drawPainter();
    updatePreviewTexture();
    render();
    setStatus(`Loaded "${look.name}".`);
  }

  function undo() {
    const change = state.undo.pop(); if (!change) return;
    stopAnimationPlayback(); // must terminate BEFORE any state below is restored
    state.redo.push(change);
    if (change.layerStructure) restoreLayerStructure(change.layerStructure, 'before');
    if (change.animationStructure) restoreEntryLayerState(change.animationStructure.before);
    change.changes.forEach(entryChange => {
      state.buffers[entryChange.bufferKey || entryChange.entryId] = entryChange.before;
      state.textureDimensions[entryChange.entryId] = entryChange.beforeDimensions;
      recomposite(entryById(entryChange.entryId));
    });
    updateTextureResolutionDisplay(item());
    state.dirty = true; persist(); drawPainter(); updatePreviewTexture(); renderLayersPanel(); renderAnimationPanel();
  }

  function redo() {
    const change = state.redo.pop(); if (!change) return;
    stopAnimationPlayback(); // must terminate BEFORE any state below is restored
    state.undo.push(change);
    if (change.layerStructure) restoreLayerStructure(change.layerStructure, 'after');
    if (change.animationStructure) restoreEntryLayerState(change.animationStructure.after);
    change.changes.forEach(entryChange => {
      state.buffers[entryChange.bufferKey || entryChange.entryId] = entryChange.after;
      state.textureDimensions[entryChange.entryId] = entryChange.afterDimensions;
      recomposite(entryById(entryChange.entryId));
    });
    updateTextureResolutionDisplay(item());
    state.dirty = true; persist(); drawPainter(); updatePreviewTexture(); renderLayersPanel(); renderAnimationPanel();
  }

  // Model-element/UV editing gets its own undo timeline, deliberately kept
  // separate from the pixel-buffer undo above (state.undo/state.redo) --
  // they edit different authoritative data (state.modelOverrides vs.
  // state.buffers), so merging them into one stack would mean an "Undo"
  // click sometimes reverts a pixel stroke and sometimes reverts a model
  // edit with no way for the user to predict which. Each transaction is
  // one full before/after snapshot of that resource's model override,
  // exactly mirroring the pixel history's before/after-per-entry shape.
  // Fixed in Pass 2.1: previously snapshotted `null` whenever no override
  // existed yet, so a genuinely no-op edit (e.g. X: 0 -> 0) compared
  // `null` against the freshly-materialized full resolved model and always
  // looked like a real change, creating a pointless override + undo entry.
  // Now `before` is always a real snapshot of what the model actually
  // looked like (the resolved model when there's no override yet, or the
  // previous override when there is), and `hadOverride` records which case
  // this was so undo/redo know whether "reverting" means restoring a prior
  // override or deleting the override entirely.
  function beginModelHistoryAction(entry) {
    if (activeModelHistoryAction) return activeModelHistoryAction;
    const hadOverride = Boolean(state.modelOverrides[entry.id]);
    const before = hadOverride ? state.modelOverrides[entry.id] : currentModelFor(entry);
    activeModelHistoryAction = { entryId: entry.id, hadOverride, before: before ? JSON.parse(JSON.stringify(before)) : null };
    return activeModelHistoryAction;
  }

  function commitModelHistoryAction(description) {
    if (!activeModelHistoryAction) return;
    const action = activeModelHistoryAction;
    activeModelHistoryAction = null;
    action.after = state.modelOverrides[action.entryId] ? JSON.parse(JSON.stringify(state.modelOverrides[action.entryId])) : null;
    if (JSON.stringify(action.before) === JSON.stringify(action.after)) {
      // Genuinely nothing changed. If this "edit" only exists because
      // materializeModelOverride() forked a full copy of the resolved
      // model before the (no-op) edit ran, undo that fork too -- don't
      // leave a pointless override behind that's byte-for-byte identical
      // to what vanilla/parent resolution already produces.
      if (!action.hadOverride) delete state.modelOverrides[action.entryId];
      return;
    }
    action.description = description;
    state.modelUndo.push(action);
    state.modelRedo = [];
    state.dirty = true;
    persist();
  }

  function undoModel() {
    const action = state.modelUndo.pop(); if (!action) return;
    state.modelRedo.push(action);
    // hadOverride (not before's truthiness -- before is now always a real
    // snapshot, see beginModelHistoryAction) decides whether undoing this
    // action means restoring a prior override or removing the override
    // entirely to fall back to the resolved vanilla/parent/imported model.
    if (action.hadOverride) state.modelOverrides[action.entryId] = action.before; else delete state.modelOverrides[action.entryId];
    state.dirty = true; persist();
    if (item()?.id === action.entryId) rebuildModelGeometry(item());
    renderElementInfoPanel();
  }

  function redoModel() {
    const action = state.modelRedo.pop(); if (!action) return;
    state.modelUndo.push(action);
    // Redo always moves toward a state where the edit was applied, i.e. an
    // override that was just created/changed -- action.after is always a
    // real materialized override at this point (a commit only happens when
    // something actually changed), so this never needs the hadOverride check.
    state.modelOverrides[action.entryId] = action.after;
    state.dirty = true; persist();
    if (item()?.id === action.entryId) rebuildModelGeometry(item());
    renderElementInfoPanel();
  }

  function defaultElement(model) {
    const textureKeys = Object.keys(model?.textures || {});
    const ref = textureKeys.length ? `#${textureKeys[0]}` : '#missing';
    const face = () => ({ texture: ref, uv: [0, 0, 16, 16] });
    return { from: [0, 0, 0], to: [16, 16, 16], faces: { down: face(), up: face(), north: face(), south: face(), west: face(), east: face() } };
  }

  function addModelElement(entry) {
    const diagnosticState = state.modelDiagnostics[entry.id]?.state;
    const hasElementsAlready = (currentModelFor(entry)?.elements || []).length > 0;
    if (!hasElementsAlready && (diagnosticState === 'generated' || diagnosticState === 'builtin-entity')) return; // see renderElementInfo's canAddElements
    beginModelHistoryAction(entry);
    const model = materializeModelOverride(entry);
    model.elements = model.elements || [];
    model.elements.push(defaultElement(model));
    state.selectedElementIndex = model.elements.length - 1;
    state.selectedElementSide = null;
    commitModelHistoryAction('Add model element');
    rebuildModelGeometry(entry);
    renderElementInfoPanel();
  }

  function deleteModelElement(entry, index) {
    beginModelHistoryAction(entry);
    const model = materializeModelOverride(entry);
    if (!model.elements || index < 0 || index >= model.elements.length) { activeModelHistoryAction = null; return; }
    model.elements.splice(index, 1);
    state.selectedElementIndex = model.elements.length ? Math.min(index, model.elements.length - 1) : null;
    state.selectedElementSide = null;
    commitModelHistoryAction('Delete model element');
    rebuildModelGeometry(entry);
    renderElementInfoPanel();
  }

  // Minecraft element coordinates are real model-space numbers, not
  // normalized percentages, and are not silently clamped to 0-16 here --
  // Minecraft itself permits values outside that range for some elements.
  // Only non-finite input is rejected (nothing to sensibly apply).
  function updateElementVector(entry, index, key, axis, value) {
    if (!Number.isFinite(value)) return;
    beginModelHistoryAction(entry);
    const model = materializeModelOverride(entry);
    const element = model.elements?.[index]; if (!element) { activeModelHistoryAction = null; return; }
    element[key] = element[key] ? [...element[key]] : [0, 0, 0];
    element[key][axis] = value;
    commitModelHistoryAction(`Edit element ${key}`);
    rebuildModelGeometry(entry);
  }

  function updateElementRotation(entry, index, field, value) {
    beginModelHistoryAction(entry);
    const model = materializeModelOverride(entry);
    const element = model.elements?.[index]; if (!element) { activeModelHistoryAction = null; return; }
    if (field === 'enabled') {
      if (value) element.rotation = element.rotation || { origin: [8, 8, 8], axis: 'y', angle: 0 };
      else delete element.rotation;
    } else {
      element.rotation = element.rotation ? { ...element.rotation } : { origin: [8, 8, 8], axis: 'y', angle: 0 };
      if (field === 'axis') element.rotation.axis = value;
      else if (field === 'angle' && Number.isFinite(value)) element.rotation.angle = value;
      else if (field === 'rescale') element.rotation.rescale = value;
      else if (field === 'originX' || field === 'originY' || field === 'originZ') {
        if (!Number.isFinite(value)) return;
        const axisIndex = { originX: 0, originY: 1, originZ: 2 }[field];
        element.rotation.origin = element.rotation.origin ? [...element.rotation.origin] : [8, 8, 8];
        element.rotation.origin[axisIndex] = value;
      }
      element.rotation = { ...element.rotation };
    }
    commitModelHistoryAction('Edit element rotation');
    rebuildModelGeometry(entry);
  }

  // Face UV values are stored exactly as given -- Minecraft's own [x0,y0,
  // x1,y1] convention, in the model's declared texture-pixel space (see the
  // Stage 4 UV bridge). Values are not normalized or clamped to 0-16 here;
  // a model legitimately using a larger texture can have UVs outside that
  // range and this must not destroy them.
  function updateFaceField(entry, index, side, field, value) {
    beginModelHistoryAction(entry);
    const model = materializeModelOverride(entry);
    const element = model.elements?.[index]; if (!element) { activeModelHistoryAction = null; return; }
    element.faces = element.faces ? { ...element.faces } : {};
    if (field === 'add') { element.faces[side] = { texture: value || '#missing', uv: [0, 0, 16, 16] }; }
    else if (field === 'remove') { delete element.faces[side]; }
    else {
      const face = element.faces[side]; if (!face) { activeModelHistoryAction = null; return; }
      element.faces[side] = { ...face };
      const target = element.faces[side];
      if (field === 'texture') target.texture = value;
      else if (field === 'rotation') { if (value) target.rotation = value; else delete target.rotation; }
      else if (field === 'cullface') { if (value) target.cullface = value; else delete target.cullface; }
      else if (field === 'tintindex') { if (value === '' || value == null) delete target.tintindex; else target.tintindex = Number(value); }
      else if (field.startsWith('uv')) {
        if (!Number.isFinite(value)) return;
        target.uv = target.uv ? [...target.uv] : [0, 0, 16, 16];
        const uvIndex = { uv0: 0, uv1: 1, uv2: 2, uv3: 3 }[field];
        target.uv[uvIndex] = value;
      }
    }
    commitModelHistoryAction('Edit face');
    rebuildModelGeometry(entry);
  }

  // Targeted rebuild: replaces only the mesh geometry, disposing exactly
  // what it discards, WITHOUT calling setupPreview() -- which would
  // recreate the WebGLRenderer/camera/controls and reset the user's
  // current orbit/zoom. Camera, scene, renderer, and the animate() loop
  // are left completely untouched; only preview.root's mesh children and
  // the grid/axes/bounds helpers (whose size depends on the model) are
  // replaced.
  async function rebuildModelGeometry(entry) {
    if (!preview?.root || item()?.id !== entry.id) return;
    // A dedicated counter -- deliberately NOT previewGeneration, which the
    // animate() loop already uses to decide when to stop rendering
    // entirely; reusing it here would make every model edit look like a
    // stale preview session and kill the live render loop. This one only
    // ever guards "did a newer rebuild (or a full preview re-setup)
    // supersede this in-flight one".
    const generation = ++modelRebuildGeneration;
    const model = await loadModel(entry);
    if (generation !== modelRebuildGeneration || item()?.id !== entry.id || !preview?.root) return;
    [...preview.root.children].forEach(child => {
      if (!child.isMesh) return;
      preview.root.remove(child);
      child.geometry?.dispose?.();
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      materials.forEach(material => { if (material?.map?.isDataTexture) material.map.dispose(); material?.dispose?.(); });
    });
    const meshes = buildModelMeshes(model, entry);
    meshes.forEach(mesh => preview.root.add(mesh));
    if (!meshes.length && !state.modelDiagnostics[entry.id]) {
      state.modelDiagnostics[entry.id] = { state: 'empty', message: 'This model resolved but has no elements to render.' };
    }
    // Local-space bounds (same frame the elements themselves live in),
    // measured via a detached scratch group so root's existing
    // position/rotation (preserved, not reset) doesn't skew the measurement.
    const scratch = new THREE.Group();
    meshes.forEach(mesh => scratch.add(mesh.clone()));
    scratch.updateMatrixWorld(true);
    const rawBox = meshes.length ? new THREE.Box3().setFromObject(scratch) : new THREE.Box3(new THREE.Vector3(-.5, -.5, -.5), new THREE.Vector3(.5, .5, .5));
    const size = rawBox.getSize(new THREE.Vector3());
    preview.bounds = { min: rawBox.min.clone(), max: rawBox.max.clone(), size, elementCount: modelElementCount(model) };
    const maxDimension = Math.max(size.x, size.y, size.z, .08);
    [preview.grid, preview.axes, preview.boundsBox].forEach(helper => { if (helper) { preview.root.remove(helper); preview.scene?.remove(helper); helper.geometry?.dispose?.(); } });
    const grid = new THREE.GridHelper(Math.max(1.4, maxDimension * 2.4), 12, 0x4a6a45, 0x263028);
    grid.position.y = rawBox.min.y;
    grid.visible = state.showModelGrid;
    preview.scene.add(grid);
    const axes = new THREE.AxesHelper(Math.max(.35, maxDimension * .7));
    axes.visible = state.showModelAxes;
    preview.root.add(axes);
    const boundsBox = new THREE.Box3Helper(new THREE.Box3(rawBox.min, rawBox.max), new THREE.Color(0x7ef15e));
    boundsBox.visible = state.showModelBounds;
    preview.root.add(boundsBox);
    preview.grid = grid; preview.axes = axes; preview.boundsBox = boundsBox;
    // Re-apply the selection highlight to whichever new mesh now represents
    // the previously-selected element/face (meshes were just recreated).
    if (state.selectedElementIndex != null) {
      preview.root.traverse(node => {
        if (!node.isMesh) return;
        const isSelected = node.userData?.elementIndex === state.selectedElementIndex && node.userData?.side === state.selectedElementSide;
        node.material?.emissive?.setHex?.(isSelected ? 0x2f6b3f : 0x000000);
      });
    }
  }

  function resetResource() {
    const entry = item(); if (!entry) return;
    delete state.buffers[bufferKey(entry)]; delete state.modifiedResources[entry.path || resourcePath(entry) || entry.id]; state.vanillaLoaded[bufferKey(entry)] = false; state.dirty = true;
    // Also discard any layer structure/buffers, across every frame -- otherwise a stale layer
    // set would still be "active" after the vanilla texture reloads, and
    // the next paint or recomposite() would blend the old (supposedly
    // discarded) layers back on top of the freshly-reloaded vanilla pixels.
    discardAllLayersAndAnimation(entry);
    render(); loadVanillaTexture(entry);
  }

  function editMetadata() {
    const current = project(); if (!current) return;
    const name = window.prompt('Pack name', state.packName); if (name === null) return;
    const description = window.prompt('Description', state.description || '') ?? state.description;
    const author = window.prompt('Author', state.author || '') ?? state.author;
    state.packName = name.trim() || state.packName; state.description = description; state.author = author; state.dirty = true; persist(); render();
  }

  async function importProject() {
    const result = await window.launcherAPI?.importResourcePack?.();
    if (!result?.ok) { if (result?.error) setStatus(result.error, true); return; }
    const name = result.fileName.replace(/\.zip$/i, '') || 'Imported Resource Pack';
    const version = inferVersion(result.packMeta) || '1.21.4';
    const data = defaultEditor(name, version);
    data.importedEntries = result.entries || [];
    data.description = typeof result.packMeta?.pack?.description === 'string' ? result.packMeta.pack.description : '';
    data.author = typeof result.packMeta?.author === 'string' ? result.packMeta.author : '';
    data.iconDataUrl = getPackIconDataUrl({ data }) || null;
    data.dirty = true;
    state.projects.push({ id: `resource-pack-${Date.now()}`, name, version, createdAt: now(), updatedAt: now(), data });
    persist();
    await openProject(state.projects[state.projects.length - 1].id);
  }

  function inferVersion(meta) {
    const pack = meta?.pack;
    const supported = Number(pack?.max_format ?? pack?.pack_format ?? pack?.min_format);
    if (!supported) return null;
    if (supported >= 88) return '26.2';
    if (supported >= 84) return '26.1';
    if (supported >= 75) return '1.21.11';
    if (supported >= 46) return '1.21.4';
    if (supported >= 34) return '1.21.1';
    if (supported >= 32) return '1.20.6';
    if (supported >= 22) return '1.20.4';
    if (supported >= 15) return '1.20.1';
    if (supported >= 13) return '1.19.4';
    if (supported >= 8) return '1.18.2';
    if (supported >= 6) return '1.16.5';
    if (supported >= 3) return '1.12.2';
    return '1.8.9';
  }

  async function exportPack(install) {
    syncProject();
    const entries = [];
    const textureEntries = new Map();
    const current = project();
    Object.entries(state.modifiedResources)
      .sort((left, right) => Number(left[1]) - Number(right[1]))
      .forEach(([path]) => {
      const entry = state.catalog.find(candidate => candidate.path === path || resourcePath(candidate) === path || candidate.id === path);
      if (!entry) return;
      const animation = animationFor(entry);
      if (animation?.enabled) {
        const { sheet, width, height } = buildAnimationSheet(entry);
        const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
        canvas.getContext('2d').putImageData(new ImageData(sheet, width, height), 0, 0);
        const texturePath = `assets/minecraft/textures/${resourcePath(entry)}`;
        textureEntries.set(texturePath, { path: texturePath, dataUrl: canvas.toDataURL('image/png') });
        textureEntries.set(`${texturePath}.mcmeta`, { path: `${texturePath}.mcmeta`, dataUrl: JSON.stringify(buildAnimationMcmeta(entry), null, 2) });
        return;
      }
      const buffer = state.buffers[bufferKey(entry)]; if (!buffer) return;
      const dimensions = dimensionsFor(entry);
      const canvas = document.createElement('canvas'); canvas.width = dimensions.width; canvas.height = dimensions.height;
      canvas.getContext('2d').putImageData(createImageData(entry), 0, 0);
      const texturePath = `assets/minecraft/textures/${resourcePath(entry)}`;
      textureEntries.set(texturePath, { path: texturePath, dataUrl: canvas.toDataURL('image/png') });
    });
    entries.push(...textureEntries.values());
    // Edited model JSON (element/UV editing from Stage 5 Pass 2). Written as
    // plain UTF-8 JSON text, not a data: URL -- the export IPC already
    // accepts either (see main.js's fallback for non-base64 entries, the
    // same path importedEntries' own JSON/lang files already use).
    // Collision guard made explicit here (Pass 2.1 audit): if the project
    // also imported a pack containing this exact model path, that original
    // gets skipped below (importedEntries is merged in afterwards and
    // already checks "is this path taken"), and the guard here stops two
    // overrides from ever producing the same path twice. Either way there
    // is exactly one output entry per edited model path, and it's always
    // the edited one.
    Object.entries(state.modelOverrides).forEach(([entryId, model]) => {
      const entry = state.catalog.find(candidate => candidate.id === entryId);
      if (!entry || !hasMinecraftModel(entry)) return; // defensive: never export an override for a resource whose shape doesn't back a real model path
      linkPrimaryBlockstateModel(model);
      const { namespace, kind, name } = modelPathInfo(entry, model);
      const path = `assets/${namespace}/models/${kind}/${name}.json`;
      if (entries.some(candidate => candidate.path === path)) return;
      const { __blockstateParts, __blockstateName, __blockstateSource, __sourceModelPath, __builtin, __compositeItem, __itemDefinitionDiagnostic, ...exportModel } = model;
      entries.push({ path, dataUrl: JSON.stringify(exportModel, null, 2) });
    });
    (current?.data?.importedEntries || []).forEach(entry => { if (entry.path !== 'pack.mcmeta' && !entries.some(candidate => candidate.path === entry.path)) entries.push({ path: entry.path, dataUrl: entry.data }); });
    const result = await window.launcherAPI?.exportResourcePack?.({ packName: state.packName, description: state.description, author: state.author, iconDataUrl: state.iconDataUrl, version: state.version, entries, install });
    setStatus(result?.ok ? (install ? 'Installed to the active profile.' : 'Exported resource pack ZIP.') : (result?.error || 'Export failed.'), !result?.ok);
  }

  function setStatus(message, error = false) {
    const node = document.getElementById('rpStatus');
    if (node) { node.textContent = message; node.style.color = error ? '#ff8b8b' : 'var(--accent-green)'; }
    const global = document.getElementById('sbStatus'); if (global) global.textContent = message;
  }

  function relativeDate(value) {
    const elapsed = Math.max(0, Date.now() - new Date(value || Date.now()).getTime());
    const minutes = Math.floor(elapsed / 60000); if (minutes < 1) return 'just now'; if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60); if (hours < 24) return `${hours}h ago`; const days = Math.floor(hours / 24); return `${days}d ago`;
  }

  function initialize() {
    restore();
    if (!state.projects.length) {
      const id = `resource-pack-${Date.now()}`;
      state.projects = [{ id, name: 'My Resource Pack', version: '1.21.4', createdAt: now(), updatedAt: now(), data: defaultEditor('My Resource Pack', '1.21.4') }];
    }
    document.addEventListener('keydown', event => {
      if (!(event.ctrlKey || event.metaKey) || !document.querySelector('#resourcePackStudioRoot .rp-studio')) return;
      if (event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) redo(); else undo();
      } else if (event.key.toLowerCase() === 'y') {
        event.preventDefault();
        redo();
      }
    }, { once: true });
    render();
  }

  window.resourcePackStudio = { initialize, render, openLibrary, openProject, createProject, showCreateForm, createFromForm };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true });
  else initialize();
})();
