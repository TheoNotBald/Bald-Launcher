'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
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
} = require('../src/shared/performance-runtime');
const { redactLaunchArguments } = require('../src/shared/launch-arguments');

const gib = 1024 ** 3;

test('uses Minecraft-version-appropriate minimum Java versions', () => {
  assert.equal(getRequiredJavaVersion('1.16.5'), 8);
  assert.equal(getRequiredJavaVersion('1.17.1'), 16);
  assert.equal(getRequiredJavaVersion('1.18.2'), 17);
  assert.equal(getRequiredJavaVersion('1.20.4'), 17);
  assert.equal(getRequiredJavaVersion('1.20.5'), 21);
  assert.equal(getRequiredJavaVersion('1.21.1'), 21);
});

test('recommends a conservative heap while reserving memory for Windows and other apps', () => {
  assert.equal(recommendMinecraftMemoryGb(8 * gib, 7 * gib), 6);
  assert.equal(recommendMinecraftMemoryGb(4 * gib, 1.5 * gib), 1);
  assert.equal(recommendMinecraftMemoryGb(64 * gib, 60 * gib), 8);
  assert.equal(recommendMinecraftMemoryGb(16 * gib, 14 * gib, true), 12);
  assert.equal(recommendMinecraftMemoryGb(0, 0), 2);
});

test('uses Java defaults unless an explicitly selected JVM profile is supported', () => {
  assert.deepEqual(getJvmArguments({ jvmProfile: 'default' }, 21), []);
  assert.deepEqual(getJvmArguments({ jvmProfile: 'zgc' }, 17), []);
  assert.deepEqual(getJvmArguments({ jvmProfile: 'zgc' }, 21), [
    '-XX:+UseZGC',
    '-XX:+ZGenerational',
  ]);
});

test('preserves user-supplied JVM arguments in custom mode', () => {
  assert.deepEqual(getJvmArguments({
    jvmProfile: 'custom',
    customJvmArgs: ' -Dexample=true  -XX:+UseG1GC ',
  }, 21), ['-Dexample=true', '-XX:+UseG1GC']);
});

  test('performance mods remain opt-in for existing and new settings', () => {
    assert.equal(isOptimizationOptedIn(undefined), false);
    assert.equal(isOptimizationOptedIn({ performancePreset: 'max-fps-pvp' }), false);
    assert.equal(isOptimizationOptedIn({ optimizationModsEnabled: false }), false);
    assert.equal(isOptimizationOptedIn({ optimizationModsEnabled: true }), true);
  });

  test('does not create managed optimizations over active mods or unsupported loaders', () => {
    assert.equal(canCreateOptimizationProfile({ loader: 'vanilla', mods: [] }), true);
    assert.equal(canCreateOptimizationProfile({ loader: 'fabric', mods: [{ enabled: false }] }), true);
    assert.equal(canCreateOptimizationProfile({ loader: 'fabric', mods: [{ enabled: true }] }), false);
    assert.equal(canCreateOptimizationProfile({ loader: 'forge', mods: [] }), false);
    assert.equal(canCreateOptimizationProfile({ loader: 'vanilla', optimizationManaged: true }), false);
  });

  test('requires optimized and source Minecraft roots to be separate sibling trees', () => {
    assert.equal(areProfileRootsIsolated('C:\\profiles\\vanilla', 'C:\\profiles\\optimized'), true);
    assert.equal(areProfileRootsIsolated('C:\\profiles\\same', 'C:\\profiles\\same'), false);
    assert.equal(areProfileRootsIsolated('C:\\profiles', 'C:\\profiles\\optimized'), false);
    assert.equal(areProfileRootsIsolated('C:\\profiles\\vanilla', 'C:\\profiles\\vanilla\\nested'), false);
  });

  test('copies game settings and visual assets byte-for-byte into the isolated profile', async t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bald-performance-profile-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const source = path.join(root, 'profiles', 'vanilla');
    const optimized = path.join(root, 'profiles', 'optimized');
    fs.mkdirSync(path.join(source, 'resourcepacks'), { recursive: true });
    fs.mkdirSync(path.join(source, 'shaderpacks'), { recursive: true });
    fs.mkdirSync(path.join(source, 'config'), { recursive: true });
    fs.mkdirSync(optimized, { recursive: true });
    const options = Buffer.from('graphicsMode:0\nrenderDistance:12\nshaderPack:test.zip\n');
    fs.writeFileSync(path.join(source, 'options.txt'), options);
    fs.writeFileSync(path.join(source, 'resourcepacks', 'custom.zip'), 'resource pack bytes');
    fs.writeFileSync(path.join(source, 'shaderpacks', 'test.zip'), 'shader pack bytes');
    fs.writeFileSync(path.join(source, 'config', 'iris.properties'), 'shaderPackScreen=advanced\n');

    await copyMinecraftVisualSettings(source, optimized, true);

    assert.deepEqual(fs.readFileSync(path.join(source, 'options.txt')), options);
    assert.deepEqual(fs.readFileSync(path.join(optimized, 'options.txt')), options);
    assert.equal(fs.readFileSync(path.join(optimized, 'resourcepacks', 'custom.zip'), 'utf8'), 'resource pack bytes');
    assert.equal(fs.readFileSync(path.join(optimized, 'shaderpacks', 'test.zip'), 'utf8'), 'shader pack bytes');
    assert.equal(fs.readFileSync(path.join(optimized, 'config', 'iris.properties'), 'utf8'), 'shaderPackScreen=advanced\n');
  });

  test('rolls back a partial optimization directory without touching the source profile', async t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bald-performance-rollback-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const source = path.join(root, 'profiles', 'vanilla');
    const optimized = path.join(root, 'profiles', 'optimized');
    fs.mkdirSync(source, { recursive: true });
    fs.mkdirSync(optimized, { recursive: true });
    fs.writeFileSync(path.join(source, 'options.txt'), 'renderDistance:12\n');

    await assert.rejects(runIsolatedProfileSetup(source, optimized, async () => {
      fs.writeFileSync(path.join(optimized, 'partial-mod.jar'), 'partial download');
      throw new Error('simulated verified-download failure');
    }), /simulated verified-download failure/);

    assert.equal(fs.existsSync(optimized), false);
    assert.equal(fs.readFileSync(path.join(source, 'options.txt'), 'utf8'), 'renderDistance:12\n');
  });

  test('finds incompatible mod releases before they are combined', () => {
    assert.deepEqual(findModSetConflicts([
      { id: 'entity-culling', versionId: 'a', version: { dependencies: [{ dependency_type: 'incompatible', project_id: 'more-culling' }] } },
      { id: 'more-culling', versionId: 'b', version: { dependencies: [] } },
      { id: 'sodium', versionId: 'c', version: { dependencies: [] } },
    ]), [{ first: 'entity-culling', second: 'more-culling', reason: 'incompatible-dependency' }]);
    assert.equal(findModSetConflicts([
      { projectId: 'uuid-a', versionId: 'a', version: { dependencies: [{ dependency_type: 'incompatible', project_id: 'uuid-b' }] } },
      { projectId: 'uuid-b', versionId: 'b', version: { dependencies: [] } },
    ]).length, 1);
  });

  test('rejects renderer bundle entries that are excluded or outside the verified allowlist', () => {
    assert.deepEqual(validateRendererBundleSelection(
      ['sodium', 'lithium'],
      ['sodium', 'lithium', 'ferrite-core'],
      ['entityculling', 'more-culling'],
    ), ['sodium', 'lithium']);
    assert.throws(() => validateRendererBundleSelection(
      ['sodium', 'entityculling'],
      ['sodium', 'lithium', 'ferrite-core'],
      ['entityculling', 'more-culling'],
    ), /excluded: entityculling/);
    assert.throws(() => validateRendererBundleSelection(
      ['sodium', 'unknown-mod'],
      ['sodium', 'lithium'],
    ), /unsupported: unknown-mod/);
    assert.deepEqual(validateRendererBundleSelection(['sodium', 'sodium'], ['sodium']), ['sodium']);
  });

  test('parses quoted Windows Java command lines without splitting paths', () => {
    assert.deepEqual(parseWindowsCommandLine('"C:\\Program Files\\Java\\bin\\javaw.exe" -Xmx4G "-Dpath=a b" --accessToken secret'), [
      'C:\\Program Files\\Java\\bin\\javaw.exe',
      '-Xmx4G',
      '-Dpath=a b',
      '--accessToken',
      'secret',
    ]);
    assert.deepEqual(redactLaunchArguments(parseWindowsCommandLine('"C:\\Java\\bin\\javaw.exe" --accessToken "not-for-diagnostics" -Xmx4G')), [
      'C:\\Java\\bin\\javaw.exe',
      '--accessToken',
      '[REDACTED]',
      '-Xmx4G',
    ]);
  });

  test('derives average FPS and reliable low percentiles from PresentMon frame intervals', () => {
    const rows = ['ProcessID,MsBetweenPresents'];
    for (let index = 0; index < 1200; index += 1) {
      rows.push(`1234,${index >= 1170 ? 50 : 10}`);
    }
    const metrics = parsePresentMonCsv(rows.join('\r\n'), 1234);
    assert.equal(metrics.sampleCount, 1200);
    assert.equal(metrics.averageFps, 90.9);
    assert.equal(metrics.onePercentLow, 20);
    assert.equal(metrics.zeroPointOnePercentLow, null);
    const longCapture = ['ProcessID,MsBetweenPresents'];
    for (let index = 0; index < 12000; index += 1) {
      longCapture.push(`1234,${index >= 11700 ? 50 : 10}`);
    }
    assert.equal(parsePresentMonCsv(longCapture.join('\n'), 1234).zeroPointOnePercentLow, 20);
    assert.throws(() => parsePresentMonCsv('ProcessID,MsBetweenPresents\n1234,10', 1234), /at least 60/);
    assert.throws(() => parsePresentMonCsv('PID,FrameTime\n1234,10', 1234), /missing ProcessID/);
  });

  test('compares benchmark runs only when their full measurement signatures match', () => {
    const common = {
      machineId: 'machine-a',
      hardware: 'cpu/gpu/os',
      sourceProfileId: 'source-1',
      sceneId: 'world at spawn',
      minecraft: '1.21.1',
      javaMajor: 21,
      javaPath: 'C:\\Java\\bin\\javaw.exe',
      javaRuntime: 'openjdk version 21.0.5',
      jvmConfigurationSha256: 'args',
      optionsSha256: 'options',
      resourcesSha256: 'resources',
    };
    const signature = createBenchmarkSignature(common);
    const baseline = { role: 'baseline', signature, averageFps: 100, onePercentLow: 60 };
    const optimized = { role: 'optimized', signature, averageFps: 125, onePercentLow: 75 };
    assert.deepEqual(compareBenchmarkResults(baseline, optimized), {
      comparable: true,
      averageFpsChangePercent: 25,
      onePercentLowChangePercent: 25,
    });
    assert.equal(compareBenchmarkResults(baseline, { ...optimized, signature: 'different' }).comparable, false);
    assert.equal(compareBenchmarkResults(baseline, { ...optimized, averageFps: null }).comparable, false);
    for (const key of ['javaPath', 'javaRuntime', 'jvmConfigurationSha256']) {
      assert.notEqual(createBenchmarkSignature({ ...common, [key]: `different-${key}` }), signature, `${key} must participate in benchmark identity`);
    }
    const baselineConfig = createBenchmarkConfigurationSignature({
      loader: 'vanilla',
      loaderVersion: '1.21.1',
      renderer: 'vanilla',
      activeModsSha256: 'none',
    });
    const optimizedConfig = createBenchmarkConfigurationSignature({
      loader: 'fabric',
      loaderVersion: 'fabric-loader-0.16.9',
      renderer: 'sodium',
      activeModsSha256: 'sodium-mod-set',
    });
    assert.equal(compareBenchmarkGroups([baseline], [optimized]).comparable, false);
    const baselineRuns = [100, 102, 98].map(averageFps => ({ ...baseline, averageFps }));
    const optimizedRuns = [120, 125, 115].map(averageFps => ({ ...optimized, averageFps }));
    const aggregate = compareBenchmarkGroups(
      baselineRuns.map(run => ({ ...run, configurationSignature: baselineConfig })),
      optimizedRuns.map(run => ({ ...run, configurationSignature: optimizedConfig })),
    );
    assert.equal(aggregate.comparable, true);
    assert.equal(aggregate.averageFpsChangePercent, 20);
    assert.deepEqual(aggregate.baselineFpsRange, { min: 98, max: 102 });
    assert.equal(compareBenchmarkGroups(
      [...baselineRuns.slice(1), { ...baselineRuns[0], configurationSignature: 'changed' }],
      optimizedRuns.map(run => ({ ...run, configurationSignature: optimizedConfig })),
    ).comparable, false);
    assert.equal(compareBenchmarkGroups(
      baselineRuns,
      optimizedRuns.map(run => ({ ...run, configurationSignature: optimizedConfig })),
    ).comparable, false);
  });
