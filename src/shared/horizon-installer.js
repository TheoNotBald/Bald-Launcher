'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const AdmZip = require('adm-zip');

const HORIZON_RELEASES_API = 'https://api.github.com/repos/horizon-rust/horizon/releases?per_page=30';
const MAX_ARCHIVE_BYTES = 128 * 1024 * 1024;
const MAX_UNCOMPRESSED_BYTES = 512 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES = 5000;

function selectHorizonLauncherAsset(releases, architecture) {
  const assetName = architecture === 'x64'
    ? 'horizon-launcher-windows-x64.zip'
    : architecture === 'arm64'
      ? 'horizon-launcher-windows-arm64.zip'
      : '';
  if (!assetName) throw new Error(`Automatic Horizon installation is not supported on ${architecture}.`);

  const release = (Array.isArray(releases) ? releases : [])
    .filter(item => item && item.draft !== true && /^launcher@\d/i.test(String(item.tag_name || '')))
    .sort((left, right) => String(right.published_at || '').localeCompare(String(left.published_at || '')))
    .find(item => Array.isArray(item.assets) && item.assets.some(asset => asset?.name === assetName));
  const asset = release?.assets.find(item => item.name === assetName);
  if (!release || !asset) throw new Error(`No official Horizon Launcher archive is available for Windows ${architecture}.`);
  const digest = String(asset.digest || '');
  if (!/^sha256:[a-f0-9]{64}$/i.test(digest)) {
    throw new Error('GitHub did not provide a SHA-256 digest for the Horizon Launcher archive.');
  }
  const url = new URL(String(asset.browser_download_url || ''));
  if (url.protocol !== 'https:' || url.hostname !== 'github.com'
    || !url.pathname.startsWith('/horizon-rust/horizon/releases/download/')) {
    throw new Error('The Horizon Launcher download URL is not an official GitHub release asset.');
  }
  if (!Number.isSafeInteger(asset.size) || asset.size < 1 || asset.size > MAX_ARCHIVE_BYTES) {
    throw new Error('The Horizon Launcher archive has an invalid or excessive download size.');
  }
  const version = String(release.tag_name).slice('launcher@'.length);
  if (!/^[A-Za-z0-9._-]{1,60}$/.test(version)) throw new Error('The Horizon Launcher release version is invalid.');
  return { asset, digest: digest.slice('sha256:'.length).toLowerCase(), version };
}

function installHorizonLauncherArchive({ archive, digest, version, installRoot }) {
  if (!Buffer.isBuffer(archive) || archive.length < 1 || archive.length > MAX_ARCHIVE_BYTES) {
    throw new Error('The downloaded Horizon Launcher archive is empty or too large.');
  }
  const actualDigest = crypto.createHash('sha256').update(archive).digest('hex');
  if (!/^[a-f0-9]{64}$/i.test(String(digest || '')) || actualDigest !== digest.toLowerCase()) {
    throw new Error('Horizon Launcher archive SHA-256 verification failed.');
  }
  if (!/^[A-Za-z0-9._-]{1,60}$/.test(String(version || ''))) {
    throw new Error('The Horizon Launcher release version is invalid.');
  }
  if (typeof installRoot !== 'string' || !path.isAbsolute(installRoot)) {
    throw new TypeError('Horizon Launcher installation root must be an absolute path.');
  }

  fs.mkdirSync(installRoot, { recursive: true });
  const rootStat = fs.lstatSync(installRoot);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error('Horizon Launcher installation root must be a real directory.');
  }

  const target = path.join(installRoot, `launcher-${version}`);
  const executableName = 'horizon-launcher.exe';
  if (fs.existsSync(target)) {
    const markerPath = path.join(target, '.bald-horizon-install.json');
    let marker;
    try {
      marker = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
    } catch (error) {
      throw new Error(`An incomplete Horizon Launcher installation already exists for this release: ${error.message}`);
    }
    const relativeExecutable = String(marker.executableRelativePath || '').replace(/\\/g, '/');
    if (marker.version !== version || marker.digest !== digest.toLowerCase()
      || !relativeExecutable || relativeExecutable.startsWith('/')
      || relativeExecutable.split('/').some(part => part === '..')) {
      throw new Error('An incomplete Horizon Launcher installation already exists for this release.');
    }
    const existing = path.resolve(target, ...relativeExecutable.split('/'));
    const relative = path.relative(target, existing);
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error('The saved Horizon Launcher executable path is invalid.');
    }
    const existingStat = fs.lstatSync(existing);
    if (!existingStat.isFile() || existingStat.isSymbolicLink()) {
      throw new Error('An incomplete Horizon Launcher installation already exists for this release.');
    }
    return { executablePath: existing, version, reused: true };
  }

  const staging = path.join(installRoot, `.staging-${process.pid}-${crypto.randomBytes(8).toString('hex')}`);
  fs.mkdirSync(staging);
  try {
    const zip = new AdmZip(archive);
    const entries = zip.getEntries();
    if (!entries.length || entries.length > MAX_ARCHIVE_ENTRIES) {
      throw new Error('The Horizon Launcher archive has an invalid number of files.');
    }

    let totalUncompressedBytes = 0;
    let executableRelativePath = '';
    for (const entry of entries) {
      const normalizedName = String(entry.entryName || '').replace(/\\/g, '/');
      const parts = normalizedName.split('/');
      if (!normalizedName || normalizedName.startsWith('/') || /^[A-Za-z]:/.test(normalizedName)
        || parts.some(part => part === '..')) {
        throw new Error('The Horizon Launcher archive contains an unsafe file path.');
      }

      const fileType = (entry.header?.fileAttr || 0) & 0xf000;
      if (fileType === 0xa000) throw new Error('The Horizon Launcher archive contains a symbolic link.');
      const entrySize = Number(entry.header?.size || 0);
      if (!Number.isSafeInteger(entrySize) || entrySize < 0) {
        throw new Error('The Horizon Launcher archive contains an invalid file size.');
      }
      totalUncompressedBytes += entrySize;
      if (totalUncompressedBytes > MAX_UNCOMPRESSED_BYTES) {
        throw new Error('The Horizon Launcher archive expands beyond the allowed size.');
      }

      const destination = path.resolve(staging, ...parts.filter(Boolean));
      const relative = path.relative(staging, destination);
      if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        throw new Error('The Horizon Launcher archive contains an unsafe file path.');
      }
      if (entry.isDirectory) {
        fs.mkdirSync(destination, { recursive: true });
        continue;
      }

      const contents = entry.getData();
      if (contents.length !== entrySize) throw new Error('A Horizon Launcher archive file failed its size check.');
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.writeFileSync(destination, contents, { flag: 'wx' });
      if (path.basename(destination).toLowerCase() === executableName) {
        if (executableRelativePath) throw new Error('The Horizon Launcher archive contains multiple launcher executables.');
        executableRelativePath = path.relative(staging, destination);
      }
    }

    if (!executableRelativePath) throw new Error('The Horizon Launcher executable is missing from its official archive.');
    fs.writeFileSync(path.join(staging, '.bald-horizon-install.json'), JSON.stringify({
      version,
      digest: digest.toLowerCase(),
      executableRelativePath,
    }), { flag: 'wx' });
    fs.renameSync(staging, target);
    const executablePath = path.join(target, executableRelativePath);
    const executableStat = fs.lstatSync(executablePath);
    if (!executableStat.isFile() || executableStat.isSymbolicLink()) {
      throw new Error('The extracted Horizon Launcher executable is not a regular file.');
    }
    return { executablePath, version, reused: false };
  } catch (error) {
    fs.rmSync(staging, { recursive: true, force: true });
    throw error;
  }
}

module.exports = {
  HORIZON_RELEASES_API,
  MAX_ARCHIVE_BYTES,
  installHorizonLauncherArchive,
  selectHorizonLauncherAsset,
};
