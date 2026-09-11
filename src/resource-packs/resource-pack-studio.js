'use strict';

(function () {
  const STORAGE_KEY = 'bald:resource-pack-studio:v2';
  const JAVA_VERSIONS = ['26.2', '26.1', '1.21.11', '1.21.4', '1.21.1', '1.20.6', '1.20.4', '1.20.1', '1.19.4', '1.18.2', '1.16.5', '1.12.2', '1.8.9', '1.7.10'];
  const RESOLUTIONS = [8, 16, 32, 64, 128, 256];
  const state = {
    view: 'library',
    activeProjectId: null,
    projects: [],
    catalog: [],
    catalogVersion: null,
    libraryQuery: '',
    libraryFilter: 'All packs',
    librarySort: 'Recently edited',
    query: '',
    category: 'All resources',
    sort: 'Popular',
    selectedId: null,
    selectedPath: null,
    selectedTab: 'texture',
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
    autoRotate: false,
    cameraZoom: 1,
    buffers: {},
    vanillaLoaded: {},
    modifiedResources: {},
    modelCache: {},
    modelTextureCache: {},
    favorites: {},
    recentResources: [],
    undo: [],
    redo: [],
    dirty: false,
    importSummary: null,
  };
  let catalogRequest = null;
  let preview = null;

  const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
  const now = () => new Date().toISOString();
  const project = () => state.projects.find(entry => entry.id === state.activeProjectId);
  const item = () => state.catalog.find(entry => entry.id === state.selectedId) || state.catalog.find(entry => entry.path === state.selectedPath) || state.catalog[0];
  const modifiedCount = pack => Object.keys(pack?.data?.modifiedResources || {}).length;
  const categoryNames = () => ['All resources', ...new Set(state.catalog.map(entry => entry.category).filter(Boolean))];
  const resourcePath = entry => entry?.texturePath || (entry?.path?.match(/textures\/(.+\.png)$/)?.[1] || '');

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
      recentResources: [],
      resolution: 16,
      scale: 1,
      showGrid: true,
      importedEntries: [],
      dirty: false,
    };
  }

  function serializeEditor(editor) {
    if (!editor) return null;
    return { ...editor, buffers: Object.fromEntries(Object.entries(editor.buffers || {}).map(([key, value]) => [key, Array.from(value)])) };
  }

  function reviveEditor(editor) {
    const revived = { ...editor };
    revived.buffers = Object.fromEntries(Object.entries(editor?.buffers || {}).map(([key, value]) => [key, new Uint8ClampedArray(value)]));
    revived.modifiedResources ||= {};
    revived.recentResources ||= [];
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
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  }

  function syncProject() {
    const current = project();
    if (!current || state.view !== 'editor') return;
    current.name = state.packName.trim() || 'Untitled Resource Pack';
    current.version = state.version;
    current.updatedAt = now();
    current.data = serializeEditor(editorSnapshot());
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
      modifiedResources: state.modifiedResources,
      recentResources: state.recentResources,
      resolution: state.resolution,
      scale: state.scale,
      showGrid: state.showGrid,
      importedEntries: state.importedEntries || [],
      dirty: state.dirty,
    };
  }

  function restore() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (!parsed) return;
      state.projects = (parsed.projects || []).map(entry => ({ ...entry, data: reviveEditor(entry.data || defaultEditor(entry.name, entry.version)) }));
      state.libraryQuery = parsed.libraryQuery || '';
      state.libraryFilter = parsed.libraryFilter || 'All packs';
      state.librarySort = parsed.librarySort || 'Recently edited';
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
    const selected = state.projects.find(entry => entry.id === id);
    if (!selected) return;
    const editor = reviveEditor(selected.data || defaultEditor(selected.name, selected.version));
    Object.assign(state, editor, {
      view: 'editor',
      activeProjectId: id,
      version: selected.version || editor.version || '1.21.4',
      packName: selected.name || editor.packName,
      catalog: [],
      catalogVersion: null,
      selectedId: null,
      selectedPath: null,
      query: '',
      category: 'All resources',
      selectedTab: 'texture',
      undo: [],
      redo: [],
    });
    persist();
    render();
    await loadCatalog(state.version);
  }

  function openLibrary() {
    syncProject();
    state.view = 'library';
    state.activeProjectId = null;
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

  async function loadCatalog(version) {
    if (!window.launcherAPI?.getResourcePackCatalog) return;
    if (catalogRequest && state.catalogVersion === version) return catalogRequest;
    catalogRequest = window.launcherAPI.getResourcePackCatalog(version).then(result => {
      if (!result?.ok || !Array.isArray(result.catalog)) throw new Error(result?.error || `No vanilla resources were found for Minecraft ${version}.`);
      state.catalog = result.catalog;
      state.catalogVersion = version;
      if (!state.selectedId || !state.catalog.some(entry => entry.id === state.selectedId)) state.selectedId = state.catalog[0]?.id || null;
      render();
    }).catch(error => setStatus(error.message, true)).finally(() => { catalogRequest = null; });
    return catalogRequest;
  }

  function filteredResources() {
    const query = state.query.trim().toLowerCase();
    const results = state.catalog.filter(entry => {
      if (state.category !== 'All resources' && entry.category !== state.category) return false;
      if (!query) return true;
      return [entry.name, entry.id, entry.path, entry.category, entry.modelName].some(value => String(value || '').toLowerCase().includes(query));
    });
    return results.sort((left, right) => {
      if (state.sort === 'Name') return String(left.name).localeCompare(String(right.name));
      if (state.sort === 'Recently edited') return recentIndex(left) - recentIndex(right);
      if (state.sort === 'Modified first') return Number(isModified(right)) - Number(isModified(left));
      return String(left.name).localeCompare(String(right.name));
    });
  }

  function recentIndex(entry) {
    const index = state.recentResources.indexOf(entry.id);
    return index < 0 ? Number.MAX_SAFE_INTEGER : index;
  }

  function isModified(entry) {
    return Boolean(state.modifiedResources[entry?.path] || state.modifiedResources[resourcePath(entry)] || state.modifiedResources[entry?.id]);
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
    root.style.maxWidth = 'none';
    root.style.padding = '0';
    root.innerHTML = state.view === 'library' ? renderLibrary() : renderEditor();
    if (state.view === 'library') bindLibraryEvents();
    else bindEditorEvents();
  }

  function renderLibrary() {
    const packs = filteredProjects();
    return `
      <section class="rp-shell">
        <header class="rp-topbar">
          <div><div class="rp-eyebrow">BALD LAUNCHER / RESOURCE PACKS</div><h1>Resource Pack Studio</h1><p>Build, browse, and install Java resource packs without leaving the launcher.</p></div>
          <div class="rp-toolbar"><button class="modal-btn" data-rp-action="import">Import ZIP</button><button class="modal-btn primary" data-rp-action="show-create">Create resource pack</button></div>
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
          <div class="rp-create-actions"><button class="modal-btn" data-rp-action="hide-create">Cancel</button><button class="modal-btn primary" data-rp-action="create">Create and open</button></div>
        </div>
        <div class="rp-library-heading"><div><div class="rp-section-title">Your resource packs</div><div class="rp-muted">${packs.length} pack${packs.length === 1 ? '' : 's'} · each project remembers its Minecraft version</div></div></div>
        <div class="rp-pack-grid">${packs.map(renderPackCard).join('') || `<div class="rp-empty"><strong>No resource packs yet</strong><span>Create a pack to start browsing vanilla resources for a specific Minecraft version.</span><button class="modal-btn primary" data-rp-action="show-create">Create resource pack</button></div>`}</div>
      </section>`;
  }

  function renderPackCard(entry) {
    const icon = entry.data?.iconDataUrl ? `<img src="${entry.data.iconDataUrl}" alt="" class="rp-pack-icon">` : '<div class="rp-pack-icon rp-pack-icon-empty">◆</div>';
    return `<article class="rp-pack-card">
      <div class="rp-pack-card-head">${icon}<div class="rp-pack-card-title"><strong>${esc(entry.name)}</strong><span>Minecraft Java ${esc(entry.version)}</span></div><button class="rp-icon-button" data-rp-favorite="${esc(entry.id)}">${entry.data?.favorite ? '♥' : '♡'}</button></div>
      <p>${esc(entry.data?.description || 'No description yet.')}</p>
      <div class="rp-pack-stats"><span>${modifiedCount(entry)} modified</span><span>Edited ${relativeDate(entry.updatedAt)}</span></div>
      <div class="rp-card-actions"><button class="modal-btn primary" data-rp-open="${esc(entry.id)}">Open studio</button><button class="modal-btn" data-rp-duplicate="${esc(entry.id)}">Duplicate</button><button class="rp-text-button" data-rp-delete="${esc(entry.id)}">Delete</button></div>
    </article>`;
  }

  function renderEditor() {
    const current = item();
    const resources = filteredResources();
    const categories = categoryNames();
    const loading = !state.catalog.length;
    return `
      <section class="rp-studio">
        <header class="rp-editor-bar">
          <div class="rp-editor-title"><button class="rp-back" data-rp-action="library">←</button><div><div class="rp-eyebrow">RESOURCE PACK STUDIO</div><strong>${esc(state.packName)}</strong><span>${esc(state.version)} · ${state.dirty ? 'Unsaved changes' : 'Saved'}</span></div></div>
          <div class="rp-toolbar"><button class="modal-btn" data-rp-action="metadata">Pack settings</button><button class="modal-btn" data-rp-action="save">Save</button><button class="modal-btn" data-rp-action="export">Export ZIP</button><button class="modal-btn primary" data-rp-action="install">Install to active profile</button></div>
        </header>
        <div class="rp-workspace">
          <aside class="rp-browser">
            <div class="rp-pane-heading"><div><strong>Browse resources</strong><span>${loading ? 'Loading vanilla catalog…' : `${state.catalog.length} versioned resources`}</span></div><button class="rp-icon-button" data-rp-action="refresh" title="Reload catalog">↻</button></div>
            <input class="modal-input rp-search" id="rpSearch" placeholder="Search items, blocks, entities..." value="${esc(state.query)}">
            <div class="rp-browser-row"><select class="modal-select" id="rpCategory">${categories.map(category => `<option${category === state.category ? ' selected' : ''}>${esc(category)}</option>`).join('')}</select><select class="modal-select" id="rpSort">${['Popular', 'Name', 'Recently edited', 'Modified first'].map(sort => `<option${sort === state.sort ? ' selected' : ''}>${sort}</option>`).join('')}</select></div>
            <div class="rp-resource-count">${resources.length} results</div>
            <div class="rp-resource-grid">${resources.map(renderResourceTile).join('') || '<div class="rp-empty-small">No resources match this search.</div>'}</div>
          </aside>
          <main class="rp-edit-stage">
            ${current ? renderSelectedResource(current) : '<div class="rp-stage-empty">Choose a resource from the browser to begin editing.</div>'}
          </main>
          <aside class="rp-inspector">${current ? renderInspector(current) : ''}</aside>
        </div>
      </section>`;
  }

  function renderResourceTile(entry) {
    const selected = entry.id === state.selectedId;
    const modified = isModified(entry);
    const favorite = Boolean(state.favorites[entry.id]);
    return `<button class="rp-resource-tile${selected ? ' selected' : ''}" data-rp-resource="${esc(entry.id)}" title="${esc(entry.name)}">
      <span class="rp-thumb">${texturePreview(entry)}</span><span class="rp-tile-name">${esc(entry.name)}</span><span class="rp-tile-id">${esc(entry.id)}</span>${modified ? '<i class="rp-modified-dot"></i>' : ''}${favorite ? '<span class="rp-favorite-mark">♥</span>' : ''}</button>`;
  }

  function texturePreview(entry) {
    const path = resourcePath(entry);
    const buffer = state.buffers[`${entry.id}:${state.resolution}`];
    if (buffer) {
      const canvas = document.createElement('canvas');
      canvas.width = state.resolution; canvas.height = state.resolution;
      canvas.getContext('2d').putImageData(new ImageData(buffer, state.resolution, state.resolution), 0, 0);
      return `<img src="${canvas.toDataURL()}" alt="" class="rp-thumb-image">`;
    }
    return `<span class="rp-thumb-placeholder">${entry.category === 'Blocks' ? '▦' : entry.category === 'Entities' ? '◉' : '◆'}</span>`;
  }

  function renderSelectedResource(entry) {
    return `<div class="rp-edit-header"><div><div class="rp-eyebrow">${esc(entry.category)}</div><h2>${esc(entry.name)}</h2><span>${esc(entry.path || `minecraft:${entry.id}`)}</span></div><div class="rp-resource-actions"><button class="rp-icon-button" data-rp-action="favorite-resource">${state.favorites[entry.id] ? '♥' : '♡'}</button><button class="modal-btn" data-rp-action="reset">Reset vanilla</button></div></div>
      <div class="rp-tabs">${['texture', 'model', 'details'].map(tab => `<button class="${state.selectedTab === tab ? 'active' : ''}" data-rp-tab="${tab}">${tab[0].toUpperCase() + tab.slice(1)}</button>`).join('')}</div>
      ${state.selectedTab === 'texture' ? renderTextureEditor(entry) : state.selectedTab === 'model' ? renderModelEditor(entry) : renderDetails(entry)}`;
  }

  function renderTextureEditor(entry) {
    return `<div class="rp-canvas-panel"><div class="rp-canvas-toolbar"><div class="rp-tool-group">${['pencil', 'eraser'].map(tool => `<button class="modal-btn ${state.tool === tool ? 'primary' : ''}" data-rp-tool="${tool}">${tool === 'pencil' ? 'Pencil' : 'Eraser'}</button>`).join('')}<input id="rpColor" type="color" value="${esc(state.color)}" title="Paint color"><select class="modal-select" id="rpBrushSize">${[1, 2, 4, 8].map(size => `<option value="${size}"${size === state.brushSize ? ' selected' : ''}>${size}px brush</option>`).join('')}</select></div><label class="rp-check"><input id="rpGrid" type="checkbox"${state.showGrid ? ' checked' : ''}> Pixel grid</label></div>
      <div class="rp-canvas-wrap"><canvas id="rpPaintCanvas" width="256" height="256"></canvas><div class="rp-canvas-caption">Drag to paint · right-click or Eraser removes pixels</div></div>
      <div class="rp-edit-footer"><div><strong>${state.resolution} × ${state.resolution}</strong><span>Texture resolution</span></div><select class="modal-select" id="rpResolution">${RESOLUTIONS.map(size => `<option value="${size}"${size === state.resolution ? ' selected' : ''}>${size} × ${size}</option>`).join('')}</select><button class="modal-btn" data-rp-action="undo">Undo</button><button class="modal-btn" data-rp-action="redo">Redo</button></div></div>`;
  }

  function renderModelEditor(entry) {
    const model = state.modelCache[modelKey(entry)];
    const elements = model?.elements?.length || 0;
    const textures = Object.keys(model?.textures || {}).length;
    return `<div class="rp-model-editor"><div class="rp-model-editor-head"><div><div class="rp-eyebrow">RESOLVED MINECRAFT MODEL</div><h3>${esc(entry.modelName || entry.id)}</h3><p>${model ? `${elements} cuboids · ${textures} texture slots · click a face to paint its UV pixels` : 'Loading model elements and texture references…'}</p></div><button class="modal-btn" data-rp-action="reset-camera">Reset view</button></div><div class="rp-model-viewport"><canvas id="rp3dCanvas"></canvas><span>Left click paints · right drag orbits · wheel zooms</span></div></div>`;
  }

  function renderDetails(entry) {
    return `<div class="rp-details"><div><span>Resource ID</span><strong>minecraft:${esc(entry.id)}</strong></div><div><span>Asset path</span><strong>${esc(entry.path || 'Version-specific')}</strong></div><div><span>Category</span><strong>${esc(entry.category || 'Other')}</strong></div><div><span>Model</span><strong>${esc(entry.modelName || entry.shape || 'Vanilla')}</strong></div></div>`;
  }

  function renderInspector(entry) {
    const model = state.modelCache[modelKey(entry)];
    const viewport = state.selectedTab === 'model' ? '' : `<div class="rp-preview-wrap"><canvas id="rp3dCanvas"></canvas><span>Left click paints · right drag orbits · wheel zooms</span></div>`;
    return `<div class="rp-inspector-heading"><strong>Model preview</strong><button class="rp-icon-button" data-rp-action="auto-rotate">${state.autoRotate ? '⏸' : '↻'}</button></div>${viewport}
      <div class="rp-model-facts"><span>${model?.elements?.length || 0} cuboids</span><span>${Object.keys(model?.textures || {}).length} textures</span></div>
      <div class="rp-inspector-section"><div class="rp-pane-heading"><strong>Display</strong></div><label class="rp-range-label">In-game scale <b>${Math.round(state.scale * 100)}%</b></label><input id="rpScale" type="range" min=".5" max="4" step=".05" value="${state.scale}"><p class="rp-muted">Visual scale changes preview only. Texture resolution stays ${state.resolution}px.</p></div>
      <div class="rp-inspector-section"><div class="rp-pane-heading"><strong>Pack changes</strong><span>${Object.keys(state.modifiedResources).length}</span></div><p class="rp-muted">${isModified(entry) ? 'This resource will be included in the next export.' : 'This resource is still vanilla.'}</p><button class="modal-btn" data-rp-action="metadata" style="width:100%">Edit pack metadata</button></div>
      <div id="rpStatus" class="rp-status"></div>`;
  }

  function bindLibraryEvents() {
    const root = document.getElementById('resourcePackStudioRoot');
    root.querySelector('[data-rp-action="show-create"]')?.addEventListener('click', () => { const card = document.getElementById('rpCreateCard'); if (card) card.hidden = false; document.getElementById('rpNewName')?.focus(); });
    root.querySelector('[data-rp-action="hide-create"]')?.addEventListener('click', () => { const card = document.getElementById('rpCreateCard'); if (card) card.hidden = true; });
    root.querySelector('[data-rp-action="create"]')?.addEventListener('click', async () => {
      const iconFile = document.getElementById('rpNewIcon')?.files?.[0];
      const iconDataUrl = iconFile ? await readFileAsDataUrl(iconFile) : null;
      await createProject(document.getElementById('rpNewName')?.value.trim() || 'My Resource Pack', document.getElementById('rpNewVersion')?.value || '1.21.4', document.getElementById('rpNewDescription')?.value.trim() || '', document.getElementById('rpNewAuthor')?.value.trim() || '', iconDataUrl);
    });
    root.querySelector('[data-rp-action="import"]')?.addEventListener('click', importProject);
    root.querySelector('#rpLibrarySearch')?.addEventListener('input', event => { state.libraryQuery = event.target.value; render(); document.getElementById('rpLibrarySearch')?.focus(); });
    root.querySelector('#rpLibrarySort')?.addEventListener('change', event => { state.librarySort = event.target.value; persist(); render(); });
    root.querySelectorAll('[data-rp-filter]').forEach(button => button.addEventListener('click', () => { state.libraryFilter = button.dataset.rpFilter; persist(); render(); }));
    root.querySelectorAll('[data-rp-open]').forEach(button => button.addEventListener('click', () => openProject(button.dataset.rpOpen)));
    root.querySelectorAll('[data-rp-duplicate]').forEach(button => button.addEventListener('click', () => duplicateProject(button.dataset.rpDuplicate)));
    root.querySelectorAll('[data-rp-delete]').forEach(button => button.addEventListener('click', () => deleteProject(button.dataset.rpDelete)));
    root.querySelectorAll('[data-rp-favorite]').forEach(button => button.addEventListener('click', () => togglePackFavorite(button.dataset.rpFavorite)));
  }

  function bindEditorEvents() {
    const root = document.getElementById('resourcePackStudioRoot');
    root.querySelector('[data-rp-action="library"]')?.addEventListener('click', openLibrary);
    root.querySelector('[data-rp-action="save"]')?.addEventListener('click', () => { state.dirty = false; persist(); render(); setStatus('Saved.'); });
    root.querySelector('[data-rp-action="export"]')?.addEventListener('click', () => exportPack(false));
    root.querySelector('[data-rp-action="install"]')?.addEventListener('click', () => exportPack(true));
    root.querySelector('[data-rp-action="metadata"]')?.addEventListener('click', editMetadata);
    root.querySelector('[data-rp-action="refresh"]')?.addEventListener('click', () => { state.catalogVersion = null; loadCatalog(state.version); });
    root.querySelector('#rpSearch')?.addEventListener('input', event => { state.query = event.target.value; render(); document.getElementById('rpSearch')?.focus(); });
    root.querySelector('#rpCategory')?.addEventListener('change', event => { state.category = event.target.value; render(); });
    root.querySelector('#rpSort')?.addEventListener('change', event => { state.sort = event.target.value; render(); });
    root.querySelector('#rpResolution')?.addEventListener('change', event => { state.resolution = Number(event.target.value); render(); loadVanillaTexture(item()); });
    root.querySelector('#rpBrushSize')?.addEventListener('change', event => { state.brushSize = Number(event.target.value); });
    root.querySelector('#rpColor')?.addEventListener('input', event => { state.color = event.target.value; });
    root.querySelector('#rpGrid')?.addEventListener('change', event => { state.showGrid = event.target.checked; drawPainter(); });
    root.querySelector('#rpScale')?.addEventListener('input', event => { state.scale = Number(event.target.value); updatePreview(); });
    root.querySelectorAll('[data-rp-tool]').forEach(button => button.addEventListener('click', () => { state.tool = button.dataset.rpTool; render(); }));
    root.querySelectorAll('[data-rp-tab]').forEach(button => button.addEventListener('click', () => { state.selectedTab = button.dataset.rpTab; render(); }));
    root.querySelectorAll('[data-rp-resource]').forEach(button => button.addEventListener('click', () => selectResource(button.dataset.rpResource)));
    root.querySelector('[data-rp-action="favorite-resource"]')?.addEventListener('click', () => { state.favorites[state.selectedId] = !state.favorites[state.selectedId]; render(); });
    root.querySelector('[data-rp-action="reset"]')?.addEventListener('click', resetResource);
    root.querySelector('[data-rp-action="undo"]')?.addEventListener('click', undo);
    root.querySelector('[data-rp-action="redo"]')?.addEventListener('click', redo);
    root.querySelector('[data-rp-action="auto-rotate"]')?.addEventListener('click', () => { state.autoRotate = !state.autoRotate; render(); setupPreview(); });
    root.querySelector('[data-rp-action="reset-camera"]')?.addEventListener('click', () => { state.cameraZoom = 1; updatePreview(); });
    setupPainter();
    setupPreview();
    loadModel(item()).then(() => { if (document.getElementById('rp3dCanvas')) setupPreview(); });
    loadVanillaTexture(item());
  }

  async function selectResource(id) {
    state.selectedId = id;
    state.selectedPath = null;
    state.recentResources = [id, ...state.recentResources.filter(entry => entry !== id)].slice(0, 30);
    state.selectedTab = 'texture';
    render();
    await loadModel(item());
    await loadVanillaTexture(item());
  }

  function modelKey(entry) {
    return `${state.version}:${entry?.modelName || entry?.id || 'missing'}`;
  }

  async function loadModel(entry) {
    if (!entry || !window.launcherAPI?.getResourcePackModel) return null;
    const key = modelKey(entry);
    if (state.modelCache[key]) return state.modelCache[key];
    const result = await window.launcherAPI.getResourcePackModel(state.version, entry.modelName || entry.id);
    if (!result?.ok) {
      setStatus(result?.error || 'Minecraft model unavailable.', true);
      return null;
    }
    state.modelCache[key] = result.data || {};
    return state.modelCache[key];
  }

  function createBuffer(size, entry) {
    const data = new Uint8ClampedArray(size * size * 4);
    const seed = [...String(entry?.id || '')].reduce((sum, character) => sum + character.charCodeAt(0), 0);
    for (let index = 0; index < data.length; index += 4) {
      const value = 80 + ((index / 4 + seed) % 40);
      data[index] = value; data[index + 1] = value; data[index + 2] = value; data[index + 3] = 255;
    }
    return data;
  }

  async function loadVanillaTexture(entry) {
    if (!entry || !window.launcherAPI?.getResourcePackAsset) return;
    const path = resourcePath(entry);
    if (!path || !/\.png$/i.test(path)) { drawPainter(); setupPreview(); return; }
    const key = `${entry.id}:${state.resolution}`;
    if (state.vanillaLoaded[key]) { drawPainter(); setupPreview(); return; }
    const result = await window.launcherAPI.getResourcePackAsset(state.version, path);
    if (!result?.ok) { setStatus(result?.error || 'Vanilla texture unavailable.', true); return; }
    const image = new Image();
    image.onload = () => {
      const scratch = document.createElement('canvas');
      scratch.width = state.resolution; scratch.height = state.resolution;
      const context = scratch.getContext('2d');
      context.imageSmoothingEnabled = false;
      context.drawImage(image, 0, 0, scratch.width, scratch.height);
      const pixels = context.getImageData(0, 0, scratch.width, scratch.height).data;
      if (!state.buffers[key] || !isModified(entry)) state.buffers[key] = pixels;
      state.vanillaLoaded[key] = true;
      render();
    };
    image.src = result.dataUrl;
  }

  function setupPainter() {
    const canvas = document.getElementById('rpPaintCanvas');
    if (!canvas) return;
    drawPainter();
    let drawing = false;
    const paint = event => {
      if (!drawing) return;
      const rect = canvas.getBoundingClientRect();
      const x = Math.max(0, Math.min(state.resolution - 1, Math.floor((event.clientX - rect.left) / rect.width * state.resolution)));
      const y = Math.max(0, Math.min(state.resolution - 1, Math.floor((event.clientY - rect.top) / rect.height * state.resolution)));
      const buffer = getBuffer(item());
      const before = new Uint8ClampedArray(buffer);
      for (let offsetY = -state.brushSize + 1; offsetY < state.brushSize; offsetY += 1) for (let offsetX = -state.brushSize + 1; offsetX < state.brushSize; offsetX += 1) {
        const targetX = x + offsetX; const targetY = y + offsetY;
        if (targetX < 0 || targetY < 0 || targetX >= state.resolution || targetY >= state.resolution) continue;
        const index = (targetY * state.resolution + targetX) * 4;
        if (state.tool === 'eraser') buffer[index + 3] = 0;
        else { const rgb = hexToRgb(state.color); buffer[index] = rgb[0]; buffer[index + 1] = rgb[1]; buffer[index + 2] = rgb[2]; buffer[index + 3] = Math.round(state.opacity * 255); }
      }
      state.undo.push({ key: bufferKey(item()), before, after: new Uint8ClampedArray(buffer) }); state.redo = [];
      markModified(item()); drawPainter(); updatePreview();
    };
    canvas.addEventListener('pointerdown', event => { drawing = true; canvas.setPointerCapture(event.pointerId); paint(event); });
    canvas.addEventListener('pointermove', paint);
    canvas.addEventListener('pointerup', () => { drawing = false; });
    canvas.addEventListener('pointerleave', () => { drawing = false; });
  }

  function drawPainter() {
    const canvas = document.getElementById('rpPaintCanvas');
    const entry = item();
    if (!canvas || !entry) return;
    const context = canvas.getContext('2d');
    const buffer = getBuffer(entry);
    const image = new ImageData(buffer, state.resolution, state.resolution);
    const scratch = document.createElement('canvas'); scratch.width = state.resolution; scratch.height = state.resolution;
    scratch.getContext('2d').putImageData(image, 0, 0);
    context.imageSmoothingEnabled = false;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(scratch, 0, 0, canvas.width, canvas.height);
    if (state.showGrid && state.resolution <= 64) {
      context.strokeStyle = 'rgba(255,255,255,.16)'; context.lineWidth = 1;
      const size = canvas.width / state.resolution;
      for (let line = 0; line <= state.resolution; line += 1) { context.beginPath(); context.moveTo(line * size, 0); context.lineTo(line * size, canvas.height); context.stroke(); context.beginPath(); context.moveTo(0, line * size); context.lineTo(canvas.width, line * size); context.stroke(); }
    }
  }

  async function setupPreview() {
    const canvas = document.getElementById('rp3dCanvas');
    if (!canvas || !window.THREE || !item()) return;
    if (preview?.renderer) preview.renderer.dispose();
    const entry = item();
    const model = await loadModel(entry);
    const width = Math.max(260, canvas.parentElement.clientWidth);
    const height = Math.max(260, canvas.parentElement.clientHeight);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(34, width / height, .1, 100);
    camera.position.set(2.4, 1.8, 3.2);
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2)); renderer.setSize(width, height, false);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x25323b, 2));
    const root = new THREE.Group();
    const meshes = buildModelMeshes(model, entry);
    meshes.forEach(mesh => root.add(mesh));
    if (!meshes.length) {
      setStatus('This resource has no renderable Minecraft model elements.', true);
    }
    root.position.set(-.5, -.5, -.5);
    scene.add(root);
    const animate = () => { if (!document.getElementById('rp3dCanvas')) { renderer.dispose(); return; } if (state.autoRotate) root.rotation.y += .008; root.scale.setScalar(state.scale); renderer.render(scene, camera); requestAnimationFrame(animate); };
    preview = { renderer, scene, camera, mesh: root, root }; animate();
    canvas.onwheel = event => { event.preventDefault(); state.cameraZoom = Math.max(.55, Math.min(2.5, state.cameraZoom + event.deltaY * -.001)); camera.position.z = 3.2 / state.cameraZoom; };
    let dragging = false; let lastX = 0; let lastY = 0;
    let painting = false;
    canvas.onpointerdown = event => {
      if (event.button === 0) { painting = true; paintModelAt(event); }
      else { dragging = true; lastX = event.clientX; lastY = event.clientY; }
      canvas.setPointerCapture(event.pointerId);
    };
    canvas.onpointermove = event => {
      if (painting) paintModelAt(event);
      if (!dragging) return;
      root.rotation.y += (event.clientX - lastX) * .01; root.rotation.x = Math.max(-1.2, Math.min(1.2, root.rotation.x + (event.clientY - lastY) * .01)); lastX = event.clientX; lastY = event.clientY;
    };
    canvas.onpointerup = () => { painting = false; dragging = false; };
    canvas.oncontextmenu = event => event.preventDefault();
  }

  function buildModelMeshes(model, entry) {
    if (!model?.elements?.length) return [];
    const meshes = [];
    model.elements.forEach((element, elementIndex) => {
      const from = element.from || [0, 0, 0], to = element.to || [16, 16, 16];
      Object.entries(element.faces || {}).forEach(([side, face]) => {
        const positions = faceVertices(from, to, side);
        if (!positions) return;
        const geometry = new THREE.BufferGeometry();
        const uv = face.uv || defaultFaceUv(side, from, to);
        const u0 = Number(uv?.[0] ?? 0) / 16, v0 = 1 - Number(uv?.[1] ?? 0) / 16;
        const u1 = Number(uv?.[2] ?? 16) / 16, v1 = 1 - Number(uv?.[3] ?? 16) / 16;
        const order = face.rotation ? [0, 1, 3, 2] : [0, 1, 2, 3];
        const pos = [positions[order[0]], positions[order[1]], positions[order[2]], positions[order[0]], positions[order[2]], positions[order[3]]].flat();
        const uvs = [u0, v0, u1, v0, u1, v1, u0, v0, u1, v1, u0, v1];
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
        geometry.computeVertexNormals();
        const textureRef = resolveTexture(model.textures || {}, face.texture);
        const material = new THREE.MeshStandardMaterial({ map: textureFor(textureRef, entry), color: 0xffffff, roughness: .88, side: THREE.DoubleSide });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.userData = { textureRef, elementIndex, side, entryId: entry.id };
        meshes.push(mesh);
      });
    });
    return meshes;
  }

  function resolveTexture(textures, reference) {
    let value = String(reference || '').replace(/^#/, '');
    const seen = new Set();
    while (value.startsWith('#') || textures[value]) {
      if (seen.has(value)) break;
      seen.add(value);
      value = String(textures[value] || value).replace(/^#/, '');
      if (!textures[value]) break;
    }
    return value.replace(/^minecraft:/, '').replace(/^textures\//, '').replace(/\.png$/i, '') || 'block/missing';
  }

  function textureFor(textureRef, entry) {
    const key = `${state.version}:${textureRef}:${state.resolution}`;
    const buffer = state.buffers[bufferKey(entry)];
    const selectedTextureRef = resourcePath(entry).replace(/\.png$/i, '').replace(/^blocks\//, 'block/').replace(/^items\//, 'item/');
    if (textureRef === selectedTextureRef || textureRef === resourcePath(entry)) {
      const texture = new THREE.DataTexture(buffer || getBuffer(entry), state.resolution, state.resolution, THREE.RGBAFormat);
      texture.magFilter = THREE.NearestFilter; texture.minFilter = THREE.NearestFilter; texture.needsUpdate = true;
      return texture;
    }
    const cached = state.modelTextureCache[key];
    if (cached) return cached;
    const texture = new THREE.Texture();
    texture.magFilter = THREE.NearestFilter; texture.minFilter = THREE.NearestFilter; texture.generateMipmaps = false;
    const assetPath = /^(?:items|blocks|entity)\//.test(textureRef) ? `${textureRef}.png` : `blocks/${textureRef}.png`;
    window.launcherAPI?.getResourcePackAsset?.(state.version, assetPath).then(result => {
      if (!result?.ok) return;
      const image = new Image();
      image.onload = () => { texture.image = image; texture.needsUpdate = true; };
      image.src = result.dataUrl;
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

  function defaultFaceUv(side, from, to) {
    const [x0, y0, z0] = from, [x1, y1, z1] = to;
    if (side === 'up' || side === 'down') return [x0, z0, x1, z1];
    if (side === 'north' || side === 'south') return [x0, 16 - y1, x1, 16 - y0];
    return [z0, 16 - y1, z1, 16 - y0];
  }

  function paintModelAt(event) {
    if (!preview?.root || !item()) return;
    const canvas = event.currentTarget, rect = canvas.getBoundingClientRect();
    const pointer = new THREE.Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    const raycaster = new THREE.Raycaster(); raycaster.setFromCamera(pointer, preview.camera);
    const hit = raycaster.intersectObject(preview.root, true).find(result => result.uv);
    if (!hit?.uv) return;
    const x = Math.max(0, Math.min(state.resolution - 1, Math.floor(hit.uv.x * state.resolution)));
    const y = Math.max(0, Math.min(state.resolution - 1, Math.floor((1 - hit.uv.y) * state.resolution)));
    paintPixel(item(), x, y);
  }

  function paintPixel(entry, x, y) {
    const buffer = getBuffer(entry), index = (y * state.resolution + x) * 4;
    if (state.tool === 'eraser') buffer[index + 3] = 0;
    else { const rgb = hexToRgb(state.color); buffer[index] = rgb[0]; buffer[index + 1] = rgb[1]; buffer[index + 2] = rgb[2]; buffer[index + 3] = Math.round(state.opacity * 255); }
    markModified(entry); drawPainter(); setupPreview();
    canvas.onpointerup = () => { dragging = false; };
  }

  function updatePreview() {
    if (preview?.mesh) preview.mesh.scale.setScalar(state.scale);
  }

  function getBuffer(entry) {
    const key = bufferKey(entry);
    if (!state.buffers[key]) state.buffers[key] = createBuffer(state.resolution, entry);
    return state.buffers[key];
  }

  function bufferKey(entry) { return `${entry?.id || 'unknown'}:${state.resolution}`; }
  function markModified(entry) { state.modifiedResources[entry.path || resourcePath(entry) || entry.id] = true; state.dirty = true; persist(); }
  function hexToRgb(value) { const normalized = String(value).replace('#', ''); return [parseInt(normalized.slice(0, 2), 16) || 0, parseInt(normalized.slice(2, 4), 16) || 0, parseInt(normalized.slice(4, 6), 16) || 0]; }
  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(reader.error || new Error('Could not read the selected icon.'));
      reader.readAsDataURL(file);
    });
  }

  function undo() {
    const change = state.undo.pop(); if (!change) return;
    state.redo.push({ ...change, before: change.after, after: change.before });
    state.buffers[change.key] = change.before; markModified(item()); drawPainter(); updatePreview();
  }

  function redo() {
    const change = state.redo.pop(); if (!change) return;
    state.undo.push({ ...change, before: change.after, after: change.before });
    state.buffers[change.key] = change.before; markModified(item()); drawPainter(); updatePreview();
  }

  function resetResource() {
    const entry = item(); if (!entry) return;
    delete state.buffers[bufferKey(entry)]; delete state.modifiedResources[entry.path || resourcePath(entry) || entry.id]; state.vanillaLoaded[bufferKey(entry)] = false; state.dirty = true; render(); loadVanillaTexture(entry);
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
    data.iconDataUrl = data.importedEntries.find(entry => entry.path === 'pack.png')?.data || null;
    data.dirty = true;
    state.projects.push({ id: `resource-pack-${Date.now()}`, name, version, createdAt: now(), updatedAt: now(), data });
    persist();
    await openProject(state.projects[state.projects.length - 1].id);
  }

  function inferVersion(meta) {
    const supported = Number(meta?.pack?.pack_format);
    if (!supported) return null;
    if (supported >= 75) return '1.21.11';
    if (supported >= 46) return '1.21.4';
    if (supported >= 34) return '1.21.1';
    if (supported >= 22) return '1.20.1';
    return '1.16.5';
  }

  async function exportPack(install) {
    syncProject();
    const entries = [];
    const current = project();
    Object.entries(state.modifiedResources).forEach(([path]) => {
      const entry = state.catalog.find(candidate => candidate.path === path || resourcePath(candidate) === path || candidate.id === path);
      if (!entry) return;
      const buffer = state.buffers[bufferKey(entry)]; if (!buffer) return;
      const canvas = document.createElement('canvas'); canvas.width = state.resolution; canvas.height = state.resolution;
      canvas.getContext('2d').putImageData(new ImageData(buffer, state.resolution, state.resolution), 0, 0);
      entries.push({ path: entry.path || `assets/minecraft/textures/${path}`, dataUrl: canvas.toDataURL('image/png') });
    });
    (current?.data?.importedEntries || []).forEach(entry => { if (entry.path !== 'pack.mcmeta' && !entries.some(candidate => candidate.path === entry.path)) entries.push({ path: entry.path, dataUrl: entry.data }); });
    const result = await window.launcherAPI?.exportResourcePack?.({ packName: state.packName, description: state.description, author: state.author, version: state.version, entries, install });
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
    render();
  }

  window.resourcePackStudio = { initialize, render, openLibrary, createProject };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true });
  else initialize();
})();
