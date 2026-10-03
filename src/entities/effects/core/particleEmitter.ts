// Partikelstöße: kugelförmig oder in einem Kegel gebündelt, mit vorab angelegten Hilfsvektoren.
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { EffectRandom } from "./effectRandom";
import type { ParticlePool, ParticleSpec } from "./particlePool";

/** Erzeugt Partikelstöße im Partikelpool (Partikel-Emitter). */
export class ParticleEmitter {
  private readonly pool: ParticlePool;
  private readonly random: EffectRandom;
  private readonly direction = new Vector3();
  private readonly jitter = new Vector3();
  private readonly spawn = new Vector3();

  public constructor(pool: ParticlePool, random: EffectRandom) {
    this.pool = pool;
    this.random = random;
  }

  /** Ein Partikel mit gegebener Geschwindigkeit. */
  public single(spec: ParticleSpec, position: Vector3, vx: number, vy: number, vz: number, sizeScale = 1, intensity = 1): void {
    this.pool.emit(spec, position.x, position.y, position.z, vx, vy, vz, sizeScale, intensity);
  }

  /**
   * Kugelförmiger Stoß: `count` Partikel mit Tempo zwischen speedMin und speedMax; `spawnRadius` streut
   * die Startpunkte, `lift` hebt die Flugrichtungen an (0 = gleichmäßig).
   */
  public sphere(spec: ParticleSpec, center: Vector3, count: number, speedMin: number, speedMax: number, sizeScale = 1, intensity = 1, spawnRadius = 0, lift = 0): void {
    const random = this.random;
    for (let i = 0; i < count; i++) {
      random.unitVector(this.direction);
      this.direction.y += lift;
      this.direction.normalize();
      this.emitAlong(spec, center, speedMin, speedMax, sizeScale, intensity, spawnRadius);
    }
  }

  /** Stoß im Kegel um `axis` (normiert); `spread` 0 = gerade, 1 = etwa Halbkugel. */
  public cone(spec: ParticleSpec, center: Vector3, count: number, axis: Vector3, spread: number, speedMin: number, speedMax: number, sizeScale = 1, intensity = 1): void {
    const random = this.random;
    for (let i = 0; i < count; i++) {
      random.unitVector(this.jitter);
      this.direction.set(axis.x + this.jitter.x * spread, axis.y + this.jitter.y * spread, axis.z + this.jitter.z * spread);
      if (this.direction.lengthSquared() < 1e-6) {
        this.direction.copyFrom(this.jitter);
      }
      this.direction.normalize();
      this.emitAlong(spec, center, speedMin, speedMax, sizeScale, intensity, 0);
    }
  }

  private emitAlong(spec: ParticleSpec, center: Vector3, speedMin: number, speedMax: number, sizeScale: number, intensity: number, spawnRadius: number): void {
    const random = this.random;
    const speed = random.range(speedMin, speedMax);
    this.spawn.copyFrom(center);
    if (spawnRadius > 0) {
      random.unitVector(this.jitter);
      const distance = spawnRadius * random.next();
      this.spawn.x += this.jitter.x * distance;
      this.spawn.y += this.jitter.y * distance;
      this.spawn.z += this.jitter.z * distance;
    }
    const d = this.direction;
    this.pool.emit(spec, this.spawn.x, this.spawn.y, this.spawn.z, d.x * speed, d.y * speed, d.z * speed, sizeScale, intensity);
  }
}
