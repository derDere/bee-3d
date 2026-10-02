// server/src/index.ts — Referenzmodul bee-world: Zugang, Versionsabgleich, Konten, Sitzungen, Bewegung im Weltakt, Ereignisse.
// Muster und Begründungen: Skills spacetimedb-performance (Weltakt), spacetimedb-security (Zugang, Prüfungen).
import { schema, table, t, SenderError, ScheduleAt, type InferSchema, type ReducerCtx } from 'spacetimedb/server';
import { ProtocolVersion } from '../../shared/protocol';
import { MaxElapsedTicks, MaxSpeed, SpeedSlack, TickSeconds, WorldHalfExtent, packCell } from '../../shared/world';

// ---------- Zugangsregeln ----------

/** Vertrauenswürdige OIDC-Aussteller mit erwarteter Audience; leer = nur Gäste und Betreiber (Zugangsregeln). */
const TrustedIssuers: ReadonlyArray<{ readonly issuer: string; readonly audience: string }> = [
  // { issuer: 'https://auth.example.com/realms/bee', audience: 'bee-web' },
];
/** Vom Server ausgestellte anonyme Identitäten (iss "localhost") zulassen. */
const AllowGuests = true;
const NameMaxLength = 24;
const BuzzCooldownMs = 2_000n;

// ---------- Tabellen ----------

const config = table({ name: 'config' }, {
  id: t.u8().primaryKey(),
  owner: t.identity(),
  epochMicros: t.u64(), // Weltbeginn: Bezugspunkt aller Taktnummern
});

const account = table({ name: 'account' }, {
  identity: t.identity().primaryKey(),
  playerId: t.u32().unique().autoInc(),
  createdAt: t.timestamp(),
});

const playerProfile = table({ name: 'player_profile', public: true }, {
  playerId: t.u32().primaryKey(),
  identity: t.identity().unique(), // öffentlich unbedenklich; erlaubt dem Client, die eigene playerId zu finden
  name: t.string(),
});

const session = table({ name: 'session' }, {
  connectionId: t.connectionId().primaryKey(),
  identity: t.identity().index('btree'),
});

const beeState = table({ name: 'bee_state', public: true }, {
  playerId: t.u32().primaryKey(),
  cell: t.u32().index('btree'),
  x: t.f32(),
  y: t.f32(),
  z: t.f32(),
  yaw: t.i16(),
  pitch: t.i16(),
  tick: t.u32(),
});

const poseInbox = table({ name: 'pose_inbox' }, {
  playerId: t.u32().primaryKey(),
  x: t.f32(),
  y: t.f32(),
  z: t.f32(),
  yaw: t.i16(),
  pitch: t.i16(),
});

const cooldown = table({ name: 'cooldown' }, {
  playerId: t.u32().primaryKey(),
  nextBuzzAtMs: t.u64(),
});

const tickTimer = table({ name: 'tick_timer' }, {
  scheduledId: t.u64().primaryKey().autoInc(),
  scheduledAt: t.scheduleAt(),
});

const buzzEvent = table({ name: 'buzz_event', public: true, event: true }, {
  cell: t.u32().index('btree'),
  playerId: t.u32(),
  kind: t.u8(),
});

const spacetimedb = schema({
  config,
  account,
  playerProfile,
  session,
  beeState,
  poseInbox,
  cooldown,
  tickTimer,
  buzzEvent,
});
export default spacetimedb;

type Ctx = ReducerCtx<InferSchema<typeof spacetimedb>>;

// ---------- Hilfsfunktionen (nicht exportiert) ----------

/** Lehnt Verbindungen ab, deren Token nicht von uns oder einem vertrauenswürdigen Aussteller stammt (Zugangsprüfung). */
function assertTrustedCaller(ctx: Ctx): void {
  const owner = ctx.db.config.id.find(0)?.owner;
  if (owner !== undefined && owner.isEqual(ctx.sender)) {
    return; // Betreiber-Werkzeuge (CLI, MCP) mit der Identität, die das Modul veröffentlicht hat
  }
  const jwt = ctx.senderAuth.jwt;
  if (jwt === null) {
    throw new SenderError('token required');
  }
  if (jwt.issuer === 'localhost') {
    if (!AllowGuests) {
      throw new SenderError('guest access disabled');
    }
    return;
  }
  const trusted = TrustedIssuers.some((entry) => entry.issuer === jwt.issuer && jwt.audience.includes(entry.audience));
  if (!trusted) {
    throw new SenderError('untrusted token');
  }
}

/** Liefert die kompakte Spieler-ID des Aufrufers (Spieler-ID). */
function requirePlayerId(ctx: Ctx): number {
  const acc = ctx.db.account.identity.find(ctx.sender);
  if (!acc) {
    throw new SenderError('join first');
  }
  return acc.playerId;
}

const TickMicros = TickSeconds * 1_000_000;

/**
 * Taktnummer seit Weltbeginn, aus der Zeit abgeleitet statt je Takt gespeichert (Taktnummer):
 * ein Takt ohne Änderungen schreibt so nichts ins Commit-Log. Gerundet, weil der Zeitplan an
 * festen Zeitpunkten verankert ist und nur verspätet ausführt.
 */
function currentTick(ctx: Ctx): number {
  const epoch = ctx.db.config.id.find(0)?.epochMicros ?? ctx.timestamp.microsSinceUnixEpoch;
  return Math.round(Number(ctx.timestamp.microsSinceUnixEpoch - epoch) / TickMicros);
}

/** Prüft und normalisiert einen Anzeigenamen (Namensprüfung). */
function validateName(raw: string): string {
  const name = raw.trim();
  const length = [...name].length;
  if (length === 0 || length > NameMaxLength) {
    throw new SenderError('invalid name length');
  }
  if (!/^[\p{L}\p{N} _-]+$/u.test(name)) {
    throw new SenderError('invalid name characters');
  }
  return name;
}

function isFinitePose(x: number, y: number, z: number): boolean {
  return Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z);
}

// ---------- Lebenszyklus ----------

export const init = spacetimedb.init((ctx) => {
  ctx.db.config.insert({ id: 0, owner: ctx.sender, epochMicros: ctx.timestamp.microsSinceUnixEpoch });
  ctx.db.tickTimer.insert({ scheduledId: 0n, scheduledAt: ScheduleAt.interval(BigInt(Math.round(TickSeconds * 1_000_000))) });
});

export const onConnect = spacetimedb.clientConnected((ctx) => {
  assertTrustedCaller(ctx); // Fehler → Verbindung abgelehnt
  const connectionId = ctx.connectionId;
  if (connectionId === null) {
    throw new SenderError('missing connection');
  }
  ctx.db.session.insert({ connectionId, identity: ctx.sender }); // keine Konten hier: läuft auch für jede HTTP-Anfrage
});

export const onDisconnect = spacetimedb.clientDisconnected((ctx) => {
  const connectionId = ctx.connectionId;
  if (connectionId === null || !ctx.db.session.connectionId.delete(connectionId)) {
    return;
  }
  for (const _other of ctx.db.session.identity.filter(ctx.sender)) {
    return; // eine weitere Verbindung desselben Spielers ist noch offen
  }
  const acc = ctx.db.account.identity.find(ctx.sender);
  if (acc) {
    ctx.db.beeState.playerId.delete(acc.playerId);
    ctx.db.poseInbox.playerId.delete(acc.playerId);
  }
});

// ---------- Versionsabgleich ----------

/** Liefert die Protokollversion des Moduls; Name, Parameter und Rückgabetyp bleiben für immer gleich (Versionsabgleich). */
export const protocolVersion = spacetimedb.procedure(t.u32(), () => ProtocolVersion);

// ---------- Client-Reducer ----------

/** Legt bei Bedarf Konto und Profil an und setzt die Biene in die Welt (Beitreten). */
export const join = spacetimedb.reducer({ name: t.string() }, (ctx, { name }) => {
  const clean = validateName(name);
  const acc = ctx.db.account.identity.find(ctx.sender) ?? ctx.db.account.insert({ identity: ctx.sender, playerId: 0, createdAt: ctx.timestamp });
  const profile = ctx.db.playerProfile.playerId.find(acc.playerId);
  if (profile) {
    ctx.db.playerProfile.playerId.update({ ...profile, name: clean });
  } else {
    ctx.db.playerProfile.insert({ playerId: acc.playerId, identity: ctx.sender, name: clean });
  }
  if (!ctx.db.beeState.playerId.find(acc.playerId)) {
    const x = (ctx.random() - 0.5) * 200;
    const z = (ctx.random() - 0.5) * 200;
    ctx.db.beeState.insert({ playerId: acc.playerId, cell: packCell(x, z), x, y: 50, z, yaw: 0, pitch: 0, tick: currentTick(ctx) });
  }
});

/** Nimmt die zuletzt gemeldete Pose an; der Weltakt übernimmt sie (Posen-Eingang). */
export const reportPose = spacetimedb.reducer(
  { x: t.f32(), y: t.f32(), z: t.f32(), yaw: t.i16(), pitch: t.i16() },
  (ctx, pose) => {
    if (!isFinitePose(pose.x, pose.y, pose.z)) {
      throw new SenderError('pose not finite');
    }
    if (Math.abs(pose.x) >= WorldHalfExtent || Math.abs(pose.z) >= WorldHalfExtent || pose.y < -512 || pose.y > 2048) {
      throw new SenderError('pose out of bounds');
    }
    const playerId = requirePlayerId(ctx);
    if (!ctx.db.beeState.playerId.find(playerId)) {
      throw new SenderError('not in world');
    }
    const row = { playerId, ...pose };
    if (ctx.db.poseInbox.playerId.find(playerId)) {
      ctx.db.poseInbox.playerId.update(row);
    } else {
      ctx.db.poseInbox.insert(row);
    }
  }
);

/** Summt: ein Ereignis für alle in der Nachbarschaft, mit Abklingzeit (Summen). */
export const buzz = spacetimedb.reducer((ctx) => {
  const playerId = requirePlayerId(ctx);
  const state = ctx.db.beeState.playerId.find(playerId);
  if (!state) {
    throw new SenderError('not in world');
  }
  const nowMs = ctx.timestamp.microsSinceUnixEpoch / 1000n;
  const entry = ctx.db.cooldown.playerId.find(playerId);
  if (entry && nowMs < entry.nextBuzzAtMs) {
    throw new SenderError('cooldown');
  }
  const next = { playerId, nextBuzzAtMs: nowMs + BuzzCooldownMs };
  if (entry) {
    ctx.db.cooldown.playerId.update(next);
  } else {
    ctx.db.cooldown.insert(next);
  }
  ctx.db.buzzEvent.insert({ cell: state.cell, playerId, kind: 1 });
});

// ---------- Weltakt ----------

/** Übernimmt alle Posen-Eingänge in einer Transaktion und kappt zu schnelle Sprünge (Weltakt). */
export const worldTick = spacetimedb.reducer({ onSchedule: tickTimer }, { arg: tickTimer.rowType }, (ctx) => {
  const tick = currentTick(ctx);
  for (const pose of Array.from(ctx.db.poseInbox.iter())) {
    ctx.db.poseInbox.playerId.delete(pose.playerId);
    const state = ctx.db.beeState.playerId.find(pose.playerId);
    if (!state) {
      continue;
    }
    // Stillstand schreibt keine Zeile; ohne Obergrenze würde er ein Sprungbudget ansammeln.
    const elapsedTicks = Math.min(Math.max(1, tick - state.tick), MaxElapsedTicks);
    const maxStep = MaxSpeed * SpeedSlack * elapsedTicks * TickSeconds;
    const dx = pose.x - state.x;
    const dy = pose.y - state.y;
    const dz = pose.z - state.z;
    const distance = Math.hypot(dx, dy, dz);
    const k = distance > maxStep ? maxStep / distance : 1;
    if (distance * k <= 0.01 && pose.yaw === state.yaw && pose.pitch === state.pitch) {
      continue; // unverändert: kein Update, kein Commit-Log-Eintrag
    }
    const x = state.x + dx * k;
    const y = state.y + dy * k;
    const z = state.z + dz * k;
    ctx.db.beeState.playerId.update({ playerId: pose.playerId, cell: packCell(x, z), x, y, z, yaw: pose.yaw, pitch: pose.pitch, tick });
  }
});
