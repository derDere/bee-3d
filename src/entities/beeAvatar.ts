import type { InstantiatedEntries } from "@babylonjs/core/assetContainer";
import type { AnimationGroup } from "@babylonjs/core/Animations/animationGroup";
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { MorphTarget } from "@babylonjs/core/Morph/morphTarget";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import { BeeLength } from "../../shared/rules";
import type { BoundVariants, MaterialVariantTable } from "../core/materialVariants";
import type { ModelLibrary } from "../core/modelLibrary";

/** Länge des Bienenmodells vom Kopf bis zur Stachelspitze in Metern (Modellmaß). */
const ModelLength = 0.58;
/** Stachelspitze hinter dem Modellursprung entlang −Z (Modellmaß). */
const ModelStingerTip = 0.38;
/** Modelldatei der Biene relativ zu `public/assets/models/`. */
export const BeeModelFile = "bee.glb";
const LegNodeNames = ["Leg_Front_L", "Leg_Front_R", "Leg_Middle_L", "Leg_Middle_R", "Leg_Hind_L", "Leg_Hind_R"] as const;
/** Seitliches Pendeln um die Flugbahn im Schweben bzw. im Reiseflug (Meter). */
const FlutterHoverSway = 0.03;
const FlutterFlightSway = 0.05;
/** Ab diesem Tempo fliegt die Biene ruhig (Warp, Meter je Sekunde). */
const FlutterMaxSpeed = 40;
/**
 * Render-Gruppe der Bienen: nach dem Wolken-Compositor (Gruppe 0). Flügel und Geist sind durchscheinend und
 * schreiben keine Tiefe; in Gruppe 0 malte der Compositor die Wolken dahinter über sie. Die Tiefe der Gruppe 0
 * bleibt erhalten, Inseln verdecken die Bienen weiterhin.
 */
const BeeRenderingGroup = 1;

/** Sichtbarer Zustand einer Biene (Bienenzustand). */
export interface BeeLook {
  readonly night: boolean;
  readonly laser: boolean;
  readonly ghost: boolean;
}

/**
 * Darstellung einer Biene (Bienenfigur): Modellkopie auf 0,2 m skaliert, Flügelschlag, Materialvarianten
 * (Tag, Nacht mit leuchtenden Ringen, Laser mit rotem Glühen und offenem Mund, Geist durchscheinend cyan),
 * Ankerpunkte für Laseraugen, Beine (Gatling) und Stachel.
 */
export class BeeAvatar {
  public readonly root: TransformNode;
  private readonly entries: InstantiatedEntries;
  /** Zwischenknoten für das Flattern um die Flugbahn (Flatterknoten). */
  private readonly flutter: TransformNode;
  private readonly flutterPhase = Math.random() * Math.PI * 2;
  private readonly wingFlap: AnimationGroup | undefined;
  private readonly eyes: [TransformNode | undefined, TransformNode | undefined];
  private readonly legs: Array<TransformNode | undefined>;
  /** Morph-Ziele „Mund offen“ aller Teile des Mund-Meshes (je glTF-Primitive ein Mesh). */
  private readonly mouth: MorphTarget[];
  private readonly meshes: AbstractMesh[];
  private readonly variants: BoundVariants;
  private mouthOpen = 0;
  private flutterTime = Math.random() * 10;
  private readonly rotation = new Quaternion();
  private readonly scratch = new Vector3();

  private constructor(scene: Scene, entries: InstantiatedEntries, name: string, table: MaterialVariantTable) {
    this.entries = entries;
    this.root = new TransformNode(name, scene);
    this.root.rotationQuaternion = Quaternion.Identity();
    const gltfRoot = entries.rootNodes[0] as TransformNode | undefined;
    if (gltfRoot === undefined) {
      throw new Error("Bee model has no root node.");
    }
    this.flutter = new TransformNode(`${name}Flutter`, scene);
    this.flutter.parent = this.root;
    gltfRoot.parent = this.flutter;
    gltfRoot.scaling.scaleInPlace(BeeLength / ModelLength);
    const nodes = gltfRoot.getChildTransformNodes(false);
    const byName = (suffix: string): TransformNode | undefined => nodes.find((node) => node.name.endsWith(suffix));
    this.eyes = [byName("Eye_L"), byName("Eye_R")];
    this.legs = LegNodeNames.map((leg) => byName(leg));
    const healthBar = byName("HealthBar");
    healthBar?.setEnabled(false);
    this.meshes = gltfRoot.getChildMeshes(false);
    this.mouth = this.meshes
      .filter((mesh) => mesh.name.includes("Mouth_Mesh"))
      .map((mesh) => mesh.morphTargetManager?.getTarget(0))
      .filter((target): target is MorphTarget => target !== undefined && target !== null);
    for (const mesh of this.meshes) {
      mesh.isPickable = false;
      mesh.renderingGroupId = BeeRenderingGroup;
    }
    this.variants = table.bind(this.meshes, name);
    this.wingFlap = entries.animationGroups.find((group) => group.name.endsWith("WingFlap"));
    this.wingFlap?.start(true, 1);
    this.setLook({ night: false, laser: false, ghost: false });
  }

  /** Lädt (einmal) und erzeugt eine Biene. */
  public static async createAsync(scene: Scene, library: ModelLibrary, name: string): Promise<BeeAvatar> {
    await library.load(BeeModelFile);
    const avatar = BeeAvatar.create(scene, library, name);
    if (avatar === undefined) {
      throw new Error("Bee model could not be loaded.");
    }
    return avatar;
  }

  /** Erzeugt eine Biene sofort aus dem bereits geladenen Modell; undefined, solange es fehlt. */
  public static create(scene: Scene, library: ModelLibrary, name: string): BeeAvatar | undefined {
    const table = library.variantTable(BeeModelFile);
    const entries = library.instantiateLoaded(BeeModelFile, name);
    return entries === undefined || table === undefined ? undefined : new BeeAvatar(scene, entries, name, table);
  }

  /** Alle Meshes (für Schatten). */
  public get renderMeshes(): readonly AbstractMesh[] {
    return this.meshes;
  }

  /** Setzt Lage und Ausrichtung: Gier um +Y, Neigung (Nase hoch positiv), Schräglage. */
  public setPose(position: Vector3, yaw: number, pitch: number, bank: number): void {
    this.root.position.copyFrom(position);
    Quaternion.FromEulerAnglesToRef(-pitch, yaw, bank, this.rotation);
    this.root.rotationQuaternion?.copyFrom(this.rotation);
  }

  /** Materialvariante nach Zustand; Geist vor Laser vor Nacht vor Tag. */
  public setLook(look: BeeLook): void {
    this.variants.select(look.ghost ? "Ghost" : look.laser ? "Laser" : look.night ? "Night" : "Day");
    this.mouthOpen = look.laser && !look.ghost ? 1 : 0;
  }

  /** Je Frame: Flügeltempo, Mund und Flattern um die Flugbahn (im Stand weiches Schweben). */
  public update(dt: number, speed: number, hovering: boolean): void {
    if (this.wingFlap !== undefined) {
      this.wingFlap.speedRatio = 0.8 + Math.min(1.2, speed / 12);
    }
    const blend = Math.min(1, dt * 12);
    for (const morph of this.mouth) {
      morph.influence += (this.mouthOpen - morph.influence) * blend;
    }
    this.updateFlutter(dt, speed, hovering);
  }

  /**
   * Flattern (Flugbild einer Biene statt eines gleitenden Raumschiffs): seitliches Pendeln mit passendem Rollen,
   * leichtes Auf und Ab und kleine Gierausschläge um die Flugbahn; im Stand ein weiches Schweben in Achten.
   * Die Kamera folgt der Flugbahn, die Figur bewegt sich sichtbar darum herum.
   */
  private updateFlutter(dt: number, speed: number, hovering: boolean): void {
    this.flutterTime += dt;
    const t = this.flutterTime;
    const phase = this.flutterPhase;
    const calm = speed > FlutterMaxSpeed ? 0 : 1;
    const cruise = hovering ? 0 : Math.min(1, speed / 6);
    const sway = (FlutterHoverSway + (FlutterFlightSway - FlutterHoverSway) * cruise) * calm;
    const side = Math.sin(t * 3.6 + phase) + 0.25 * Math.sin(t * 9.7 + 1.7 * phase);
    this.flutter.position.set(
      side * sway,
      Math.sin(t * 6.1 + 0.6 * phase) * sway * 0.5,
      Math.sin(t * 1.8 + 2.1 * phase) * sway * 0.6 * (1 - cruise),
    );
    this.flutter.rotation.set(
      Math.sin(t * 4.3 + phase) * 0.05 * calm,
      Math.sin(t * 2.2 + 0.4 * phase) * 0.08 * calm,
      -Math.cos(t * 3.6 + phase) * 0.14 * calm,
    );
  }

  /** Weltlage eines Auges (0 = links, 1 = rechts) etwas vor der Pupille. */
  public eyeWorld(index: 0 | 1, result: Vector3): Vector3 {
    const eye = this.eyes[index];
    if (eye === undefined) {
      return result.copyFrom(this.root.position);
    }
    eye.computeWorldMatrix(true);
    result.copyFrom(eye.getAbsolutePosition());
    this.root.getDirectionToRef(Vector3.Forward(), this.scratch);
    return result.addInPlace(this.scratch.scaleInPlace(0.012));
  }

  /** Weltlage eines Beins 0..5 (Gatling-Mündung). */
  public legWorld(index: number, result: Vector3): Vector3 {
    const leg = this.legs[index];
    if (leg === undefined) {
      return result.copyFrom(this.root.position);
    }
    leg.computeWorldMatrix(true);
    return result.copyFrom(leg.getAbsolutePosition());
  }

  /** Weltlage der Stachelspitze. */
  public stingerWorld(result: Vector3): Vector3 {
    this.root.getDirectionToRef(Vector3.Forward(), this.scratch);
    return result.copyFrom(this.root.position).addInPlace(this.scratch.scaleInPlace((-ModelStingerTip * BeeLength) / ModelLength));
  }

  public setVisible(visible: boolean): void {
    this.root.setEnabled(visible);
  }

  public dispose(): void {
    this.entries.dispose();
    this.root.dispose();
  }
}
