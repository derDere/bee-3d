import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { FixedStepSystem } from "../../core/gameLoop";
import type { VirtualInput } from "../../debug/debugTypes";
import type { EntityRef, FlightCommand } from "../../hud/hudTypes";
import type { CameraRig } from "../cameraRig";
import type { ScreenProjector } from "../screenProjector";
import type { QDial } from "./qDial";

/** Befehle, die eine Taste mit Klick auf ein Objekt auslöst (Befehlstaste). */
export type CommandKey = Exclude<FlightCommand, "stop">;

const CommandKeys: Readonly<Record<string, CommandKey>> = {
  KeyQ: "approach",
  KeyW: "orbit",
  KeyE: "keepRange",
  KeyA: "align",
  KeyS: "warp",
  KeyD: "dock",
};

const ModuleKeys: Readonly<Record<string, number>> = { F1: 0, F2: 1, F3: 2, F4: 3, F5: 4, F6: 5, F7: 6, F8: 7 };
const DragThreshold = 5;
const DoubleTapMs = 320;

/** Virtuelle Sticks der Touch-Bedienung (Touch-Sticks). */
export interface TouchSource {
  moveAxis(): [number, number];
  aimAxis(): [number, number];
  aimActive(): boolean;
}

/** Spielaktionen, die die Eingabe auslöst (Eingabeaktionen). */
export interface InputActions {
  /** Objekt nahe einem Bildschirmpunkt (Klammer-Trefferfläche) oder undefined. */
  objectAt(x: number, y: number): EntityRef | undefined;
  hasSelection(): boolean;
  select(ref: EntityRef | undefined): void;
  lock(ref: EntityRef): void;
  unlock(ref: EntityRef): void;
  /** Flugbefehl auf ein Objekt; ohne Objekt auf die Auswahl. */
  command(command: FlightCommand, ref?: EntityRef): void;
  flyDirection(direction: Vector3): void;
  toggleModule(slot: number): void;
  changeThrottle(delta: number): void;
  /** Aktuelles Tempo als Anteil 0..1. */
  throttle(): number;
  steer(yaw: number, pitch: number): void;
  buzz(): void;
  cycleTarget(): void;
  toggleHelp(): void;
  /** Kontextmenü an einem Bildschirmpunkt für ein Objekt oder den Raum in Blickrichtung. */
  contextMenu(x: number, y: number, ref: EntityRef | undefined, direction: Vector3): void;
  /** Freies Zielen der Laseraugen (Alt + Maus, rechter Touch-Stick). */
  freeAim(active: boolean, direction: Vector3): void;
}

interface TouchPointer {
  x: number;
  y: number;
}

/**
 * Maus-, Tastatur- und Touch-Eingabe nach EVE-Vorbild (Eingabe): Taste halten + Objekt anklicken erteilt
 * Befehle, ohne Klick gelten sie für die Auswahl; Ziehen dreht die Kamera, Doppelklick fliegt in eine
 * Richtung, Alt + Maustaste zielt mit den Laseraugen. Pfeiltasten steuern im Handflug.
 */
export class InputController implements FixedStepSystem {
  private readonly canvas: HTMLCanvasElement;
  private readonly cameraRig: CameraRig;
  private readonly projector: ScreenProjector;
  private readonly dial: QDial;
  private readonly actions: InputActions;
  private touch: TouchSource | undefined;
  private readonly keys = new Set<string>();
  private heldCommandKey: string | undefined;
  private heldCommandUsed = false;
  private pointerDown: { x: number; y: number; id: number; dragged: boolean } | undefined;
  private aiming = false;
  private readonly touches = new Map<number, TouchPointer>();
  private pinchDistance = 0;
  private lastTapMs = 0;
  private typing = false;
  private invertY = false;
  private touchAiming = false;
  private virtual: VirtualInput | undefined;
  private readonly direction = new Vector3();
  private readonly cameraForward = new Vector3();
  private readonly cameraRight = new Vector3();
  private readonly cameraUp = new Vector3();
  private readonly listeners: Array<() => void> = [];

  public constructor(canvas: HTMLCanvasElement, cameraRig: CameraRig, projector: ScreenProjector, dial: QDial, actions: InputActions) {
    this.canvas = canvas;
    this.cameraRig = cameraRig;
    this.projector = projector;
    this.dial = dial;
    this.actions = actions;
    // Capture: Esc schließt die Wählscheibe, bevor das HUD sein Menü umschaltet
    this.listen(window, "keydown", (event) => this.onKeyDown(event as KeyboardEvent), { capture: true });
    this.listen(window, "keyup", (event) => this.onKeyUp(event as KeyboardEvent));
    this.listen(window, "blur", () => this.releaseAll());
    this.listen(canvas, "pointerdown", (event) => this.onPointerDown(event as PointerEvent));
    this.listen(window, "pointermove", (event) => this.onPointerMove(event as PointerEvent));
    this.listen(window, "pointerup", (event) => this.onPointerUp(event as PointerEvent));
    this.listen(window, "pointercancel", (event) => this.onPointerUp(event as PointerEvent));
    this.listen(canvas, "dblclick", (event) => this.onDoubleClick(event as MouseEvent));
    this.listen(canvas, "contextmenu", (event) => this.onContextMenu(event as MouseEvent));
    this.listen(canvas, "wheel", (event) => this.onWheel(event as WheelEvent), { passive: false });
    canvas.style.touchAction = "none";
  }

  /** Verbindet die virtuellen Sticks des HUD. */
  public setTouchSource(touch: TouchSource): void {
    this.touch = touch;
  }

  /** Die Oberfläche beansprucht die Tastatur (Texteingabe). */
  public setTyping(typing: boolean): void {
    this.typing = typing;
    if (typing) {
      this.releaseAll();
    }
  }

  public setInvertY(invert: boolean): void {
    this.invertY = invert;
  }

  /** Virtuelle Eingabe der Debug-API: `yaw`, `pitch` (−1..1) und `throttle` (0..1) für die nächsten Schritte. */
  public setVirtualInput(input: VirtualInput | undefined): void {
    this.virtual = input;
  }

  /**
   * Befehlstaste, die gerade gehalten wird; ein Klick auf ein Objekt in der Oberfläche verbraucht sie
   * (Overview, Klammern).
   */
  public consumeHeldCommand(): CommandKey | undefined {
    if (this.heldCommandKey === undefined) {
      return undefined;
    }
    this.heldCommandUsed = true;
    return CommandKeys[this.heldCommandKey];
  }

  /** Umschalt gehalten (Strg + Umschalt + Klick löst ein Ziel). */
  public get shiftHeld(): boolean {
    return this.keys.has("ShiftLeft") || this.keys.has("ShiftRight");
  }

  /** Je Logikschritt: Handflug mit Pfeiltasten bzw. linkem Stick, Zielen mit dem rechten Stick. */
  public fixedUpdate(): void {
    let yaw = (this.keys.has("ArrowRight") ? 1 : 0) - (this.keys.has("ArrowLeft") ? 1 : 0);
    let pitch = (this.keys.has("ArrowUp") ? 1 : 0) - (this.keys.has("ArrowDown") ? 1 : 0);
    if (this.keys.has("KeyR")) {
      this.actions.changeThrottle(0.012);
    }
    if (this.keys.has("KeyF")) {
      this.actions.changeThrottle(-0.012);
    }
    const virtual = this.virtual;
    if (virtual !== undefined) {
      yaw += virtual["yaw"] ?? 0;
      pitch += virtual["pitch"] ?? 0;
      const throttle = virtual["throttle"];
      if (throttle !== undefined) {
        this.actions.changeThrottle(throttle - this.throttleOf());
      }
    }
    const touch = this.touch;
    if (touch !== undefined) {
      const [mx, my] = touch.moveAxis();
      if (Math.hypot(mx, my) > 0.12) {
        yaw = mx;
        pitch = -my;
      }
      const aimActive = touch.aimActive();
      if (aimActive) {
        const [ax, ay] = touch.aimAxis();
        this.cameraBasis();
        this.direction.copyFrom(this.cameraForward).addInPlace(this.cameraRight.scale(ax * 0.7)).addInPlace(this.cameraUp.scale(-ay * 0.7)).normalize();
        this.actions.freeAim(true, this.direction);
      } else if (this.touchAiming) {
        this.actions.freeAim(false, this.direction);
      }
      this.touchAiming = aimActive;
    }
    this.actions.steer(yaw, pitch);
  }

  public dispose(): void {
    for (const remove of this.listeners) {
      remove();
    }
    this.listeners.length = 0;
  }

  // ---------- Tastatur ----------

  private onKeyDown(event: KeyboardEvent): void {
    if (this.typing || isTextInput(event.target)) {
      return;
    }
    const code = event.code;
    if (code === "Escape") {
      if (this.dial.isOpen) {
        this.dial.close();
        event.preventDefault(); // das HUD lässt verbrauchte Esc-Tasten in Ruhe
      }
      return;
    }
    const module = ModuleKeys[code];
    if (module !== undefined) {
      event.preventDefault();
      if (!event.repeat) {
        this.actions.toggleModule(module);
      }
      return;
    }
    if (code === "Tab") {
      event.preventDefault();
      if (!event.repeat) {
        this.actions.cycleTarget();
      }
      return;
    }
    if (event.repeat) {
      return;
    }
    this.keys.add(code);
    if (code === "Space" && event.ctrlKey) {
      event.preventDefault();
      this.actions.command("stop");
      return;
    }
    if (CommandKeys[code] !== undefined && !event.ctrlKey && !event.altKey && !event.metaKey) {
      this.heldCommandKey = code;
      this.heldCommandUsed = false;
      return;
    }
    switch (code) {
      case "KeyB":
        this.actions.buzz();
        break;
      case "KeyH":
        this.actions.toggleHelp();
        break;
      case "AltLeft":
      case "AltRight":
        event.preventDefault(); // kein Browsermenü
        break;
      default:
        break;
    }
  }

  private onKeyUp(event: KeyboardEvent): void {
    const code = event.code;
    this.keys.delete(code);
    if (code === "AltLeft" || code === "AltRight") {
      this.stopAim();
    }
    if (code !== this.heldCommandKey) {
      return;
    }
    const command = CommandKeys[code];
    const used = this.heldCommandUsed;
    this.heldCommandKey = undefined;
    if (used || command === undefined || this.typing) {
      return;
    }
    // Ohne Klick gilt der Befehl für die Auswahl; Q ohne Auswahl öffnet die Wählscheibe
    if (this.actions.hasSelection()) {
      this.actions.command(command);
    } else if (command === "approach") {
      this.dial.open();
    }
  }

  private releaseAll(): void {
    this.keys.clear();
    this.heldCommandKey = undefined;
    this.stopAim();
  }

  // ---------- Maus und Touch ----------

  private onPointerDown(event: PointerEvent): void {
    if (event.pointerType === "touch") {
      this.touches.set(event.pointerId, { x: event.offsetX, y: event.offsetY });
      this.pinchDistance = this.touchSpread();
      if (this.touches.size === 1) {
        this.pointerDown = { x: event.offsetX, y: event.offsetY, id: event.pointerId, dragged: false };
      }
      return;
    }
    if (event.button !== 0) {
      return;
    }
    this.canvas.focus();
    if (this.dial.isOpen) {
      this.dial.click(event.offsetX, event.offsetY);
      return;
    }
    if (event.altKey) {
      this.aiming = true;
      this.updateAim(event.offsetX, event.offsetY);
      return;
    }
    this.pointerDown = { x: event.offsetX, y: event.offsetY, id: event.pointerId, dragged: false };
  }

  private onPointerMove(event: PointerEvent): void {
    const { x, y } = this.localPoint(event);
    if (event.pointerType === "touch") {
      this.onTouchMove(event.pointerId, x, y);
      return;
    }
    if (this.dial.isOpen) {
      this.dial.pointerMove(x, y);
    }
    if (this.aiming) {
      this.updateAim(x, y);
      return;
    }
    const down = this.pointerDown;
    if (down === undefined || down.id !== event.pointerId) {
      return;
    }
    if (!down.dragged && Math.hypot(x - down.x, y - down.y) > DragThreshold) {
      down.dragged = true;
    }
    if (down.dragged) {
      this.cameraRig.rotate(event.movementX, this.invertY ? -event.movementY : event.movementY);
    }
  }

  private onPointerUp(event: PointerEvent): void {
    if (event.pointerType === "touch") {
      this.onTouchEnd(event);
      return;
    }
    if (this.aiming && event.button === 0) {
      this.stopAim();
      return;
    }
    const down = this.pointerDown;
    this.pointerDown = undefined;
    if (down === undefined || down.id !== event.pointerId || down.dragged || event.target !== this.canvas) {
      return;
    }
    this.clickAt(event.offsetX, event.offsetY, event.ctrlKey || event.metaKey, event.shiftKey);
  }

  private clickAt(x: number, y: number, ctrl: boolean, shift: boolean): void {
    const ref = this.actions.objectAt(x, y);
    if (ref === undefined) {
      return; // Klick in den leeren Raum behält die Auswahl (EVE)
    }
    if (ctrl && shift) {
      this.actions.unlock(ref);
      return;
    }
    if (ctrl) {
      this.actions.lock(ref);
      return;
    }
    const command = this.consumeHeldCommand();
    this.actions.select(ref);
    if (command !== undefined) {
      this.actions.command(command, ref);
    }
  }

  private onDoubleClick(event: MouseEvent): void {
    if (this.dial.isOpen || event.altKey) {
      return;
    }
    this.doubleAt(event.offsetX, event.offsetY);
  }

  private doubleAt(x: number, y: number): void {
    const ref = this.actions.objectAt(x, y);
    if (ref !== undefined) {
      this.actions.select(ref);
      this.actions.command("approach", ref);
      return;
    }
    this.actions.flyDirection(this.projector.rayDirection(x, y, this.direction));
  }

  private onContextMenu(event: MouseEvent): void {
    event.preventDefault();
    if (this.dial.isOpen) {
      this.dial.close();
      return;
    }
    const ref = this.actions.objectAt(event.offsetX, event.offsetY);
    this.actions.contextMenu(event.clientX, event.clientY, ref, this.projector.rayDirection(event.offsetX, event.offsetY, this.direction).clone());
  }

  private onWheel(event: WheelEvent): void {
    event.preventDefault();
    const steps = Math.sign(event.deltaY) * Math.min(3, Math.max(1, Math.abs(event.deltaY) / 100));
    this.cameraRig.zoom(steps);
  }

  private onTouchMove(id: number, x: number, y: number): void {
    const pointer = this.touches.get(id);
    if (pointer === undefined) {
      return;
    }
    const dx = x - pointer.x;
    const dy = y - pointer.y;
    pointer.x = x;
    pointer.y = y;
    const down = this.pointerDown;
    if (down !== undefined && Math.hypot(x - down.x, y - down.y) > DragThreshold * 2) {
      down.dragged = true;
    }
    if (this.touches.size >= 2) {
      // Zwei Finger: Ziehen dreht die Kamera, Spreizen zoomt
      this.cameraRig.rotate(dx / this.touches.size, (this.invertY ? -dy : dy) / this.touches.size, 1.4);
      const spread = this.touchSpread();
      if (this.pinchDistance > 0 && spread > 0) {
        this.cameraRig.zoom(Math.log(this.pinchDistance / spread) / Math.log(1.15));
      }
      this.pinchDistance = spread;
    }
  }

  private onTouchEnd(event: PointerEvent): void {
    this.touches.delete(event.pointerId);
    this.pinchDistance = this.touchSpread();
    const down = this.pointerDown;
    if (down === undefined || down.id !== event.pointerId) {
      return;
    }
    this.pointerDown = undefined;
    if (down.dragged || this.touches.size > 0) {
      return;
    }
    const now = performance.now();
    if (now - this.lastTapMs < DoubleTapMs) {
      this.lastTapMs = 0;
      this.doubleAt(down.x, down.y);
      return;
    }
    this.lastTapMs = now;
    this.clickAt(down.x, down.y, false, false);
  }

  private touchSpread(): number {
    const points = [...this.touches.values()];
    const a = points[0];
    const b = points[1];
    return a !== undefined && b !== undefined ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  }

  // ---------- Freies Zielen ----------

  private updateAim(x: number, y: number): void {
    this.actions.freeAim(true, this.projector.rayDirection(x, y, this.direction));
  }

  private stopAim(): void {
    if (!this.aiming) {
      return;
    }
    this.aiming = false;
    this.actions.freeAim(false, this.direction);
  }

  private throttleOf(): number {
    return this.actions.throttle();
  }

  private cameraBasis(): void {
    const camera = this.cameraRig.camera;
    camera.getDirectionToRef(Vector3.Forward(), this.cameraForward);
    camera.getDirectionToRef(Vector3.Right(), this.cameraRight);
    camera.getDirectionToRef(Vector3.Up(), this.cameraUp);
  }

  private localPoint(event: PointerEvent): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  private listen(target: EventTarget, type: string, handler: (event: Event) => void, options?: AddEventListenerOptions): void {
    target.addEventListener(type, handler, options);
    this.listeners.push(() => target.removeEventListener(type, handler, options?.capture === true));
  }
}

function isTextInput(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || (target instanceof HTMLElement && target.isContentEditable);
}
