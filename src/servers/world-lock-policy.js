'use strict';

function shouldPromptForStaleWorldLock(runtime) {
  return !(runtime?.lastKnownState === 'stopped' && runtime.lastExitCode === 0);
}

module.exports = { shouldPromptForStaleWorldLock };
