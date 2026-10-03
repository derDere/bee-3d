/**
 * Feste Größen des Wolkenmediums (Wolkenmedium). Einzige Quelle für den Raymarcher (`shaders/cloudMarch.ts`,
 * als Uniforms über `CloudFrameParams` bzw. als Defines aus `cloudMediumDefines`) und für die CPU-Dichtefunktion
 * (`CloudDensityField`): beide beschreiben damit dieselbe Wolke.
 */
export const CloudMedium = {
  /** Kachel der Wetterkarte (Wolkenfelder in R, Regenzellen in B) in Metern. */
  weatherTileMeters: 9000,
  /** Kachel des Formrauschens in Metern. */
  shapeTileMeters: 260,
  /** Kachel des Detailrauschens in Metern. */
  detailTileMeters: 24,
  /** Kachel der großräumigen Wolkenmassen in Metern: kilometergroße Haufen. */
  massTileMeters: 4000,
  /** Extinktion je Dichteeinheit (1/m). */
  extinctionPerDensity: 0.05,
  /** Grunddichte des Mediums. */
  density: 1,
  /** Stauchung in y: > 1 macht Wolkenmassen breiter als hoch (massige Haufen), < 1 höher als breit (Türme). */
  verticalSquash: 1.1,
  /** Erosion der Massenränder durch das Detailrauschen. */
  erosion: 0.5,
  /** Zusätzliche Bedeckung je `depthBiasMeters` Tiefe unter dem Mittelpunkt. */
  depthBias: 0.1,
  depthBiasMeters: 7000,
  /** Wolkenfelder: Bedeckung ± halbe Stärke nach Kanal R der Wetterkarte (dichte Felder, klare Zonen dazwischen). */
  clusterStrength: 0.3,
  /** Schichten der Haufenwolken: Abstand der flachen Basen in Metern, versetzt je Wolkenfeld. */
  layerSpacingMeters: 2800,
  /** Anstieg an der Basis (Anteil der Schicht): klein = flache, scharfe Unterkante. */
  layerBaseSoftness: 0.04,
  /** Ab diesem Anteil der Schicht verjüngen sich die Türme nach oben. */
  layerTopTaperStart: 0.6,
  /** Bedeckungszuschlag über Regenzellen. */
  rainCellCoverage: 0.35,
  /** Dichtezuschlag in Regenzellen. */
  stormDensityBoost: 0.6,
  /** Breite der Verdichtungszone vor dem Kugelrand in Metern. */
  boundaryRamp: 1800,
  /** Dichtezuschlag am Kugelrand. */
  boundaryDensity: 1.5,
  /** Bedeckung am und hinter dem Kugelrand (seitlich und unten). */
  boundaryCoverage: 0.9,
  /** Reichweite der Randbedeckung hinter dem Kugelrand in Metern. */
  boundaryOvershootMeters: 500,
  /** Oben bleibt der Rand offen: Übergang über die Höhe (Anteil y / Radius) und Bedeckungszuschlag dort. */
  rimOpenFrom: 0.2,
  rimOpenTo: 0.75,
  rimTopExtraCoverage: 0.1,
  /** Wie offen Rand und Wolkenhülle nach oben sind (0 = geschlossen, 1 = viele Lücken). */
  topOpenness: 0.85,
  /** Renderdistanz der Volumenwolken in Metern; dahinter die analytische Hülle. */
  renderDistance: 5600,
  /**
   * Wolkenmeer der Hülle unter dem Horizont: gedachte Ebene auf dieser Welthöhe (m), mindestens `seaMinDepthMeters`
   * unter der Kamera, darauf Kuppen bis `seaReliefMeters` hoch.
   */
  seaLevelMeters: -2600,
  seaMinDepthMeters: 1400,
  seaReliefMeters: 900,
  /** Entfernung des Regenvorhangs, auf dem der Regenbogen liegt (m): nähere Wolken und Inseln verdecken ihn. */
  rainbowCurtainMeters: 1200,
  /** Übergangsbreite vom Rand zum Kern einer Wolkenmasse (Massenwert): klein = kompakte Massen. */
  bodyRamp: 0.18,
  /** Schwelle des Formrauschens im Massenkern: klein = das Formrauschen zerteilt die Massen weniger. */
  shapeThreshold: 0.82,
  /** Dichte schwankt im Inneren mit dem Formrauschen zwischen diesem Anteil und voll (kein flacher Nebel). */
  shapeDensityFloor: 0.65,
  /** Zweite Oktave der Wolkenmassen: Frequenzfaktor, Versatz und Gewicht. */
  massOctaveScale: 2.13,
  massOctaveOffset: [0.31, 0.57, 0.11],
  massOctaveWeight: 0.3,
  /** Drift der Wetterkarte relativ zur Massendrift. */
  weatherDrift: 0.2,
  /** Drift des Detailrauschens relativ zur Formdrift. */
  detailDrift: 1.6,
  /** Untergrenze der Detail-Modulation in Nebelvolumen. */
  mistDetailFloor: 0.35,
  /** Untergrenze der Modulation der Nebelvolumen durch das Formrauschen (unregelmäßige Nebelbänke). */
  mistShapeFloor: 0.15,
  /** Mindest-Weichheit eines Nebelvolumens. */
  mistMinSoftness: 0.05,
  /** Lichtungen um Nester und Stöcke: Anteil des Radius, ab dem die Bedeckung weich zurückkehrt. */
  clearingInner: 0.55,
  /** Längster Leerschritt des Raymarchers innerhalb von Nebelvolumen (m), damit dünner Nebel nicht übersprungen wird. */
  mistStepMeters: 6,
} as const;

/** Schreibt eine Zahl als GLSL-Gleitkommaliteral (mit Dezimalpunkt). */
function glslFloat(value: number): string {
  const text = String(value);
  return /[.eE]/.test(text) ? text : `${text}.0`;
}

/** Formelkonstanten der Dichtefunktion als GLSL-Defines für den Raymarcher (Medium-Defines). */
export function cloudMediumDefines(): string[] {
  const [ox, oy, oz] = CloudMedium.massOctaveOffset;
  return [
    `CLOUD_DEPTH_BIAS_METERS ${glslFloat(CloudMedium.depthBiasMeters)}`,
    `CLOUD_CLUSTER_STRENGTH ${glslFloat(CloudMedium.clusterStrength)}`,
    `CLOUD_LAYER_SPACING ${glslFloat(CloudMedium.layerSpacingMeters)}`,
    `CLOUD_LAYER_BASE_SOFTNESS ${glslFloat(CloudMedium.layerBaseSoftness)}`,
    `CLOUD_LAYER_TOP_TAPER ${glslFloat(CloudMedium.layerTopTaperStart)}`,
    `CLOUD_RAIN_CELL_COVERAGE ${glslFloat(CloudMedium.rainCellCoverage)}`,
    `CLOUD_BOUNDARY_COVERAGE ${glslFloat(CloudMedium.boundaryCoverage)}`,
    `CLOUD_BOUNDARY_OVERSHOOT ${glslFloat(CloudMedium.boundaryOvershootMeters)}`,
    `CLOUD_RIM_OPEN_FROM ${glslFloat(CloudMedium.rimOpenFrom)}`,
    `CLOUD_RIM_OPEN_TO ${glslFloat(CloudMedium.rimOpenTo)}`,
    `CLOUD_RIM_TOP_EXTRA ${glslFloat(CloudMedium.rimTopExtraCoverage)}`,
    `CLOUD_BODY_RAMP ${glslFloat(CloudMedium.bodyRamp)}`,
    `CLOUD_SHAPE_THRESHOLD ${glslFloat(CloudMedium.shapeThreshold)}`,
    `CLOUD_SHAPE_DENSITY_FLOOR ${glslFloat(CloudMedium.shapeDensityFloor)}`,
    `CLOUD_MASS_OCTAVE_SCALE ${glslFloat(CloudMedium.massOctaveScale)}`,
    `CLOUD_MASS_OCTAVE_OFFSET vec3(${glslFloat(ox)}, ${glslFloat(oy)}, ${glslFloat(oz)})`,
    `CLOUD_MASS_OCTAVE_WEIGHT ${glslFloat(CloudMedium.massOctaveWeight)}`,
    `CLOUD_WEATHER_DRIFT ${glslFloat(CloudMedium.weatherDrift)}`,
    `CLOUD_DETAIL_DRIFT ${glslFloat(CloudMedium.detailDrift)}`,
    `CLOUD_MIST_DETAIL_FLOOR ${glslFloat(CloudMedium.mistDetailFloor)}`,
    `CLOUD_MIST_SHAPE_FLOOR ${glslFloat(CloudMedium.mistShapeFloor)}`,
    `CLOUD_MIST_MIN_SOFTNESS ${glslFloat(CloudMedium.mistMinSoftness)}`,
    `CLOUD_CLEARING_INNER ${glslFloat(CloudMedium.clearingInner)}`,
    `CLOUD_MIST_STEP ${glslFloat(CloudMedium.mistStepMeters)}`,
  ];
}
