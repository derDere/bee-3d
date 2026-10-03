// src/net/poseTracks.ts — Replikationspuffer für bewegte Objekte (Bienen, Fliegen): Zeilen → interpolierte Posen.

/** Interpolierte Pose zum Darstellungszeitpunkt (Darstellungspose). */
export interface TrackedPose {
  x: number;
  y: number;
  z: number;
  yaw: number; // rad
  pitch: number; // rad
  /** Geschätztes Tempo aus den letzten Proben (m/s). */
  vx: number;
  vy: number;
  vz: number;
}

/** Eine Zustandsprobe eines Objekts (Probe). */
export interface PoseSample {
  readonly tick: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
  readonly pitch: number;
}

interface Track<Row> {
  readonly samples: PoseSample[];
  removedAtMs: number | undefined;
  readonly pose: TrackedPose;
  row: Row;
}

/**
 * Hält je Objekt einen kurzen Zustandspuffer samt letzter Zeile und liefert Posen in der Vergangenheit
 * (Replikationspuffer). Die Puffer überdauern Wiederverbindungen; entfernte Objekte laufen mit einer
 * Gnadenfrist aus, weil Zellwechsel als Löschen + Einfügen ankommen.
 */
export class PoseTracks<Row> {
  private static readonly MaxSamples = 8;
  private static readonly RemovalGraceMs = 250;
  private static readonly MaxExtrapolationTicks = 2;

  private readonly toSample: (row: Row) => PoseSample;
  private readonly tickSeconds: number;
  private readonly tracks = new Map<number, Track<Row>>();

  public constructor(toSample: (row: Row) => PoseSample, tickSeconds: number) {
    this.toSample = toSample;
    this.tickSeconds = tickSeconds;
  }

  /** Übernimmt eine eingefügte oder geänderte Zeile. */
  public push(id: number, row: Row): void {
    const sample = this.toSample(row);
    let track = this.tracks.get(id);
    if (track === undefined) {
      track = { samples: [], removedAtMs: undefined, pose: { x: sample.x, y: sample.y, z: sample.z, yaw: sample.yaw, pitch: sample.pitch, vx: 0, vy: 0, vz: 0 }, row };
      this.tracks.set(id, track);
    }
    track.removedAtMs = undefined;
    track.row = row;
    const samples = track.samples;
    const last = samples[samples.length - 1];
    if (last !== undefined && sample.tick < last.tick) {
      return; // veraltet
    }
    if (last !== undefined && sample.tick === last.tick) {
      samples[samples.length - 1] = sample; // gleiche Taktnummer: neuester Stand gilt
      return;
    }
    samples.push(sample);
    if (samples.length > PoseTracks.MaxSamples) {
      samples.shift();
    }
  }

  /** Merkt das Entfernen vor; nach der Gnadenfrist verschwindet das Objekt. */
  public markRemoved(id: number, nowMs: number): void {
    const track = this.tracks.get(id);
    if (track !== undefined) {
      track.removedAtMs = nowMs;
    }
  }

  /** Alle Objekte laufen aus, falls das nächste Abo sie nicht rechtzeitig wieder einfügt (Verbindungswechsel). */
  public markAllRemoved(nowMs: number): void {
    for (const track of this.tracks.values()) {
      track.removedAtMs ??= nowMs;
    }
  }

  /** Interpoliert alle Objekte zum Takt `renderTick` und entfernt abgelaufene. */
  public update(renderTick: number, nowMs: number): void {
    for (const [id, track] of this.tracks) {
      if (track.removedAtMs !== undefined && nowMs - track.removedAtMs > PoseTracks.RemovalGraceMs) {
        this.tracks.delete(id);
        continue;
      }
      this.interpolate(track, renderTick);
    }
  }

  /** Besucht jedes verfolgte Objekt mit Pose und letzter Zeile. */
  public forEach(visit: (id: number, pose: Readonly<TrackedPose>, row: Row) => void): void {
    for (const [id, track] of this.tracks) {
      if (track.samples.length > 0) {
        visit(id, track.pose, track.row);
      }
    }
  }

  public has(id: number): boolean {
    return this.tracks.has(id);
  }

  public poseOf(id: number): Readonly<TrackedPose> | undefined {
    return this.tracks.get(id)?.pose;
  }

  public rowOf(id: number): Row | undefined {
    return this.tracks.get(id)?.row;
  }

  public get size(): number {
    return this.tracks.size;
  }

  public clear(): void {
    this.tracks.clear();
  }

  private interpolate(track: Track<Row>, renderTick: number): void {
    const samples = track.samples;
    const first = samples[0];
    const last = samples[samples.length - 1];
    if (first === undefined || last === undefined) {
      return;
    }
    if (renderTick <= first.tick || samples.length === 1) {
      this.assign(track.pose, first, first, 0);
      return;
    }
    if (renderTick >= last.tick) {
      const previous = samples[samples.length - 2] ?? last;
      const span = Math.max(1, last.tick - previous.tick);
      const ahead = Math.min(renderTick - last.tick, PoseTracks.MaxExtrapolationTicks);
      this.assign(track.pose, previous, last, 1 + ahead / span); // kurz extrapolieren, dann halten
      return;
    }
    for (let i = samples.length - 1; i > 0; i--) {
      const a = samples[i - 1];
      const b = samples[i];
      if (a !== undefined && b !== undefined && a.tick <= renderTick && renderTick <= b.tick) {
        this.assign(track.pose, a, b, (renderTick - a.tick) / Math.max(1, b.tick - a.tick));
        return;
      }
    }
  }

  private assign(out: TrackedPose, a: PoseSample, b: PoseSample, t: number): void {
    out.x = a.x + (b.x - a.x) * t;
    out.y = a.y + (b.y - a.y) * t;
    out.z = a.z + (b.z - a.z) * t;
    out.yaw = a.yaw + shortestAngle(a.yaw, b.yaw) * t;
    out.pitch = a.pitch + (b.pitch - a.pitch) * t;
    const seconds = Math.max(this.tickSeconds, (b.tick - a.tick) * this.tickSeconds);
    out.vx = (b.x - a.x) / seconds;
    out.vy = (b.y - a.y) / seconds;
    out.vz = (b.z - a.z) / seconds;
  }
}

/** Kürzeste Winkeldifferenz von a nach b im Bereich (-π, π]. */
function shortestAngle(a: number, b: number): number {
  return Math.atan2(Math.sin(b - a), Math.cos(b - a));
}
