'use strict';

const colorPattern = /^(#[\da-f]{3,8}|rgba?\([\d.%\s,]+\)|hsla?\([\d.%\s,deg]+\)|var\(--[\da-z-]+\))$/i;
const sizePattern = /^-?(?:\d+(?:\.\d+)?|\.\d+)(?:px|rem|em|%|vw|vh|vmin|vmax)?$/i;
const shadowPattern = /^[\w\s#.,()%+-]{1,160}$/;
const fontPattern = /^[\w\s,'"-]{1,160}$/;

function safe(value, fallback, pattern) {
  const candidate = String(value ?? '').trim();
  return candidate && candidate.length <= 180 && pattern.test(candidate) ? candidate : fallback;
}

function color(value, fallback) {
  return safe(value, fallback, colorPattern);
}

function size(value, fallback) {
  return safe(value, fallback, sizePattern);
}

function percent(value, fallback, min, max) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function generateThemeCss(theme = {}) {
  const colors = theme.colors || {};
  const typography = theme.typography || {};
  const spacing = theme.spacing || {};
  const borders = theme.borders || {};
  const background = theme.background || {};
  const corners = theme.corners || {};
  const shadows = theme.shadows || {};
  const effects = theme.effects || {};
  const sidebar = theme.sidebar || {};
  const buttons = theme.buttons || {};
  const cards = theme.cards || {};
  const inputs = theme.inputs || {};
  const modals = theme.modals || {};

  const values = {
    '--bg-void': color(colors.bgVoid, '#0a0a0a'),
    '--bg-surface': color(colors.bgSurface, '#111111'),
    '--bg-surface-2': color(colors.bgSurface2, '#161616'),
    '--border': color(colors.border, '#1e1e1e'),
    '--border-strong': color(colors.borderStrong, '#2a2a2a'),
    '--accent-green': color(colors.accentGreen, '#7ef15e'),
    '--accent-green-bg': color(colors.accentGreenBg, '#2d6e1a'),
    '--accent-green-bg-hover': color(colors.accentGreenBgHover, '#357a1e'),
    '--accent-green-text-on-dark': color(colors.accentGreenText, '#d4f0c4'),
    '--accent-purple': color(colors.accentPurple, '#7f77dd'),
    '--accent-purple-bg': color(colors.accentPurpleBg, '#221c47'),
    '--text-primary': color(colors.textPrimary, '#cccccc'),
    '--text-secondary': color(colors.textSecondary, '#a1aab4'),
    '--text-muted': color(colors.textMuted, '#77818c'),
    '--bg-sidebar': color(sidebar.background || colors.bgSidebar, '#0f1317'),
    '--bg-header': color(colors.bgHeader, '#0a0a0a'),
    '--bg-card': color(cards.background || colors.bgCard, '#111111'),
    '--bg-card-hover': color(cards.hover || colors.bgCardHover, '#1a2128'),
    '--bg-selected': color(cards.selected || colors.bgSelected, '#18251a'),
    '--bg-input': color(inputs.background || colors.bgInput, '#161616'),
    '--input-focus': color(inputs.focus || colors.inputFocus, '#7ef15e'),
    '--accent-primary-hover': color(colors.accentPrimaryHover, '#91f270'),
    '--accent-secondary-hover': color(colors.accentSecondaryHover, '#aaa3ff'),
    '--status-success': color(colors.success, '#78e35a'),
    '--status-warning': color(colors.warning, '#e5b84e'),
    '--status-error': color(colors.error, '#f06a6a'),
    '--status-info': color(colors.info, '#69b9ee'),
    '--play-button': color(colors.playButton, '#2d6e1a'),
    '--browse-button': color(colors.browseButton, '#221c47'),
    '--download-button': color(colors.downloadButton, '#2d6e1a'),
    '--danger-button': color(colors.dangerButton, '#7f1d1d'),
    '--scrollbar': color(colors.scrollbar, '#35424e'),
    '--notification': color(colors.notification, '#f06a6a'),
    '--text-xs': size(typography.fontSizeXs, '10px'),
    '--text-sm': size(typography.fontSizeSm, '11px'),
    '--text-base': size(typography.fontSizeBase, '12px'),
    '--text-md': size(typography.fontSizeMd, '13px'),
    '--text-lg': size(typography.fontSizeLg, '14px'),
    '--text-xl': size(typography.fontSizeXl, '16px'),
    '--font-sans': safe(typography.fontFamily, 'system-ui, -apple-system, sans-serif', fontPattern),
    '--font-weight': safe(typography.fontWeight, '400', /^\d{1,4}$/),
    '--heading-weight': safe(typography.headingWeight, '650', /^\d{1,4}$/),
    '--letter-spacing': size(typography.letterSpacing, '0px'),
    '--line-height': safe(typography.lineHeight, '1.45', /^(?:\d+(?:\.\d+)?|\d+(?:\.\d+)?(?:px|em|rem|%)?)$/),
    '--p-small': size(spacing.paddingSmall, '8px'),
    '--p-base': size(spacing.paddingBase, '12px'),
    '--p-large': size(spacing.paddingLarge, '16px'),
    '--gap-small': size(spacing.gapSmall, '4px'),
    '--gap-base': size(spacing.gapBase, '8px'),
    '--gap-large': size(spacing.gapLarge, '14px'),
    '--radius-small': size(borders.radiusSmall, '6px'),
    '--radius-base': size(borders.radiusBase, '8px'),
    '--radius-md': size(borders.radiusMd, '12px'),
    '--border-width': size(borders.borderWidth, '0.5px'),
    '--ui-bg': 'var(--bg-void)',
    '--ui-bg-secondary': 'var(--bg-surface)',
    '--ui-bg-tertiary': 'var(--bg-surface-2)',
    '--ui-surface': 'var(--bg-surface)',
    '--ui-surface-hover': 'var(--bg-card-hover)',
    '--ui-surface-selected': 'var(--bg-selected)',
    '--ui-border': 'var(--border)',
    '--ui-border-strong': 'var(--border-strong)',
    '--ui-primary': 'var(--accent-green)',
    '--ui-primary-hover': 'var(--accent-primary-hover)',
    '--ui-secondary': 'var(--accent-purple)',
    '--ui-secondary-hover': 'var(--accent-secondary-hover)',
    '--ui-text': 'var(--text-primary)',
    '--ui-text-secondary': 'var(--text-secondary)',
    '--ui-text-muted': 'var(--text-muted)',
    '--ui-success': 'var(--status-success)',
    '--ui-warning': 'var(--status-warning)',
    '--ui-error': 'var(--status-error)',
    '--ui-info': 'var(--status-info)',
    '--ui-space-xs': size(spacing.gapSmall, '4px'),
    '--ui-space-sm': size(spacing.paddingSmall, '8px'),
    '--ui-space-md': size(spacing.paddingBase, '12px'),
    '--ui-space-lg': size(spacing.paddingLarge, '16px'),
    '--ui-space-xl': size(spacing.spacious, '24px'),
    '--ui-radius-small': size(corners.input || inputs.radius, '6px'),
    '--ui-radius-medium': size(corners.card || cards.radius, '9px'),
    '--ui-radius-large': size(corners.modal || modals.radius, '12px'),
    '--ui-radius-pill': '999px',
    '--ui-shadow-small': shadows.small && shadowPattern.test(shadows.small) ? shadows.small : '0 2px 8px rgba(0,0,0,.22)',
    '--ui-shadow-medium': shadows.medium && shadowPattern.test(shadows.medium) ? shadows.medium : '0 8px 24px rgba(0,0,0,.3)',
    '--ui-shadow-large': shadows.large && shadowPattern.test(shadows.large) ? shadows.large : '0 18px 48px rgba(0,0,0,.4)',
    '--ui-transition-fast': `${percent(effects.transitionSpeed, 180, 0, 1000)}ms ease`,
    '--ui-transition-normal': `${percent(effects.transitionSpeed, 180, 0, 1000)}ms ease`,
    '--ui-transition-slow': `${percent(effects.transitionSpeed, 180, 0, 1000) * 1.5}ms ease`,
    '--sidebar-width': size(sidebar.width, '64px'),
    '--sidebar-icon-size': size(sidebar.iconSize, '20px'),
    '--sidebar-radius': size(sidebar.radius, '10px'),
    '--button-radius': size(buttons.radius || corners.button, '8px'),
    '--button-height': size(buttons.height, '36px'),
    '--button-weight': safe(buttons.weight, '600', /^\d{1,4}$/),
    '--card-radius': size(cards.radius || corners.card, '9px'),
    '--card-opacity': `${percent(cards.opacity ?? effects.cardOpacity, 100, 30, 100)}%`,
    '--input-radius': size(inputs.radius || corners.input, '6px'),
    '--modal-radius': size(modals.radius || corners.modal, '12px'),
    '--modal-background': color(modals.background, '#111111'),
  };

  const declarations = Object.entries(values).map(([name, value]) => `  ${name}: ${value};`).join('\n');
  const backgroundImage = background.type === 'gradient'
    ? safe(background.gradient, 'linear-gradient(135deg, #0a0a0a, #161616)', /^linear-gradient\([a-z\d\s#.,%()+-]{1,180}\)$/i)
    : background.type === 'image' && /^https:\/\/[^"'()\\\s]{1,500}$/i.test(background.image || '')
      ? `url("${background.image}")`
      : 'none';
  const borderStyle = ['solid', 'dashed', 'dotted', 'double'].includes(borders.style) ? borders.style : 'solid';
  const shadow = effects.shadowEnabled === false || cards.shadow === false ? 'none' : 'var(--ui-shadow-small)';
  const customCss = typeof theme.advanced?.customCss === 'string' ? theme.advanced.customCss.slice(0, 12000) : '';

  return `:root {\n${declarations}\n}\n` +
    `body { font-family: var(--font-sans); font-size: var(--text-md); font-weight: var(--font-weight); line-height: var(--line-height); letter-spacing: ${values['--letter-spacing']}; }\n` +
    `.app { background-color: var(--bg-void); border-radius: ${size(corners.modal, '12px')}; }\n` +
    `.titlebar { background: linear-gradient(180deg, var(--bg-header), var(--bg-void)); border-color: var(--border); }\n` +
    `.sidebar { width: var(--sidebar-width) !important; background: ${color(sidebar.background || colors.bgSidebar, '#0f1317')} !important; border-color: ${color(sidebar.border, '#26303a')} !important; gap: ${size(sidebar.spacing, '6px')} !important; }\n` +
    `.sidebar-nav-item { border-radius: var(--sidebar-radius); font-size: var(--sidebar-icon-size); }\n` +
    `.sidebar-nav-item:hover { background: ${color(sidebar.hoverBackground, '#1a2128')} !important; color: ${color(sidebar.hoverText, '#e5e9ed')} !important; }\n` +
    `.sidebar-nav-item.on, .sidebar-nav-item[aria-current="page"] { background: ${color(sidebar.selectedBackground, '#18251a')} !important; color: ${color(sidebar.selectedText, '#78e35a')} !important; }\n` +
    `.profile-card, .settings-section, .server-card, .mod-card { background: color-mix(in srgb, var(--bg-card) var(--card-opacity), transparent); border-radius: var(--card-radius); border-style: ${borderStyle}; border-width: ${values['--border-width']}; box-shadow: ${shadow}; }\n` +
    `.profile-card:hover, .server-card:hover, .mod-card:hover { background: var(--bg-card-hover); transform: translateY(-${percent(effects.hoverLift, 1, 0, 6)}px); }\n` +
    `.profile-card.selected, .profile-card.active, .sidebar-nav-item.on { background-color: var(--bg-selected); }\n` +
    `.modal-btn, .app-btn, .server-mini-btn, .add-content-btn, .server-console-send { min-height: var(--button-height); border-radius: var(--button-radius); font-weight: var(--button-weight); }\n` +
    `.setting-input, .setting-select, .modal-input, .modal-select, input:not([type="color"]):not([type="checkbox"]):not([type="range"]), select, textarea { background-color: var(--bg-input); border-color: ${color(inputs.border, '#35424e')}; border-radius: var(--input-radius); color: var(--text-primary); }\n` +
    `:focus-visible, .setting-input:focus, .setting-select:focus, .modal-input:focus, .modal-select:focus, input:focus, select:focus, textarea:focus { outline-color: ${color(inputs.focus || colors.inputFocus, '#7ef15e')}; }\n` +
    `.modal-overlay { backdrop-filter: blur(${percent(modals.blur, 4, 0, 24)}px); }\n` +
    `.modal-box, [role="dialog"] { background-color: color-mix(in srgb, var(--modal-background) ${percent(modals.opacity, 100, 40, 100)}%, transparent); border-radius: var(--modal-radius); box-shadow: ${modals.shadow === false ? 'none' : 'var(--ui-shadow-large)'}; }\n` +
    `.app::-webkit-scrollbar-thumb, *::-webkit-scrollbar-thumb { background-color: ${color(colors.scrollbar, '#35424e')}; }\n` +
    (backgroundImage !== 'none' ? `.app { background-image: ${backgroundImage}; background-size: ${background.fit === 'contain' ? 'contain' : background.fit === 'fill' ? '100% 100%' : 'cover'}; background-position: center; background-repeat: no-repeat; }\n` : '') +
    (effects.reducedMotion === true ? `*, *::before, *::after { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; scroll-behavior: auto !important; }\n` : '') +
    customCss;
}

module.exports = { generateThemeCss };
