import Cocoa

class AppDelegate: NSObject, NSApplicationDelegate {
    private var statusItem: NSStatusItem!
    private var timer: Timer?
    private let label = "com.claude-discord"
    private var botDir: String
    private var plistDst: String
    private var envPath: String

    override init() {
        let scriptDir = (CommandLine.arguments[0] as NSString).deletingLastPathComponent
        botDir = (scriptDir as NSString).deletingLastPathComponent
        plistDst = NSHomeDirectory() + "/Library/LaunchAgents/com.claude-discord.plist"
        envPath = botDir + "/.env"
        super.init()
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        updateStatus()
        buildMenu()
        timer = Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { [weak self] _ in
            self?.updateStatus()
            self?.buildMenu()
        }

        // .env 없으면 자동으로 설정 창 열기
        if !FileManager.default.fileExists(atPath: envPath) {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
                self.openSettings()
            }
        }
    }

    private func isRunning() -> Bool {
        let task = Process()
        task.launchPath = "/bin/bash"
        task.arguments = ["-c", "launchctl list \(label) 2>/dev/null"]
        let pipe = Pipe()
        task.standardOutput = pipe
        task.standardError = Pipe()
        try? task.run()
        task.waitUntilExit()
        return task.terminationStatus == 0
    }

    private func updateStatus() {
        let running = isRunning()
        let hasEnv = FileManager.default.fileExists(atPath: envPath)
        DispatchQueue.main.async {
            if !hasEnv {
                self.statusItem.button?.title = " ⚙️"
                self.statusItem.button?.toolTip = "Claude Bot: 설정 필요"
            } else {
                self.statusItem.button?.title = running ? " 🟢" : " 🔴"
                self.statusItem.button?.toolTip = running ? "Claude Bot: 실행 중" : "Claude Bot: 중지됨"
            }
        }
    }

    private func buildMenu() {
        let menu = NSMenu()
        let running = isRunning()
        let hasEnv = FileManager.default.fileExists(atPath: envPath)

        if !hasEnv {
            let noEnvItem = NSMenuItem(title: "⚙️ 설정이 필요합니다", action: nil, keyEquivalent: "")
            noEnvItem.isEnabled = false
            menu.addItem(noEnvItem)
            menu.addItem(NSMenuItem.separator())

            let setupItem = NSMenuItem(title: "초기 설정...", action: #selector(openSettings), keyEquivalent: "e")
            setupItem.target = self
            menu.addItem(setupItem)
        } else {
            let statusItem = NSMenuItem(title: running ? "🟢 실행 중" : "🔴 중지됨", action: nil, keyEquivalent: "")
            statusItem.isEnabled = false
            menu.addItem(statusItem)
            menu.addItem(NSMenuItem.separator())

            if running {
                let stopItem = NSMenuItem(title: "봇 중지", action: #selector(stopBot), keyEquivalent: "s")
                stopItem.target = self
                menu.addItem(stopItem)

                let restartItem = NSMenuItem(title: "봇 재시작", action: #selector(restartBot), keyEquivalent: "r")
                restartItem.target = self
                menu.addItem(restartItem)
            } else {
                let startItem = NSMenuItem(title: "봇 시작", action: #selector(startBot), keyEquivalent: "s")
                startItem.target = self
                menu.addItem(startItem)
            }

            menu.addItem(NSMenuItem.separator())

            let settingsItem = NSMenuItem(title: "설정 편집...", action: #selector(openSettings), keyEquivalent: "e")
            settingsItem.target = self
            menu.addItem(settingsItem)

            let logItem = NSMenuItem(title: "로그 보기", action: #selector(openLog), keyEquivalent: "l")
            logItem.target = self
            menu.addItem(logItem)

            let folderItem = NSMenuItem(title: "폴더 열기", action: #selector(openFolder), keyEquivalent: "f")
            folderItem.target = self
            menu.addItem(folderItem)
        }

        menu.addItem(NSMenuItem.separator())

        let quitItem = NSMenuItem(title: "종료", action: #selector(quitAll), keyEquivalent: "q")
        quitItem.target = self
        menu.addItem(quitItem)

        self.statusItem.menu = menu
    }

    // MARK: - Settings Window

    private func loadEnv() -> [String: String] {
        guard let content = try? String(contentsOfFile: envPath, encoding: .utf8) else { return [:] }
        var env: [String: String] = [:]
        for line in content.split(separator: "\n") {
            let str = String(line).trimmingCharacters(in: .whitespaces)
            if str.hasPrefix("#") || !str.contains("=") { continue }
            let parts = str.split(separator: "=", maxSplits: 1)
            let key = String(parts[0])
            let value = parts.count > 1 ? String(parts[1]) : ""
            env[key] = value
        }
        return env
    }

    @objc private func openSettings() {
        NSApp.activate(ignoringOtherApps: true)

        let env = loadEnv()

        let alert = NSAlert()
        alert.messageText = "Claude Discord Bot 설정"
        alert.informativeText = "필수 항목을 입력해주세요."
        alert.alertStyle = .informational
        alert.addButton(withTitle: "저장")
        alert.addButton(withTitle: "취소")

        let width: CGFloat = 400
        let fieldHeight: CGFloat = 24
        let labelHeight: CGFloat = 18
        let spacing: CGFloat = 8
        let fields: [(label: String, key: String, placeholder: String, defaultValue: String)] = [
            ("Discord Bot Token:", "DISCORD_BOT_TOKEN", "봇 토큰 입력", ""),
            ("Discord Guild(서버) ID:", "DISCORD_GUILD_ID", "서버 ID 입력", ""),
            ("허용할 User ID (쉼표 구분):", "ALLOWED_USER_IDS", "123456789,987654321", ""),
            ("프로젝트 기본 디렉토리:", "BASE_PROJECT_DIR", botDir, botDir),
            ("분당 요청 제한:", "RATE_LIMIT_PER_MINUTE", "10", "10"),
            ("비용 표시 (true/false):", "SHOW_COST", "Max 플랜은 false 권장", "true"),
        ]

        let totalHeight = CGFloat(fields.count) * (labelHeight + fieldHeight + spacing) + 4
        let accessory = NSView(frame: NSRect(x: 0, y: 0, width: width, height: totalHeight))

        var textFields: [String: NSTextField] = [:]
        var y = totalHeight

        for field in fields {
            y -= labelHeight
            let label = NSTextField(labelWithString: field.label)
            label.frame = NSRect(x: 0, y: y, width: width, height: labelHeight)
            label.font = NSFont.systemFont(ofSize: 12, weight: .medium)
            accessory.addSubview(label)

            y -= fieldHeight
            let input = NSTextField(frame: NSRect(x: 0, y: y, width: width, height: fieldHeight))
            input.placeholderString = field.placeholder
            input.stringValue = env[field.key] ?? field.defaultValue
            if field.key == "DISCORD_BOT_TOKEN" {
                // 토큰은 보안상 일부만 표시
                let val = env[field.key] ?? ""
                if val.count > 10 {
                    input.placeholderString = "••••" + String(val.suffix(6)) + " (변경 시 전체 입력)"
                    input.stringValue = ""
                }
            }
            accessory.addSubview(input)
            textFields[field.key] = input

            y -= spacing
        }

        alert.accessoryView = accessory

        let response = alert.runModal()
        if response == .alertFirstButtonReturn {
            // 저장
            var newEnv: [String: String] = [:]
            for field in fields {
                let value = textFields[field.key]?.stringValue ?? ""
                if field.key == "DISCORD_BOT_TOKEN" && value.isEmpty {
                    // 빈칸이면 기존 값 유지
                    newEnv[field.key] = env[field.key] ?? ""
                } else if value.isEmpty {
                    newEnv[field.key] = field.defaultValue
                } else {
                    newEnv[field.key] = value
                }
            }

            // 필수 체크
            if (newEnv["DISCORD_BOT_TOKEN"] ?? "").isEmpty ||
               (newEnv["DISCORD_GUILD_ID"] ?? "").isEmpty ||
               (newEnv["ALLOWED_USER_IDS"] ?? "").isEmpty {
                let errAlert = NSAlert()
                errAlert.messageText = "필수 항목 누락"
                errAlert.informativeText = "Bot Token, Guild ID, User ID는 필수입니다."
                errAlert.alertStyle = .warning
                errAlert.runModal()
                return
            }

            // .env 파일 쓰기
            var content = ""
            for field in fields {
                if field.key == "SHOW_COST" {
                    content += "# Show estimated API cost in task results (set false for Max plan users)\n"
                }
                content += "\(field.key)=\(newEnv[field.key] ?? "")\n"
            }
            try? content.write(toFile: envPath, atomically: true, encoding: .utf8)

            updateStatus()
            buildMenu()
        }
    }

    // MARK: - Bot Controls

    @objc private func startBot() {
        let plistSrc = "\(botDir)/com.claude-discord.plist"
        runShell("cp '\(plistSrc)' '\(plistDst)' && launchctl load '\(plistDst)'")
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
            self.updateStatus()
            self.buildMenu()
        }
    }

    @objc private func stopBot() {
        runShell("launchctl unload '\(plistDst)' 2>/dev/null")
        DispatchQueue.main.asyncAfter(deadline: .now() + 1) {
            self.updateStatus()
            self.buildMenu()
        }
    }

    @objc private func restartBot() {
        runShell("launchctl unload '\(plistDst)' 2>/dev/null")
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
            let plistSrc = "\(self.botDir)/com.claude-discord.plist"
            self.runShell("cp '\(plistSrc)' '\(self.plistDst)' && launchctl load '\(self.plistDst)'")
            DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
                self.updateStatus()
                self.buildMenu()
            }
        }
    }

    @objc private func openLog() {
        NSWorkspace.shared.open(URL(fileURLWithPath: "\(botDir)/bot.log"))
    }

    @objc private func openFolder() {
        NSWorkspace.shared.open(URL(fileURLWithPath: botDir))
    }

    @objc private func quitAll() {
        if isRunning() {
            runShell("launchctl unload '\(plistDst)' 2>/dev/null")
        }
        NSApplication.shared.terminate(nil)
    }

    @discardableResult
    private func runShell(_ command: String) -> String {
        let task = Process()
        task.launchPath = "/bin/bash"
        task.arguments = ["-c", command]
        let pipe = Pipe()
        task.standardOutput = pipe
        task.standardError = pipe
        try? task.run()
        task.waitUntilExit()
        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        return String(data: data, encoding: .utf8) ?? ""
    }
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let delegate = AppDelegate()
app.delegate = delegate
app.run()
