"""Blockiert, bis alle Container des Stacks betriebsbereit sind.

Pollt den Status der Compose-Container und kehrt zurueck, sobald jeder Container
laeuft und -- falls er einen Healthcheck besitzt -- als ``healthy`` gilt. Bricht
mit Fehlercode ab, wenn das Timeout ueberschritten wird.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time


def _run(args: list[str]) -> str:
    """Fuehrt ein Kommando aus und liefert dessen stdout als Text."""
    result = subprocess.run(args, capture_output=True, text=True, check=True)
    return result.stdout


def container_ids() -> list[str]:
    """Liefert die Container-IDs des aktuellen Compose-Projekts."""
    output = _run(["docker", "compose", "ps", "--quiet"])
    return [line.strip() for line in output.splitlines() if line.strip()]


def is_ready(container_id: str) -> bool:
    """Prueft, ob ein Container laeuft und (falls vorhanden) gesund ist."""
    state = json.loads(_run(["docker", "inspect", container_id]))[0]["State"]
    if state.get("Status") != "running":
        return False
    health = state.get("Health")
    if health is None:
        # Ohne Healthcheck gilt ein laufender Container als bereit.
        return True
    return health.get("Status") == "healthy"


def wait_until_ready(timeout: int, interval: float) -> int:
    """Wartet, bis alle Container bereit sind oder das Timeout greift.

    Returns:
        0 bei Erfolg, 1 bei Timeout.
    """
    deadline = time.monotonic() + timeout
    while True:
        ids = container_ids()
        if ids and all(is_ready(cid) for cid in ids):
            print(f"Alle {len(ids)} Container sind betriebsbereit.")
            return 0
        if time.monotonic() >= deadline:
            print(
                f"Timeout nach {timeout}s -- nicht alle Container wurden gesund.",
                file=sys.stderr,
            )
            return 1
        time.sleep(interval)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Wartet, bis der Compose-Stack betriebsbereit ist."
    )
    parser.add_argument(
        "--timeout", type=int, default=180, help="Maximale Wartezeit in Sekunden."
    )
    parser.add_argument(
        "--interval", type=float, default=2.0, help="Abstand zwischen den Pruefungen in Sekunden."
    )
    args = parser.parse_args()
    return wait_until_ready(args.timeout, args.interval)


if __name__ == "__main__":
    raise SystemExit(main())
