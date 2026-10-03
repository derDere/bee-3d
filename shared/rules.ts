// shared/rules.ts — Spielregeln: Werte der Biene, Upgrades, Module, Gegner und Kampfformeln.
// Server entscheidet mit diesen Regeln; der Client zeigt dieselben Werte an.

// ---------- Upgrades ----------

/** Upgrade-Art der Werkstatt (Upgrade). */
export type UpgradeKind =
  | "lens"
  | "gatling"
  | "quiver"
  | "brush"
  | "cargo"
  | "wings"
  | "armor"
  | "antenna"
  | "nectar";

export const UpgradeKinds: readonly UpgradeKind[] = ["lens", "gatling", "quiver", "brush", "cargo", "wings", "armor", "antenna", "nectar"];

/** Honigkosten je Stufe (Stufe 1 … 5). */
export const UpgradeCosts: readonly number[] = [40, 90, 160, 260, 400];
export const MaxUpgradeLevel = UpgradeCosts.length;

/** Anzeigename und Wirkungstext eines Upgrades (Upgrade-Beschreibung). */
export interface UpgradeInfo {
  readonly kind: UpgradeKind;
  readonly title: string;
  readonly effect: string;
}

export const Upgrades: readonly UpgradeInfo[] = [
  { kind: "lens", title: "Lens Polish", effect: "Laser +15% damage, +8% range" },
  { kind: "gatling", title: "Gatling Joints", effect: "Pollen gatling −10% cycle time" },
  { kind: "quiver", title: "Stinger Quiver", effect: "+1 stinger per volley" },
  { kind: "brush", title: "Collector Brushes", effect: "+2 pollen per collector cycle" },
  { kind: "cargo", title: "Pollen Pants", effect: "+60 cargo" },
  { kind: "wings", title: "Wing Muscles", effect: "Speed and agility +8%" },
  { kind: "armor", title: "Chitin Armour", effect: "+20 hit points" },
  { kind: "antenna", title: "Feeler Antennae", effect: "+60 m lock range, +1 target at levels 2 and 4" },
  { kind: "nectar", title: "Nectar Tank", effect: "+20 energy, +1 energy/s" },
];

/** Upgrade-Stufen einer Biene (Upgrade-Stand). */
export type UpgradeLevels = Readonly<Record<UpgradeKind, number>>;

export const NoUpgrades: UpgradeLevels = { lens: 0, gatling: 0, quiver: 0, brush: 0, cargo: 0, wings: 0, armor: 0, antenna: 0, nectar: 0 };

/** Spalten der Upgrade-Stufen im Spielerstand (Stufenspalten). */
export interface UpgradeLevelColumns {
  readonly lensLevel: number;
  readonly gatlingLevel: number;
  readonly quiverLevel: number;
  readonly brushLevel: number;
  readonly cargoLevel: number;
  readonly wingsLevel: number;
  readonly armorLevel: number;
  readonly antennaLevel: number;
  readonly nectarLevel: number;
}

/** Upgrade-Stufen aus den Spalten des Spielerstands. */
export function upgradeLevelsOf(row: UpgradeLevelColumns): UpgradeLevels {
  return {
    lens: row.lensLevel,
    gatling: row.gatlingLevel,
    quiver: row.quiverLevel,
    brush: row.brushLevel,
    cargo: row.cargoLevel,
    wings: row.wingsLevel,
    armor: row.armorLevel,
    antenna: row.antennaLevel,
    nectar: row.nectarLevel,
  };
}

// ---------- Werte der Biene ----------

/** Abgeleitete Werte einer Biene aus ihren Upgrades (Bienenwerte). */
export interface BeeStats {
  readonly maxSpeed: number;
  readonly agility: number;
  readonly acceleration: number;
  readonly maxHp: number;
  readonly maxEnergy: number;
  readonly energyRegen: number;
  readonly cargoCapacity: number;
  readonly lockRange: number;
  readonly maxLocks: number;
  readonly signatureRadius: number;
}

export const BeeLength = 0.2;
export const GhostSpeedFactor = 0.6;
export const BoostSpeedFactor = 2;

/** Werte einer Biene mit den gegebenen Upgrade-Stufen. */
export function beeStats(levels: UpgradeLevels): BeeStats {
  const wing = 1 + 0.08 * levels.wings;
  return {
    maxSpeed: 14 * wing,
    agility: 2.8 * wing,
    acceleration: 9 * wing,
    maxHp: 100 + 20 * levels.armor,
    maxEnergy: 100 + 20 * levels.nectar,
    energyRegen: 6 + levels.nectar,
    cargoCapacity: 120 + 60 * levels.cargo,
    lockRange: 300 + 60 * levels.antenna,
    maxLocks: 2 + (levels.antenna >= 2 ? 1 : 0) + (levels.antenna >= 4 ? 1 : 0),
    signatureRadius: 0.35,
  };
}

// ---------- Module ----------

/** Steckplatz eines Moduls; die Nummer ist zugleich die F-Taste (Modulplatz). */
export const ModuleSlots = {
  laserLeft: 0,
  laserRight: 1,
  gatling: 2,
  stinger: 3,
  collector: 4,
  boost: 5,
  repair: 6,
  scanner: 7,
} as const;

export type ModuleSlot = (typeof ModuleSlots)[keyof typeof ModuleSlots];
export const ModuleSlotCount = 8;

/** Wogegen ein Modul wirkt (Zielart). */
export type ModuleTargetKind = "enemy" | "flowerPatch" | "self";

/** Schlüssel eines Moduls; zugleich die Kennung seines Symbols im HUD (Modulschlüssel). */
export type ModuleKey = "laserLeft" | "laserRight" | "gatling" | "stinger" | "collector" | "boost" | "repair" | "scanner";

/** Feste Daten eines Moduls vor Upgrades (Moduldaten). */
export interface ModuleInfo {
  readonly slot: ModuleSlot;
  readonly key: ModuleKey;
  readonly title: string;
  readonly hotkey: string;
  readonly target: ModuleTargetKind;
  readonly cycleSeconds: number;
  readonly energyCost: number;
  readonly pollenCost: number;
}

export const Modules: readonly ModuleInfo[] = [
  { slot: 0, key: "laserLeft", title: "Left Laser Eye", hotkey: "F1", target: "enemy", cycleSeconds: 2.0, energyCost: 4, pollenCost: 0 },
  { slot: 1, key: "laserRight", title: "Right Laser Eye", hotkey: "F2", target: "enemy", cycleSeconds: 2.0, energyCost: 4, pollenCost: 0 },
  { slot: 2, key: "gatling", title: "Pollen Gatling", hotkey: "F3", target: "enemy", cycleSeconds: 0.5, energyCost: 0, pollenCost: 1 },
  { slot: 3, key: "stinger", title: "Stinger Missiles", hotkey: "F4", target: "enemy", cycleSeconds: 8.0, energyCost: 15, pollenCost: 0 },
  { slot: 4, key: "collector", title: "Pollen Collector", hotkey: "F5", target: "flowerPatch", cycleSeconds: 3.0, energyCost: 2, pollenCost: 0 },
  { slot: 5, key: "boost", title: "Wing Boost", hotkey: "F6", target: "self", cycleSeconds: 1.0, energyCost: 10, pollenCost: 0 },
  { slot: 6, key: "repair", title: "Nectar Heal", hotkey: "F7", target: "self", cycleSeconds: 4.0, energyCost: 18, pollenCost: 0 },
  { slot: 7, key: "scanner", title: "Scent Scanner", hotkey: "F8", target: "self", cycleSeconds: 10.0, energyCost: 25, pollenCost: 0 },
];

/** Moduldaten eines Steckplatzes. */
export function moduleInfo(slot: number): ModuleInfo {
  const info = Modules[slot];
  if (info === undefined) {
    throw new Error(`Unbekannter Modulplatz ${slot}`);
  }
  return info;
}

/** Werte eines Geschützes (Laser, Gatling) nach Upgrades (Geschützwerte). */
export interface TurretStats {
  readonly optimal: number;
  readonly falloff: number;
  readonly tracking: number;
  readonly damage: number;
  readonly shots: number;
  readonly cycleSeconds: number;
}

export function laserStats(levels: UpgradeLevels): TurretStats {
  return {
    optimal: 55 * (1 + 0.08 * levels.lens),
    falloff: 35,
    tracking: 0.35,
    damage: 9 * (1 + 0.15 * levels.lens),
    shots: 1,
    cycleSeconds: 2.0,
  };
}

export function gatlingStats(levels: UpgradeLevels): TurretStats {
  return { optimal: 20, falloff: 45, tracking: 0.9, damage: 0.6, shots: 6, cycleSeconds: 0.5 * (1 - 0.1 * levels.gatling) };
}

/** Werte der Stachelraketen nach Upgrades (Raketenwerte). */
export interface MissileStats {
  readonly count: number;
  readonly damage: number;
  readonly speed: number;
  readonly flightSeconds: number;
  readonly explosionRadius: number;
  readonly explosionVelocity: number;
  readonly cycleSeconds: number;
}

export function stingerStats(levels: UpgradeLevels): MissileStats {
  return { count: 3 + levels.quiver, damage: 14, speed: 45, flightSeconds: 6, explosionRadius: 0.8, explosionVelocity: 9, cycleSeconds: 8 };
}

/** Reichweite der Stachelraketen. */
export function stingerRange(levels: UpgradeLevels): number {
  const stats = stingerStats(levels);
  return stats.speed * stats.flightSeconds;
}

export const CollectorRange = 18;
export const NightPollenBonus = 1.25;
export const RepairAmount = 12;
export const ScannerRange = 2000;

/** Pollen je Sammelzyklus vor dem Nachtbonus. */
export function collectorYield(levels: UpgradeLevels): number {
  return 6 + 2 * levels.brush;
}

/** Größte Reichweite eines Moduls gegen sein Ziel. */
export function moduleRange(slot: number, levels: UpgradeLevels): number {
  switch (slot) {
    case ModuleSlots.laserLeft:
    case ModuleSlots.laserRight: {
      const laser = laserStats(levels);
      return laser.optimal + 2 * laser.falloff;
    }
    case ModuleSlots.gatling: {
      const gatling = gatlingStats(levels);
      return gatling.optimal + 2 * gatling.falloff;
    }
    case ModuleSlots.stinger:
      return stingerRange(levels);
    case ModuleSlots.collector:
      return CollectorRange;
    case ModuleSlots.scanner:
      return ScannerRange;
    default:
      return 0;
  }
}

/** Zykluszeit eines Moduls nach Upgrades. */
export function moduleCycleSeconds(slot: number, levels: UpgradeLevels): number {
  if (slot === ModuleSlots.gatling) {
    return gatlingStats(levels).cycleSeconds;
  }
  return moduleInfo(slot).cycleSeconds;
}

// ---------- Kampfformeln (EVE-Vorbild) ----------

/** Bezugssignatur der Geschütze: Ziele dieser Größe nutzen das volle Tracking (Signaturauflösung). */
export const TurretSignatureResolution = 0.5;

/**
 * Trefferchance eines Geschützes (Trefferchance): Winkelgeschwindigkeit ω in rad/s gegen Tracking
 * und Zielgröße, Entfernung gegen optimale Reichweite und Falloff.
 */
export function turretHitChance(angularVelocity: number, distance: number, signatureRadius: number, turret: TurretStats): number {
  const trackingTerm = angularVelocity / (turret.tracking * (signatureRadius / TurretSignatureResolution));
  const rangeTerm = Math.max(0, distance - turret.optimal) / turret.falloff;
  return Math.pow(0.5, trackingTerm * trackingTerm + rangeTerm * rangeTerm);
}

/** Schadensfaktor einer Rakete gegen Zielgröße und -tempo (Raketenschaden). */
export function missileDamageFactor(signatureRadius: number, targetSpeed: number, missile: MissileStats): number {
  const sizeRatio = signatureRadius / missile.explosionRadius;
  const speedRatio = targetSpeed > 0.01 ? (sizeRatio * missile.explosionVelocity) / targetSpeed : Number.POSITIVE_INFINITY;
  return Math.min(1, sizeRatio, Math.pow(speedRatio, 0.8));
}

/** Trefferchance der Fliegenspucke gegen das Quertempo der Biene (Ausweichen). */
export function spitHitChance(transversalSpeed: number): number {
  return Math.min(1, Math.max(0.25, 1 - (transversalSpeed / 30) * 0.6));
}

export const SpitSpeed = 30;

// ---------- Gegner ----------

/** Art einer Fliege (Fliegenart). */
export type FlyKind = 0 | 1 | 2;
export const FlyKinds = { blowfly: 0, brummer: 1, queen: 2 } as const;

/** Werte einer Fliegenart (Fliegenwerte). */
export interface FlyInfo {
  readonly kind: FlyKind;
  readonly title: string;
  readonly model: string;
  readonly length: number;
  readonly maxHp: number;
  readonly speed: number;
  readonly orbitDistance: number;
  readonly spitDamage: number;
  readonly spitCount: number;
  readonly spitCooldown: number;
  readonly spitRange: number;
  readonly aggroDay: number;
  readonly aggroNight: number;
  readonly bounty: number;
  readonly signatureRadius: number;
}

export const Flies: readonly FlyInfo[] = [
  { kind: 0, title: "Blowfly", model: "fly.glb", length: 0.45, maxHp: 60, speed: 11, orbitDistance: 25, spitDamage: 4, spitCount: 1, spitCooldown: 3.2, spitRange: 60, aggroDay: 110, aggroNight: 170, bounty: 8, signatureRadius: 0.6 },
  { kind: 1, title: "Bluebottle", model: "fly-brummer.glb", length: 0.9, maxHp: 220, speed: 8, orbitDistance: 35, spitDamage: 10, spitCount: 1, spitCooldown: 4.5, spitRange: 90, aggroDay: 140, aggroNight: 200, bounty: 30, signatureRadius: 1.2 },
  { kind: 2, title: "Fly Queen", model: "fly-queen.glb", length: 2.8, maxHp: 2500, speed: 6, orbitDistance: 50, spitDamage: 8, spitCount: 5, spitCooldown: 5, spitRange: 120, aggroDay: 220, aggroNight: 280, bounty: 600, signatureRadius: 4 },
];

/** Werte einer Fliegenart. */
export function flyInfo(kind: number): FlyInfo {
  const info = Flies[kind];
  if (info === undefined) {
    throw new Error(`Unbekannte Fliegenart ${kind}`);
  }
  return info;
}

/** Fliegen pro Nest und Nachfüllzeit. */
export const NestBlowflies = 6;
export const NestBrummers = 2;
export const NestRespawnSeconds = 40;
export const QueenRespawnSeconds = 600;
/** Leine: so weit entfernt sich eine Fliege höchstens vom Nest. */
export const FlyLeash = 450;
/** Fliegen werden nur in diesem Abstand zu einem Spieler simuliert. */
export const FlyActivationRange = 700;

// ---------- Bienenstock ----------

export const DockRange = 45;
export const HoneyPerPollen = 1;
export const HoneyPerGoldPollen = 5;
/** Lebenspunkte je Honig in der Heilstation. */
export const HpPerHoney = 4;

// ---------- Blumenfelder ----------

/** Sekunden je nachwachsendem Pollen. */
export const PatchRegrowSeconds = 6;

/** Pollenstand eines Felds zur Zeit `nowSeconds` aus gespeichertem Stand und Zeitstempel (lazy). */
export function patchPollenAt(stored: number, storedAtSeconds: number, capacity: number, nowSeconds: number): number {
  const grown = Math.floor(Math.max(0, nowSeconds - storedAtSeconds) / PatchRegrowSeconds);
  return Math.min(capacity, stored + grown);
}

/** Energie zur Zeit `nowSeconds` aus gespeichertem Stand (lazy). */
export function energyAt(stored: number, storedAtSeconds: number, stats: BeeStats, nowSeconds: number): number {
  return Math.min(stats.maxEnergy, stored + Math.max(0, nowSeconds - storedAtSeconds) * stats.energyRegen);
}
