const fs = require('fs');
const path = require('path');

function readTail(filePath, maxBytes = 2 * 1024 * 1024) {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return { text: '', readable: false, error: 'Not a file' };
    let start = Math.max(0, stat.size - maxBytes);
    const handle = fs.openSync(filePath, 'r');
    try {
      let buffer = Buffer.alloc(Math.min(stat.size, maxBytes));
      fs.readSync(handle, buffer, 0, buffer.length, start);
      if (start > 0) {
        const firstNewline = buffer.indexOf(0x0a);
        if (firstNewline < 0) {
          buffer = Buffer.alloc(0);
          start = stat.size;
        } else {
          buffer = buffer.subarray(firstNewline + 1);
          start += firstNewline + 1;
        }
      }
      return { text: buffer.toString('utf8'), readable: true, truncated: start > 0, startByte: start, fileSize: stat.size, bytesRead: buffer.length };
    } finally {
      fs.closeSync(handle);
    }
  } catch (error) {
    return { text: '', readable: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function newestTextFile(directory) {
  try {
    const files = fs.readdirSync(directory)
      .filter(file => /\.txt$/i.test(file))
      .map(file => {
        const filePath = path.join(directory, file);
        let stat;
        try { stat = fs.statSync(filePath); } catch (_error) { return null; }
        return stat.isFile() ? { filePath, mtimeMs: stat.mtimeMs } : null;
      })
      .filter(Boolean)
      .sort((left, right) => right.mtimeMs - left.mtimeMs);
    return files[0]?.filePath || null;
  } catch (_error) {
    return null;
  }
}

function parseMinecraftLogEntries(text) {
  const entries = [];
  let current = null;
  const lines = [];
  const lineByteOffsets = [];
  let byteOffset = 0;
  for (const match of String(text || '').matchAll(/[^\r\n]*(?:\r\n|\n|$)/g)) {
    const rawLine = match[0];
    if (!rawLine) break;
    const line = rawLine.replace(/(?:\r\n|\n)$/, '');
    lines.push(line);
    lineByteOffsets.push(byteOffset);
    byteOffset += Buffer.byteLength(rawLine);
  }
  const entryPattern = /^\[(?<timestamp>\d{2}:\d{2}:\d{2}(?:\.\d+)?|\d{4}-\d{2}-\d{2}[^]]*)\]\s*(?:\[[^\]]+\/(?<threadLevel>TRACE|DEBUG|INFO|WARN|WARNING|ERROR|FATAL|SEVERE)\]|\[(?<level>TRACE|DEBUG|INFO|WARN|WARNING|ERROR|FATAL|SEVERE)\])/i;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const match = line.match(entryPattern);
    if (match) {
      current = {
        lineNumber: index + 1,
        timestamp: match.groups.timestamp,
        level: (match.groups.threadLevel || match.groups.level || 'INFO').toUpperCase(),
        lines: [line],
        lineByteOffsets: [lineByteOffsets[index]],
      };
      entries.push(current);
    } else if (current) {
      current.lines.push(line);
      current.lineByteOffsets.push(lineByteOffsets[index]);
    } else if (line.trim()) {
      current = { lineNumber: index + 1, timestamp: null, level: 'INFO', lines: [line], lineByteOffsets: [lineByteOffsets[index]] };
      entries.push(current);
    }
  }

  return entries.map(entry => ({ ...entry, text: entry.lines.join('\n') }));
}

const FAILURE_RULES = [
  {
    id: 'java-runtime-mismatch',
    cause: 'Java runtime mismatch',
    confidence: 96,
    pattern: /UnsupportedClassVersionError|unsupported class file major version|class file version \d+(?:\.\d+)?|requires java version \d+|requires java \d+|not a valid java runtime/i,
    suggestedFix: 'Select the Java major version required by this Minecraft version and loader.',
  },
  {
    id: 'memory-exhaustion',
    cause: 'Insufficient memory or native threads',
    confidence: 96,
    pattern: /OutOfMemoryError|could not reserve enough space|unable to create native thread|Java heap space/i,
    suggestedFix: 'Increase allocated RAM if available, remove memory-heavy mods, or reduce render distance and shaders.',
  },
  {
    id: 'missing-dependency',
    cause: 'Missing mod dependency',
    confidence: 94,
    pattern: /(?:requires?|depends on).{0,140}(?:missing|not found|unavailable|could not be found)|(?:missing|unresolved)\s+(?:required\s+)?(?:mod|dependency)|mod resolution failed.{0,120}(?:depends|requires)/i,
    suggestedFix: 'Install the named dependency for this Minecraft version and loader, or remove the mod that requires it.',
  },
  {
    id: 'mixin-failure',
    cause: 'Incompatible mod or mixin failure',
    confidence: 94,
    pattern: /MixinApplyError|mixin.{0,100}(?:failed|failure|error)|failed to apply mixin|org\.spongepowered\.asm\.mixin/i,
    suggestedFix: 'Update or remove the mod named near the mixin error, then verify it matches this version and loader.',
  },
  {
    id: 'binary-api-conflict',
    cause: 'Incompatible mod or library versions',
    confidence: 90,
    pattern: /NoSuchMethodError|NoSuchFieldError|AbstractMethodError|IncompatibleClassChangeError/i,
    suggestedFix: 'Update or remove the mod or library named in the stack trace; these errors commonly indicate incompatible mod versions.',
  },
  {
    id: 'missing-class',
    cause: 'Missing class or mod dependency',
    confidence: 86,
    pattern: /(?:NoClassDefFoundError|ClassNotFoundException):?\s*[\w.$/]+/i,
    suggestedFix: 'Check the stack trace for the mod requesting this class, then install its required library or use a compatible version.',
  },
  {
    id: 'corrupt-archive',
    cause: 'Corrupted mod or game archive',
    confidence: 93,
    pattern: /zip END header not found|ZipException|Invalid or corrupt jarfile|not a valid mod file|central directory.*(?:not found|missing)/i,
    suggestedFix: 'Delete and redownload the affected mod or repair the game files; avoid reusing a partial download.',
  },
  {
    id: 'missing-game-file',
    cause: 'Missing game or mod file',
    confidence: 84,
    pattern: /NoSuchFileException|FileNotFoundException|Could not find [^\n]{0,120}\.jar/i,
    suggestedFix: 'Check the exact missing path in the evidence, then reinstall that mod or repair the profile files.',
  },
  {
    id: 'loader-version-conflict',
    cause: 'Mod loader or Minecraft version conflict',
    confidence: 91,
    pattern: /Incompatible mod set|ModResolutionException|requires Minecraft version|requires .* but only .* is present|FML early loading error|ModLoadingException/i,
    suggestedFix: 'Confirm each mod targets this profile’s exact Minecraft version and loader, and remove files for another loader.',
  },
  {
    id: 'renderer-initialization',
    cause: 'Graphics or renderer initialization failure',
    confidence: 88,
    pattern: /(?:Failed to create|Could not create|failed to initialize).{0,80}(?:OpenGL|GLFW|LWJGL|Vulkan|graphics context|framebuffer)|GLFW error|OpenGL context.*(?:failed|missing|not available)|graphics driver.*(?:failed|unsupported)/i,
    suggestedFix: 'Update the graphics driver and verify that the selected renderer supports this Minecraft version and loader.',
  },
  {
    id: 'authentication-failure',
    cause: 'Authentication or session failure',
    confidence: 89,
    pattern: /Invalid session|Failed to verify username|authentication servers are down|Not authenticated/i,
    suggestedFix: 'Sign in again and verify the selected Microsoft account before launching.',
  },
  {
    id: 'world-data-failure',
    cause: 'World or save data failure',
    confidence: 86,
    pattern: /Exception loading level|Anvil chunk|region file.{0,100}(?:corrupt|invalid|failed)|level\.dat.{0,80}(?:invalid|corrupt)|Failed to load world/i,
    suggestedFix: 'Back up the world, test a new world, and restore or remove the damaged region or save file.',
  },
  {
    id: 'server-port-conflict',
    cause: 'Server port is already in use',
    confidence: 95,
    pattern: /(?:Address already in use|BindException).{0,100}(?:25565|port|bind)|(?:port|bind).{0,100}(?:Address already in use|BindException)/i,
    suggestedFix: 'Stop the other process using this server port or configure this server to use a different port.',
  },
  {
    id: 'plugin-load-failure',
    cause: 'Server plugin failed to load',
    confidence: 85,
    pattern: /Error occurred while enabling [^\n]+|Could not load ['"][^'"]+\.jar['"]|Could not load plugin/i,
    suggestedFix: 'Check the named plugin and its first exception for compatibility, missing dependencies, or configuration errors.',
  },
  {
    id: 'native-jvm-crash',
    cause: 'Java runtime or native library crash',
    confidence: 93,
    pattern: /A fatal error has been detected by the Java Runtime Environment|EXCEPTION_ACCESS_VIOLATION|SIGSEGV|SIGABRT|hs_err_pid\d+\.log|JVM crash/i,
    suggestedFix: 'Check the referenced hs_err_pid file and native library named in the fatal error; update Java and graphics drivers, then test without native mods or overlays.',
  },
  {
    id: 'configuration-parse-failure',
    cause: 'Invalid mod or server configuration',
    confidence: 83,
    pattern: /(?:Failed to parse|Error parsing|Invalid configuration|Malformed YAML|JsonSyntaxException|JsonParseException|TomlParseError|UnrecognizedPropertyException).{0,180}/i,
    suggestedFix: 'Use the file and line identified in the error, restore that setting to a valid value, or move the config aside so the mod can regenerate it.',
  },
  {
    id: 'disk-or-permission-failure',
    cause: 'File access, permissions, or storage failure',
    confidence: 85,
    pattern: /(?:AccessDeniedException|Permission denied|No space left on device|There is not enough space on the disk|The process cannot access the file because it is being used by another process)/i,
    suggestedFix: 'Check free disk space, close programs holding the affected file, and ensure the launcher can write to the profile or server directory.',
  },
  {
    id: 'network-resource-failure',
    cause: 'Network or remote service failure',
    confidence: 70,
    pattern: /(?:UnknownHostException|ConnectException|SocketTimeoutException|Connection timed out|Failed to connect to the server|Failed to download).{0,140}/i,
    suggestedFix: 'Verify the network connection and service availability; if this is a multiplayer connection error, it may not indicate a local game crash.',
  },
];

function extractMissingDependencies(sources) {
  const dependencies = new Map();
  const patterns = [
    /requires version .{1,100}?\bmod ['"]([^'"]+)['"]\s+\(([\w.-]+)\)\s*,?\s*which is missing/i,
    /(?:missing|unresolved)\s+(?:required\s+)?(?:mod|dependency)\s*[:=]\s*['"]?([\w.-]+)['"]?/i,
    /mod id:\s*['"]?([\w.-]+)['"]?[^,\n]*,\s*requested by:\s*['"]?([\w.-]+)['"]?/i,
  ];
  for (const source of sources) {
    const entries = parseMinecraftLogEntries(source.text);
    for (const entry of entries) {
      for (let index = 0; index < entry.lines.length; index += 1) {
        const line = entry.lines[index];
        for (let patternIndex = 0; patternIndex < patterns.length; patternIndex += 1) {
          const match = line.match(patterns[patternIndex]);
          if (!match) continue;
          const name = patternIndex === 0 ? match[1] : match[1];
          const id = patternIndex === 0 ? match[2] : match[1];
          if (!id || id.length > 100 || !/^[\w.-]+$/.test(id)) continue;
          const normalizedId = id.toLowerCase();
          if (!dependencies.has(normalizedId)) {
            dependencies.set(normalizedId, {
              id: normalizedId,
              name: name.slice(0, 120),
              sourceId: source.id || null,
              lineNumber: entry.lineNumber + index,
              byteOffset: Number.isSafeInteger(source.startByte) ? source.startByte + entry.lineByteOffsets[index] : null,
            });
          }
          break;
        }
      }
    }
  }
  return [...dependencies.values()];
}

function collectFailureFindings(sources, exitCode) {
  const bestByRule = new Map();
  for (const source of sources) {
    const entries = parseMinecraftLogEntries(source.text);
    for (const entry of entries) {
      for (let index = 0; index < entry.lines.length; index += 1) {
        const line = entry.lines[index].trim();
        if (!line) continue;
        const context = entry.lines.slice(index + 1, index + 7).join('\n');
        const stackTraceFollows = /(?:^\s+at\s+|Caused by:|Suppressed:)/m.test(context);
        const level = entry.level === 'INFO'
          ? line.match(/\[(?:[^\]]+\/)?(TRACE|DEBUG|INFO|WARN|WARNING|ERROR|FATAL|SEVERE)\]/i)?.[1]?.toUpperCase()
          : entry.level;
        for (const rule of FAILURE_RULES) {
          if (!rule.pattern.test(line)) continue;
          const confidence = Math.max(45, Math.min(99,
            rule.confidence
            + (source.name === 'crash report' ? 4 : source.name === 'latest.log' ? 2 : -3)
            + (stackTraceFollows ? 3 : 0)
            + (['ERROR', 'FATAL', 'SEVERE'].includes(level) ? 2 : 0)
            - (exitCode === 0 ? 15 : 0)));
          const candidate = {
            id: rule.id,
            cause: rule.cause,
            confidence,
            evidence: `${source.name}${source.truncated ? ' excerpt line ' : ':'}${entry.lineNumber + index}${level && level !== 'INFO' ? ` [${level}]` : ''} ${line}`.slice(0, 600),
            sourceId: source.id || null,
            lineNumber: entry.lineNumber + index,
            byteOffset: Number.isSafeInteger(source.startByte) ? source.startByte + entry.lineByteOffsets[index] : null,
            targetText: line.slice(0, 500),
            suggestedFix: rule.suggestedFix,
            kind: 'problem',
            occurrences: 1,
          };
          const previous = bestByRule.get(rule.id);
          if (!previous) {
            bestByRule.set(rule.id, candidate);
          } else {
            candidate.occurrences = previous.occurrences + 1;
            if (candidate.confidence > previous.confidence) bestByRule.set(rule.id, candidate);
            else previous.occurrences = candidate.occurrences;
          }
          break;
        }
      }
    }
  }
  return [...bestByRule.values()];
}

function normalizeModName(value) {
  return String(value || '')
    .replace(/\.disabled$/i, '')
    .replace(/\.jar$/i, '')
    .trim()
    .toLowerCase();
}

function normalizeErrorSignature(line) {
  return String(line || '')
    .replace(/^\[[^\]]+\]\s*/, '')
    .replace(/^\[[^\]]+\]\s*/, '')
    .replace(/^\s*:\s*/, '')
    .replace(/\b(?:ERROR|FATAL|SEVERE)\b\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function summarizeLogErrors(text, limit = 5) {
  const errorLines = String(text || '').split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => /\b(?:ERROR|FATAL|SEVERE)\b|(?:Exception|Error)(?::|\s|$)|Caused by:/i.test(line));
  const grouped = new Map();
  for (const line of errorLines) {
    const signature = normalizeErrorSignature(line);
    if (!signature) continue;
    const entry = grouped.get(signature) || { message: signature, count: 0 };
    entry.count += 1;
    grouped.set(signature, entry);
  }
  const topPatterns = [...grouped.values()]
    .sort((left, right) => right.count - left.count)
    .slice(0, limit)
    .map(entry => ({ ...entry, message: entry.message.slice(0, 500) }));
  return { errorLineCount: errorLines.length, uniqueErrorPatterns: grouped.size, topPatterns };
}

function summarizeSourceErrors(sources, limit = 20) {
  const grouped = new Map();
  let errorLineCount = 0;
  const priority = { 'crash report': 2, 'latest.log': 1 };
  for (const source of sources) {
    for (const entry of parseMinecraftLogEntries(source.text)) {
      for (let index = 0; index < entry.lines.length; index += 1) {
        const line = entry.lines[index].trim();
        if (!/\b(?:ERROR|FATAL|SEVERE)\b|(?:Exception|Error)(?::|\s|$)|Caused by:/i.test(line)) continue;
        errorLineCount += 1;
        const signature = normalizeErrorSignature(line);
        if (!signature) continue;
        const pattern = grouped.get(signature) || {
          message: signature,
          count: 0,
          sourceId: source.id || null,
          sourceName: source.name,
          lineNumber: entry.lineNumber + index,
          byteOffset: Number.isSafeInteger(source.startByte) ? source.startByte + entry.lineByteOffsets[index] : null,
          targetText: line.slice(0, 500),
          sourcePriority: priority[source.name] || 0,
        };
        pattern.count += 1;
        if ((priority[source.name] || 0) > pattern.sourcePriority) {
          pattern.sourceId = source.id || null;
          pattern.sourceName = source.name;
          pattern.lineNumber = entry.lineNumber + index;
          pattern.byteOffset = Number.isSafeInteger(source.startByte) ? source.startByte + entry.lineByteOffsets[index] : null;
          pattern.targetText = line.slice(0, 500);
          pattern.sourcePriority = priority[source.name] || 0;
        }
        grouped.set(signature, pattern);
      }
    }
  }
  const topPatterns = [...grouped.values()]
    .sort((left, right) => right.count - left.count)
    .slice(0, limit)
    .map(({ sourcePriority, ...entry }) => ({ ...entry, message: entry.message.slice(0, 500) }));
  return { errorLineCount, uniqueErrorPatterns: grouped.size, topPatterns };
}

function getServerCrashExitCode(server) {
  const exitCode = Number.isInteger(server?.runtime?.lastExitCode) ? server.runtime.lastExitCode : null;
  if (exitCode !== null && exitCode !== 0) return exitCode;
  if (server?.status === 'crashed' || server?.runtime?.lastKnownState === 'crashed') return 1;
  return exitCode;
}

function analyzeMinecraftFailure(options = {}) {
  const root = options.root;
  if (!root || typeof root !== 'string') throw new Error('A Minecraft log root is required.');
  const latestLogPath = path.join(root, 'logs', 'latest.log');
  const crashReportPath = newestTextFile(path.join(root, 'crash-reports'));
  const latest = readTail(latestLogPath);
  const crash = crashReportPath ? readTail(crashReportPath) : { text: '', readable: false };
  const launcherLog = (Array.isArray(options.session?.logs)
    ? options.session.logs.map(entry => typeof entry === 'string' ? entry : entry?.line || '').join('\n')
    : '').slice(-2 * 1024 * 1024);
  const sources = [
    { id: 'crash-report', name: 'crash report', text: crash.text, startByte: crash.startByte, truncated: crash.truncated === true },
    { id: 'latest-log', name: 'latest.log', text: latest.text, startByte: latest.startByte, truncated: latest.truncated === true },
    { id: null, name: 'launcher output', text: launcherLog, startByte: null },
  ].filter(source => source.text);
  const logSummary = summarizeSourceErrors(sources);
  const findings = collectFailureFindings(sources, options.exitCode ?? null);
  const missingDependencies = options.exitCode != null && options.exitCode !== 0 ? extractMissingDependencies(sources) : [];
  const evidence = findings.map(finding => finding.evidence);
  if (logSummary.errorLineCount) {
    const sample = logSummary.topPatterns
      .slice(0, 3)
      .map(item => `${item.count}x ${item.message}`)
      .join(' | ');
    findings.push({
      cause: 'Repeated errors in server/game log',
      confidence: 78,
      evidence: `${logSummary.errorLineCount} error/exception lines across ${logSummary.uniqueErrorPatterns} distinct message patterns. Most frequent: ${sample}`,
      suggestedFix: 'Review the most frequent error pattern first. Repeated errors can identify a plugin/mod or configuration problem even when no specialized rule recognizes it.',
      kind: 'context',
      logPatterns: logSummary.topPatterns,
    });
    evidence.push(findings.at(-1).evidence);
  }

  const modsRoot = path.join(root, 'mods');
  let modFiles = [];
  try {
    modFiles = fs.existsSync(modsRoot)
      ? fs.readdirSync(modsRoot).filter(file => /\.jar(?:\.disabled)?$/i.test(file))
      : [];
  } catch (_error) {}
  const names = modFiles.map(fileName => ({ fileName, name: normalizeModName(fileName) })).filter(item => item.name);
  const groupedNames = new Map();
  for (const item of names) {
    const group = groupedNames.get(item.name) || [];
    group.push(item.fileName);
    groupedNames.set(item.name, group);
  }
  const duplicates = [...groupedNames.values()].filter(group => group.length > 1);
  if (duplicates.length) {
    findings.push({
      cause: 'Duplicate mod files',
      confidence: 82,
      evidence: `Exact full-name duplicates: ${duplicates.map(group => group.join(' and ')).join('; ')}`,
      suggestedFix: 'Review the listed files; only files with the same complete name (ignoring case and .disabled) are grouped as duplicates.',
      kind: 'warning',
    });
    evidence.push(findings.at(-1).evidence);
  }

  const exitCode = options.exitCode ?? null;
  if (!findings.length && exitCode !== null && exitCode !== 0) {
    findings.push({
      cause: 'Minecraft process failure',
      confidence: 55,
      evidence: `Minecraft exited with code ${exitCode} and no specific Codex-style rule matched the available evidence.`,
      suggestedFix: 'Review the attached log evidence, then test recently changed mods, Java, and renderer settings one at a time.',
      kind: 'warning',
    });
  }

  const unreadable = [];
  if (fs.existsSync(latestLogPath) && !latest.readable) unreadable.push({ path: latestLogPath, error: latest.error });
  if (crashReportPath && !crash.readable) unreadable.push({ path: crashReportPath, error: crash.error });
  return {
    crashed: exitCode !== null && exitCode !== 0,
    exitCode,
    profileId: options.profileId || null,
    profileName: options.profileName || null,
    crashReportPath,
    latestLogPath: fs.existsSync(latestLogPath) ? latestLogPath : null,
    findings: findings.sort((left, right) => right.confidence - left.confidence),
    missingDependencies,
    evidence: [...new Set(evidence)],
    diagnostics: {
      source: 'Aternos Codex-inspired native analyzer',
      parser: 'Timestamped log entries with continuation-line grouping',
      analyzedFiles: [crashReportPath, fs.existsSync(latestLogPath) ? latestLogPath : null].filter(Boolean),
      latestLogAvailable: fs.existsSync(latestLogPath),
      crashReportFound: Boolean(crashReportPath),
      unreadable,
      latestLogTruncated: latest.truncated === true,
      crashReportTruncated: crash.truncated === true,
      latestLogBytesRead: latest.bytesRead || 0,
      latestLogFileSize: latest.fileSize || 0,
      errorLineCount: logSummary.errorLineCount,
      uniqueErrorPatterns: logSummary.uniqueErrorPatterns,
      hasLauncherOutput: Boolean(launcherLog.trim()),
    },
    logSummary,
    analyzedAt: new Date().toISOString(),
  };
}

module.exports = { analyzeMinecraftFailure, summarizeLogErrors, summarizeSourceErrors, parseMinecraftLogEntries, extractMissingDependencies, getServerCrashExitCode, newestTextFile };
