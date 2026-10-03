"""Startet und stoppt den Vite-Dev-Server (Hot Reload) im Hintergrund — nur bei ``APP_ENV=dev``.

``make start`` ruft ``devserver.py start`` auf, ``make stop`` ruft ``devserver.py stop`` auf. Der
Prozess läuft losgelöst vom Terminal; PID und Ausgabe liegen unter ``.temp/devserver.*``. In allen
anderen Stages liefert der web-Container den Build aus, dann tut dieses Werkzeug nichts.
"""

from __future__ import annotations

import argparse
import os
import signal
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

from stack_env import REPO_ROOT, app_env, env_value, executable

STATE_DIR = REPO_ROOT / ".temp"
PID_FILE = STATE_DIR / "devserver.pid"
LOG_FILE = STATE_DIR / "devserver.log"
DEV_URL = "http://127.0.0.1:5173/"


def read_pid() -> int | None:
    """PID des laufenden Dev-Servers oder None."""
    try:
        return int(PID_FILE.read_text(encoding="utf-8").strip())
    except (FileNotFoundError, ValueError):
        return None


def is_running(pid: int) -> bool:
    """Prüft, ob ein Prozess mit dieser PID lebt."""
    if sys.platform == "win32":
        # tasklist schreibt in der OEM-Codepage der Konsole
        result = subprocess.run(
            ["tasklist", "/FI", f"PID eq {pid}", "/NH"], capture_output=True, text=True, encoding="oem", errors="replace", check=False
        )
        return str(pid) in (result.stdout or "")
    try:
        os.kill(pid, 0)
    except OSError:
        return False
    return True


def responds(url: str) -> bool:
    """True, wenn die URL mit HTTP 200 antwortet."""
    try:
        with urllib.request.urlopen(url, timeout=2) as response:
            return response.status == 200
    except (urllib.error.URLError, ConnectionError, TimeoutError):
        return False


def start() -> int:
    """Startet Vite losgelöst, sofern er nicht schon läuft, und wartet auf die erste Antwort."""
    pid = read_pid()
    if pid is not None and is_running(pid):
        print(f"Dev-Server läuft bereits (PID {pid}): {DEV_URL}")
        return 0
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    log = LOG_FILE.open("w", encoding="utf-8")
    # node direkt statt npx: ein einziger Prozess, dessen PID das Stoppen zuverlässig trifft
    command = [executable("node"), "node_modules/vite/bin/vite.js"]
    if sys.platform == "win32":
        flags = subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.DETACHED_PROCESS | subprocess.CREATE_NO_WINDOW
        process = subprocess.Popen(command, cwd=REPO_ROOT, stdout=log, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL, creationflags=flags)
    else:
        process = subprocess.Popen(command, cwd=REPO_ROOT, stdout=log, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL, start_new_session=True)
    PID_FILE.write_text(str(process.pid), encoding="utf-8")
    deadline = time.monotonic() + 60
    while time.monotonic() < deadline:
        if responds(DEV_URL):
            print(f"Dev-Server läuft (PID {process.pid}): {DEV_URL}")
            return 0
        if process.poll() is not None:
            break
        time.sleep(0.5)
    print(f"Dev-Server antwortet nicht; Ausgabe in {LOG_FILE.relative_to(REPO_ROOT)}", file=sys.stderr)
    return 1


def stop() -> int:
    """Beendet den Dev-Server samt Kindprozessen."""
    pid = read_pid()
    if pid is None or not is_running(pid):
        PID_FILE.unlink(missing_ok=True)
        return 0
    if sys.platform == "win32":
        subprocess.run(["taskkill", "/PID", str(pid), "/T", "/F"], capture_output=True, check=False)
    else:
        os.killpg(pid, signal.SIGTERM)
    PID_FILE.unlink(missing_ok=True)
    print(f"Dev-Server beendet (PID {pid}).")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Vite-Dev-Server im Hintergrund verwalten.")
    parser.add_argument("action", choices=("start", "stop", "wait"))
    args = parser.parse_args()
    if app_env() != "dev" and args.action != "stop":
        return 0
    if args.action == "start":
        return start()
    if args.action == "stop":
        return stop()
    url = env_value("APP_URL", DEV_URL)
    deadline = time.monotonic() + 60
    while not responds(url):
        if time.monotonic() > deadline:
            print(f"{url} antwortet nicht.", file=sys.stderr)
            return 1
        time.sleep(0.5)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
