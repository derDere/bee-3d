// Darsteller der Effekt-Werkstatt: eine schwebende Biene und kreisende Fliegen (Schmeißfliegen, Brummer,
// Königin). Einfache Kapseln, sobald geladen ersetzt durch die Spielmodelle. Augen, Beine, Hinterleib und
// Maul sind als Positionsquellen abrufbar; tote Figuren liefern undefined.
import type { AssetContainer } from "@babylonjs/core/assetContainer";
import { LoadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreateCapsule } from "@babylonjs/core/Meshes/Builders/capsuleBuilder";
import { CreateSphere } from "@babylonjs/core/Meshes/Builders/sphereBuilder";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Logger } from "@babylonjs/core/Misc/logger";
import type { Scene } from "@babylonjs/core/scene";
import "@babylonjs/core/Animations/animatable";
import type { PositionSource } from "../effectTypes";

const ModelBase = `${import.meta.env.BASE_URL}assets/models/`;
/** Das Bienenmodell ist 0,58 m lang, im Spiel 0,2 m. */
const BeeModelScale = 0.2 / 0.58;

/** Art einer Werkstatt-Fliege (Fliegenart). */
export type LabFlyKind = "blowfly" | "brummer" | "queen";

const FlyLength: Readonly<Record<LabFlyKind, number>> = { blowfly: 0.45, brummer: 0.9, queen: 2.8 };
const FlyModel: Readonly<Record<LabFlyKind, string>> = { blowfly: "fly.glb", brummer: "fly-brummer.glb", queen: "fly-queen.glb" };

/** Kreisbahn einer Figur um den Ursprung (Kreisbahn). */
interface OrbitPath {
  readonly radius: number;
  readonly height: number;
  readonly speed: number;
  readonly phase: number;
  readonly bob: number;
}

/** Gemeinsame Materialien der Platzhalter (Platzhalter-Materialien). */
class DummyMaterials {
  public readonly beeBody: StandardMaterial;
  public readonly beeStripe: StandardMaterial;
  public readonly flyBody: StandardMaterial;
  public readonly flyEye: StandardMaterial;

  public constructor(scene: Scene) {
    this.beeBody = this.create(scene, "fxLabBeeBody", new Color3(0.95, 0.68, 0.08), new Color3(0.08, 0.05, 0));
    this.beeStripe = this.create(scene, "fxLabBeeStripe", new Color3(0.05, 0.04, 0.03), Color3.Black());
    this.flyBody = this.create(scene, "fxLabFlyBody", new Color3(0.07, 0.16, 0.13), new Color3(0.01, 0.02, 0.02));
    this.flyBody.specularColor = new Color3(0.5, 0.6, 0.55);
    this.flyBody.specularPower = 40;
    this.flyEye = this.create(scene, "fxLabFlyEye", new Color3(0.5, 0.05, 0.03), new Color3(0.35, 0.03, 0.01));
  }

  public dispose(): void {
    for (const material of [this.beeBody, this.beeStripe, this.flyBody, this.flyEye]) {
      material.dispose();
    }
  }

  private create(scene: Scene, name: string, diffuse: Color3, emissive: Color3): StandardMaterial {
    const material = new StandardMaterial(name, scene);
    material.diffuseColor = diffuse;
    material.emissiveColor = emissive;
    return material;
  }
}

/** Figur der Werkstatt mit Kreisbahn und Ankerpunkten (Werkstattfigur). */
export class LabCreature {
  public readonly root: TransformNode;
  public readonly length: number;
  /** Mittelpunkt als Positionsquelle; undefined, solange die Figur tot ist. */
  public readonly center: PositionSource;
  private readonly orbit: OrbitPath;
  private readonly dummies: Mesh[] = [];
  private alive = true;
  private respawnTimer = 0;
  private age = 0;
  private castEnabled = true;

  public constructor(scene: Scene, name: string, length: number, orbit: OrbitPath) {
    this.root = new TransformNode(name, scene);
    this.length = length;
    this.orbit = orbit;
    this.center = () => (this.alive && this.castEnabled ? this.root.position : undefined);
    this.update(0);
  }

  /** Ob die Figur lebt und mitspielt. */
  public get isAlive(): boolean {
    return this.alive && this.castEnabled;
  }

  /** Ankerpunkt mit lokalem Versatz (Meter, +z vorne) als Positionsquelle. */
  public point(local: Vector3): PositionSource {
    const world = new Vector3();
    return () => (this.isAlive ? Vector3.TransformCoordinatesToRef(local, this.root.getWorldMatrix(), world) : undefined);
  }

  /** Nimmt einen Platzhalter-Mesh auf (wird durch das Modell ersetzt). */
  public addDummy(mesh: Mesh): void {
    mesh.parent = this.root;
    mesh.isPickable = false;
    this.dummies.push(mesh);
  }

  /** Nimmt die Figur in die Besetzung auf oder heraus. */
  public setCast(enabled: boolean): void {
    this.castEnabled = enabled;
    this.root.setEnabled(enabled && this.alive);
  }

  /** Tötet die Figur; nach `respawnSeconds` erscheint sie wieder. */
  public kill(respawnSeconds: number): void {
    this.alive = false;
    this.respawnTimer = respawnSeconds;
    this.root.setEnabled(false);
  }

  public update(dt: number): void {
    this.age += dt;
    if (!this.alive) {
      this.respawnTimer -= dt;
      if (this.respawnTimer <= 0) {
        this.alive = true;
        this.root.setEnabled(this.castEnabled);
      }
    }
    const orbit = this.orbit;
    const angle = orbit.phase + this.age * orbit.speed;
    const x = Math.cos(angle) * orbit.radius;
    const z = Math.sin(angle) * orbit.radius;
    const y = orbit.height + Math.sin(this.age * 1.3 + orbit.phase * 3) * orbit.bob;
    this.root.position.set(x, y, z);
    // Blick in Flugrichtung (Tangente), schwebende Figuren blicken zur Kamera-Startseite
    this.root.rotation.y = orbit.radius > 0 ? Math.atan2(-Math.sin(angle) * orbit.speed, Math.cos(angle) * orbit.speed) : 0.6 + 0.15 * Math.sin(this.age * 0.4);
    this.root.computeWorldMatrix(true);
  }

  /** Ersetzt die Platzhalter durch eine Kopie des geladenen Modells. */
  public attachModel(container: AssetContainer, scale: number): void {
    const entries = container.instantiateModelsToScene((source) => `${this.root.name}_${source}`, false, { doNotInstantiate: true });
    for (const node of entries.rootNodes) {
      node.parent = this.root;
      if (node instanceof TransformNode) {
        node.scaling.scaleInPlace(scale);
      }
    }
    for (const group of entries.animationGroups) {
      group.play(true);
    }
    for (const dummy of this.dummies) {
      dummy.setEnabled(false);
    }
  }

  /** Entfernt die Figur samt Platzhaltern und Modellkopie. */
  public dispose(): void {
    this.root.dispose(false, false);
    this.dummies.length = 0;
  }
}

/** Biene der Werkstatt mit Augen, Beinen und Hinterleib (Werkstattbiene). */
export class LabBee extends LabCreature {
  public readonly leftEye: PositionSource;
  public readonly rightEye: PositionSource;
  public readonly legs: readonly PositionSource[];
  public readonly abdomen: PositionSource;

  public constructor(scene: Scene, name: string, orbit: OrbitPath, materials: DummyMaterials) {
    super(scene, name, 0.2, orbit);
    this.leftEye = this.point(new Vector3(-0.022, 0.016, 0.058));
    this.rightEye = this.point(new Vector3(0.022, 0.016, 0.058));
    const legs: PositionSource[] = [];
    for (const z of [0.03, 0.005, -0.02]) {
      legs.push(this.point(new Vector3(-0.03, -0.032, z)), this.point(new Vector3(0.03, -0.032, z)));
    }
    this.legs = legs;
    this.abdomen = this.point(new Vector3(0, 0.01, -0.1));
    const body = CreateCapsule(`${name}Body`, { radius: 0.036, height: 0.2, tessellation: 12, subdivisions: 2 }, scene);
    body.rotation.x = Math.PI / 2;
    body.material = materials.beeBody;
    this.addDummy(body);
    for (const z of [-0.035, -0.07]) {
      const stripe = CreateCapsule(`${name}Stripe`, { radius: 0.038, height: 0.08, tessellation: 12 }, scene);
      stripe.scaling.set(1, 0.18, 1);
      stripe.rotation.x = Math.PI / 2;
      stripe.position.z = z;
      stripe.material = materials.beeStripe;
      this.addDummy(stripe);
    }
  }
}

/** Fliege der Werkstatt mit Maul (Werkstattfliege). */
export class LabFly extends LabCreature {
  public readonly kind: LabFlyKind;
  public readonly mouth: PositionSource;

  public constructor(scene: Scene, name: string, kind: LabFlyKind, orbit: OrbitPath, materials: DummyMaterials) {
    const length = FlyLength[kind];
    super(scene, name, length, orbit);
    this.kind = kind;
    this.mouth = this.point(new Vector3(0, -0.04 * length, 0.46 * length));
    const body = CreateCapsule(`${name}Body`, { radius: length * 0.22, height: length, tessellation: 12, subdivisions: 2 }, scene);
    body.rotation.x = Math.PI / 2;
    body.material = materials.flyBody;
    this.addDummy(body);
    for (const side of [-1, 1]) {
      const eye = CreateSphere(`${name}Eye`, { diameter: length * 0.2, segments: 8 }, scene);
      eye.position.set(side * length * 0.11, length * 0.08, length * 0.36);
      eye.material = materials.flyEye;
      this.addDummy(eye);
    }
  }
}

/** Alle Darsteller der Werkstatt (Besetzung). */
export class LabActors {
  public readonly bee: LabBee;
  public readonly flies: readonly LabFly[];
  /** Weitere Bienen und Fliegen, die nur im Großkampf mitspielen. */
  public readonly wingmen: readonly LabBee[];
  public readonly reserveFlies: readonly LabFly[];
  private readonly scene: Scene;
  private readonly materials: DummyMaterials;
  private readonly everyone: readonly LabCreature[];
  private battleCast = false;

  public constructor(scene: Scene) {
    this.scene = scene;
    this.materials = new DummyMaterials(scene);
    this.bee = new LabBee(scene, "fxLabBee", { radius: 0, height: 0, speed: 0, phase: 0, bob: 0.03 }, this.materials);
    this.flies = [
      this.fly("fxLabBlowflyA", "blowfly", 6, 0.6, 0.32, 0.2),
      this.fly("fxLabBlowflyB", "blowfly", 12, -0.8, -0.22, 2.1),
      this.fly("fxLabBlowflyC", "blowfly", 22, 1.5, 0.15, 4.2),
      this.fly("fxLabBrummer", "brummer", 16, 2.2, -0.12, 1.1),
      this.fly("fxLabQueen", "queen", 38, 5, 0.06, 3.3),
    ];
    const reserve: LabFly[] = [];
    for (let i = 0; i < 7; i++) {
      reserve.push(this.fly(`fxLabReserveFly${i}`, "blowfly", 8 + i * 3.2, -1.5 + (i % 3) * 1.4, (i % 2 === 0 ? 1 : -1) * (0.12 + 0.03 * i), i * 0.9));
    }
    this.reserveFlies = reserve;
    const wingmen: LabBee[] = [];
    for (let i = 0; i < 5; i++) {
      wingmen.push(new LabBee(scene, `fxLabWingman${i}`, { radius: 2.5 + i * 1.6, height: -0.6 + (i % 3) * 0.6, speed: 0.25 + 0.05 * i, phase: i * 1.3, bob: 0.08 }, this.materials));
    }
    this.wingmen = wingmen;
    this.everyone = [this.bee, ...this.flies, ...this.reserveFlies, ...this.wingmen];
    this.setBattleCast(false);
  }

  private fly(name: string, kind: LabFlyKind, radius: number, height: number, speed: number, phase: number): LabFly {
    return new LabFly(this.scene, name, kind, { radius, height, speed, phase, bob: 0.25 }, this.materials);
  }

  /** Nimmt die Großkampf-Besetzung hinzu oder heraus. */
  public setBattleCast(enabled: boolean): void {
    this.battleCast = enabled;
    for (const actor of [...this.wingmen, ...this.reserveFlies]) {
      actor.setCast(enabled);
    }
  }

  /** Alle Bienen der aktuellen Besetzung. */
  public allBees(): LabBee[] {
    return this.battleCast ? [this.bee, ...this.wingmen] : [this.bee];
  }

  /** Alle Fliegen der aktuellen Besetzung. */
  public allFlies(): LabFly[] {
    return this.battleCast ? [...this.flies, ...this.reserveFlies] : [...this.flies];
  }

  /** Lädt die Spielmodelle und ersetzt die Platzhalter; Fehler lassen die Platzhalter stehen. */
  public async loadModelsAsync(): Promise<void> {
    const load = (file: string): Promise<AssetContainer | undefined> =>
      LoadAssetContainerAsync(`${ModelBase}${file}`, this.scene).catch((error: unknown) => {
        Logger.Warn(`FX-Lab: Modell ${file} nicht geladen: ${String(error)}`);
        return undefined;
      });
    const [bee, blowfly, brummer, queen] = await Promise.all([load("bee.glb"), load(FlyModel.blowfly), load(FlyModel.brummer), load(FlyModel.queen)]);
    if (bee !== undefined) {
      for (const actor of [this.bee, ...this.wingmen]) {
        actor.attachModel(bee, BeeModelScale);
      }
    }
    const containers: Readonly<Record<LabFlyKind, AssetContainer | undefined>> = { blowfly, brummer, queen };
    for (const fly of [...this.flies, ...this.reserveFlies]) {
      const container = containers[fly.kind];
      if (container !== undefined) {
        fly.attachModel(container, 1);
      }
    }
  }

  public update(dt: number): void {
    for (const actor of this.everyone) {
      actor.update(dt);
    }
  }

  public dispose(): void {
    for (const actor of this.everyone) {
      actor.dispose();
    }
    this.materials.dispose();
  }
}
