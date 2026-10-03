// src/hud/demo/mockEntities.ts — erfundene Objekte rund um die Biene für die HUD-Entwicklungsseite (englische Texte).

import type { EntityRef, EntityType, OverviewTab } from "../hudTypes";

/** Bewegtes Objekt im Mock-Raum, Koordinaten relativ zur Biene: x rechts, y oben, z voraus (Mock-Objekt). */
export interface MockEntity {
  readonly ref: EntityRef;
  readonly name: string;
  readonly typeLabel: string;
  readonly hostile: boolean;
  readonly tabs: readonly OverviewTab[];
  /** Größe des Objekts in Metern für die Markierungsgröße. */
  readonly size: number;
  readonly maxHp: number | undefined;
  readonly detail: string;
  readonly attacking: boolean;
  x: number;
  y: number;
  z: number;
  speed: number;
  distance: number;
}

/** Ruhelage und Pendelbewegung eines Mock-Objekts (Bewegungsplan). */
interface MotionPlan {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Ausschlag der Pendelbewegung in Metern. */
  readonly sway: number;
  /** Kreisfrequenz der Pendelbewegung in rad/s. */
  readonly rate: number;
  readonly phase: number;
}

interface EntitySeed {
  readonly type: EntityType;
  readonly name: string;
  readonly typeLabel: string;
  readonly size: number;
  readonly maxHp?: number;
  readonly hostile?: boolean;
  readonly attacking?: boolean;
  readonly detail: string;
  readonly motion: MotionPlan;
}

const TabsByType: Readonly<Record<EntityType, readonly OverviewTab[]>> = {
  fly: ["all", "combat"],
  nest: ["all", "combat", "navigation"],
  bee: ["all"],
  flowerPatch: ["all", "mining"],
  hive: ["all", "navigation"],
  island: ["all", "navigation"],
};

const Seeds: readonly EntitySeed[] = [
  { type: "fly", name: "Blowfly", typeLabel: "Blowfly", size: 0.45, maxHp: 60, hostile: true, attacking: true, detail: "Spits 6 damage every 2.5 s up to 60 m. Bounty: 8 honey.", motion: { x: -6, y: 2, z: 22, sway: 7, rate: 0.9, phase: 0 } },
  { type: "fly", name: "Blowfly", typeLabel: "Blowfly", size: 0.45, maxHp: 60, hostile: true, detail: "Patrolling around its nest.", motion: { x: 14, y: -3, z: 38, sway: 9, rate: 0.7, phase: 1.3 } },
  { type: "fly", name: "Big Bluebottle", typeLabel: "Bluebottle", size: 0.9, maxHp: 220, hostile: true, detail: "Twice as big and three times as rude. Spits 16 damage up to 90 m.", motion: { x: 30, y: 8, z: 82, sway: 12, rate: 0.4, phase: 2.1 } },
  { type: "fly", name: "Blowfly", typeLabel: "Blowfly", size: 0.45, maxHp: 60, hostile: true, detail: "Hasn't noticed you yet.", motion: { x: -60, y: 20, z: 150, sway: 15, rate: 0.5, phase: 0.4 } },
  { type: "fly", name: "Fly Queen", typeLabel: "Fly Queen", size: 2.8, maxHp: 2500, hostile: true, detail: "Lives in Maggot Keep. Bring a swarm!", motion: { x: 900, y: 300, z: 2300, sway: 40, rate: 0.05, phase: 0 } },
  { type: "bee", name: "Bumble Betty", typeLabel: "Bee", size: 0.2, maxHp: 120, detail: "Another player, collecting at the clover field.", motion: { x: 9, y: -1, z: 34, sway: 3, rate: 0.6, phase: 0.8 } },
  { type: "bee", name: "Sir Buzzalot", typeLabel: "Bee", size: 0.2, maxHp: 100, detail: "Another player, flying home.", motion: { x: -24, y: 6, z: 118, sway: 10, rate: 0.3, phase: 2.6 } },
  { type: "bee", name: "Nectarina", typeLabel: "Bee", size: 0.2, maxHp: 140, detail: "Another player with level 3 chitin armour.", motion: { x: 140, y: -40, z: 380, sway: 20, rate: 0.2, phase: 1.1 } },
  { type: "flowerPatch", name: "Clover Field", typeLabel: "Flower field", size: 6, detail: "84 of 120 pollen, growing back.", motion: { x: -3, y: -6, z: 13, sway: 0.4, rate: 0.3, phase: 0 } },
  { type: "flowerPatch", name: "Poppy Meadow", typeLabel: "Flower field", size: 7, detail: "160 of 200 pollen.", motion: { x: 22, y: -12, z: 48, sway: 0.4, rate: 0.3, phase: 1 } },
  { type: "flowerPatch", name: "Golden Blossoms", typeLabel: "Gold flowers", size: 5, detail: "Gold pollen counts five times when you deposit it.", motion: { x: -180, y: 60, z: 610, sway: 1, rate: 0.2, phase: 2 } },
  { type: "flowerPatch", name: "Lavender Slope", typeLabel: "Flower field", size: 8, detail: "45 of 160 pollen.", motion: { x: 70, y: -30, z: 220, sway: 1, rate: 0.2, phase: 0.5 } },
  { type: "hive", name: "Queen's Hive", typeLabel: "Hive", size: 18, detail: "Your home hive. 48,210 honey delivered. Dock within 45 m.", motion: { x: -16, y: 4, z: 34, sway: 0.5, rate: 0.2, phase: 0 } },
  { type: "hive", name: "Linden Hive", typeLabel: "Hive", size: 18, detail: "12,904 honey delivered.", motion: { x: 600, y: 120, z: 1700, sway: 2, rate: 0.1, phase: 0 } },
  { type: "hive", name: "Clover Grove", typeLabel: "Hive", size: 18, detail: "8,115 honey delivered.", motion: { x: -1500, y: -200, z: 2800, sway: 2, rate: 0.1, phase: 0 } },
  { type: "nest", name: "Maggot Keep", typeLabel: "Fly nest", size: 14, hostile: true, detail: "The Fly Queen lives here.", motion: { x: 950, y: 280, z: 2700, sway: 1, rate: 0.1, phase: 0 } },
  { type: "nest", name: "Mould Cave", typeLabel: "Fly nest", size: 10, hostile: true, detail: "6 blowflies and 2 bluebottles; refills every 40 s.", motion: { x: 240, y: -60, z: 740, sway: 1, rate: 0.1, phase: 0 } },
  { type: "island", name: "Mossy Knoll", typeLabel: "Island", size: 46, detail: "46 m across, 4 flower fields and a lily pond.", motion: { x: 18, y: -38, z: 58, sway: 0.6, rate: 0.15, phase: 0 } },
  { type: "island", name: "Cloud Tip", typeLabel: "Island", size: 30, detail: "Half hidden in a cloud.", motion: { x: -150, y: 50, z: 320, sway: 2, rate: 0.1, phase: 1 } },
  { type: "island", name: "Fir Rock", typeLabel: "Island", size: 88, detail: "A big island with a waterfall.", motion: { x: 420, y: -160, z: 1050, sway: 3, rate: 0.08, phase: 2 } },
  { type: "bee", name: "Wing Wendy", typeLabel: "Bee", size: 0.2, maxHp: 110, detail: "Another player, buzzing past far to your right.", motion: { x: 70, y: 4, z: 16, sway: 6, rate: 0.35, phase: 0.2 } },
  { type: "flowerPatch", name: "Daisy Dell", typeLabel: "Flower field", size: 6, detail: "Right behind you. 120 of 150 pollen.", motion: { x: -8, y: -5, z: -32, sway: 0.5, rate: 0.2, phase: 0 } },
];

/** Legt die Mock-Objekte mit fortlaufenden IDs an. */
export function createMockEntities(): MockEntity[] {
  return Seeds.map((seed, index) => ({
    ref: { type: seed.type, id: 100 + index },
    name: seed.name,
    typeLabel: seed.typeLabel,
    hostile: seed.hostile ?? false,
    tabs: TabsByType[seed.type],
    size: seed.size,
    maxHp: seed.maxHp,
    detail: seed.detail,
    attacking: seed.attacking ?? false,
    x: seed.motion.x,
    y: seed.motion.y,
    z: seed.motion.z,
    speed: 0,
    distance: Math.hypot(seed.motion.x, seed.motion.y, seed.motion.z),
  }));
}

/** Bewegt die Objekte entlang ihres Pendelplans und berechnet Tempo und Entfernung. */
export function moveMockEntities(entities: MockEntity[], time: number, dt: number): void {
  entities.forEach((entity, index) => {
    const motion = Seeds[index].motion;
    const angle = time * motion.rate + motion.phase;
    const x = motion.x + Math.sin(angle) * motion.sway;
    const y = motion.y + Math.sin(angle * 0.7) * motion.sway * 0.3;
    const z = motion.z + Math.cos(angle) * motion.sway;
    const moved = Math.hypot(x - entity.x, y - entity.y, z - entity.z);
    entity.speed = dt > 0 ? moved / dt : 0;
    entity.x = x;
    entity.y = y;
    entity.z = z;
    entity.distance = Math.hypot(x, y, z);
  });
}
