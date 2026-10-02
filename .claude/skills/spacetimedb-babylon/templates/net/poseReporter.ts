// src/net/poseReporter.ts — sendet die eigene Pose gedrosselt und prüft Korrekturen des Servers.
import { encodeAngle } from '../../shared/world';

/** Übertragungsform der eigenen Pose (Argumente des Reducers reportPose). */
export interface WirePose {
  x: number;
  y: number;
  z: number;
  yaw: number; // i16
  pitch: number; // i16
}

/** Entscheidet, wann die eigene Pose gesendet wird: bei Bewegung mit fester Rate, im Stand als Herzschlag (Posen-Sender). */
export class PoseReporter {
  private readonly send: (pose: WirePose) => void;
  private readonly intervalMs: number;
  private readonly heartbeatMs: number;
  private readonly epsilon: number;
  private last: WirePose | undefined;
  private lastSentMs = -Infinity;
  private readonly history: Array<{ readonly pose: WirePose; readonly atMs: number }> = [];

  /**
   * @param send ruft den Reducer auf, z. B. `(p) => conn.reducers.reportPose(p).catch(report)`.
   * @param rateHz Senderate während der Bewegung.
   * @param heartbeatMs Abstand der Meldungen im Stand.
   * @param epsilon Meter, ab denen eine Positionsänderung als Bewegung gilt.
   */
  public constructor(send: (pose: WirePose) => void, rateHz = 15, heartbeatMs = 1000, epsilon = 0.02) {
    this.send = send;
    this.intervalMs = 1000 / rateHz;
    this.heartbeatMs = heartbeatMs;
    this.epsilon = epsilon;
  }

  /** Pro Frame mit der lokal simulierten Pose aufrufen (Winkel in rad). */
  public update(nowMs: number, x: number, y: number, z: number, yawRad: number, pitchRad: number): void {
    const pose: WirePose = { x, y, z, yaw: encodeAngle(yawRad), pitch: encodeAngle(pitchRad) };
    const last = this.last;
    const moved =
      last === undefined ||
      Math.hypot(pose.x - last.x, pose.y - last.y, pose.z - last.z) > this.epsilon ||
      pose.yaw !== last.yaw ||
      pose.pitch !== last.pitch;
    if (nowMs - this.lastSentMs < (moved ? this.intervalMs : this.heartbeatMs)) {
      return;
    }
    this.send(pose);
    this.last = pose;
    this.lastSentMs = nowMs;
    this.history.push({ pose, atMs: nowMs });
    const keepMs = Math.max(1000, 2 * this.heartbeatMs);
    while (this.history.length > 0 && nowMs - this.history[0]!.atMs > keepMs) {
      this.history.shift();
    }
  }

  /**
   * Abstand der autoritativen Serverposition zur nächstgelegenen gesendeten Pose der letzten Sekunde.
   * Ein großer Wert heißt: der Server hat gekappt (zu schnell, blockiert) und der Client muss korrigieren.
   */
  public serverDeviation(x: number, y: number, z: number): number {
    let best = Infinity;
    for (const { pose } of this.history) {
      best = Math.min(best, Math.hypot(pose.x - x, pose.y - y, pose.z - z));
    }
    return best;
  }
}
