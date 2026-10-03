"""Ruft die spacetime-CLI im Stand des Servers auf: auf dem Host oder im Werkzeug-Container.

Ist ``spacetime`` auf dem Host installiert, läuft sie direkt und spricht den Server über die
Loopback-Adresse an. Sonst startet ``docker compose run`` den Dienst ``cli`` (gleiches Image wie
der Server, Profil ``tools``); er sieht das Repo unter ``/work`` und den Server unter seinem
Dienstnamen. Pfade werden in beiden Fällen relativ zum Repo-Root übergeben.

Die Besitzer-Identität der Datenbank liegt in ``mounts/spacetime-cli/cli.toml``.
"""

from __future__ import annotations

import shutil
import subprocess
from collections.abc import Sequence
from dataclasses import dataclass

from stack_env import REPO_ROOT, env_value, executable, run

CLI_CONFIG = "mounts/spacetime-cli/cli.toml"
CONTAINER_SERVER_URL = "http://spacetimedb:3000"


@dataclass(frozen=True, slots=True)
class SpacetimeCli:
    """Aufrufer der spacetime-CLI (Host oder Container)."""

    command_prefix: tuple[str, ...]
    server_url: str
    in_container: bool

    @staticmethod
    def detect() -> SpacetimeCli:
        """Wählt die Host-CLI, falls vorhanden, sonst den Werkzeug-Container."""
        host_cli = shutil.which("spacetime")
        if host_cli is not None:
            return SpacetimeCli((host_cli,), env_value("SPACETIMEDB_URL", "http://127.0.0.1:3000"), in_container=False)
        docker = executable("docker")
        prefix = (docker, "compose", "--profile", "tools", "run", "--rm", "-T", "cli")
        return SpacetimeCli(prefix, CONTAINER_SERVER_URL, in_container=True)

    @property
    def database(self) -> str:
        """Name der Weltdatenbank."""
        return env_value("SPACETIMEDB_DATABASE", "bee-world")

    def run(self, arguments: Sequence[str], *, check: bool = True, capture: bool = False) -> subprocess.CompletedProcess[str]:
        """Führt die CLI mit den Argumenten aus."""
        (REPO_ROOT / CLI_CONFIG).parent.mkdir(parents=True, exist_ok=True)
        return run([*self.command_prefix, *arguments], check=check, capture=capture)

    def owner(
        self, subcommand: str, arguments: Sequence[str], *, check: bool = True, capture: bool = False
    ) -> subprocess.CompletedProcess[str]:
        """Führt einen Unterbefehl mit der Besitzer-Identität gegen den Server des Stacks aus.

        ``--server`` steht direkt hinter dem Unterbefehl, damit variadische Argumente (``call``)
        es nicht verschlucken.
        """
        command = ["--config-path", CLI_CONFIG, subcommand, "--server", self.server_url, *arguments]
        return self.run(command, check=check, capture=capture)

    def call(self, reducer: str, *json_arguments: str) -> None:
        """Ruft einen Reducer der Weltdatenbank als Besitzer auf."""
        self.owner("call", [self.database, reducer, *json_arguments])
