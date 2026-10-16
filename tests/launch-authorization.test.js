'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { refreshMicrosoftAuthorization } = require('../src/shared/launch-authorization');

test('refreshes Microsoft authorization even when an access token is already present', async () => {
  let receivedRefreshToken = '';
  const refreshedAuthorization = await refreshMicrosoftAuthorization({
    access_token: 'expired-access-token',
    meta: { refresh: 'current-refresh-token' },
  }, async refreshToken => {
    receivedRefreshToken = refreshToken;
    return {
      access_token: 'fresh-access-token',
      uuid: 'minecraft-account-id',
      meta: { type: 'msa', refresh: 'rotated-refresh-token' },
    };
  });

  assert.equal(receivedRefreshToken, 'current-refresh-token');
  assert.equal(refreshedAuthorization.access_token, 'fresh-access-token');
  assert.equal(refreshedAuthorization.meta.refresh, 'rotated-refresh-token');
});

test('preserves the current refresh token if the auth provider does not rotate it', async () => {
  const refreshedAuthorization = await refreshMicrosoftAuthorization({
    access_token: 'expired-access-token',
    meta: { refresh: 'current-refresh-token' },
  }, async () => ({
    access_token: 'fresh-access-token',
    meta: { type: 'msa' },
  }));

  assert.equal(refreshedAuthorization.meta.refresh, 'current-refresh-token');
});

test('rejects Microsoft authorization without a refresh token', async () => {
  await assert.rejects(
    refreshMicrosoftAuthorization({ access_token: 'stale-token', meta: {} }, async () => {
      assert.fail('must not attempt refresh without a refresh token');
    }),
    /no refresh token/i,
  );
});

test('rejects a refresh response without a Minecraft access token', async () => {
  await assert.rejects(
    refreshMicrosoftAuthorization({ meta: { refresh: 'current-refresh-token' } }, async () => ({ meta: {} })),
    /did not return a Minecraft access token/i,
  );
});
