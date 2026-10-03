// Flügelsplitter platzender Fliegen: kleine durchscheinende Splitter, die taumelnd und flatternd fallen.
import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";
import type { EffectRandom } from "../core/effectRandom";
import { createPool, firstInactive } from "../core/pooling";
import { createWingShardMesh } from "../render/effectMeshes";
import { MeshBatch } from "../render/meshBatch";

const MaxShards = 96;
const Gravity = 2.6;
const Drag = 2.2;
const ShrinkTime = 0.35;

/** Ein taumelnder Flügelsplitter (Flügelsplitter). */
class WingShard {
  public active = false;
  private age = 0;
  private life = 2;
  private size = 0.05;
  private angle = 0;
  private spin = 0;
  private flutter = 0;
  private readonly position = new Vector3();
  private readonly velocity = new Vector3();
  private readonly axis = new Vector3(0, 1, 0);

  public start(position: Vector3, velocity: Vector3, size: number, life: number, random: EffectRandom): void {
    this.active = true;
    this.age = 0;
    this.life = life;
    this.size = size;
    this.position.copyFrom(position);
    this.velocity.copyFrom(velocity);
    random.unitVector(this.axis);
    this.angle = random.next() * Math.PI * 2;
    this.spin = random.range(4, 12) * (random.next() < 0.5 ? -1 : 1);
    this.flutter = random.next() * Math.PI * 2;
  }

  public update(dt: number, batch: MeshBatch, rotation: Matrix): void {
    this.age += dt;
    if (this.age >= this.life) {
      this.active = false;
      return;
    }
    const damping = 1 / (1 + Drag * dt);
    this.velocity.scaleInPlace(damping);
    this.velocity.y -= Gravity * dt;
    // Flattern: seitliches Pendeln beim Fallen
    const sway = Math.sin(this.age * 7 + this.flutter) * 0.35 * dt;
    this.position.addInPlaceFromFloats(this.velocity.x * dt + sway, this.velocity.y * dt, this.velocity.z * dt - sway);
    this.angle += this.spin * dt;
    const remaining = this.life - this.age;
    const scale = this.size * (remaining < ShrinkTime ? remaining / ShrinkTime : 1);
    Matrix.RotationAxisToRef(this.axis, this.angle, rotation);
    const m = rotation.m;
    batch.push(
      this.position.x,
      this.position.y,
      this.position.z,
      m[0] * scale,
      m[1] * scale,
      m[2] * scale,
      m[4] * scale,
      m[5] * scale,
      m[6] * scale,
      m[8] * scale,
      m[9] * scale,
      m[10] * scale,
    );
  }
}

/** Alle Flügelsplitter samt Mesh-Stapel (Flügelsplitter). */
export class WingFragments {
  private readonly batch: MeshBatch;
  private readonly shards: WingShard[];
  private readonly rotation = new Matrix();

  public constructor(scene: Scene, renderingGroupId: number, alphaIndex: number) {
    const mesh = createWingShardMesh(scene);
    mesh.renderingGroupId = renderingGroupId;
    mesh.alphaIndex = alphaIndex;
    this.batch = new MeshBatch(mesh, MaxShards);
    this.shards = createPool(MaxShards, () => new WingShard());
  }

  /** Mesh-Stapel (für Kennzahlen). */
  public get meshBatch(): MeshBatch {
    return this.batch;
  }

  /** Startet einen Splitter; ohne freien Platz entfällt er. */
  public spawn(position: Vector3, velocity: Vector3, size: number, life: number, random: EffectRandom): void {
    firstInactive(this.shards)?.start(position, velocity, size, life, random);
  }

  public update(dt: number): void {
    this.batch.begin();
    for (const shard of this.shards) {
      if (shard.active) {
        shard.update(dt, this.batch, this.rotation);
      }
    }
    this.batch.end();
  }

  public clear(): void {
    for (const shard of this.shards) {
      shard.active = false;
    }
  }

  public dispose(): void {
    this.clear();
    this.batch.dispose();
  }
}
