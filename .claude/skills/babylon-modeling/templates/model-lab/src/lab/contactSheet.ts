import { Camera } from "@babylonjs/core/Cameras/camera";
import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { Viewport } from "@babylonjs/core/Maths/math.viewport";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";
import type { Scene } from "@babylonjs/core/scene";
import { PERSPECTIVE_FOV, boxCorners, fitCamera } from "./cameraFit";
import type { ModelBounds } from "./modelLoader";
import { Overlay } from "./overlay";
import type { TileLabel } from "./overlay";
import type { PixelRect, ViewMode } from "./types";
import { VIEW_SPECS } from "./views";
import type { ViewSpec } from "./views";

const HEADER_HEIGHT = 24;
const COLUMNS = 3;

export interface FocusOptions {
  point: [number, number, number] | null;
  size: number | null;
  /** Richtung vom Fokuspunkt zur Kamera; null = Standardrichtung der Nahaufnahme. */
  direction: [number, number, number] | null;
}

/** Kontaktbogen: mehrere Kamera-Viewports in einem Bild, mit Beschriftung. */
export class ContactSheet {
  private cameras: FreeCamera[] = [];
  private mode: ViewMode = "sheet";
  private headerText = "";

  private readonly scene: Scene;
  private readonly engine: AbstractEngine;
  private readonly bounds: ModelBounds;
  private readonly focus: FocusOptions;
  private readonly overlay: Overlay;

  constructor(scene: Scene, engine: AbstractEngine, bounds: ModelBounds, focus: FocusOptions, overlay: Overlay) {
    this.scene = scene;
    this.engine = engine;
    this.bounds = bounds;
    this.focus = focus;
    this.overlay = overlay;
    engine.onResizeObservable.add(() => this.rebuild());
  }

  get viewMode(): ViewMode {
    return this.mode;
  }

  /** Text der Kopfzeile (Modellname, Maße, Raster, Backend …). */
  setHeader(text: string): void {
    this.headerText = text;
    this.rebuild();
  }

  setView(mode: ViewMode): void {
    this.mode = mode;
    this.rebuild();
  }

  /** Kachelrechtecke für den aktuellen Modus (Pixel, Ursprung oben links). */
  private computeTiles(): { spec: ViewSpec; rect: PixelRect }[] {
    const width = this.engine.getRenderWidth();
    const height = this.engine.getRenderHeight();
    const areaHeight = height - HEADER_HEIGHT;
    if (this.mode !== "sheet") {
      const spec = VIEW_SPECS.find((candidate) => candidate.id === this.mode);
      return spec ? [{ spec, rect: { x: 0, y: HEADER_HEIGHT, width, height: areaHeight } }] : [];
    }
    const rows = Math.ceil(VIEW_SPECS.length / COLUMNS);
    const tileWidth = Math.floor(width / COLUMNS);
    const tileHeight = Math.floor(areaHeight / rows);
    return VIEW_SPECS.map((spec, index) => ({
      spec,
      rect: {
        x: (index % COLUMNS) * tileWidth,
        y: HEADER_HEIGHT + Math.floor(index / COLUMNS) * tileHeight,
        width: tileWidth,
        height: tileHeight,
      },
    }));
  }

  private rebuild(): void {
    for (const camera of this.cameras) camera.dispose();
    this.cameras = [];
    const width = this.engine.getRenderWidth();
    const height = this.engine.getRenderHeight();
    const labels: TileLabel[] = [];

    for (const { spec, rect } of this.computeTiles()) {
      const camera = this.createCamera(spec, rect);
      camera.viewport = new Viewport(
        rect.x / width,
        (height - rect.y - rect.height) / height,
        rect.width / width,
        rect.height / height,
      );
      this.cameras.push(camera);
      labels.push({ rect, text: this.describeTile(spec, camera) });
    }
    this.scene.activeCameras = this.cameras;
    this.scene.activeCamera = this.cameras[0] ?? null;
    this.overlay.render(this.headerText, labels);
  }

  /** Punkte, auf die eine Ansicht formatfüllend ausgerichtet wird. */
  private framingPoints(spec: ViewSpec): { points: Vector3[]; center: Vector3 } {
    const { min, max, center, size, maxExtent, samplePoints } = this.bounds;
    if (!spec.detail) {
      // Achsansichten passen exakt auf die Box, perspektivische Ansichten eng auf die Geometrie.
      return { points: spec.projection === "orthographic" ? boxCorners(min, max) : samplePoints, center };
    }
    const focusPoint = this.focus.point
      ? new Vector3(...this.focus.point)
      : new Vector3(center.x, min.y + size.y * 0.65, max.z - size.z * 0.2);
    const half = (this.focus.size ?? maxExtent * 0.38) / 2;
    const inside = samplePoints.filter(
      (p) => Math.abs(p.x - focusPoint.x) <= half && Math.abs(p.y - focusPoint.y) <= half && Math.abs(p.z - focusPoint.z) <= half,
    );
    if (inside.length >= 20) return { points: inside, center: focusPoint };
    const halfVector = new Vector3(half, half, half);
    return { points: boxCorners(focusPoint.subtract(halfVector), focusPoint.add(halfVector)), center: focusPoint };
  }

  private createCamera(baseSpec: ViewSpec, rect: PixelRect): FreeCamera {
    const spec = baseSpec.detail && this.focus.direction
      ? { ...baseSpec, direction: new Vector3(...this.focus.direction).normalize() }
      : baseSpec;
    const { points, center } = this.framingPoints(spec);
    const placement = fitCamera(spec, points, center, rect.width / rect.height);
    const camera = new FreeCamera(`lab-cam-${spec.id}`, placement.position, this.scene);
    camera.upVector = placement.up;
    camera.setTarget(placement.target);
    camera.minZ = placement.minZ;
    camera.maxZ = placement.maxZ;
    if (spec.projection === "orthographic") {
      camera.mode = Camera.ORTHOGRAPHIC_CAMERA;
      camera.orthoLeft = -placement.orthoHalfWidth;
      camera.orthoRight = placement.orthoHalfWidth;
      camera.orthoTop = placement.orthoHalfHeight;
      camera.orthoBottom = -placement.orthoHalfHeight;
    } else {
      camera.fov = PERSPECTIVE_FOV;
    }
    camera.metadata = { projectedWidth: placement.projectedWidth, projectedHeight: placement.projectedHeight };
    return camera;
  }

  private describeTile(spec: ViewSpec, camera: FreeCamera): string {
    const meta = camera.metadata as { projectedWidth: number; projectedHeight: number };
    if (spec.projection === "orthographic") {
      return `${spec.label}  ortho  ${meta.projectedWidth.toFixed(3)} x ${meta.projectedHeight.toFixed(3)} m`;
    }
    const degrees = Math.round((PERSPECTIVE_FOV * 180) / Math.PI);
    return `${spec.label}  persp ${degrees}deg`;
  }
}
