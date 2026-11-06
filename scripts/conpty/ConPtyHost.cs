// Test-only native pseudoconsole host. No shell, PID-based kill, or third-party code.
// API/lifetime reference: https://learn.microsoft.com/windows/console/creating-a-pseudoconsole-session
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;

internal static class ConPtyHost {
    static readonly object OutputLock = new();
    static void Emit(object value) { lock (OutputLock) Console.WriteLine(JsonSerializer.Serialize(value)); }
    static void Check(bool ok) { if (!ok) throw new Win32Exception(Marshal.GetLastWin32Error()); }
    static void Close(ref IntPtr handle) { if (handle != IntPtr.Zero) { Check(CloseHandle(handle)); handle = IntPtr.Zero; } }
    static string Quote(string value) {
        var result = new StringBuilder("\""); int slashes = 0;
        foreach (char c in value) {
            if (c == '\\') { slashes++; continue; }
            result.Append('\\', c == '"' ? slashes * 2 + 1 : slashes); result.Append(c); slashes = 0;
        }
        return result.Append('\\', slashes * 2).Append('"').ToString();
    }
    public static int Main(string[] args) {
        IntPtr inputRead = IntPtr.Zero, inputWrite = IntPtr.Zero, outputRead = IntPtr.Zero, outputWrite = IntPtr.Zero;
        IntPtr console = IntPtr.Zero, attributes = IntPtr.Zero, job = IntPtr.Zero;
        PROCESS_INFORMATION process = new(); Thread? reader = null; bool attributesReady = false;
        uint? exitCode = null; bool outputDrained = false; int result = 1;
        try {
            if (!OperatingSystem.IsWindows() || args.Length < 2) throw new ArgumentException("Windows and executable/program arguments required");
            Check(CreatePipe(out inputRead, out inputWrite, IntPtr.Zero, 0));
            Check(CreatePipe(out outputRead, out outputWrite, IntPtr.Zero, 0));
            int hr = CreatePseudoConsole(new COORD { X = 160, Y = 60 }, inputRead, outputWrite, 0, out console);
            Marshal.ThrowExceptionForHR(hr);
            Emit(new { type = "conpty", api = "CreatePseudoConsole", hresult = hr, columns = 160, rows = 60, os = Environment.OSVersion.ToString(), helperRuntime = Environment.Version.ToString() });
            IntPtr size = IntPtr.Zero;
            InitializeProcThreadAttributeList(IntPtr.Zero, 1, 0, ref size);
            attributes = Marshal.AllocHGlobal(size);
            Check(InitializeProcThreadAttributeList(attributes, 1, 0, ref size)); attributesReady = true;
            Check(UpdateProcThreadAttribute(attributes, 0, (IntPtr)0x00020016, console, (IntPtr)IntPtr.Size, IntPtr.Zero, IntPtr.Zero));
            var startup = new STARTUPINFOEX { StartupInfo = new STARTUPINFO { cb = Marshal.SizeOf<STARTUPINFOEX>() }, lpAttributeList = attributes };
            job = CreateJobObjectW(IntPtr.Zero, null); Check(job != IntPtr.Zero);
            var limits = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION(); limits.BasicLimitInformation.LimitFlags = 0x2000; // KILL_ON_JOB_CLOSE
            Check(SetInformationJobObject(job, 9, ref limits, (uint)Marshal.SizeOf<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>()));
            // Suspension allows assignment of this exact child handle before it can spawn descendants.
            Check(CreateProcessW(args[0], new StringBuilder(string.Join(" ", args.Select(Quote))), IntPtr.Zero, IntPtr.Zero, false, 0x00080004, IntPtr.Zero, null, ref startup, out process));
            Check(AssignProcessToJobObject(job, process.hProcess));
            reader = new Thread(() => {
                var buffer = new byte[8192];
                while (ReadFile(outputRead, buffer, (uint)buffer.Length, out uint count, IntPtr.Zero) && count > 0)
                    Emit(new { type = "output", data = Convert.ToBase64String(buffer, 0, (int)count) });
            }); reader.IsBackground = true; reader.Start();
            Check(ResumeThread(process.hThread) != uint.MaxValue);
            Close(ref inputRead); Close(ref outputWrite); Close(ref process.hThread);
            Emit(new { type = "started", pid = process.dwProcessId, command = args, assignedToOwnedJob = true });
            var writer = new Thread(() => {
                try {
                    string? line;
                    while ((line = Console.ReadLine()) != null) {
                        using var doc = JsonDocument.Parse(line);
                        if (doc.RootElement.GetProperty("type").GetString() == "input") {
                            byte[] bytes = Convert.FromBase64String(doc.RootElement.GetProperty("data").GetString()!);
                            Check(WriteFile(inputWrite, bytes, (uint)bytes.Length, out uint written, IntPtr.Zero));
                            if (written != bytes.Length) throw new IOException("Partial terminal input write");
                        } else if (doc.RootElement.GetProperty("type").GetString() == "abort") {
                            Check(TerminateJobObject(job, 1)); // An owned kernel job handle, never process lookup.
                        }
                    }
                } catch (Exception error) { Emit(new { type = "input-error", error = error.Message }); }
            }); writer.IsBackground = true; writer.Start();
            uint wait = WaitForSingleObject(process.hProcess, 240000);
            if (wait != 0) throw new TimeoutException($"Owned child did not exit normally: wait={wait}");
            Check(GetExitCodeProcess(process.hProcess, out uint code)); exitCode = code;
            Emit(new { type = "exit", exitCode }); result = code == 0 ? 0 : 1;
        } catch (Exception error) { Emit(new { type = "error", error = error.ToString() }); }
        finally {
            // Keep draining output while ClosePseudoConsole emits its final frame.
            if (console != IntPtr.Zero) { ClosePseudoConsole(console); console = IntPtr.Zero; }
            if (reader != null) outputDrained = reader.Join(10000);
            if (job != IntPtr.Zero) { Close(ref job); } // Only assigned child/descendant handles, never a numeric PID.
            if (process.hProcess != IntPtr.Zero) {
                uint wait = WaitForSingleObject(process.hProcess, 10000);
                if (wait != 0) result = 1;
                Emit(new { type = "child-cleanup", exited = wait == 0 });
                Close(ref process.hProcess);
            }
            Close(ref process.hThread); Close(ref inputRead); Close(ref inputWrite); Close(ref outputRead); Close(ref outputWrite);
            if (attributesReady) DeleteProcThreadAttributeList(attributes);
            if (attributes != IntPtr.Zero) Marshal.FreeHGlobal(attributes);
            Emit(new { type = "cleanup", pseudoconsoleClosed = console == IntPtr.Zero, outputDrained, handlesClosed = true, ownedJobClosed = job == IntPtr.Zero, normalExit = exitCode == 0 });
            if (!outputDrained) result = 1;
        }
        return result;
    }

    [StructLayout(LayoutKind.Sequential)] struct COORD { public short X, Y; }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] struct STARTUPINFO {
        public int cb; public string? lpReserved, lpDesktop, lpTitle;
        public uint dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars, dwFillAttribute, dwFlags;
        public short wShowWindow, cbReserved2; public IntPtr lpReserved2, hStdInput, hStdOutput, hStdError;
    }
    [StructLayout(LayoutKind.Sequential)] struct STARTUPINFOEX { public STARTUPINFO StartupInfo; public IntPtr lpAttributeList; }
    [StructLayout(LayoutKind.Sequential)] struct PROCESS_INFORMATION { public IntPtr hProcess, hThread; public uint dwProcessId, dwThreadId; }
    [StructLayout(LayoutKind.Sequential)] struct JOBOBJECT_BASIC_LIMIT_INFORMATION { public long PerProcessUserTimeLimit, PerJobUserTimeLimit; public uint LimitFlags; public UIntPtr MinimumWorkingSetSize, MaximumWorkingSetSize; public uint ActiveProcessLimit; public UIntPtr Affinity; public uint PriorityClass, SchedulingClass; }
    [StructLayout(LayoutKind.Sequential)] struct IO_COUNTERS { public ulong ReadOperationCount, WriteOperationCount, OtherOperationCount, ReadTransferCount, WriteTransferCount, OtherTransferCount; }
    [StructLayout(LayoutKind.Sequential)] struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION { public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation; public IO_COUNTERS IoInfo; public UIntPtr ProcessMemoryLimit, JobMemoryLimit, PeakProcessMemoryUsed, PeakJobMemoryUsed; }
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool CreatePipe(out IntPtr read, out IntPtr write, IntPtr attributes, uint size);
    [DllImport("kernel32.dll")] static extern int CreatePseudoConsole(COORD size, IntPtr input, IntPtr output, uint flags, out IntPtr console);
    [DllImport("kernel32.dll")] static extern void ClosePseudoConsole(IntPtr console);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool InitializeProcThreadAttributeList(IntPtr list, int count, uint flags, ref IntPtr size);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool UpdateProcThreadAttribute(IntPtr list, uint flags, IntPtr attribute, IntPtr value, IntPtr size, IntPtr previous, IntPtr returned);
    [DllImport("kernel32.dll")] static extern void DeleteProcThreadAttributeList(IntPtr list);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool CreateProcessW(string application, StringBuilder command, IntPtr processAttributes, IntPtr threadAttributes, bool inherit, uint flags, IntPtr environment, string? cwd, ref STARTUPINFOEX startup, out PROCESS_INFORMATION process);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool ReadFile(IntPtr file, byte[] buffer, uint size, out uint read, IntPtr overlapped);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool WriteFile(IntPtr file, byte[] buffer, uint size, out uint written, IntPtr overlapped);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll", SetLastError = true)] static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool GetExitCodeProcess(IntPtr handle, out uint code);
    [DllImport("kernel32.dll", SetLastError = true)] static extern uint ResumeThread(IntPtr thread);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern IntPtr CreateJobObjectW(IntPtr attributes, string? name);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool TerminateJobObject(IntPtr job, uint code);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetInformationJobObject(IntPtr job, int kind, ref JOBOBJECT_EXTENDED_LIMIT_INFORMATION info, uint length);
}
