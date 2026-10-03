// Stapel echter Effekt-Meshes (Stachel, Flügelsplitter) als Thin Instances mit Weltmatrizen:
// ein Draw Call je Stapel, je Frame neu befüllt.
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import "@babylonjs/core/Meshes/thinInstanceMesh";

const Stride = 16;

/** Thin-Instance-Stapel eines Effekt-Meshes (Mesh-Stapel). */
export class MeshBatch {
  public readonly mesh: Mesh;
  public readonly capacity: number;
  private readonly data: Float32Array;
  private written = 0;

  /** Übernimmt das Mesh; dessen Material und Rendering-Gruppe setzt der Aufrufer. */
  public constructor(mesh: Mesh, capacity: number) {
    this.mesh = mesh;
    this.capacity = capacity;
    this.data = new Float32Array(capacity * Stride);
    mesh.doNotSyncBoundingInfo = true;
    mesh.alwaysSelectAsActiveMesh = true;
    mesh.isPickable = false;
    mesh.applyFog = false;
    mesh.thinInstanceSetBuffer("matrix", this.data, Stride, false);
    mesh.thinInstanceCount = 0;
    mesh.isVisible = false;
  }

  /** Anzahl der Instanzen im laufenden Frame. */
  public get count(): number {
    return this.written;
  }

  public begin(): void {
    this.written = 0;
  }

  /**
   * Schreibt eine Instanz aus Position und skalierten Achsen (Zeilen der Babylon-Weltmatrix):
   * x-Achse (rechts), y-Achse (oben), z-Achse (vorne), jeweils mit Länge = Maßstab.
   */
  public push(
    px: number,
    py: number,
    pz: number,
    xx: number,
    xy: number,
    xz: number,
    yx: number,
    yy: number,
    yz: number,
    zx: number,
    zy: number,
    zz: number,
  ): void {
    if (this.written >= this.capacity) {
      return;
    }
    const d = this.data;
    const o = this.written * Stride;
    d[o] = xx;
    d[o + 1] = xy;
    d[o + 2] = xz;
    d[o + 3] = 0;
    d[o + 4] = yx;
    d[o + 5] = yy;
    d[o + 6] = yz;
    d[o + 7] = 0;
    d[o + 8] = zx;
    d[o + 9] = zy;
    d[o + 10] = zz;
    d[o + 11] = 0;
    d[o + 12] = px;
    d[o + 13] = py;
    d[o + 14] = pz;
    d[o + 15] = 1;
    this.written++;
  }

  public end(): void {
    this.mesh.thinInstanceCount = this.written;
    if (this.written > 0) {
      this.mesh.thinInstanceBufferUpdated("matrix");
    }
    this.mesh.isVisible = this.written > 0;
  }

  public dispose(): void {
    this.mesh.dispose(false, true);
  }
}
