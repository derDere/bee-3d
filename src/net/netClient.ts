// src/net/netClient.ts — Netzanbindung des Spiels: Sitzung, Versionsabgleich, Beitritt, Abos, Posen, Reducer.
// Läuft im Browser und in Node (keine DOM-Zugriffe); den Seiten-Lebenszyklus bindet das Spiel mit bindPageLifecycle.
import type { Identity } from "spacetimedb";
import { tables, type DbConnection } from "./bindings";
import type { BeeState, CombatEvent, PlayerProfile } from "./bindings/types";
import { ProtocolVersion } from "../../shared/protocol";
import { CellSubscriptions } from "./cellSubscriptions";
import { PoseReporter, type ReportedPose } from "./poseReporter";
import { Replica } from "./replica";
import { ServerClock } from "./serverClock";
import { SpacetimeSession, type SessionOptions, type TokenStore } from "./spacetimeSession";

/** Lokal simulierte Spielfigur aus Sicht der Netzschicht (eigene Biene). */
export interface LocalBee {
  /** Aktuelle Pose samt Zielrichtung und Client-Flags. */
  readonly reportedPose: ReportedPose;
  /** Ob die Figur gerade Posen meldet (nicht angedockt). */
  readonly reporting: boolean;
  /** Setzt die Figur auf die autoritative Position: Einsetzpunkt oder Kappung durch den Server (Serverkorrektur). */
  correctTo(x: number, y: number, z: number): void;
}

/**
 * Verbindungszustand für HUD und Debug-API (Netzstatus): `ready` = verbunden und Version geprüft, die Biene
 * ist noch nicht beigetreten; `online` = die eigene Biene steht auf dem Server in der Welt.
 */
export type NetStatus = "offline" | "connecting" | "ready" | "joining" | "online" | "reconnecting" | "reload-required";

/** Rückmeldungen an das Spiel (Netzereignisse). */
export interface NetHooks {
  onStatus(status: NetStatus): void;
  /** Kampf- oder Spielereignis in der Nachbarschaft. */
  onCombatEvent(event: CombatEvent): void;
  /** Autoritative eigene Zeile hat sich geändert (LP, Flags, Lage). */
  onOwnBee(row: BeeState): void;
  /** Ein Reducer wurde abgelehnt; `message` ist der Fehlertext des Moduls. */
  onRejected(reducer: string, message: string): void;
  /** Der Server hat das gespeicherte Token abgelehnt: Gäste bekommen ein neues Konto. */
  onTokenRejected(): void;
}

/** Kompakter Netzzustand für Debug-API und Prüf-Agenten (Netzzustand). */
export interface NetState {
  readonly status: NetStatus;
  readonly identity: string | undefined;
  readonly playerId: number | undefined;
  readonly serverTick: number;
  readonly remoteBees: number;
  readonly flies: number;
  readonly patches: number;
  /** Serverkorrekturen der eigenen Lage seit dem Start und der Abstand der letzten (Meter). */
  readonly corrections: { readonly count: number; readonly lastMeters: number };
  /** Zeilen der eigenen Views (Spielerstand, Module, Quests). */
  readonly views: { readonly stats: boolean; readonly modules: number; readonly quests: number };
}

/** Teile, die je Verbindung entstehen und mit ihr verworfen werden (Verbindungsanbindung). */
interface Attachment {
  readonly connection: DbConnection;
  readonly cells: CellSubscriptions;
  readonly reporter: PoseReporter;
  ownRowSubscribed: boolean;
}

/** Bindet SpacetimeDB an das Spiel; als FrameSystem im Spieltakt registrieren (Netzanbindung). */
export class NetClient {
  /** Meter zwischen Serverposition und gesendeten Posen, ab denen der Client der Serverposition folgt. */
  private static readonly CorrectionMeters = 3;
  private static readonly BeeDelayTicks = 2;
  private static readonly FlyDelayTicks = 3;

  public readonly clock = new ServerClock();
  public readonly replica: Replica;
  private readonly session: SpacetimeSession;
  private readonly local: LocalBee;
  private readonly hooks: NetHooks;
  private playerName: string | undefined;
  private status: NetStatus = "offline";
  private identity: Identity | undefined;
  private attachment: Attachment | undefined;
  private correction: BeeState | undefined;
  private spawned = false;
  private correctionCount = 0;
  private lastCorrectionMeters = 0;

  public constructor(options: SessionOptions, tokens: TokenStore, local: LocalBee, hooks: NetHooks) {
    this.local = local;
    this.hooks = hooks;
    this.replica = new Replica(this.clock, {
      onOwnProfile: (profile) => this.onOwnProfile(profile),
      onOwnBee: (row) => this.onOwnRow(row),
      onCombatEvent: (event) => hooks.onCombatEvent(event),
    });
    this.session = new SpacetimeSession(options, tokens, {
      onReady: (connection, identity) => void this.handleReady(connection, identity),
      onLost: () => this.handleLost(),
      onTokenRejected: () => hooks.onTokenRejected(),
    });
  }

  public get currentStatus(): NetStatus {
    return this.status;
  }

  /** Eigene Spieler-ID, sobald das Profil angekommen ist. */
  public get playerId(): number | undefined {
    return this.replica.playerId;
  }

  /** Ob die eigene Biene auf dem Server in der Welt steht. */
  public get isOnline(): boolean {
    return this.status === "online";
  }

  /** Baut die erste Verbindung auf; der Beitritt folgt mit `join`. */
  public start(): void {
    this.setStatus("connecting");
    this.session.start();
  }

  /** Tritt mit diesem Namen bei, sofort oder sobald die Verbindung steht (auch nach jedem Wiederverbinden). */
  public join(playerName: string): void {
    this.playerName = playerName;
    const attachment = this.attachment;
    if (attachment !== undefined) {
      this.sendJoin(attachment.connection, playerName);
    }
  }

  /** Prüft die Verbindung sofort (Seiten-Lebenszyklus, siehe bindPageLifecycle). */
  public resumeNow(): void {
    this.session.resumeNow();
  }

  /** Trennt die Verbindung wie ein Netzabbruch; die Sitzung verbindet selbst neu (Debug-API, Tests). */
  public dropConnection(): void {
    this.session.connection?.disconnect();
  }

  /** Netzzustand für HUD, Debug-API und Tests. */
  public state(): NetState {
    return {
      status: this.status,
      identity: this.identity?.toHexString(),
      playerId: this.replica.playerId,
      serverTick: Math.floor(this.clock.tickAt(performance.now())),
      remoteBees: this.replica.bees.size,
      flies: this.replica.flies.size,
      patches: this.replica.patches.size,
      corrections: { count: this.correctionCount, lastMeters: this.lastCorrectionMeters },
      views: { stats: this.replica.stats !== undefined, modules: this.replica.modules.length, quests: this.replica.quests.length },
    };
  }

  // ---------- Reducer ----------

  public setName(name: string): void {
    this.playerName = name;
    this.call("setName", (c) => c.reducers.setName({ name }));
  }

  public buzz(): void {
    this.call("buzz", (c) => c.reducers.buzz({}), true);
  }

  public beginWarp(x: number, y: number, z: number): Promise<void> {
    const connection = this.attachment?.connection;
    if (connection === undefined) {
      return Promise.reject(new Error("offline"));
    }
    return connection.reducers.beginWarp({ x, y, z });
  }

  public dock(hiveId: number): void {
    this.call("dock", (c) => c.reducers.dock({ hiveId }));
  }

  public undock(): void {
    this.call("undock", (c) => c.reducers.undock({}));
  }

  public deposit(): void {
    this.call("deposit", (c) => c.reducers.deposit({}));
  }

  public repair(): void {
    this.call("repair", (c) => c.reducers.repair({}));
  }

  public buyUpgrade(kind: string): void {
    this.call("buyUpgrade", (c) => c.reducers.buyUpgrade({ kind }));
  }

  public setHomeHive(): void {
    this.call("setHomeHive", (c) => c.reducers.setHomeHive({}));
  }

  public activateModule(slot: number, targetKind: number, targetId: number): void {
    this.call("activateModule", (c) => c.reducers.activateModule({ slot, targetKind, targetId }));
  }

  public deactivateModule(slot: number): void {
    this.call("deactivateModule", (c) => c.reducers.deactivateModule({ slot }));
  }

  /** Setzt das Wetter (nur Betreiber; Debug-API). */
  public setWeather(weather: string): void {
    this.call("setWeather", (c) => c.reducers.setWeather({ weather }));
  }

  // ---------- Takt ----------

  /** Einmal pro gerendertem Frame (FrameSystem des Spieltakts): Korrektur, Zell-Abos, Posen senden, Interpolation. */
  public frameUpdate(_dt: number, _alpha: number): void {
    const nowMs = performance.now();
    this.replica.update(nowMs, NetClient.BeeDelayTicks, NetClient.FlyDelayTicks);
    const attachment = this.attachment;
    if (attachment === undefined) {
      return;
    }
    const correction = this.correction;
    if (correction !== undefined) {
      this.correction = undefined;
      const pose = this.local.reportedPose;
      this.lastCorrectionMeters = Math.hypot(pose.x - correction.x, pose.y - correction.y, pose.z - correction.z);
      this.correctionCount++;
      this.local.correctTo(correction.x, correction.y, correction.z);
      attachment.reporter.reset();
      if (!this.spawned) {
        this.spawned = true;
        this.setStatus("online");
      }
    }
    if (!this.spawned) {
      return; // erst senden, wenn die Figur am Einsetzpunkt des Servers steht
    }
    const pose = this.local.reportedPose;
    attachment.cells.update(pose.x, pose.z);
    if (this.local.reporting) {
      attachment.reporter.update(nowMs, pose);
    }
  }

  /** Beendet Sitzung und Replikation (Spielende). */
  public dispose(): void {
    this.detach();
    this.session.stop();
    this.replica.dispose();
    this.setStatus("offline");
  }

  private call(name: string, invoke: (connection: DbConnection) => Promise<void>, quiet = false): void {
    const connection = this.attachment?.connection;
    if (connection === undefined) {
      return;
    }
    invoke(connection).catch((error: unknown) => {
      if (!quiet) {
        this.hooks.onRejected(name, error instanceof Error ? error.message : String(error));
      }
    });
  }

  private async handleReady(connection: DbConnection, identity: Identity): Promise<void> {
    let serverVersion: number | undefined;
    try {
      serverVersion = await connection.procedures.protocolVersion({});
    } catch {
      serverVersion = undefined; // Modul ohne Versionsabgleich oder Verbindung schon wieder weg
    }
    if (connection !== this.session.connection) {
      return; // inzwischen ersetzt; die neue Verbindung prüft selbst
    }
    if (serverVersion !== ProtocolVersion) {
      this.session.stop(); // alter Code im Tab: Wiederverbinden hilft nicht
      this.detach();
      this.setStatus("reload-required");
      return;
    }
    this.identity = identity;
    this.attach(connection, identity);
  }

  private attach(connection: DbConnection, identity: Identity): void {
    this.detach();
    const attachment: Attachment = {
      connection,
      cells: new CellSubscriptions(connection),
      reporter: new PoseReporter((pose) => {
        connection.reducers.reportPose(pose).catch(() => undefined); // abgelehnte Posen fängt die Korrektur auf
      }),
      ownRowSubscribed: false,
    };
    this.attachment = attachment;
    this.replica.attach(connection, identity);
    // Kleine, öffentliche Tabellen vollständig; private Werte über die Views des Aufrufers
    connection
      .subscriptionBuilder()
      .onError((ctx) => console.error("subscription failed", ctx.event))
      .subscribe([tables.playerProfile, tables.playerScore, tables.hiveState, tables.worldWeather, tables.myStats, tables.myModules, tables.myQuests]);
    if (this.playerName === undefined) {
      this.setStatus("ready");
    } else {
      this.sendJoin(connection, this.playerName);
    }
  }

  private sendJoin(connection: DbConnection, name: string): void {
    this.setStatus("joining");
    connection.reducers.join({ name }).catch((error: unknown) => {
      this.hooks.onRejected("join", error instanceof Error ? error.message : String(error));
    });
  }

  /** Eigene Spieler-ID bekannt: eigene Zeile per Primärschlüssel abonnieren, unabhängig von den Zellen. */
  private onOwnProfile(profile: PlayerProfile): void {
    const attachment = this.attachment;
    if (attachment === undefined || attachment.ownRowSubscribed) {
      return;
    }
    attachment.ownRowSubscribed = true;
    attachment.connection.subscriptionBuilder().subscribe(tables.beeState.where((row) => row.playerId.eq(profile.playerId)));
  }

  /** Autoritative eigene Zeile: Einsetzpunkt übernehmen, später nur bei Kappung oder Sprung durch den Server folgen. */
  private onOwnRow(row: BeeState): void {
    const attachment = this.attachment;
    if (attachment === undefined) {
      return;
    }
    this.hooks.onOwnBee(row);
    if (!this.spawned || attachment.reporter.serverDeviation(row.x, row.y, row.z) > NetClient.CorrectionMeters) {
      this.correction = row;
    }
  }

  private handleLost(): void {
    this.detach();
    if (this.status !== "reload-required" && this.status !== "offline") {
      this.setStatus("reconnecting");
    }
  }

  private detach(): void {
    const attachment = this.attachment;
    if (attachment === undefined) {
      return;
    }
    this.attachment = undefined;
    this.spawned = false;
    this.correction = undefined;
    if (attachment.connection.isActive) {
      attachment.cells.dispose(); // auf einer toten Verbindung gibt es nichts abzubestellen
    }
    this.replica.detach();
  }

  private setStatus(status: NetStatus): void {
    if (this.status !== status) {
      this.status = status;
      this.hooks.onStatus(status);
    }
  }
}
