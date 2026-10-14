'use strict';

const GIB = 1024 ** 3;

function getRequiredJavaVersion(mcVersion) {
  const version = String(mcVersion || '').trim();
  const [major = 0, minor = 0, patch = 0] = version.split('.').map(Number);
  if (major >= 25) return 25;
  if (major >= 23) return 22;
  if (major === 1) {
    if (minor >= 21 || (minor === 20 && patch >= 5)) return 21;
    if (minor >= 18) return 17;
    if (minor === 17) return 16;
    return 8;
  }
  return 21;
}

function recommendMinecraftMemoryGb(totalBytes, availableBytes, modded = false) {
  const totalGb = Number(totalBytes) / GIB;
  const availableGb = Number(availableBytes) / GIB;
  if (!Number.isFinite(totalGb) || totalGb <= 0) return 2;

  const reserveSystemGb = Math.max(2, Math.ceil(totalGb * 0.25));
  const totalBudgetGb = Math.floor(totalGb - reserveSystemGb);
  const availableBudgetGb = Number.isFinite(availableGb)
    ? Math.floor(availableGb - 1)
    : totalBudgetGb;
  const workloadLimitGb = modded ? 12 : 8;
  return Math.max(1, Math.min(workloadLimitGb, totalBudgetGb, availableBudgetGb));
}

function getJvmArguments(settings, javaMajor) {
  if (settings.jvmProfile === 'custom') {
    return String(settings.customJvmArgs || '').trim().split(/\s+/).filter(Boolean);
  }
  if (settings.jvmProfile === 'zgc' && Number(javaMajor) >= 21) {
    return ['-XX:+UseZGC', '-XX:+ZGenerational'];
  }
  return [];
}

function isOptimizationOptedIn(settings) {
  return settings?.optimizationModsEnabled === true;
}

module.exports = {
  getJvmArguments,
  getRequiredJavaVersion,
  isOptimizationOptedIn,
  recommendMinecraftMemoryGb,
};
