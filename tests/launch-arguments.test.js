'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { redactLaunchArguments } = require('../src/shared/launch-arguments');

test('redacts split and inline access tokens from launch arguments', () => {
  const token = 'secret-access-token';
  const redacted = redactLaunchArguments([
    '--username', 'Player',
    '--accessToken', token,
    '--access_token=another-secret',
    '--ACCESS-TOKEN:last-secret',
    '--version', '1.21.1',
  ]);

  assert.deepEqual(redacted, [
    '--username', 'Player',
    '--accessToken', '[REDACTED]',
    '--access_token=[REDACTED]',
    '--ACCESS-TOKEN:[REDACTED]',
    '--version', '1.21.1',
  ]);
  assert.doesNotMatch(redacted.join(' '), /secret|another-secret|last-secret/i);
});

test('preserves non-sensitive launch arguments and safely handles invalid input', () => {
  assert.deepEqual(redactLaunchArguments(['--username', 'Player', '--uuid', '1234']), [
    '--username', 'Player', '--uuid', '1234',
  ]);
  assert.deepEqual(redactLaunchArguments(null), []);
});
