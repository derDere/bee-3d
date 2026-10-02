// src/net/netClient.ts — Netzanbindung des Spiels: Sitzung, Versionsabgleich, Beitritt, Abos, Replikation, Posen.
// Läuft im Browser und in Node (keine DOM-Zugriffe); den Seiten-Lebenszyklus bindet das Spiel mit bindPageLifecycle.
import type { Identity } from 'spacetimedb';
import { tables, type DbConnection } from './bindings';
import type { BeeState, PlayerProfile } from './bindings/types';
import { ProtocolVersion } from '../../shared/protocol';
import { CellSubscriptions } from './cellSubscriptions';
import { PoseReporter } from './poseReporter';
import { RemoteBees } from './remoteBees';
import { ServerClock } from './serverClock';
import { SpacetimeSession, type SessionOptions, type TokenStore } from './spacetimeSession';

/** Lokal simulierte Spielfigur aus Sicht der Netzschicht (eigene Biene). */
export interface LocalBee {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number; // rad
  readonly pitch: number; // rad
  /** Setzt die Figur auf die autoritative Position: Einsetzpunkt oder Kappung durch den Server (Serverkorrektur). */
  correctTo(x: number, y: number, z: number): void;
}

/** Verbindungszustand für HUD und Debug-API (Netzstatus). */
export type NetStatus = 'offline' | 'connecting' | 'joining' | 'online' | 'reconnecting' | 'reload-required';

/** Rückmeldungen an das Spiel (Netzereignisse). */
export interface NetHooks {
  onStatus(status: NetStatus): void;
  /** Eine Biene in einer abonnierten Zelle hat gesummt; Pose über `remoteBees.poseOf`. */
  onBuzz(playerId: number): void;
  /** Der Server hat das gespeicherte Token abgelehnt: Gäste bekommen ein neues Konto, OIDC-Nutzer melden sich neu an. */
  onTokenRejected(): void;
}

/** Kompakter Netzzustand für Debug-API und Prüf-Agenten (Netzzustand). */
export interface NetState {
  readonly status: NetStatus;
  readonly identity: string | undefined;
  readonly playerId: number | undefined;
  readonly serverTick: number;
  readonly remoteBees: number;
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

  public readonly clock = new ServerClock();
  public readonly remoteBees: RemoteBees;
  private readonly session: SpacetimeSession;
  private readonly local: LocalBee;
  private readonly playerName: string;
  private readonly hooks: NetHooks;
  private status: NetStatus = 'offline';
  private identity: Identity | undefined;
  private playerId: number | undefined;
  private attachment: Attachment | undefined;
  private correction: BeeState | undefined;
  private spawned = false;

  public constructor(options: SessionOptions, tokens: TokenStore, local: LocalBee, playerName: string, hooks: NetHooks) {
    this.local = local;
    this.playerName = playerName;
    this.hooks = hooks;
    this.remoteBees = new RemoteBees(this.clock, (playerId) => playerId === this.playerId);
    this.session = new SpacetimeSession(options, tokens, {
      onReady: (connection, identity) => void this.handleReady(connection, identity),
      onLost: () => this.handleLost(),
      onTokenRejected: () => hooks.onTokenRejected(),
    });
  }

  /** Baut die erste Verbindung auf. */
  public start(): void {
    this.setStatus('connecting');
    this.session.start();
  }

  /** Prüft die Verbindung sofort (Seiten-Lebenszyklus, siehe bindPageLifecycle). */
  public resumeNow(): void {
    this.session.resumeNow();
  }

  /** Trennt die Verbindung wie ein Netzabbruch; die Sitzung verbindet selbst neu (Debug-API, Tests). */
  public dropConnection(): void {
    this.session.connection?.disconnect();
  }

  /** Summt; die Abklingzeit prüft der Server. */
  public buzz(): void {
    this.attachment?.connection.reducers.buzz({}).catch(() => undefined); // Abklingzeit-Fehler sind erwartet
  }

  /** Netzzustand für HUD, Debug-API und Tests. */
  public state(): NetState {
    return {
      status: this.status,
      identity: this.identity?.toHexString(),
      playerId: this.playerId,
      serverTick: Math.floor(this.clock.tickAt(performance.now())),
      remoteBees: this.remoteBees.size,
    };
  }

  /** Einmal pro gerendertem Frame (FrameSystem des Spieltakts): Korrektur, Zell-Abos, Posen senden. */
  public frameUpdate(_dt: number, _alpha: number): void {
    const attachment = this.attachment;
    if (attachment === undefined) {
      return;
    }
    const correction = this.correction;
    if (correction !== undefined) {
      this.correction = undefined;
      this.local.correctTo(correction.x, correction.y, correction.z);
      if (!this.spawned) {
        this.spawned = true;
        this.setStatus('online');
      }
    }
    if (!this.spawned) {
      return; // erst senden, wenn die Figur am Einsetzpunkt des Servers steht
    }
    const local = this.local;
    attachment.cells.update(local.x, local.z);
    attachment.reporter.update(performance.now(), local.x, local.y, local.z, local.yaw, local.pitch);
  }

  /** Beendet Sitzung und Replikation (Spielende). */
  public dispose(): void {
    this.detach(); // Abos abbestellen, solange die Verbindung noch offen ist
    this.session.stop();
    this.remoteBees.dispose();
    this.setStatus('offline');
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
      this.setStatus('reload-required');
      return;
    }
    this.identity = identity;
    this.attach(connection, identity);
  }

  private attach(connection: DbConnection, identity: Identity): void {
    this.detach();
    this.setStatus('joining');
    const attachment: Attachment = {
      connection,
      cells: new CellSubscriptions(connection),
      reporter: new PoseReporter((pose) => {
        connection.reducers.reportPose(pose).catch(() => undefined); // abgelehnte Posen fängt die Korrektur auf
      }),
      ownRowSubscribed: false,
    };
    this.attachment = attachment;
    this.remoteBees.attach(connection);
    connection.db.playerProfile.onInsert((_ctx, profile) => {
      if (this.attachment === attachment && profile.identity.isEqual(identity)) {
        this.onOwnProfile(attachment, profile);
      }
    });
    connection.db.beeState.onInsert((_ctx, row) => this.onOwnRow(attachment, row));
    connection.db.beeState.onUpdate((_ctx, _old, row) => this.onOwnRow(attachment, row));
    connection.db.buzzEvent.onInsert((_ctx, event) => this.hooks.onBuzz(event.playerId));
    connection.subscriptionBuilder().subscribe(tables.playerProfile.where((row) => row.identity.eq(identity)));
    connection.reducers.join({ name: this.playerName }).catch((error: unknown) => console.error('join failed', error));
  }

  /** Eigene Spieler-ID bekannt: eigene Zeile per Primärschlüssel abonnieren, unabhängig von den Zellen. */
  private onOwnProfile(attachment: Attachment, profile: PlayerProfile): void {
    this.playerId = profile.playerId;
    if (attachment.ownRowSubscribed) {
      return;
    }
    attachment.ownRowSubscribed = true;
    attachment.connection.subscriptionBuilder().subscribe(tables.beeState.where((row) => row.playerId.eq(profile.playerId)));
  }

  /** Autoritative eigene Zeile: Einsetzpunkt übernehmen, später nur bei Kappung durch den Server folgen. */
  private onOwnRow(attachment: Attachment, row: BeeState): void {
    if (this.attachment !== attachment || row.playerId !== this.playerId) {
      return;
    }
    if (!this.spawned || attachment.reporter.serverDeviation(row.x, row.y, row.z) > NetClient.CorrectionMeters) {
      this.correction = row;
    }
  }

  private handleLost(): void {
    this.detach();
    if (this.status !== 'reload-required' && this.status !== 'offline') {
      this.setStatus('reconnecting');
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
    this.remoteBees.detach();
  }

  private setStatus(status: NetStatus): void {
    if (this.status !== status) {
      this.status = status;
      this.hooks.onStatus(status);
    }
  }
}
