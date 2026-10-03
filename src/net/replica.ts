// src/net/replica.ts — Spiegel der abonnierten Server-Zeilen: Bienen, Fliegen, Felder, Profile, eigener Stand.
// SDK-Callbacks schreiben nur in eigene Maps; das Spiel liest sie im Frame (Regel: nie im Callback rechnen).
import type { Identity } from "spacetimedb";
import type { DbConnection, EventContext } from "./bindings";
import type {
  BeeState,
  CombatEvent,
  FlowerPatch,
  FlyState,
  HiveState,
  MyModuleRow,
  MyQuestRow,
  MyStatsRow,
  PlayerProfile,
  PlayerScore,
  WorldWeather,
} from "./bindings/types";
import { TickSeconds, decodeAngle } from "../../shared/world";
import { PoseTracks } from "./poseTracks";
import type { ServerClock } from "./serverClock";

/** Rückmeldungen des Spiegels an die Netzanbindung (Spiegel-Ereignisse). */
export interface ReplicaListener {
  /** Eigenes Profil gefunden: Spieler-ID steht fest. */
  onOwnProfile(profile: PlayerProfile): void;
  /** Autoritative eigene Zeile (Einsetzpunkt, Kappung, LP, Flags). */
  onOwnBee(row: BeeState): void;
  /** Kampf- oder Spielereignis in einer abonnierten Zelle. */
  onCombatEvent(event: CombatEvent): void;
}

/**
 * Lokaler Spiegel aller abonnierten Zeilen (Server-Spiegel). Puffer und Maps überdauern Wiederverbindungen;
 * `attach` hängt sich an jede neue Verbindung, `detach` lässt bewegte Objekte mit Gnadenfrist auslaufen.
 */
export class Replica {
  public readonly bees: PoseTracks<BeeState>;
  public readonly flies: PoseTracks<FlyState>;
  public readonly patches = new Map<number, FlowerPatch>();
  public readonly profiles = new Map<number, PlayerProfile>();
  public readonly scores = new Map<number, PlayerScore>();
  public readonly hives = new Map<number, HiveState>();
  public weather: WorldWeather | undefined;
  public ownBee: BeeState | undefined;
  public playerId: number | undefined;
  private statsRow: MyStatsRow | undefined;
  private moduleRows: readonly MyModuleRow[] = [];
  private questRows: readonly MyQuestRow[] = [];
  private privateDirty = true;
  private readonly clock: ServerClock;
  private readonly listener: ReplicaListener;
  private connection: DbConnection | undefined;
  private identity: Identity | undefined;

  public constructor(clock: ServerClock, listener: ReplicaListener) {
    this.clock = clock;
    this.listener = listener;
    this.bees = new PoseTracks<BeeState>((row) => ({ tick: row.tick, x: row.x, y: row.y, z: row.z, yaw: decodeAngle(row.yaw), pitch: decodeAngle(row.pitch) }), TickSeconds);
    this.flies = new PoseTracks<FlyState>((row) => ({ tick: row.tick, x: row.x, y: row.y, z: row.z, yaw: decodeAngle(row.yaw), pitch: decodeAngle(row.pitch) }), TickSeconds);
  }

  /** Eigener Spielerstand aus der View my_stats. */
  public get stats(): MyStatsRow | undefined {
    this.refreshPrivate();
    return this.statsRow;
  }

  /** Eigene laufende Module (View my_modules). */
  public get modules(): readonly MyModuleRow[] {
    this.refreshPrivate();
    return this.moduleRows;
  }

  /** Eigene Quests (View my_quests). */
  public get quests(): readonly MyQuestRow[] {
    this.refreshPrivate();
    return this.questRows;
  }

  /** Registriert die Zeilen-Callbacks auf einer neuen Verbindung. */
  public attach(connection: DbConnection, identity: Identity): void {
    this.detach();
    this.connection = connection;
    this.identity = identity;
    const db = connection.db;
    const live = (): boolean => this.connection === connection;
    db.beeState.onInsert((_ctx: EventContext, row: BeeState) => live() && this.pushBee(row));
    db.beeState.onUpdate((_ctx: EventContext, _old: BeeState, row: BeeState) => live() && this.pushBee(row));
    db.beeState.onDelete((_ctx: EventContext, row: BeeState) => live() && this.bees.markRemoved(row.playerId, performance.now()));
    db.flyState.onInsert((_ctx: EventContext, row: FlyState) => live() && this.pushFly(row));
    db.flyState.onUpdate((_ctx: EventContext, _old: FlyState, row: FlyState) => live() && this.pushFly(row));
    db.flyState.onDelete((_ctx: EventContext, row: FlyState) => live() && this.flies.markRemoved(row.flyId, performance.now()));
    db.flowerPatch.onInsert((_ctx: EventContext, row: FlowerPatch) => live() && this.patches.set(row.patchId, row));
    db.flowerPatch.onUpdate((_ctx: EventContext, _old: FlowerPatch, row: FlowerPatch) => live() && this.patches.set(row.patchId, row));
    db.flowerPatch.onDelete((_ctx: EventContext, row: FlowerPatch) => live() && this.patches.delete(row.patchId));
    db.playerProfile.onInsert((_ctx: EventContext, row: PlayerProfile) => live() && this.pushProfile(row));
    db.playerProfile.onUpdate((_ctx: EventContext, _old: PlayerProfile, row: PlayerProfile) => live() && this.pushProfile(row));
    db.playerScore.onInsert((_ctx: EventContext, row: PlayerScore) => live() && this.scores.set(row.playerId, row));
    db.playerScore.onUpdate((_ctx: EventContext, _old: PlayerScore, row: PlayerScore) => live() && this.scores.set(row.playerId, row));
    db.hiveState.onInsert((_ctx: EventContext, row: HiveState) => live() && this.hives.set(row.hiveId, row));
    db.hiveState.onUpdate((_ctx: EventContext, _old: HiveState, row: HiveState) => live() && this.hives.set(row.hiveId, row));
    db.worldWeather.onInsert((_ctx: EventContext, row: WorldWeather) => live() && (this.weather = row));
    db.worldWeather.onUpdate((_ctx: EventContext, _old: WorldWeather, row: WorldWeather) => live() && (this.weather = row));
    db.worldWeather.onDelete(() => live() && (this.weather = undefined));
    db.combatEvent.onInsert((_ctx: EventContext, row: CombatEvent) => live() && this.listener.onCombatEvent(row));
    // Eigene Views: jede Änderung markiert den Stand, der beim nächsten Lesen aus dem Cache kommt
    const markPrivate = (): void => {
      if (live()) {
        this.privateDirty = true;
      }
    };
    db.myStats.onInsert(markPrivate);
    db.myStats.onUpdate(markPrivate);
    db.myStats.onDelete(markPrivate);
    db.myModules.onInsert(markPrivate);
    db.myModules.onUpdate(markPrivate);
    db.myModules.onDelete(markPrivate);
    db.myQuests.onInsert(markPrivate);
    db.myQuests.onUpdate(markPrivate);
    db.myQuests.onDelete(markPrivate);
    this.privateDirty = true;
  }

  /** Löst die Verbindung; bewegte Objekte laufen aus, falls die nächste Verbindung sie nicht wieder einfügt. */
  public detach(): void {
    if (this.connection === undefined) {
      return;
    }
    this.connection = undefined;
    this.bees.markAllRemoved(performance.now());
    this.flies.markAllRemoved(performance.now());
  }

  /** Interpoliert Bienen und Fliegen zum Darstellungszeitpunkt (einmal je Frame). */
  public update(nowMs: number, beeDelayTicks: number, flyDelayTicks: number): void {
    if (!this.clock.isSynchronised) {
      return;
    }
    const tick = this.clock.tickAt(nowMs);
    this.bees.update(tick - beeDelayTicks, nowMs);
    this.flies.update(tick - flyDelayTicks, nowMs);
  }

  /** Anzeigename eines Spielers. */
  public nameOf(playerId: number): string {
    return this.profiles.get(playerId)?.name ?? `Bee ${playerId}`;
  }

  public dispose(): void {
    this.detach();
    this.bees.clear();
    this.flies.clear();
    this.patches.clear();
  }

  private pushBee(row: BeeState): void {
    this.clock.observe(row.tick, performance.now());
    if (row.playerId === this.playerId) {
      this.ownBee = row;
      this.listener.onOwnBee(row);
      return; // die eigene Biene simuliert der Client selbst
    }
    this.bees.push(row.playerId, row);
  }

  private pushFly(row: FlyState): void {
    this.clock.observe(row.tick, performance.now());
    this.flies.push(row.flyId, row);
  }

  private pushProfile(row: PlayerProfile): void {
    this.profiles.set(row.playerId, row);
    if (this.identity !== undefined && !row.isDemo && row.identity.isEqual(this.identity)) {
      this.playerId = row.playerId;
      this.listener.onOwnProfile(row);
    }
  }

  private refreshPrivate(): void {
    const connection = this.connection;
    if (!this.privateDirty || connection === undefined) {
      return;
    }
    this.privateDirty = false;
    // Ein leerer Cache nach dem Wiederverbinden behält den letzten bekannten Stand, bis das Abo greift
    for (const row of connection.db.myStats.iter()) {
      this.statsRow = row;
    }
    this.moduleRows = Array.from(connection.db.myModules.iter());
    this.questRows = Array.from(connection.db.myQuests.iter());
  }
}
