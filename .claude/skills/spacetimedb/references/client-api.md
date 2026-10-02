# TypeScript client SDK (npm `spacetimedb` 2.10.2)

Facts verified with generated bindings, `tsc` in strict mode (`verbatimModuleSyntax`,
`erasableSyntaxOnly`, `noUncheckedIndexedAccess`) and bots against a 2.10.2 lab server unless
tagged otherwise. Wiring into Babylon.js: skill `spacetimedb-babylon`.

## Package and bindings

- `npm install spacetimedb@<server version>`; framework peers (React, Vue, …) are optional.
  The deprecated package `@clockworklabs/spacetimedb-sdk` belongs to 1.x.
- `spacetime generate --lang typescript --out-dir src/net/bindings --module-path server`
  writes `index.ts` (`DbConnection`, `tables`, `reducers`, context types), one file per public
  table and reducer, and `types.ts`.
- Generated handles are camelCase (`conn.db.beeState`, `conn.reducers.reportPose`); row fields
  are camelCase (`player_id` → `playerId`); `u64`/`i64` fields are `bigint`.
- Private tables and scheduled reducers get no handles; `types.ts` still contains the row
  types of private tables. `--include-private` adds handles (owner tooling only).
- The bindings record the CLI version; `build()` only rejects bindings from a CLI older than
  1.4.0 [source]. Every other version mismatch goes unnoticed until serialization fails — keep
  CLI and SDK in lockstep.

## Connection

```ts
import { DbConnection, type ErrorContext } from './bindings';

const conn = DbConnection.builder()
  .withUri('wss://bee.example.com/stdb/')     // Pfad-Präfix braucht den abschließenden Schrägstrich
  .withDatabaseName('bee-world')
  .withToken(tokenStore.load())               // undefined → anonyme, vom Server ausgestellte Identität
  .withConfirmedReads(false)                  // Bewegung: Latenz vor Dauerhaftigkeit
  .withCompression('none')                    // kleine, häufige Updates: weniger Server-CPU
  .onConnect((connection, identity, token) => tokenStore.save(token))
  .onConnectError((_ctx: ErrorContext, error: Error) => { /* abgelehnt oder nicht erreichbar */ })
  .onDisconnect((_ctx: ErrorContext, error?: Error) => { /* neu verbinden: eigene Logik */ })
  .build();
```

| Builder method | Effect |
|---|---|
| `withUri(uri)` | `ws`/`wss` or `http`/`https`; relative resolution keeps a path prefix only with a trailing `/` |
| `withDatabaseName(nameOrIdentity)` | Target database |
| `withToken(token?)` | Long-lived token; the SDK swaps it for a short-lived token via `POST /v1/identity/websocket-token` and puts that one into the WebSocket URL [source] |
| `withConfirmedReads(bool)` | `true`: updates only after the commit is durable (fsync). Default when unset: server decides — on for protocol v2/v3 [source] |
| `withCompression('gzip' \| 'brotli' \| 'none')` | Server-side compression of larger messages; SDK default `gzip`; `brotli` only where `DecompressionStream('brotli')` exists |
| `withWSFn(factory)` | Custom WebSocket factory (tests, byte counting) |
| `withLightMode(bool)` | Leftover from 1.x; documented as removed in 2.0 — leave unset |

- `onConnect` receives the token used to connect, or the newly issued one for an anonymous
  connection — saving it on every connect is safe [source].
- `onConnectError` and `onDisconnect` are exclusive: a connection that never opened reports
  only `onConnectError`.
- A `DbConnection` does not reconnect by itself; the framework providers (React, Solid, Svelte)
  do. Vanilla clients need their own session class with backoff (skill `spacetimedb-babylon`,
  `references/session.md`).
- `conn.isActive`, `conn.identity`, `conn.connectionId`; `conn.disconnect()` throws when
  already closed.

## Subscriptions

```ts
import { tables } from './bindings';

const handle = conn
  .subscriptionBuilder()
  .onApplied((ctx) => { /* Startzustand liegt im Cache */ })
  .onError((ctx) => console.error(ctx.event))                  // ein Parameter; Fehler in ctx.event
  .subscribe([
    tables.beeState.where((row) => row.cell.eq(cell)),         // typisierte Abfrage
    'SELECT * FROM player_profile',                             // SQL-Text ist ebenfalls erlaubt
  ]);

handle.unsubscribeThen(() => { /* Zeilen sind aus dem Cache entfernt */ });
```

- `subscribe()` accepts a query, an array, SQL strings, or a function `(tables) => queries`.
- Operators: `eq` `ne` `lt` `lte` `gt` `gte`, `.and()` `.or()` `.not()` (also as functions
  `and(…)`), `leftSemijoin` / `rightSemijoin` with indexed join columns.
- Handle: `isActive()`, `isEnded()`, `unsubscribe()`, `unsubscribeThen(cb)` — unsubscribing
  twice throws.
- `subscribeToAllTables()` cannot be cancelled and must not be mixed with `subscribe()` on the
  same connection; demos only.
- Guarantees: one atomic `SubscribeApplied` snapshot; one update message per transaction;
  responses in request order; callbacks run after the cache holds the whole transaction; no
  ordering between callbacks of one transaction.

## Client cache and row callbacks

| Call | Notes |
|---|---|
| `conn.db.beeState.iter()`, `.count()` | All cached rows matched by any subscription |
| `conn.db.beeState.playerId.find(v)` | Unique/primary key — **scans the whole cached table** with deep equality [source] |
| `conn.db.beeState.cell.filter(v)` | btree index — also a full scan |
| `onInsert((ctx, row) => …)`, `onDelete(…)` | Every table and view |
| `onUpdate((ctx, oldRow, newRow) => …)` | Only with a primary key (tables and views) |
| `removeOnInsert(cb)`, … | Unregister with the same function reference |

- Hot paths (render loop, per-entity logic) keep their own `Map` keyed by primary key, filled
  from the callbacks; they never call `find()` per frame.
- Rows belong to the cache; the client treats them as immutable and copies before changing.
- `ctx.event.tag`: `'Reducer'` (only for reducer calls of this client), `'Transaction'` (other
  clients), `'SubscribeApplied'`, `'UnsubscribeApplied'`, `'Error'`.
- An update can appear as insert or delete when the old or new row leaves the subscribed set,
  and a delete plus insert inside one transaction can appear as an update.

## Reducers and procedures

```ts
conn.reducers.reportPose({ x, y, z }).catch((error: unknown) => { /* SenderError oder InternalError */ });
conn.reducers.spawn({});                              // Reducer ohne Argumente: leeres Objekt
const total = await conn.procedures.countBees({});    // Prozeduren liefern einen Wert
```

- Each call returns a `Promise<void>` that rejects with `SenderError` (the module threw it) or
  `InternalError`. Fire-and-forget calls still attach `.catch` to avoid unhandled rejections.
- Outgoing calls are batched per microtask into one WebSocket frame [source].
- Global reducer callbacks do not exist in 2.x; other clients learn about events through event
  tables.

## Identity values

`Identity.toHexString()`, `identity.isEqual(other)`; `ConnectionId` likewise. `isEqual`
compares freshly built hex strings [source] — hot paths compare compact numeric ids instead.
`Timestamp`: `microsSinceUnixEpoch` (`bigint`); milliseconds:
`Number(row.at.microsSinceUnixEpoch / 1000n)`.
