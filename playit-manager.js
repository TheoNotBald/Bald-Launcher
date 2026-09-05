const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

function createPlayitManager({ app, shell, emit }) {
  let session = null;
  let status = 'stopped';
  let lastExit = null;
  let outputBuffer = '';
  let exitWaiter = null;

  function state() {
    return {
      status,
      pid: session?.pid || null,
      executablePath: resolveExecutablePath(),
      lastExit,
      output: outputBuffer,
    };
  }

  function emitState() {
    emit({ ...state() });
  }

  function getAgentDirectory() {
    return path.join(app.getPath('userData'), 'playit');
  }

  function getAgentPath() {
    return path.join(getAgentDirectory(), process.platform === 'win32' ? 'playit.exe' : 'playit');
  }

  function resolveExecutablePath() {
    const configured = String(process.env.BALD_LAUNCHER_PLAYIT_PATH || '').trim();
    const candidates = configured ? [configured] : [];
    if (process.platform === 'win32') {
      candidates.push(
        path.join(process.env.PROGRAMFILES || 'C:\\Program Files', 'playit_gg', 'bin', 'playit.exe'),
        path.join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'playit_gg', 'bin', 'playit.exe'),
        path.join(process.resourcesPath || '', 'playit', 'playit.exe'),
        path.join(__dirname, 'playit', 'playit.exe'),
        getAgentPath(),
      );
    } else {
      candidates.push(path.join(process.resourcesPath || '', 'playit', 'playit'));
      candidates.push(path.join(__dirname, 'playit', 'playit'));
      candidates.push(getAgentPath());
    }
    return candidates.find(candidate => candidate && fs.existsSync(candidate)) || (configured || candidates[candidates.length - 1]);
  }

  function isRunning() {
    return Boolean(session && session.pid);
  }

  function start() {
    if (isRunning()) {
      emitState();
      return { ok: true, ...state(), reused: true };
    }
    const executablePath = resolveExecutablePath();
    if (!fs.existsSync(executablePath)) {
      status = 'exited';
      lastExit = { code: null, signal: null, reason: 'executable-not-found' };
      emitState();
      return { ok: false, error: `Playit executable was not found. Expected: ${executablePath}`, ...state() };
    }

    status = 'starting';
    lastExit = null;
    emitState();
    try {
      const pty = require('node-pty');
      session = pty.spawn(executablePath, [], {
        name: 'xterm-256color',
        cols: 120,
        rows: 32,
        cwd: os.homedir(),
        env: { ...process.env, TERM: 'xterm-256color' },
        useConpty: process.platform === 'win32',
        windowsHide: true,
      });
      session.onData(data => {
        outputBuffer += data;
        if (outputBuffer.length > 200000) outputBuffer = outputBuffer.slice(-200000);
        emit({ type: 'data', data });
      });
      session.onExit(({ exitCode, signal }) => {
        lastExit = { code: exitCode, signal: signal || null };
        session = null;
        if (exitWaiter) {
          exitWaiter();
          exitWaiter = null;
        }
        status = exitCode === 0 ? 'exited' : 'crashed';
        emit({ type: 'exit', ...lastExit });
        emitState();
      });
      status = 'running';
      emitState();
      return { ok: true, ...state() };
    } catch (error) {
      session = null;
      status = 'crashed';
      lastExit = { code: null, signal: null, reason: error.message };
      emitState();
      return { ok: false, error: error.message, ...state() };
    }
  }

  async function stop() {
    if (!session) {
      status = 'stopped';
      emitState();
      return { ok: true, ...state() };
    }
    status = 'stopping';
    emitState();
    const current = session;
    const exited = new Promise(resolve => { exitWaiter = resolve; });
    try {
      current.write('\u0003');
      await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 2000))]);
    } catch (_error) {}
    if (session === current) {
      try { current.kill(); } catch (_error) {}
      session = null;
      status = 'stopped';
      emitState();
    }
    return { ok: true, ...state() };
  }

  async function restart() {
    await stop();
    return start();
  }

  function write(data) {
    if (!session) return { ok: false, error: 'Playit is not running' };
    session.write(String(data || ''));
    return { ok: true };
  }

  function resize(cols, rows) {
    if (!session) return { ok: false, error: 'Playit is not running' };
    const nextCols = Math.max(2, Math.min(500, Number(cols) || 120));
    const nextRows = Math.max(2, Math.min(200, Number(rows) || 32));
    session.resize(nextCols, nextRows);
    return { ok: true, cols: nextCols, rows: nextRows };
  }

  function clear() {
    outputBuffer = '';
    emit({ type: 'clear' });
    return { ok: true };
  }

  function openLink(url) {
    if (!/^https?:\/\//i.test(String(url || ''))) return { ok: false, error: 'Only HTTP and HTTPS links can be opened.' };
    return shell.openExternal(String(url)).then(() => ({ ok: true }));
  }

  return {
    getAgentDirectory,
    getAgentPath,
    resolveExecutablePath,
    state,
    start,
    stop,
    restart,
    write,
    resize,
    clear,
    openLink,
  };
}

module.exports = { createPlayitManager };
