using System;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Threading;
using System.Windows.Forms;

static class Program
{
    [STAThread]
    static void Main()
    {
        string dir = AppDomain.CurrentDomain.BaseDirectory;
        string core = Path.Combine(dir, "md_reader-core.exe");
        string profile = Path.Combine(dir, "profile");

        if (!File.Exists(core))
        {
            MessageBox.Show(
                "\u627E\u4E0D\u5230\u5E94\u7528\u6587\u4EF6\uFF1A" + core,
                "md_reader",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
            return;
        }

        try
        {
            Directory.CreateDirectory(profile);
        }
        catch
        {
        }

        string extra = BuildArguments();
        ProcessStartInfo info = new ProcessStartInfo(core);
        info.WorkingDirectory = dir;
        info.UseShellExecute = false;
        info.CreateNoWindow = true;
        info.Arguments = "--user-data-dir=\"" + profile + "\"" + extra;

        try
        {
            Process child = Process.Start(info);
            if (child == null) return;

            // 首次尝试保留 Chromium 沙箱；若进程立即退出，则用兼容参数重启。
            if (child.WaitForExit(1000))
            {
                // 等待崩溃进程释放 profile 锁后再重试。
                Thread.Sleep(800);
                info.Arguments = "--no-sandbox --user-data-dir=\"" + profile + "\"" + extra;
                Process.Start(info);
            }
        }
        catch (Exception ex)
        {
            MessageBox.Show(ex.Message, "md_reader", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }

    static string BuildArguments()
    {
        string[] args = Environment.GetCommandLineArgs();
        StringBuilder builder = new StringBuilder();
        for (int i = 1; i < args.Length; i++)
        {
            builder.Append(' ');
            builder.Append(Quote(args[i]));
        }
        return builder.ToString();
    }

    static string Quote(string value)
    {
        if (value.IndexOf(' ') < 0 && value.IndexOf('\t') < 0 && value.IndexOf('"') < 0)
        {
            return value;
        }
        return "\"" + value.Replace("\"", "\\\"") + "\"";
    }
}
