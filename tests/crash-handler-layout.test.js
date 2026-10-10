const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const htmlPath = path.join(__dirname, '..', 'bald_launcher_v7.html');
const html = fs.readFileSync(htmlPath, 'utf8');

test('server crash handler is a sibling tab panel, not nested inside Playit', () => {
  const playitStart = html.indexOf('<div class="server-playit-panel" id="serverPlayitPanel">');
  const crashStart = html.indexOf('<div class="server-crash-handler-panel crash-resolver-panel" id="serverCrashHandlerPanel">');
  assert.notEqual(playitStart, -1);
  assert.notEqual(crashStart, -1);
  const boundary = html.slice(playitStart, crashStart);
  assert.match(boundary, /<\/div>\s*<\/div>\s*$/);
  assert.ok(crashStart > playitStart);
  assert.match(html.slice(crashStart), /<\/div>\s*<\/div>\s*<\/div>\s*<\/div>\s*<div class="panel" id="panel-performance"/);
});

test('server crash tab toggles its panel and runs analysis for the selected server', () => {
  assert.match(html, /document\.getElementById\('serverCrashHandlerPanel'\)\.classList\.toggle\('active', tab === 'crash-handler'\)/);
  assert.match(html, /if \(tab === 'crash-handler'\) renderServerCrashAnalysis\(\)/);
  assert.match(html, /analyzeServerCrash\(serverId\)/);
});

test('generic error totals are presented as context rather than a root-cause diagnosis', () => {
  assert.match(html, /item\.kind === 'context'/);
  assert.match(html, /log context, not a root-cause match/);
  assert.match(html, /matching lines/);
  assert.match(html, /item\.logPatterns/);
});

test('actionable findings jump to the exact validated log line in the in-app viewer', () => {
  assert.match(html, /class="crash-evidence crash-evidence-clickable"/);
  assert.match(html, /data-byte-offset="\$\{item\.byteOffset\}"/);
  assert.match(html, /openCrashEvidence\(\{ \.\.\.target, sourceId, byteOffset, expectedLine:/);
  assert.match(html, /scrollIntoView\(\{ block: 'center' \}\)/);
  assert.match(html, /id="crashEvidenceTargetLine"/);
});

test('crash evidence viewer uses a large viewport-bounded dialog and readable log text', () => {
  assert.match(html, /#crashEvidenceModal \.modal-box\.wide\{[^}]*width:min\(96vw,1400px\)[^}]*height:min\(90vh,1000px\)/);
  assert.match(html, /#crashEvidenceModal \.crash-evidence-lines\{[^}]*flex:1[^}]*font-size:13px/);
  assert.match(html, /@media\(max-width:700px\)\{#crashEvidenceModal \.modal-box\.wide\{width:calc\(100vw - 20px\);height:calc\(100vh - 20px\)/);
});

test('all launcher popup families are bounded and resize with the app viewport', () => {
  assert.match(html, /\.modal-overlay\{[^}]*position:fixed;inset:0[^}]*overflow:auto/);
  assert.match(html, /\.modal-box\{[^}]*width:min\(92vw,560px\)[^}]*max-height:calc\(100dvh - 32px\)/);
  assert.match(html, /\.modal-box\.wide\{width:min\(94vw,1080px\);\}/);
  assert.match(html, /\.command-palette-box\{[^}]*width:min\(680px,100%\)[^}]*max-height:calc\(100dvh - 32px\)/);
  assert.match(html, /\.notification-center\{[^}]*width:min\(38vw,480px,calc\(100vw - 24px\)\)[^}]*max-height:calc\(100dvh - 68px\)/);
  assert.match(html, /#globalLauncherInputModal>div\{[^}]*max-height:calc\(100dvh - 32px\)/);
  assert.match(html, /#deleteServerConfirmationDialog\{[^}]*max-height:calc\(100dvh - 40px\);overflow:auto;\}/);
  assert.match(html, /id="deleteServerConfirmationDialog" role="dialog" aria-modal="true"/);
  assert.match(html, /#cosmeticStudioModal>div\{[^}]*width:min\(96vw,1180px\)!important[^}]*height:min\(92dvh,760px\)!important/);
  assert.match(html, /@media\(max-width:780px\)\{#cosmeticStudioModal\{padding:10px!important/);
});

test('dependency auto-install is crash-gated, version-filtered, and cancelable', () => {
  assert.match(html, /if \(!report\?\.crashed \|\| !dependencies\.length/);
  assert.match(html, /mcVersion: String\(target\.mcVersion \|\| ''\)/);
  assert.match(html, /no name-only guess will be installed/i);
  assert.match(html, /cancelDependencyInstall\(run\.activeInstallId\)/);
  assert.match(html, /result\.requiredDependencies/);
});
