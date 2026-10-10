'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { canAdoptDiscoveredProcess, findMatchingServerProcess, matchesServerProcessIdentity } = require('../src/servers/process-identity');

const server = {
  id: 'server-a',
  jarFileName: 'server.jar',
  runtime: {
    pid: 123,
    javaPath: 'C:\\Java\\bin\\java.exe',
    jarFileName: 'server.jar',
    launchArgs: ['-jar', 'server.jar'],
    processStartTime: Date.now(),
  },
};

test('process identity rejects PID reuse, wrong Java executable, and mismatched creation time', () => {
  const matching = { ProcessId: 123, CommandLine: '"C:\\Java\\bin\\java.exe" -jar server.jar', ExecutablePath: 'C:\\Java\\bin\\java.exe', CreationDate: new Date(server.runtime.processStartTime).toISOString() };
  assert.equal(matchesServerProcessIdentity(server, server.runtime, matching), true);
  assert.equal(canAdoptDiscoveredProcess(server, matching), true);
  assert.equal(canAdoptDiscoveredProcess(server, { ...matching, ProcessId: 124 }), false);
  assert.equal(matchesServerProcessIdentity(server, server.runtime, { ...matching, ProcessId: 124 }), false);
  assert.equal(matchesServerProcessIdentity(server, server.runtime, { ...matching, ExecutablePath: 'C:\\Other\\java.exe' }), false);
  assert.equal(matchesServerProcessIdentity(server, server.runtime, { ...matching, CreationDate: new Date(server.runtime.processStartTime - 120_000).toISOString() }), false);
});

test('launch-token identity prevents another server with the same jar name from being adopted', () => {
  const tracked = {
    ...server,
    runtime: {
      ...server.runtime,
      launchArgs: ['-Dbald.launcher.launch-token=token-a', '-jar', 'server.jar'],
    },
  };
  const own = { ProcessId: 123, CommandLine: '"C:\\Java\\bin\\java.exe" -Dbald.launcher.launch-token=token-a -jar server.jar', ExecutablePath: 'C:\\Java\\bin\\java.exe' };
  const other = { ProcessId: 124, CommandLine: '"C:\\Java\\bin\\java.exe" -Dbald.launcher.launch-token=token-b -jar server.jar', ExecutablePath: 'C:\\Java\\bin\\java.exe' };
  assert.equal(matchesServerProcessIdentity(tracked, tracked.runtime, own), true);
  assert.equal(matchesServerProcessIdentity(tracked, tracked.runtime, other), false);
  assert.equal(findMatchingServerProcess(tracked, [other, own]), own);
});

test('legacy server discovery refuses ambiguous same-name jars', () => {
  const first = { ProcessId: 1, CommandLine: '"C:\\Java\\bin\\java.exe" -jar server.jar', ExecutablePath: 'C:\\Java\\bin\\java.exe' };
  const second = { ProcessId: 2, CommandLine: '"C:\\Java\\bin\\java.exe" -jar server.jar', ExecutablePath: 'C:\\Java\\bin\\java.exe' };
  assert.equal(findMatchingServerProcess(server, [first, second]), null);
});
