# Replication into the Babylon scene

Templates: `net/cellSubscriptions.ts`, `net/remoteBees.ts`, `net/serverClock.ts`,
`entities/remoteBeeViews.ts`. Server side of the same design: skill `spacetimedb-performance`
(`references/interest.md`, `references/data-and-ticks.md`).

## Subscriptions of one connection

| Group | Query | Lifetime |
|---|---|---|
| Own profile | `tables.playerProfile.where(r => r.identity.eq(identity))` | connection |
| Own bee | `tables.beeState.where(r => r.playerId.eq(playerId))` | connection |
| Neighbourhood | per cell of the 3×3 block: `beeState` and `buzzEvent` with `r.cell.eq(c)` | moves with the player |
| Global data (names, island state) | small public tables, unfiltered or by a fixed key | connection |

- Equality filters on one column are pruned by value on the server; each cell gets its own
  query instead of an `OR` [source].
- `CellSubscriptions` subscribes the new block before it drops the old one and moves only after
  the player is 4 m past the cell border (hysteresis).
- Names for name tags: one subscription to `player_profile` while the player count stays in
  the low thousands; a `Map<playerId, name>` from its callbacks [recommendation].

## Row callbacks into own registries

The SDK's `find()`/`filter()` scan the whole cached table [source]. The client keeps its own
`Map`s, filled from `onInsert`/`onUpdate`/`onDelete`:

- `RemoteBees` keys bees by `playerId`. A bee crossing into another cell arrives as delete +
  insert; the delete only marks the bee, and an insert within 250 ms revives it — no flicker.
- Callbacks run when the SDK processes a message, outside the game loop. They only store
  data; the frame systems apply it.
- Updates per bee carry the server tick. `RemoteBees` keeps the last 8 samples, drops older
  ticks and lets a second row with the same tick replace the previous sample (late tick,
  overlapping subscriptions).

## Server clock

The module derives the tick number from `ctx.timestamp`, so tick × 50 ms is server time since
the world epoch. `ServerClock.observe(tick, arrivalMs)` estimates the offset between local and
server time:

- The fastest arrival of a tick is the closest to real server time; the estimate jumps down to
  any faster arrival and moves 2 % of the gap towards each slower one, so network jitter does
  not shake the scene.
- `tickAt(nowMs)` returns a continuous tick for any local time; the estimate holds between
  updates.
- Own row updates feed the clock too, so a lone player still synchronises.

## Interpolation

`RemoteBeeViews.frameUpdate` renders every remote bee at `tickAt(now) − 2` (100 ms in the past
at 20 Hz):

- Two samples bracket the render tick almost always; the view interpolates linearly, yaw along
  the shortest arc.
- Without a newer sample the bee extrapolates at most 2 ticks, then holds.
- Lab latency from report to the own echoed row: ≈33–44 ms p50, ≈63–66 ms p95 with the
  20 Hz tick [measured]; 100 ms of delay covers the p95 plus one tick.
- `BeeViewFactory.create/release` hands out pooled model instances (skill
  `babylon-performance` for instancing); views never create geometry.

## Effects

`buzz_event` rows exist only for their transaction. The cell subscription delivers them as
`onInsert`; `NetHooks.onBuzz(playerId)` triggers the effect at `remoteBees.poseOf(playerId)`
or at the local bee. Event tables never fire `onDelete` or `onUpdate` and leave the cache
empty [docs].

## Shared world time and weather [recommendation]

Every client shows the same sky without per-tick writes:

- **Time of day** from the server tick: `hours = (tick × TickSeconds / DayLengthSeconds × 24 +
  StartHours) mod 24`, with `DayLengthSeconds` and `StartHours` in `shared/`. Skill
  `babylon-sky` takes the hours.
- **Weather** in one public row (`world_weather`: preset, previous preset, transition start
  tick, transition length, seed), written by a scheduled reducer only when the weather changes.
  Clients compute the blend from the server tick and seed their local random generator
  (lightning, rain gusts) with `seed`, so effects match without traffic.
- The debug API's `setTimeOfDay`/`setWeather` stay local overrides for review agents.
