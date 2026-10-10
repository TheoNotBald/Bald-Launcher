'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const html = fs.readFileSync(path.join(__dirname, '..', 'bald_launcher_v7.html'), 'utf8');

test('standalone Logs navigation is removed while profile and server logs remain available', () => {
  assert.doesNotMatch(html, /id="nav-logs"/);
  assert.doesNotMatch(html, /label:\s*'Open Logs'/);
  assert.match(html, /id="pdtab-logs"[^>]*onclick="setPdTab\('logs'\)"/);
  assert.match(html, /data-server-tab="console"[^>]*>Console<\/div>/);
});

test('stale standalone Logs page selection falls back to Profiles', () => {
  assert.match(html, /showPanel\(\['home','servers','accounts','settings','performance','appearance','capes','resource-packs'\]\.includes\(savedPage\) \? savedPage : 'home'\)/);
});
