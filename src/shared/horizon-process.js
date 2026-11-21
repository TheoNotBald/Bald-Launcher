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
using System.ComponentModel;
using System.Runtime.InteropServices;

[ComImport]
[Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
class MMDeviceEnumeratorComObject
{
}

[ComImport]
[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator
{
    [PreserveSig] int EnumAudioEndpoints(int dataFlow, int stateMask, IntPtr devices);
    [PreserveSig] int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice device);
    [PreserveSig] int GetDevice([MarshalAs(UnmanagedType.LPWStr)] string id, out IMMDevice device);
}

[ComImport]
[Guid("D666063F-1587-4E43-81F1-B948E807363F")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice
{
    [PreserveSig] int Activate(ref Guid interfaceId, int classContext, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object instance);
}

[ComImport]
[Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioSessionManager2
{
    [PreserveSig] int GetAudioSessionControl(IntPtr sessionId, int streamFlags, out IAudioSessionControl session);
    [PreserveSig] int GetSimpleAudioVolume(IntPtr sessionId, int streamFlags, out ISimpleAudioVolume volume);
    [PreserveSig] int GetSessionEnumerator(out IAudioSessionEnumerator sessions);
    [PreserveSig] int RegisterSessionNotification(IntPtr notification);
    [PreserveSig] int UnregisterSessionNotification(IntPtr notification);
    [PreserveSig] int RegisterDuckNotification([MarshalAs(UnmanagedType.LPWStr)] string sessionId, IntPtr notification);
    [PreserveSig] int UnregisterDuckNotification(IntPtr notification);
}

[ComImport]
[Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioSessionEnumerator
{
    [PreserveSig] int GetCount(out int count);
    [PreserveSig] int GetSession(int index, out IAudioSessionControl2 session);
}

[ComImport]
[Guid("F4B1A599-7266-4319-A8CA-E70ACB11E8CD")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioSessionControl
{
    [PreserveSig] int GetState(out int state);
    [PreserveSig] int GetDisplayName(out IntPtr displayName);
    [PreserveSig] int SetDisplayName([MarshalAs(UnmanagedType.LPWStr)] string displayName, ref Guid eventContext);
    [PreserveSig] int GetIconPath(out IntPtr iconPath);
    [PreserveSig] int SetIconPath([MarshalAs(UnmanagedType.LPWStr)] string iconPath, ref Guid eventContext);
    [PreserveSig] int GetGroupingParam(out Guid groupingId);
    [PreserveSig] int SetGroupingParam(ref Guid groupingId, ref Guid eventContext);
    [PreserveSig] int RegisterAudioSessionNotification(IntPtr notification);
    [PreserveSig] int UnregisterAudioSessionNotification(IntPtr notification);
}

[ComImport]
[Guid("BFB7FF88-7239-4FC9-8FA2-07C950BE9C6D")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioSessionControl2 : IAudioSessionControl
{
    [PreserveSig] int GetSessionIdentifier(out IntPtr sessionId);
    [PreserveSig] int GetSessionInstanceIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string sessionInstanceId);
    [PreserveSig] int GetProcessId(out int processId);
    [PreserveSig] int IsSystemSoundsSession();
    [PreserveSig] int SetDuckingPreference([MarshalAs(UnmanagedType.Bool)] bool optOut);
}

[ComImport]
[Guid("87CE5498-68D6-44E5-9215-6DA47EF883D8")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface ISimpleAudioVolume
{
    [PreserveSig] int GetMasterVolume(out float volume);
    [PreserveSig] int SetMasterVolume(float volume, ref Guid eventContext);
    [PreserveSig] int GetMute([MarshalAs(UnmanagedType.Bool)] out bool muted);
    [PreserveSig] int SetMute([MarshalAs(UnmanagedType.Bool)] bool muted, ref Guid eventContext);
}

public static class BaldHorizonPersistentWindowController
{
    private delegate bool EnumWindowsCallback(IntPtr window, IntPtr state);
    private delegate void WinEventCallback(IntPtr hook, uint eventType, IntPtr window, int objectId, int childId, uint eventThread, uint eventTime);

    [StructLayout(LayoutKind.Sequential)]
    private struct CpuRateControlInformation
    {
        public uint ControlFlags;
        public uint CpuRate;
    }

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

    private static bool IsJavaToolkitWindow(IntPtr window)
    {
        return WindowTitle(window).IndexOf("AwtToolkitWindow", StringComparison.OrdinalIgnoreCase) >= 0;
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
    private static readonly Dictionary<string, bool> audioMuteStates = new Dictionary<string, bool>(StringComparer.OrdinalIgnoreCase);
    private static readonly Dictionary<int, uint> originalPriorityClasses = new Dictionary<int, uint>();
    private static readonly object resourceLock = new object();
    private static readonly System.Threading.ManualResetEvent watcherReady = new System.Threading.ManualResetEvent(false);
    private static readonly WinEventCallback watcherCallback = OnWindowEvent;
    private static System.Threading.Thread watcherThread;
    private static uint watcherThreadId;
    private static string watcherError;
    private static bool watchEnabled;
    private static bool watchTerminalsOnly;
    private static bool watchHorizonByTitle;
    private static IntPtr prewarmJob;

    private const uint CpuRateControlEnabled = 0x1;
    private const uint CpuRateControlHardCap = 0x4;
    private const uint PrewarmCpuRate = 5000;
    private const uint BelowNormalPriorityClass = 0x4000;

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr CreateJobObject(IntPtr jobAttributes, string name);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool SetInformationJobObject(IntPtr job, int informationClass, ref CpuRateControlInformation information, uint length);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr OpenProcess(uint desiredAccess, bool inheritHandle, int processId);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool IsProcessInJob(IntPtr process, IntPtr job, out bool result);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CloseHandle(IntPtr handle);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern uint GetPriorityClass(IntPtr process);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool SetPriorityClass(IntPtr process, uint priorityClass);

    private static void ConfigurePrewarmJob(bool limit)
    {
        if (prewarmJob == IntPtr.Zero)
        {
            prewarmJob = CreateJobObject(IntPtr.Zero, null);
            if (prewarmJob == IntPtr.Zero)
                throw new Win32Exception(Marshal.GetLastWin32Error(), "Could not create the Minecraft prewarm resource limit.");
        }

        var information = new CpuRateControlInformation();
        if (limit)
        {
            information.ControlFlags = CpuRateControlEnabled | CpuRateControlHardCap;
            information.CpuRate = PrewarmCpuRate;
        }
        if (!SetInformationJobObject(prewarmJob, 15, ref information, (uint)Marshal.SizeOf(typeof(CpuRateControlInformation))))
            throw new Win32Exception(Marshal.GetLastWin32Error(), "Could not configure the Minecraft prewarm CPU limit.");
    }

    private static int LimitPrewarmProcesses(IEnumerable<int> processIds)
    {
        lock (resourceLock)
        {
            ConfigurePrewarmJob(true);
            var limited = 0;
            foreach (int processId in processIds)
            {
                IntPtr process = OpenProcess(0x0001 | 0x0100 | 0x1000, false, processId);
                if (process == IntPtr.Zero)
                    continue;
                try
                {
                    uint originalPriority = GetPriorityClass(process);
                    if (originalPriority != 0 && !originalPriorityClasses.ContainsKey(processId))
                        originalPriorityClasses[processId] = originalPriority;
                    SetPriorityClass(process, BelowNormalPriorityClass);

                    bool alreadyLimited;
                    if (IsProcessInJob(process, prewarmJob, out alreadyLimited) && alreadyLimited)
                    {
                        limited++;
                    }
                    else if (AssignProcessToJobObject(prewarmJob, process))
                    {
                        limited++;
                    }
                }
                finally
                {
                    CloseHandle(process);
                }
            }
            return limited;
        }
    }

    private static int RestorePrewarmProcessLimits()
    {
        lock (resourceLock)
        {
            ConfigurePrewarmJob(false);
            foreach (var entry in originalPriorityClasses)
            {
                IntPtr process = OpenProcess(0x0001 | 0x0100 | 0x1000, false, entry.Key);
                if (process == IntPtr.Zero)
                    continue;
                try
                {
                    SetPriorityClass(process, entry.Value);
                }
                finally
                {
                    CloseHandle(process);
                }
            }
            originalPriorityClasses.Clear();
            return 0;
        }
    }

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

    private static int SetProcessAudioMute(HashSet<int> processIds, bool mute)
    {
        IMMDeviceEnumerator enumerator = null;
        IMMDevice device = null;
        IAudioSessionManager2 manager = null;
        IAudioSessionEnumerator sessions = null;
        int matched = 0;
        try
        {
            enumerator = (IMMDeviceEnumerator)new MMDeviceEnumeratorComObject();
            Marshal.ThrowExceptionForHR(enumerator.GetDefaultAudioEndpoint(0, 0, out device));
            Guid managerId = new Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F");
            object managerObject;
            Marshal.ThrowExceptionForHR(device.Activate(ref managerId, 23, IntPtr.Zero, out managerObject));
            manager = (IAudioSessionManager2)managerObject;
            Marshal.ThrowExceptionForHR(manager.GetSessionEnumerator(out sessions));
            int count;
            Marshal.ThrowExceptionForHR(sessions.GetCount(out count));
            for (int index = 0; index < count; index++)
            {
                IAudioSessionControl2 session = null;
                ISimpleAudioVolume volume = null;
                try
                {
                    if (sessions.GetSession(index, out session) < 0 || session == null)
                        continue;
                    int processId;
                    if (session.GetProcessId(out processId) < 0 || !processIds.Contains(processId))
                        continue;
                    string instanceId;
                    if (session.GetSessionInstanceIdentifier(out instanceId) < 0 || String.IsNullOrEmpty(instanceId))
                        continue;
                    volume = (ISimpleAudioVolume)session;
                    bool currentMute;
                    if (volume.GetMute(out currentMute) < 0)
                        continue;
                    if (mute)
                    {
                        if (!audioMuteStates.ContainsKey(instanceId))
                            audioMuteStates[instanceId] = currentMute;
                        if (!currentMute)
                        {
                            Guid context = Guid.Empty;
                            if (volume.SetMute(true, ref context) < 0)
                                continue;
                        }
                        matched++;
                    }
                    else
                    {
                        bool previousMute;
                        if (!audioMuteStates.TryGetValue(instanceId, out previousMute))
                            continue;
                        Guid context = Guid.Empty;
                        if (volume.SetMute(previousMute, ref context) >= 0)
                        {
                            matched++;
                            audioMuteStates.Remove(instanceId);
                        }
                    }
                }
                finally
                {
                    if (session != null) Marshal.ReleaseComObject(session);
                }
            }
        }
        finally
        {
            if (sessions != null) Marshal.ReleaseComObject(sessions);
            if (manager != null) Marshal.ReleaseComObject(manager);
            if (device != null) Marshal.ReleaseComObject(device);
            if (enumerator != null) Marshal.ReleaseComObject(enumerator);
        }
        return matched;
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
        if (action == "limit-process-tree")
            return LimitPrewarmProcesses(targets);
        if (action == "restore-process-limits")
            return RestorePrewarmProcessLimits();
        if (action == "mute-process-audio")
            return SetProcessAudioMute(targets, true);
        if (action == "restore-process-audio")
            return SetProcessAudioMute(targets, false);
        bool monitorWindows = action == "hide" || action == "hide-process" || action == "hide-terminal" || action == "hide-prewarm";
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
            if (action == "hide-process")
            {
                if (isTarget)
                {
                    if (IsWindowVisible(window))
                    {
                        ShowWindow(window, 0);
                        lock (watchLock)
                            hiddenWindows.Add(window);
                    }
                    lock (watchLock)
                    {
                        if (hiddenWindows.Contains(window) && !IsJavaToolkitWindow(window))
                            count++;
                    }
                }
                return true;
            }
            if (action == "close-process")
            {
                if (isTarget && PostMessage(window, 0x0010, IntPtr.Zero, IntPtr.Zero))
                    count++;
                return true;
            }
            bool wasHidden = false;
            if (action == "restore" || action == "restore-process")
            {
                lock (watchLock)
                    wasHidden = hiddenWindows.Contains(window);
            }
            if (action == "restore-process")
            {
                if (!isTarget && !wasHidden)
                    return true;
                if (IsJavaToolkitWindow(window))
                {
                    if (IsWindowVisible(window))
                        ShowWindow(window, 0);
                    lock (watchLock)
                        hiddenWindows.Add(window);
                    return true;
                }
                ShowWindow(window, 9);
                lock (watchLock)
                    hiddenWindows.Remove(window);
                count++;
                titledWindow = window;
                return true;
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
        if (action == "restore" || action == "restore-process")
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
    if ($rootPid -lt 0 -or ($rootPid -eq 0 -and $action -notin @('hide-terminal', 'hide-prewarm')) -or $timeoutMs -lt 1 -or $action -notin @('close', 'close-process', 'hide', 'hide-process', 'hide-terminal', 'hide-prewarm', 'limit-process-tree', 'minimize', 'mute-process-audio', 'restore', 'restore-process', 'restore-process-audio', 'restore-process-limits')) {
      throw 'The Horizon window-control request is invalid.'
    }
    $deadline = [DateTime]::UtcNow.AddMilliseconds($timeoutMs)
    do {
      if ($rootPid -eq 0) {
        $targetIds = [int[]]@()
      } elseif (-not $waitForWindow -and $action -notin @('limit-process-tree', 'mute-process-audio', 'restore-process-audio', 'restore-process-limits') -and $processTargetsByRoot.ContainsKey($rootPid)) {
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
        if ($action -notin @('close-process', 'hide-prewarm', 'hide-process', 'limit-process-tree', 'restore-process', 'mute-process-audio', 'restore-process-audio', 'restore-process-limits')) {
          [void]$targets.Remove($rootPid)
        }
        $targetIds = [int[]]@($targets)
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
    if (!['close', 'close-process', 'hide', 'hide-process', 'hide-terminal', 'hide-prewarm', 'limit-process-tree', 'minimize', 'mute-process-audio', 'restore', 'restore-process', 'restore-process-audio', 'restore-process-limits'].includes(action)) {
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
