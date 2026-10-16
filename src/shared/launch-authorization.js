'use strict';

async function refreshMicrosoftAuthorization(authorization, refreshMinecraftAuthorization) {
  const refreshToken = String(authorization?.meta?.refresh || '');
  if (!refreshToken) {
    throw new Error('This Microsoft account has no refresh token. Relink it from the Accounts screen.');
  }

  const refreshed = await refreshMinecraftAuthorization(refreshToken);
  if (!refreshed || typeof refreshed.access_token !== 'string' || !refreshed.access_token) {
    throw new Error('Microsoft authentication did not return a Minecraft access token.');
  }

  return {
    ...refreshed,
    meta: {
      ...(refreshed.meta || {}),
      refresh: String(refreshed.meta?.refresh || refreshToken),
    },
  };
}

module.exports = { refreshMicrosoftAuthorization };
