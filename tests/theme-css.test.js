'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { generateThemeCss } = require('../src/shared/theme-css');

test('generates live theme tokens and component styles from customization values', () => {
  const css = generateThemeCss({
    colors: { bgVoid: '#123456', accentGreen: '#abcdef' },
    typography: { fontSizeMd: '15px' },
    sidebar: { width: '80px' },
    buttons: { height: '42px' },
  });

  assert.match(css, /--bg-void: #123456;/);
  assert.match(css, /--accent-green: #abcdef;/);
  assert.match(css, /--text-md: 15px;/);
  assert.match(css, /--sidebar-width: 80px;/);
  assert.match(css, /--button-height: 42px;/);
  assert.match(css, /\.sidebar-nav-item\.on/);
  assert.match(css, /\.modal-btn, \.app-btn/);
});

test('rejects invalid CSS values in editable theme fields', () => {
  const css = generateThemeCss({
    colors: { bgVoid: '#123456; body { display:none }' },
    typography: { fontSizeMd: '12px; display:none' },
    sidebar: { width: 'url(https://invalid)' },
  });

  assert.match(css, /--bg-void: #0a0a0a;/);
  assert.match(css, /--text-md: 13px;/);
  assert.match(css, /--sidebar-width: 64px;/);
  assert.doesNotMatch(css, /display:none/);
});

test('applies valid gradient and reduced-motion settings', () => {
  const css = generateThemeCss({
    background: { type: 'gradient', gradient: 'linear-gradient(90deg, #000000, #ffffff)' },
    effects: { reducedMotion: true },
  });

  assert.match(css, /background-image: linear-gradient\(90deg, #000000, #ffffff\)/);
  assert.match(css, /transition-duration: 0\.01ms !important/);
});
