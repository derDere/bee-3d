// shared/events.ts — Kennungen, die Modul und Client gemeinsam deuten: Flags, Ereignisarten, Zustände.

/** Bitflags in bee_state.flags (Bienenflags). */
export const BeeFlags = {
  ghost: 0x01,
  docked: 0x02,
  boost: 0x04,
  warping: 0x08,
  mining: 0x10,
  freeLaser: 0x20, // vom Client gemeldet: freies Zielen mit der Maus (Steuerung des 2D-Vorbilds)
  laserFiring: 0x40,
  gatlingFiring: 0x80,
} as const;

/** Flags, die der Client in seiner Pose melden darf; alle anderen setzt der Server. */
export const ClientReportableFlags = BeeFlags.freeLaser;

/** Art eines Objekts in Ereignissen und Modulzielen (Objektart). */
export const EntityKinds = {
  none: 0,
  bee: 1,
  fly: 2,
  flowerPatch: 3,
  hive: 4,
} as const;

export type EntityKind = (typeof EntityKinds)[keyof typeof EntityKinds];

/** Art eines Ereignisses in combat_event (Ereignisart). */
export const EventKinds = {
  laserShot: 1, // value = Schaden (0 = Fehlschuss), aux = Modulplatz
  gatlingBurst: 2, // value = Schaden × 10, aux = Treffer
  missileLaunch: 3, // value = Flugzeit in 10 ms, aux = Anzahl
  missileImpact: 4, // value = Schaden × 10
  spitLaunch: 5, // value = Flugzeit in 10 ms, aux = Anzahl
  spitImpact: 6, // value = Schaden × 10 (0 = ausgewichen)
  flyKilled: 7, // value = Kopfgeld
  beeKilled: 8,
  collect: 9, // value = Pollen, aux = 1 bei Goldpollen
  aggro: 10, // aux = Spruch-Index
  buzz: 11,
  heal: 12, // value = Lebenspunkte
  dock: 13,
  undock: 14,
  warp: 15,
  scan: 16,
  questDone: 17, // aux = Quest-ID, value = Belohnung (nur in der Zelle des Spielers)
  revive: 18,
} as const;

/** Zustand einer Fliege in fly_state.state (Fliegenzustand). */
export const FlyStates = {
  dormant: 0,
  patrol: 1,
  chase: 2,
  flee: 3,
  returnHome: 4,
} as const;

/** Wert von player_stats.dockedHive im Flug. */
export const NoHive = 255;
