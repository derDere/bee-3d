# Movement: validated client authority

## Model [recommendation]

- The client simulates its own bee at once: input and flight physics run in the fixed step of
  the game loop (skill `babylon-gameplay`), without waiting for the server.
- It reports its pose; the world tick validates the report and publishes the authoritative
  `bee_state` row.
- Other players see that authoritative state 100 ms in the past, interpolated
  ([replication.md](replication.md)).
- The client follows the server only when both disagree by more than 3 m.

A server-side flight simulation would cost serial database time per player and tick and would
need input replay on the client. For a cooperative flying game, validation catches the cheats
that matter (speed, teleport, bounds). Contested actions (collecting, hitting, racing) get
their own checks in the reducer (skill `spacetimedb-security`, `references/module-hardening.md`).

## Reporting

`PoseReporter` (`net/poseReporter.ts`) decides when a pose goes out:

| Parameter | Default | Reason |
|---|---|---|
| Rate while moving | 15 Hz | Below the 20 Hz tick; the inbox keeps only the latest report |
| Heartbeat at rest | 1 s | Final resting pose and a current entry for the deviation check |
| Movement threshold | 2 cm | Below it the bee counts as resting |
| Angles | `i16`, 32767/π per radian | 2 bytes, ≈0.006° resolution |
| Positions | `f32` | Sub-millimetre at 4 km |

5 Hz instead of 15 Hz saved 45 % server CPU in the lab at the same latency [measured]; the
interpolation delay hides the coarser samples of other bees.

## Validation in the world tick

- `reportPose` rejects non-finite values, positions outside the world bounds and players
  without a bee in the world.
- The tick moves the authoritative position towards the report by at most
  `MaxSpeed × SpeedSlack × min(max(1, Δticks), MaxElapsedTicks) × TickSeconds`. A bee at rest
  writes no row, so `MaxElapsedTicks` (1 s) keeps idle time from building up a jump budget.
- Lab check [verified 2.10.2]: a 500 m teleport and a 50 m jump after 2.5 s at rest were both
  clamped; the client received the clamped row and snapped back. Spawn, reconnect and mutual
  visibility of two clients worked in the same run.
- Island collisions: coarse volumes in a private table, checked along the step (skill
  `spacetimedb-security`).

## Correction

- `NetClient` compares each authoritative own row with the poses sent during the last second
  (`PoseReporter.serverDeviation`). Above 3 m it calls `LocalBee.correctTo` in the next frame.
- Without a clamp the authoritative position equals one of the sent poses, so honest flight
  never triggers a correction.
- `correctTo` of the player entity resets velocity; small corrections may blend over
  150–250 ms, large ones snap [recommendation].
- The first own row after `join` is the spawn point. Reports start only after it was applied:
  the server rejects reports of a bee that is not in the world yet.

## Spawn and reconnect

- The reference `join` places a new bee at a random point; `clientDisconnected` deletes the
  `bee_state` row when the player's last connection closes. After a reconnect the bee spawns
  again. Persistent positions need a private cold table that `clientDisconnected` fills and
  `join` reads [recommendation].
- A socket that died silently stays open on the server until its idle timeout (30 s). A new
  connection within that time finds the bee still in the world and continues at its position.

## Visibility range

Radius 1 with 64 m cells and 4 m hysteresis guarantees about 60 m of view in every direction
(up to 128 m on the far side). Remote bees fade out before 60 m, or cells and radius grow
together with the measured cost (skill `spacetimedb-performance`, `references/interest.md`).

## Knobs

| Knob | Where | Trade-off |
|---|---|---|
| `TickHz` | `shared/world.ts` | Latency and smoothness against serial database time and bandwidth |
| Report rate, heartbeat | `PoseReporter` constructor | Server CPU against sample density |
| Interpolation delay | `RemoteBeeViews` constructor (`delayTicks`) | Smoothness against how far in the past others appear |
| `CorrectionMeters` | `NetClient` | Tolerance against visible snapping |
| `MaxSpeed`, `SpeedSlack`, `MaxElapsedTicks` | `shared/world.ts` | Cheat tolerance against false clamps on lag spikes |
| `CellSize`, radius | `shared/world.ts`, `CellSubscriptions` | View range against fan-out cost |
