'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createSecureStateCodec } = require('../src/shared/secure-state-codec');
const { createStateStore } = require('../src/shared/state-store');

function createFakeSafeStorage(available = true) {
  return {
    isEncryptionAvailable: () => available,
    encryptString: value => Buffer.from(`encrypted:${value}`, 'utf8'),
    decryptString: value => {
      const encrypted = value.toString('utf8');
      if (!encrypted.startsWith('encrypted:')) throw new Error('Invalid ciphertext');
      return encrypted.slice('encrypted:'.length);
    },
  };
}

test('state store encrypts Microsoft auth and restores it from safe storage', t => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'bald-secure-state-'));
  t.after(() => fs.rmSync(userData, { recursive: true, force: true }));
  const filePath = path.join(userData, 'launcher-state.json');
  const auth = {
    access_token: 'access-token-secret',
    meta: { refresh: 'refresh-token-secret' },
  };
  const codec = createSecureStateCodec(createFakeSafeStorage());
  const state = {
    accounts: [{ id: 'microsoft-1', name: 'Player', type: 'Microsoft', auth }],
    profiles: [],
  };
  const store = createStateStore({
    getStateFilePath: filePath,
    initialState: state,
    serializeState: codec.serializeState,
    deserializeState: codec.deserializeState,
  });

  assert.equal(store.flush(), true);
  const persisted = fs.readFileSync(filePath, 'utf8');
  assert.doesNotMatch(persisted, /access-token-secret|refresh-token-secret|"auth"\s*:/);
  assert.match(persisted, /"authEncrypted"\s*:/);

  const readerCodec = createSecureStateCodec(createFakeSafeStorage());
  const reader = createStateStore({
    getStateFilePath: filePath,
    initialState: { accounts: [] },
    normalizeState: value => value,
    serializeState: readerCodec.serializeState,
    deserializeState: readerCodec.deserializeState,
  });
  assert.deepEqual(reader.readFromDisk().accounts[0].auth, auth);
});

test('legacy plaintext auth is marked for migration and is never persisted without encryption', () => {
  const auth = { meta: { refresh: 'legacy-refresh-token' } };
  const availableCodec = createSecureStateCodec(createFakeSafeStorage());
  const migratedState = availableCodec.deserializeState({
    accounts: [{ id: 'microsoft-1', auth }],
  });
  assert.equal(availableCodec.isMigrationPending(), true);
  const persisted = availableCodec.serializeState(migratedState);
  assert.equal(persisted.accounts[0].auth, undefined);
  assert.match(persisted.accounts[0].authEncrypted, /^[A-Za-z0-9+/]+=*$/);
  availableCodec.markPersisted();
  assert.equal(availableCodec.isMigrationPending(), false);

  const unavailableCodec = createSecureStateCodec(createFakeSafeStorage(false));
  assert.throws(
    () => unavailableCodec.serializeState({ accounts: [{ id: 'microsoft-1', auth }] }),
    /refusing to write account tokens in plaintext/,
  );
});

test('encrypted account credentials remain preserved when OS encryption is temporarily unavailable', () => {
  const auth = { meta: { refresh: 'refresh-token-secret' } };
  const writerCodec = createSecureStateCodec(createFakeSafeStorage());
  const persisted = writerCodec.serializeState({
    accounts: [{ id: 'microsoft-1', auth }],
  });

  const readerCodec = createSecureStateCodec(createFakeSafeStorage(false));
  const state = readerCodec.deserializeState(persisted);
  assert.equal(state.accounts[0].auth, null);
  assert.equal(readerCodec.serializeState(state).accounts[0].authEncrypted, persisted.accounts[0].authEncrypted);
});
