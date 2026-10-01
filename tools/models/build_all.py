"""Baut alle Modelle: Generatoren → Roh-glb → Validierung → optimiertes Auslieferungs-glb.

Die Roh-glbs landen in ``.temp/models/``, die Auslieferungsdateien in ``public/assets/models/``
(jeweils relativ zum Repo-Root); Unterordner bleiben erhalten (``flora/``, ``islands/``).
Die Reihenfolge in ``GENERATORS`` zählt: Generatoren, die fertige Teile anderer Generatoren
einbauen, stehen nach diesen. Der Python-Code gehört nicht zum Build-Artefakt des Spiels.
"""

from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path
from typing import Protocol

import bee

REPO_ROOT = Path(__file__).resolve().parents[2]
RAW_DIR = REPO_ROOT / ".temp" / "models"
FINAL_DIR = REPO_ROOT / "public" / "assets" / "models"

# Optimierung für Auslieferung: WebP-Texturen und Meshopt-Kompression; Szenengraph, Meshes und
# Materialien bleiben unverändert, damit Knoten (Pivots, Animationen) und LODs erhalten bleiben.
# Leere Ankerknoten (Strahlursprung, Lebensbalken) bleiben über --prune false erhalten.
OPTIMIZE_OPTIONS = (
    "--texture-compress", "webp",
    "--compress", "meshopt",
    "--flatten", "false",
    "--join", "false",
    "--instance", "false",
    "--palette", "false",
    "--simplify", "false",
    "--prune", "false",
)  # fmt: skip

_CLEAN_MARKERS = ("No errors found.", "No warnings found.")


class ModelGenerator(Protocol):
    """Generator-Modul: schreibt Roh-glbs in ein Verzeichnis und liefert deren Pfade."""

    def build(self, raw_dir: Path) -> list[Path]: ...


GENERATORS: tuple[ModelGenerator, ...] = (bee,)


def run_gltf_transform(*arguments: str) -> subprocess.CompletedProcess[str]:
    """Ruft ``npx gltf-transform`` im Repo-Root auf (npx unter Windows über ``shutil.which``)."""
    npx = shutil.which("npx")
    if npx is None:
        raise RuntimeError("npx wurde nicht gefunden (Node.js installieren).")
    return subprocess.run(
        [npx, "gltf-transform", *arguments],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        encoding="utf-8",
        check=False,
    )


def validate(raw_path: Path) -> None:
    """Validiert ein Roh-glb; Fehler und Warnungen brechen den Build ab."""
    result = run_gltf_transform("validate", str(raw_path.relative_to(REPO_ROOT)))
    if result.returncode != 0 or not all(marker in result.stdout for marker in _CLEAN_MARKERS):
        raise RuntimeError(f"Validierung von {raw_path.name} fehlgeschlagen:\n{result.stdout}{result.stderr}")


def optimize(raw_path: Path, final_path: Path) -> None:
    """Erzeugt aus dem Roh-glb das Auslieferungs-glb."""
    final_path.parent.mkdir(parents=True, exist_ok=True)
    result = run_gltf_transform(
        "optimize",
        str(raw_path.relative_to(REPO_ROOT)),
        str(final_path.relative_to(REPO_ROOT)),
        *OPTIMIZE_OPTIONS,
    )
    if result.returncode != 0:
        raise RuntimeError(f"Optimierung von {raw_path.name} fehlgeschlagen:\n{result.stdout}{result.stderr}")


def main() -> int:
    """Führt alle Generatoren aus und liefert den Exit-Code."""
    for generator in GENERATORS:
        for raw_path in generator.build(RAW_DIR):
            validate(raw_path)
            final_path = FINAL_DIR / raw_path.relative_to(RAW_DIR)
            optimize(raw_path, final_path)
            print(
                f"{raw_path.name}: roh {raw_path.stat().st_size / 1024:.1f} KiB -> "
                f"final {final_path.stat().st_size / 1024:.1f} KiB"
            )
    return 0


if __name__ == "__main__":
    sys.exit(main())
