"""open -- zeigt die laufende Anwendung an (oeffnet ihre "Eingangstuer").

Meist ist das eine URL (Web-GUI, Swagger-/OpenAPI-Seite, mitgeliefertes Admin-
oder Dashboard-UI), die im Standardbrowser geoeffnet wird. Ein Projekt, dessen
Eingangstuer keine URL ist (z. B. ein nativer Client), passt dieses Skript an,
um diesen zu starten.

URL-Aufloesung in dieser Reihenfolge: Umgebungsvariable APP_URL, dann ein
APP_URL-Eintrag in der lokalen .env, sonst ein localhost-Standardwert. Das
Oeffnen laeuft plattformunabhaengig ueber das webbrowser-Modul (Windows, Linux,
WSL).
"""

from __future__ import annotations

import os
import webbrowser
from pathlib import Path

# Anlaufstelle, wenn das Projekt keine eigene URL setzt.
DEFAULT_URL = "http://127.0.0.1:5173/"
URL_KEY = "APP_URL"


def read_env_value(key: str, env_file: Path = Path(".env")) -> str | None:
    """Liest einen KEY=VALUE-Eintrag aus der .env, falls vorhanden."""
    if not env_file.exists():
        return None
    for line in env_file.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        name, value = stripped.split("=", 1)
        if name.strip() == key:
            return value.strip().strip('"').strip("'")
    return None


def resolve_url() -> str:
    """Ermittelt die zu oeffnende URL aus Umgebung, .env oder Standardwert."""
    return os.environ.get(URL_KEY) or read_env_value(URL_KEY) or DEFAULT_URL


def main() -> int:
    url = resolve_url()
    print(f"Oeffne {url}")
    webbrowser.open(url)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
