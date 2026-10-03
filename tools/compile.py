"""compile -- baut den eigenen Code außerhalb von Docker.

Reihenfolge:

1. Abhängigkeiten von Client (Repo-Root) und Modul (``server/``) installieren, wenn sie fehlen
   oder der Lockfile neuer ist.
2. Modul typprüfen, mit ``spacetime build`` bündeln (``server/dist/bundle.js``) und daraus die
   Client-Bindings erzeugen (``src/net/bindings/``).
3. Client typprüfen; außerhalb von ``APP_ENV=dev`` zusätzlich den Produktions-Build nach
   ``dist/`` schreiben, den der web-Container einpackt.
"""

from __future__ import annotations

from pathlib import Path

from spacetime_cli import SpacetimeCli
from stack_env import REPO_ROOT, app_env, executable, run

BINDINGS_DIR = "src/net/bindings"
BUNDLE = "server/dist/bundle.js"


def ensure_node_modules(package_dir: Path) -> None:
    """Installiert die npm-Abhängigkeiten eines Pakets, wenn ``node_modules`` fehlt oder veraltet ist."""
    lockfile = package_dir / "package-lock.json"
    installed_marker = package_dir / "node_modules" / ".package-lock.json"
    if installed_marker.exists() and installed_marker.stat().st_mtime >= lockfile.stat().st_mtime:
        return
    npm = executable("npm")
    prefix = [] if package_dir == REPO_ROOT else ["--prefix", package_dir.relative_to(REPO_ROOT).as_posix()]
    run([npm, "ci", *prefix, "--no-audit", "--no-fund"])


def typecheck(project: str) -> None:
    """Prüft ein TypeScript-Projekt mit dem TypeScript des Repo-Roots."""
    run([executable("npx"), "tsc", "--noEmit", "-p", project])


def build_module(cli: SpacetimeCli) -> None:
    """Bündelt das SpacetimeDB-Modul und erzeugt die Client-Bindings aus dem Bündel."""
    cli.run(["build", "--module-path", "server"])
    cli.run(["generate", "--lang", "typescript", "--out-dir", BINDINGS_DIR, "--js-path", BUNDLE, "--yes"])


def main() -> int:
    ensure_node_modules(REPO_ROOT)
    ensure_node_modules(REPO_ROOT / "server")
    typecheck("server/tsconfig.json")
    build_module(SpacetimeCli.detect())
    typecheck("tsconfig.json")
    if app_env() != "dev":
        run([executable("npx"), "vite", "build"])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
