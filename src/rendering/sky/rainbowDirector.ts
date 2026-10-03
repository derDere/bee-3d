import { hashUnit } from "../../../shared/random";
import { WeatherTransitionSeconds, type WeatherName, type WeatherState } from "../../../shared/weather";
import { smoothstep } from "./skyMath";

/** Wetterlagen mit Regen, nach denen ein Regenbogen erscheinen kann. */
const RainyWeathers: ReadonlySet<WeatherName> = new Set<WeatherName>(["shower", "storm"]);
/** Wahrscheinlichkeit eines Regenbogens nach einem Schauer oder Gewitter, je Wetterabschnitt. */
const RainbowChance = 0.6;
/** Hash-Kanal für das Regenbogen-Glück eines Wetterabschnitts. */
const LuckSalt = 0x7b0b;
/** Standzeit eines Regenbogens nach dem Regen bzw. nach dem Auslösen (s). */
const HoldSeconds = 150;
/** Zeitkonstante des weichen Ein- und Ausblendens (s). */
const FadeSeconds = 6;
/** Sonnenhöhe, über die der Regenbogen über dem Horizont einblendet (Grad). */
const SunFadeStartDeg = 0;
const SunFadeEndDeg = 4;

/**
 * Regenbogen-Regie: Nach einem Schauer oder Gewitter erscheint mit etwas Glück für einige Minuten ein Regenbogen,
 * solange die Sonne über dem Horizont steht. Ob es einen gibt, folgt aus dem Seed des Wetterabschnitts und ist damit
 * für alle Spieler gleich; der Bogen blendet weich ein und aus.
 */
export class RainbowDirector {
  private enabled = true;
  private level = 0;
  private sunFactor = 0;
  /** Sekunden seit dem Ende des Regens; < 0, solange keine Lage nach Regen gilt. */
  private afterRainSeconds = -1;
  private forcedSeconds = 0;

  /** Rückt die Regie um `dt` Sekunden vor (0 = Pause hält den Bogen an). */
  public update(dt: number, state: WeatherState, sunElevationDeg: number): void {
    const afterRain = RainyWeathers.has(state.from) && !RainyWeathers.has(state.to);
    if (!afterRain) {
      this.afterRainSeconds = -1;
    } else if (this.afterRainSeconds < 0) {
      // Erster Frame nach dem Regen: Zeit seit Beginn der Überblendung (beim späten Zuschalten deren Ende)
      this.afterRainSeconds = state.blend * WeatherTransitionSeconds;
    } else {
      this.afterRainSeconds += dt;
    }
    const lucky = afterRain && hashUnit(state.seed, LuckSalt) < RainbowChance;
    // Der Bogen erscheint, während der Regen nachlässt, und steht einige Minuten.
    const afterRainTarget = lucky && this.afterRainSeconds < HoldSeconds ? smoothstep(0.3, 0.9, state.blend) : 0;
    this.forcedSeconds = Math.max(0, this.forcedSeconds - dt);
    const target = this.enabled ? Math.max(afterRainTarget, this.forcedSeconds > 0 ? 1 : 0) : 0;
    this.level += (target - this.level) * (1 - Math.exp(-dt / FadeSeconds));
    this.sunFactor = smoothstep(SunFadeStartDeg, SunFadeEndDeg, sunElevationDeg);
  }

  /** Lässt sofort einen Regenbogen einblenden, der einige Minuten steht (Prüfungen und Vorführung). */
  public trigger(): void {
    this.forcedSeconds = HoldSeconds;
  }

  /** Effektschalter der Debug-API. */
  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /** Wirksame Stärke 0..1 nach Ein- und Ausblenden und Sonnenstand. */
  public get intensity(): number {
    return this.level * this.sunFactor;
  }
}
