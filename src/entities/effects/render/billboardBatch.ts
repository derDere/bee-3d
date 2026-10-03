// Stapel von Effekt-Billboards als Thin Instances eines Grundvierecks: ein Draw Call je Stapel,
// je Frame neu befüllt und nur im belegten Bereich hochgeladen.
import type { Material } from "@babylonjs/core/Materials/material";
import type { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import type { Scene } from "@babylonjs/core/scene";
import "@babylonjs/core/Meshes/thinInstanceMesh";
import type { FxColor } from "../core/effectPalette";

/** Formen des Billboard-Shaders (Billboard-Form). */
export const BillboardShape = {
  /** Weiches Leuchten (Kapsel oder Punkt), Parameter = Schärfe 0,5..16. */
  Glow: 0,
  /** Ring, Parameter = Dicke relativ zum Radius. */
  Ring: 1,
  /** Rauchballen mit Rauschen, Parameter = Zerfaserung 0..1. */
  Puff: 2,
  /** Glänzender Ballen (Kugel-Impostor), Parameter = Eigenleuchten. */
  Blob: 3,
  /** Stern mit vier Strahlen, Parameter = Strahlstärke. */
  Star: 4,
  /** Wellenschale mit hellem Rand, Parameter = Füllung. */
  Shell: 5,
} as const;
export type BillboardShape = (typeof BillboardShape)[keyof typeof BillboardShape];

/** Packt Form, Nahtflags und Zufallswert in den Formcode des Shaders (Formcode). */
export function shapeCode(shape: BillboardShape, seed = 0, jointA = false, jointB = false): number {
  const fraction = seed < 0 ? 0 : seed > 0.999 ? 0.999 : seed;
  return shape + (jointA ? 8 : 0) + (jointB ? 16 : 0) + fraction;
}

/** Einstellungen eines Billboard-Stapels (Stapeloptionen). */
export interface BillboardBatchOptions {
  /** Größte Instanzzahl je Frame; weitere Instanzen werden verworfen. */
  readonly capacity: number;
  /** Additiv (Leuchten) oder deckend gemischt (Materie wie Rauch und Schleim). */
  readonly additive: boolean;
  /** Reihenfolge unter den transparenten Meshes der Rendering-Gruppe. */
  readonly alphaIndex: number;
  readonly renderingGroupId: number;
}

const Stride = 16;
/** Größter packbarer Mindestradius in Pixeln (Rest des Packfelds) und größter Tiefenvorzug in Metern. */
const MaxMinPixels = 63.9;
const MaxDepthPull = 20;

/** Packt Mindestradius (px) und Tiefenvorzug (m, auf cm gerundet) in ein Instanzfeld (siehe Shader). */
export function packPixelsAndPull(minPixels: number, depthPull: number): number {
  const pixels = minPixels < 0 ? 0 : minPixels > MaxMinPixels ? MaxMinPixels : minPixels;
  const pull = depthPull <= 0 ? 0 : depthPull > MaxDepthPull ? MaxDepthPull : depthPull;
  return pixels + 64 * Math.round(pull * 100);
}

/** Stapel von Effekt-Billboards, je Frame neu befüllt (Billboard-Stapel). */
export class BillboardBatch {
  public readonly mesh: Mesh;
  public readonly capacity: number;
  private readonly additive: boolean;
  private readonly data: Float32Array;
  private written = 0;
  private droppedTotal = 0;

  public constructor(name: string, scene: Scene, material: Material, options: BillboardBatchOptions) {
    this.capacity = options.capacity;
    this.additive = options.additive;
    this.data = new Float32Array(options.capacity * Stride);
    this.mesh = new Mesh(name, scene);
    // Grundviereck: x wählt den Endpunkt (0 = A, 1 = B), y die Seite; der Shader spannt es in Pixeln auf.
    const quad = new VertexData();
    quad.positions = [0, -1, 0, 0, 1, 0, 1, -1, 0, 1, 1, 0];
    quad.indices = [0, 2, 1, 1, 2, 3];
    quad.applyToMesh(this.mesh, false);
    this.mesh.material = material;
    this.mesh.doNotSyncBoundingInfo = true;
    this.mesh.alwaysSelectAsActiveMesh = true;
    this.mesh.isPickable = false;
    this.mesh.applyFog = false;
    this.mesh.renderingGroupId = options.renderingGroupId;
    this.mesh.alphaIndex = options.alphaIndex;
    this.mesh.thinInstanceSetBuffer("matrix", this.data, Stride, false);
    this.mesh.thinInstanceCount = 0;
    this.mesh.isVisible = false;
  }

  /** Anzahl der Instanzen im laufenden Frame. */
  public get count(): number {
    return this.written;
  }

  /** Seit dem Start verworfene Instanzen (voller Stapel). */
  public get dropped(): number {
    return this.droppedTotal;
  }

  /** Beginnt einen neuen Frame. */
  public begin(): void {
    this.written = 0;
  }

  /**
   * Schreibt eine Kapsel aus Rohwerten (für heiße Schleifen). Die Farbe wird hier mit `alpha`
   * vormultipliziert; Leuchtstapel schreiben Deckkraft 0 (rein additiv). `depthPull` rückt die Kapsel
   * um so viele Meter zur Kamera (Trefferglühen im Inneren eines Ziels).
   */
  public push(
    ax: number,
    ay: number,
    az: number,
    radiusA: number,
    bx: number,
    by: number,
    bz: number,
    radiusB: number,
    r: number,
    g: number,
    b: number,
    alpha: number,
    code: number,
    param: number,
    fadeA: number,
    minPixels: number,
    depthPull = 0,
  ): void {
    if (this.written >= this.capacity) {
      this.droppedTotal++;
      return;
    }
    if (alpha <= 0.0005) {
      return;
    }
    const d = this.data;
    const o = this.written * Stride;
    d[o] = ax;
    d[o + 1] = ay;
    d[o + 2] = az;
    d[o + 3] = radiusA;
    d[o + 4] = bx;
    d[o + 5] = by;
    d[o + 6] = bz;
    d[o + 7] = radiusB;
    d[o + 8] = r * alpha;
    d[o + 9] = g * alpha;
    d[o + 10] = b * alpha;
    d[o + 11] = this.additive ? 0 : alpha;
    d[o + 12] = code;
    d[o + 13] = param;
    d[o + 14] = fadeA;
    d[o + 15] = depthPull > 0 ? packPixelsAndPull(minPixels, depthPull) : minPixels < MaxMinPixels ? minPixels : MaxMinPixels;
    this.written++;
  }

  /** Schreibt eine Kapsel von A nach B; `alpha` skaliert Intensität bzw. Deckkraft der Farbe. */
  public segment(a: Vector3, radiusA: number, b: Vector3, radiusB: number, color: FxColor, alpha: number, code: number, param: number, fadeA: number, minPixels: number, depthPull = 0): void {
    this.push(a.x, a.y, a.z, radiusA, b.x, b.y, b.z, radiusB, color.r, color.g, color.b, color.a * alpha, code, param, fadeA, minPixels, depthPull);
  }

  /** Schreibt einen Punkt (Kapsel mit A = B). */
  public dot(p: Vector3, radius: number, color: FxColor, alpha: number, code: number, param: number, minPixels: number, depthPull = 0): void {
    this.push(p.x, p.y, p.z, radius, p.x, p.y, p.z, radius, color.r, color.g, color.b, color.a * alpha, code, param, 1, minPixels, depthPull);
  }

  /** Schließt den Frame ab: lädt den belegten Bereich hoch und blendet leere Stapel aus. */
  public end(): void {
    const mesh = this.mesh;
    mesh.thinInstanceCount = this.written;
    if (this.written > 0) {
      mesh.thinInstanceBufferUpdated("matrix");
    }
    mesh.isVisible = this.written > 0;
  }

  public dispose(): void {
    this.mesh.dispose(false, false);
  }
}
