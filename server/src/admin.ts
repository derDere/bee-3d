// server/src/admin.ts — Betreiber-Reducer: Weltzustand anlegen, Demodaten schreiben, Wetter erzwingen; init.
import { SenderError, ScheduleAt, t } from "spacetimedb/server";
import { WeatherNames, type WeatherName } from "../../shared/weather";
import { TickSeconds, WorldSeed } from "../../shared/world";
import { requireOwner } from "./access";
import { worldSeconds } from "./clock";
import { refillNest } from "./flies";
import spacetimedb, { type Ctx } from "./schema";
import { world } from "./world";

/** Demo-Imker liegen ganz oben im u32-Bereich, fern der fortlaufenden Spieler-IDs. */
const DemoPlayerIdBase = 4_000_000_000;

/** Legt fehlende Zustandszeilen der statischen Welt an; vorhandene bleiben unverändert (Weltsynchronisation). */
function syncWorldState(ctx: Ctx): void {
  const layout = world();
  const now = worldSeconds(ctx);
  for (const hive of layout.hives) {
    if (!ctx.db.hiveState.hiveId.find(hive.id)) {
      ctx.db.hiveState.insert({ hiveId: hive.id, honeyDelivered: 0, visits: 0 });
    }
  }
  for (const patch of layout.patches) {
    if (!ctx.db.flowerPatch.patchId.find(patch.id)) {
      ctx.db.flowerPatch.insert({ patchId: patch.id, cell: patch.cell, pollen: patch.capacity, storedAt: now });
    }
  }
  // Felder, die der aktuelle Weltaufbau nicht mehr kennt (geänderter Inselkatalog), entfallen.
  for (const row of Array.from(ctx.db.flowerPatch.iter())) {
    if (row.patchId >= layout.patches.length) {
      ctx.db.flowerPatch.patchId.delete(row.patchId);
    }
  }
  for (const nest of layout.nests) {
    if (!ctx.db.nestState.nestId.find(nest.id)) {
      ctx.db.nestState.insert({ nestId: nest.id, nextSpawnAtMs: 0n, queenRespawnAtMs: 0n, active: true });
    }
    refillNest(ctx, nest, true);
  }
}

export const init = spacetimedb.init((ctx) => {
  ctx.db.config.insert({ id: 0, owner: ctx.sender, epochMicros: ctx.timestamp.microsSinceUnixEpoch, worldSeed: WorldSeed });
  ctx.db.tickTimer.insert({ scheduledId: 0n, scheduledAt: ScheduleAt.interval(BigInt(Math.round(TickSeconds * 1_000_000))) });
  syncWorldState(ctx);
});

/** Idempotent: legt fehlende Stöcke, Nester, Fliegen und Blumenfelder an (make init). */
export const syncWorld = spacetimedb.reducer((ctx) => {
  requireOwner(ctx);
  syncWorldState(ctx);
});

/** Form der Demodaten aus dev/seed/world.yaml (Demodaten). */
interface DemoSeed {
  readonly keepers?: ReadonlyArray<{ readonly name: string; readonly honey: number; readonly kills: number; readonly pollen: number; readonly home: number }>;
  readonly hives?: ReadonlyArray<{ readonly hive: number; readonly honey: number; readonly visits: number }>;
  readonly weather?: string;
}

function clampInt(value: unknown, max: number): number {
  const number = typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : 0;
  return Math.max(0, Math.min(max, number));
}

/** Schreibt Demodaten: Demo-Imker für die Rangliste, Stockbilanzen, Start-Wetter (make seed). */
export const seedDemo = spacetimedb.reducer({ json: t.string() }, (ctx, { json }) => {
  requireOwner(ctx);
  if (json.length > 64_000) {
    throw new SenderError("seed too large");
  }
  for (const profile of ctx.db.playerProfile.iter()) {
    if (profile.isDemo) {
      throw new SenderError("demo data present — make clear first");
    }
  }
  const seed = JSON.parse(json) as DemoSeed;
  (seed.keepers ?? []).slice(0, 50).forEach((keeper, index) => {
    const playerId = DemoPlayerIdBase + index;
    const name = String(keeper.name).slice(0, 24);
    ctx.db.playerProfile.insert({ playerId, identity: ctx.sender, name, homeHive: clampInt(keeper.home, world().hives.length - 1), isDemo: true });
    ctx.db.playerScore.insert({
      playerId,
      honeyTotal: clampInt(keeper.honey, 1_000_000),
      kills: clampInt(keeper.kills, 100_000),
      pollenTotal: clampInt(keeper.pollen, 10_000_000),
    });
  });
  for (const entry of seed.hives ?? []) {
    const state = ctx.db.hiveState.hiveId.find(clampInt(entry.hive, 255));
    if (state) {
      ctx.db.hiveState.hiveId.update({ ...state, honeyDelivered: state.honeyDelivered + clampInt(entry.honey, 1_000_000), visits: state.visits + clampInt(entry.visits, 100_000) });
    }
  }
  if (seed.weather !== undefined) {
    setWeatherRow(ctx, seed.weather);
  }
});

function setWeatherRow(ctx: Ctx, weather: string): void {
  if (weather === "auto") {
    ctx.db.worldWeather.id.delete(0);
    return;
  }
  if (!WeatherNames.includes(weather as WeatherName)) {
    throw new SenderError("unknown weather");
  }
  const row = { id: 0, weather, sinceWorldSeconds: worldSeconds(ctx) };
  if (ctx.db.worldWeather.id.find(0)) {
    ctx.db.worldWeather.id.update(row);
  } else {
    ctx.db.worldWeather.insert(row);
  }
}

/** Erzwingt eine Wetterlage für alle; "auto" kehrt zum Wetterplan zurück (Betreiber). */
export const setWeather = spacetimedb.reducer({ weather: t.string() }, (ctx, { weather }) => {
  requireOwner(ctx);
  setWeatherRow(ctx, weather);
});
