'use strict';

const fs = require('fs');
const path = require('path');

function createStateStore({ getStateFilePath, initialState, normalizeState, onPersistError }) {
  let state = normalizeState ? normalizeState(initialState || {}) : (initialState || {});
  let writeTimer = null;
  let writePending = false;

  function resolvePath() {
    if (!getStateFilePath) return null;
    return typeof getStateFilePath === 'function' ? getStateFilePath() : getStateFilePath;
  }

  function readFromDisk() {
    const targetPath = resolvePath();
    if (!targetPath) return state;

    try {
      if (!fs.existsSync(targetPath)) {
        state = normalizeState ? normalizeState(state) : state;
        return state;
      }
      const parsed = JSON.parse(fs.readFileSync(targetPath, 'utf8'));
      state = normalizeState ? normalizeState(parsed || state) : (parsed || state);
      return state;
    } catch (error) {
      if (onPersistError) onPersistError(error, 'read');
      state = normalizeState ? normalizeState(state) : state;
      return state;
    }
  }

  function flush() {
    const targetPath = resolvePath();
    if (!targetPath) return false;

    try {
      const dir = path.dirname(targetPath);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(targetPath, JSON.stringify(state, null, 2), 'utf8');
      writePending = false;
      return true;
    } catch (error) {
      if (onPersistError) onPersistError(error, 'write');
      return false;
    }
  }

  function scheduleWrite(delayMs = 400) {
    writePending = true;
    if (writeTimer) return;

    writeTimer = setTimeout(async () => {
      writeTimer = null;
      if (!writePending) return;

      const targetPath = resolvePath();
      if (!targetPath) {
        writePending = false;
        return;
      }

      try {
        const dir = path.dirname(targetPath);
        await fs.promises.mkdir(dir, { recursive: true });
        await fs.promises.writeFile(targetPath, JSON.stringify(state, null, 2), 'utf8');
        writePending = false;
      } catch (error) {
        writePending = true;
        if (onPersistError) onPersistError(error, 'write');
      }
    }, delayMs);
  }

  function clearWriteTimer() {
    if (writeTimer) {
      clearTimeout(writeTimer);
      writeTimer = null;
    }
    writePending = false;
  }

  return {
    getState: () => state,
    setState: nextState => {
      state = normalizeState ? normalizeState(nextState || state) : (nextState || state);
      return state;
    },
    readFromDisk,
    flush,
    scheduleWrite,
    clearWriteTimer,
  };
}

module.exports = { createStateStore };
