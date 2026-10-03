"""seed -- schreibt Demodaten in die laufende Weltdatenbank.

Liest ``dev/seed/world.yaml`` (Demo-Imker für die Rangliste, Honigbilanzen der Bienenstöcke,
eine erzwungene Start-Wetterlage) und übergibt den Inhalt als JSON an den Besitzer-Reducer
``seed_demo``. Der Reducer bricht ab, wenn bereits Demodaten vorhanden sind; der Entwicklungs-
kreislauf ist ``make clear`` → ``make seed``.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

from spacetime_cli import SpacetimeCli
from stack_env import REPO_ROOT

SEED_FILE = REPO_ROOT / "dev" / "seed" / "world.yaml"


def parse_simple_yaml(text: str) -> dict[str, Any]:
    """Liest das schlichte YAML der Seed-Datei: Abschnitte mit Listen aus ``- key: value``-Einträgen.

    Unterstützt genau die Form von ``dev/seed/world.yaml`` (zwei Ebenen, Skalare), damit das
    Werkzeug ohne Zusatzpaket auskommt.
    """
    data: dict[str, Any] = {}
    section: str | None = None
    current: dict[str, Any] | None = None
    for raw_line in text.splitlines():
        line = raw_line.split("#", 1)[0].rstrip()
        if not line.strip():
            continue
        if not line.startswith(" ") and line.endswith(":"):
            section = line[:-1].strip()
            data[section] = []
            current = None
            continue
        if not line.startswith(" ") and ":" in line:
            key, value = line.split(":", 1)
            data[key.strip()] = _scalar(value.strip())
            section = None
            continue
        if section is None:
            raise ValueError(f"Unerwartete Zeile: {raw_line!r}")
        stripped = line.strip()
        if stripped.startswith("- "):
            current = {}
            data[section].append(current)
            stripped = stripped[2:]
        if current is None or ":" not in stripped:
            raise ValueError(f"Unerwartete Zeile: {raw_line!r}")
        key, value = stripped.split(":", 1)
        current[key.strip()] = _scalar(value.strip())
    return data


def _scalar(value: str) -> Any:
    """Wandelt einen YAML-Skalar in int, float, bool oder str."""
    if value.startswith('"') and value.endswith('"'):
        return value[1:-1]
    if value in ("true", "false"):
        return value == "true"
    for converter in (int, float):
        try:
            return converter(value)
        except ValueError:
            pass
    return value


def main() -> int:
    if not SEED_FILE.exists():
        print(f"Seed-Datei fehlt: {SEED_FILE.relative_to(REPO_ROOT)}", file=sys.stderr)
        return 1
    seed = parse_simple_yaml(SEED_FILE.read_text(encoding="utf-8"))
    payload = json.dumps(json.dumps(seed, ensure_ascii=False), ensure_ascii=False)
    SpacetimeCli.detect().call("seed_demo", payload)
    print(f"Demodaten geschrieben: {len(seed.get('keepers', []))} Demo-Imker, {len(seed.get('hives', []))} Stockbilanzen.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
