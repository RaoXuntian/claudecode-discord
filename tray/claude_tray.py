#!/usr/bin/env python3
"""Claude Discord Bot - Linux System Tray App"""

import subprocess
import os
import sys
import threading
import time

try:
    import pystray
    from PIL import Image, ImageDraw
except ImportError:
    print("Installing required packages: pip3 install pystray Pillow")
    subprocess.run([sys.executable, "-m", "pip", "install", "pystray", "Pillow"], check=True)
    import pystray
    from PIL import Image, ImageDraw

SERVICE_NAME = "claude-discord"
BOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENV_PATH = os.path.join(BOT_DIR, ".env")
update_available = False
current_version = "unknown"


def is_running():
    result = subprocess.run(
        ["systemctl", "--user", "is-active", SERVICE_NAME],
        capture_output=True, text=True
    )
    return result.stdout.strip() == "active"


def get_version():
    try:
        result = subprocess.run(
            ["git", "describe", "--tags", "--always"],
            capture_output=True, text=True, cwd=BOT_DIR
        )
        ver = result.stdout.strip()
        return ver if ver else "unknown"
    except Exception:
        return "unknown"


def check_for_updates():
    global update_available, current_version
    try:
        current_version = get_version()
        subprocess.run(["git", "fetch", "origin", "main"], capture_output=True, cwd=BOT_DIR)
        local = subprocess.run(
            ["git", "rev-parse", "HEAD"], capture_output=True, text=True, cwd=BOT_DIR
        ).stdout.strip()
        remote = subprocess.run(
            ["git", "rev-parse", "origin/main"], capture_output=True, text=True, cwd=BOT_DIR
        ).stdout.strip()
        update_available = bool(local and remote and local != remote)
    except Exception:
        update_available = False


def perform_update(icon, item):
    global update_available, current_version
    was_running = is_running()
    if was_running:
        subprocess.run(["systemctl", "--user", "stop", SERVICE_NAME], capture_output=True)

    subprocess.run(["git", "pull", "origin", "main"], cwd=BOT_DIR)
    subprocess.run(["npm", "install", "--production"], cwd=BOT_DIR)
    subprocess.run(["npm", "run", "build"], cwd=BOT_DIR)

    current_version = get_version()
    update_available = False

    if was_running:
        subprocess.run(["systemctl", "--user", "start", SERVICE_NAME], capture_output=True)

    time.sleep(2)
    update_icon(icon)
    icon.menu = create_menu()


def create_icon(color):
    """Create a colored circle icon"""
    size = 64
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    margin = 8
    draw.ellipse([margin, margin, size - margin, size - margin], fill=color)
    return img


def start_bot(icon, item):
    subprocess.run(["systemctl", "--user", "start", SERVICE_NAME], capture_output=True)
    time.sleep(2)
    update_icon(icon)


def stop_bot(icon, item):
    subprocess.run(["systemctl", "--user", "stop", SERVICE_NAME], capture_output=True)
    time.sleep(1)
    update_icon(icon)


def restart_bot(icon, item):
    subprocess.run(["systemctl", "--user", "restart", SERVICE_NAME], capture_output=True)
    time.sleep(2)
    update_icon(icon)


def open_log(icon, item):
    log_path = os.path.join(BOT_DIR, "bot.log")
    if os.path.exists(log_path):
        subprocess.Popen(["xdg-open", log_path])


def open_folder(icon, item):
    subprocess.Popen(["xdg-open", BOT_DIR])


def edit_settings(icon, item):
    """Open settings dialog using tkinter"""
    try:
        _edit_settings_tk()
    except Exception:
        # Fallback: open in text editor
        env_path = os.path.join(BOT_DIR, ".env")
        if os.path.exists(env_path):
            subprocess.Popen(["xdg-open", env_path])
        else:
            subprocess.Popen(["xdg-open", os.path.join(BOT_DIR, ".env.example")])


def _edit_settings_tk():
    """Edit settings using tkinter GUI with pre-filled values"""
    import tkinter as tk
    from tkinter import filedialog, messagebox

    env = _load_env()
    fields = [
        ("DISCORD_BOT_TOKEN", "Discord Bot Token:"),
        ("DISCORD_GUILD_ID", "Discord Guild ID:"),
        ("ALLOWED_USER_IDS", "Allowed User IDs (comma-separated):"),
        ("BASE_PROJECT_DIR", "Base Project Directory:"),
        ("RATE_LIMIT_PER_MINUTE", "Rate Limit Per Minute:"),
        ("SHOW_COST", "Show Cost (true/false):"),
    ]
    defaults = {"RATE_LIMIT_PER_MINUTE": "10", "SHOW_COST": "true", "BASE_PROJECT_DIR": BOT_DIR}

    root = tk.Tk()
    root.title("Claude Discord Bot Settings")
    root.geometry("500x420")
    root.resizable(False, False)

    # Setup guide link
    link = tk.Label(root, text="📖 Open Setup Guide", fg="dodgerblue", cursor="hand2", font=("", 10, "underline"))
    link.pack(anchor="w", padx=15, pady=(10, 5))
    link.bind("<Button-1>", lambda e: subprocess.Popen(["xdg-open", "https://github.com/chadingTV/claudecode-discord/blob/main/SETUP.md"]))

    entries = {}
    for key, label_text in fields:
        frame = tk.Frame(root)
        frame.pack(fill="x", padx=15, pady=2)

        lbl = tk.Label(frame, text=label_text, font=("", 9, "bold"), anchor="w")
        lbl.pack(fill="x")

        entry_frame = tk.Frame(frame)
        entry_frame.pack(fill="x")

        entry = tk.Entry(entry_frame, font=("", 10))

        if key == "BASE_PROJECT_DIR":
            entry.pack(side="left", fill="x", expand=True)
            def browse_folder(e=entry):
                path = filedialog.askdirectory(title="Select Base Project Directory")
                if path:
                    e.delete(0, tk.END)
                    e.insert(0, path)
            btn = tk.Button(entry_frame, text="Browse...", command=browse_folder)
            btn.pack(side="right", padx=(4, 0))
        else:
            entry.pack(fill="x")

        # Pre-fill with current value
        current = env.get(key, "")
        if key == "DISCORD_BOT_TOKEN" and len(current) > 10:
            entry.config(show="•")
            entry.insert(0, current)
        elif current:
            entry.insert(0, current)
        else:
            default = defaults.get(key, "")
            if default:
                entry.insert(0, default)

        entries[key] = entry

    note = tk.Label(root, text="* Max plan users should set Show Cost to false", fg="gray", font=("", 8))
    note.pack(anchor="w", padx=15, pady=(5, 0))

    def save():
        new_env = {}
        for key, _ in fields:
            val = entries[key].get().strip()
            if val:
                new_env[key] = val
            elif key == "DISCORD_BOT_TOKEN":
                new_env[key] = env.get(key, "")
            else:
                new_env[key] = defaults.get(key, "")

        if not new_env.get("DISCORD_BOT_TOKEN") or not new_env.get("DISCORD_GUILD_ID") or not new_env.get("ALLOWED_USER_IDS"):
            messagebox.showerror("Error", "Bot Token, Guild ID, and User IDs are required.")
            return

        with open(ENV_PATH, "w") as f:
            for key, _ in fields:
                if key == "SHOW_COST":
                    f.write("# Show estimated API cost in task results (set false for Max plan users)\n")
                f.write(f"{key}={new_env.get(key, '')}\n")

        root.destroy()

    btn_frame = tk.Frame(root)
    btn_frame.pack(pady=10)
    tk.Button(btn_frame, text="Cancel", width=10, command=root.destroy).pack(side="left", padx=5)
    tk.Button(btn_frame, text="Save", width=10, command=save).pack(side="left", padx=5)

    root.mainloop()


def _load_env():
    env = {}
    if not os.path.exists(ENV_PATH):
        return env
    with open(ENV_PATH) as f:
        for line in f:
            line = line.strip()
            if line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            env[key.strip()] = value.strip()
    return env


def quit_all(icon, item):
    if is_running():
        subprocess.run(["systemctl", "--user", "stop", SERVICE_NAME], capture_output=True)
    icon.stop()


def update_icon(icon):
    running = is_running()
    color = (76, 175, 80, 255) if running else (244, 67, 54, 255)  # green / red
    icon.icon = create_icon(color)
    icon.title = "Claude Bot: Running" if running else "Claude Bot: Stopped"


def create_menu():
    running = is_running()
    has_env = os.path.exists(ENV_PATH)

    version_item = pystray.MenuItem(f"Version: {current_version}", None, enabled=False)
    update_item = pystray.MenuItem("⬆️ Update Available", perform_update, visible=update_available)

    if not has_env:
        return pystray.Menu(
            pystray.MenuItem("⚙️ Setup Required", None, enabled=False),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem("Setup...", edit_settings),
            pystray.Menu.SEPARATOR,
            version_item,
            update_item,
            pystray.Menu.SEPARATOR,
            pystray.MenuItem("Quit", quit_all),
        )

    if running:
        return pystray.Menu(
            pystray.MenuItem("🟢 Running", None, enabled=False),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem("Stop Bot", stop_bot),
            pystray.MenuItem("Restart Bot", restart_bot),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem("Settings...", edit_settings),
            pystray.MenuItem("View Log", open_log),
            pystray.MenuItem("Open Folder", open_folder),
            pystray.Menu.SEPARATOR,
            version_item,
            update_item,
            pystray.Menu.SEPARATOR,
            pystray.MenuItem("Quit", quit_all),
        )
    else:
        return pystray.Menu(
            pystray.MenuItem("🔴 Stopped", None, enabled=False),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem("Start Bot", start_bot),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem("Settings...", edit_settings),
            pystray.MenuItem("View Log", open_log),
            pystray.MenuItem("Open Folder", open_folder),
            pystray.Menu.SEPARATOR,
            version_item,
            update_item,
            pystray.Menu.SEPARATOR,
            pystray.MenuItem("Quit", quit_all),
        )


def refresh_loop(icon):
    update_check_counter = 0
    while icon.visible:
        time.sleep(5)
        try:
            update_icon(icon)
            icon.menu = create_menu()
            # Check for git updates every 5 minutes (60 * 5s intervals)
            update_check_counter += 1
            if update_check_counter >= 60:
                update_check_counter = 0
                check_for_updates()
                icon.menu = create_menu()
        except Exception:
            pass


def main():
    global current_version
    current_version = get_version()
    check_for_updates()

    running = is_running()
    color = (76, 175, 80, 255) if running else (244, 67, 54, 255)

    icon = pystray.Icon(
        "claude-bot",
        create_icon(color),
        "Claude Bot",
        menu=create_menu(),
    )

    refresh_thread = threading.Thread(target=refresh_loop, args=(icon,), daemon=True)
    refresh_thread.start()

    icon.run()


if __name__ == "__main__":
    main()
