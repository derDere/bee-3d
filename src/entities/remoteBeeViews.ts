import type { CascadedShadowGenerator } from "@babylonjs/core/Lights/Shadows/cascadedShadowGenerator";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";
import { BeeFlags } from "../../shared/events";
import type { FrameSystem } from "../core/gameLoop";
import type { ModelLibrary } from "../core/modelLibrary";
import type { Replica } from "../net/replica";
import { BeeAvatar } from "./beeAvatar";

interface BeeView {
  readonly avatar: BeeAvatar;
  readonly position: Vector3;
  previousYaw: number;
  bank: number;
}

/**
 * Stellt fremde Bienen aus dem Server-Spiegel dar (Fremdbienen): Modellkopien aus einem Pool, Pose mit
 * Interpolationsverzug, Schräglage aus der Gierrate, Materialvariante nach Flags und Tageszeit.
 */
export class RemoteBeeViews implements FrameSystem {
  private readonly scene: Scene;
  private readonly library: ModelLibrary;
  private readonly replica: Replica;
  private readonly shadows: CascadedShadowGenerator;
  private readonly views = new Map<number, BeeView>();
  private readonly pool: BeeAvatar[] = [];
  private readonly seen = new Set<number>();
  private night = false;
  private created = 0;

  public constructor(scene: Scene, library: ModelLibrary, replica: Replica, shadows: CascadedShadowGenerator) {
    this.scene = scene;
    this.library = library;
    this.replica = replica;
    this.shadows = shadows;
  }

  public setNight(night: boolean): void {
    this.night = night;
  }

  /** Darstellung einer fremden Biene (für Effekte: Augen, Beine, Stachel). */
  public avatarOf(playerId: number): BeeAvatar | undefined {
    return this.views.get(playerId)?.avatar;
  }

  public frameUpdate(dt: number): void {
    this.seen.clear();
    this.replica.bees.forEach((playerId, pose, row) => {
      const docked = (row.flags & BeeFlags.docked) !== 0;
      if (docked) {
        return; // angedockte Bienen sitzen im Stock
      }
      const view = this.views.get(playerId) ?? this.acquire(playerId);
      if (view === undefined) {
        return;
      }
      this.seen.add(playerId);
      const yawRate = Math.atan2(Math.sin(pose.yaw - view.previousYaw), Math.cos(pose.yaw - view.previousYaw)) / Math.max(dt, 1e-3);
      view.previousYaw = pose.yaw;
      view.bank += (Math.max(-0.7, Math.min(0.7, -yawRate * 0.35)) - view.bank) * Math.min(1, dt * 5);
      view.position.set(pose.x, pose.y, pose.z);
      view.avatar.setPose(view.position, pose.yaw, pose.pitch, view.bank);
      const ghost = (row.flags & BeeFlags.ghost) !== 0;
      const laser = (row.flags & (BeeFlags.laserFiring | BeeFlags.freeLaser)) !== 0;
      view.avatar.setLook({ night: this.night, laser, ghost });
      const speed = Math.hypot(pose.vx, pose.vy, pose.vz);
      view.avatar.update(dt, speed, speed < 0.3);
    });
    for (const [playerId, view] of this.views) {
      if (!this.seen.has(playerId)) {
        this.release(playerId, view);
      }
    }
  }

  public dispose(): void {
    for (const [playerId, view] of this.views) {
      this.release(playerId, view);
    }
    for (const avatar of this.pool) {
      avatar.dispose();
    }
    this.pool.length = 0;
  }

  private acquire(playerId: number): BeeView | undefined {
    const avatar = this.pool.pop() ?? BeeAvatar.create(this.scene, this.library, `remoteBee${this.created++}`);
    if (avatar === undefined) {
      return undefined; // Modell lädt noch
    }
    avatar.setVisible(true);
    for (const mesh of avatar.renderMeshes) {
      this.shadows.addShadowCaster(mesh, false);
    }
    const view: BeeView = { avatar, position: new Vector3(), previousYaw: 0, bank: 0 };
    this.views.set(playerId, view);
    return view;
  }

  private release(playerId: number, view: BeeView): void {
    this.views.delete(playerId);
    view.avatar.setVisible(false);
    for (const mesh of view.avatar.renderMeshes) {
      this.shadows.removeShadowCaster(mesh, false);
    }
    this.pool.push(view.avatar);
  }
}
