// server/src/schema.ts — Tabellen und Schema der Weltdatenbank bee-world.
// Öffentlich ist nur, was jeder sehen darf (Posen, Fliegen, Blumenfelder, Namen, Ranglisten);
// Fortschritt, Ladung und Module eines Spielers erreichen ihn über Views (views.ts).
import { schema, table, t, type InferSchema, type ReducerCtx } from "spacetimedb/server";

// ---------- Verwaltung ----------

export const config = table({ name: "config" }, {
  id: t.u8().primaryKey(),
  owner: t.identity(),
  epochMicros: t.u64(), // Weltbeginn: Bezugspunkt aller Taktnummern und Weltsekunden
  worldSeed: t.u32(),
});

export const account = table({ name: "account" }, {
  identity: t.identity().primaryKey(),
  playerId: t.u32().unique().autoInc(),
  createdAt: t.timestamp(),
});

export const session = table({ name: "session" }, {
  connectionId: t.connectionId().primaryKey(),
  identity: t.identity().index("btree"),
});

export const tickTimer = table({ name: "tick_timer" }, {
  scheduledId: t.u64().primaryKey().autoInc(),
  scheduledAt: t.scheduleAt(),
});

// ---------- Spieler (öffentlich) ----------

export const playerProfile = table({ name: "player_profile", public: true }, {
  playerId: t.u32().primaryKey(),
  identity: t.identity().index("btree"), // erlaubt dem Client, die eigene playerId zu finden; Demo-Imker tragen die Betreiber-Identität
  name: t.string(),
  homeHive: t.u8(),
  isDemo: t.bool(),
});

export const playerScore = table({ name: "player_score", public: true }, {
  playerId: t.u32().primaryKey(),
  honeyTotal: t.u32(),
  kills: t.u32(),
  pollenTotal: t.u32(),
});

/** Heiße Zeile je Biene in der Welt; Flags siehe shared/protocolFlags.ts. */
export const beeState = table({ name: "bee_state", public: true }, {
  playerId: t.u32().primaryKey(),
  cell: t.u32().index("btree"),
  x: t.f32(),
  y: t.f32(),
  z: t.f32(),
  yaw: t.i16(),
  pitch: t.i16(),
  aimYaw: t.i16(),
  aimPitch: t.i16(),
  tick: t.u32(),
  hp: t.u16(),
  maxHp: t.u16(),
  flags: t.u8(),
});

// ---------- Spieler (privat) ----------

export const poseInbox = table({ name: "pose_inbox" }, {
  playerId: t.u32().primaryKey(),
  /** Eingang der Meldung; dichter folgende Meldungen schreiben nichts. */
  receivedAtMs: t.u64().default(0n),
  x: t.f32(),
  y: t.f32(),
  z: t.f32(),
  yaw: t.i16(),
  pitch: t.i16(),
  aimYaw: t.i16(),
  aimPitch: t.i16(),
  clientFlags: t.u8(),
});

/** Bewegung der Biene aus den letzten autoritativen Posen (für Tracking und Ausweichen) und ihr Bewegungsbudget. */
export const beeMotion = table({ name: "bee_motion" }, {
  playerId: t.u32().primaryKey(),
  vx: t.f32(),
  vy: t.f32(),
  vz: t.f32(),
  /** Noch erlaubte Strecke in Metern (Token-Bucket, siehe MoveBudgetSeconds). */
  budget: t.f32().default(0),
  /** Höchsttempo der letzten Augenblicke (m/s): Boost und Warp laufen damit aus, ohne gekappt zu werden. */
  heldSpeed: t.f32().default(0),
  heldUntilMs: t.u64().default(0n),
});

/** Spalten des Spielerstands; die View my_stats liefert dieselbe Zeilenform mit Primärschlüssel. */
export const playerStatsColumns = {
  playerId: t.u32().primaryKey(),
  honey: t.u32(),
  cargo: t.u16(),
  cargoGold: t.u16(),
  energy: t.f32(),
  energyAt: t.f64(), // Weltsekunden des gespeicherten Energiestands
  hp: t.u16(),
  lensLevel: t.u8(),
  gatlingLevel: t.u8(),
  quiverLevel: t.u8(),
  brushLevel: t.u8(),
  cargoLevel: t.u8(),
  wingsLevel: t.u8(),
  armorLevel: t.u8(),
  antennaLevel: t.u8(),
  nectarLevel: t.u8(),
  dockedHive: t.u8(), // NoHive = im Flug
  hivesVisited: t.u16(), // Bitmaske der besuchten Stöcke
  achievements: t.u32(), // Bitmaske, siehe shared/achievements.ts
  deaths: t.u32(),
  savedX: t.f32(),
  savedY: t.f32(),
  savedZ: t.f32(),
  savedFlags: t.u8(),
};

export const playerStats = table({ name: "player_stats" }, playerStatsColumns);

export const questProgress = table(
  {
    name: "quest_progress",
    indexes: [{ accessor: "byPlayerQuest", algorithm: "btree", columns: ["playerId", "questId"] }],
  },
  {
    id: t.u64().primaryKey().autoInc(),
    playerId: t.u32().index("btree"),
    questId: t.u16(),
    progress: t.u32(),
    completions: t.u16(),
  },
);

export const moduleActivation = table(
  {
    name: "module_activation",
    indexes: [{ accessor: "byPlayerSlot", algorithm: "btree", columns: ["playerId", "slot"] }],
  },
  {
    id: t.u64().primaryKey().autoInc(),
    playerId: t.u32().index("btree"),
    slot: t.u8(),
    targetKind: t.u8(),
    targetId: t.u32(),
    nextCycleAtMs: t.u64(),
    stopAfterCycle: t.bool(),
  },
);

/** Laufender Warp: Zeitfenster und Strecke; Posen im Warp bleiben nahe der Strecke (Warp). */
export const warpState = table({ name: "warp_state" }, {
  playerId: t.u32().primaryKey(),
  untilMs: t.u64(),
  fromX: t.f32().default(0),
  fromY: t.f32().default(0),
  fromZ: t.f32().default(0),
  toX: t.f32().default(0),
  toY: t.f32().default(0),
  toZ: t.f32().default(0),
});

export const cooldown = table({ name: "cooldown" }, {
  playerId: t.u32().primaryKey(),
  nextBuzzAtMs: t.u64(),
  nextWarpAtMs: t.u64(),
  nextNameAtMs: t.u64(),
  nextDockAtMs: t.u64().default(0n),
  /** Zuletzt gezählter Stockbesuch: Stock und Zeitpunkt (ein Besuch je Stock und 10 Minuten). */
  lastVisitHive: t.u8().default(255),
  lastVisitAtMs: t.u64().default(0n),
});

// ---------- Welt (öffentlich) ----------

export const flyState = table({ name: "fly_state", public: true }, {
  flyId: t.u32().primaryKey().autoInc(),
  cell: t.u32().index("btree"),
  x: t.f32(),
  y: t.f32(),
  z: t.f32(),
  /** Geschwindigkeit in cm/s; die Fliegen-KI lenkt damit, Clients können damit vorausrechnen. */
  vx: t.i16().default(0),
  vy: t.i16().default(0),
  vz: t.i16().default(0),
  yaw: t.i16(),
  pitch: t.i16(),
  kind: t.u8(),
  hp: t.u16(),
  state: t.u8(),
  target: t.u32(),
  tick: t.u32(),
});

export const flowerPatch = table({ name: "flower_patch", public: true }, {
  patchId: t.u32().primaryKey(),
  cell: t.u32().index("btree"),
  pollen: t.u16(),
  storedAt: t.f64(), // Weltsekunden des gespeicherten Stands; Nachwachsen rechnet der Leser
});

export const hiveState = table({ name: "hive_state", public: true }, {
  hiveId: t.u8().primaryKey(),
  honeyDelivered: t.u32(),
  visits: t.u32(),
});

/** Vom Betreiber erzwungene Wetterlage; ohne Zeile gilt der Wetterplan. */
export const worldWeather = table({ name: "world_weather", public: true }, {
  id: t.u8().primaryKey(),
  weather: t.string(),
  sinceWorldSeconds: t.f64(),
});

/** Kurzlebige Ereignisse für Effekte und Protokoll, je Zelle abonniert; Arten siehe shared/events.ts. */
export const combatEvent = table({ name: "combat_event", public: true, event: true }, {
  cell: t.u32().index("btree"),
  kind: t.u8(),
  sourceKind: t.u8(),
  sourceId: t.u32(),
  targetKind: t.u8(),
  targetId: t.u32(),
  value: t.u16(),
  aux: t.u16(),
});

// ---------- Welt (privat) ----------

/** Gedächtnis einer Fliege; wird nur geschrieben, wenn sich Ziel, Zeitgeber oder Aktivität ändern. */
export const flyBrain = table({ name: "fly_brain" }, {
  flyId: t.u32().primaryKey(),
  nestId: t.u8().index("btree"),
  active: t.bool(),
  goalX: t.f32(),
  goalY: t.f32(),
  goalZ: t.f32(),
  orbitSign: t.i8(),
  nextThinkAtMs: t.u64(),
  nextSpitAtMs: t.u64(),
  nextSummonAtMs: t.u64(),
  lastHitBy: t.u32(),
});

export const nestState = table({ name: "nest_state" }, {
  nestId: t.u8().primaryKey(),
  nextSpawnAtMs: t.u64(),
  queenRespawnAtMs: t.u64(),
  active: t.bool(),
});

/** Einschläge unterwegs (Stachelraketen, Spucke); der Weltakt wendet sie zum Zeitpunkt an. */
export const pendingImpact = table({ name: "pending_impact" }, {
  id: t.u64().primaryKey().autoInc(),
  impactAtMs: t.u64().index("btree"),
  kind: t.u8(),
  sourceId: t.u32(),
  targetKind: t.u8(),
  targetId: t.u32(),
  count: t.u8(),
  damage: t.f32(),
});

const spacetimedb = schema({
  config,
  account,
  session,
  tickTimer,
  playerProfile,
  playerScore,
  beeState,
  poseInbox,
  beeMotion,
  playerStats,
  questProgress,
  moduleActivation,
  warpState,
  cooldown,
  flyState,
  flowerPatch,
  hiveState,
  worldWeather,
  combatEvent,
  flyBrain,
  nestState,
  pendingImpact,
});

export default spacetimedb;

/** Kontexttyp der Hilfsfunktionen (Reducer-Kontext). */
export type Ctx = ReducerCtx<InferSchema<typeof spacetimedb>>;
