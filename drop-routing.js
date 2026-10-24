'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const AdmZip = require('adm-zip');

function zipHasEntry(zipPath, predicate) {
  try {
    return new AdmZip(zipPath).getEntries().some(entry => !entry.isDirectory && predicate(entry.entryName.replace(/\\/g, '/').toLowerCase()));
  } catch {
    return false;
  }
}

function isMinecraftModJar(filePath) {
  return zipHasEntry(filePath, name =>
    name === 'fabric.mod.json'
    || name === 'quilt.mod.json'
    || name === 'mcmod.info'
    || name === 'meta-inf/mods.toml'
    || name === 'meta-inf/neoforge.mods.toml');
}

function classifyProfileDrop(sourcePath) {
  let stat;
  try {
    stat = fs.lstatSync(sourcePath);
  } catch {
    return { type: 'unknown', reason: 'This file is no longer available.' };
  }
  if (stat.isSymbolicLink()) return { type: 'unknown', reason: 'Symbolic links are not accepted.' };

  const name = path.basename(sourcePath);
  if (stat.isDirectory()) {
    const entries = fs.readdirSync(sourcePath, { withFileTypes: true });
    const files = entries.filter(entry => entry.isFile()).map(entry => path.join(sourcePath, entry.name));
    const names = new Set(entries.map(entry => entry.name.toLowerCase()));
    if (names.has('pack.mcmeta')) return { type: 'resourcepack', sourcePaths: [sourcePath] };
    if (names.has('shader.properties') || names.has('shaders')) return { type: 'shader', sourcePaths: [sourcePath] };
    if (names.has('level.dat')) return { type: 'world', sourcePaths: [sourcePath] };

    const modFiles = files.filter(file => path.extname(file).toLowerCase() === '.jar' && isMinecraftModJar(file));
    const nestedMods = path.join(sourcePath, 'mods');
    const nestedModsStat = names.has('mods') ? fs.lstatSync(nestedMods) : null;
    const nestedModFiles = nestedModsStat?.isDirectory()
      ? fs.readdirSync(nestedMods, { withFileTypes: true })
        .filter(entry => entry.isFile() && path.extname(entry.name).toLowerCase() === '.jar')
        .map(entry => path.join(nestedMods, entry.name))
        .filter(isMinecraftModJar)
      : [];
    if (modFiles.length || nestedModFiles.length) {
      const hasOnlyModJars = modFiles.length === files.filter(file => path.extname(file).toLowerCase() === '.jar').length;
      if (name.toLowerCase() === 'mods' || nestedModFiles.length || hasOnlyModJars) {
        const candidates = nestedModFiles.length ? nestedModFiles : modFiles;
        if (candidates.length) return { type: 'mods', sourcePaths: candidates };
      }
    }
    return { type: 'unknown', reason: 'Folder type not recognized. Drop a mod folder, resource pack, shader pack, or Minecraft world.' };
  }
  if (!stat.isFile()) return { type: 'unknown', reason: 'Only regular files and folders can be copied.' };

  const extension = path.extname(name).toLowerCase();
  if (extension === '.jar' && isMinecraftModJar(sourcePath)) return { type: 'mods', sourcePaths: [sourcePath] };
  if (extension === '.mrpack' || extension === '.baldprofile') {
    return { type: 'unknown', reason: 'Modpack/profile archives must be added with the Import Profile button.' };
  }
  if (extension === '.zip') {
    if (zipHasEntry(sourcePath, entry => entry === 'pack.mcmeta' || entry.endsWith('/pack.mcmeta'))) {
      return { type: 'resourcepack', sourcePaths: [sourcePath] };
    }
    if (zipHasEntry(sourcePath, entry => entry === 'shader.properties' || entry.startsWith('shaders/'))) {
      return { type: 'shader', sourcePaths: [sourcePath] };
    }
    if (zipHasEntry(sourcePath, entry => entry === 'level.dat' || entry.endsWith('/level.dat'))) {
      return { type: 'world-archive', sourcePaths: [sourcePath] };
    }
  }
  return { type: 'unknown', reason: `“${name}” is not a recognized Minecraft mod, resource pack, shader pack, or world.` };
}

function uniqueDestinationPath(destinationDirectory, requestedName) {
  const extension = path.extname(requestedName);
  const stem = extension ? requestedName.slice(0, -extension.length) : requestedName;
  let candidate = path.join(destinationDirectory, requestedName);
  let suffix = 2;
  while (fs.existsSync(candidate)) {
    candidate = path.join(destinationDirectory, `${stem} (${suffix++})${extension}`);
  }
  return candidate;
}

function copyTree(sourcePath, destinationPath) {
  const stat = fs.lstatSync(sourcePath);
  if (stat.isSymbolicLink()) throw new Error(`Symbolic links are not copied: ${sourcePath}`);
  if (stat.isDirectory()) {
    fs.mkdirSync(destinationPath);
    for (const entry of fs.readdirSync(sourcePath, { withFileTypes: true })) {
      copyTree(path.join(sourcePath, entry.name), path.join(destinationPath, entry.name));
    }
    return;
  }
  if (!stat.isFile()) throw new Error(`Unsupported file type: ${sourcePath}`);
  fs.copyFileSync(sourcePath, destinationPath, fs.constants.COPYFILE_EXCL);
}

function copyPathWithoutOverwrite(sourcePath, destinationDirectory) {
  const sourceStat = fs.lstatSync(sourcePath);
  if (sourceStat.isSymbolicLink() || (!sourceStat.isDirectory() && !sourceStat.isFile())) {
    throw new Error('Only regular files and folders can be copied.');
  }
  let sourceRealPath = '';
  if (sourceStat.isDirectory()) {
    sourceRealPath = fs.realpathSync(sourcePath);
    const relative = path.relative(sourceRealPath, path.resolve(destinationDirectory));
    if (!relative || (!relative.startsWith('..') && !path.isAbsolute(relative))) {
      throw new Error('A folder cannot be copied into itself or one of its child folders.');
    }
  }
  fs.mkdirSync(destinationDirectory, { recursive: true });
  if (sourceRealPath) {
    const destinationRealPath = fs.realpathSync(destinationDirectory);
    const relative = path.relative(sourceRealPath, destinationRealPath);
    if (!relative || (!relative.startsWith('..') && !path.isAbsolute(relative))) {
      throw new Error('A folder cannot be copied into itself or one of its child folders.');
    }
  }
  const targetPath = uniqueDestinationPath(destinationDirectory, path.basename(sourcePath));
  const stagingPath = path.join(destinationDirectory, `.bald-drop-${crypto.randomUUID()}`);
  try {
    copyTree(sourcePath, stagingPath);
    fs.renameSync(stagingPath, targetPath);
    return targetPath;
  } catch (error) {
    fs.rmSync(stagingPath, { recursive: true, force: true });
    throw error;
  }
}

function copyDropItems(sourcePaths, destinationDirectory) {
  const results = [];
  for (const sourcePath of sourcePaths) {
    try {
      results.push({ sourcePath, ok: true, destinationPath: copyPathWithoutOverwrite(sourcePath, destinationDirectory) });
    } catch (error) {
      results.push({ sourcePath, ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return results;
}

function validateWorldArchiveEntryPath(entryName) {
  const normalized = String(entryName || '').replace(/\\/g, '/');
  const segments = normalized.split('/').filter(Boolean);
  if (normalized.startsWith('/') || /^[a-z]:/i.test(normalized) || segments.some(segment => segment === '.' || segment === '..')) {
    throw new Error(`Unsafe path in world archive: ${entryName}`);
  }
  return segments.join('/');
}

function extractWorldArchive(sourcePath, destinationDirectory) {
  const archive = new AdmZip(sourcePath);
  const entries = archive.getEntries().filter(entry => !entry.isDirectory);
  for (const entry of archive.getEntries()) {
    validateWorldArchiveEntryPath(entry.entryName);
  }
  if (!entries.some(entry => /(?:^|\/)level\.dat$/i.test(entry.entryName.replace(/\\/g, '/')))) {
    throw new Error('The archive does not contain a Minecraft world level.dat file.');
  }
  const roots = entries.map(entry => entry.entryName.replace(/\\/g, '/').split('/')[0]).filter(Boolean);
  const commonRoot = roots.length && roots.every(root => root === roots[0]) && entries.every(entry => entry.entryName.replace(/\\/g, '/').includes('/'))
    ? roots[0]
    : '';
  const safeRoot = String(commonRoot || '').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/\.+$/g, '').trim();
  const suggestedName = safeRoot && safeRoot !== '.' && safeRoot !== '..'
    ? safeRoot.slice(0, 80)
    : path.basename(sourcePath, path.extname(sourcePath));
  fs.mkdirSync(destinationDirectory, { recursive: true });
  const targetPath = uniqueDestinationPath(destinationDirectory, suggestedName);
  const stagingPath = path.join(destinationDirectory, `.bald-drop-${crypto.randomUUID()}`);
  fs.mkdirSync(stagingPath);
  try {
    for (const entry of archive.getEntries()) {
      let relativePath = entry.entryName.replace(/\\/g, '/').replace(/\/+$/, '');
      if (commonRoot) relativePath = relativePath.slice(commonRoot.length).replace(/^\/+/, '');
      if (!relativePath) continue;
      const segments = validateWorldArchiveEntryPath(relativePath).split('/');
      if (!segments.length) continue;
      const unixMode = (entry.header.attr >>> 16) & 0o170000;
      if (unixMode === 0o120000) throw new Error(`Symbolic links are not extracted from world archives: ${entry.entryName}`);
      const outputPath = path.join(stagingPath, ...segments);
      if (entry.isDirectory) {
        fs.mkdirSync(outputPath, { recursive: true });
        continue;
      }
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, entry.getData(), { flag: 'wx' });
    }
    fs.renameSync(stagingPath, targetPath);
    return targetPath;
  } catch (error) {
    fs.rmSync(stagingPath, { recursive: true, force: true });
    throw error;
  }
}

module.exports = { classifyProfileDrop, copyPathWithoutOverwrite, copyDropItems, extractWorldArchive, validateWorldArchiveEntryPath };
