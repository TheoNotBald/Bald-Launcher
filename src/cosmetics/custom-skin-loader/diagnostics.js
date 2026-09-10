const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const { readOwnership } = require('./ownership');
const { getLocalSkinPaths } = require('./local-skin-manager');
const { validateConfig } = require('./config-manager');

function findLoaderJars(profileRoot) {
  const modsRoot = path.join(profileRoot, 'mods');
  if (!fs.existsSync(modsRoot)) return [];
  return fs.readdirSync(modsRoot)
    .filter(name => /^customskinloader.*\.jar$/i.test(name))
    .map(name => path.join(modsRoot, name));
}

function validateJar(filePath) {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile() || stat.size <= 0) return false;
    new AdmZip(filePath).getEntries();
    return true;
  } catch (_error) {
    return false;
  }
}

function diagnoseInstallation({ profileRoot, profile, compatibility }) {
  const ownership = readOwnership(profileRoot);
  const jars = findLoaderJars(profileRoot);
  const managedJar = ownership?.jarFile && fs.existsSync(ownership.jarFile) ? ownership.jarFile : null;
  const installedJar = managedJar || jars[0] || null;
  const config = validateConfig(profileRoot, { jarFile: installedJar });
  const localSkin = getLocalSkinPaths(profileRoot);
  const localSkinDirectoryValid = Object.values(localSkin).every(directory => fs.existsSync(directory) && fs.statSync(directory).isDirectory());
  const compatible = Boolean(installedJar && ownership?.minecraftVersion === profile?.mcVersion && ownership?.loader === profile?.loader && ownership?.installedVersionId === compatibility?.versionId);
  const issues = [];
  const warnings = [];
  if (!installedJar) issues.push('CustomSkinLoader JAR is not installed.');
  else if (!validateJar(installedJar)) issues.push('CustomSkinLoader JAR is not a valid ZIP/JAR archive.');
  if (!config.valid) warnings.push(config.issue || 'CustomSkinLoader configuration could not be verified.');
  if (!localSkinDirectoryValid) issues.push('The expected LocalSkin directories are missing.');
  if (jars.length > 1) warnings.push('Multiple CustomSkinLoader JARs were found.');
  if (installedJar && !ownership) warnings.push('The installed CustomSkinLoader JAR is user-owned or ownership is unknown.');
  return {
    supported: Boolean(compatibility),
    installed: Boolean(installedJar),
    compatible,
    managed: Boolean(ownership?.managed && managedJar),
    jarValid: Boolean(installedJar && validateJar(installedJar)),
    configValid: config.valid,
    configPointsToLocalSkin: config.pointsToLocalSkin === true,
    localSkinDirectoryValid,
    configPath: config.path,
    jarFile: installedJar,
    issues,
    warnings,
  };
}

module.exports = { findLoaderJars, validateJar, diagnoseInstallation };
