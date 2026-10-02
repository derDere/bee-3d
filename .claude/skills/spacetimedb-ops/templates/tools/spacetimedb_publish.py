"""Veröffentlicht das vorgebaute SpacetimeDB-Modul auf den Server des Stacks.

Wartet, bis der Server auf ``/v1/ping`` antwortet, und ruft dann ``spacetime publish`` mit dem
Bundle aus ``make compile`` auf. Die Besitzer-Identität liegt in einer eigenen CLI-Konfiguration
neben den Daten des Stacks (Standard: ``mounts/spacetime-cli/cli.toml``), damit sie zusammen mit
Daten und Signaturschlüsseln gesichert wird. Beim ersten Publish meldet sich die CLI dabei
selbst am Server an (vom Server ausgestellte Identität).

Migrationen ohne Datenverlust werden bestätigt. Schemaänderungen, die alle Clients trennen,
brauchen ``--break-clients``; Löschen von Daten bestätigt dieses Werkzeug nie.
"""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_BUNDLE = REPO_ROOT / "server" / "dist" / "bundle.js"
DEFAULT_CLI_CONFIG = REPO_ROOT / "mounts" / "spacetime-cli" / "cli.toml"


def wait_for_server(server_url: str, timeout: float) -> None:
    """Pollt ``/v1/ping``, bis der Server antwortet.

    Raises:
        TimeoutError: wenn der Server innerhalb von ``timeout`` Sekunden nicht antwortet.
    """
    deadline = time.monotonic() + timeout
    ping_url = server_url.rstrip("/") + "/v1/ping"
    while True:
        try:
            with urllib.request.urlopen(ping_url, timeout=3) as response:
                if response.status == 200:
                    return
        except (urllib.error.URLError, ConnectionError, TimeoutError):
            pass
        if time.monotonic() >= deadline:
            raise TimeoutError(f"SpacetimeDB antwortet nicht unter {ping_url}")
        time.sleep(1.0)


def spacetime_executable() -> str:
    """Liefert den Pfad der ``spacetime``-CLI aus dem PATH."""
    executable = shutil.which("spacetime")
    if executable is None:
        raise RuntimeError("spacetime wurde nicht gefunden (CLI in derselben Version wie der Server installieren).")
    return executable


def publish(database: str, server_url: str, bundle: Path, cli_config: Path, break_clients: bool) -> int:
    """Ruft ``spacetime publish`` nicht-interaktiv auf.

    Returns:
        Exit-Code der CLI (0 bei Erfolg).
    """
    if not bundle.is_file():
        print(f"Bundle fehlt: {bundle} (vorher make compile).", file=sys.stderr)
        return 1
    cli_config.parent.mkdir(parents=True, exist_ok=True)
    confirmations = "migrate,break-clients" if break_clients else "migrate"
    command = [
        spacetime_executable(),
        "--config-path", str(cli_config),
        "publish", database,
        "--server", server_url,
        "--js-path", str(bundle),
        "--no-config",
        f"--yes={confirmations}",
    ]  # fmt: skip
    result = subprocess.run(command, cwd=REPO_ROOT, stdin=subprocess.DEVNULL, check=False)
    if result.returncode != 0 and not break_clients:
        print(
            "Publish abgelehnt. Bei 'will BREAK existing clients' bewusst mit --break-clients wiederholen; "
            "bei 'requires manual migration' das Schema anpassen (Default-Werte, inkrementelle Migration).",
            file=sys.stderr,
        )
    return result.returncode


def main() -> int:
    parser = argparse.ArgumentParser(description="Veröffentlicht das SpacetimeDB-Modul auf den Server des Stacks.")
    parser.add_argument("--database", default=os.environ.get("SPACETIMEDB_DATABASE", "bee-world"))
    parser.add_argument("--server-url", default=os.environ.get("SPACETIMEDB_URL", "http://127.0.0.1:3000"))
    parser.add_argument("--bundle", type=Path, default=DEFAULT_BUNDLE)
    parser.add_argument("--cli-config", type=Path, default=Path(os.environ.get("SPACETIMEDB_CLI_CONFIG", DEFAULT_CLI_CONFIG)))
    parser.add_argument("--break-clients", action="store_true", help="Schemaänderungen erlauben, die alle Clients trennen.")
    parser.add_argument("--timeout", type=float, default=120.0, help="Wartezeit auf den Server in Sekunden.")
    args = parser.parse_args()
    wait_for_server(args.server_url, args.timeout)
    return publish(args.database, args.server_url, args.bundle, args.cli_config, args.break_clients)


if __name__ == "__main__":
    raise SystemExit(main())
