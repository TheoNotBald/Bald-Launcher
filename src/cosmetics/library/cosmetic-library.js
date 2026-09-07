'use strict';

const fs = require('fs');
const path = require('path');

function createCosmeticLibrary({ appDataDir, baseDir = 'cosmetics' } = {}) {
  const rootDir = path.join(appDataDir || process.cwd(), baseDir);
  const skinDir = path.join(rootDir, 'skins');
  const capeDir = path.join(rootDir, 'capes');

  function ensureDirs() {
    fs.mkdirSync(rootDir, { recursive: true });
    fs.mkdirSync(skinDir, { recursive: true });
    fs.mkdirSync(capeDir, { recursive: true });
  }

  function validatePngBuffer(buffer) {
    if (!buffer || buffer.length < 24) return { ok: false, error: 'File is too small to be a valid PNG.' };
    if (buffer[0] !== 0x89 || buffer[1] !== 0x50 || buffer[2] !== 0x4e || buffer[3] !== 0x47 || buffer[4] !== 0x0d || buffer[5] !== 0x0a || buffer[6] !== 0x1a || buffer[7] !== 0x0a) {
      return { ok: false, error: 'Only PNG files are supported.' };
    }
    return { ok: true };
  }

  function safeFileName(name, fallback) {
    const base = String(name || fallback || 'asset').trim().replace(/[<>:"/\\|?*]+/g, '_').replace(/\s+/g, ' ');
    return base && base.length < 150 ? base : fallback || 'asset';
  }

  function getKindDir(kind) {
    if (kind === 'cape') return capeDir;
    return skinDir;
  }

  function list(kind) {
    ensureDirs();
    const targetDir = getKindDir(kind);
    try {
      const entries = fs.readdirSync(targetDir, { withFileTypes: true })
        .filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith('.png'))
        .map(entry => {
          try {
            const metadataPath = path.join(targetDir, `${path.basename(entry.name, '.png')}.json`);
            const metadata = fs.existsSync(metadataPath) ? JSON.parse(fs.readFileSync(metadataPath, 'utf8')) : {};
            return {
              id: metadata.id || path.basename(entry.name, '.png'),
              name: metadata.name || path.basename(entry.name, '.png'),
              kind,
              source: metadata.source || 'local',
              filePath: path.join(targetDir, entry.name),
              model: metadata.model || 'classic',
              createdAt: metadata.createdAt || new Date().toISOString(),
            };
          } catch (_error) {
            return null;
          }
        })
        .filter(Boolean);
      return entries;
    } catch (_error) {
      return [];
    }
  }

  function saveAsset(kind, { filePath, name, source = 'local', model = 'classic' }) {
    ensureDirs();
    if (!['skin', 'cape'].includes(kind)) throw new Error('Unsupported cosmetic kind.');
    const sourcePath = filePath && fs.existsSync(filePath) ? filePath : null;
    if (!sourcePath) throw new Error('No file was provided for this cosmetic.');
    const imageBuffer = fs.readFileSync(sourcePath);
    const pngCheck = validatePngBuffer(imageBuffer);
    if (!pngCheck.ok) throw new Error(pngCheck.error);

    let width = 0;
    let height = 0;
    try {
      width = imageBuffer.readUInt32BE(16);
      height = imageBuffer.readUInt32BE(20);
    } catch (_error) {
      throw new Error('The PNG header could not be read.');
    }

    const supportedSkin = [64, 128].includes(width) && [64, 128].includes(height);
    const supportedCape = ((width === 64 && height === 32) || (width === 128 && height === 64) || (width === 1024 && height === 512));
    if (kind === 'skin' && !supportedSkin) {
      throw new Error('Minecraft skins should be 64x64 or 128x128 PNG files.');
    }
    if (kind === 'cape' && !supportedCape) {
      throw new Error('Minecraft capes should be 64x32, 128x64, or 1024x512 PNG files.');
    }

    const targetDir = getKindDir(kind);
    const safeName = safeFileName(name, path.basename(sourcePath, path.extname(sourcePath)) || `${kind}-item`);
    const id = `local-${kind}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const fileName = `${safeName.replace(/\s+/g, '-').toLowerCase()}-${id.slice(-8)}.png`;
    const targetPath = path.join(targetDir, fileName);
    fs.writeFileSync(targetPath, imageBuffer);
    const metadata = {
      id,
      name: safeName,
      source: String(source || 'local'),
      kind,
      model: kind === 'skin' ? (['classic', 'slim'].includes(model) ? model : 'classic') : 'classic',
      width,
      height,
      createdAt: new Date().toISOString(),
      fileName,
      filePath: targetPath,
    };
    fs.writeFileSync(path.join(targetDir, `${path.basename(fileName, '.png')}.json`), JSON.stringify(metadata, null, 2), 'utf8');
    return {
      id,
      name: safeName,
      kind,
      source: metadata.source,
      model: metadata.model,
      filePath: targetPath,
      width,
      height,
      createdAt: metadata.createdAt,
    };
  }

  function saveBuffer(kind, { buffer, name, source = 'created', model = 'classic', parentId = null, version = 1, accountId = null }) {
    ensureDirs();
    if (!Buffer.isBuffer(buffer)) throw new Error('A PNG buffer is required.');
    if (!['skin', 'cape'].includes(kind)) throw new Error('Unsupported cosmetic kind.');
    const pngCheck = validatePngBuffer(buffer);
    if (!pngCheck.ok) throw new Error(pngCheck.error);
    const width = buffer.readUInt32BE(16);
    const height = buffer.readUInt32BE(20);
    const supportedSkin = width === 64 && height === 64;
    const supportedCape = width === 64 && height === 32;
    if (kind === 'skin' && !supportedSkin) throw new Error('Created Minecraft skins must be 64x64 PNG files.');
    if (kind === 'cape' && !supportedCape) throw new Error('Created Minecraft capes must be 64x32 PNG files.');
    const targetDir = getKindDir(kind);
    const safeName = safeFileName(name, `${kind}-asset`);
    const id = `created-${kind}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const fileName = `${safeName.replace(/\s+/g, '-').toLowerCase()}-${id.slice(-8)}.png`;
    const targetPath = path.join(targetDir, fileName);
    fs.writeFileSync(targetPath, buffer);
    const metadata = { id, name: safeName, kind, source: String(source), model: kind === 'skin' ? (['classic', 'slim'].includes(model) ? model : 'classic') : 'classic', width, height, version: Math.max(1, Number(version) || 1), parentId: parentId || null, accountId: accountId || null, createdAt: new Date().toISOString(), modifiedAt: new Date().toISOString(), fileName, filePath: targetPath };
    fs.writeFileSync(path.join(targetDir, `${path.basename(fileName, '.png')}.json`), JSON.stringify(metadata, null, 2), 'utf8');
    return metadata;
  }

  return {
    ensureDirs,
    list,
    saveAsset,
    saveBuffer,
    rootDir,
    skinDir,
    capeDir,
    validatePngBuffer,
  };
}

module.exports = { createCosmeticLibrary };
