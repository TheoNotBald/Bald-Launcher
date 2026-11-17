'use strict';

const { spawn } = require('node:child_process');

const HORIZON_WINDOW_CONTROL_SCRIPT = `
$ErrorActionPreference = 'Stop'
$rootPid = 0
if (-not [int]::TryParse($env:BALD_HORIZON_ROOT_PID, [ref]$rootPid) -or $rootPid -lt 1) {
  throw 'The Horizon launcher process ID is invalid.'
}
$action = $env:BALD_HORIZON_WINDOW_ACTION
if ($action -notin @('close', 'hide', 'minimize', 'restore')) {
  throw 'The Horizon window action is invalid.'
}
$timeoutMs = 0
if (-not [int]::TryParse($env:BALD_HORIZON_WINDOW_TIMEOUT, [ref]$timeoutMs) -or $timeoutMs -lt 0) {
  throw 'The Horizon window timeout is invalid.'
}
$waitForWindow = $env:BALD_HORIZON_WAIT_FOR_WINDOW -eq '1'
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public static class BaldHorizonWindowController
{
    private delegate bool EnumWindowsCallback(IntPtr window, IntPtr state);

    [DllImport("user32.dll")]
    private static extern bool EnumWindows(EnumWindowsCallback callback, IntPtr state);

    [DllImport("user32.dll")]
    private static extern bool IsWindowVisible(IntPtr window);

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);

    [DllImport("user32.dll")]
    private static extern bool ShowWindow(IntPtr window, int command);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool PostMessage(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);

    public static int Control(IEnumerable<int> processIds, string action)
    {
        var targets = new HashSet<int>(processIds);
        var count = 0;
        EnumWindows((window, state) =>
        {
            uint processId;
            GetWindowThreadProcessId(window, out processId);
            if (!targets.Contains((int)processId))
                return true;
            if (action == "close")
            {
                if (PostMessage(window, 0x0010, IntPtr.Zero, IntPtr.Zero))
                    count++;
            }
            else if (action == "restore")
            {
                ShowWindow(window, 9);
                count++;
            }
            else if (IsWindowVisible(window))
            {
                ShowWindow(window, action == "hide" ? 0 : 6);
                count++;
            }
            return true;
        }, IntPtr.Zero);
        return count;
    }
}
'@
$deadline = [DateTime]::UtcNow.AddMilliseconds($timeoutMs)
do {
  $processes = @(Get-CimInstance Win32_Process)
  $targets = [System.Collections.Generic.HashSet[int]]::new()
  [void]$targets.Add($rootPid)
  do {
    $changed = $false
    foreach ($process in $processes) {
      if ($targets.Contains([int]$process.ParentProcessId) -and $targets.Add([int]$process.ProcessId)) {
        $changed = $true
      }
    }
  } while ($changed)
  [void]$targets.Remove($rootPid)
  $targetIds = [int[]]@($targets | Where-Object { $_ -ne $rootPid })
  $windowCount = [BaldHorizonWindowController]::Control($targetIds, $action)
  if ($windowCount -gt 0 -or -not $waitForWindow -or [DateTime]::UtcNow -ge $deadline) {
    break
  }
  if (-not (Get-Process -Id $rootPid -ErrorAction SilentlyContinue)) {
    break
  }
  Start-Sleep -Milliseconds 100
} while ($true)
[Console]::Out.Write($windowCount)
`;

const HORIZON_WINDOW_CONTROLLER_SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public static class BaldHorizonPersistentWindowController
{
    private delegate bool EnumWindowsCallback(IntPtr window, IntPtr state);
    private delegate void WinEventCallback(IntPtr hook, uint eventType, IntPtr window, int objectId, int childId, uint eventThread, uint eventTime);

    [DllImport("user32.dll")]
    private static extern bool EnumWindows(EnumWindowsCallback callback, IntPtr state);

    [DllImport("user32.dll")]
    private static extern bool IsWindowVisible(IntPtr window);

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);

    [DllImport("user32.dll")]
    private static extern bool ShowWindow(IntPtr window, int command);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool PostMessage(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetWindowText(IntPtr window, System.Text.StringBuilder text, int maxCount);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetClassName(IntPtr window, System.Text.StringBuilder className, int maxCount);

    private static string WindowTitle(IntPtr window)
    {
        var title = new System.Text.StringBuilder(512);
        GetWindowText(window, title, title.Capacity);
        return title.ToString();
    }

    private static bool IsHorizonGameWindow(IntPtr window)
    {
        string title = WindowTitle(window);
        return String.Equals(title.Trim(), "Horizon", StringComparison.OrdinalIgnoreCase)
            && !IsHorizonTerminalWindow(window);
    }

    private static bool IsHorizonTerminalWindow(IntPtr window)
    {
        var className = new System.Text.StringBuilder(128);
        GetClassName(window, className, className.Capacity);
        string classValue = className.ToString();
        if (!String.Equals(classValue, "CASCADIA_HOSTING_WINDOW_CLASS", StringComparison.OrdinalIgnoreCase)
            && !String.Equals(classValue, "ConsoleWindowClass", StringComparison.OrdinalIgnoreCase))
            return false;
        string title = WindowTitle(window);
        return title.IndexOf("horizon-client.exe", StringComparison.OrdinalIgnoreCase) >= 0
            || title.IndexOf("horizon-rust", StringComparison.OrdinalIgnoreCase) >= 0;
    }

    [DllImport("user32.dll")]
    private static extern IntPtr SetWinEventHook(uint eventMin, uint eventMax, IntPtr module, WinEventCallback callback, uint processId, uint threadId, uint flags);

    [DllImport("user32.dll")]
    private static extern bool UnhookWinEvent(IntPtr hook);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern int GetMessage(out Message message, IntPtr window, uint min, uint max);

    [DllImport("user32.dll")]
    private static extern bool TranslateMessage(ref Message message);

    [DllImport("user32.dll")]
    private static extern IntPtr DispatchMessage(ref Message message);

    [DllImport("user32.dll")]
    private static extern bool PostThreadMessage(uint threadId, uint message, UIntPtr wParam, IntPtr lParam);

    [DllImport("kernel32.dll")]
    private static extern uint GetCurrentThreadId();

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    private static extern bool SetForegroundWindow(IntPtr window);

    [DllImport("user32.dll")]
    private static extern IntPtr SetActiveWindow(IntPtr window);

    [DllImport("user32.dll")]
    private static extern bool BringWindowToTop(IntPtr window);

    [DllImport("user32.dll")]
    private static extern bool AttachThreadInput(uint attach, uint attachTo, bool attachState);

    [DllImport("user32.dll")]
    private static extern bool PeekMessage(out Message message, IntPtr window, uint min, uint max, uint remove);

    [StructLayout(LayoutKind.Sequential)]
    private struct Point
    {
        public int X;
        public int Y;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct Message
    {
        public IntPtr Window;
        public uint Id;
        public UIntPtr WParam;
        public IntPtr LParam;
        public uint Time;
        public Point Position;
    }

    private static readonly object watchLock = new object();
    private static readonly HashSet<int> watchedProcessIds = new HashSet<int>();
    private static readonly HashSet<IntPtr> hiddenWindows = new HashSet<IntPtr>();
    private static readonly System.Threading.ManualResetEvent watcherReady = new System.Threading.ManualResetEvent(false);
    private static readonly WinEventCallback watcherCallback = OnWindowEvent;
    private static System.Threading.Thread watcherThread;
    private static uint watcherThreadId;
    private static string watcherError;
    private static bool watchEnabled;
    private static bool watchTerminalsOnly;
    private static bool watchHorizonByTitle;

    private static void WatcherLoop()
    {
        watcherThreadId = GetCurrentThreadId();
        Message message;
        PeekMessage(out message, IntPtr.Zero, 0, 0, 0);
        IntPtr hook = SetWinEventHook(0x8000, 0x800C, IntPtr.Zero, watcherCallback, 0, 0, 0);
        if (hook == IntPtr.Zero)
            watcherError = "Windows could not start the Horizon window-visibility watcher.";
        watcherReady.Set();
        if (hook == IntPtr.Zero)
            return;

        while (GetMessage(out message, IntPtr.Zero, 0, 0) > 0)
        {
            TranslateMessage(ref message);
            DispatchMessage(ref message);
        }
        UnhookWinEvent(hook);
    }

    private static void OnWindowEvent(IntPtr hook, uint eventType, IntPtr window, int objectId, int childId, uint eventThread, uint eventTime)
    {
        if ((eventType != 0x8000 && eventType != 0x8002 && eventType != 0x800C)
            || window == IntPtr.Zero || objectId != 0 || childId != 0)
            return;
        uint processId;
        GetWindowThreadProcessId(window, out processId);
        bool isTerminal = IsHorizonTerminalWindow(window);
        lock (watchLock)
        {
            bool isTarget = watchedProcessIds.Contains((int)processId);
            bool isHorizonGame = watchHorizonByTitle && IsHorizonGameWindow(window);
            if (!watchEnabled || (!isTerminal && !isHorizonGame && (!isTarget || watchTerminalsOnly)))
                return;
            ShowWindow(window, 0);
            hiddenWindows.Add(window);
        }
    }

    private static void UpdateWatch(IEnumerable<int> processIds, bool enabled, bool terminalsOnly, bool horizonByTitle)
    {
        lock (watchLock)
        {
            if (!watchEnabled && enabled)
                hiddenWindows.Clear();
            watchedProcessIds.Clear();
            foreach (int processId in processIds)
                watchedProcessIds.Add(processId);
            watchEnabled = enabled;
            watchTerminalsOnly = terminalsOnly;
            watchHorizonByTitle = horizonByTitle;
        }
    }

    public static void StartWatcher()
    {
        if (watcherThread == null)
        {
            watcherThread = new System.Threading.Thread(WatcherLoop);
            watcherThread.IsBackground = true;
            watcherThread.Start();
        }
        if (!watcherReady.WaitOne(5000))
            throw new InvalidOperationException("The Horizon window-visibility watcher did not start.");
        if (!String.IsNullOrEmpty(watcherError))
            throw new InvalidOperationException(watcherError);
    }

    public static void StopWatcher()
    {
        if (watcherThreadId != 0)
            PostThreadMessage(watcherThreadId, 0x0012, UIntPtr.Zero, IntPtr.Zero);
    }

    private static void ActivateWindow(IntPtr window)
    {
        Message message;
        PeekMessage(out message, IntPtr.Zero, 0, 0, 0);
        IntPtr foregroundWindow = GetForegroundWindow();
        uint foregroundProcessId;
        uint targetProcessId;
        uint foregroundThread = GetWindowThreadProcessId(foregroundWindow, out foregroundProcessId);
        uint targetThread = GetWindowThreadProcessId(window, out targetProcessId);
        uint currentThread = GetCurrentThreadId();
        bool attachedForeground = false;
        bool attachedTarget = false;
        try
        {
            if (foregroundThread != 0 && foregroundThread != currentThread)
                attachedForeground = AttachThreadInput(currentThread, foregroundThread, true);
            if (targetThread != 0 && targetThread != currentThread)
                attachedTarget = AttachThreadInput(currentThread, targetThread, true);
            BringWindowToTop(window);
            SetForegroundWindow(window);
            SetActiveWindow(window);
        }
        finally
        {
            if (attachedTarget)
                AttachThreadInput(currentThread, targetThread, false);
            if (attachedForeground)
                AttachThreadInput(currentThread, foregroundThread, false);
        }
    }

    public static int Control(IEnumerable<int> processIds, string action)
    {
        var targets = new HashSet<int>(processIds);
        var count = 0;
        bool monitorWindows = action == "hide" || action == "hide-terminal" || action == "hide-prewarm" || action == "restore";
        bool terminalsOnly = action == "hide-terminal" || action == "restore";
        UpdateWatch(targets, monitorWindows, terminalsOnly, action == "hide-prewarm");
        IntPtr titledWindow = IntPtr.Zero;
        EnumWindows((window, state) =>
        {
            uint processId;
            GetWindowThreadProcessId(window, out processId);
            bool isTarget = targets.Contains((int)processId);
            bool isTerminal = IsHorizonTerminalWindow(window);
            bool isHorizonGame = IsHorizonGameWindow(window);
            if (action == "hide-prewarm")
            {
                if (isTerminal && IsWindowVisible(window))
                {
                    ShowWindow(window, 0);
                    lock (watchLock)
                        hiddenWindows.Add(window);
                }
                if (isHorizonGame)
                {
                    bool hiddenByController;
                    if (IsWindowVisible(window))
                    {
                        ShowWindow(window, 0);
                        lock (watchLock)
                            hiddenWindows.Add(window);
                    }
                    lock (watchLock)
                        hiddenByController = hiddenWindows.Contains(window);
                    if (hiddenByController)
                        count++;
                }
                return true;
            }
            if (action == "hide-terminal")
            {
                if (isTerminal && IsWindowVisible(window))
                {
                    ShowWindow(window, 0);
                    lock (watchLock)
                        hiddenWindows.Add(window);
                }
                return true;
            }
            bool wasHidden = false;
            if (action == "restore")
            {
                lock (watchLock)
                    wasHidden = hiddenWindows.Contains(window);
            }
            if (!isTarget && !isTerminal && !(action == "restore" && wasHidden))
                return true;
            if (action == "close")
            {
                if (isTarget && PostMessage(window, 0x0010, IntPtr.Zero, IntPtr.Zero))
                    count++;
            }
            else if (action == "restore")
            {
                if (!isHorizonGame || (!isTarget && !wasHidden))
                    return true;
                ShowWindow(window, 9);
                lock (watchLock)
                    hiddenWindows.Remove(window);
                count++;
                if (isTarget || wasHidden)
                    titledWindow = window;
            }
            else if (action == "hide")
            {
                if (IsWindowVisible(window))
                {
                    ShowWindow(window, 0);
                    lock (watchLock)
                        hiddenWindows.Add(window);
                }
                else
                {
                    lock (watchLock)
                    {
                        if (!hiddenWindows.Contains(window))
                            return true;
                    }
                }
                if (IsHorizonGameWindow(window))
                    count++;
            }
            else if (isTarget && IsWindowVisible(window))
            {
                ShowWindow(window, 6);
                count++;
            }
            return true;
        }, IntPtr.Zero);
        if (action == "restore")
        {
            if (titledWindow != IntPtr.Zero)
                ActivateWindow(titledWindow);
        }
        return count;
    }
}
'@
[BaldHorizonPersistentWindowController]::StartWatcher()
[Console]::Out.WriteLine('{"ready":true}')
$processTargetsByRoot = @{}
while ($null -ne ($line = [Console]::In.ReadLine())) {
  $requestId = ''
  try {
    $request = ConvertFrom-Json -InputObject $line
    $requestId = [string]$request.id
    $rootPid = [int]$request.rootPid
    $action = [string]$request.action
    $timeoutMs = [int]$request.timeoutMs
    $waitForWindow = $request.waitForWindow -eq $true
    if ($rootPid -lt 0 -or ($rootPid -eq 0 -and $action -notin @('hide-terminal', 'hide-prewarm')) -or $timeoutMs -lt 1 -or $action -notin @('close', 'hide', 'hide-terminal', 'hide-prewarm', 'minimize', 'restore')) {
      throw 'The Horizon window-control request is invalid.'
    }
    $deadline = [DateTime]::UtcNow.AddMilliseconds($timeoutMs)
    do {
      if ($rootPid -eq 0) {
        $targetIds = [int[]]@()
      } elseif (-not $waitForWindow -and $processTargetsByRoot.ContainsKey($rootPid)) {
        $targetIds = $processTargetsByRoot[$rootPid]
      } else {
        $processes = @(Get-CimInstance Win32_Process)
        $targets = [System.Collections.Generic.HashSet[int]]::new()
        [void]$targets.Add($rootPid)
        do {
          $changed = $false
          foreach ($process in $processes) {
            if ($targets.Contains([int]$process.ParentProcessId) -and $targets.Add([int]$process.ProcessId)) {
              $changed = $true
            }
          }
        } while ($changed)
        [void]$targets.Remove($rootPid)
        $targetIds = [int[]]@($targets | Where-Object { $_ -ne $rootPid })
        $processTargetsByRoot[$rootPid] = $targetIds
      }
      $windowCount = [BaldHorizonPersistentWindowController]::Control($targetIds, $action)
      if ($windowCount -gt 0 -or -not $waitForWindow -or [DateTime]::UtcNow -ge $deadline) {
        break
      }
      if ($rootPid -gt 0 -and -not (Get-Process -Id $rootPid -ErrorAction SilentlyContinue)) {
        break
      }
      Start-Sleep -Milliseconds 100
    } while ($true)
    $response = @{ id = $requestId; windows = $windowCount }
  } catch {
    $response = @{ id = $requestId; error = $_.Exception.Message }
  }
  [Console]::Out.WriteLine(($response | ConvertTo-Json -Compress))
}
[BaldHorizonPersistentWindowController]::StopWatcher()
`;

function controlHorizonGameWindows(rootPid, action, {
  platform = process.platform,
  spawnProcess = spawn,
  timeoutMs = 15_000,
  waitForWindow = false,
} = {}) {
  if (platform !== 'win32') {
    return Promise.reject(new Error('Horizon game-window controls are supported on Windows only.'));
  }
  if (!Number.isSafeInteger(rootPid) || rootPid < 1) {
    return Promise.reject(new TypeError('A valid Horizon launcher process ID is required.'));
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
    return Promise.reject(new TypeError('The Horizon window-control timeout must be a positive integer.'));
  }
  if (!['close', 'hide', 'minimize', 'restore'].includes(action)) {
    return Promise.reject(new TypeError('The Horizon window action is invalid.'));
  }

  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawnProcess('powershell.exe', [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        HORIZON_WINDOW_CONTROL_SCRIPT,
      ], {
        env: {
          ...process.env,
          BALD_HORIZON_ROOT_PID: String(rootPid),
          BALD_HORIZON_WINDOW_ACTION: action,
          BALD_HORIZON_WINDOW_TIMEOUT: String(timeoutMs),
          BALD_HORIZON_WAIT_FOR_WINDOW: waitForWindow ? '1' : '0',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } catch (error) {
      reject(new Error(`Could not control the Horizon game window: ${error.message}`));
      return;
    }

    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(new Error(`Timed out while controlling the Horizon game window after ${timeoutMs} ms.`));
    }, timeoutMs);

    child.stdout?.on('data', chunk => { stdout += chunk.toString('utf8'); });
    child.stderr?.on('data', chunk => { stderr += chunk.toString('utf8'); });
    child.once('error', error => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`Could not control the Horizon game window: ${error.message}`));
    });
    child.once('close', code => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(stderr.trim() || `Horizon close request exited with code ${code}.`));
        return;
      }
      const windows = Number(stdout.trim());
      if (!Number.isSafeInteger(windows) || windows < 0) {
        reject(new Error('Horizon returned an invalid game-window control result.'));
        return;
      }
      resolve({ windows });
    });
  });
}

function closeHorizonGameWindows(rootPid, options = {}) {
  return controlHorizonGameWindows(rootPid, 'close', options);
}

function minimizeHorizonGameWindows(rootPid, options = {}) {
  return controlHorizonGameWindows(rootPid, 'minimize', {
    timeoutMs: 30_000,
    waitForWindow: true,
    ...options,
  });
}

function restoreHorizonGameWindows(rootPid, options = {}) {
  return controlHorizonGameWindows(rootPid, 'restore', {
    timeoutMs: 5_000,
    ...options,
  });
}

function createHorizonWindowController({
  platform = process.platform,
  spawnProcess = spawn,
  startupTimeoutMs = 15_000,
} = {}) {
  if (platform !== 'win32') {
    throw new Error('Horizon game-window controls are supported on Windows only.');
  }
  if (!Number.isSafeInteger(startupTimeoutMs) || startupTimeoutMs < 1) {
    throw new TypeError('The Horizon window-controller startup timeout must be a positive integer.');
  }

  let child;
  try {
    child = spawnProcess('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      HORIZON_WINDOW_CONTROLLER_SCRIPT,
    ], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
  } catch (error) {
    throw new Error(`Could not start the Horizon window controller: ${error.message}`);
  }

  let outputBuffer = '';
  let stderrTail = '';
  let closed = false;
  let readySettled = false;
  let nextRequestId = 0;
  const pending = new Map();
  let resolveReady;
  let rejectReady;
  const ready = new Promise((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });

  const failController = error => {
    closed = true;
    if (!readySettled) {
      readySettled = true;
      clearTimeout(startupTimer);
      rejectReady(error);
    }
    for (const [requestId, request] of pending) {
      clearTimeout(request.timer);
      request.reject(error);
      pending.delete(requestId);
    }
  };
  const startupTimer = setTimeout(() => {
    if (readySettled) return;
    const error = new Error(`Horizon window controller did not become ready within ${startupTimeoutMs} ms.`);
    failController(error);
    child.kill();
  }, startupTimeoutMs);

  child.stdout?.on('data', chunk => {
    outputBuffer += chunk.toString('utf8');
    let newlineIndex = outputBuffer.indexOf('\n');
    while (newlineIndex >= 0) {
      const line = outputBuffer.slice(0, newlineIndex).trim();
      outputBuffer = outputBuffer.slice(newlineIndex + 1);
      newlineIndex = outputBuffer.indexOf('\n');
      if (!line) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        failController(new Error(`Horizon window controller returned invalid output: ${line}`));
        return;
      }
      if (message.ready === true) {
        if (!readySettled) {
          readySettled = true;
          clearTimeout(startupTimer);
          resolveReady();
        }
        continue;
      }
      const requestId = String(message.id || '');
      const request = pending.get(requestId);
      if (!request) continue;
      pending.delete(requestId);
      clearTimeout(request.timer);
      if (typeof message.error === 'string') request.reject(new Error(message.error));
      else if (Number.isSafeInteger(message.windows) && message.windows >= 0) request.resolve({ windows: message.windows });
      else request.reject(new Error('Horizon returned an invalid game-window control result.'));
    }
  });
  child.stderr?.on('data', chunk => {
    stderrTail = `${stderrTail}${chunk.toString('utf8')}`.slice(-16_384);
  });
  child.once('error', error => {
    failController(new Error(`Could not run the Horizon window controller: ${error.message}`));
  });
  child.once('close', code => {
    failController(new Error(stderrTail.trim() || `Horizon window controller exited with code ${code}.`));
  });

  function control(rootPid, action, {
    timeoutMs = action === 'minimize' ? 30_000 : 5_000,
    waitForWindow = action === 'minimize' || action === 'hide',
  } = {}) {
    if (!Number.isSafeInteger(rootPid) || rootPid < 0 || (rootPid === 0 && action !== 'hide-terminal' && action !== 'hide-prewarm')) {
      return Promise.reject(new TypeError('A valid Horizon launcher process ID is required.'));
    }
    if (!['close', 'hide', 'hide-terminal', 'hide-prewarm', 'minimize', 'restore'].includes(action)) {
      return Promise.reject(new TypeError('The Horizon window action is invalid.'));
    }
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
      return Promise.reject(new TypeError('The Horizon window-control timeout must be a positive integer.'));
    }

    return ready.then(() => new Promise((resolve, reject) => {
      if (closed) {
        reject(new Error('The Horizon window controller is closed.'));
        return;
      }
      const requestId = String(++nextRequestId);
      const timer = setTimeout(() => {
        pending.delete(requestId);
        reject(new Error(`Timed out while controlling the Horizon game window after ${timeoutMs} ms.`));
      }, timeoutMs + 2_000);
      pending.set(requestId, { resolve, reject, timer });
      child.stdin.write(`${JSON.stringify({
        id: requestId,
        rootPid,
        action,
        timeoutMs,
        waitForWindow: waitForWindow === true,
      })}\n`, error => {
        if (!error) return;
        const request = pending.get(requestId);
        if (!request) return;
        pending.delete(requestId);
        clearTimeout(request.timer);
        request.reject(new Error(`Could not send a Horizon window-control request: ${error.message}`));
      });
    }));
  }

  async function close() {
    if (closed) {
      if (child.exitCode === null && !child.killed) child.kill();
      return;
    }
    child.stdin.end();
    await new Promise(resolve => {
      const timer = setTimeout(() => {
        child.kill();
        resolve();
      }, 2_000);
      child.once('close', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  return { ready, control, close };
}

module.exports = {
  closeHorizonGameWindows,
  createHorizonWindowController,
  minimizeHorizonGameWindows,
  restoreHorizonGameWindows,
};
