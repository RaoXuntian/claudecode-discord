using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Windows.Forms;
using System.Threading;
using System.Runtime.InteropServices;

class ClaudeBotTray : Form
{
    [DllImport("user32.dll", CharSet = CharSet.Auto)]
    private static extern IntPtr SendMessage(IntPtr hWnd, int msg, IntPtr wParam, string lParam);
    private const int EM_SETCUEBANNER = 0x1501;

    private NotifyIcon trayIcon;
    private System.Windows.Forms.Timer refreshTimer;
    private System.Windows.Forms.Timer updateCheckTimer;
    private string botDir;
    private string envPath;
    private string taskName = "ClaudeDiscordBot";
    private string currentVersion = "unknown";
    private bool updateAvailable = false;

    // Language support
    private string langPrefFile;
    private bool isKorean = false;

    public ClaudeBotTray()
    {
        botDir = Path.GetDirectoryName(Path.GetDirectoryName(Application.ExecutablePath));
        envPath = Path.Combine(botDir, ".env");
        langPrefFile = Path.Combine(botDir, ".tray-lang");

        // Load saved language preference
        try
        {
            if (File.Exists(langPrefFile))
            {
                string saved = File.ReadAllText(langPrefFile).Trim();
                isKorean = (saved == "kr");
            }
        }
        catch { }

        this.ShowInTaskbar = false;
        this.WindowState = FormWindowState.Minimized;
        this.FormBorderStyle = FormBorderStyle.None;
        this.Opacity = 0;

        currentVersion = GetVersion();

        trayIcon = new NotifyIcon();
        trayIcon.Visible = true;
        // Left-click opens control panel window
        trayIcon.MouseClick += (s, e) => {
            if (e.Button == MouseButtons.Left)
            {
                ShowControlPanel();
            }
        };
        UpdateStatus();
        BuildMenu();

        refreshTimer = new System.Windows.Forms.Timer();
        refreshTimer.Interval = 5000;
        refreshTimer.Tick += (s, e) => { UpdateStatus(); BuildMenu(); };
        refreshTimer.Start();

        // Check for updates every 5 minutes
        updateCheckTimer = new System.Windows.Forms.Timer();
        updateCheckTimer.Interval = 300000;
        updateCheckTimer.Tick += (s, e) => { CheckForUpdates(); BuildMenu(); };
        updateCheckTimer.Start();

        // Initial update check
        CheckForUpdates();

        bool showPanel = false;
        string[] args = Environment.GetCommandLineArgs();
        for (int i = 0; i < args.Length; i++)
        {
            if (args[i] == "--show") showPanel = true;
        }

        if (!File.Exists(envPath))
        {
            // .env 없으면 설정 창 열기
            System.Windows.Forms.Timer t = new System.Windows.Forms.Timer();
            t.Interval = 500;
            t.Tick += (s, e) => { t.Stop(); OpenSettings(null, null); };
            t.Start();
        }
        else if (!IsRunning())
        {
            // .env 있고 봇이 안 돌고 있으면 자동 시작
            System.Windows.Forms.Timer t = new System.Windows.Forms.Timer();
            t.Interval = 1000;
            t.Tick += (s, e) => { t.Stop(); StartBot(null, null); };
            t.Start();
        }

        if (showPanel)
        {
            System.Windows.Forms.Timer st = new System.Windows.Forms.Timer();
            st.Interval = 1500;
            st.Tick += (s, e) => { st.Stop(); ShowControlPanel(); };
            st.Start();
        }
    }

    // --- Localization ---
    private string L(string en, string kr)
    {
        return isKorean ? kr : en;
    }

    private void SetLanguage(bool korean)
    {
        isKorean = korean;
        try { File.WriteAllText(langPrefFile, korean ? "kr" : "en"); } catch { }
        UpdateStatus();
        BuildMenu();
    }

    private bool IsRunning()
    {
        return File.Exists(Path.Combine(botDir, ".bot.lock"));
    }

    private string GetVersion()
    {
        try
        {
            return RunCmdOutput("git", "-C \"" + botDir + "\" describe --tags --always").Trim();
        }
        catch { return "unknown"; }
    }

    private void CheckForUpdates()
    {
        try
        {
            RunCmdOutput("git", "-C \"" + botDir + "\" fetch origin main");
            string local = RunCmdOutput("git", "-C \"" + botDir + "\" rev-parse HEAD").Trim();
            string remote = RunCmdOutput("git", "-C \"" + botDir + "\" rev-parse origin/main").Trim();
            updateAvailable = !string.IsNullOrEmpty(local) && !string.IsNullOrEmpty(remote) && local != remote;
        }
        catch { updateAvailable = false; }
    }

    private void PerformUpdate(object sender, EventArgs e)
    {
        var result = MessageBox.Show(
            L("Do you want to update to the latest version? The bot will restart after updating.",
              "최신 버전으로 업데이트하시겠습니까? 업데이트 후 봇이 재시작됩니다."),
            L("Update Available", "업데이트 가능"),
            MessageBoxButtons.YesNo,
            MessageBoxIcon.Question);

        if (result != DialogResult.Yes) return;

        bool wasRunning = IsRunning();
        if (wasRunning)
        {
            KillBot();
            Thread.Sleep(2000);
        }

        // git pull
        RunCmdOutput("git", "-C \"" + botDir + "\" pull origin main");
        // npm install & build
        RunCmd("cd /d \"" + botDir + "\" && npm install --production && npm run build", true);

        currentVersion = GetVersion();
        updateAvailable = false;

        // Tray exe 재컴파일 및 재시작
        // 실행 중인 자기 자신은 삭제 불가하므로 bat 스크립트로 대기 후 교체
        string trayExe = Application.ExecutablePath;
        string traySrc = Path.Combine(Path.GetDirectoryName(trayExe), "ClaudeBotTray.cs");
        string updateBat = Path.Combine(botDir, ".tray-update.bat");

        if (File.Exists(traySrc))
        {
            // CSC 경로 찾기용 bat 스크립트 생성
            string batContent =
                "@echo off\r\n" +
                "chcp 65001 >nul 2>&1\r\n" +
                "setlocal enabledelayedexpansion\r\n" +
                ":: Wait for tray process to exit\r\n" +
                "timeout /t 2 /nobreak >nul\r\n" +
                ":WAITLOOP\r\n" +
                "tasklist /fi \"imagename eq ClaudeBotTray.exe\" 2>nul | findstr /i \"ClaudeBotTray.exe\" >nul 2>&1\r\n" +
                "if not errorlevel 1 (\r\n" +
                "    timeout /t 1 /nobreak >nul\r\n" +
                "    goto WAITLOOP\r\n" +
                ")\r\n" +
                ":: Delete old exe\r\n" +
                "del \"" + trayExe + "\" >nul 2>&1\r\n" +
                ":: Find csc.exe\r\n" +
                "set \"CSC=\"\r\n" +
                "for /f \"delims=\" %%i in ('dir /b /s \"%WINDIR%\\Microsoft.NET\\Framework64\\csc.exe\" 2^>nul') do set \"CSC=%%i\"\r\n" +
                "if \"!CSC!\"==\"\" (\r\n" +
                "    for /f \"delims=\" %%i in ('dir /b /s \"%WINDIR%\\Microsoft.NET\\Framework\\csc.exe\" 2^>nul') do set \"CSC=%%i\"\r\n" +
                ")\r\n" +
                ":: Compile new tray exe\r\n" +
                "if not \"!CSC!\"==\"\" (\r\n" +
                "    \"!CSC!\" /nologo /target:winexe /out:\"" + trayExe + "\" /reference:System.Windows.Forms.dll /reference:System.Drawing.dll \"" + traySrc + "\"\r\n" +
                ")\r\n" +
                ":: Restart tray with --show\r\n" +
                "if exist \"" + trayExe + "\" (\r\n" +
                "    start \"\" \"" + trayExe + "\" --show\r\n" +
                ")\r\n" +
                ":: Start bot if it was running\r\n";

            if (wasRunning)
            {
                batContent +=
                    "timeout /t 2 /nobreak >nul\r\n" +
                    "echo Set ws = CreateObject(\"WScript.Shell\") > \"" + botDir + "\\.bot-start.vbs\"\r\n" +
                    "echo ws.Run \"cmd /c cd /d " + botDir + " ^& echo running^> .bot.lock ^& node dist/index.js ^& del .bot.lock\", 0, False >> \"" + botDir + "\\.bot-start.vbs\"\r\n" +
                    "wscript \"" + botDir + "\\.bot-start.vbs\"\r\n" +
                    "del \"" + botDir + "\\.bot-start.vbs\" >nul 2>&1\r\n";
            }

            batContent += "del \"" + updateBat + "\" >nul 2>&1\r\n";

            File.WriteAllText(updateBat, batContent);

            // VBS로 bat을 숨겨서 실행
            string vbs = Path.Combine(botDir, ".tray-update.vbs");
            File.WriteAllText(vbs,
                "Set ws = CreateObject(\"WScript.Shell\")\n" +
                "ws.Run \"cmd /c \"\"" + updateBat + "\"\"\", 0, False\n");
            Process.Start("wscript", "\"" + vbs + "\"");

            // 자기 자신 종료 (bat이 대기 후 처리)
            trayIcon.Visible = false;
            Application.Exit();
            return;
        }

        // traySrc 없으면 (비정상 상황) 그냥 봇만 재시작
        if (wasRunning)
        {
            StartBot(null, null);
        }

        MessageBox.Show(L("Updated to version: ", "업데이트 완료: ") + currentVersion,
            L("Update Complete", "업데이트 완료"), MessageBoxButtons.OK, MessageBoxIcon.Information);
        UpdateStatus();
        BuildMenu();
    }

    private string RunCmdOutput(string fileName, string arguments)
    {
        try
        {
            var proc = new Process();
            proc.StartInfo.FileName = fileName;
            proc.StartInfo.Arguments = arguments;
            proc.StartInfo.UseShellExecute = false;
            proc.StartInfo.RedirectStandardOutput = true;
            proc.StartInfo.CreateNoWindow = true;
            proc.StartInfo.WorkingDirectory = botDir;
            proc.Start();
            string output = proc.StandardOutput.ReadToEnd();
            proc.WaitForExit();
            return output;
        }
        catch { return ""; }
    }

    private Bitmap CreateIcon(Color color)
    {
        var bmp = new Bitmap(16, 16);
        using (var g = Graphics.FromImage(bmp))
        {
            g.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
            g.FillEllipse(new SolidBrush(color), 1, 1, 14, 14);
        }
        return bmp;
    }

    private void UpdateStatus()
    {
        bool running = IsRunning();
        bool hasEnv = File.Exists(envPath);

        if (!hasEnv)
        {
            trayIcon.Icon = Icon.FromHandle(CreateIcon(Color.Orange).GetHicon());
            trayIcon.Text = L("Claude Discord Bot: Setup Required", "Claude Discord Bot: 설정 필요");
        }
        else if (running)
        {
            trayIcon.Icon = Icon.FromHandle(CreateIcon(Color.LimeGreen).GetHicon());
            trayIcon.Text = L("Claude Discord Bot: Running", "Claude Discord Bot: 실행 중");
        }
        else
        {
            trayIcon.Icon = Icon.FromHandle(CreateIcon(Color.Red).GetHicon());
            trayIcon.Text = L("Claude Discord Bot: Stopped", "Claude Discord Bot: 중지됨");
        }
    }

    private void BuildMenu()
    {
        bool running = IsRunning();
        bool hasEnv = File.Exists(envPath);

        var menu = new ContextMenuStrip();

        if (!hasEnv)
        {
            var noEnv = new ToolStripMenuItem(L("Setup Required", "설정 필요")) { Enabled = false };
            menu.Items.Add(noEnv);
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add(L("Setup...", "설정..."), null, OpenSettings);
        }
        else
        {
            var status = new ToolStripMenuItem(running ? L("Running", "실행 중") : L("Stopped", "중지됨")) { Enabled = false };
            menu.Items.Add(status);
            menu.Items.Add(new ToolStripSeparator());

            if (running)
            {
                menu.Items.Add(L("Stop Bot", "봇 중지"), null, StopBot);
                menu.Items.Add(L("Restart Bot", "봇 재시작"), null, RestartBot);
            }
            else
            {
                menu.Items.Add(L("Start Bot", "봇 시작"), null, StartBot);
            }

            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add(L("Settings...", "설정..."), null, OpenSettings);
            menu.Items.Add(L("View Log", "로그 보기"), null, OpenLog);
            menu.Items.Add(L("Open Folder", "폴더 열기"), null, OpenFolder);
        }

        menu.Items.Add(new ToolStripSeparator());

        // Auto-start toggle
        var autoStartItem = new ToolStripMenuItem(L("Auto Run on Startup", "시작 시 자동 실행"));
        autoStartItem.Checked = IsAutoStartEnabled();
        autoStartItem.Click += ToggleAutoStart;
        menu.Items.Add(autoStartItem);

        // Language toggle in menu
        var langItem = new ToolStripMenuItem(isKorean ? "Language: KR" : "Language: EN");
        var enItem = new ToolStripMenuItem("English") { Checked = !isKorean };
        enItem.Click += (s, ev) => { SetLanguage(false); };
        var krItem = new ToolStripMenuItem("한국어") { Checked = isKorean };
        krItem.Click += (s, ev) => { SetLanguage(true); };
        langItem.DropDownItems.Add(enItem);
        langItem.DropDownItems.Add(krItem);
        menu.Items.Add(langItem);

        var versionItem = new ToolStripMenuItem(L("Version: ", "버전: ") + currentVersion) { Enabled = false };
        menu.Items.Add(versionItem);

        if (updateAvailable)
        {
            menu.Items.Add(L("Update Available", "업데이트 가능"), null, PerformUpdate);
        }

        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add(L("Quit", "종료"), null, QuitAll);

        trayIcon.ContextMenuStrip = menu;
    }

    private void StartBot(object sender, EventArgs e)
    {
        KillBot();
        // Run bot hidden via vbs
        string vbs = Path.Combine(botDir, ".bot-start.vbs");
        string cmd = "cmd /c cd /d " + botDir + " & echo running> .bot.lock & node dist/index.js & del .bot.lock";
        File.WriteAllText(vbs, "Set ws = CreateObject(\"WScript.Shell\")\nws.Run \"" + cmd.Replace("\"", "\"\"") + "\", 0, False\n");
        Process.Start("wscript", "\"" + vbs + "\"");
        // Wait for bot to start, then show notification
        System.Windows.Forms.Timer waitTimer = new System.Windows.Forms.Timer();
        waitTimer.Interval = 1000;
        int waitCount = 0;
        waitTimer.Tick += (s2, e2) => {
            waitCount++;
            if (IsRunning())
            {
                waitTimer.Stop();
                try { File.Delete(vbs); } catch { }
                UpdateStatus();
                BuildMenu();
                trayIcon.BalloonTipTitle = L("Claude Discord Bot Started", "Claude Discord Bot 시작됨");
                trayIcon.BalloonTipText = L("Bot is running. Click tray icon to manage.",
                                             "봇이 실행 중입니다. 트레이 아이콘을 클릭하여 관리하세요.");
                trayIcon.BalloonTipIcon = ToolTipIcon.Info;
                trayIcon.ShowBalloonTip(3000);
                trayIcon.BalloonTipClicked += (s3, e3) => { ShowControlPanel(); };
            }
            else if (waitCount > 10)
            {
                waitTimer.Stop();
                try { File.Delete(vbs); } catch { }
                UpdateStatus();
                BuildMenu();
            }
        };
        waitTimer.Start();
    }

    private void KillBot()
    {
        // Kill node processes running dist/index.js
        try
        {
            var proc = new Process();
            proc.StartInfo.FileName = "wmic";
            proc.StartInfo.Arguments = "process where \"commandline like '%dist/index.js%' and name='node.exe'\" call terminate";
            proc.StartInfo.UseShellExecute = false;
            proc.StartInfo.CreateNoWindow = true;
            proc.Start();
            proc.WaitForExit();
        }
        catch { }
        // Also try taskkill for cmd windows
        try
        {
            var proc = new Process();
            proc.StartInfo.FileName = "cmd.exe";
            proc.StartInfo.Arguments = "/c for /f \"tokens=2\" %a in ('tasklist /fi \"windowtitle eq ClaudeDiscordBot\" /fo list 2^>nul ^| findstr \"PID\"') do taskkill /pid %a /f >nul 2>&1";
            proc.StartInfo.UseShellExecute = false;
            proc.StartInfo.CreateNoWindow = true;
            proc.Start();
            proc.WaitForExit();
        }
        catch { }
        string lockFile = Path.Combine(botDir, ".bot.lock");
        try { File.Delete(lockFile); } catch { }
    }

    private bool IsAutoStartEnabled()
    {
        try
        {
            var key = Microsoft.Win32.Registry.CurrentUser.OpenSubKey(
                "SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run", false);
            if (key == null) return false;
            object val = key.GetValue(taskName);
            key.Close();
            return val != null;
        }
        catch { return false; }
    }

    private void ToggleAutoStart(object sender, EventArgs e)
    {
        try
        {
            var key = Microsoft.Win32.Registry.CurrentUser.OpenSubKey(
                "SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run", true);
            if (key == null) return;
            if (IsAutoStartEnabled())
            {
                key.DeleteValue(taskName, false);
            }
            else
            {
                key.SetValue(taskName, "\"" + Application.ExecutablePath + "\"");
            }
            key.Close();
        }
        catch { }
        BuildMenu();
    }

    private void StopBot(object sender, EventArgs e)
    {
        KillBot();
        Thread.Sleep(1000);
        UpdateStatus();
        BuildMenu();
    }

    private void RestartBot(object sender, EventArgs e)
    {
        KillBot();
        Thread.Sleep(2000);
        StartBot(null, null);
    }

    private void OpenLog(object sender, EventArgs e)
    {
        string logPath = Path.Combine(botDir, "bot.log");
        if (File.Exists(logPath))
            Process.Start("notepad.exe", logPath);
    }

    private void OpenFolder(object sender, EventArgs e)
    {
        Process.Start("explorer.exe", botDir);
    }

    private void OpenSettings(object sender, EventArgs e)
    {
        var env = LoadEnv();

        var form = new Form()
        {
            Text = L("Claude Discord Bot Settings", "Claude Discord Bot 설정"),
            Width = 500,
            Height = 430,
            StartPosition = FormStartPosition.CenterScreen,
            FormBorderStyle = FormBorderStyle.FixedDialog,
            MaximizeBox = false,
            MinimizeBox = false,
        };

        // Setup guide link
        var linkLabel = new LinkLabel() { Text = L("Open Setup Guide", "설정 가이드 열기"), Left = 15, Top = 10, Width = 450 };
        linkLabel.LinkClicked += (s, ev) => { Process.Start("https://github.com/chadingTV/claudecode-discord/blob/main/SETUP.md"); };
        form.Controls.Add(linkLabel);

        string[][] fields = new string[][] {
            new string[] { "DISCORD_BOT_TOKEN", "Discord Bot Token" },
            new string[] { "DISCORD_GUILD_ID", "Discord Guild ID" },
            new string[] { "ALLOWED_USER_IDS", L("Allowed User IDs (comma-separated)", "허용된 사용자 ID (쉼표로 구분)") },
            new string[] { "BASE_PROJECT_DIR", L("Base Project Directory", "기본 프로젝트 디렉토리") },
            new string[] { "RATE_LIMIT_PER_MINUTE", L("Rate Limit Per Minute", "분당 요청 제한") },
            new string[] { "SHOW_COST", L("Show Cost (true/false)", "비용 표시 (true/false)") },
        };

        string[] defaults = new string[] { "", "", "", botDir, "10", "true" };

        var textBoxes = new TextBox[fields.Length];
        int y = 35;

        for (int i = 0; i < fields.Length; i++)
        {
            var label = new Label() { Text = fields[i][1], Left = 15, Top = y, Width = 450, Font = new Font(FontFamily.GenericSansSerif, 9, FontStyle.Bold) };
            form.Controls.Add(label);
            y += 20;

            if (fields[i][0] == "BASE_PROJECT_DIR")
            {
                var tb = new TextBox() { Left = 15, Top = y, Width = 360 };
                string val = "";
                env.TryGetValue(fields[i][0], out val);
                tb.Text = (val != null && val != "") ? val : defaults[i];
                form.Controls.Add(tb);
                textBoxes[i] = tb;

                var browseBtn = new Button() { Text = L("Browse...", "찾아보기..."), Left = 380, Top = y - 1, Width = 85 };
                int idx = i;
                browseBtn.Click += (s, ev) =>
                {
                    using (var fbd = new FolderBrowserDialog())
                    {
                        fbd.Description = L("Select Base Project Directory", "기본 프로젝트 디렉토리 선택");
                        if (textBoxes[idx].Text != "") fbd.SelectedPath = textBoxes[idx].Text;
                        if (fbd.ShowDialog() == DialogResult.OK)
                        {
                            textBoxes[idx].Text = fbd.SelectedPath;
                        }
                    }
                };
                form.Controls.Add(browseBtn);
            }
            else
            {
                var tb = new TextBox() { Left = 15, Top = y, Width = 450 };
                string val = "";
                env.TryGetValue(fields[i][0], out val);

                if (fields[i][0] == "DISCORD_BOT_TOKEN" && val != null && val.Length > 10)
                {
                    tb.HandleCreated += (s2, e2) => {
                        SendMessage(((TextBox)s2).Handle, EM_SETCUEBANNER, IntPtr.Zero,
                            "****" + val.Substring(val.Length - 6) + L(" (enter full token to change)", " (변경하려면 전체 토큰 입력)"));
                    };
                }
                else
                {
                    tb.Text = (val != null && val != "") ? val : defaults[i];
                }

                form.Controls.Add(tb);
                textBoxes[i] = tb;
            }
            y += 30;
        }

        var note = new Label() { Text = L("* Max plan users should set Show Cost to false",
                                           "* Max 요금제 사용자는 Show Cost를 false로 설정하세요"), Left = 15, Top = y, Width = 450, ForeColor = Color.Gray };
        form.Controls.Add(note);
        y += 25;

        var saveBtn = new Button() { Text = L("Save", "저장"), Left = 300, Top = y, Width = 80 };
        var cancelBtn = new Button() { Text = L("Cancel", "취소"), Left = 385, Top = y, Width = 80 };

        saveBtn.Click += (s, ev) =>
        {
            string[] values = new string[fields.Length];
            for (int i = 0; i < fields.Length; i++)
            {
                values[i] = textBoxes[i].Text.Trim();
                if (values[i] == "" && fields[i][0] == "DISCORD_BOT_TOKEN")
                {
                    string existing = "";
                    env.TryGetValue(fields[i][0], out existing);
                    values[i] = existing ?? "";
                }
                if (values[i] == "") values[i] = defaults[i];
            }

            if (values[0] == "" || values[1] == "" || values[2] == "")
            {
                MessageBox.Show(
                    L("Bot Token, Guild ID, and User IDs are required.",
                      "Bot Token, Guild ID, User IDs는 필수 항목입니다."),
                    L("Required Fields Missing", "필수 항목 누락"), MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return;
            }

            using (var sw = new StreamWriter(envPath))
            {
                for (int i = 0; i < fields.Length; i++)
                {
                    if (fields[i][0] == "SHOW_COST")
                        sw.WriteLine("# Show estimated API cost in task results (set false for Max plan users)");
                    sw.WriteLine(fields[i][0] + "=" + values[i]);
                }
            }

            form.DialogResult = DialogResult.OK;
            form.Close();
        };

        cancelBtn.Click += (s, ev) => { form.Close(); };

        form.Controls.Add(saveBtn);
        form.Controls.Add(cancelBtn);
        form.AcceptButton = saveBtn;
        form.CancelButton = cancelBtn;
        form.ShowDialog();

        UpdateStatus();
        BuildMenu();
    }

    private System.Collections.Generic.Dictionary<string, string> LoadEnv()
    {
        var env = new System.Collections.Generic.Dictionary<string, string>();
        if (!File.Exists(envPath)) return env;

        foreach (var line in File.ReadAllLines(envPath))
        {
            string trimmed = line.Trim();
            if (trimmed.StartsWith("#") || !trimmed.Contains("=")) continue;
            int idx = trimmed.IndexOf('=');
            string key = trimmed.Substring(0, idx);
            string val = trimmed.Substring(idx + 1);
            env[key] = val;
        }
        return env;
    }

    private Form controlPanel = null;

    private void ShowControlPanel()
    {
        // If already open, bring to front
        if (controlPanel != null && !controlPanel.IsDisposed)
        {
            controlPanel.Activate();
            return;
        }

        int panelWidth = 460;

        controlPanel = new Form()
        {
            Text = "Claude Discord Bot",
            Width = panelWidth,
            Height = 560,
            StartPosition = FormStartPosition.CenterScreen,
            FormBorderStyle = FormBorderStyle.FixedDialog,
            MaximizeBox = false,
            MinimizeBox = false,
        };

        string icoPath = Path.Combine(botDir, "docs", "icon.ico");
        if (File.Exists(icoPath))
            controlPanel.Icon = new Icon(icoPath);

        RebuildControlPanel();
        controlPanel.ShowDialog();
        controlPanel = null;
    }

    private void RebuildControlPanel()
    {
        if (controlPanel == null || controlPanel.IsDisposed) return;

        // Remember position
        Point pos = controlPanel.Location;
        bool wasVisible = controlPanel.Visible;

        controlPanel.SuspendLayout();
        controlPanel.Controls.Clear();

        bool running = IsRunning();
        bool hasEnv = File.Exists(envPath);

        int panelWidth = controlPanel.Width;
        int btnWidth = panelWidth - 60;
        int halfBtnWidth = (btnWidth - 10) / 2;

        int y = 15;

        // Language toggle - top right
        var enBtn = new Label()
        {
            Text = "EN",
            Left = panelWidth - 110,
            Top = y,
            Width = 32,
            Height = 22,
            TextAlign = ContentAlignment.MiddleCenter,
            Font = new Font(FontFamily.GenericSansSerif, 9, !isKorean ? FontStyle.Bold : FontStyle.Regular),
            ForeColor = !isKorean ? Color.White : Color.FromArgb(100, 100, 100),
            BackColor = !isKorean ? Color.FromArgb(66, 133, 244) : Color.FromArgb(230, 230, 230),
            Cursor = Cursors.Hand
        };
        var divLabel = new Label()
        {
            Text = "|",
            Left = panelWidth - 78,
            Top = y,
            Width = 10,
            Height = 22,
            TextAlign = ContentAlignment.MiddleCenter,
            ForeColor = Color.FromArgb(180, 180, 180)
        };
        var krBtn = new Label()
        {
            Text = "KR",
            Left = panelWidth - 68,
            Top = y,
            Width = 32,
            Height = 22,
            TextAlign = ContentAlignment.MiddleCenter,
            Font = new Font(FontFamily.GenericSansSerif, 9, isKorean ? FontStyle.Bold : FontStyle.Regular),
            ForeColor = isKorean ? Color.White : Color.FromArgb(100, 100, 100),
            BackColor = isKorean ? Color.FromArgb(66, 133, 244) : Color.FromArgb(230, 230, 230),
            Cursor = Cursors.Hand
        };
        enBtn.Click += (s, ev) => { SetLanguage(false); RebuildControlPanel(); };
        krBtn.Click += (s, ev) => { SetLanguage(true); RebuildControlPanel(); };
        controlPanel.Controls.Add(enBtn);
        controlPanel.Controls.Add(divLabel);
        controlPanel.Controls.Add(krBtn);

        y += 10;

        // Status indicator
        string statusText = !hasEnv ? L("Setup Required", "설정 필요") : (running ? L("Running", "실행 중") : L("Stopped", "중지됨"));
        Color statusColor = !hasEnv ? Color.Orange : (running ? Color.LimeGreen : Color.Red);
        var statusPanel = new Panel() { Left = 25, Top = y, Width = btnWidth, Height = 50, BackColor = Color.FromArgb(240, 240, 240) };
        var statusDot = new Label() { Left = 14, Top = 14, Width = 24, Height = 24, Text = "" };
        statusDot.Paint += (s, e) => {
            e.Graphics.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
            e.Graphics.FillEllipse(new SolidBrush(statusColor), 2, 2, 18, 18);
        };
        statusPanel.Controls.Add(statusDot);
        var statusLabel = new Label() { Left = 42, Top = 15, Width = 320, Height = 24, Text = statusText, Font = new Font(FontFamily.GenericSansSerif, 12, FontStyle.Bold) };
        statusPanel.Controls.Add(statusLabel);
        controlPanel.Controls.Add(statusPanel);
        y += 62;

        // Bot control buttons
        if (hasEnv)
        {
            if (running)
            {
                var stopBtn = new Button() { Text = L("Stop Bot", "봇 중지"), Left = 25, Top = y, Width = halfBtnWidth, Height = 40 };
                stopBtn.Click += (s, ev) => { StopBot(null, null); controlPanel.Close(); };
                controlPanel.Controls.Add(stopBtn);

                var restartBtn = new Button() { Text = L("Restart Bot", "봇 재시작"), Left = 25 + halfBtnWidth + 10, Top = y, Width = halfBtnWidth, Height = 40 };
                restartBtn.Click += (s, ev) => { RestartBot(null, null); controlPanel.Close(); };
                controlPanel.Controls.Add(restartBtn);
            }
            else
            {
                var startBtn = new Button() { Text = L("Start Bot", "봇 시작"), Left = 25, Top = y, Width = btnWidth, Height = 40 };
                startBtn.Click += (s, ev) => { StartBot(null, null); controlPanel.Close(); };
                controlPanel.Controls.Add(startBtn);
            }
            y += 50;
        }

        // Settings button
        var settingsBtn = new Button() { Text = L("Settings...", "설정..."), Left = 25, Top = y, Width = btnWidth, Height = 40 };
        settingsBtn.Click += (s, ev) => { controlPanel.Close(); OpenSettings(null, null); };
        controlPanel.Controls.Add(settingsBtn);
        y += 48;

        if (hasEnv)
        {
            // View Log
            var logBtn = new Button() { Text = L("View Log", "로그 보기"), Left = 25, Top = y, Width = halfBtnWidth, Height = 40 };
            logBtn.Click += (s, ev) => { OpenLog(null, null); };
            controlPanel.Controls.Add(logBtn);

            // Open Folder
            var folderBtn = new Button() { Text = L("Open Folder", "폴더 열기"), Left = 25 + halfBtnWidth + 10, Top = y, Width = halfBtnWidth, Height = 40 };
            folderBtn.Click += (s, ev) => { OpenFolder(null, null); };
            controlPanel.Controls.Add(folderBtn);
            y += 48;
        }

        // Separator line
        var sep1 = new Label() { Left = 25, Top = y, Width = btnWidth, Height = 1, BackColor = Color.FromArgb(220, 220, 220) };
        controlPanel.Controls.Add(sep1);
        y += 10;

        // Auto-start checkbox
        var autoCheck = new CheckBox() { Text = L("Auto Run on Startup", "시작 시 자동 실행"), Left = 25, Top = y, Width = btnWidth, Height = 22, Font = new Font(FontFamily.GenericSansSerif, 9.5f), Checked = IsAutoStartEnabled() };
        autoCheck.CheckedChanged += (s, ev) => { ToggleAutoStart(null, null); };
        controlPanel.Controls.Add(autoCheck);
        y += 32;

        // Version
        var verLabel = new Label() { Text = L("Version: ", "버전: ") + currentVersion, Left = 25, Top = y, Width = btnWidth, ForeColor = Color.Gray, Font = new Font(FontFamily.GenericSansSerif, 9) };
        controlPanel.Controls.Add(verLabel);
        y += 26;

        // Update button
        if (updateAvailable)
        {
            var updateBtn = new Button()
            {
                Text = L("Update Available - Click to Update", "업데이트 가능 - 클릭하여 업데이트"),
                Left = 25, Top = y, Width = btnWidth, Height = 40,
                BackColor = Color.FromArgb(66, 133, 244), ForeColor = Color.White
            };
            updateBtn.FlatStyle = FlatStyle.Flat;
            updateBtn.Click += (s, ev) => { controlPanel.Close(); PerformUpdate(null, null); };
            controlPanel.Controls.Add(updateBtn);
            y += 48;
        }

        // Separator line
        var sep2 = new Label() { Left = 25, Top = y, Width = btnWidth, Height = 1, BackColor = Color.FromArgb(220, 220, 220) };
        controlPanel.Controls.Add(sep2);
        y += 12;

        // Info message
        var infoLabel = new Label() {
            Text = L("Closing this window does not stop the bot.\nThe bot runs in the background. Check the tray icon for status.",
                      "이 창을 닫아도 봇은 중지되지 않습니다.\n봇은 백그라운드에서 실행됩니다. 트레이 아이콘에서 상태를 확인하세요."),
            Left = 25, Top = y, Width = btnWidth, Height = 40,
            ForeColor = Color.FromArgb(100, 100, 100),
            Font = new Font(FontFamily.GenericSansSerif, 8.5f)
        };
        controlPanel.Controls.Add(infoLabel);
        y += 48;

        // Quit button
        var quitBtn = new Button() { Text = L("Quit Bot", "봇 종료"), Left = 25, Top = y, Width = btnWidth, Height = 40, ForeColor = Color.Gray };
        quitBtn.Click += (s, ev) => { controlPanel.Close(); QuitAll(null, null); };
        controlPanel.Controls.Add(quitBtn);
        y += 50;

        // Separator line
        var sep3 = new Label() { Left = 25, Top = y, Width = btnWidth, Height = 1, BackColor = Color.FromArgb(220, 220, 220) };
        controlPanel.Controls.Add(sep3);
        y += 10;

        // GitHub link
        var ghLink = new LinkLabel()
        {
            Text = "GitHub: chadingTV/claudecode-discord",
            Left = 25, Top = y, Width = btnWidth, Height = 20,
            TextAlign = ContentAlignment.MiddleCenter,
            Font = new Font(FontFamily.GenericSansSerif, 8.5f),
            LinkColor = Color.FromArgb(66, 133, 244)
        };
        ghLink.LinkClicked += (s, ev) => { Process.Start("https://github.com/chadingTV/claudecode-discord"); };
        controlPanel.Controls.Add(ghLink);
        y += 28;

        controlPanel.Height = y + 45;

        // Restore position if it was already visible
        if (wasVisible)
        {
            controlPanel.Location = pos;
        }

        controlPanel.ResumeLayout(true);
    }

    private void QuitAll(object sender, EventArgs e)
    {
        KillBot();
        trayIcon.Visible = false;
        Application.Exit();
    }

    private void RunCmd(string command, bool wait)
    {
        var proc = new Process();
        proc.StartInfo.FileName = "cmd.exe";
        proc.StartInfo.Arguments = "/c " + command;
        proc.StartInfo.UseShellExecute = false;
        proc.StartInfo.CreateNoWindow = true;
        proc.Start();
        if (wait) proc.WaitForExit();
    }

    protected override void OnFormClosing(FormClosingEventArgs e)
    {
        trayIcon.Visible = false;
        base.OnFormClosing(e);
    }

    [STAThread]
    static void Main()
    {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        Application.Run(new ClaudeBotTray());
    }
}
