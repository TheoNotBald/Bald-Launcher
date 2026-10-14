const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'bald_launcher_v7.html'), 'utf8').replace(/\r\n/g, '\n');

test('profile cards render profile-supplied text as escaped text', () => {
  const start = html.indexOf('function renderProfileGrid(){');
  const end = html.indexOf('\n// ---------------- New profile modal', start);
  assert.ok(start >= 0 && end > start, 'profile grid renderer should exist');
  const source = html.slice(start, end);
  const grid = { innerHTML: '' };
  const count = { textContent: '' };
  const context = {
    state: {
      profiles: [{
        id: 'profile-qa',
        name: '<img src=x onerror=window.name=1>',
        icon: '<svg/onload=window.name=2>',
        mcVersion: '<img src=y>',
        loader: 'vanilla',
        rendererMode: 'vanilla',
      }],
    },
    document: {
      getElementById(id) {
        if (id === 'profileGrid') return grid;
        if (id === 'profileCount') return count;
        return { value: '' };
      },
    },
    escapeHtml(value) {
      return String(value).replace(/[&<>"']/g, character => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[character]);
    },
    escapeJsString(value) {
      return String(value || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n');
    },
    capitalize: value => String(value).charAt(0).toUpperCase() + String(value).slice(1),
    badgeClass: () => 'vanilla',
    badgeLabel: () => 'Vanilla',
    profileModeLabel: profile => profile.optimizationKind === 'vanilla-fallback'
      ? 'True Vanilla'
      : profile.optimizationKind === 'sodium'
        ? 'Optimized Fabric · Sodium'
        : 'Vanilla',
  };
  vm.runInNewContext(`${source}\nrenderProfileGrid();`, context);

  assert.match(grid.innerHTML, /&lt;img src=x onerror=window\.name=1&gt;/);
  assert.match(grid.innerHTML, /&lt;svg\/onload=window\.name=2&gt;/);
  assert.match(grid.innerHTML, /&lt;img src=y&gt;/);
  assert.doesNotMatch(grid.innerHTML, /<img src=/);
  assert.equal(count.textContent, '1 of 1 profile');
});

test('server cards render server-supplied text as escaped text', () => {
  const start = html.indexOf('function renderServers(){');
  const end = html.indexOf('\nfunction openNewServerModal(', start);
  assert.ok(start >= 0 && end > start, 'server list renderer should exist');
  const source = html.slice(start, end);
  const list = { innerHTML: '' };
  const context = {
    state: {
      servers: [{
        id: 'server-qa',
        name: '<img src=x onerror=window.name=1>',
        mcVersion: '<img src=y>',
        serverType: '<svg/onload=window.name=2>',
        status: 'idle',
      }],
    },
    document: { getElementById: id => id === 'serverList' ? list : null },
    escapeHtml(value) {
      return String(value).replace(/[&<>"']/g, character => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[character]);
    },
    escapeJsString(value) {
      return String(value || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n');
    },
  };
  vm.runInNewContext(`${source}\nrenderServers();`, context);

  assert.match(list.innerHTML, /&lt;img src=x onerror=window\.name=1&gt;/);
  assert.match(list.innerHTML, /&lt;img src=y&gt;/);
  assert.match(list.innerHTML, /&lt;SVG\/ONLOAD=WINDOW\.NAME=2&gt;/);
  assert.doesNotMatch(list.innerHTML, /<img src=/);
  assert.doesNotMatch(list.innerHTML, /<svg\/onload=/);
});

test('account cards escape identity text, colors, and inline action IDs', () => {
  const start = html.indexOf('function renderAccounts(){');
  const end = html.indexOf('\nfunction getActiveAccount(', start);
  assert.ok(start >= 0 && end > start, 'account list renderer should exist');
  const source = html.slice(start, end);
  const elements = new Map([
    ['accountList', { innerHTML: '' }],
    ['acc-active-av', { style: {}, textContent: '' }],
    ['acc-active-name', { textContent: '' }],
    ['acc-active-type', { textContent: '' }],
    ['titlebarAv', { textContent: '' }],
    ['titlebarName', { textContent: '' }],
  ]);
  const context = {
    state: {
      activeAccountId: 'active',
      accounts: [
        {
          id: `qa' );window.name=3;//`,
          name: '<img src=x onerror=window.name=1>',
          type: '<svg/onload=window.name=2>',
          initials: '<img src=y>',
          accent: 'red" onmouseover="window.name=4',
          fg: 'blue',
        },
        { id: 'active', name: 'Active', type: 'Offline', initials: 'A', accent: '#000', fg: '#fff' },
      ],
    },
    document: { getElementById: id => elements.get(id) },
    escapeHtml(value) {
      return String(value).replace(/[&<>"']/g, character => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[character]);
    },
    escapeJsString(value) {
      return String(value || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n');
    },
    renderCosmeticsPanel() {},
  };
  vm.runInNewContext(`${source}\nrenderAccounts();`, context);
  const markup = elements.get('accountList').innerHTML;

  assert.match(markup, /&lt;img src=x onerror=window\.name=1&gt;/);
  assert.match(markup, /&lt;svg\/onload=window\.name=2&gt;/);
  assert.match(markup, /&lt;img src=y&gt;/);
  assert.match(markup, /red&quot; onmouseover=&quot;window\.name=4/);
  assert.match(markup, /qa\\&#39; \);window\.name=3;\/\//);
  assert.doesNotMatch(markup, /<img src=/);
  assert.doesNotMatch(markup, /<svg\/onload=/);
});
