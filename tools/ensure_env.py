"""Legt die lokale ``.env`` aus ``env.example`` an, falls sie fehlt.

Eine vorhandene ``.env`` bleibt unangetastet. So kommt ein frischer Klon mit
funktionierenden Dev-Werten hoch, ohne lokale Anpassungen zu ueberschreiben.
"""

from __future__ import annotations

import shutil
from pathlib import Path


def ensure_env(example: Path = Path("env.example"), target: Path = Path(".env")) -> int:
    """Kopiert ``example`` nach ``target``, wenn ``target`` noch nicht existiert.

    Returns:
        0 bei Erfolg (kopiert oder bereits vorhanden), 1 wenn die Vorlage fehlt.
    """
    if target.exists():
        return 0
    if not example.exists():
        print(f"{example} fehlt -- es kann keine {target} angelegt werden.")
        return 1
    shutil.copyfile(example, target)
    print(f"{target} aus {example} angelegt.")
    return 0


if __name__ == "__main__":
    raise SystemExit(ensure_env())
