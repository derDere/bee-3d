// src/net/remoteBees.ts — Replikation fremder Bienen: Zeilen-Callbacks → Puffer → interpolierte Posen.
import type { DbConnection, EventContext } from './bindings';
import type { BeeState } from './bindings/types';
import { decodeAngle } from '../../shared/world';
import type { ServerClock } from './serverClock';

/** Interpolierte Pose einer Biene zum Darstellungszeitpunkt (Darstellungspose). */
export interface BeePose {
  x: number;
  y: number;
  z: number;
  yaw: number; // rad
  pitch: number; // rad
}

interface Sample {
  readonly tick: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
  readonly pitch: number;
}

interface Track {
  readonly samples: Sample[];
  removedAtMs: number | undefined;
  readonly pose: BeePose;
}

/**
 * Hält je Biene einen kurzen Zustandspuffer und liefert Posen in der Vergangenheit (Fremd-Bienen).
 * Die Puffer überdauern Wiederverbindungen: `attach` hängt sich an jede neue Verbindung.
 */
export class RemoteBees {
  private static readonly MaxSamples = 8;
  private static readonly RemovalGraceMs = 250; // Zellwechsel kommen als Löschen + Einfügen
  private static readonly MaxExtrapolationTicks = 2;

  private readonly clock: ServerClock;
  private readonly isLocalPlayer: (playerId: number) => boolean;
  private readonly tracks = new Map<number, Track>();
  private connection: DbConnection | undefined;
  private readonly onInsert = (_ctx: EventContext, row: BeeState): void => this.push(row);
  private readonly onUpdate = (_ctx: EventContext, _old: BeeState, row: BeeState): void => this.push(row);
  private readonly onDelete = (_ctx: EventContext, row: BeeState): void => this.markRemoved(row.playerId);

  public constructor(clock: ServerClock, isLocalPlayer: (playerId: number) => boolean) {
    this.clock = clock;
    this.isLocalPlayer = isLocalPlayer;
  }

  /** Registriert die Zeilen-Callbacks auf einer neuen Verbindung. */
  public attach(connection: DbConnection): void {
    this.detach();
    this.connection = connection;
    connection.db.beeState.onInsert(this.onInsert);
    connection.db.beeState.onUpdate(this.onUpdate);
    connection.db.beeState.onDelete(this.onDelete);
  }

  /**
   * Meldet die Callbacks der bisherigen Verbindung ab. Alle Bienen laufen mit der Gnadenfrist aus,
   * falls das Abo der nächsten Verbindung sie nicht rechtzeitig wieder einfügt.
   */
  public detach(): void {
    const connection = this.connection;
    if (connection === undefined) {
      return;
    }
    connection.db.beeState.removeOnInsert(this.onInsert);
    connection.db.beeState.removeOnUpdate(this.onUpdate);
    connection.db.beeState.removeOnDelete(this.onDelete);
    this.connection = undefined;
    const nowMs = performance.now();
    for (const track of this.tracks.values()) {
      track.removedAtMs ??= nowMs;
    }
  }

  /** Ruft `visit` für jede sichtbare Biene mit der interpolierten Pose auf; entfernt abgelaufene Bienen. */
  public forEachPose(renderTick: number, nowMs: number, visit: (playerId: number, pose: BeePose) => void): void {
    for (const [playerId, track] of this.tracks) {
      if (track.removedAtMs !== undefined && nowMs - track.removedAtMs > RemoteBees.RemovalGraceMs) {
        this.tracks.delete(playerId);
        continue;
      }
      if (this.interpolate(track, renderTick)) {
        visit(playerId, track.pose);
      }
    }
  }

  /** Ob die Biene noch verfolgt wird; sonst kann ihre Darstellung weg. */
  public has(playerId: number): boolean {
    return this.tracks.has(playerId);
  }

  /** Zuletzt interpolierte Pose einer Biene, z. B. für Effekte und Namensschilder. */
  public poseOf(playerId: number): Readonly<BeePose> | undefined {
    return this.tracks.get(playerId)?.pose;
  }

  /** Anzahl verfolgter Bienen (Debug-API). */
  public get size(): number {
    return this.tracks.size;
  }

  /** Meldet die Callbacks ab und verwirft alle Puffer (Spielende, Szenenwechsel). */
  public dispose(): void {
    this.detach();
    this.tracks.clear();
  }

  private push(row: BeeState): void {
    this.clock.observe(row.tick, performance.now());
    if (this.isLocalPlayer(row.playerId)) {
      return; // die eigene Biene simuliert der Client selbst
    }
    let track = this.tracks.get(row.playerId);
    if (track === undefined) {
      track = { samples: [], removedAtMs: undefined, pose: { x: row.x, y: row.y, z: row.z, yaw: 0, pitch: 0 } };
      this.tracks.set(row.playerId, track);
    }
    track.removedAtMs = undefined;
    const samples = track.samples;
    const last = samples[samples.length - 1];
    if (last !== undefined && row.tick < last.tick) {
      return; // veraltet
    }
    const sample: Sample = { tick: row.tick, x: row.x, y: row.y, z: row.z, yaw: decodeAngle(row.yaw), pitch: decodeAngle(row.pitch) };
    if (last !== undefined && row.tick === last.tick) {
      samples[samples.length - 1] = sample; // gleiche Taktnummer (verspäteter Takt, doppeltes Abo): neuester Stand gilt
      return;
    }
    samples.push(sample);
    if (samples.length > RemoteBees.MaxSamples) {
      samples.shift();
    }
  }

  private markRemoved(playerId: number): void {
    const track = this.tracks.get(playerId);
    if (track !== undefined) {
      track.removedAtMs = performance.now();
    }
  }

  /** Schreibt die Pose zum Takt `renderTick` in `track.pose`; false, solange keine Probe vorliegt. */
  private interpolate(track: Track, renderTick: number): boolean {
    const samples = track.samples;
    const first = samples[0];
    const last = samples[samples.length - 1];
    if (first === undefined || last === undefined) {
      return false;
    }
    if (renderTick <= first.tick || samples.length === 1) {
      this.assign(track.pose, first, first, 0);
      return true;
    }
    if (renderTick >= last.tick) {
      const previous = samples[samples.length - 2] ?? last;
      const span = Math.max(1, last.tick - previous.tick);
      const ahead = Math.min(renderTick - last.tick, RemoteBees.MaxExtrapolationTicks);
      this.assign(track.pose, previous, last, 1 + ahead / span); // kurz extrapolieren, dann halten
      return true;
    }
    for (let i = samples.length - 1; i > 0; i--) {
      const a = samples[i - 1]!;
      const b = samples[i]!;
      if (a.tick <= renderTick && renderTick <= b.tick) {
        this.assign(track.pose, a, b, (renderTick - a.tick) / (b.tick - a.tick));
        return true;
      }
    }
    return false;
  }

  private assign(out: BeePose, a: Sample, b: Sample, t: number): void {
    out.x = a.x + (b.x - a.x) * t;
    out.y = a.y + (b.y - a.y) * t;
    out.z = a.z + (b.z - a.z) * t;
    out.yaw = a.yaw + shortestAngle(a.yaw, b.yaw) * t;
    out.pitch = a.pitch + (b.pitch - a.pitch) * t;
  }
}

/** Kürzeste Winkeldifferenz von a nach b im Bereich (-π, π]. */
function shortestAngle(a: number, b: number): number {
  return Math.atan2(Math.sin(b - a), Math.cos(b - a));
}
