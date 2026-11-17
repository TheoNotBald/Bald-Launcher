'use strict';

const fs = require('node:fs');
const path = require('node:path');

const SHARED_OPTIONS = new Set([
  'autoJump',
  'chatOpacity',
  'chatScale',
  'chatWidth',
  'enableVsync',
  'entityDistanceScaling',
  'fov',
  'fullscreen',
  'graphicsPreset',
  'guiScale',
  'maxFps',
  'mipmapLevels',
  'renderClouds',
  'renderDistance',
  'simulationDistance',
]);

function parseOptions(text) {
  const entries = new Map();
  for (const line of String(text || '').split(/\r?\n/)) {
    const separator = line.indexOf(':');
    if (separator <= 0) continue;
    entries.set(line.slice(0, separator), line.slice(separator + 1));
  }
  return entries;
}

function isPathWithin(rootPath, candidatePath) {
  const relative = path.relative(path.resolve(rootPath), path.resolve(candidatePath));
  return relative === ''
    || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function lstatIfExists(filePath) {
  try {
    return fs.lstatSync(filePath);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function assertSafeDestinationPath(destinationPath, destinationRoot) {
  const root = path.resolve(destinationRoot);
  const destination = path.resolve(destinationPath);
  if (!isPathWithin(root, destination)) {
    throw new Error(`The resource-pack destination is outside the Horizon profile: ${destination}`);
  }
  const rootStat = lstatIfExists(root);
  if (!rootStat || !rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error(`The Horizon profile destination is not a regular directory: ${root}`);
  }

  let current = root;
  const relative = path.relative(root, destination);
  const segments = relative.split(path.sep).filter(Boolean);
  for (const [index, segment] of segments.entries()) {
    current = path.join(current, segment);
    const stat = lstatIfExists(current);
    if (!stat) break;
    if (stat.isSymbolicLink()) {
      throw new Error(`Synchronization does not follow symbolic links: ${current}`);
    }
    if (index < segments.length - 1 && !stat.isDirectory()) {
      throw new Error(`The resource-pack destination parent is not a directory: ${current}`);
    }
  }
}

function copyDirectoryWithoutOverwrite(sourcePath, destinationPath, destinationRoot) {
  const sourceStat = fs.lstatSync(sourcePath);
  if (sourceStat.isSymbolicLink()) throw new Error(`Synchronization does not follow symbolic links: ${sourcePath}`);
  if (sourceStat.isDirectory() && isPathWithin(sourcePath, destinationPath)) {
    throw new Error('The resource-pack source directory cannot contain its destination.');
  }
  assertSafeDestinationPath(destinationPath, destinationRoot);
  const destinationStat = lstatIfExists(destinationPath);

  if (sourceStat.isDirectory()) {
    if (destinationStat && !destinationStat.isDirectory()) {
      throw new Error(`The resource-pack destination is not a directory: ${destinationPath}`);
    }
    fs.mkdirSync(destinationPath, { recursive: true });
    let copied = 0;
    let skipped = 0;
    for (const name of fs.readdirSync(sourcePath)) {
      const result = copyDirectoryWithoutOverwrite(
        path.join(sourcePath, name),
        path.join(destinationPath, name),
        destinationRoot,
      );
      copied += result.copied;
      skipped += result.skipped;
    }
    return { copied, skipped };
  }
  if (!sourceStat.isFile()) throw new Error(`Unsupported synchronization item: ${sourcePath}`);
  if (destinationStat && !destinationStat.isFile()) {
    throw new Error(`The resource-pack destination is not a regular file: ${destinationPath}`);
  }
  fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
  try {
    fs.copyFileSync(sourcePath, destinationPath, fs.constants.COPYFILE_EXCL);
    return { copied: 1, skipped: 0 };
  } catch (error) {
    if (error.code === 'EEXIST') return { copied: 0, skipped: 1 };
    throw error;
  }
}

function mergeHorizonOptions(sourceText, destinationText, categories) {
  const selected = new Set(Array.isArray(categories) ? categories : []);
  const source = parseOptions(sourceText);
  const destination = parseOptions(destinationText);
  const originalDestination = String(destinationText || '').split(/\r?\n/);
  const mergedKeys = new Set();
  const lines = originalDestination.map(line => {
    const separator = line.indexOf(':');
    if (separator <= 0) return line;
    const key = line.slice(0, separator);
    const isSharedOption = selected.has('options') && SHARED_OPTIONS.has(key);
    const isSharedKeybind = selected.has('keybinds') && key.startsWith('key_');
    if ((!isSharedOption && !isSharedKeybind) || !source.has(key)) return line;
    mergedKeys.add(key);
    return `${key}:${source.get(key)}`;
  });

  for (const [key, value] of source) {
    const isSharedOption = selected.has('options') && SHARED_OPTIONS.has(key);
    if (isSharedOption && !mergedKeys.has(key)) {
      lines.push(`${key}:${value}`);
      mergedKeys.add(key);
    }
  }

  const merged = [...mergedKeys];
  return { text: lines.join('\n').replace(/\n+$/, '\n'), merged };
}

module.exports = {
  copyDirectoryWithoutOverwrite,
  isPathWithin,
  mergeHorizonOptions,
};
