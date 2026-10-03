"""Gemeinsame Hilfen der Make-Werkzeuge: Repo-Wurzel, Werte aus der ``.env`` und Kommandoaufrufe.

Alle Werkzeuge laufen mit dem Repo-Root als Arbeitsverzeichnis und adressieren Dateien relativ
dazu. Werte kommen in dieser Reihenfolge: Umgebungsvariable, Eintrag in der lokalen ``.env``,
Standardwert.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
from collections.abc import Sequence
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
ENV_FILE = REPO_ROOT / ".env"


def read_env_file(path: Path = ENV_FILE) -> dict[str, str]:
    """Liest ``KEY=VALUE``-Zeilen einer .env-Datei; Kommentare und Leerzeilen entfallen."""
    values: dict[str, str] = {}
    if not path.exists():
        return values
    for line in path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        name, value = stripped.split("=", 1)
        values[name.strip()] = value.strip().strip('"').strip("'")
    return values


def env_value(key: str, default: str) -> str:
    """Liefert einen Konfigurationswert aus Umgebung, .env oder Standard."""
    from_environment = os.environ.get(key)
    if from_environment:
        return from_environment
    return read_env_file().get(key) or default


def app_env() -> str:
    """Stage des Laufs (dev, test, qs, prod)."""
    return env_value("APP_ENV", "dev")


def executable(name: str) -> str:
    """Löst ein Programm aus dem PATH auf (unter Windows inklusive ``.cmd``-Wrapper wie npm).

    Raises:
        RuntimeError: wenn das Programm fehlt.
    """
    resolved = shutil.which(name)
    if resolved is None:
        raise RuntimeError(f"{name} wurde nicht gefunden (im PATH installieren).")
    return resolved


def run(command: Sequence[str], *, check: bool = True, capture: bool = False) -> subprocess.CompletedProcess[str]:
    """Führt ein Kommando im Repo-Root aus und gibt die Ausgabe durch (oder fängt sie ein).

    Raises:
        SystemExit: wenn ``check`` gesetzt ist und das Kommando fehlschlägt.
    """
    printable = " ".join(Path(part).name if index == 0 else part for index, part in enumerate(command))
    print(f"> {printable}", flush=True)
    result = subprocess.run(
        list(command),
        cwd=REPO_ROOT,
        text=True,
        encoding="utf-8",
        capture_output=capture,
        stdin=subprocess.DEVNULL,
        check=False,
    )
    if check and result.returncode != 0:
        if capture:
            sys.stderr.write(result.stdout or "")
            sys.stderr.write(result.stderr or "")
        raise SystemExit(result.returncode)
    return result
