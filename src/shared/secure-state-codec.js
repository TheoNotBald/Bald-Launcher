'use strict';

function createSecureStateCodec(safeStorage, { onDecryptError = () => {} } = {}) {
  const encryptedAuthByAccountId = new Map();
  let migrationPending = false;

  function isAvailable() {
    return safeStorage.isEncryptionAvailable();
  }

  function deserializeState(state) {
    if (!state || typeof state !== 'object' || !Array.isArray(state.accounts)) return state;
    return {
      ...state,
      accounts: state.accounts.map(account => {
        if (!account || typeof account !== 'object') return account;
        const accountId = String(account.id || '');
        const encryptedAuth = typeof account.authEncrypted === 'string' ? account.authEncrypted : null;
        if (encryptedAuth) {
          encryptedAuthByAccountId.set(accountId, encryptedAuth);
          if (!isAvailable()) return { ...account, auth: null };
          try {
            const decrypted = JSON.parse(safeStorage.decryptString(Buffer.from(encryptedAuth, 'base64')));
            if (!decrypted || typeof decrypted !== 'object' || Array.isArray(decrypted)) {
              throw new Error('Encrypted account authorization has an invalid format.');
            }
            return { ...account, auth: decrypted };
          } catch (error) {
            onDecryptError(error, accountId);
            return { ...account, auth: null };
          }
        }
        if (account.auth) migrationPending = true;
        return account;
      }),
    };
  }

  function serializeState(state) {
    const accounts = Array.isArray(state?.accounts) ? state.accounts : [];
    const serializedAccounts = accounts.map(account => {
      if (!account || typeof account !== 'object') return account;
      const accountId = String(account.id || '');
      let encryptedAuth = encryptedAuthByAccountId.get(accountId) || null;
      if (account.auth) {
        if (!isAvailable()) {
          throw new Error('Secure credential storage is unavailable; refusing to write account tokens in plaintext.');
        }
        encryptedAuth = safeStorage.encryptString(JSON.stringify(account.auth)).toString('base64');
        encryptedAuthByAccountId.set(accountId, encryptedAuth);
      }
      const { auth, authEncrypted, ...metadata } = account;
      return encryptedAuth ? { ...metadata, authEncrypted: encryptedAuth } : metadata;
    });
    return { ...state, secureStateVersion: 1, accounts: serializedAccounts };
  }

  return {
    deserializeState,
    serializeState,
    isMigrationPending: () => migrationPending,
    markPersisted: () => { migrationPending = false; },
  };
}

module.exports = { createSecureStateCodec };
