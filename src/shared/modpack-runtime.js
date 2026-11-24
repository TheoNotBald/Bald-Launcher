'use strict';

const ONECLIENT_MODPACK_PROJECT_ID = 'QhX1nx34';

function sortCompatibleModrinthModpackVersions(versions, mcVersion, loader) {
  const requestedVersion = String(mcVersion || '');
  const requestedLoader = String(loader || '').toLowerCase();
  return (Array.isArray(versions) ? versions : [])
    .filter(version => version
      && Array.isArray(version.game_versions)
      && version.game_versions.includes(requestedVersion)
      && Array.isArray(version.loaders)
      && version.loaders.some(value => String(value).toLowerCase() === requestedLoader)
      && Array.isArray(version.files)
      && version.files.some(file => file?.primary !== false && /\.mrpack$/i.test(String(file.filename || ''))))
    .slice()
    .sort((left, right) => {
      const releasePriority = Number(right.version_type === 'release') - Number(left.version_type === 'release');
      if (releasePriority) return releasePriority;
      const leftPublished = Date.parse(String(left.date_published || '')) || 0;
      const rightPublished = Date.parse(String(right.date_published || '')) || 0;
      if (leftPublished !== rightPublished) return rightPublished - leftPublished;
      return String(right.version_number || '').localeCompare(
        String(left.version_number || ''),
        undefined,
        { numeric: true, sensitivity: 'base' },
      );
    });
}

function validateModrinthPackDependencies(dependencies, mcVersion, loader, requireDeclaredDependencies = false) {
  const declared = dependencies && typeof dependencies === 'object' ? dependencies : {};
  const declaredMinecraft = String(declared.minecraft || '');
  if (declaredMinecraft && declaredMinecraft !== String(mcVersion)) {
    throw new Error(`The selected modpack archive targets Minecraft ${declaredMinecraft}, not ${mcVersion}.`);
  }
  const loaderKey = ['fabric-loader', 'quilt-loader', 'forge', 'neoforge'].find(key => declared[key]);
  const declaredLoader = loaderKey === 'fabric-loader' ? 'fabric'
    : loaderKey === 'quilt-loader' ? 'quilt'
      : loaderKey || '';
  if (declaredLoader && declaredLoader !== String(loader)) {
    throw new Error(`The modpack archive requires ${declaredLoader}, not ${loader}.`);
  }
  const loaderVersion = loaderKey ? String(declared[loaderKey] || '') : '';
  if (requireDeclaredDependencies
    && (declaredMinecraft !== String(mcVersion) || declaredLoader !== String(loader) || !loaderVersion)) {
    throw new Error(`The modpack archive must declare Minecraft ${mcVersion} and a ${loader} loader version.`);
  }
  return { loader: declaredLoader, loaderVersion };
}

function createOneClientProfileMetadata(sourceProfile, modpackVersion) {
  const sourceProfileId = String(sourceProfile?.id || '').trim();
  const sourceProfileName = String(sourceProfile?.name || '').trim();
  if (!sourceProfileId) throw new TypeError('A source profile is required for the OneClient profile.');

  return {
    optimizationManaged: true,
    optimizationKind: 'oneclient',
    optimizationSourceProfileId: sourceProfileId,
    optimizationSourceProfileName: sourceProfileName,
    optimizationWorldSetupComplete: false,
    optimizationReady: false,
    oneClientPackVersionId: String(modpackVersion?.id || '').slice(0, 120) || null,
    oneClientPackVersionNumber: String(modpackVersion?.version_number || '').slice(0, 80) || null,
    minecraftClientModEnabled: false,
    minecraftMenuEnabled: false,
    minecraftPerformanceButtonEnabled: false,
    minecraftInGameButtonEnabled: false,
    minecraftPerformanceHudEnabled: false,
    vanillaPerformancePresetEnabled: false,
    optimizationModsEnabled: false,
  };
}

module.exports = {
  ONECLIENT_MODPACK_PROJECT_ID,
  createOneClientProfileMetadata,
  sortCompatibleModrinthModpackVersions,
  validateModrinthPackDependencies,
};
