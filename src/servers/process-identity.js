'use strict';

const path = require('node:path');

function hasLaunchIdentity(runtime) {
  return Array.isArray(runtime?.launchArgs)
    && runtime.launchArgs.some(argument => String(argument).startsWith('-Dbald.launcher.launch-token='));
}

function getProcessStartTime(details) {
  const raw = String(details?.CreationDate || '');
  const windowsDate = raw.match(/\/Date\((\d+)(?:[+-]\d+)?\)\//);
  return windowsDate ? Number(windowsDate[1]) : Date.parse(raw);
}

function matchesServerProcessIdentity(server, runtime, details) {
  if (!server || !runtime?.pid || Number(details?.ProcessId) !== Number(runtime.pid)) return false;
  const commandLine = String(details.CommandLine || '').toLowerCase();
  const executablePath = String(details.ExecutablePath || '').toLowerCase();
  const javaPath = String(runtime.javaPath || '').toLowerCase();
  if (!commandLine) return false;

  if (hasLaunchIdentity(runtime)) {
    const identityArgument = runtime.launchArgs.find(argument => String(argument).startsWith('-Dbald.launcher.launch-token='));
    if (!identityArgument || !commandLine.includes(String(identityArgument).toLowerCase())) return false;
  } else {
    const jarFileName = String(server.jarFileName || runtime.jarFileName || '').toLowerCase();
    if (!jarFileName || !commandLine.includes(jarFileName)) return false;
  }

  if (javaPath && executablePath
    && path.win32.normalize(executablePath) !== path.win32.normalize(javaPath)) return false;
  if (!/(?:^|[\\/])java(?:w)?\.exe(?:"|\s|$)/i.test(commandLine) && !/\bjava(?:w)?\.exe\b/i.test(commandLine)) return false;
  const expectedStart = Number(runtime.processStartTime);
  const actualStart = getProcessStartTime(details);
  if (expectedStart > 0 && Number.isFinite(actualStart) && Math.abs(actualStart - expectedStart) > 60_000) return false;
  return true;
}

function findMatchingServerProcess(server, processes) {
  if (!server) return null;
  const runtime = server.runtime || {};
  const tokenArgument = Array.isArray(runtime.launchArgs)
    ? runtime.launchArgs.find(argument => String(argument).startsWith('-Dbald.launcher.launch-token='))
    : null;
  const token = tokenArgument ? String(tokenArgument).slice('-Dbald.launcher.launch-token='.length).toLowerCase() : '';
  const candidates = (Array.isArray(processes) ? processes : []).filter(details => {
    const commandLine = String(details.CommandLine || '').toLowerCase();
    if (token) return commandLine.includes(`-dbald.launcher.launch-token=${token}`);
    const jarFileName = String(server.jarFileName || runtime.jarFileName || '').toLowerCase();
    return Boolean(jarFileName && commandLine.includes(jarFileName) && /\bjava(?:w)?\.exe\b/i.test(commandLine));
  });
  if (token) return candidates.length === 1 ? candidates[0] : null;
  return candidates.length === 1 ? candidates[0] : null;
}

function canAdoptDiscoveredProcess(server, details) {
  if (!server || !details) return false;
  if (hasLaunchIdentity(server.runtime)) {
    const identityArgument = server.runtime.launchArgs.find(argument => String(argument).startsWith('-Dbald.launcher.launch-token='));
    return Boolean(identityArgument && String(details.CommandLine || '').toLowerCase().includes(String(identityArgument).toLowerCase()));
  }
  return Number(server.runtime?.pid) === Number(details.ProcessId)
    && matchesServerProcessIdentity(server, server.runtime, details);
}

module.exports = { canAdoptDiscoveredProcess, findMatchingServerProcess, getProcessStartTime, hasLaunchIdentity, matchesServerProcessIdentity };
