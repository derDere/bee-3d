# Data model and world tick

The reference design behind the measured numbers. The code is the lab module, cleaned up; it
compiled and ran on SpacetimeDB 2.10.2 [verified 2.10.2]. Security checks around it: skill
`spacetimedb-security`.

## Hot and cold tables

Split tables by update frequency and audience, not by entity:

| Table | Visibility | Changes | Content |
|---|---|---|---|
| `account` | private | once | `identity` (primary key) → `player_id u32` (unique, auto-increment) |
| `player_profile` | public | rarely | `player_id`, display name, cosmetic choices |
| `bee_state` | public | up to 20 Hz | `player_id`, `cell`, position, compact rotation, `tick` |
| `pose_inbox` | private | per report | latest reported pose per player |
| `player_stats`, `inventory` | private, exposed through views | on events | progression data |

Rules:

- Hot rows reference players by `u32`; `Identity` (32 bytes) appears only in `account`.
- Rotation as `i16` angles (`Math.round(angle * 32767 / Math.PI)`) instead of a float
  quaternion; positions stay `f32` (sub-millimetre precision at 4 km).
- No strings, arrays or `Option` in hot rows; no `Timestamp` when a `u32` tick number suffices.
- Order columns from large to small alignment when several small fields exist [docs].
- "Online" is the existence of a `bee_state` row, not a boolean column: the tick iterates only
  live rows (existence-based processing).

## Shared constants

```ts
// shared/world.ts — von Modul und Browser-Client gemeinsam genutzt (Weltkonstanten)
export const TickHz = 20;
export const TickSeconds = 1 / TickHz;
export const CellSize = 64;          // Meter je Interessenzelle
export const WorldHalfExtent = 4096; // Meter
export const MaxSpeed = 30;          // m/s
export const SpeedSlack = 1.25;      // Toleranz für Takt-Jitter
export const MaxElapsedTicks = TickHz; // Sprungbudget höchstens 1 s (Herzschlag des Clients)

/** Packt die Zellkoordinaten in einen u32, damit Abos mit einer einzigen Gleichheit filtern (Zellschlüssel). */
export function packCell(x: number, z: number): number {
  const cx = Math.floor((x + WorldHalfExtent) / CellSize) & 0xffff;
  const cz = Math.floor((z + WorldHalfExtent) / CellSize) & 0xffff;
  return ((cx << 16) | cz) >>> 0;
}

/** Zellschlüssel der (2r+1)²-Nachbarschaft (Nachbarzellen). */
export function neighbourCells(x: number, z: number, radius: number): number[] {
  const cx = Math.floor((x + WorldHalfExtent) / CellSize);
  const cz = Math.floor((z + WorldHalfExtent) / CellSize);
  const cells: number[] = [];
  for (let dx = -radius; dx <= radius; dx++) {
    for (let dz = -radius; dz <= radius; dz++) {
      cells.push(((((cx + dx) & 0xffff) << 16) | ((cz + dz) & 0xffff)) >>> 0);
    }
  }
  return cells;
}
```

## Inbox and tick (TypeScript module)

```ts
import { schema, table, t, SenderError, ScheduleAt, type InferSchema, type ReducerCtx } from 'spacetimedb/server';
import { CellSize, MaxElapsedTicks, MaxSpeed, SpeedSlack, TickSeconds, WorldHalfExtent, neighbourCells, packCell } from '../../shared/world';

const beeState = table({ name: 'bee_state', public: true }, {
  playerId: t.u32().primaryKey(),
  cell: t.u32().index('btree'),
  x: t.f32(), y: t.f32(), z: t.f32(),
  yaw: t.i16(), pitch: t.i16(),
  tick: t.u32(),
});

const poseInbox = table({ name: 'pose_inbox' }, {
  playerId: t.u32().primaryKey(),
  x: t.f32(), y: t.f32(), z: t.f32(),
  yaw: t.i16(), pitch: t.i16(),
});

const config = table({ name: 'config' }, { id: t.u8().primaryKey(), epochMicros: t.u64() }); // nur beim init geschrieben
const tickTimer = table({ name: 'tick_timer' }, { scheduledId: t.u64().primaryKey().autoInc(), scheduledAt: t.scheduleAt() });

const spacetimedb = schema({ beeState, poseInbox, config, tickTimer /* , account, … */ });
export default spacetimedb;
type Ctx = ReducerCtx<InferSchema<typeof spacetimedb>>;

export const init = spacetimedb.init((ctx) => {
  ctx.db.config.insert({ id: 0, epochMicros: ctx.timestamp.microsSinceUnixEpoch });
  ctx.db.tickTimer.insert({ scheduledId: 0n, scheduledAt: ScheduleAt.interval(BigInt(Math.round(TickSeconds * 1e6))) });
});

/** Taktnummer aus der Zeit statt aus einer Zeile, die jeden Takt ins Commit-Log schreibt (Taktnummer). */
function currentTick(ctx: Ctx): number {
  const epoch = ctx.db.config.id.find(0)?.epochMicros ?? ctx.timestamp.microsSinceUnixEpoch;
  return Math.round(Number(ctx.timestamp.microsSinceUnixEpoch - epoch) / (TickSeconds * 1e6));
}

/** Nimmt die letzte Pose eines Spielers an; der Takt übernimmt sie (Posen-Eingang). */
export const reportPose = spacetimedb.reducer(
  { x: t.f32(), y: t.f32(), z: t.f32(), yaw: t.i16(), pitch: t.i16() },
  (ctx, pose) => {
    if (!Number.isFinite(pose.x) || !Number.isFinite(pose.y) || !Number.isFinite(pose.z)) throw new SenderError('pose not finite');
    if (Math.abs(pose.x) >= WorldHalfExtent || Math.abs(pose.z) >= WorldHalfExtent) throw new SenderError('pose out of bounds');
    const playerId = requirePlayerId(ctx); // account-Lookup per ctx.sender (Skill spacetimedb-security)
    if (!ctx.db.beeState.playerId.find(playerId)) throw new SenderError('not spawned');
    const row = { playerId, ...pose };
    if (ctx.db.poseInbox.playerId.find(playerId)) ctx.db.poseInbox.playerId.update(row);
    else ctx.db.poseInbox.insert(row);
  }
);

/** Weltakt: übernimmt alle Eingänge in einer Transaktion (Weltakt). */
export const worldTick = spacetimedb.reducer({ onSchedule: tickTimer }, { arg: tickTimer.rowType }, (ctx) => {
  const tick = currentTick(ctx);
  for (const pose of Array.from(ctx.db.poseInbox.iter())) { // erst materialisieren, dann löschen
    ctx.db.poseInbox.playerId.delete(pose.playerId);
    const state = ctx.db.beeState.playerId.find(pose.playerId);
    if (!state) continue;
    const elapsed = Math.min(Math.max(1, tick - state.tick), MaxElapsedTicks); // Stillstand sammelt kein Sprungbudget
    const maxStep = MaxSpeed * SpeedSlack * elapsed * TickSeconds;
    const dx = pose.x - state.x, dy = pose.y - state.y, dz = pose.z - state.z;
    const dist = Math.hypot(dx, dy, dz);
    const k = dist > maxStep ? maxStep / dist : 1; // zu schnelle Sprünge werden gekappt
    const moved = dist * k > 0.01 || pose.yaw !== state.yaw || pose.pitch !== state.pitch;
    if (!moved) continue; // unveränderte Zeilen erzeugen weder Update noch Commit-Log-Eintrag
    const x = state.x + dx * k, y = state.y + dy * k, z = state.z + dz * k;
    ctx.db.beeState.playerId.update({ playerId: pose.playerId, cell: packCell(x, z), x, y, z, yaw: pose.yaw, pitch: pose.pitch, tick });
  }
});

function requirePlayerId(ctx: Ctx): number { /* Skill spacetimedb-security, references/module-hardening.md */ return 0; }
```

Why this shape:

- One transaction per tick touches the public table → one update message per client per tick
  regardless of how often clients report.
- The tick number comes from `ctx.timestamp` relative to the world epoch: a tick without
  changes writes nothing, and an idle world adds 0 bytes to the commit log instead of ≈2.8 KB/s
  for a clock row rewritten every tick [measured]. The schedule is anchored to fixed times and
  only runs late, so rounding yields one number per tick. Clients learn the tick from the
  `tick` column of moved rows (skill `spacetimedb-babylon`, time sync).
- Reports are rejected before they touch the inbox when they are not finite or out of bounds;
  speed is clamped in the tick, where the authoritative previous position is known. A bee at
  rest writes no row, so the elapsed ticks are capped at `MaxElapsedTicks`; otherwise idle time
  would build up a teleport budget.
- `Array.from(…iter())` materializes the inbox before rows are deleted [recommendation].

## Write-volume control

Every committed transaction lands in the commit log forever, and every public row change is
sent to all matching subscribers:

| Source of writes | Control |
|---|---|
| Pose reports | 10–15 Hz while moving; the client sends nothing while the pose is unchanged and a heartbeat every 0.5–1 s |
| Tick | skip unchanged rows; tick number from time instead of a per-tick clock row |
| Effects | event tables (still logged, never stored) |
| Stats and counters | accumulate in the client-facing tick only when they matter; batch into one row per player |
| Chat, logs, history | bounded tables with scheduled cleanup (`ScheduleAt.interval`) |

## Proximity without O(n²)

The `cell` index doubles as a spatial hash for game logic:

```ts
/** Sucht Bienen in Reichweite über die Zellnachbarschaft (Nachbarschaftssuche). */
function beesNear(ctx: Ctx, x: number, z: number, radius: number): Array<{ playerId: number; x: number; z: number }> {
  const result: Array<{ playerId: number; x: number; z: number }> = [];
  const r2 = radius * radius;
  for (const cell of neighbourCells(x, z, Math.ceil(radius / CellSize))) {
    for (const other of ctx.db.beeState.cell.filter(cell)) {
      const dx = other.x - x, dz = other.z - z;
      if (dx * dx + dz * dz <= r2) result.push({ playerId: other.playerId, x: other.x, z: other.z });
    }
  }
  return result;
}
```

The probe in [lab-results.md](lab-results.md) shows why: 2,000 rows checked pairwise took
7–29 ms per pass; a 3×3 cell lookup touches only the rows nearby.

## Cleanup and growth

- Delete hot rows on disconnect (`clientDisconnected`) once no other connection of the player
  remains; keep cold rows (profile, progress).
- Account rows created in `clientConnected` grow with every anonymous HTTP request; create
  them in an explicit, rate-limited reducer instead (skill `spacetimedb-security`).
- Periodic cleanup reducers delete stale rows by an indexed timestamp-like column (store ticks
  or milliseconds as `u64`, because `Timestamp` columns are not indexable [docs]).
- Larger refactorings of hot tables follow the incremental-migration pattern (skill
  `spacetimedb-ops`).
