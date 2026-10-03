"""Veröffentlicht das vorgebaute SpacetimeDB-Modul auf den Server des Stacks.

Wartet, bis der Server auf ``/v1/ping`` antwortet, und ruft dann ``spacetime publish`` mit dem
Bündel aus ``make compile`` auf. Die Besitzer-Identität liegt in ``mounts/spacetime-cli/cli.toml``
neben den Daten des Stacks, damit sie zusammen mit Daten und Signaturschlüsseln gesichert wird.
Beim ersten Publish meldet sich die CLI selbst am Server an (vom Server ausgestellte Identität).

Migrationen ohne Datenverlust werden bestätigt. Schemaänderungen, die alle Clients trennen,
brauchen ``--break-clients``; ``--delete-data`` nutzt nur ``tools/clear.py``.
"""

from __future__ import annotations

import argparse
import sys
import time
import urllib.error
import urllib.request

from spacetime_cli import SpacetimeCli
from stack_env import REPO_ROOT, env_value

BUNDLE = "server/dist/bundle.js"


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


def publish(cli: SpacetimeCli, *, break_clients: bool, delete_data: bool) -> int:
    """Ruft ``spacetime publish`` nicht-interaktiv auf und liefert den Exit-Code."""
    if not (REPO_ROOT / BUNDLE).is_file():
        print(f"Bündel fehlt: {BUNDLE} (vorher make compile).", file=sys.stderr)
        return 1
    # "remote": die CLI im Werkzeug-Container sieht den Server unter seinem Dienstnamen statt localhost
    confirmations = ["migrate", "remote"]
    if break_clients:
        confirmations.append("break-clients")
    arguments = [cli.database, "--js-path", BUNDLE, "--no-config"]
    if delete_data:
        confirmations.extend(["delete-data", "break-clients"])
        arguments.append("--delete-data=always")
    arguments.append(f"--yes={','.join(dict.fromkeys(confirmations))}")
    result = cli.owner("publish", arguments, check=False)
    if result.returncode != 0 and not break_clients:
        print(
            "Publish abgelehnt. Bei 'will BREAK existing clients' bewusst mit --break-clients wiederholen; "
            "bei 'requires manual migration' das Schema anpassen (Default-Werte, inkrementelle Migration).",
            file=sys.stderr,
        )
    return result.returncode


def main() -> int:
    parser = argparse.ArgumentParser(description="Veröffentlicht das SpacetimeDB-Modul auf den Server des Stacks.")
    parser.add_argument("--break-clients", action="store_true", help="Schemaänderungen erlauben, die alle Clients trennen.")
    parser.add_argument("--timeout", type=float, default=120.0, help="Wartezeit auf den Server in Sekunden.")
    args = parser.parse_args()
    wait_for_server(env_value("SPACETIMEDB_URL", "http://127.0.0.1:3000"), args.timeout)
    return publish(SpacetimeCli.detect(), break_clients=args.break_clients, delete_data=False)


if __name__ == "__main__":
    raise SystemExit(main())
