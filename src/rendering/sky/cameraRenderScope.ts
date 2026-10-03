import type { Camera } from "@babylonjs/core/Cameras/camera";
import type { Observer } from "@babylonjs/core/Misc/observable";
import type { Scene } from "@babylonjs/core/scene";

/**
 * Renderphase einer Kamera (Kamera-Renderphase): meldet, ob die Szene gerade für genau diese Kamera rendert.
 * Himmelspässe hängen an Szenen-Ereignissen, die auch für andere Kameras und Render-Targets feuern; sie laufen
 * nur, solange die Phase aktiv ist.
 */
export class CameraRenderScope {
  private active = false;
  private readonly scene: Scene;
  private readonly beforeObserver: Observer<Camera>;
  private readonly afterObserver: Observer<Camera>;

  /** @param onBegin läuft zu Beginn jeder Renderphase der Kamera (z. B. Matrizen aktualisieren). */
  public constructor(scene: Scene, camera: Camera, onBegin?: () => void) {
    this.scene = scene;
    this.beforeObserver = scene.onBeforeCameraRenderObservable.add((rendering) => {
      this.active = rendering === camera;
      if (this.active) {
        onBegin?.();
      }
    });
    this.afterObserver = scene.onAfterCameraRenderObservable.add(() => {
      this.active = false;
    });
  }

  /** Ob die Szene gerade für die Kamera rendert. */
  public get isActive(): boolean {
    return this.active;
  }

  public dispose(): void {
    this.scene.onBeforeCameraRenderObservable.remove(this.beforeObserver);
    this.scene.onAfterCameraRenderObservable.remove(this.afterObserver);
  }
}
