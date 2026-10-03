"""clear -- setzt die Weltdatenbank auf den frisch eingerichteten Stand zurück.

Veröffentlicht das aktuelle Bündel mit ``--delete-data=always``: Alle Laufzeitdaten (Spieler,
Fortschritt, Fliegen, Pollenstände, Demodaten) verschwinden, Datenbankname und Identität bleiben.
Danach läuft der init-Schritt. Das Werkzeug läuft nur, wenn ``APP_ENV`` ausdrücklich ``dev`` oder ``test``
ist und ``SPACETIMEDB_URL`` auf einen lokalen bzw. stack-internen Server zeigt.
"""

from __future__ import annotations

import os
import sys
from urllib.parse import urlparse

import init
from spacetime_cli import SpacetimeCli
from spacetimedb_publish import publish, wait_for_server
from stack_env import env_value, read_env_file

ALLOWED_STAGES = ("dev", "test")
LOCAL_HOSTS = ("127.0.0.1", "localhost", "::1", "spacetimedb")


def explicit_stage() -> str:
    """Stage nur aus ausdrücklicher Angabe (Umgebung oder .env), ohne Standardwert."""
    return os.environ.get("APP_ENV") or read_env_file().get("APP_ENV", "")


def main() -> int:
    stage = explicit_stage()
    server_url = env_value("SPACETIMEDB_URL", "http://127.0.0.1:3000")
    host = urlparse(server_url).hostname or ""
    if stage not in ALLOWED_STAGES or host not in LOCAL_HOSTS:
        print(f"clear löscht alle Laufzeitdaten und läuft nur mit APP_ENV=dev oder test gegen einen lokalen Server "
              f"(APP_ENV={stage or 'nicht gesetzt'}, SPACETIMEDB_URL={server_url}).", file=sys.stderr)
        return 1
    wait_for_server(server_url, 60.0)
    exit_code = publish(SpacetimeCli.detect(), break_clients=True, delete_data=True)
    if exit_code != 0:
        return exit_code
    return init.main()


if __name__ == "__main__":
    raise SystemExit(main())
