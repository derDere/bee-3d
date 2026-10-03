import { WorldSeed } from "../../../shared/world";
import { WeatherNames, weatherAt, type WeatherName, type WeatherOverride, type WeatherState } from "../../../shared/weather";

/** Werte einer Wetterlage für alle Himmelssysteme (Wetterwerte). */
export interface WeatherPreset {
  /** Grundbedeckung der Wolkenmassen 0..1. */
  readonly coverage: number;
  readonly stormCoverage: number;
  readonly rain: number;
  readonly wind: number;
  readonly mistFactor: number;
  readonly keyLightFactor: number;
  readonly exposureEv: number;
  readonly saturationDelta: number;
  readonly lightningPerMinute: number;
  readonly shaftFactor: number;
  readonly hazeGray: number;
  /** Faktor auf die Dunstdichte des Farbskripts: klar weit, Regen und Gewitter diesig. */
  readonly hazeFactor: number;
  /** Kühle Blaugrau-Tönung von Licht, Schatten, Dunst und Farbkorrektur (Gewitter: tiefes Indigo). */
  readonly coolTint: number;
}

const Presets: Readonly<Record<WeatherName, WeatherPreset>> = {
  clear: { coverage: 0.28, stormCoverage: 0, rain: 0, wind: 2, mistFactor: 0.5, keyLightFactor: 1, exposureEv: 0, saturationDelta: 0, lightningPerMinute: 0, shaftFactor: 0.8, hazeGray: 0, hazeFactor: 0.8, coolTint: 0 },
  fair: { coverage: 0.27, stormCoverage: 0, rain: 0, wind: 4, mistFactor: 1, keyLightFactor: 1, exposureEv: 0, saturationDelta: 0, lightningPerMinute: 0, shaftFactor: 1, hazeGray: 0, hazeFactor: 1, coolTint: 0 },
  "misty-morning": { coverage: 0.37, stormCoverage: 0, rain: 0, wind: 1, mistFactor: 2, keyLightFactor: 0.9, exposureEv: 0, saturationDelta: 0, lightningPerMinute: 0, shaftFactor: 1.3, hazeGray: 0, hazeFactor: 1.1, coolTint: 0 },
  overcast: { coverage: 0.48, stormCoverage: 0, rain: 0.1, wind: 5, mistFactor: 1.2, keyLightFactor: 0.45, exposureEv: 0.2, saturationDelta: -25, lightningPerMinute: 0, shaftFactor: 0.3, hazeGray: 0.45, hazeFactor: 2, coolTint: 0.25 },
  shower: { coverage: 0.38, stormCoverage: 0.38, rain: 0.7, wind: 6, mistFactor: 1, keyLightFactor: 0.65, exposureEv: 0.2, saturationDelta: -15, lightningPerMinute: 0.5, shaftFactor: 1.5, hazeGray: 0.3, hazeFactor: 2, coolTint: 0.3 },
  storm: { coverage: 0.42, stormCoverage: 0.6, rain: 1, wind: 10, mistFactor: 0.8, keyLightFactor: 0.4, exposureEv: -0.9, saturationDelta: -20, lightningPerMinute: 12, shaftFactor: 0.6, hazeGray: 0.55, hazeFactor: 3, coolTint: 0.65 },
};

type MutablePreset = { -readonly [K in keyof WeatherPreset]: WeatherPreset[K] };

/**
 * Wetterregie (Wetterregie): wertet den gemeinsamen Wetterplan aus, überblendet die Lagen und erlaubt
 * der Debug-API eine lokale Vorgabe. Alle Spieler sehen dieselbe Lage, solange keine lokale Vorgabe gilt.
 */
export class WeatherDirector {
  public readonly blended: MutablePreset = { ...Presets.fair };
  public state: WeatherState = { from: "fair", to: "fair", blend: 1, seed: 0 };
  private serverOverride: WeatherOverride | undefined;
  private localOverride: { readonly weather: WeatherName; readonly startSeconds: number; readonly blendSeconds: number; readonly from: WeatherName } | undefined;

  /** Betreiber-Vorgabe aus der Tabelle world_weather (oder undefined = Wetterplan). */
  public setServerOverride(override: WeatherOverride | undefined): void {
    this.serverOverride = override;
  }

  /** Lokale Vorgabe für Prüfungen (Debug-API); "auto" hebt sie auf. */
  public setLocal(name: string, blendSeconds: number, worldSeconds: number): void {
    if (name === "auto") {
      this.localOverride = undefined;
      return;
    }
    if (!(WeatherNames as readonly string[]).includes(name)) {
      throw new Error(`Unbekannte Wetterlage: ${name}`);
    }
    this.localOverride = { weather: name as WeatherName, startSeconds: worldSeconds, blendSeconds: Math.max(0, blendSeconds), from: this.state.to };
  }

  public get names(): readonly string[] {
    return WeatherNames;
  }

  /** Berechnet Lage und überblendete Werte zur Weltzeit. */
  public update(worldSeconds: number): void {
    const local = this.localOverride;
    if (local !== undefined) {
      const t = local.blendSeconds > 0 ? Math.min(1, (worldSeconds - local.startSeconds) / local.blendSeconds) : 1;
      this.state = { from: local.from, to: local.weather, blend: Math.max(0, t), seed: WorldSeed ^ 0x51 };
    } else {
      this.state = weatherAt(WorldSeed, worldSeconds, this.serverOverride);
    }
    const from = Presets[this.state.from];
    const to = Presets[this.state.to];
    const t = this.state.blend * this.state.blend * (3 - 2 * this.state.blend);
    for (const key of Object.keys(from) as Array<keyof WeatherPreset>) {
      this.blended[key] = from[key] + (to[key] - from[key]) * t;
    }
  }

  /** Name der Lage, bei Übergang "von>nach". */
  public get label(): string {
    return this.state.blend >= 1 || this.state.from === this.state.to ? this.state.to : `${this.state.from}>${this.state.to}`;
  }
}
