/** Qualitätsstufe der Darstellung (Qualitätsstufe). */
export type QualityTier = "low" | "medium" | "high" | "ultra";

export const QualityTiers: readonly QualityTier[] = ["low", "medium", "high", "ultra"];

/** Einstellungen einer Qualitätsstufe für alle Darstellungssysteme (Stufenwerte). */
export interface QualitySettings {
  readonly tier: QualityTier;
  readonly hardwareScaling: number;
  readonly shadowMapSize: number;
  readonly shadowCascades: number;
  readonly msaaSamples: number;
  readonly fxaa: boolean;
  readonly bloom: boolean;
  /** Teiler der Wolken-Rendergröße gegenüber dem Bild (2 = halbe Auflösung). */
  readonly cloudDownscale: number;
  readonly cloudSteps: number;
  readonly cloudLightSamples: number;
  readonly cloudTemporal: boolean;
  readonly shaftSamples: number;
  readonly floraDensity: number;
  readonly rainDrops: number;
  /** Sichtweite der LOD0-Inseln in Metern. */
  readonly islandDetailRange: number;
  /** Höchstzahl gleichzeitig vollständig dargestellter Inseln. */
  readonly maxDetailedIslands: number;
}

const Tiers: Readonly<Record<QualityTier, QualitySettings>> = {
  low: {
    tier: "low",
    hardwareScaling: 1.5,
    shadowMapSize: 1024,
    shadowCascades: 2,
    msaaSamples: 1,
    fxaa: true,
    bloom: false,
    cloudDownscale: 4,
    cloudSteps: 40,
    cloudLightSamples: 2,
    cloudTemporal: true,
    shaftSamples: 0,
    floraDensity: 0.15,
    rainDrops: 2000,
    islandDetailRange: 160,
    maxDetailedIslands: 3,
  },
  medium: {
    tier: "medium",
    hardwareScaling: 1.25,
    shadowMapSize: 2048,
    shadowCascades: 3,
    msaaSamples: 2,
    fxaa: false,
    bloom: true,
    cloudDownscale: 4,
    cloudSteps: 64,
    cloudLightSamples: 3,
    cloudTemporal: true,
    shaftSamples: 32,
    floraDensity: 0.3,
    rainDrops: 4000,
    islandDetailRange: 220,
    maxDetailedIslands: 4,
  },
  high: {
    tier: "high",
    hardwareScaling: 1,
    shadowMapSize: 2048,
    shadowCascades: 4,
    msaaSamples: 4,
    fxaa: false,
    bloom: true,
    cloudDownscale: 2,
    cloudSteps: 96,
    cloudLightSamples: 5,
    cloudTemporal: true,
    shaftSamples: 64,
    floraDensity: 0.5,
    rainDrops: 8000,
    islandDetailRange: 300,
    maxDetailedIslands: 6,
  },
  ultra: {
    tier: "ultra",
    hardwareScaling: 1,
    shadowMapSize: 4096,
    shadowCascades: 4,
    msaaSamples: 4,
    fxaa: false,
    bloom: true,
    cloudDownscale: 2,
    cloudSteps: 128,
    cloudLightSamples: 6,
    cloudTemporal: true,
    shaftSamples: 64,
    floraDensity: 1,
    rainDrops: 15000,
    islandDetailRange: 420,
    maxDetailedIslands: 9,
  },
};

/** Stufenwerte zu einer Qualitätsstufe. */
export function qualitySettings(tier: QualityTier): QualitySettings {
  return Tiers[tier];
}

/** Ob ein Wert eine gültige Qualitätsstufe ist. */
export function isQualityTier(value: unknown): value is QualityTier {
  return typeof value === "string" && (QualityTiers as readonly string[]).includes(value);
}
