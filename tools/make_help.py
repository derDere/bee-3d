"""Gibt eine Uebersicht aller Makefile-Targets aus.

Liest das Makefile im aktuellen Verzeichnis und zeigt jedes Target an, das mit
einem ``## Beschreibung``-Kommentar versehen ist. Reines Python, damit die Hilfe
unter Windows, Linux und WSL ohne grep/awk funktioniert.
"""

from __future__ import annotations

import re
from pathlib import Path

# Erfasst "target: ... ## Beschreibung" und trennt Name von Beschreibung.
TARGET_PATTERN = re.compile(r"^([a-zA-Z0-9_-]+):.*?##\s*(.*)$")


def collect_targets(makefile: Path) -> list[tuple[str, str]]:
    """Sammelt (Target, Beschreibung)-Paare aus dem Makefile."""
    targets: list[tuple[str, str]] = []
    for line in makefile.read_text(encoding="utf-8").splitlines():
        match = TARGET_PATTERN.match(line)
        if match:
            targets.append((match.group(1), match.group(2).strip()))
    return targets


def main() -> int:
    makefile = Path("Makefile")
    if not makefile.exists():
        print("Kein Makefile im aktuellen Verzeichnis gefunden.")
        return 1

    targets = collect_targets(makefile)
    width = max((len(name) for name, _ in targets), default=0)
    print("Verfuegbare Befehle:\n")
    for name, description in targets:
        print(f"  make {name.ljust(width)}  {description}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
