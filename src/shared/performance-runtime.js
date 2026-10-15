'use strict';

const path = require('path');
const fs = require('fs');
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

function canCreateOptimizationProfile(profile) {
  if (!profile || profile.optimizationManaged === true) return false;
  if (!['vanilla', 'fabric', 'quilt'].includes(String(profile.loader || '').toLowerCase())) return false;
  return !Array.isArray(profile.mods) || !profile.mods.some(mod => mod && mod.enabled !== false);
}

function areProfileRootsIsolated(sourceRoot, optimizedRoot) {
  const source = path.resolve(String(sourceRoot || ''));
  const optimized = path.resolve(String(optimizedRoot || ''));
  if (source.toLowerCase() === optimized.toLowerCase()) return false;
  const sourceToOptimized = path.relative(source, optimized);
  const optimizedToSource = path.relative(optimized, source);
  const isContained = relative => relative === ''
    || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
  return !isContained(sourceToOptimized) && !isContained(optimizedToSource);
}

async function copyMinecraftVisualSettings(sourceRoot, optimizedRoot, includeIrisConfig = false) {
  if (!areProfileRootsIsolated(sourceRoot, optimizedRoot)) {
    throw new Error('The optimized profile must use a separate, non-nested directory.');
  }
  const assertNoSymlinks = async (entryPath, label) => {
    const stat = await fs.promises.lstat(entryPath);
    if (stat.isSymbolicLink()) throw new Error(`${label} contains a symbolic link and was not copied.`);
    if (stat.isDirectory()) {
      for (const entry of await fs.promises.readdir(entryPath, { withFileTypes: true })) {
        if (entry.isSymbolicLink()) throw new Error(`${label} contains a symbolic link and was not copied.`);
        if (entry.isDirectory()) await assertNoSymlinks(path.join(entryPath, entry.name), label);
      }
    } else if (!stat.isFile()) {
      throw new Error(`${label} is not a regular file or directory.`);
    }
  };

  const sourceOptions = path.join(sourceRoot, 'options.txt');
  const targetOptions = path.join(optimizedRoot, 'options.txt');
  if (fs.existsSync(sourceOptions)) {
    await assertNoSymlinks(sourceOptions, 'Minecraft options');
    if (!fs.existsSync(targetOptions)) {
      await fs.promises.copyFile(sourceOptions, targetOptions, fs.constants.COPYFILE_EXCL);
    }
  }
  for (const directoryName of ['resourcepacks', 'shaderpacks']) {
    const source = path.join(sourceRoot, directoryName);
    if (!fs.existsSync(source)) continue;
    await assertNoSymlinks(source, `Minecraft ${directoryName}`);
    const destination = path.join(optimizedRoot, directoryName);
    await fs.promises.mkdir(destination, { recursive: true });
    await fs.promises.cp(source, destination, { recursive: true, force: false, errorOnExist: false });
  }
  if (includeIrisConfig) {
    const source = path.join(sourceRoot, 'config', 'iris.properties');
    if (fs.existsSync(source)) {
      await assertNoSymlinks(source, 'Iris shader settings');
      const destination = path.join(optimizedRoot, 'config', 'iris.properties');
      await fs.promises.mkdir(path.dirname(destination), { recursive: true });
      if (!fs.existsSync(destination)) {
        await fs.promises.copyFile(source, destination, fs.constants.COPYFILE_EXCL);
      }
    }
  }
}

async function runIsolatedProfileSetup(sourceRoot, optimizedRoot, setup) {
  if (!areProfileRootsIsolated(sourceRoot, optimizedRoot)) {
    throw new Error('The optimized profile must use a separate, non-nested directory.');
  }
  try {
    return await setup();
  } catch (error) {
    try {
      await fs.promises.rm(optimizedRoot, { recursive: true, force: true });
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        'Optimization profile setup failed and its partial isolated directory could not be removed.',
      );
    }
    throw error;
  }
}

function findModSetConflicts(mods) {
  const conflicts = [];
  const installed = new Map();
  for (const mod of Array.isArray(mods) ? mods : []) {
    const projectId = String(mod?.projectId || mod?.project_id || mod?.id || '');
    if (!projectId) continue;
    const versionId = String(mod?.versionId || mod?.version_id || '');
    const previous = installed.get(projectId);
    if (previous && previous.versionId !== versionId) {
      conflicts.push({ first: previous.projectId, second: projectId, reason: 'different-versions' });
    }
    installed.set(projectId, { projectId, versionId, mod });
  }

  const visited = new Set();
  for (const { projectId, mod } of installed.values()) {
    const dependencies = Array.isArray(mod?.version?.dependencies)
      ? mod.version.dependencies
      : Array.isArray(mod?.dependencies) ? mod.dependencies : [];
    for (const dependency of dependencies) {
      if (dependency?.dependency_type !== 'incompatible' || !dependency.project_id) continue;
      const otherId = String(dependency.project_id);
      if (!installed.has(otherId)) continue;
      const pair = [projectId, otherId].sort();
      const key = pair.join('\0');
      if (visited.has(key)) continue;
      visited.add(key);
      conflicts.push({ first: pair[0], second: pair[1], reason: 'incompatible-dependency' });
    }
  }
  return conflicts;
}

function validateRendererBundleSelection(selectedProjectIds, allowedProjectIds, excludedProjectIds = []) {
  const selected = [...new Set((Array.isArray(selectedProjectIds) ? selectedProjectIds : []).map(String))];
  const allowed = new Set((Array.isArray(allowedProjectIds) ? allowedProjectIds : []).map(String));
  const excluded = new Set((Array.isArray(excludedProjectIds) ? excludedProjectIds : []).map(String));
  const excludedSelection = selected.filter(projectId => excluded.has(projectId));
  const unknownSelection = selected.filter(projectId => !allowed.has(projectId));
  if (excludedSelection.length || unknownSelection.length) {
    const reasons = [];
    if (excludedSelection.length) reasons.push(`excluded: ${excludedSelection.join(', ')}`);
    if (unknownSelection.length) reasons.push(`unsupported: ${unknownSelection.join(', ')}`);
    throw new Error(`The selected renderer bundle contains ${reasons.join('; ')}.`);
  }
  return selected;
}

function parseWindowsCommandLine(commandLine) {
  const input = String(commandLine || '');
  const args = [];
  let index = 0;
  while (index < input.length) {
    while (/\s/.test(input[index] || '')) index += 1;
    if (index >= input.length) break;
    let argument = '';
    let quoted = false;
    while (index < input.length) {
      if (!quoted && /\s/.test(input[index])) break;
      let backslashes = 0;
      while (input[index] === '\\') {
        backslashes += 1;
        index += 1;
      }
      if (input[index] === '"') {
        argument += '\\'.repeat(Math.floor(backslashes / 2));
        if (backslashes % 2) {
          argument += '"';
          index += 1;
        } else if (quoted && input[index + 1] === '"') {
          argument += '"';
          index += 2;
        } else {
          quoted = !quoted;
          index += 1;
        }
      } else {
        argument += '\\'.repeat(backslashes);
        if (index < input.length && (quoted || !/\s/.test(input[index]))) {
          argument += input[index];
          index += 1;
        }
      }
    }
    args.push(argument);
    while (/\s/.test(input[index] || '')) index += 1;
  }
  return args;
}

function parsePresentMonCsv(csv, processId) {
  const lines = String(csv || '').split(/\r?\n/).filter(line => line.trim());
  if (lines.length < 2) throw new Error('PresentMon did not produce frame samples.');
  const parseRow = line => {
    const cells = [];
    let cell = '';
    let quoted = false;
    for (let index = 0; index < line.length; index += 1) {
      const character = line[index];
      if (character === '"') {
        if (quoted && line[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          quoted = !quoted;
        }
      } else if (character === ',' && !quoted) {
        cells.push(cell);
        cell = '';
      } else {
        cell += character;
      }
    }
    cells.push(cell);
    return cells;
  };
  const headers = parseRow(lines[0]).map(header => header.trim().toLowerCase());
  const processIndex = headers.indexOf('processid');
  const frameTimeIndex = headers.indexOf('msbetweenpresents');
  if (processIndex < 0 || frameTimeIndex < 0) {
    throw new Error('PresentMon CSV is missing ProcessID or MsBetweenPresents frame data.');
  }
  const expectedPid = Number(processId);
  const frameTimes = [];
  for (const line of lines.slice(1)) {
    const row = parseRow(line);
    if (expectedPid > 0 && Number(row[processIndex]) !== expectedPid) continue;
    const frameTime = Number(row[frameTimeIndex]);
    if (Number.isFinite(frameTime) && frameTime > 0) frameTimes.push(frameTime);
  }
  if (frameTimes.length < 60) {
    throw new Error(`PresentMon captured only ${frameTimes.length} usable frame intervals; at least 60 are required.`);
  }
  const sorted = frameTimes.slice().sort((left, right) => left - right);
  const lowPercentileFrameTime = fraction => {
    const frameCount = Math.max(1, Math.ceil(sorted.length * fraction));
    const slowestFrames = sorted.slice(-frameCount);
    return slowestFrames.reduce((sum, value) => sum + value, 0) / slowestFrames.length;
  };
  const meanFrameTimeMs = frameTimes.reduce((sum, value) => sum + value, 0) / frameTimes.length;
  const p99FrameTimeMs = frameTimes.length >= 1000 ? lowPercentileFrameTime(0.01) : null;
  const p999FrameTimeMs = frameTimes.length >= 10000 ? lowPercentileFrameTime(0.001) : null;
  return {
    sampleCount: frameTimes.length,
    frameTimeMs: Number(meanFrameTimeMs.toFixed(3)),
    averageFps: Number((1000 / meanFrameTimeMs).toFixed(1)),
    onePercentLow: p99FrameTimeMs == null ? null : Number((1000 / p99FrameTimeMs).toFixed(1)),
    zeroPointOnePercentLow: p999FrameTimeMs == null ? null : Number((1000 / p999FrameTimeMs).toFixed(1)),
    p99FrameTimeMs: p99FrameTimeMs == null ? null : Number(p99FrameTimeMs.toFixed(3)),
    p999FrameTimeMs: p999FrameTimeMs == null ? null : Number(p999FrameTimeMs.toFixed(3)),
  };
}

function createBenchmarkSignature(data = {}) {
  const keys = [
    'machineId',
    'hardware',
    'sourceProfileId',
    'sceneId',
    'minecraft',
    'javaMajor',
    'javaPath',
    'javaRuntime',
    'jvmConfigurationSha256',
    'shaderRuntime',
    'optionsSha256',
    'resourcesSha256',
  ];
  return keys.map(key => `${key}=${String(data[key] ?? '')}`).join('\n');
}

function createBenchmarkConfigurationSignature(data = {}) {
  const keys = ['loader', 'loaderVersion', 'renderer', 'activeModsSha256'];
  return keys.map(key => `${key}=${String(data[key] ?? '')}`).join('\n');
}

function compareBenchmarkResults(baseline, optimized) {
  if (!baseline || !optimized || baseline.role !== 'baseline' || optimized.role !== 'optimized') {
    return { comparable: false, reason: 'Select one baseline run and one optimized-profile run.' };
  }
  if (!baseline.signature || baseline.signature !== optimized.signature) {
    return { comparable: false, reason: 'Runs differ in machine, Minecraft scene, Java, mods, or copied game settings.' };
  }
  if (!Number.isFinite(baseline.averageFps) || !Number.isFinite(optimized.averageFps)
    || baseline.averageFps <= 0 || optimized.averageFps <= 0) {
    return { comparable: false, reason: 'Both runs need measured PresentMon frame data.' };
  }
  return {
    comparable: true,
    averageFpsChangePercent: Number((((optimized.averageFps - baseline.averageFps) / baseline.averageFps) * 100).toFixed(1)),
    onePercentLowChangePercent: Number.isFinite(baseline.onePercentLow)
      && Number.isFinite(optimized.onePercentLow) && baseline.onePercentLow > 0
      ? Number((((optimized.onePercentLow - baseline.onePercentLow) / baseline.onePercentLow) * 100).toFixed(1))
      : null,
  };
}

function compareBenchmarkGroups(baselineRuns, optimizedRuns) {
  const baseline = Array.isArray(baselineRuns) ? baselineRuns.filter(run => run?.role === 'baseline' && Number.isFinite(run.averageFps)) : [];
  const optimized = Array.isArray(optimizedRuns) ? optimizedRuns.filter(run => run?.role === 'optimized' && Number.isFinite(run.averageFps)) : [];
  const signature = baseline[0]?.signature;
  if (!signature || !optimized[0]?.signature || baseline.some(run => run.signature !== signature)
    || optimized.some(run => run.signature !== signature)) {
    return { comparable: false, reason: 'Runs differ in machine, Minecraft scene, Java, mods, or copied game settings.' };
  }
  if (baseline.length < 3 || optimized.length < 3) {
    return { comparable: false, reason: `Repeat both roles at least three times (${baseline.length}/3 baseline, ${optimized.length}/3 optimized).` };
  }
  const hasConfiguration = runs => runs.some(run => run.configurationSignature);
  const configurationIsConsistent = runs => runs.every(run => run.configurationSignature
    && run.configurationSignature === runs[0].configurationSignature);
  if ((hasConfiguration(baseline) || hasConfiguration(optimized))
    && (!configurationIsConsistent(baseline) || !configurationIsConsistent(optimized))) {
    return { comparable: false, reason: 'The active loader, renderer, or mod set changed between repeated runs in at least one role.' };
  }
  const median = values => {
    const sorted = values.slice().sort((left, right) => left - right);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  };
  const range = values => ({
    min: Number(Math.min(...values).toFixed(1)),
    max: Number(Math.max(...values).toFixed(1)),
  });
  const baselineFps = baseline.map(run => run.averageFps);
  const optimizedFps = optimized.map(run => run.averageFps);
  const baselineMedianFps = median(baselineFps);
  const optimizedMedianFps = median(optimizedFps);
  const baselineLows = baseline.map(run => run.onePercentLow).filter(Number.isFinite);
  const optimizedLows = optimized.map(run => run.onePercentLow).filter(Number.isFinite);
  const baselineMedianLow = baselineLows.length >= 3 ? median(baselineLows) : null;
  const optimizedMedianLow = optimizedLows.length >= 3 ? median(optimizedLows) : null;
  return {
    comparable: true,
    baselineRuns: baseline.length,
    optimizedRuns: optimized.length,
    baselineMedianFps: Number(baselineMedianFps.toFixed(1)),
    optimizedMedianFps: Number(optimizedMedianFps.toFixed(1)),
    baselineFpsRange: range(baselineFps),
    optimizedFpsRange: range(optimizedFps),
    averageFpsChangePercent: Number((((optimizedMedianFps - baselineMedianFps) / baselineMedianFps) * 100).toFixed(1)),
    baselineMedianOnePercentLow: baselineMedianLow == null ? null : Number(baselineMedianLow.toFixed(1)),
    optimizedMedianOnePercentLow: optimizedMedianLow == null ? null : Number(optimizedMedianLow.toFixed(1)),
    onePercentLowChangePercent: baselineMedianLow != null && optimizedMedianLow != null && baselineMedianLow > 0
      ? Number((((optimizedMedianLow - baselineMedianLow) / baselineMedianLow) * 100).toFixed(1))
      : null,
  };
}

module.exports = {
  areProfileRootsIsolated,
  canCreateOptimizationProfile,
  compareBenchmarkGroups,
  compareBenchmarkResults,
  copyMinecraftVisualSettings,
  createBenchmarkConfigurationSignature,
  createBenchmarkSignature,
  findModSetConflicts,
  getJvmArguments,
  getRequiredJavaVersion,
  isOptimizationOptedIn,
  parsePresentMonCsv,
  parseWindowsCommandLine,
  recommendMinecraftMemoryGb,
  runIsolatedProfileSetup,
  validateRendererBundleSelection,
};
