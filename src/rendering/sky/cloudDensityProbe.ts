import type { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { CloudDensityField } from "./cloudDensityField";
import { saturate } from "./skyMath";

/** Abtastungen der Dichte je Sekunde. */
const SamplesPerSecond = 15;
/** Zeitkonstanten der Glättung: Eintauchen schnell, Auftauchen etwas langsamer (Skill babylon-sky, flight-feel.md). */
const RiseSeconds = 0.15;
const FallSeconds = 0.3;

/**
 * Wolkendichte an der Kamera (Dichtesonde): tastet das CPU-Dichtefeld mehrmals je Sekunde an der Kamera ab und
 * glättet den Wert für Belichtung, Farbsättigung, Lichtstrahlen und Ton beim Flug durch Wolken.
 */
export class CloudDensityProbe {
  private readonly field: CloudDensityField;
  private untilNextSample = 0;
  private target = 0;
  private smoothed = 0;

  public constructor(field: CloudDensityField) {
    this.field = field;
  }

  /** Geglättete Dichte 0..1 (0 = klare Luft, 1 = Wolkenkern). */
  public get density(): number {
    return this.smoothed;
  }

  /** Rückt die Sonde um `dt` Sekunden vor; bei `dt` = 0 (Pause) bleibt der Wert stehen. */
  public update(dt: number, cameraPosition: Vector3): void {
    if (dt <= 0 || !this.field.isReady) {
      return;
    }
    this.untilNextSample -= dt;
    if (this.untilNextSample <= 0) {
      this.untilNextSample += 1 / SamplesPerSecond;
      if (this.untilNextSample <= 0) {
        this.untilNextSample = 1 / SamplesPerSecond;
      }
      this.target = saturate(this.field.density(cameraPosition.x, cameraPosition.y, cameraPosition.z));
    }
    const timeConstant = this.target > this.smoothed ? RiseSeconds : FallSeconds;
    this.smoothed += (this.target - this.smoothed) * (1 - Math.exp(-dt / timeConstant));
  }
}
