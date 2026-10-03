// src/hud/keyboardClaims.ts — sammelt, welche Teile der Oberfläche gerade die Tastatur beanspruchen.

/**
 * Tastaturanspruch der Oberfläche (Tastaturanspruch): Namensfeld und Menü melden sich hier an und ab;
 * das Spiel erfährt über den Rückruf nur die Wechsel zwischen „frei“ und „beansprucht“.
 */
export class KeyboardClaims {
  private readonly claims = new Set<string>();
  private readonly notify: (claimed: boolean) => void;

  public constructor(notify: (claimed: boolean) => void) {
    this.notify = notify;
  }

  /** Ob gerade irgendein Teil die Tastatur beansprucht. */
  public get active(): boolean {
    return this.claims.size > 0;
  }

  public set(reason: string, claimed: boolean): void {
    const before = this.active;
    if (claimed) {
      this.claims.add(reason);
    } else {
      this.claims.delete(reason);
    }
    if (this.active !== before) {
      this.notify(this.active);
    }
  }

  /** Gibt alle Ansprüche frei (beim Entsorgen der Oberfläche). */
  public releaseAll(): void {
    if (this.active) {
      this.claims.clear();
      this.notify(false);
    }
  }
}
