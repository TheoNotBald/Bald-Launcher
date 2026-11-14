'use strict';

const fs = require('node:fs');
const path = require('node:path');

const PRESET = Object.freeze({
  renderDistance: '6',
  simulationDistance: '4',
  entityDistanceScaling: '0.5',
  particles: '2',
  renderClouds: '"false"',
  biomeBlendRadius: '0',
  mipmapLevels: '0',
  enableVsync: 'false',
  maxFps: '260',
  ao: 'false',
});

function readOptions(optionsPath) {
  try {
    const stat = fs.lstatSync(optionsPath);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error('Minecraft options.txt must be a regular, non-symlink file.');
    }
    return fs.readFileSync(optionsPath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function parseOptions(content) {
  const lines = String(content || '').split(/\r?\n/);
  if (lines.at(-1) === '') lines.pop();
  const values = new Map();
  for (const line of lines) {
    const separator = line.indexOf(':');
    if (separator <= 0) continue;
    const key = line.slice(0, separator);
    if ((Object.hasOwn(PRESET, key) || key === 'graphicsPreset') && !values.has(key)) {
      values.set(key, line.slice(separator + 1));
    }
  }
  return { lines, values };
}

function updateOptions(content, updates, removeWhenMatches = null) {
  const { lines } = parseOptions(content);
  const written = new Set();
  const result = [];
  for (const line of lines) {
    const separator = line.indexOf(':');
    const key = separator > 0 ? line.slice(0, separator) : '';
    if (updates.has(key)) {
      result.push(`${key}:${updates.get(key)}`);
      written.add(key);
      continue;
    }
    if (removeWhenMatches && removeWhenMatches.has(key)) {
      const expected = removeWhenMatches.get(key);
      if (line.slice(separator + 1) === expected) continue;
    }
    result.push(line);
  }
  for (const [key, value] of updates) {
    if (!written.has(key)) result.push(`${key}:${value}`);
  }
  return result.length ? `${result.join('\n')}\n` : '';
}

function writeAtomic(filePath, contents) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(temporaryPath, contents, { encoding: 'utf8', flag: 'wx' });
    fs.renameSync(temporaryPath, filePath);
  } catch (error) {
    try {
      fs.rmSync(temporaryPath, { force: true });
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], `Could not write ${filePath} or clean up its temporary file.`);
    }
    throw error;
  }
}

function saveOptions(optionsPath, contents) {
  if (contents === '') {
    try {
      fs.unlinkSync(optionsPath);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    return;
  }
  writeAtomic(optionsPath, contents);
}

function setVanillaPerformancePreset({ enabled, optionsPath, backupPath }) {
  const current = readOptions(optionsPath);
  const currentValues = parseOptions(current).values;
  let backup = null;
  try {
    backup = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw new Error(`Could not read the vanilla performance settings backup: ${error.message}`);
  }

  if (enabled) {
    if (!backup) {
      const preset = { ...PRESET };
      if (currentValues.has('graphicsPreset')) preset.graphicsPreset = '"fast"';
      backup = {
        version: 1,
        managed: preset,
        original: Object.fromEntries([...Object.keys(preset)].map(key => [key, currentValues.get(key) ?? null])),
      };
      writeAtomic(backupPath, JSON.stringify(backup));
    }
    if (backup.version !== 1 || !backup.managed || typeof backup.managed !== 'object') {
      throw new Error('The saved vanilla performance settings backup has an unsupported format.');
    }
    const managed = Object.entries(backup.managed);
    if (managed.some(([key, value]) => (key !== 'graphicsPreset' && !Object.hasOwn(PRESET, key))
      || typeof value !== 'string')) {
      throw new Error('The saved vanilla performance settings backup contains invalid preset values.');
    }
    const next = updateOptions(current, new Map(managed));
    if (next !== current) saveOptions(optionsPath, next);
    return { changed: next !== current, enabled: true };
  }

  if (!backup) return { changed: false, enabled: false };
  if (backup.version !== 1 || !backup.managed || typeof backup.managed !== 'object'
    || !backup.original || typeof backup.original !== 'object') {
    throw new Error('The saved vanilla performance settings backup has an unsupported format.');
  }

  const managedValues = new Map(Object.entries(backup.managed));
  for (const [key, value] of Object.entries(backup.original)) {
    if (!managedValues.has(key)) continue;
    if (value !== null && typeof value !== 'string') {
      throw new Error(`The saved vanilla performance settings backup has an invalid value for ${key}.`);
    }
  }
  if ([...managedValues.keys()].some(key => !Object.hasOwn(backup.original, key))) {
    throw new Error('The saved vanilla performance settings backup is incomplete.');
  }

  let next = current;
  if (current !== null) {
    const { values } = parseOptions(current);
    const restore = new Map();
    const remove = new Map();
    for (const key of managedValues.keys()) {
      if (values.get(key) !== managedValues.get(key)) continue;
      if (backup.original[key] === null) remove.set(key, managedValues.get(key));
      else if (typeof backup.original[key] === 'string') restore.set(key, backup.original[key]);
    }
    if (remove.size || restore.size) {
      next = updateOptions(current, restore, remove);
      saveOptions(optionsPath, next);
    }
  }
  fs.unlinkSync(backupPath);
  return { changed: next !== current, enabled: false };
}

module.exports = { PRESET, setVanillaPerformancePreset };
