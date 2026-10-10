const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { analyzeMinecraftFailure, getServerCrashExitCode, newestTextFile, parseMinecraftLogEntries } = require('../src/crash/crash-analyzer');
const { readCrashEvidenceAtOffset } = require('../src/crash/evidence-reader');

function makeRoot(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bald-launcher-crash-'));
  for (const [relative, content] of Object.entries(files)) {
    const target = path.join(root, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content, 'utf8');
  }
  return root;
}

test('detects Codex-style dependency and Java problems with structured solutions', () => {
  const root = makeRoot({
    'logs/latest.log': 'Mod requires cloth-config but cloth-config is missing\nUnsupportedClassVersionError: class file version 65.0',
  });
  const report = analyzeMinecraftFailure({ root, profileId: 'p1', profileName: 'Test', exitCode: 1 });
  assert.equal(report.crashed, true);
  assert.equal(report.findings.length, 3);
  assert.ok(report.findings.some(item => item.cause === 'Repeated errors in server/game log'));
  assert.match(report.findings.find(item => item.cause === 'Missing mod dependency').suggestedFix, /dependency|mod/i);
  assert.equal(report.diagnostics.source, 'Aternos Codex-inspired native analyzer');
});

test('uses the newest crash report and reports unreadable evidence', () => {
  const root = makeRoot({
    'logs/latest.log': 'normal startup',
    'crash-reports/older.txt': 'OutOfMemoryError',
    'crash-reports/newer.txt': 'MixinApplyError: failed to apply mixin',
  });
  const newer = path.join(root, 'crash-reports/newer.txt');
  const older = path.join(root, 'crash-reports/older.txt');
  const now = Date.now() / 1000;
  fs.utimesSync(older, now - 20, now - 20);
  fs.utimesSync(newer, now, now);
  const report = analyzeMinecraftFailure({ root, exitCode: 1 });
  assert.equal(path.basename(report.crashReportPath), 'newer.txt');
  assert.equal(report.findings[0].cause, 'Incompatible mod or mixin failure');
});

test('exposes the newest crash-report resolver for exact-evidence navigation', () => {
  const root = makeRoot({
    'crash-reports/older.txt': 'older report',
    'crash-reports/newer.txt': 'newer report',
    'crash-reports/ignored.log': 'not a crash report',
  });
  const directory = path.join(root, 'crash-reports');
  const older = path.join(directory, 'older.txt');
  const newer = path.join(directory, 'newer.txt');
  const now = Date.now() / 1000;
  fs.utimesSync(older, now - 20, now - 20);
  fs.utimesSync(newer, now, now);
  assert.equal(newestTextFile(directory), newer);
});

test('detects duplicate mod files without treating version suffixes as different mods', () => {
  const root = makeRoot({
    'mods/lithium-fabric-0.12.0.jar': '',
    'mods/lithium-fabric-0.13.0.jar': '',
    'logs/latest.log': '',
  });
  const report = analyzeMinecraftFailure({ root, exitCode: null });
  assert.equal(report.findings.some(item => item.cause === 'Duplicate mod files'), false);
});

test('duplicate detection compares the full filename and shows full names without stripping version suffixes', () => {
  const root = makeRoot({
    'mods/lithium-fabric-0.12.0.jar': '',
    'mods/Lithium-Fabric-0.12.0.jar.disabled': '',
    'mods/lithium-fabric-0.13.0.jar': '',
  });
  const report = analyzeMinecraftFailure({ root, exitCode: null });
  const duplicate = report.findings.find(item => item.cause === 'Duplicate mod files');
  assert.ok(duplicate);
  assert.match(duplicate.evidence, /lithium-fabric-0\.12\.0\.jar/i);
  assert.match(duplicate.evidence, /Lithium-Fabric-0\.12\.0\.jar\.disabled/);
  assert.doesNotMatch(duplicate.evidence, /lithium-fabric-0\.13\.0\.jar/);
});

test('uses launcher output when log files are absent and returns a useful unknown-failure result', () => {
  const root = makeRoot({});
  const report = analyzeMinecraftFailure({
    root,
    exitCode: 1,
    session: { logs: [{ line: 'java.lang.OutOfMemoryError: Java heap space' }] },
  });
  assert.equal(report.findings[0].cause, 'Insufficient memory or native threads');
  assert.equal(report.diagnostics.hasLauncherOutput, true);
  assert.equal(report.latestLogPath, null);

  const unknown = analyzeMinecraftFailure({ root, exitCode: 2 });
  assert.equal(unknown.findings[0].cause, 'Minecraft process failure');
});

test('rejects missing log roots instead of returning a success-shaped empty analysis', () => {
  assert.throws(() => analyzeMinecraftFailure({}), /log root is required/i);
});

test('reports repeated errors and summarizes the most frequent patterns from large server logs', () => {
  const repeated = Array.from({ length: 300 }, (_, index) => `[Server thread/ERROR]: Failed to load plugin config ${index % 2}`).join('\n');
  const root = makeRoot({ 'logs/latest.log': repeated });
  const report = analyzeMinecraftFailure({ root, exitCode: 1 });
  const summary = report.findings.find(item => item.cause === 'Repeated errors in server/game log');
  assert.ok(summary);
  assert.match(summary.evidence, /300 error\/exception lines/);
  assert.equal(report.diagnostics.errorLineCount, 300);
  assert.equal(report.logSummary.topPatterns[0].count, 150);
  assert.equal(report.logSummary.topPatterns[0].sourceId, 'latest-log');
  assert.match(report.logSummary.topPatterns[0].targetText, /Failed to load plugin config/);
  assert.ok(Number.isSafeInteger(report.logSummary.topPatterns[0].byteOffset));
  assert.equal(report.diagnostics.latestLogBytesRead, Buffer.byteLength(repeated));
});

test('detects a server crash from persisted runtime state after server status returns to idle', () => {
  assert.equal(getServerCrashExitCode({ status: 'idle', runtime: { lastKnownState: 'crashed', lastExitCode: 1 } }), 1);
  assert.equal(getServerCrashExitCode({ status: 'idle', runtime: { lastKnownState: 'stopped', lastExitCode: 0 } }), 0);
  assert.equal(getServerCrashExitCode({ status: 'idle', runtime: { lastKnownState: 'stopped' } }), null);
});

test('parses timestamped Minecraft entries and keeps stack trace continuation lines attached', () => {
  const entries = parseMinecraftLogEntries([
    '[12:00:00] [Server thread/ERROR]: Plugin initialization failed',
    'java.lang.NoSuchMethodError: example.Api.call()',
    '    at example.plugin.Main.enable(Main.java:42)',
    '[12:00:01] [Server thread/INFO]: Server is stopping',
  ].join('\n'));
  assert.equal(entries.length, 2);
  assert.equal(entries[0].level, 'ERROR');
  assert.equal(entries[0].lineNumber, 1);
  assert.match(entries[0].text, /at example\.plugin\.Main\.enable/);
  assert.equal(entries[1].level, 'INFO');
});

test('avoids classifying benign renderer and loader mentions as crash causes', () => {
  const root = makeRoot({
    'logs/latest.log': [
      '[12:00:00] [Render thread/INFO]: OpenGL vendor: Example Graphics',
      '[12:00:01] [main/INFO]: fabric-loader 0.16.0 loaded successfully',
    ].join('\n'),
  });
  const report = analyzeMinecraftFailure({ root, exitCode: 0 });
  assert.equal(report.findings.some(item => item.cause === 'Graphics or renderer initialization failure'), false);
  assert.equal(report.findings.some(item => item.cause === 'Mod loader or Minecraft version conflict'), false);
});

test('uses crash-report and stack-trace context to prioritize a concrete binary incompatibility', () => {
  const root = makeRoot({
    'logs/latest.log': '[12:00:00] [main/ERROR]: NoSuchMethodError: old log event',
    'crash-reports/failure.txt': [
      '---- Minecraft Crash Report ----',
      'Description: Rendering overlay',
      'java.lang.NoSuchMethodError: example.Api.render()',
      '    at example.mod.Renderer.draw(Renderer.java:18)',
      '    at net.minecraft.client.Minecraft.run(Minecraft.java:99)',
    ].join('\n'),
  });
  const report = analyzeMinecraftFailure({ root, exitCode: 1 });
  const finding = report.findings.find(item => item.cause === 'Incompatible mod or library versions');
  assert.ok(finding);
  assert.match(finding.evidence, /crash report:3/);
  assert.ok(finding.confidence > 90);
  assert.match(finding.suggestedFix, /stack trace/i);
  assert.equal(finding.sourceId, 'crash-report');
  assert.equal(finding.lineNumber, 3);
  assert.equal(finding.byteOffset, Buffer.byteLength('---- Minecraft Crash Report ----\nDescription: Rendering overlay\n'));
});

test('extracts exact missing mod IDs only from explicit loader dependency diagnostics', () => {
  const root = makeRoot({
    'logs/latest.log': [
      '[12:00:00] [main/ERROR]: Mod \'Example\' (example) requires version 1.0 or later of mod \'Fabric API\' (fabric-api), which is missing!',
      '[12:00:01] [main/INFO]: This line mentions a missing mod but does not name a required project.',
    ].join('\n'),
  });
  const report = analyzeMinecraftFailure({ root, exitCode: 1 });
  assert.deepEqual(report.missingDependencies.map(item => item.id), ['fabric-api']);
  assert.equal(report.missingDependencies[0].name, 'Fabric API');
  assert.equal(report.missingDependencies[0].lineNumber, 1);
  assert.equal(report.missingDependencies[0].sourceId, 'latest-log');
  const cleanExit = analyzeMinecraftFailure({ root, exitCode: 0 });
  assert.deepEqual(cleanExit.missingDependencies, []);
});

test('recognizes server bind and plugin-load failures with targeted recommendations', () => {
  const root = makeRoot({
    'logs/latest.log': [
      '[12:00:00] [Server thread/ERROR]: Could not load \'plugins/Example.jar\'',
      'java.net.BindException: Address already in use: bind',
    ].join('\n'),
  });
  const report = analyzeMinecraftFailure({ root, exitCode: 1 });
  assert.ok(report.findings.some(item => item.cause === 'Server plugin failed to load'));
  assert.ok(report.findings.some(item => item.cause === 'Server port is already in use'));
  assert.ok(report.findings.find(item => item.cause === 'Server port is already in use').suggestedFix.includes('different port'));
});

test('reduces diagnosis confidence for a matched error in a clean exit log', () => {
  const root = makeRoot({ 'logs/latest.log': 'UnsupportedClassVersionError: class file version 65.0' });
  const crashed = analyzeMinecraftFailure({ root, exitCode: 1 });
  const cleanExit = analyzeMinecraftFailure({ root, exitCode: 0 });
  const crashedFinding = crashed.findings.find(item => item.cause === 'Java runtime mismatch');
  const cleanExitFinding = cleanExit.findings.find(item => item.cause === 'Java runtime mismatch');
  assert.ok(cleanExitFinding);
  assert.ok(cleanExitFinding.confidence < crashedFinding.confidence);
});

test('opens an exact byte-addressed log line with true line numbers and rejects stale evidence', () => {
  const prefix = `INFO 🌍\r\n${Array.from({ length: 9000 }, (_, index) => `INFO ${index}`).join('\r\n')}\r\n`;
  const targetLine = '[Server thread/ERROR]: Exact failure location';
  const content = `${prefix}${targetLine}\r\n    at example.Main.run(Main.java:12)\r\n`;
  const root = makeRoot({ 'logs/latest.log': content });
  const filePath = path.join(root, 'logs/latest.log');
  const byteOffset = Buffer.byteLength(prefix);
  const evidence = readCrashEvidenceAtOffset(filePath, byteOffset, targetLine);
  assert.equal(evidence.lineNumber, 9002);
  assert.equal(evidence.lines.find(line => line.target).text, targetLine);
  assert.throws(() => readCrashEvidenceAtOffset(filePath, byteOffset, 'a different log line'), /log has changed/i);
  assert.throws(() => readCrashEvidenceAtOffset(filePath, Buffer.byteLength(content) + 1), /no longer available/i);
});
