'use strict';

const ACCESS_TOKEN_ARGUMENT = /^-*(?:access[-_]?token)$/i;
const INLINE_ACCESS_TOKEN_ARGUMENT = /^(-*access[-_]?token)([=:]).*$/i;

function redactLaunchArguments(argumentsList) {
  if (!Array.isArray(argumentsList)) return [];
  const redacted = [];
  let redactNext = false;
  for (const value of argumentsList) {
    const argument = String(value);
    if (redactNext) {
      redacted.push('[REDACTED]');
      redactNext = false;
      continue;
    }
    const inlineMatch = argument.match(INLINE_ACCESS_TOKEN_ARGUMENT);
    if (inlineMatch) {
      redacted.push(`${inlineMatch[1]}${inlineMatch[2]}[REDACTED]`);
      continue;
    }
    redacted.push(argument);
    if (ACCESS_TOKEN_ARGUMENT.test(argument)) redactNext = true;
  }
  return redacted;
}

module.exports = { redactLaunchArguments };
