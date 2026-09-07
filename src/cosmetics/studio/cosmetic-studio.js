'use strict';

(function () {
  const MAX_HISTORY = 50;
  const DRAFT_PREFIX = 'bald:cosmetic-studio:';
  let active = null;

  function createStudio(kind, asset = null) {
    const isSkin = kind === 'skin';
    const width = isSkin ? 64 : 64;
    const height = isSkin ? 64 : 32;
    const state = { kind, width, height, model: asset?.model || 'classic', name: asset?.name || (isSkin ? 'My Skin' : 'My Cape'), asset, tool: 'pencil', color: '#72e64b', opacity: 1, brush: 1, zoom: isSkin ? 8 : 12, grid: true, symmetryX: false, symmetryY: false, pixels: new Uint8ClampedArray(width * height * 4), undo: [], redo: [], dirty: false, pointer: null, previewVersion: 0 };
    for (let index = 0; index < state.pixels.length; index += 4) state.pixels[index + 3] = 0;
    active = state;
    buildUi(state);
    if (asset?.filePath) loadAssetImage(state, asset.filePath);
    else applyTemplate(state, 'blank');
    restoreDraft(state);
    draw(state);
    return state;
  }

  function buildUi(state) {
    document.getElementById('cosmeticStudioModal')?.remove();
    const skin = state.kind === 'skin';
    const overlay = document.createElement('div'); overlay.id = 'cosmeticStudioModal'; overlay.className = 'modal-overlay'; overlay.style.cssText = 'display:flex;z-index:80;align-items:stretch;padding:18px;';
    overlay.innerHTML = `<div style="width:min(1180px,100%);height:min(760px,100%);background:var(--bg-surface);border:0.5px solid var(--border);border-radius:12px;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 24px 80px rgba(0,0,0,.45);">
      <div style="display:flex;align-items:center;gap:10px;padding:12px 16px;border-bottom:0.5px solid var(--border);flex-wrap:wrap;">
        <strong style="color:var(--text-primary);font-size:13px;">${skin ? 'Skin Studio' : 'Cape Studio'}</strong>
        <input id="studioName" class="modal-input" value="${escapeHtml(state.name)}" style="width:170px;" />
        ${skin ? '<select id="studioModel" class="modal-select"><option value="classic">Classic / Steve</option><option value="slim">Slim / Alex</option></select>' : '<span style="font-size:10px;color:var(--text-secondary);">64 × 32 Minecraft cape</span>'}
        <span id="studioSaveState" style="font-size:10px;color:var(--text-secondary);margin-left:auto;">Unsaved changes</span>
        <button class="modal-btn" type="button" data-studio-action="freeze">Freeze motion</button><button class="modal-btn" type="button" data-studio-action="undo">Undo</button><button class="modal-btn" type="button" data-studio-action="redo">Redo</button><button class="modal-btn" type="button" data-studio-action="import">Import</button><button class="modal-btn" type="button" data-studio-action="export">Export</button><button class="modal-btn primary" type="button" data-studio-action="save">Save</button><button class="modal-btn" type="button" data-studio-action="close">Close</button>
      </div>
      <div style="display:grid;grid-template-columns:180px minmax(300px,1fr) 300px;gap:14px;min-height:0;flex:1;padding:14px;">
        <aside style="border:0.5px solid var(--border);border-radius:9px;padding:10px;display:flex;flex-direction:column;gap:8px;overflow:auto;">
          <div style="font-size:10px;color:var(--text-secondary);text-transform:uppercase;letter-spacing:.08em;">Tools</div>
          <div id="studioTools" style="display:grid;grid-template-columns:1fr 1fr;gap:6px;">${['pencil','eraser','fill','eyedropper','line','rectangle','clear'].map(tool => `<button class="modal-btn ${tool === 'pencil' ? 'primary' : ''}" type="button" data-tool="${tool}">${tool[0].toUpperCase() + tool.slice(1)}</button>`).join('')}</div>
          <label style="font-size:10px;color:var(--text-secondary);">Brush <input id="studioBrush" type="range" min="1" max="8" value="1" style="width:100%;" /></label>
          <label style="font-size:10px;color:var(--text-secondary);">Opacity <input id="studioOpacity" type="range" min="1" max="100" value="100" style="width:100%;" /></label>
          <label style="font-size:10px;color:var(--text-secondary);">Color <input id="studioColor" type="color" value="#72e64b" style="width:100%;height:30px;" /></label>
          <input id="studioHex" class="modal-input" value="#72e64b" placeholder="#RRGGBB" />
          <label style="font-size:10px;color:var(--text-secondary);"><input id="studioGrid" type="checkbox" checked /> Pixel grid</label>
          <label style="font-size:10px;color:var(--text-secondary);"><input id="studioSymX" type="checkbox" /> Mirror horizontally</label>
          <label style="font-size:10px;color:var(--text-secondary);"><input id="studioSymY" type="checkbox" /> Mirror vertically</label>
          <div style="font-size:10px;color:var(--text-secondary);text-transform:uppercase;letter-spacing:.08em;margin-top:5px;">Templates</div>
          <select id="studioTemplate" class="modal-select"><option value="blank">Blank</option><option value="hoodie">Basic hoodie</option><option value="shirt">Basic shirt</option><option value="pants">Basic pants</option><option value="checker">Checker cape</option><option value="stripes">Stripes cape</option></select>
          <button class="modal-btn" type="button" data-studio-action="template">Apply template</button>
        </aside>
        <section style="border:0.5px solid var(--border);border-radius:9px;background:#07090b;display:flex;flex-direction:column;min-height:0;overflow:hidden;">
          <div style="display:flex;align-items:center;gap:6px;padding:8px;border-bottom:0.5px solid var(--border);"><strong style="font-size:11px;color:var(--text-primary);">3D Player Paint</strong><span style="font-size:10px;color:var(--text-secondary);">Click the player to paint pixels</span><label style="margin-left:auto;font-size:10px;color:var(--text-secondary);"><input id="studioModelGrid" type="checkbox" checked /> 3D grid</label></div>
          <div style="flex:1;min-height:320px;display:flex;align-items:center;justify-content:center;overflow:hidden;"><canvas id="studioPreviewCanvas" width="520" height="520" style="width:100%;height:100%;max-height:100%;"></canvas></div>
          <div style="display:flex;gap:5px;flex-wrap:wrap;padding:8px;border-top:0.5px solid var(--border);"><button class="modal-btn" type="button" data-pose="arms-out" style="padding:4px 6px;font-size:9px;">Arms out</button><button class="modal-btn" type="button" data-pose="arms-up" style="padding:4px 6px;font-size:9px;">Arms up</button><button class="modal-btn" type="button" data-pose="legs-separated" style="padding:4px 6px;font-size:9px;">Legs separated</button><button class="modal-btn" type="button" data-pose="reset" style="padding:4px 6px;font-size:9px;">Reset pose</button></div>
        </section>
        <aside style="border:0.5px solid var(--border);border-radius:9px;padding:10px;display:flex;flex-direction:column;gap:8px;min-height:0;overflow:auto;">
          <canvas id="studioCanvas" width="64" height="${skin ? 64 : 32}" aria-hidden="true" tabindex="-1" style="position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;"></canvas>
          <div style="font-size:10px;color:var(--text-secondary);text-transform:uppercase;letter-spacing:.08em;margin-top:5px;">Layers</div>
          <div style="display:flex;gap:5px;flex-wrap:wrap;"><button class="modal-btn selected-toggle" type="button" data-layer="inner">Base layer</button><button class="modal-btn selected-toggle" type="button" data-layer="outer">Outer layer</button></div>
          <div style="font-size:10px;color:var(--text-secondary);text-transform:uppercase;letter-spacing:.08em;margin-top:5px;">Parts</div>
          <div id="studioPartMap" style="position:relative;height:168px;margin-top:2px;background:rgba(0,0,0,.16);border:0.5px solid var(--border);border-radius:7px;">
            <button class="studio-part head selected-toggle" type="button" data-part="head" title="Head" style="position:absolute;left:calc(50% - 18px);top:8px;width:36px;height:36px;background:transparent;border:1px solid var(--accent-green);"></button>
            <button class="studio-part body selected-toggle" type="button" data-part="body" title="Body" style="position:absolute;left:calc(50% - 24px);top:52px;width:48px;height:68px;background:transparent;border:1px solid var(--accent-green);"></button>
            <button class="studio-part arm-left selected-toggle" type="button" data-part="leftArm" title="Left arm" style="position:absolute;left:calc(50% - 58px);top:54px;width:26px;height:66px;background:transparent;border:1px solid var(--accent-green);"></button>
            <button class="studio-part arm-right selected-toggle" type="button" data-part="rightArm" title="Right arm" style="position:absolute;left:calc(50% + 32px);top:54px;width:26px;height:66px;background:transparent;border:1px solid var(--accent-green);"></button>
            <button class="studio-part leg-left selected-toggle" type="button" data-part="leftLeg" title="Left leg" style="position:absolute;left:calc(50% - 22px);top:124px;width:18px;height:38px;background:transparent;border:1px solid var(--accent-green);"></button>
            <button class="studio-part leg-right selected-toggle" type="button" data-part="rightLeg" title="Right leg" style="position:absolute;left:calc(50% + 4px);top:124px;width:18px;height:38px;background:transparent;border:1px solid var(--accent-green);"></button>
          </div>
          <div style="display:flex;gap:5px;flex-wrap:wrap;">${['head','body','arms','legs'].map(part => `<button class="modal-btn selected-toggle" type="button" data-part-group="${part}">${part}</button>`).join('')}</div>
        </aside>
      </div>
    </div>`;
    document.body.appendChild(overlay);
    const model = overlay.querySelector('#studioModel'); if (model) model.value = state.model;
    wireUi(state, overlay);
    initializeStudioViewer(state, overlay);
  }

  async function initializeStudioViewer(state, overlay) {
    if (!window.skinview3d?.SkinViewer) return;
    const canvas = overlay.querySelector('#studioPreviewCanvas');
    state.viewer = new window.skinview3d.SkinViewer({ canvas, width: 280, height: 320 });
    state.viewer.background = 0x07090b; state.viewer.fov = 50; state.viewer.zoom = 1.05;
    if (window.skinview3d.WalkingAnimation) { state.viewer.animation = new window.skinview3d.WalkingAnimation(); state.viewer.animation.speed = 0.7; }
    if (state.kind === 'cape') {
      const current = await window.launcherAPI.getState();
      const account = current?.accounts?.find(item => item.id === current.activeAccountId);
      const skin = account?.cosmetics?.selected?.skin || account?.cosmetics?.skin || account?.cosmetics?.official?.skin;
      if (skin?.filePath) { const source = await window.launcherAPI.readCosmeticTexture(skin.filePath); if (source?.ok) await state.viewer.loadSkin(source.dataUrl); }
    }
    updateStudioPreview(state);
    window.setTimeout(() => {
      state.viewer.width = Math.max(280, canvas.clientWidth || 280);
      state.viewer.height = Math.max(320, canvas.clientHeight || 320);
      ensurePlayerVisible(state.viewer);
      if (window.attachStudio3DPainter && state.viewer) {
        state.detachPainter = window.attachStudio3DPainter(state.viewer, state.kind, (x, y, event) => {
          if (event.type === 'pointerdown') pushHistory(state);
          applyTool(state, x, y, x, y);
          draw(state);
          updateStudioPreview(state);
        }, () => { state.pointer = null; });
        state.detachPainter.refreshGrid?.();
      }
    }, 350);
  }

  function wireUi(state, overlay) {
    const canvas = overlay.querySelector('#studioCanvas');
    overlay.querySelectorAll('[data-tool]').forEach(button => button.addEventListener('click', () => { state.tool = button.dataset.tool; overlay.querySelectorAll('[data-tool]').forEach(item => item.classList.toggle('primary', item === button)); }));
    overlay.querySelector('#studioBrush').addEventListener('input', event => { state.brush = Number(event.target.value); });
    overlay.querySelector('#studioOpacity').addEventListener('input', event => { state.opacity = Number(event.target.value) / 100; });
    overlay.querySelector('#studioColor').addEventListener('input', event => { state.color = event.target.value; overlay.querySelector('#studioHex').value = event.target.value; });
    overlay.querySelector('#studioHex').addEventListener('change', event => { if (/^#[0-9a-f]{6}$/i.test(event.target.value)) { state.color = event.target.value; overlay.querySelector('#studioColor').value = state.color; } });
    overlay.querySelector('#studioGrid').addEventListener('change', event => { state.grid = event.target.checked; });
    overlay.querySelector('#studioModelGrid').addEventListener('change', event => { state.detachPainter?.setGrid?.(event.target.checked); });
    overlay.querySelector('#studioSymX').addEventListener('change', event => { state.symmetryX = event.target.checked; });
    overlay.querySelector('#studioSymY').addEventListener('change', event => { state.symmetryY = event.target.checked; });
    overlay.querySelector('#studioName').addEventListener('input', event => { state.name = event.target.value.slice(0, 120); state.dirty = true; updateSaveState(state); });
    overlay.querySelector('#studioModel')?.addEventListener('change', event => { state.model = event.target.value; state.previewReady = false; updateStudioPreview(state); });
    overlay.querySelectorAll('[data-pose]').forEach(button => button.addEventListener('click', () => applyPose(state, button.dataset.pose)));
    overlay.querySelectorAll('[data-layer]').forEach(button => button.addEventListener('click', () => toggleLayer(state, button)));
    overlay.querySelectorAll('[data-part]').forEach(button => button.addEventListener('click', () => toggleBodyPart(state, button.dataset.part, button)));
    overlay.querySelectorAll('[data-part-group]').forEach(button => button.addEventListener('click', () => togglePartGroup(state, button.dataset.partGroup, button)));
    overlay.querySelector('[data-studio-action="undo"]').addEventListener('click', () => undo(state));
    overlay.querySelector('[data-studio-action="redo"]').addEventListener('click', () => redo(state));
    overlay.querySelector('[data-studio-action="freeze"]').addEventListener('click', event => toggleMotion(state, event.currentTarget));
    overlay.querySelector('[data-tool="clear"]').addEventListener('click', () => clearPixels(state));
    overlay.querySelector('[data-studio-action="template"]').addEventListener('click', () => applyTemplate(state, overlay.querySelector('#studioTemplate').value));
    overlay.querySelector('[data-studio-action="import"]').addEventListener('click', () => importImage(state));
    overlay.querySelector('[data-studio-action="export"]').addEventListener('click', () => exportStudio(state));
    overlay.querySelector('[data-studio-action="save"]').addEventListener('click', () => saveStudio(state));
    overlay.querySelector('[data-studio-action="close"]').addEventListener('click', () => closeStudio(state));
    canvas.addEventListener('pointerdown', event => { state.pointer = { x: pixelAt(state, canvas, event).x, y: pixelAt(state, canvas, event).y }; pushHistory(state); applyTool(state, state.pointer.x, state.pointer.y, state.pointer.x, state.pointer.y); canvas.setPointerCapture(event.pointerId); });
    canvas.addEventListener('pointermove', event => { if (!state.pointer) return; const point = pixelAt(state, canvas, event); if (state.tool === 'pencil' || state.tool === 'eraser') applyTool(state, point.x, point.y, point.x, point.y); draw(state); });
    canvas.addEventListener('pointerup', event => { if (!state.pointer) return; const point = pixelAt(state, canvas, event); if (state.tool === 'line' || state.tool === 'rectangle') applyTool(state, state.pointer.x, state.pointer.y, point.x, point.y); state.pointer = null; draw(state); });
    canvas.addEventListener('wheel', event => { event.preventDefault(); state.zoom = Math.max(4, Math.min(20, state.zoom + (event.deltaY < 0 ? 1 : -1))); draw(state); }, { passive: false });
  }

  function applyPose(state, pose) {
    const viewer = state.viewer; if (!viewer) return;
    const skin = viewer.playerObject.skin;
    skin.resetJoints();
    if (pose === 'reset') { viewer.playerWrapper.rotation.set(0, 0, 0); viewer.resetCameraPose?.(); return; }
    viewer.playerWrapper.rotation.y = pose === 'back' ? Math.PI : pose === 'left' ? Math.PI / 2 : pose === 'right' ? -Math.PI / 2 : 0;
    if (pose === 'arms-out') { skin.leftArm.rotation.z = -Math.PI / 2; skin.rightArm.rotation.z = Math.PI / 2; }
    if (pose === 'arms-up') { skin.leftArm.rotation.z = -Math.PI / 2; skin.rightArm.rotation.z = Math.PI / 2; skin.leftArm.rotation.x = -0.35; skin.rightArm.rotation.x = -0.35; }
    if (pose === 'legs-separated') { skin.leftLeg.rotation.z = 0.18; skin.rightLeg.rotation.z = -0.18; }
  }

  function toggleLayer(state, button) {
    const skin = state.viewer?.playerObject?.skin; if (!skin) return;
    const active = button.dataset.active === 'true';
    setToggleVisual(button, !active);
    if (button.dataset.layer === 'inner') skin.setInnerLayerVisible(!active);
    else skin.setOuterLayerVisible(!active);
  }

  function setToggleVisual(button, active) {
    if (!button) return;
    button.dataset.active = String(active);
    button.style.borderColor = active ? 'var(--accent-green)' : 'var(--border)';
    button.style.background = active ? 'var(--accent-green-bg)' : 'var(--bg-surface)';
    button.style.color = active ? 'var(--accent-green-text-on-dark)' : 'var(--text-primary)';
  }

  function toggleBodyPart(state, part, button) {
    const skin = state.viewer?.playerObject?.skin; if (!skin) return;
    const target = skin[part]; if (!target) return;
    target.visible = !target.visible;
    setToggleVisual(button, target.visible);
  }

  function togglePartGroup(state, group, button) {
    const skin = state.viewer?.playerObject?.skin; if (!skin) return;
    const names = group === 'arms' ? ['leftArm', 'rightArm'] : group === 'legs' ? ['leftLeg', 'rightLeg'] : [group];
    const visible = names.some(name => skin[name]?.visible);
    names.forEach(name => { if (skin[name]) skin[name].visible = !visible; });
    setToggleVisual(button, !visible);
    names.forEach(name => setToggleVisual(document.querySelector(`[data-part="${name}"]`), !visible));
  }

  function toggleMotion(state, button) {
    if (!state.viewer) return;
    state.frozen = !state.frozen;
    if (state.frozen) {
      state.savedAnimation = state.viewer.animation;
      state.viewer.animation = null;
      button.textContent = 'Resume motion';
      button.style.borderColor = 'var(--accent-green)';
      button.style.color = 'var(--accent-green)';
    } else {
      state.viewer.animation = state.savedAnimation || (window.skinview3d?.WalkingAnimation ? new window.skinview3d.WalkingAnimation() : null);
      button.textContent = 'Freeze motion';
      button.style.borderColor = 'var(--border)';
      button.style.color = 'var(--text-primary)';
    }
  }

  function pixelAt(state, canvas, event) { const rect = canvas.getBoundingClientRect(); const scale = Math.min(rect.width / state.width, rect.height / state.height); return { x: Math.max(0, Math.min(state.width - 1, Math.floor((event.clientX - rect.left) / scale))), y: Math.max(0, Math.min(state.height - 1, Math.floor((event.clientY - rect.top) / scale))) }; }
  function colorBytes(hex, alpha) { return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16), Math.round(alpha * 255)]; }
  function setPixel(state, x, y, bytes) { if (x < 0 || y < 0 || x >= state.width || y >= state.height) return; const index = (y * state.width + x) * 4; state.pixels.set(bytes, index); }
  function getPixel(state, x, y) { const index = (y * state.width + x) * 4; return Array.from(state.pixels.slice(index, index + 4)); }
  function mirroredPoints(state, x, y) { const points = [[x, y]]; if (state.symmetryX) points.push([state.width - 1 - x, y]); if (state.symmetryY) points.push([x, state.height - 1 - y]); if (state.symmetryX && state.symmetryY) points.push([state.width - 1 - x, state.height - 1 - y]); return points; }
  function applyTool(state, x, y, endX, endY) {
    if (state.tool === 'fill') { floodFill(state, x, y); return; }
    if (state.tool === 'eyedropper') { const p = getPixel(state, x, y); state.color = `#${p.slice(0, 3).map(v => v.toString(16).padStart(2, '0')).join('')}`; document.getElementById('studioColor').value = state.color; document.getElementById('studioHex').value = state.color; return; }
    if (state.tool === 'line' || state.tool === 'rectangle') { rasterizeShape(state, x, y, endX, endY); state.dirty = true; updateSaveState(state); autosave(state); return; }
    const bytes = state.tool === 'eraser' ? [0, 0, 0, 0] : colorBytes(state.color, state.opacity);
    for (const [px, py] of mirroredPoints(state, x, y)) for (let dx = 0; dx < state.brush; dx += 1) for (let dy = 0; dy < state.brush; dy += 1) setPixel(state, px + dx, py + dy, bytes);
    state.dirty = true; updateSaveState(state); autosave(state);
  }
  function rasterizeShape(state, x0, y0, x1, y1) {
    const bytes = colorBytes(state.color, state.opacity);
    const paint = (x, y) => mirroredPoints(state, x, y).forEach(([px, py]) => setPixel(state, px, py, bytes));
    if (state.tool === 'rectangle') {
      for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x += 1) { paint(x, y0); paint(x, y1); }
      for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y += 1) { paint(x0, y); paint(x1, y); }
      return;
    }
    const dx = Math.abs(x1 - x0); const dy = Math.abs(y1 - y0); const sx = x0 < x1 ? 1 : -1; const sy = y0 < y1 ? 1 : -1; let error = dx - dy; let x = x0; let y = y0;
    while (true) { paint(x, y); if (x === x1 && y === y1) break; const twice = error * 2; if (twice > -dy) { error -= dy; x += sx; } if (twice < dx) { error += dx; y += sy; } }
  }
  function draw(state, shape = null) {
    const canvas = document.getElementById('studioCanvas'); if (!canvas) return; const context = canvas.getContext('2d'); const scale = Math.max(1, Math.floor(Math.min(canvas.width / state.width, canvas.height / state.height))); context.clearRect(0, 0, canvas.width, canvas.height); const image = context.createImageData(state.width, state.height); image.data.set(state.pixels); const source = document.createElement('canvas'); source.width = state.width; source.height = state.height; source.getContext('2d').putImageData(image, 0, 0); context.imageSmoothingEnabled = false; context.drawImage(source, 0, 0, state.width * scale, state.height * scale); if (state.grid && scale >= 2) { context.strokeStyle = 'rgba(255,255,255,.38)'; context.lineWidth = 1; for (let x = 0; x <= state.width; x += 1) { context.beginPath(); context.moveTo(x * scale + .5, 0); context.lineTo(x * scale + .5, state.height * scale); context.stroke(); } for (let y = 0; y <= state.height; y += 1) { context.beginPath(); context.moveTo(0, y * scale + .5); context.lineTo(state.width * scale, y * scale + .5); context.stroke(); } } if (shape) drawShapePreview(state, shape, context, scale); updateStudioPreview(state); }
  function drawShapePreview(state, shape, context, scale) { const [x0, y0, x1, y1] = shape; context.strokeStyle = state.color; context.lineWidth = Math.max(1, state.brush); if (state.tool === 'rectangle') context.strokeRect(Math.min(x0, x1) * scale, Math.min(y0, y1) * scale, (Math.abs(x1 - x0) + 1) * scale, (Math.abs(y1 - y0) + 1) * scale); else { context.beginPath(); context.moveTo(x0 * scale + scale / 2, y0 * scale + scale / 2); context.lineTo(x1 * scale + scale / 2, y1 * scale + scale / 2); context.stroke(); } }
  function floodFill(state, x, y) { const target = getPixel(state, x, y); const fill = colorBytes(state.color, state.opacity); if (target.every((value, index) => value === fill[index])) return; const queue = [[x, y]]; const seen = new Set(); while (queue.length) { const [px, py] = queue.pop(); const key = `${px}:${py}`; if (seen.has(key) || px < 0 || py < 0 || px >= state.width || py >= state.height) continue; seen.add(key); if (!getPixel(state, px, py).every((value, index) => value === target[index])) continue; setPixel(state, px, py, fill); queue.push([px + 1, py], [px - 1, py], [px, py + 1], [px, py - 1]); } state.dirty = true; updateSaveState(state); autosave(state); draw(state); }
  function pushHistory(state) { state.undo.push(new Uint8ClampedArray(state.pixels)); if (state.undo.length > MAX_HISTORY) state.undo.shift(); state.redo = []; }
  function undo(state) { if (!state.undo.length) return; state.redo.push(new Uint8ClampedArray(state.pixels)); state.pixels = state.undo.pop(); state.dirty = true; draw(state); autosave(state); }
  function redo(state) { if (!state.redo.length) return; state.undo.push(new Uint8ClampedArray(state.pixels)); state.pixels = state.redo.pop(); state.dirty = true; draw(state); autosave(state); }
  function clearPixels(state) { pushHistory(state); state.pixels.fill(0); state.dirty = true; draw(state); autosave(state); }
  function applyTemplate(state, template) { pushHistory(state); state.pixels.fill(0); const set = (x, y, w, h, color) => { for (let py = y; py < y + h; py++) for (let px = x; px < x + w; px++) setPixel(state, px, py, colorBytes(color, 1)); }; if (state.kind === 'skin') { set(8, 8, 8, 8, '#e0a37b'); set(20, 20, 8, 12, template === 'hoodie' ? '#375a9e' : '#6c9d45'); set(4, 20, 4, 12, '#6c9d45'); set(20, 52, 4, 12, '#29304f'); set(4, 52, 4, 12, '#29304f'); if (template === 'hoodie') set(20, 16, 8, 4, '#253c73'); } else { for (let y = 0; y < 32; y++) for (let x = 0; x < 64; x++) if (template === 'checker' ? ((x + y) % 2 === 0) : template === 'stripes' ? x % 8 < 4 : false) setPixel(state, x, y, colorBytes(y < 16 ? '#72e64b' : '#245d36', 1)); } state.dirty = true; draw(state); autosave(state); }
  async function loadAssetImage(state, filePath) { const result = await window.launcherAPI.readCosmeticTexture(filePath); if (!result?.ok) return; const image = new Image(); image.onload = () => { const canvas = document.getElementById('studioCanvas'); const context = canvas.getContext('2d'); context.clearRect(0, 0, canvas.width, canvas.height); context.drawImage(image, 0, 0, state.width, state.height); const data = context.getImageData(0, 0, state.width, state.height); state.pixels = new Uint8ClampedArray(data.data); draw(state); }; image.src = result.dataUrl; }
  function getCleanDataUrl(state) {
    const source = document.createElement('canvas');
    source.width = state.width; source.height = state.height;
    source.getContext('2d').putImageData(new ImageData(state.pixels, state.width, state.height), 0, 0);
    return source.toDataURL('image/png');
  }
  function getPreviewDataUrl(state) {
    return getCleanDataUrl(state);
  }
  function updateViewerTexture(state) {
    const viewer = state.viewer;
    if (!viewer || !state.previewReady) return false;
    const target = state.kind === 'cape' ? viewer.capeCanvas : viewer.skinCanvas;
    const map = state.kind === 'cape' ? viewer.playerObject.cape.map : viewer.playerObject.skin.map;
    if (!target || !map) return false;
    const image = new ImageData(new Uint8ClampedArray(state.pixels), state.width, state.height);
    target.getContext('2d').putImageData(image, 0, 0);
    map.needsUpdate = true;
    viewer.render();
    return true;
  }
  function ensurePlayerVisible(viewer) {
    const skin = viewer?.playerObject?.skin;
    if (!skin) return;
    [skin.layer1Material, skin.layer1MaterialBiased].forEach(material => {
      if (!material) return;
      material.transparent = true;
      material.alphaTest = 0.01;
      material.depthWrite = true;
      material.needsUpdate = true;
    });
    skin.visible = true;
    viewer.playerObject.visible = true;
    viewer.playerWrapper.visible = true;
    viewer.render();
  }
  function updateStudioPreview(state) {
    if (updateViewerTexture(state)) return;
    if (state.previewTimer) window.clearTimeout(state.previewTimer);
    state.previewTimer = window.setTimeout(async () => {
      const viewer = state.viewer; if (!viewer) return;
      const dataUrl = getPreviewDataUrl(state);
      if (state.kind === 'cape') await viewer.loadCape(dataUrl);
      else await viewer.loadSkin(dataUrl, { model: state.model === 'slim' ? 'slim' : 'default', makeVisible: true });
      state.previewReady = true;
      ensurePlayerVisible(viewer);
      state.detachPainter?.refreshGrid?.();
    }, 80);
  }
  async function importImage(state) { const input = document.createElement('input'); input.type = 'file'; input.accept = 'image/png'; input.onchange = () => { const file = input.files?.[0]; if (!file) return; const image = new Image(); image.onload = () => { if (image.width !== state.width || image.height !== state.height) { alert(`Expected a ${state.width}x${state.height} PNG.`); return; } const canvas = document.getElementById('studioCanvas'); const context = canvas.getContext('2d'); context.clearRect(0, 0, canvas.width, canvas.height); context.drawImage(image, 0, 0, state.width, state.height); state.pixels = new Uint8ClampedArray(context.getImageData(0, 0, state.width, state.height).data); state.dirty = true; draw(state); }; image.src = URL.createObjectURL(file); }; input.click(); }
  async function saveStudio(state) { const currentState = await window.launcherAPI.getState(); const result = await window.launcherAPI.saveCreatedCosmetic({ kind: state.kind, dataUrl: getCleanDataUrl(state), name: state.name || `My ${state.kind}`, model: state.model, accountId: currentState?.activeAccountId || null, parentId: state.asset?.id || null, version: Number(state.asset?.version || 0) + 1 }); if (!result?.ok) { alert(result?.error || 'Could not save studio asset.'); return; } state.asset = result.asset; state.dirty = false; updateSaveState(state); if (window.refreshLauncherState) await window.refreshLauncherState(); }
  async function exportStudio(state) { if (!state.asset) { await saveStudio(state); } if (state.asset?.filePath) await window.launcherAPI.exportCreatedCosmetic({ filePath: state.asset.filePath, name: state.name }); }
  function autosave(state) { try { const canvas = document.getElementById('studioCanvas'); localStorage.setItem(`${DRAFT_PREFIX}${state.kind}`, JSON.stringify({ name: state.name, model: state.model, width: state.width, height: state.height, pixels: Array.from(state.pixels), savedAt: Date.now() })); } catch (_error) {} }
  function restoreDraft(state) { try { const draft = JSON.parse(localStorage.getItem(`${DRAFT_PREFIX}${state.kind}`) || 'null'); if (!draft || !Array.isArray(draft.pixels) || draft.width !== state.width || draft.height !== state.height) return; if (confirm(`Restore autosaved ${state.kind} draft from ${new Date(draft.savedAt).toLocaleString()}?`)) { state.pixels = new Uint8ClampedArray(draft.pixels); state.name = draft.name || state.name; state.model = draft.model || state.model; state.dirty = true; } } catch (_error) {} }
  function updateSaveState(state) { const node = document.getElementById('studioSaveState'); if (node) node.textContent = state.dirty ? 'Unsaved changes · autosaved draft' : 'Saved'; }
  function closeStudio(state) { if (state.dirty && !confirm('Discard unsaved studio changes?')) return; state.detachPainter?.dispose?.(); state.viewer?.dispose(); document.getElementById('cosmeticStudioModal')?.remove(); active = null; }
  function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char])); }
  window.openCosmeticStudio = (kind, asset = null) => createStudio(kind, asset);
  document.querySelectorAll('[data-open-cosmetic-studio]').forEach(button => {
    button.addEventListener('click', () => createStudio(button.dataset.openCosmeticStudio));
  });
})();
