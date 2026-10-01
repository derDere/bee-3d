# Input und Kamera

## Tastatur

```ts
import { KeyboardEventTypes, type KeyboardInfo } from "@babylonjs/core/Events/keyboardEvents";
import type { Observer } from "@babylonjs/core/Misc/observable";
import type { Scene } from "@babylonjs/core/scene";

/** Hält den Tastaturzustand für das Abfragen im Spieltakt (Tastaturzustand). */
export class KeyboardState {
  private readonly scene: Scene;
  private readonly held = new Set<string>();
  private readonly pressed = new Set<string>();
  private readonly observer: Observer<KeyboardInfo>;
  private readonly releaseAll = (): void => this.held.clear();

  public constructor(scene: Scene) {
    this.scene = scene;
    this.observer = scene.onKeyboardObservable.add((info) => {
      // event.code ist layoutunabhängig (KeyW bleibt KeyW auf AZERTY)
      const code = info.event.code;
      if (info.type === KeyboardEventTypes.KEYDOWN) {
        if (!this.held.has(code)) {
          this.pressed.add(code);
        }
        this.held.add(code);
      } else if (info.type === KeyboardEventTypes.KEYUP) {
        this.held.delete(code);
      }
    });
    window.addEventListener("blur", this.releaseAll);
  }

  public isDown(code: string): boolean {
    return this.held.has(code);
  }

  /** true nur im ersten Spieltakt nach dem Drücken. */
  public wasPressed(code: string): boolean {
    return this.pressed.has(code);
  }

  /** Am Ende jedes Spieltakts aufrufen. */
  public endTick(): void {
    this.pressed.clear();
  }

  public dispose(): void {
    this.scene.onKeyboardObservable.remove(this.observer);
    window.removeEventListener("blur", this.releaseAll);
  }
}
```

Die Listener hängen am Canvas; Babylon setzt `tabIndex = 1`, falls er `-1` war. Ein
DOM-Element, das den Fokus übernimmt, unterbricht die Tastatureingabe, bis der Canvas wieder
fokussiert ist (`canvas.focus()`).

## Gamepad

```ts
import { DeviceSourceManager } from "@babylonjs/core/DeviceInput/InputDevices/deviceSourceManager";
import { DeviceType, DualSenseInput, XboxInput } from "@babylonjs/core/DeviceInput/InputDevices/deviceEnums";
import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";

/** Liest Gamepad-Achsen im Spieltakt aus (Gamepad-Zustand). */
export class GamepadState {
  private readonly devices: DeviceSourceManager;
  private readonly deadZone: number;

  public constructor(engine: AbstractEngine, deadZone = 0.15) {
    this.devices = new DeviceSourceManager(engine);
    this.deadZone = deadZone;
  }

  /** Linker Stick als [x, y] im Bereich -1..1; y ist nach oben negativ (Gamepad-API-Konvention). */
  public leftStick(): [number, number] {
    const xbox = this.devices.getDeviceSource(DeviceType.Xbox);
    if (xbox) {
      return [this.filter(xbox.getInput(XboxInput.LStickXAxis)), this.filter(xbox.getInput(XboxInput.LStickYAxis))];
    }
    const dualSense = this.devices.getDeviceSource(DeviceType.DualSense);
    if (dualSense) {
      return [this.filter(dualSense.getInput(DualSenseInput.LStickXAxis)), this.filter(dualSense.getInput(DualSenseInput.LStickYAxis))];
    }
    return [0, 0];
  }

  private filter(value: number): number {
    return Math.abs(value) < this.deadZone ? 0 : value;
  }

  public dispose(): void {
    this.devices.dispose();
  }
}
```

`DeviceType`: `Generic`, `Keyboard`, `Mouse`, `Touch`, `DualShock`, `Xbox`, `Switch`,
`DualSense`. `onDeviceConnectedObservable` feuert auch für bereits verbundene Geräte.

## Maus mit Pointer Lock

```ts
import { PointerEventTypes, type PointerInfo } from "@babylonjs/core/Events/pointerEvents";
import type { Observer } from "@babylonjs/core/Misc/observable";
import type { Scene } from "@babylonjs/core/scene";

/** Sammelt Mausbewegung unter Pointer Lock für die Blicksteuerung (Maussteuerung). */
export class MouseLook {
  private readonly scene: Scene;
  private readonly canvas: HTMLCanvasElement;
  private readonly observer: Observer<PointerInfo>;
  private deltaX = 0;
  private deltaY = 0;
  private readonly requestLock = (): void => {
    void this.canvas.requestPointerLock();
  };

  public constructor(scene: Scene) {
    this.scene = scene;
    const canvas = scene.getEngine().getRenderingCanvas();
    if (!canvas) {
      throw new Error("MouseLook requires a rendering canvas.");
    }
    this.canvas = canvas;
    scene.skipPointerMovePicking = true; // kein Picking bei jeder Mausbewegung
    canvas.addEventListener("click", this.requestLock);
    this.observer = scene.onPointerObservable.add((info) => {
      if (info.type === PointerEventTypes.POINTERMOVE && document.pointerLockElement === this.canvas) {
        this.deltaX += info.event.movementX;
        this.deltaY += info.event.movementY;
      }
    });
  }

  /** Liefert die seit dem letzten Aufruf aufgelaufene Bewegung in Pixeln und setzt sie zurück. */
  public consume(): [number, number] {
    const result: [number, number] = [this.deltaX, this.deltaY];
    this.deltaX = 0;
    this.deltaY = 0;
    return result;
  }

  public dispose(): void {
    this.scene.onPointerObservable.remove(this.observer);
    this.canvas.removeEventListener("click", this.requestLock);
  }
}
```

`engine.enterPointerlock()` gibt es an `Engine` und `WebGPUEngine`, nicht an `AbstractEngine`;
engine-unabhängig: `RequestPointerlock(element)` / `ExitPointerlock()` aus
`@babylonjs/core/Engines/engine.common`.

## Touch

- Joystick als Babylon-GUI-Steuerelement (Muster im Docs-Playground `#C6V6UY#5`) oder als
  HTML-Element. `VirtualJoystick` (`@babylonjs/core/Misc/virtualJoystick`) legt einen
  Overlay-Canvas über die Szene, der GUI- und Szenenereignisse blockiert.
- Canvas mit CSS `touch-action: none`.

## Aktionsschicht

Die Spiellogik liest ausschließlich Aktionen. Quellen (Tastatur, Gamepad, Touch, virtuell)
liefern Werte −1..1; die Schicht summiert und begrenzt sie. Die Debug-API schreibt in die
virtuelle Quelle (`simulateInput`).

```ts
/** Benannte Spielaktionen; Beispiel für eine Flugsteuerung (Spielaktion). */
export type ActionName = "forward" | "strafe" | "lift" | "yaw" | "pitch" | "boost";

/** Liefert Aktionswerte aus einem Eingabegerät (Eingabequelle). */
export interface InputSource {
  read(action: ActionName): number;
}

/** Bündelt alle Eingabequellen zu Aktionswerten (Eingabeaktionen). */
export class InputActions {
  private readonly sources: InputSource[] = [];
  private readonly virtualValues = new Map<ActionName, number>();
  private virtualStepsLeft = 0;
  private onVirtualDone: (() => void) | null = null;

  public addSource(source: InputSource): void {
    this.sources.push(source);
  }

  /** Aktionswert −1..1 aus allen Quellen. */
  public value(action: ActionName): number {
    let sum = this.virtualStepsLeft > 0 ? (this.virtualValues.get(action) ?? 0) : 0;
    for (const source of this.sources) {
      sum += source.read(action);
    }
    return Math.max(-1, Math.min(1, sum));
  }

  /** Hält virtuelle Werte für eine Anzahl fester Schritte (Debug-API, Tests). */
  public holdVirtual(values: Readonly<Partial<Record<ActionName, number>>>, steps: number): Promise<void> {
    this.virtualValues.clear();
    for (const [action, amount] of Object.entries(values)) {
      this.virtualValues.set(action as ActionName, amount ?? 0);
    }
    this.virtualStepsLeft = steps;
    return new Promise((resolve) => {
      this.onVirtualDone = resolve;
    });
  }

  /** Am Ende jedes festen Schritts aufrufen. */
  public endTick(): void {
    if (this.virtualStepsLeft > 0) {
      this.virtualStepsLeft -= 1;
      if (this.virtualStepsLeft === 0) {
        this.virtualValues.clear();
        this.onVirtualDone?.();
        this.onVirtualDone = null;
      }
    }
  }
}
```

## Verfolgerkamera

```ts
import { TargetCamera } from "@babylonjs/core/Cameras/targetCamera";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { PhysicsRaycastResult } from "@babylonjs/core/Physics/physicsRaycastResult";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { HavokPlugin } from "@babylonjs/core/Physics/v2/Plugins/havokPlugin";
import type { Scene } from "@babylonjs/core/scene";

/** Einstellungen der Verfolgerkamera. */
export interface ChaseCameraSettings {
  distance: number;
  height: number;
  lookAhead: number;
  positionSharpness: number;
  targetSharpness: number;
  obstructionMask: number;
  obstructionMargin: number;
}

/** Weiche Third-Person-Verfolgerkamera mit Hindernisvermeidung (Verfolgerkamera). */
export class ChaseCamera {
  public readonly camera: TargetCamera;
  private readonly subject: TransformNode;
  private readonly physics: HavokPlugin;
  private readonly settings: ChaseCameraSettings;
  private readonly localOffset = new Vector3();
  private readonly desiredPosition = new Vector3();
  private readonly desiredTarget = new Vector3();
  private readonly smoothedTarget = new Vector3();
  private readonly forward = new Vector3();
  private readonly ray = new PhysicsRaycastResult();

  public constructor(scene: Scene, subject: TransformNode, physics: HavokPlugin, settings: ChaseCameraSettings) {
    this.subject = subject;
    this.physics = physics;
    this.settings = settings;
    this.camera = new TargetCamera("chaseCamera", subject.getAbsolutePosition().clone(), scene);
    this.camera.minZ = 0.1;
    this.camera.maxZ = 0; // unendliche Fernebene
    this.smoothedTarget.copyFrom(subject.getAbsolutePosition());
  }

  /** Einmal pro Frame nach der Spielerbewegung aufrufen; dt in Sekunden. */
  public update(dt: number): void {
    const pivot = this.subject.getAbsolutePosition();
    const rotation = this.subject.absoluteRotationQuaternion;

    // Wunschposition: hinter und über dem Subjekt, mit dessen Ausrichtung gedreht
    this.localOffset.set(0, this.settings.height, -this.settings.distance);
    this.localOffset.rotateByQuaternionToRef(rotation, this.desiredPosition);
    this.desiredPosition.addInPlace(pivot);

    // Hindernis zwischen Subjekt und Wunschposition: Kamera vor das Hindernis ziehen
    this.physics.raycast(pivot, this.desiredPosition, this.ray, { collideWith: this.settings.obstructionMask });
    if (this.ray.hasHit) {
      const full = Vector3.Distance(pivot, this.desiredPosition);
      const allowed = Math.max(this.ray.hitDistance - this.settings.obstructionMargin, 0.2);
      Vector3.LerpToRef(pivot, this.desiredPosition, allowed / full, this.desiredPosition);
    }

    // Blickziel leicht vor das Subjekt legen
    this.subject.getDirectionToRef(Vector3.Forward(), this.forward);
    this.desiredTarget.copyFrom(pivot).addInPlace(this.forward.scaleInPlace(this.settings.lookAhead));

    // Bildratenunabhängige exponentielle Glättung
    const positionBlend = 1 - Math.exp(-this.settings.positionSharpness * dt);
    const targetBlend = 1 - Math.exp(-this.settings.targetSharpness * dt);
    Vector3.LerpToRef(this.camera.position, this.desiredPosition, positionBlend, this.camera.position);
    Vector3.LerpToRef(this.smoothedTarget, this.desiredTarget, targetBlend, this.smoothedTarget);
    this.camera.setTarget(this.smoothedTarget);
  }
}
```

Startwerte: `distance` 4, `height` 1,2, `lookAhead` 2, `positionSharpness` 8,
`targetSharpness` 12, `obstructionMargin` 0,3. Für Rotationen
`Quaternion.SlerpToRef(current, goal, 1 - Math.exp(-k * dt), current)`. `Vector3.SmoothToRef`
interpoliert sphärisch um den Ursprung und passt deshalb nicht für Positionen.

## Kamerawahl

| Kamera | Einsatz |
|---|---|
| eigene `TargetCamera` (oben) | Spielkamera, ohne `attachControl` |
| `FollowCamera(name, position, scene, lockedTarget)` | Prototypen; Glättung pro Frame, folgt nur der Gierung, keine Verdeckungsprüfung |
| `ArcRotateCamera` | Menüs, Fotomodus; `checkCollisions` nutzt Babylons Mesh-Kollision (`scene.collisionsEnabled`) |
| `UniversalCamera` | freie Debug-Kamera mit Tastatur, Maus, Touch, Gamepad |

## Tiefenpräzision

- Standard: `minZ` 1, `maxZ` 10000; `maxZ = 0` ergibt eine unendliche Fernebene.
- Außenszene mit Atmosphäre-Addon: `minZ` 0,1, `maxZ` 0. Bei `maxZ = 0` braucht der
  Kaskaden-Schattengenerator ein explizites `shadowMaxZ` (Skill `babylon-graphics`).
- `engine.useReverseDepthBuffer = true` verbessert die Präzision unter WebGPU (Tiefenbereich
  0..1), **lässt aber den Atmosphäre-Himmel schwarz rendern** (der Himmel prüft Tiefe = 1). Nur in
  Szenen ohne Atmosphäre-Addon einsetzen.
- `material.useLogarithmicDepth` nur bei Z-Fighting (kostet einen Tiefen-Schreibvorgang pro
  Fragment, GLSL und WGSL vorhanden).
- Welten deutlich über 10 km: Engine-Option `useLargeWorldRendering` oder Szenen-Option
  `useFloatingOrigin`.
- Zusammenspiel mit Himmel, Atmosphäre und Frame Graph: Skill `babylon-graphics`.
