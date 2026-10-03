import { Color3 } from "@babylonjs/core/Maths/math.color";
import { lerpHue } from "./skyMath";

/** Benannte Tagesphase (Tagesphase). */
export type SkyPhase =
  | "night"
  | "blue-dawn"
  | "sunrise"
  | "golden-morning"
  | "morning"
  | "noon"
  | "afternoon"
  | "golden-evening"
  | "sunset"
  | "blue-dusk";

/** Kunstgeleitete Werte eines Farbskript-Schlüssels, Farben linear (Farbskript-Schlüssel). */
export interface SkyKeyframe {
  readonly phase: SkyPhase;
  readonly sunElevationDeg: number;
  readonly exposureEv: number;
  readonly atmosphereExposure: number;
  readonly cloudTint: Color3;
  readonly cloudShadowTint: Color3;
  readonly hazeColor: Color3;
  readonly hazeDensity: number;
  readonly mistAmount: number;
  readonly shaftStrength: number;
  readonly saturation: number;
  readonly highlightsHue: number;
  readonly highlightsDensity: number;
  readonly shadowsHue: number;
  readonly shadowsDensity: number;
  readonly deckOffset: number;
}

function hex(value: string): Color3 {
  return Color3.FromHexString(value).toLinearSpace();
}

// Morgen- und Abendkurve getrennt: gleiche Sonnenhöhe, andere Stimmung (Skill babylon-sky, art-direction.md).
const Morning: readonly SkyKeyframe[] = [
  { phase: "night", sunElevationDeg: -18, exposureEv: 1.7, atmosphereExposure: 0.03, cloudTint: hex("#B4C4E6"), cloudShadowTint: hex("#1E2E66"), hazeColor: hex("#2A3A66"), hazeDensity: 0.0004, mistAmount: 0.35, shaftStrength: 0.45, saturation: 110, highlightsHue: 220, highlightsDensity: 10, shadowsHue: 230, shadowsDensity: 45, deckOffset: 0 },
  { phase: "blue-dawn", sunElevationDeg: -7, exposureEv: 1.8, atmosphereExposure: 0.8, cloudTint: hex("#8C8FB8"), cloudShadowTint: hex("#3A4170"), hazeColor: hex("#6C7BA8"), hazeDensity: 0.0015, mistAmount: 0.8, shaftStrength: 0.2, saturation: 80, highlightsHue: 330, highlightsDensity: 20, shadowsHue: 235, shadowsDensity: 40, deckOffset: 20 },
  { phase: "sunrise", sunElevationDeg: 2, exposureEv: 0.1, atmosphereExposure: 1.0, cloudTint: hex("#FF7650"), cloudShadowTint: hex("#A67FB0"), hazeColor: hex("#EC9585"), hazeDensity: 0.001, mistAmount: 1, shaftStrength: 1, saturation: 145, highlightsHue: 6, highlightsDensity: 55, shadowsHue: 310, shadowsDensity: 40, deckOffset: 30 },
  { phase: "golden-morning", sunElevationDeg: 14, exposureEv: -0.3, atmosphereExposure: 1.0, cloudTint: hex("#FF7A50"), cloudShadowTint: hex("#B07CB4"), hazeColor: hex("#E88A78"), hazeDensity: 0.0008, mistAmount: 0.7, shaftStrength: 1, saturation: 145, highlightsHue: 15, highlightsDensity: 50, shadowsHue: 320, shadowsDensity: 40, deckOffset: 20 },
  { phase: "morning", sunElevationDeg: 32, exposureEv: 0, atmosphereExposure: 1.0, cloudTint: hex("#FCFAF5"), cloudShadowTint: hex("#A9BAD6"), hazeColor: hex("#C9DDF2"), hazeDensity: 0.0009, mistAmount: 0.2, shaftStrength: 0.35, saturation: 104, highlightsHue: 40, highlightsDensity: 12, shadowsHue: 215, shadowsDensity: 18, deckOffset: 0 },
  { phase: "noon", sunElevationDeg: 60, exposureEv: 0.2, atmosphereExposure: 1.0, cloudTint: hex("#FFFFFF"), cloudShadowTint: hex("#9DB0CF"), hazeColor: hex("#BBDDFB"), hazeDensity: 0.0007, mistAmount: 0, shaftStrength: 0.2, saturation: 108, highlightsHue: 40, highlightsDensity: 5, shadowsHue: 215, shadowsDensity: 15, deckOffset: -10 },
];

const Evening: readonly SkyKeyframe[] = [
  { phase: "night", sunElevationDeg: -18, exposureEv: 1.7, atmosphereExposure: 0.03, cloudTint: hex("#B4C4E6"), cloudShadowTint: hex("#1E2E66"), hazeColor: hex("#2A3A66"), hazeDensity: 0.0004, mistAmount: 0.3, shaftStrength: 0.45, saturation: 110, highlightsHue: 220, highlightsDensity: 10, shadowsHue: 230, shadowsDensity: 45, deckOffset: 0 },
  { phase: "blue-dusk", sunElevationDeg: -7, exposureEv: 1.8, atmosphereExposure: 0.8, cloudTint: hex("#6F6C9A"), cloudShadowTint: hex("#2A3157"), hazeColor: hex("#8A6E9E"), hazeDensity: 0.0006, mistAmount: 0.1, shaftStrength: 0.2, saturation: 85, highlightsHue: 300, highlightsDensity: 25, shadowsHue: 240, shadowsDensity: 40, deckOffset: 10 },
  { phase: "sunset", sunElevationDeg: 2, exposureEv: 0.1, atmosphereExposure: 1.0, cloudTint: hex("#FF6A55"), cloudShadowTint: hex("#7A4C8E"), hazeColor: hex("#D98090"), hazeDensity: 0.0008, mistAmount: 0, shaftStrength: 1, saturation: 150, highlightsHue: 4, highlightsDensity: 55, shadowsHue: 300, shadowsDensity: 50, deckOffset: 0 },
  { phase: "golden-evening", sunElevationDeg: 14, exposureEv: 0.3, atmosphereExposure: 1.0, cloudTint: hex("#FFA27A"), cloudShadowTint: hex("#9A6FA8"), hazeColor: hex("#E8A99A"), hazeDensity: 0.0006, mistAmount: 0, shaftStrength: 0.85, saturation: 125, highlightsHue: 28, highlightsDensity: 35, shadowsHue: 285, shadowsDensity: 28, deckOffset: 0 },
  { phase: "afternoon", sunElevationDeg: 32, exposureEv: 0, atmosphereExposure: 1.0, cloudTint: hex("#FFF8EC"), cloudShadowTint: hex("#A2B2CF"), hazeColor: hex("#C6E1F8"), hazeDensity: 0.0008, mistAmount: 0, shaftStrength: 0.3, saturation: 102, highlightsHue: 38, highlightsDensity: 10, shadowsHue: 215, shadowsDensity: 16, deckOffset: -10 },
  { phase: "noon", sunElevationDeg: 60, exposureEv: 0.2, atmosphereExposure: 1.0, cloudTint: hex("#FFFFFF"), cloudShadowTint: hex("#9DB0CF"), hazeColor: hex("#BBDDFB"), hazeDensity: 0.0007, mistAmount: 0, shaftStrength: 0.2, saturation: 108, highlightsHue: 40, highlightsDensity: 5, shadowsHue: 215, shadowsDensity: 15, deckOffset: -10 },
];

/** Abendschlüssel aufsteigend nach Sonnenhöhe. */
const EveningAscending: readonly SkyKeyframe[] = [...Evening].sort((a, b) => a.sunElevationDeg - b.sunElevationDeg);

/** Interpolierter Farbskript-Stand (Phasenwerte). */
export interface SkyLook {
  phase: SkyPhase;
  exposureEv: number;
  atmosphereExposure: number;
  readonly cloudTint: Color3;
  readonly cloudShadowTint: Color3;
  readonly hazeColor: Color3;
  hazeDensity: number;
  mistAmount: number;
  shaftStrength: number;
  saturation: number;
  highlightsHue: number;
  highlightsDensity: number;
  shadowsHue: number;
  shadowsDensity: number;
  deckOffset: number;
}

function smooth(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
}

/** Wertet das Farbskript für Sonnenhöhe und Tageshälfte aus (Farbskript). */
export class SkyKeyframes {
  public readonly look: SkyLook = {
    phase: "noon",
    exposureEv: 0,
    atmosphereExposure: 1,
    cloudTint: new Color3(1, 1, 1),
    cloudShadowTint: new Color3(0.5, 0.6, 0.7),
    hazeColor: new Color3(0.6, 0.7, 0.9),
    hazeDensity: 0.0002,
    mistAmount: 0,
    shaftStrength: 0.1,
    saturation: 100,
    highlightsHue: 0,
    highlightsDensity: 0,
    shadowsHue: 0,
    shadowsDensity: 0,
    deckOffset: 0,
  };

  public evaluate(sunElevationDeg: number, rising: boolean): SkyLook {
    const sorted = rising ? Morning : EveningAscending;
    let lower = sorted[0]!;
    let upper = sorted[sorted.length - 1]!;
    for (let i = 0; i < sorted.length - 1; i++) {
      const a = sorted[i]!;
      const b = sorted[i + 1]!;
      if (sunElevationDeg >= a.sunElevationDeg && sunElevationDeg <= b.sunElevationDeg) {
        lower = a;
        upper = b;
        break;
      }
    }
    if (sunElevationDeg < (sorted[0]?.sunElevationDeg ?? -90)) {
      lower = sorted[0]!;
      upper = sorted[0]!;
    }
    const span = upper.sunElevationDeg - lower.sunElevationDeg;
    const t = span > 0 ? smooth((sunElevationDeg - lower.sunElevationDeg) / span) : 0;
    const look = this.look;
    look.phase = t < 0.5 ? lower.phase : upper.phase;
    look.exposureEv = lower.exposureEv + (upper.exposureEv - lower.exposureEv) * t;
    look.atmosphereExposure = lower.atmosphereExposure + (upper.atmosphereExposure - lower.atmosphereExposure) * t;
    Color3.LerpToRef(lower.cloudTint, upper.cloudTint, t, look.cloudTint);
    Color3.LerpToRef(lower.cloudShadowTint, upper.cloudShadowTint, t, look.cloudShadowTint);
    Color3.LerpToRef(lower.hazeColor, upper.hazeColor, t, look.hazeColor);
    look.hazeDensity = lower.hazeDensity + (upper.hazeDensity - lower.hazeDensity) * t;
    look.mistAmount = lower.mistAmount + (upper.mistAmount - lower.mistAmount) * t;
    look.shaftStrength = lower.shaftStrength + (upper.shaftStrength - lower.shaftStrength) * t;
    look.saturation = lower.saturation + (upper.saturation - lower.saturation) * t;
    look.highlightsHue = lerpHue(lower.highlightsHue, upper.highlightsHue, t);
    look.highlightsDensity = lower.highlightsDensity + (upper.highlightsDensity - lower.highlightsDensity) * t;
    look.shadowsHue = lerpHue(lower.shadowsHue, upper.shadowsHue, t);
    look.shadowsDensity = lower.shadowsDensity + (upper.shadowsDensity - lower.shadowsDensity) * t;
    look.deckOffset = lower.deckOffset + (upper.deckOffset - lower.deckOffset) * t;
    return look;
  }
}
