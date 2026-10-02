// src/net/cellSubscriptions.ts — Interessensverwaltung: abonniert die Zellen um den lokalen Spieler.
import { tables, type DbConnection, type SubscriptionHandle } from './bindings';
import { CellSize, cellCentre, neighbourCells, packCell } from '../../shared/world';

/** Hält ein Abo über die (2r+1)² Zellen um den Spieler und verschiebt es beim Zellwechsel (Zell-Abos). */
export class CellSubscriptions {
  private readonly connection: DbConnection;
  private readonly radius: number;
  private readonly hysteresis: number;
  private centreCell: number | undefined;
  private active: SubscriptionHandle | undefined;

  /**
   * @param radius Zellen in jede Richtung (1 → 3×3 Zellen).
   * @param hysteresis Meter, die der Spieler über die Zellgrenze hinaus muss, bevor das Abo wandert.
   */
  public constructor(connection: DbConnection, radius = 1, hysteresis = 4) {
    this.connection = connection;
    this.radius = radius;
    this.hysteresis = hysteresis;
  }

  /** Pro Frame mit der eigenen Position aufrufen; abonniert nur bei einem echten Zellwechsel neu. */
  public update(x: number, z: number): void {
    const cell = packCell(x, z);
    if (cell === this.centreCell) {
      return;
    }
    if (this.centreCell !== undefined && this.insideHysteresis(x, z, this.centreCell)) {
      return; // knapp hinter der Grenze: kein Flattern beim Entlangfliegen
    }
    this.centreCell = cell;
    const previous = this.active;
    // Eine Gleichheitsabfrage je Zelle: der Server wertet sie nur bei passenden Zeilen aus und teilt sie
    // zwischen allen Clients, die dieselbe Zelle sehen. Ein OR über Zellen verliert diese Optimierung.
    const queries = neighbourCells(x, z, this.radius).flatMap((c) => [
      tables.beeState.where((row) => row.cell.eq(c)),
      tables.buzzEvent.where((row) => row.cell.eq(c)),
    ]);
    this.active = this.connection
      .subscriptionBuilder()
      .onApplied(() => {
        // Erst neu abonnieren, dann alt abbestellen: überlappende Zellen werden nicht erneut übertragen.
        if (previous !== undefined && !previous.isEnded()) {
          previous.unsubscribe();
        }
      })
      .onError((ctx) => console.error('cell subscription failed', ctx.event))
      .subscribe(queries);
  }

  /** Gibt das Abo frei, z. B. bevor die Verbindung ersetzt wird. */
  public dispose(): void {
    if (this.active !== undefined && !this.active.isEnded()) {
      this.active.unsubscribe();
    }
    this.active = undefined;
    this.centreCell = undefined;
  }

  private insideHysteresis(x: number, z: number, cell: number): boolean {
    const centre = cellCentre(cell);
    const limit = CellSize / 2 + this.hysteresis;
    return Math.abs(x - centre.x) <= limit && Math.abs(z - centre.z) <= limit;
  }
}
