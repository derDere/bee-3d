# Module API (TypeScript, 2.10.2) with Rust equivalents

Everything in this file compiled and ran on a SpacetimeDB 2.10.2 lab server unless a line carries
another tag. The official per-language references live in the repository at the matching tag:
`skills/typescript-server/SKILL.md`, `skills/rust-server/SKILL.md`.

## Module skeleton

```ts
// server/src/index.ts — Einstiegspunkt des Moduls
import { schema, table, t, SenderError, ScheduleAt, type InferSchema, type ReducerCtx } from 'spacetimedb/server';
import { packCell } from '../../shared/cells'; // geteilter, reiner Code; wird mitgebündelt

const beeState = table(
  { name: 'bee_state', public: true },
  {
    playerId: t.u32().primaryKey(),
    cell: t.u32().index('btree'),
    x: t.f32(),
    y: t.f32(),
    z: t.f32(),
    tick: t.u32(),
  }
);

const spacetimedb = schema({ beeState }); // genau EIN Objekt; Schlüssel = Accessor (ctx.db.beeState)
export default spacetimedb; // Pflicht: das Schema ist der Default-Export

/** Kontexttyp für Hilfsfunktionen (Reducer-Kontext). */
type Ctx = ReducerCtx<InferSchema<typeof spacetimedb>>;
```

- Named exports are reserved for module functions (reducers, lifecycle hooks, views,
  procedures, HTTP exports). Helpers and constants stay unexported.
- The export name becomes the function name; canonical (SQL, CLI, wire) names are the
  snake_case form of accessors and export names (`reportPose` → `report_pose`).
- `tsconfig.json` of the module: `target` `ESNext`, `module` `ESNext`, `lib`
  `["ES2021", "dom"]`, `moduleResolution` `bundler`, `isolatedModules`, `noEmit`, `strict`
  (template from `spacetime init --lang typescript`).
- Callbacks are synchronous; `async`, `await` and promises do not exist in modules.
- `spacetime build` runs `server/node_modules/.bin/tsc --noEmit` only when that file exists in
  the module folder itself; otherwise it prints "tsc not found in node_modules" and bundles
  **without a type check**. The bundler (rolldown, output `dist/bundle.js` with inline source
  map) resolves packages from the module folder upwards, so `spacetimedb/server` may come from
  a parent `node_modules`; when it is missing anywhere, the build fails with "Could not resolve
  'spacetimedb/server'" [verified 2.10.2]. `npm ci --prefix server` gives the module its own
  `typescript`. Relative imports outside the folder (`../../shared/`) are bundled.

## Column types

| Builder | JS value | Rust | BSATN bytes |
|---|---|---|---|
| `t.bool()` | `boolean` | `bool` | 1 |
| `t.u8()` `t.i8()` · `t.u16()` `t.i16()` · `t.u32()` `t.i32()` | `number` | `u8` … `i32` | 1 · 2 · 4 |
| `t.u64()` `t.i64()` `t.u128()` … `t.i256()` | `bigint` (literals `0n`) | `u64` … | 8 … 32 |
| `t.f32()` · `t.f64()` | `number` | `f32` · `f64` | 4 · 8 |
| `t.string()` | `string` | `String` | 4 + UTF-8 length |
| `t.identity()` | `Identity` | `Identity` | 32 |
| `t.connectionId()` | `ConnectionId` | `ConnectionId` | 16 |
| `t.timestamp()` · `t.timeDuration()` | `Timestamp` · `TimeDuration` (micros as `bigint`) | `Timestamp` · `TimeDuration` | 8 |
| `t.scheduleAt()` | `ScheduleAt` | `ScheduleAt` | tag + 8 |
| `t.option(T)` | `T \| undefined` (optional key in generated client types) | `Option<T>` | 1 + T |
| `t.array(T)` | `T[]` | `Vec<T>` | 4 + n·T |
| `t.object('Name', {…})` | object | `#[derive(SpacetimeType)] struct` | sum of fields |
| `t.enum('Name', { a: t.unit(), b: T })` | `{ tag: 'a' }` / `{ tag: 'b', value }` | `#[derive(SpacetimeType)] enum` | 1 + payload |

Index keys: integers, `bool`, `string`, `Identity`, `ConnectionId`, `Uuid`, and enums without
payload. `f32`, `f64`, `Timestamp`, `TimeDuration`, arrays and structs are not indexable
[docs] — store scaled integers when a float must be indexed.

## Tables, constraints, indexes

```ts
const probeItem = table(
  {
    name: 'probe_item',        // kanonischer Name; ohne Angabe snake_case des Schema-Schlüssels
    public: true,              // ohne public: privat
    indexes: [{ accessor: 'byOwnerKind', algorithm: 'btree', columns: ['owner', 'kind'] }],
  },
  {
    id: t.u32().primaryKey().index('direct'), // direkter Index: O(1), dichte Ganzzahlen ab 0
    owner: t.u32(),
    kind: t.u8(),
    label: t.string().default(''),           // Default nur für ans Ende angehängte Spalten
  }
);
```

- One primary-key column per table; composite keys use an auto-increment key plus a
  multi-column btree index. Without a primary key the whole row is the key (set semantics).
- `.unique()` creates a unique index with `find()`; several unique columns are allowed.
- `.autoInc()` fills the column when the inserted value is `0` / `0n`; gaps are normal.
- `.default(v)` cannot combine with `.primaryKey()`, `.unique()` or `.autoInc()`; the TypeScript
  error for that mistake reads "Expected 3 arguments, but got 2" [docs].
- `{ event: true }` makes an event table; the flag cannot change after the first publish.
- Several tables may share a column object (`player` and `logged_out_player`): existence-based
  state without boolean flags.

## Table operations

| Operation | TypeScript | Rust |
|---|---|---|
| Insert (returns the stored row, auto-increment filled) | `ctx.db.t.insert(row)` | `ctx.db.t().insert(row)` · `try_insert(row)?` |
| Find by primary key or unique column | `ctx.db.t.id.find(v)` → row or `undefined` | `ctx.db.t().id().find(v)` → `Option` |
| Filter by btree index (iterator) | `ctx.db.t.cell.filter(v)` | `ctx.db.t().cell().filter(v)` |
| Prefix / range on composite index | `filter([owner, kind])`, `filter(owner)`, `filter([owner, new Range(…)])` | `filter((owner, kind))`, `filter(&owner)`, `filter((owner, 1..=9))` |
| Update (primary key only) | `ctx.db.t.id.update({ ...row, x })` | `ctx.db.t().id().update(Row { x, ..row })` |
| Delete by key / by index | `ctx.db.t.id.delete(v)` · `ctx.db.t.cell.delete(v)` | same shape |
| Scan, count | `ctx.db.t.iter()`, `ctx.db.t.count()` (count is O(1)) | `iter()`, `count()` |

- `Range` comes from `spacetimedb/server`:
  `new Range({ tag: 'included', value: 1 }, { tag: 'excluded', value: 10 })`.
- Materialize before mutating the same table during a scan:
  `for (const row of Array.from(ctx.db.t.iter())) { … delete/update … }` [recommendation].
- Changing a primary key value is a delete plus an insert; clients see delete and insert.

## Reducers

```ts
export const reportPose = spacetimedb.reducer(
  { x: t.f32(), y: t.f32(), z: t.f32() },
  (ctx, { x, y, z }) => {
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      throw new SenderError('pose not finite'); // Fehler des Aufrufers: Transaktion wird zurückgerollt
    }
    // …
  }
);

export const spawn = spacetimedb.reducer((ctx) => { /* ohne Argumente; Client ruft spawn({}) */ });
```

- `throw new SenderError(msg)` reports a caller error; any other exception is a programmer
  error (logged as internal). Both roll back the whole transaction.
- Calling another reducer function runs inside the same transaction (no nesting).
- Rust: `#[reducer] pub fn report_pose(ctx: &ReducerContext, x: f32, …) -> Result<(), String>`;
  import `spacetimedb::Table` for `insert`, `iter`, `count`.

## Reducer context

| TypeScript | Rust | Meaning |
|---|---|---|
| `ctx.sender` | `ctx.sender()` | Caller identity — the only trustworthy "who" |
| `ctx.connectionId` (`ConnectionId \| null`) | `ctx.connection_id()` (`Option`) | Connection; absent for `init` and scheduled calls |
| `ctx.timestamp` (`.microsSinceUnixEpoch`: `bigint`) | `ctx.timestamp` | Transaction time, fixed for the whole call |
| `ctx.random()` · `ctx.random.integerInRange(a, b)` · `ctx.random.fill(bytes)` | `ctx.random::<T>()` · `ctx.rng()` | Deterministic random numbers |
| `ctx.senderAuth.isInternal` · `.jwt` (`issuer`, `subject`, `audience`, `fullPayload`) | `ctx.sender_auth().is_internal()` · `.jwt()` (`issuer()`, `subject()`, `audience()`, `raw_payload()`) | Token claims; checks: skill `spacetimedb-security` |
| `ctx.databaseIdentity` | `ctx.database_identity()` | Identity of the database itself (`ctx.identity` is a deprecated alias) |

## Lifecycle reducers

```ts
export const init = spacetimedb.init((ctx) => { /* erster Publish und --delete-data; ctx.sender = Owner */ });
export const onConnect = spacetimedb.clientConnected((ctx) => { /* Fehler → Verbindung abgelehnt */ });
export const onDisconnect = spacetimedb.clientDisconnected((ctx) => { /* Fehler werden nur geloggt */ });
```

Rust: `#[reducer(init)]`, `#[reducer(client_connected)]`, `#[reducer(client_disconnected)]`.
Lifecycle reducers must be exported; an unexported call registers nothing. `clientConnected` and
`clientDisconnected` also run around every HTTP reducer call and SQL request.

## Schedule tables

```ts
const tickTimer = table(
  { name: 'tick_timer' },                          // privat
  { scheduledId: t.u64().primaryKey().autoInc(), scheduledAt: t.scheduleAt() }
);

export const worldTick = spacetimedb.reducer({ onSchedule: tickTimer }, { arg: tickTimer.rowType }, (ctx, { arg }) => {
  // läuft alle 50 ms; arg ist die Zeitplan-Zeile
});

// im init-Reducer:
ctx.db.tickTimer.insert({ scheduledId: 0n, scheduledAt: ScheduleAt.interval(50_000n) }); // Mikrosekunden
// einmalig: ScheduleAt.time(ctx.timestamp.microsSinceUnixEpoch + 10_000_000n)
```

- Rust: `#[table(accessor = tick_timer, scheduled(world_tick))]`, reducer
  `fn world_tick(ctx: &ReducerContext, _timer: TickTimer)`,
  `ScheduleAt::Interval(Duration::from_millis(50).into())`.
- Scheduled functions are private: clients cannot call them; the owner can.
- Intervals anchor to the intended start time; missed ticks are skipped, not replayed. Rows
  that are already due run in no guaranteed order. A start later than 50 ms logs a warning and
  feeds a Prometheus metric (2.8.0 release notes).
- One-shot rows are deleted after a scheduled reducer finishes (before a scheduled procedure
  starts); interval rows stay until deleted. Deleting the row cancels the schedule.

## Event tables

```ts
const buzzEvent = table({ name: 'buzz_event', public: true, event: true }, {
  cell: t.u32().index('btree'), // erlaubt zellgefilterte Abos
  playerId: t.u32(),
  kind: t.u8(),
});
// im Reducer: ctx.db.buzzEvent.insert({ cell, playerId, kind: 1 });
```

Rows exist only inside the inserting transaction, reach subscribers on commit and are still
written to the commit log. Clients get `onInsert` only; the cache stays empty. Event tables
cannot serve as the lookup side of a subscription join and cannot be read in views [docs].

## Views

```ts
// Anonym: einmal berechnet, von allen Abonnenten geteilt.
export const rareItems = spacetimedb.anonymousView({ name: 'rare_items', public: true }, t.array(probeItem.rowType),
  (ctx) => Array.from(ctx.db.probeItem.byOwnerKind.filter(3)).filter((it) => it.kind === 2));

// Pro Aufrufer: einmal je Abonnent berechnet; Primärschlüssel liefert onUpdate im Client.
const MyBeeRow = t.row('MyBeeRow', { playerId: t.u32().primaryKey(), x: t.f32(), z: t.f32() });
export const myBee = spacetimedb.view({ name: 'my_bee', public: true }, t.array(MyBeeRow), (ctx) => { /* ctx.sender */ return []; });

// Query-Builder: inkrementell von der Query-Engine ausgewertet.
export const originBees = spacetimedb.anonymousView({ name: 'origin_bees', public: true }, t.array(beeState.rowType),
  (ctx) => ctx.from.beeState.where((b) => b.cell.eq(4194368)));
```

- Views take no arguments besides the context. Procedural views read through indexes and
  `count()` only — no `iter()` (the read set decides when a view re-runs).
- A row type must not reuse the PascalCase name generated for the view (`my_bee` → `MyBee`);
  publish fails with "name `MyBee` is used for multiple types" [verified 2.10.2].
- A view result with duplicate primary keys fails the transaction that triggered the refresh
  [docs].
- Query-builder operators: `eq` `ne` `lt` `lte` `gt` `gte`, `.and()` `.or()` `.not()`,
  `leftSemijoin` / `rightSemijoin` on indexed columns.

## Procedures

```ts
export const countBees = spacetimedb.procedure(t.u64(), (ctx) => ctx.withTx((tx) => tx.db.beeState.count()));
```

- Signature: `procedure(opts?, params?, returnType, fn)`. The return value reaches only the
  caller (`await conn.procedures.countBees({})`).
- `ctx.withTx(fn)` may run `fn` several times; `fn` must not keep mutable outside state.
- `ctx.http.fetch(url, { method, headers, body, timeout })` is synchronous; no HTTP while a
  transaction is open; default timeout 30 s, maximum 180 s [docs]. `[module-http] enabled =
  false` in the server config blocks outbound requests (skill `spacetimedb-security`).
- Scheduled procedures use `{ onSchedule: table }` and return `t.unit()`.
- Rust procedures need no `unstable` feature since 2.5.0.

## Logging and timing

`console.log/info/warn/error/debug` (Rust: `log::info!` …) write to the database log, readable
by the owner (`spacetime logs <db>`). `console.time('x')` / `console.timeEnd('x')` (Rust:
`spacetimedb::log_stopwatch::LogStopwatch::new("x")`, logs on drop) produce
`Timing span "x": 91.5µs` lines — sample, do not log every tick.

## Rust attribute cheat sheet

```rust
use spacetimedb::{reducer, table, ReducerContext, ScheduleAt, Table, Timestamp};

#[table(accessor = bee_state, public)]          // event: `public, event`; Zeitplan: `scheduled(world_tick)`
pub struct BeeState {
    #[primary_key]
    player_id: u32,
    #[index(btree)]
    cell: u32,
    x: f32,
}

#[table(accessor = account)]
pub struct Account {
    #[primary_key]
    identity: spacetimedb::Identity,
    #[unique]
    #[auto_inc]
    player_id: u32,
    created_at: Timestamp,
}
```

Table-level index (Rust): `#[table(accessor = t, index(accessor = by_owner_kind, btree(columns =
[owner, kind])))]`; direct index: `#[index(direct)]`; default: `#[default(0)]` [docs].
Build: `rustup target add wasm32-unknown-unknown`; `spacetime build` runs `cargo` and, when
installed, `wasm-opt` (binaryen) [verified 2.10.2].

## TypeScript pitfalls

| Mistake | Fix |
|---|---|
| `schema(table)` or `schema(a, b)` | `schema({ a, b })` |
| Schema not the default export | `export default spacetimedb` in the entry file |
| `t.struct`, `autoIncrement()` | `t.object`, `.autoInc()` |
| `0` for a `u64` auto-increment column | `0n` |
| Plain `Error` for bad input | `SenderError` |
| `async` reducer or procedure | Synchronous code only |
| `'hex' as Identity` | Identities come from `ctx.sender` or `t.identity()` columns |
| Helper typed with `ctx: any` | `ReducerCtx<InferSchema<typeof spacetimedb>>` |
