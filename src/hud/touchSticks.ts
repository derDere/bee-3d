// src/hud/touchSticks.ts — zwei virtuelle Daumensticks für Touch-Geräte wie im 2D-Vorbild.

import { createElement, setVisible } from "./dom";

/** Anteil des Stickradius, der als Ruhelage zählt (Totzone, wie im 2D-Vorbild). */
const DeadZone = 0.15;

/** Ein virtueller Stick an der Stelle, an der der Daumen aufsetzt (Daumenstick). */
class ThumbStick {
  public pointerId = -1;
  public x = 0;
  public y = 0;
  public magnitude = 0;
  private readonly base: HTMLDivElement;
  private readonly knob: HTMLDivElement;
  private originX = 0;
  private originY = 0;
  private radius = 1;

  public constructor(layer: HTMLElement, className: string) {
    this.base = createElement("div", `touch-stick ${className}`, layer);
    this.base.hidden = true;
    this.knob = createElement("div", "touch-knob", this.base);
  }

  public get held(): boolean {
    return this.pointerId !== -1;
  }

  public begin(pointerId: number, clientX: number, clientY: number, hostLeft: number, hostTop: number): void {
    this.pointerId = pointerId;
    this.originX = clientX;
    this.originY = clientY;
    this.x = 0;
    this.y = 0;
    this.magnitude = 0;
    setVisible(this.base, true);
    this.radius = Math.max(1, this.base.offsetWidth / 2);
    this.base.style.transform = `translate3d(${clientX - hostLeft}px, ${clientY - hostTop}px, 0)`;
    this.knob.style.transform = "translate3d(0, 0, 0)";
  }

  /** Auslenkung −1..1 je Achse; über den Rand hinaus bleibt der Knopf am Rand. */
  public move(clientX: number, clientY: number): void {
    let dx = clientX - this.originX;
    let dy = clientY - this.originY;
    const distance = Math.hypot(dx, dy);
    if (distance > this.radius) {
      dx = (dx / distance) * this.radius;
      dy = (dy / distance) * this.radius;
    }
    this.knob.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
    const magnitude = Math.min(1, distance / this.radius);
    this.magnitude = magnitude;
    if (magnitude < DeadZone) {
      this.x = 0;
      this.y = 0;
    } else {
      this.x = dx / this.radius;
      this.y = dy / this.radius;
    }
  }

  public end(): void {
    this.pointerId = -1;
    this.x = 0;
    this.y = 0;
    this.magnitude = 0;
    setVisible(this.base, false);
  }

  public dispose(): void {
    this.base.remove();
  }
}

/**
 * Zwei virtuelle Sticks (Touch-Sticks): Ein Daumen auf der linken Bildschirmhälfte steuert die
 * Flugrichtung, einer auf der rechten zielt; solange der rechte ausgelenkt ist, feuert das Spiel die
 * Laseraugen. Achsen −1..1, x nach rechts, y nach unten (wie Gamepad-Achsen). Beide Sticks erscheinen
 * nur unter dem Daumen; Berührungen auf Bedienelementen der Oberfläche und Mauseingaben bleiben unberührt.
 */
export class TouchSticks {
  private readonly layer: HTMLElement;
  private readonly controls: HTMLElement;
  private readonly moveStick: ThumbStick;
  private readonly aimStick: ThumbStick;

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (event.pointerType !== "touch" || this.startsOnControl(event.target)) {
      return;
    }
    const host = this.layer.getBoundingClientRect();
    const stick = event.clientX - host.left < host.width / 2 ? this.moveStick : this.aimStick;
    if (!stick.held) {
      stick.begin(event.pointerId, event.clientX, event.clientY, host.left, host.top);
    }
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (event.pointerId === this.moveStick.pointerId) {
      this.moveStick.move(event.clientX, event.clientY);
    } else if (event.pointerId === this.aimStick.pointerId) {
      this.aimStick.move(event.clientX, event.clientY);
    }
  };

  private readonly onPointerEnd = (event: PointerEvent): void => {
    if (event.pointerId === this.moveStick.pointerId) {
      this.moveStick.end();
    } else if (event.pointerId === this.aimStick.pointerId) {
      this.aimStick.end();
    }
  };

  private readonly onBlur = (): void => {
    this.moveStick.end();
    this.aimStick.end();
  };

  /**
   * @param layer Ebene für die Stick-Grafik (ohne Zeigerereignisse).
   * @param controls Wurzel der Oberfläche: Berührungen, die dort auf einem Bedienelement beginnen, starten keinen Stick.
   */
  public constructor(layer: HTMLElement, controls: HTMLElement) {
    this.layer = layer;
    this.controls = controls;
    this.moveStick = new ThumbStick(layer, "touch-move");
    this.aimStick = new ThumbStick(layer, "touch-aim");
    // Erfassungsphase am Fenster: kommt vor jedem Element, das die Weitergabe stoppen könnte
    const options = { capture: true, passive: true } as const;
    window.addEventListener("pointerdown", this.onPointerDown, options);
    window.addEventListener("pointermove", this.onPointerMove, options);
    window.addEventListener("pointerup", this.onPointerEnd, options);
    window.addEventListener("pointercancel", this.onPointerEnd, options);
    window.addEventListener("blur", this.onBlur);
  }

  /** Flugrichtung des linken Sticks, je Achse −1..1 (Ruhelage 0, 0). */
  public moveAxis(): [number, number] {
    return [this.moveStick.x, this.moveStick.y];
  }

  /** Zielrichtung des rechten Sticks, je Achse −1..1. */
  public aimAxis(): [number, number] {
    return [this.aimStick.x, this.aimStick.y];
  }

  /** Ob der rechte Stick gehalten und über die Totzone hinaus ausgelenkt ist (Laser feuern). */
  public aimActive(): boolean {
    return this.aimStick.held && this.aimStick.magnitude >= DeadZone;
  }

  public dispose(): void {
    const options = { capture: true } as const;
    window.removeEventListener("pointerdown", this.onPointerDown, options);
    window.removeEventListener("pointermove", this.onPointerMove, options);
    window.removeEventListener("pointerup", this.onPointerEnd, options);
    window.removeEventListener("pointercancel", this.onPointerEnd, options);
    window.removeEventListener("blur", this.onBlur);
    this.moveStick.dispose();
    this.aimStick.dispose();
  }

  /** Bedienelemente der Oberfläche sind die einzigen Ziele unter der Wurzel, die Zeigerereignisse annehmen. */
  private startsOnControl(target: EventTarget | null): boolean {
    return target instanceof Node && this.controls.contains(target);
  }
}
