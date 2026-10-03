"""init -- macht die Welt ohne Demodaten spielbereit.

Ruft den idempotenten Besitzer-Reducer ``sync_world`` auf: Er legt fehlende Zustandszeilen der
statischen Welt an (Bienenstöcke, Fliegennester, Blumenfelder aus ``shared/worldgen.ts``) und lässt
vorhandene Zeilen unverändert. Die Definitionen selbst (Quests, Upgrades, Weltaufbau) sind
Konstanten in ``shared/`` und brauchen keine Tabelle.
"""

from __future__ import annotations

from spacetime_cli import SpacetimeCli


def main() -> int:
    SpacetimeCli.detect().call("sync_world")
    print("Welt synchronisiert.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
