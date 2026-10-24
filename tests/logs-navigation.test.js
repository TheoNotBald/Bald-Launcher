'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const html = fs.readFileSync(path.join(__dirname, '..', 'bald_launcher_v7.html'), 'utf8').replace(/\r\n/g, '\n');

test('standalone Logs navigation is removed while profile and server logs remain available', () => {
  assert.doesNotMatch(html, /id="nav-logs"/);
  assert.doesNotMatch(html, /label:\s*'Open Logs'/);
  assert.match(html, /id="pdtab-logs"[^>]*onclick="setPdTab\('logs'\)"/);
  assert.match(html, /data-server-tab="console"[^>]*>Console<\/div>/);
});

test('stale standalone Logs page selection falls back to Profiles', () => {
  assert.match(html, /showPanel\(\['home','servers','accounts','settings','performance','appearance','capes','resource-packs'\]\.includes\(savedPage\) \? savedPage : 'home'\)/);
});

test('profile log event handler is defined in the renderer script, not the stylesheet', () => {
  const styleEnd = html.indexOf('</style>');
  const handlerStart = html.indexOf('function appendProfileLog(entry)');
  const scriptStart = html.lastIndexOf('<script', handlerStart);
  const scriptEnd = html.indexOf('</script>', handlerStart);

  assert.ok(styleEnd >= 0);
  assert.ok(handlerStart > styleEnd);
  assert.ok(scriptStart > styleEnd);
  assert.ok(scriptEnd > handlerStart);
});
