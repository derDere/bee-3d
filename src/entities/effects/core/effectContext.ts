// Gemeinsame Dienste der Effektmodule: Billboard-Stapel, Partikel, Zufall, Kamera und Effektzeit.
import type { Camera } from "@babylonjs/core/Cameras/camera";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";
import type { BillboardBatch } from "../render/billboardBatch";
import { EffectRandom } from "./effectRandom";
import { ParticleEmitter } from "./particleEmitter";
import { ParticlePool } from "./particlePool";

/** Gemeinsame Dienste aller Effektmodule (Effektkontext). */
export class EffectContext {
  public readonly scene: Scene;
  public readonly camera: Camera;
  /** Additiver Stapel für Leuchtendes (Strahlen, Funken, Ringe). */
  public readonly glow: BillboardBatch;
  /** Deckend gemischter Stapel für Materie (Rauch, Schleim, Spritzer). */
  public readonly matter: BillboardBatch;
  public readonly random: EffectRandom;
  public readonly particles: ParticlePool;
  public readonly emitter: ParticleEmitter;
  /** Kameraposition des laufenden Frames. */
  public readonly cameraPosition = new Vector3();
  /** Effektzeit in Sekunden; steht still, solange dt 0 ist (Pause). */
  public time = 0;

  public constructor(scene: Scene, camera: Camera, glow: BillboardBatch, matter: BillboardBatch, particleCapacity: number, seed: number) {
    this.scene = scene;
    this.camera = camera;
    this.glow = glow;
    this.matter = matter;
    this.random = new EffectRandom(seed);
    this.particles = new ParticlePool(particleCapacity, this.random);
    this.emitter = new ParticleEmitter(this.particles, this.random);
  }

  /** Beginnt einen Frame: Zeit fortschreiben, Kameraposition übernehmen. */
  public beginFrame(dt: number): void {
    this.time += dt;
    // Ohne Elternknoten ist position bereits aktuell; globalPosition folgt erst beim Rendern.
    this.cameraPosition.copyFrom(this.camera.parent === null ? this.camera.position : this.camera.globalPosition);
  }

  /** Gibt die Partikel frei; Stapel und Kamera gehören dem Effektsystem. */
  public dispose(): void {
    this.particles.dispose();
  }
}
