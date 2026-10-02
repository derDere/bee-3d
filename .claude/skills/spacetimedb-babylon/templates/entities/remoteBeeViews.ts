// src/entities/remoteBeeViews.ts — überträgt interpolierte Fremd-Bienen jeden Frame in die Babylon-Szene.
import { Quaternion } from '@babylonjs/core/Maths/math.vector';
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import type { RemoteBees } from '../net/remoteBees';
import type { ServerClock } from '../net/serverClock';

/** Erzeugt und entsorgt die Darstellung einer fremden Biene, z. B. über die Modellbibliothek (Bienen-Fabrik). */
export interface BeeViewFactory {
  create(playerId: number): TransformNode;
  release(playerId: number, node: TransformNode): void;
}

/** Stellt fremde Bienen mit Interpolationsverzug dar; als Frame-System im Spieltakt registrieren (Bienen-Darstellung). */
export class RemoteBeeViews {
  private readonly bees: RemoteBees;
  private readonly clock: ServerClock;
  private readonly factory: BeeViewFactory;
  private readonly delayTicks: number;
  private readonly nodes = new Map<number, TransformNode>();
  private readonly seen = new Set<number>();

  /** @param delayTicks Darstellung so viele Server-Takte in der Vergangenheit (2 Takte = 100 ms bei 20 Hz). */
  public constructor(bees: RemoteBees, clock: ServerClock, factory: BeeViewFactory, delayTicks = 2) {
    this.bees = bees;
    this.clock = clock;
    this.factory = factory;
    this.delayTicks = delayTicks;
  }

  /** Einmal pro gerendertem Frame (FrameSystem des Spieltakts). */
  public frameUpdate(_dt: number, _alpha: number): void {
    if (!this.clock.isSynchronised) {
      return;
    }
    const nowMs = performance.now();
    const renderTick = this.clock.tickAt(nowMs) - this.delayTicks;
    this.seen.clear();
    this.bees.forEachPose(renderTick, nowMs, (playerId, pose) => {
      let node = this.nodes.get(playerId);
      if (node === undefined) {
        node = this.factory.create(playerId);
        this.nodes.set(playerId, node);
      }
      node.position.set(pose.x, pose.y, pose.z);
      node.rotationQuaternion ??= new Quaternion();
      Quaternion.FromEulerAnglesToRef(pose.pitch, pose.yaw, 0, node.rotationQuaternion);
      this.seen.add(playerId);
    });
    for (const [playerId, node] of this.nodes) {
      if (!this.seen.has(playerId)) {
        this.factory.release(playerId, node);
        this.nodes.delete(playerId);
      }
    }
  }

  /** Entsorgt alle Darstellungen (Szenenwechsel, Verbindungsende). */
  public dispose(): void {
    for (const [playerId, node] of this.nodes) {
      this.factory.release(playerId, node);
    }
    this.nodes.clear();
  }
}
