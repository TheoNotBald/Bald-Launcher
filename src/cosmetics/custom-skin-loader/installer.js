const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const AdmZip = require('adm-zip');
const { resolveCustomSkinLoader } = require('./resolver');
const { readOwnership, writeOwnership, removeOwnership, isManagedPath } = require('./ownership');
const { ensureLocalSkinDirectories } = require('./local-skin-manager');
const { diagnoseInstallation } = require('./diagnostics');
const { configureLocalSkin, writeConfigAtomic, configPath } = require('./config-manager');

function ensureProfileRoot(profileRoot) {
  if (!profileRoot || !path.isAbsolute(profileRoot)) throw new Error('A valid profile directory is required.');
  fs.mkdirSync(profileRoot, { recursive: true });
}

function isValidArchive(filePath) {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile() || stat.size <= 0) return false;
    new AdmZip(filePath).getEntries();
    return true;
  } catch (_error) {
    return false;
  }
}

async function downloadVerified(file, destination, client) {
  const temporary = `${destination}.${process.pid}.download`;
  const hash = crypto.createHash('sha1');
  try {
    const response = await client.get(file.downloadUrl, { responseType: 'stream', timeout: 30000, maxContentLength: Infinity, maxBodyLength: Infinity });
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    await new Promise((resolve, reject) => {
      const output = fs.createWriteStream(temporary);
      response.data.on('data', chunk => hash.update(chunk));
      response.data.once('error', reject);
      output.once('error', reject);
      output.once('finish', resolve);
      response.data.pipe(output);
    });
    const actualHash = hash.digest('hex');
    if (file.sha1 && actualHash.toLowerCase() !== String(file.sha1).toLowerCase()) throw new Error('CustomSkinLoader SHA-1 verification failed.');
    if (!isValidArchive(temporary)) throw new Error('The downloaded CustomSkinLoader file is not a valid JAR archive.');
    fs.renameSync(temporary, destination);
    return actualHash;
  } catch (error) {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    throw error;
  }
}

function findExistingLoaderJar(profileRoot) {
  const mods = path.join(profileRoot, 'mods');
  if (!fs.existsSync(mods)) return null;
  const names = fs.readdirSync(mods).filter(name => /^customskinloader.*\.jar$/i.test(name));
  return names.length ? path.join(mods, names[0]) : null;
}

function createTransaction(profileRoot, targetPath) {
  const ownership = readOwnership(profileRoot);
  const existing = findExistingLoaderJar(profileRoot);
  if (existing && (!ownership || !ownership.managed || ownership.jarFile !== existing)) {
    throw new Error('A user-owned or unknown CustomSkinLoader installation already exists; it was not overwritten.');
  }
  if (ownership?.jarFile && !isManagedPath(profileRoot, ownership.jarFile)) {
    throw new Error('Stored CustomSkinLoader ownership metadata points outside this profile.');
  }
  const backupPath = `${targetPath}.${process.pid}.backup`;
  const configurationPath = configPath(profileRoot);
  const configurationBackupPath = `${configurationPath}.${process.pid}.backup`;
  const hadConfiguration = fs.existsSync(configurationPath);
  if (hadConfiguration) {
    fs.copyFileSync(configurationPath, configurationBackupPath);
  }
  const oldJar = ownership?.jarFile && ownership.jarFile !== targetPath ? ownership.jarFile : null;
  const oldBackupPath = oldJar ? `${oldJar}.${process.pid}.backup` : null;
  if (fs.existsSync(targetPath)) fs.renameSync(targetPath, backupPath);
  if (oldJar && fs.existsSync(oldJar)) fs.renameSync(oldJar, oldBackupPath);
  return {
    backupPath,
    rollback() {
      if (fs.existsSync(targetPath)) fs.unlinkSync(targetPath);
      if (fs.existsSync(backupPath)) fs.renameSync(backupPath, targetPath);
      if (oldJar && fs.existsSync(oldBackupPath)) fs.renameSync(oldBackupPath, oldJar);
      if (fs.existsSync(configurationPath)) fs.unlinkSync(configurationPath);
      if (hadConfiguration && fs.existsSync(configurationBackupPath)) fs.renameSync(configurationBackupPath, configurationPath);
      if (!hadConfiguration && fs.existsSync(configurationBackupPath)) fs.unlinkSync(configurationBackupPath);
    },
    commit() {
      if (fs.existsSync(backupPath)) fs.unlinkSync(backupPath);
      if (oldBackupPath && fs.existsSync(oldBackupPath)) fs.unlinkSync(oldBackupPath);
      if (fs.existsSync(configurationBackupPath)) fs.unlinkSync(configurationBackupPath);
    },
  };
}

async function installCustomSkinLoader({ profileRoot, profile, client, resolve = resolveCustomSkinLoader }) {
  ensureProfileRoot(profileRoot);
  const resolution = await resolve({ mcVersion: profile?.mcVersion, loader: profile?.loader, client });
  if (resolution.state !== 'available' || !resolution.compatibility) {
    return { ok: false, state: 'unsupported', reason: resolution.reason, diagnostics: diagnoseInstallation({ profileRoot, profile, compatibility: null }) };
  }
  const compatibility = resolution.compatibility;
  const fileName = path.basename(compatibility.fileName || `customskinloader-${compatibility.versionNumber}.jar`);
  if (!/^customskinloader.*\.jar$/i.test(fileName)) throw new Error('The resolved CustomSkinLoader file name is unsafe or unexpected.');
  const targetPath = path.join(profileRoot, 'mods', fileName);
  const transaction = createTransaction(profileRoot, targetPath);
  try {
    const sha1 = await downloadVerified({ downloadUrl: compatibility.downloadUrl, sha1: compatibility.sha1 }, targetPath, client);
    ensureLocalSkinDirectories(profileRoot);
    const configuration = configureLocalSkin(profileRoot, {
      jarFile: targetPath,
      versionNumber: compatibility.versionNumber,
    });
    if (!configuration.ok) throw new Error(configuration.reason);
    writeConfigAtomic(configuration);
    const validatedConfiguration = diagnoseInstallation({ profileRoot, profile, compatibility });
    if (!validatedConfiguration.configValid || !validatedConfiguration.configPointsToLocalSkin) {
      throw new Error('CustomSkinLoader configuration validation failed after writing the verified LocalSkin provider.');
    }
    const metadata = {
      managed: true,
      enabled: true,
      jarFile: targetPath,
      sha1,
      installedVersionId: compatibility.versionId,
      installedVersionNumber: compatibility.versionNumber,
      minecraftVersion: compatibility.gameVersion,
      loader: compatibility.loader,
      configFile: configuration.path,
      configSchema: configuration.schema,
      installedAt: new Date().toISOString(),
    };
    writeOwnership(profileRoot, metadata);
    transaction.commit();
    return { ok: true, state: 'ready', compatibility, ownership: metadata, diagnostics: validatedConfiguration };
  } catch (error) {
    transaction.rollback();
    throw error;
  }
}

function disableCustomSkinLoader({ profileRoot }) {
  const ownership = readOwnership(profileRoot);
  if (!ownership?.managed || !ownership.jarFile || !isManagedPath(profileRoot, ownership.jarFile)) {
    return { ok: false, reason: 'No launcher-managed CustomSkinLoader installation was found.' };
  }
  if (fs.existsSync(ownership.jarFile)) fs.renameSync(ownership.jarFile, `${ownership.jarFile}.disabled`);
  writeOwnership(profileRoot, { ...ownership, enabled: false, disabledAt: new Date().toISOString() });
  return { ok: true };
}

function removeManagedInstallation({ profileRoot }) {
  const ownership = readOwnership(profileRoot);
  if (!ownership?.managed || !ownership.jarFile || !isManagedPath(profileRoot, ownership.jarFile)) {
    return { ok: false, reason: 'No launcher-managed CustomSkinLoader installation was found.' };
  }
  if (fs.existsSync(ownership.jarFile)) fs.unlinkSync(ownership.jarFile);
  if (fs.existsSync(`${ownership.jarFile}.disabled`)) fs.unlinkSync(`${ownership.jarFile}.disabled`);
  removeOwnership(profileRoot);
  return { ok: true };
}

module.exports = { installCustomSkinLoader, disableCustomSkinLoader, removeManagedInstallation, downloadVerified, isValidArchive };
