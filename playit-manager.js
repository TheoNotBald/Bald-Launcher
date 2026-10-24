const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { execFileSync } = require('child_process');

function createPlayitManager({ app, shell, emit, pty: configuredPty, spawnProcess = spawn, isProcessAlive: configuredIsProcessAlive, stopTimeoutMs = 2000 }) {
  let session = null;
  let detachedSession = null;
  let detachedPoller = null;
  let detachedOutputOffset = 0;
  let status = 'stopped';
  let lastExit = null;
  let outputBuffer = '';
  let exitWaiter = null;
  let stopPromise = null;
  const isProcessAlive = configuredIsProcessAlive || isPersistentProcessAlive;
  let persistentRecordError = '';

  function state() {
    const record = readPersistentRecord();
    const persistedState = detachedSession?.pid
      ? (detachedSession.exitCode == null ? true : false)
      : record ? isProcessAlive(record.pid, record.executablePath) : false;
    const persistedRunning = persistedState === true;
    if (!session && persistedRunning) {
      status = 'running';
      if (record?.logPath && fs.existsSync(record.logPath)) {
        const content = fs.readFileSync(record.logPath);
        outputBuffer = content.subarray(Math.max(0, content.length - 200000)).toString('utf8');
      }
    } else if (!session && record && persistedState === false) {
      clearPersistentRecord();
      status = 'exited';
      lastExit ||= { code: null, signal: null, reason: 'The saved Playit process is no longer running.' };
    } else if (!session && (persistentRecordError || persistedState === null)) {
      status = 'unverified';
    }
    return {
      status,
      pid: session?.pid || detachedSession?.pid || (persistedState !== false ? record?.pid : null) || null,
      persistent: Boolean(detachedSession || (record && persistedState !== false) || persistentRecordError),
      executablePath: resolveExecutablePath(),
      lastExit,
      output: outputBuffer,
      error: persistentRecordError || (persistedState === null ? 'The saved Playit process identity could not be verified.' : ''),
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

  function getPersistentRecordPath() {
    return path.join(getAgentDirectory(), 'daemon.json');
  }

  function readPersistentRecord() {
    let content;
    try {
      content = fs.readFileSync(getPersistentRecordPath(), 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') {
        persistentRecordError = '';
        return null;
      }
      persistentRecordError = `The saved Playit background record could not be read: ${error.message}`;
      return null;
    }
    let value;
    try {
      value = JSON.parse(content);
    } catch (error) {
      persistentRecordError = `The saved Playit background record is malformed: ${error.message}`;
      return null;
    }
    if (!Number.isInteger(value.pid) || value.pid <= 0 || typeof value.executablePath !== 'string' || typeof value.logPath !== 'string') {
      persistentRecordError = 'The saved Playit background record is missing a valid process identity.';
      return null;
    }
    persistentRecordError = '';
    return value;
  }

  function writePersistentRecord(record) {
    const filePath = getPersistentRecordPath();
    const temporaryPath = `${filePath}.${process.pid}.tmp`;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(temporaryPath, JSON.stringify(record), 'utf8');
    fs.renameSync(temporaryPath, filePath);
  }

  function clearPersistentRecord() {
    try { fs.rmSync(getPersistentRecordPath(), { force: true }); } catch (error) {
      emit({ type: 'status', status: 'error', error: `Could not clear the Playit background-process record: ${error.message}` });
    }
  }

  function isPersistentProcessAlive(pid, executablePath) {
    if (!Number.isInteger(pid) || pid <= 0 || !executablePath) return false;
    if (process.platform === 'win32') {
      try {
        const output = execFileSync('powershell.exe', [
          '-NoProfile',
          '-Command',
          `(Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}").ExecutablePath`,
        ], { encoding: 'utf8', windowsHide: true, timeout: 3000 }).trim();
        if (!output) return false;
        return output.toLowerCase() === path.resolve(executablePath).toLowerCase() ? true : false;
      } catch {
        return null;
      }
    }
    try {
      process.kill(pid, 0);
    } catch (error) {
      if (error.code === 'ESRCH') return false;
      if (error.code !== 'EPERM') return null;
    }
    try {
      return fs.realpathSync(`/proc/${pid}/exe`) === fs.realpathSync(executablePath);
    } catch (error) {
      return error.code === 'ENOENT' ? false : null;
    }
  }

  function startDetached(executablePath) {
    const directory = getAgentDirectory();
    const logPath = path.join(directory, 'daemon.log');
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(logPath, '');
    const logFd = fs.openSync(logPath, 'a');
    let child;
    try {
      child = spawnProcess(executablePath, [], {
        detached: true,
        stdio: ['ignore', logFd, logFd],
        cwd: os.homedir(),
        env: { ...process.env },
        windowsHide: true,
      });
    } finally {
      fs.closeSync(logFd);
    }
    if (!child?.pid) throw new Error('The Playit background process did not provide a process ID.');
    try {
      detachedSession = child;
      detachedOutputOffset = 0;
      child.unref();
      writePersistentRecord({ pid: child.pid, executablePath: path.resolve(executablePath), logPath });
    } catch (error) {
      detachedSession = null;
      try { child.kill(); } catch (stopError) {
        emit({ type: 'status', status: 'error', error: `Playit startup failed and its background process could not be terminated: ${stopError.message}` });
      }
      throw error;
    }
    child.once('exit', (code, signal) => {
      detachedSession = null;
      if (detachedPoller) clearInterval(detachedPoller);
      detachedPoller = null;
      clearPersistentRecord();
      lastExit = { code: Number.isInteger(code) ? code : null, signal: signal || null };
      status = status === 'stopping' ? 'stopped' : code === 0 ? 'exited' : 'crashed';
      emit({ type: 'exit', ...lastExit });
      emitState();
    });
    child.once('error', error => {
      detachedSession = null;
      if (detachedPoller) clearInterval(detachedPoller);
      detachedPoller = null;
      clearPersistentRecord();
      lastExit = { code: null, signal: null, reason: error.message };
      status = 'crashed';
      emit({ type: 'status', status: 'error', error: `Playit background process failed: ${error.message}` });
      emitState();
    });
    detachedPoller = setInterval(() => {
      try {
        if (!fs.existsSync(logPath)) return;
        let content = fs.readFileSync(logPath);
        if (content.length > 1024 * 1024) {
          content = content.subarray(-200000);
          fs.writeFileSync(logPath, content);
          detachedOutputOffset = 0;
        }
        if (content.length < detachedOutputOffset) detachedOutputOffset = 0;
        const chunk = content.subarray(detachedOutputOffset).toString('utf8');
        detachedOutputOffset = content.length;
        if (!chunk) return;
        outputBuffer = `${outputBuffer}${chunk}`.slice(-200000);
        emit({ type: 'data', data: chunk });
      } catch (error) {
        emit({ type: 'status', status: 'error', error: `Could not read the Playit background log: ${error.message}` });
      }
    }, 500);
    detachedPoller.unref?.();
  }

  function isRunning() {
    const current = state();
    return Boolean((session && session.pid) || (current.persistent && current.pid));
  }

  function start({ keepRunningOnClose = false } = {}) {
    const currentState = state();
    if (currentState.error) return { ok: false, error: currentState.error, ...currentState };
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
      if (keepRunningOnClose) {
        startDetached(executablePath);
        status = 'running';
        emitState();
        return { ok: true, ...state() };
      }
      const pty = configuredPty || require('node-pty');
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
        status = status === 'stopping' ? 'stopped' : exitCode === 0 ? 'exited' : 'crashed';
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

  async function stopSession() {
    const record = readPersistentRecord();
    if (persistentRecordError || detachedSession || record) return stopDetachedSession();
    if (!session) {
      status = 'stopped';
      emitState();
      return { ok: true, ...state() };
    }
    status = 'stopping';
    emitState();
    const current = session;
    const waitForExit = timeoutMs => new Promise(resolve => {
      if (session !== current) return resolve(true);
      const timer = setTimeout(() => {
        if (exitWaiter === onExit) exitWaiter = null;
        resolve(false);
      }, timeoutMs);
      const onExit = () => {
        clearTimeout(timer);
        if (exitWaiter === onExit) exitWaiter = null;
        resolve(true);
      };
      exitWaiter = onExit;
    });
    try {
      current.write('\u0003');
      await waitForExit(stopTimeoutMs);
    } catch (error) {
      status = 'running';
      emitState();
      return { ok: false, error: `Unable to request a graceful Playit shutdown: ${error instanceof Error ? error.message : String(error)}`, ...state() };
    }
    if (session === current) {
      try {
        current.kill();
      } catch (error) {
        status = 'running';
        emitState();
        return { ok: false, error: `Unable to terminate the Playit process: ${error instanceof Error ? error.message : String(error)}`, ...state() };
      }
      await waitForExit(stopTimeoutMs);
    }
    if (session === current) {
      return { ok: false, error: 'The Playit process did not exit after the termination request.', ...state() };
    }
    return { ok: true, ...state() };
  }

  async function stopDetachedSession() {
    if (persistentRecordError) return { ok: false, error: persistentRecordError, ...state() };
    const record = readPersistentRecord();
    if (persistentRecordError) {
      status = 'unverified';
      emitState();
      return { ok: false, error: persistentRecordError, ...state() };
    }
    const child = detachedSession;
    const pid = child?.pid || record?.pid;
    const executablePath = record?.executablePath || resolveExecutablePath();
    const initialProcessState = pid ? isProcessAlive(pid, executablePath) : false;
    if (initialProcessState === null) {
      status = 'unverified';
      emitState();
      return { ok: false, error: 'The Playit process identity could not be verified. It was left running.', ...state() };
    }
    if (!pid || initialProcessState === false) {
      detachedSession = null;
      if (detachedPoller) clearInterval(detachedPoller);
      detachedPoller = null;
      clearPersistentRecord();
      status = 'stopped';
      emitState();
      return { ok: true, ...state() };
    }
    status = 'stopping';
    emitState();
    try {
      if (process.platform === 'win32') {
        execFileSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true, timeout: 10000 });
      } else {
        process.kill(-pid, 'SIGTERM');
      }
    } catch (error) {
      const processState = isProcessAlive(pid, executablePath);
      if (processState !== false) {
        status = 'running';
        emitState();
        return { ok: false, error: `Unable to stop the Playit background process: ${error.message}`, ...state() };
      }
    }
    const deadline = Date.now() + stopTimeoutMs;
    let processState = isProcessAlive(pid, executablePath);
    while (processState === true && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 100));
      processState = isProcessAlive(pid, executablePath);
    }
    if (processState !== false) {
      status = 'running';
      emitState();
      return { ok: false, error: processState === null ? 'Playit stopped responding to identity checks after the stop request. It was not reported as stopped.' : 'The Playit background process is still running after the stop request.', ...state() };
    }
    detachedSession = null;
    if (detachedPoller) clearInterval(detachedPoller);
    detachedPoller = null;
    clearPersistentRecord();
    status = 'stopped';
    lastExit = { code: null, signal: process.platform === 'win32' ? 'SIGTERM' : 'SIGTERM' };
    emit({ type: 'exit', ...lastExit });
    emitState();
    return { ok: true, ...state() };
  }

  function stop() {
    if (stopPromise) return stopPromise;
    stopPromise = stopSession().finally(() => { stopPromise = null; });
    return stopPromise;
  }

  async function restart(options) {
    const stopped = await stop();
    if (!stopped.ok) return stopped;
    return start(options);
  }

  function write(data) {
    if (detachedSession || (!session && readPersistentRecord())) {
      return { ok: false, error: 'Interactive terminal input is unavailable while Playit is running in background mode.' };
    }
    if (!session) return { ok: false, error: 'Playit is not running' };
    session.write(String(data || ''));
    return { ok: true };
  }

  function resize(cols, rows) {
    if (detachedSession || (!session && readPersistentRecord())) {
      return { ok: false, error: 'Terminal resizing is unavailable while Playit is running in background mode.' };
    }
    if (!session) return { ok: false, error: 'Playit is not running' };
    const nextCols = Math.max(2, Math.min(500, Number(cols) || 120));
    const nextRows = Math.max(2, Math.min(200, Number(rows) || 32));
    session.resize(nextCols, nextRows);
    return { ok: true, cols: nextCols, rows: nextRows };
  }

  function clear() {
    try {
      outputBuffer = '';
      const record = readPersistentRecord();
      if (persistentRecordError) return { ok: false, error: persistentRecordError };
      if (record?.logPath) fs.writeFileSync(record.logPath, '');
      detachedOutputOffset = 0;
      emit({ type: 'clear' });
      return { ok: true };
    } catch (error) {
      return { ok: false, error: `Could not clear the Playit terminal output: ${error instanceof Error ? error.message : String(error)}` };
    }
  }

  function detach() {
    if (!detachedSession) return { ok: false, error: 'Playit was not started in background mode.' };
    if (detachedPoller) clearInterval(detachedPoller);
    detachedPoller = null;
    detachedSession = null;
    status = 'running';
    emitState();
    return { ok: true, ...state() };
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
    detach,
    write,
    resize,
    clear,
    openLink,
  };
}

module.exports = { createPlayitManager };
