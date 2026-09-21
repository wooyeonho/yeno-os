// Native Windows launcher. No model/key material is accepted on command lines.
using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
using System.Threading;
using System.Windows.Forms;

internal static class BlackholeLauncher
{
    private static readonly byte[] Entropy = Encoding.UTF8.GetBytes("BLACKHOLE-DESKTOP-v1");
    private static string nativeStage = "startup";
    [STAThread]
    private static int Main(string[] args)
    {
        try
        {
            // WinExe has no attached console. Explicitly bind inherited redirected
            // handles and consume a possible UTF-8 BOM from .NET/PowerShell writers.
            if (args.Length > 0) BindProtocolStreams();
            if (args.Length == 1 && (args[0] == "--protect" || args[0] == "--unprotect"))
                return Protect(args[0] == "--protect");
            if (args.Length == 2 && args[0] == "--secure-directory")
            {
                SecureDirectory(args[1]);
                Console.Out.WriteLine("OK");
                return 0;
            }
            if (args.Length > 1 || (args.Length == 1 && args[0] != "--smoke")) return 64;
            bool smoke = args.Length == 1;
            string root = AppDomain.CurrentDomain.BaseDirectory;
            string node = Path.Combine(root, "node.exe");
            string entry = Path.Combine(root, "runtime", "desktop.mjs");
            if (!File.Exists(node) || !File.Exists(entry)) throw new InvalidOperationException("PackageIncomplete");
            var start = new ProcessStartInfo(node, Quote(entry));
            start.WorkingDirectory = root;
            start.UseShellExecute = false;
            start.CreateNoWindow = true;
            start.RedirectStandardInput = true;
            start.RedirectStandardOutput = true;
            start.RedirectStandardError = true;
            start.StandardOutputEncoding = Encoding.UTF8;
            start.StandardErrorEncoding = Encoding.UTF8;
            // Only this installed binary may be used for DPAPI/ACL helpers.
            start.EnvironmentVariables["BLACKHOLE_DESKTOP_NATIVE"] = Path.Combine(root, "BLACKHOLE.exe");
            start.EnvironmentVariables.Remove("NODE_OPTIONS");
            start.EnvironmentVariables.Remove("NODE_PATH");
            if (!smoke)
            {
                start.EnvironmentVariables.Remove("BLACKHOLE_DESKTOP_HOME");
                start.EnvironmentVariables.Remove("BLACKHOLE_DESKTOP_NO_BROWSER");
            }
            if (smoke) start.EnvironmentVariables["BLACKHOLE_DESKTOP_NO_BROWSER"] = "1";
            using (var child = new Process())
            {
                child.StartInfo = start;
                if (smoke) return RunSmoke(child);
                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                using (var context = new DesktopContext(child)) Application.Run(context);
                return child.HasExited ? child.ExitCode : 1;
            }
        }
        catch (Exception error)
        {
            // Exception text can contain owner paths or private provider inputs.
            if (args.Length == 0) MessageBox.Show("BLACKHOLE을 시작하지 못했습니다. 압축을 모두 풀었는지 확인해 주세요. 기존 데이터는 보존됩니다.", "BLACKHOLE", MessageBoxButtons.OK, MessageBoxIcon.Error);
            else Console.Error.WriteLine("BLACKHOLE_LAUNCHER_FAILED:" + nativeStage + ":" + error.GetType().Name + ":0x" + error.HResult.ToString("X8"));
            return 1;
        }
    }

    private static string Quote(string value) { return "\"" + value.Replace("\"", "") + "\""; }

    private static void BindProtocolStreams()
    {
        Console.SetIn(new StreamReader(Console.OpenStandardInput(), new UTF8Encoding(false, true), true));
        var output = new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false));
        output.AutoFlush = true; Console.SetOut(output);
        var error = new StreamWriter(Console.OpenStandardError(), new UTF8Encoding(false));
        error.AutoFlush = true; Console.SetError(error);
    }

    private static void WriteCommand(Process child, string command)
    {
        byte[] bytes = Encoding.UTF8.GetBytes(command + "\n");
        // Use raw pipe bytes so Framework default StreamWriter cannot prefix a BOM.
        child.StandardInput.BaseStream.Write(bytes, 0, bytes.Length);
        child.StandardInput.BaseStream.Flush();
    }

    private static int Protect(bool encrypt)
    {
        nativeStage = "crypto_input";
        string input = ReadBoundedLine(1024 * 1024);
        nativeStage = "base64_decode";
        byte[] plain = Convert.FromBase64String(input);
        byte[] output = null;
        try
        {
            nativeStage = encrypt ? "dpapi_protect" : "dpapi_unprotect";
            output = encrypt
                ? ProtectedData.Protect(plain, Entropy, DataProtectionScope.CurrentUser)
                : ProtectedData.Unprotect(plain, Entropy, DataProtectionScope.CurrentUser);
            Console.Out.WriteLine(Convert.ToBase64String(output));
            return 0;
        }
        finally
        {
            Array.Clear(plain, 0, plain.Length);
            if (output != null) Array.Clear(output, 0, output.Length);
        }
    }

    private static string ReadBoundedLine(int limit)
    {
        var text = new StringBuilder();
        int value;
        while ((value = Console.In.Read()) != -1)
        {
            if (value == '\n') break;
            if (value != '\r') text.Append((char)value);
            if (text.Length > limit) throw new InvalidOperationException("InputTooLarge");
        }
        if (text.Length == 0) throw new InvalidOperationException("InputEmpty");
        return text.ToString();
    }

    private static void SecureDirectory(string target)
    {
        if (!Path.IsPathRooted(target)) throw new InvalidOperationException("AbsolutePathRequired");
        string full = Path.GetFullPath(target);
        if (full == Path.GetPathRoot(full)) throw new InvalidOperationException("RootForbidden");
        // Walk existing ancestors before creating anything. Never follow a junction.
        string current = full;
        while (!String.IsNullOrEmpty(current))
        {
            if (File.Exists(current) || Directory.Exists(current))
            {
                if ((File.GetAttributes(current) & FileAttributes.ReparsePoint) != 0)
                    throw new InvalidOperationException("ReparseForbidden");
                if (File.Exists(current)) throw new InvalidOperationException("DirectoryRequired");
            }
            current = Path.GetDirectoryName(current);
        }
        Directory.CreateDirectory(full);
        var sid = WindowsIdentity.GetCurrent().User;
        var security = new DirectorySecurity();
        security.SetOwner(sid);
        security.SetAccessRuleProtection(true, false);
        security.AddAccessRule(new FileSystemAccessRule(sid, FileSystemRights.FullControl,
            InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit,
            PropagationFlags.None, AccessControlType.Allow));
        Directory.SetAccessControl(full, security);
    }

    private static int RunSmoke(Process child)
    {
        child.OutputDataReceived += delegate(object sender, DataReceivedEventArgs e)
        {
            if (e.Data != null && e.Data.Length <= 65536) Console.Out.WriteLine(e.Data);
        };
        child.ErrorDataReceived += delegate(object sender, DataReceivedEventArgs e)
        {
            if (e.Data != null) Console.Error.WriteLine("BLACKHOLE_CORE_DIAGNOSTIC");
        };
        child.Start(); child.BeginOutputReadLine(); child.BeginErrorReadLine();
        var input = new Thread(delegate()
        {
            try
            {
                string command;
                while ((command = Console.In.ReadLine()) != null)
                {
                    if (command == "STOP" || command == "OPEN")
                    {
                        WriteCommand(child, command);
                    }
                }
                if (!child.HasExited) WriteCommand(child, "STOP");
            }
            catch (IOException) { }
            catch (InvalidOperationException) { }
        });
        input.IsBackground = true; input.Start();
        child.WaitForExit();
        return child.ExitCode;
    }

    private sealed class DesktopContext : ApplicationContext
    {
        private readonly Process child;
        private readonly NotifyIcon tray;
        private readonly System.Windows.Forms.Timer timer;
        private bool stopping;
        private DateTime requestedStop;
        private volatile bool ready;
        private volatile bool failed;

        internal DesktopContext(Process process)
        {
            child = process;
            var menu = new ContextMenuStrip();
            menu.Items.Add("BLACKHOLE 열기", null, delegate { Send("OPEN"); });
            menu.Items.Add("종료 (작업 상태 보존)", null, delegate { Stop(); });
            tray = new NotifyIcon { Icon = SystemIcons.Application, Text = "BLACKHOLE · 시작 중", ContextMenuStrip = menu, Visible = true };
            tray.DoubleClick += delegate { Send("OPEN"); };
            child.OutputDataReceived += delegate(object sender, DataReceivedEventArgs e)
            {
                if (e.Data == null || e.Data.Length > 65536) return;
                // Only fixed, non-secret protocol markers affect native UI.
                if (e.Data.Contains("\"type\":\"ready\"")) ready = true;
                if (e.Data.Contains("\"type\":\"error\"")) failed = true;
            };
            child.ErrorDataReceived += delegate(object sender, DataReceivedEventArgs e) { if (e.Data != null) failed = true; };
            child.Start(); child.BeginOutputReadLine(); child.BeginErrorReadLine();
            timer = new System.Windows.Forms.Timer { Interval = 250 };
            timer.Tick += Tick; timer.Start();
        }

        private void Send(string command)
        {
            try { if (!child.HasExited) WriteCommand(child, command); }
            catch (IOException) { failed = true; }
            catch (InvalidOperationException) { failed = true; }
        }

        private void Stop()
        {
            if (stopping) return;
            stopping = true; requestedStop = DateTime.UtcNow;
            tray.Text = "BLACKHOLE · 상태 저장 후 종료 중";
            Send("STOP");
        }

        private void Tick(object sender, EventArgs e)
        {
            if (child.HasExited)
            {
                timer.Stop(); tray.Visible = false;
                if (!stopping && (child.ExitCode != 0 || failed))
                    MessageBox.Show("BLACKHOLE 실행이 중단되었습니다. 기존 기록은 유지됩니다. 실행 중인 다른 BLACKHOLE 창이 있는지 확인해 주세요.", "BLACKHOLE", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                ExitThread(); return;
            }
            if (!stopping) tray.Text = ready ? "BLACKHOLE · 실행 중" : "BLACKHOLE · 시작 중";
            if (stopping && (DateTime.UtcNow - requestedStop).TotalSeconds > 20)
            {
                tray.Text = "BLACKHOLE · 종료 대기 (작업 보존)";
                // Never kill an arbitrary PID or discard an unsettled call to close UI.
            }
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing) { timer.Dispose(); tray.Dispose(); }
            base.Dispose(disposing);
        }
    }
}
