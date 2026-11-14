function runInstallerProcess(spawnProcess, javaPath, installerPath, args, cwd, onOutput = () => {}) {
  return new Promise((resolve, reject) => {
    let child;
    let stderrTail = '';
    let settled = false;
    const appendStderr = chunk => {
      stderrTail = `${stderrTail}${chunk}`.slice(-16 * 1024);
    };
    const reportOutput = chunk => {
      const lines = String(chunk).trim().split(/\r?\n/).filter(Boolean);
      if (lines.length) onOutput(lines[lines.length - 1]);
    };
    const fail = error => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    try {
      child = spawnProcess(javaPath, ['-jar', installerPath, ...args], {
        cwd,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      fail(error);
      return;
    }

    child.stdout?.on('data', reportOutput);
    child.stderr?.on('data', chunk => {
      appendStderr(chunk);
      reportOutput(chunk);
    });
    child.once('error', error => {
      fail(new Error(`Could not start loader installer: ${error.message}`));
    });
    child.once('close', (code, signal) => {
      if (settled) return;
      settled = true;
      if (code === 0) {
        resolve();
        return;
      }
      const status = signal ? `signal ${signal}` : `exit code ${code}`;
      const details = stderrTail.trim();
      reject(new Error(`Loader installer failed with ${status}${details ? `: ${details}` : ''}`));
    });
  });
}

module.exports = { runInstallerProcess };
