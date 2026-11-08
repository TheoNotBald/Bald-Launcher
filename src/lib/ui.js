(function () {
  'use strict';

  const api = window.launcherAPI;
  if (!api || document.getElementById('panel-library')) return;

  const style = document.createElement('style');
  style.textContent = `
    #panel-settings { position: relative; }
    #lib-hitbox { position: absolute; inset-inline-end: 0; inset-block-end: 0; width: 24px; height: 24px;
      background: transparent; border: 0; padding: 0; margin: 0; cursor: pointer; z-index: 5; outline: none; }
    .lib-version-row { margin-top: auto; padding: 10px 18px; font-size: 11px; opacity: .45; text-align: end; }
    #panel-library { flex-direction: column; gap: 12px; padding: 22px; overflow-y: auto; }
    .lib-head { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; }
    .lib-title { font-size: 15px; font-weight: 600; }
    .lib-sub { font-size: 11px; opacity: .5; }
    .lib-row { display: flex; justify-content: space-between; align-items: center; gap: 12px;
      padding: 10px 14px; border: 1px solid var(--ui-border); border-radius: var(--ui-radius-small); }
    .lib-meta { font-size: 11px; opacity: .5; }
    .lib-meta.bad { opacity: .8; color: #e05a5a; }
  `;
  document.head.appendChild(style);

  const panel = document.createElement('div');
  panel.className = 'panel';
  panel.id = 'panel-library';
  panel.style.display = 'none';
  panel.innerHTML = '<div class="lib-head"><div class="lib-title">Library</div><div class="lib-sub" id="lib-version"></div></div><div id="lib-list"></div>';
  document.querySelector('.body')?.appendChild(panel);

  const original = window.showPanel;
  window.showPanel = function (name) {
    const result = typeof original === 'function' ? original.apply(this, arguments) : undefined;
    panel.style.display = name === 'library' ? 'flex' : 'none';
    if (name === 'library') render();
    return result;
  };

  async function render() {
    const state = await api.getState();
    const ids = (state?.profiles || []).map(profile => profile.id);
    const status = await api.getLibStatus(ids);
    document.getElementById('lib-version').textContent = `v${status.version}`;
    const list = document.getElementById('lib-list');
    list.innerHTML = '';
    if (!ids.length) {
      list.innerHTML = '<div class="lib-sub">No profiles.</div>';
      return;
    }
    for (const profile of state.profiles) {
      const row = document.createElement('div');
      row.className = 'lib-row';
      const info = status.profiles[profile.id] || {};
      const label = document.createElement('div');
      label.innerHTML = `<div>${profile.name}</div><div class="lib-meta ${info.fabric && info.vanilla ? '' : 'bad'}">${info.fabric && info.vanilla ? 'artifacts ready' : 'artifact missing'}</div>`;
      const toggle = document.createElement('label');
      toggle.className = 'li-toggle';
      toggle.innerHTML = `<input type="checkbox" ${info.enabled ? 'checked' : ''}><span class="li-toggle-slider"></span>`;
      const input = toggle.querySelector('input');
      const loader = String(profile.loader || 'vanilla').toLowerCase();
      const artifactAvailable = loader === 'fabric' || loader === 'quilt' ? info.fabric : info.vanilla;
      input.disabled = !artifactAvailable && !info.enabled;
      input.title = artifactAvailable ? 'Enable or disable the library agent' : 'The library agent has not been built for this loader.';
      input.addEventListener('change', async event => {
        await api.setLibProfile(profile.id, event.target.checked);
      });
      row.append(label, toggle);
      list.appendChild(row);
    }
  }

  const settings = document.getElementById('panel-settings');
  if (settings) {
    const footer = document.createElement('div');
    footer.className = 'lib-version-row';
    footer.textContent = '';
    settings.appendChild(footer);
    api.getLibStatus([]).then(status => { footer.textContent = `v${status.version}`; });

    const hitbox = document.createElement('button');
    hitbox.id = 'lib-hitbox';
    hitbox.type = 'button';
    hitbox.setAttribute('aria-label', 'Open library');
    hitbox.title = 'Open library';
    settings.appendChild(hitbox);
    hitbox.addEventListener('click', () => window.showPanel('library'));
  }
})();
