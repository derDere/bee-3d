# Interest management

Each client replicates only the part of the world it can perceive. In SpacetimeDB that is a
subscription problem: which queries a client holds decides what it receives, and the shape of
the queries decides what the server must evaluate for every transaction.

## How the server evaluates subscriptions [source]

- Queries are deduplicated across all clients by their text; a query held by 40 clients is
  evaluated once per affected transaction and the result is copied 40 times.
- After a transaction, the server finds affected queries through two indexes:
  - **search arguments** — a query whose plan contains one single-column equality
    (`cell = 4194368`) is registered under that table, column and value; it runs only when a
    changed row carries that value;
  - **all others** — ranges, `!=`, `OR`, compound equalities (`a = 1 AND b = 2`) and unfiltered
    queries are registered per table and run on **every** change of that table.
- Evaluation is incremental (only the transaction's inserted and deleted rows are joined
  against the query) but it happens on the commit path, before the next transaction.
- Joins in subscriptions need indexes on both join columns and are limited to two tables.

Consequence: every hot table is queried with exactly one indexed equality per query. The typed
query `tables.beeState.where((row) => row.cell.eq(k))` compiles to
`SELECT * FROM "bee_state" WHERE "bee_state"."cell" = k`; `.or()` compiles to an `OR` and loses
the pruning [verified 2.10.2] — several cells are several queries in one `subscribe([…])` call.

## Cells

- One `u32` column `cell` packs the horizontal cell coordinates
  (`((cx & 0xffff) << 16 | (cz & 0xffff)) >>> 0`); the same function lives in `shared/` for
  module and client. A packed column keeps every cell query a single equality.
- Cell size ≈ the distance at which other players must be visible divided by 1–1.5; with radius
  1 the client sees at least one full cell in every direction.
- Radius 1 (9 cells) is the default. Radius 2 (25 cells) measured +50 % CPU and +70 % bytes
  [measured]. Large view distances use bigger cells, not bigger radii.
- Vertical extent: bee-3d islands span a limited height band, so cells stay 2D. A world with
  stacked layers adds the layer to the packed key.

## Client: moving the subscription

The client code below ran in the lab bots [verified 2.10.2]; it belongs in `src/net/` (skill
`spacetimedb-babylon`).

```ts
import { tables, type DbConnection, type SubscriptionHandle } from './bindings';
import { neighbourCells, packCell } from '../../shared/world';

/** Hält das Zell-Abo um den lokalen Spieler aktuell (Interessensverwaltung). */
export class CellSubscriptions {
  private readonly connection: DbConnection;
  private readonly radius: number;
  private centreCell: number | undefined;
  private active: SubscriptionHandle | undefined;

  public constructor(connection: DbConnection, radius: number) {
    this.connection = connection;
    this.radius = radius;
  }

  /** Pro Frame aufrufen; abonniert nur neu, wenn sich die Zentrumszelle ändert. */
  public update(x: number, z: number): void {
    const centre = packCell(x, z);
    if (centre === this.centreCell) return;
    this.centreCell = centre;
    const previous = this.active;
    const queries = neighbourCells(x, z, this.radius).flatMap((cell) => [
      tables.beeState.where((row) => row.cell.eq(cell)),
      tables.buzzEvent.where((row) => row.cell.eq(cell)),
    ]);
    this.active = this.connection
      .subscriptionBuilder()
      .onApplied(() => {
        // Erst neu abonnieren, dann alt abbestellen: überlappende Zellen werden nicht erneut gesendet.
        if (previous !== undefined && !previous.isEnded()) previous.unsubscribe();
      })
      .onError((ctx) => console.error('cell subscription failed', ctx.event))
      .subscribe(queries);
  }

  /** Gibt das Abo frei, z. B. bevor die Verbindung ersetzt wird. */
  public dispose(): void {
    if (this.active !== undefined && !this.active.isEnded()) this.active.unsubscribe();
    this.active = undefined;
    this.centreCell = undefined;
  }
}
```

Refinements:

- **Hysteresis:** switch the centre cell only after the player is a few metres inside the new
  cell, so flying along a border does not re-subscribe every frame.
- **Cell crossings of others:** a mover that changes cell appears as a delete in the old cell's
  query and an insert in the new one; when the client holds both cells it may see an update,
  otherwise delete then insert. The replication layer keys entities by `playerId`, not by
  query, so a delete followed by an insert in the same transaction does not flicker
  (skill `spacetimedb-babylon`, `references/replication.md`).
- **Lifetime groups:** static or global data (`player_profile` of visible players, island
  state, config) lives in a separate subscription that never moves with the cells.

## Views or queries

| Data | Use |
|---|---|
| Moving entities in an area | Plain cell queries on a public table |
| Data shared by a group that anyone may see (island state, public team rosters) | Public table with a `group_id` column, queried by equality (views take no parameters) |
| Data shared by a group that must stay private (team chat) | Per-user view (cost per subscriber) until scoped views exist; keep the result small |
| The caller's own private data (inventory, mail) | Per-user view (`ViewContext`) — small results only |
| Aggregates for everyone (leaderboard, player count) | Anonymous view (query builder or `count()`) |

Per-user views for shared data cost one evaluation per subscriber; scoped views that share one
result per group are an open upstream pull request (#5975), not part of 2.10.2.

## Events in areas

Event tables accept the same cell filter: an event row carries the `cell` of its origin, and
clients subscribe per cell exactly like `bee_state`. Effects outside the neighbourhood never
reach the client.

## Larger worlds and more players

1. First shrink the per-client cost: cell size, radius, report rate, row size.
2. Then shrink per-transaction cost: everything hot on single-equality queries, no per-user
   views on hot tables.
3. Only then split: one database per independent region or room, all inside the single
   production instance. Clients connect to the database of their region; a root database holds
   global data. Cross-database calls are announced but not released in 2.10.x, so moving a
   player between regions is a client-driven handover (leave → join) until then.
