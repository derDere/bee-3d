// src/hud/hudTypes.ts — Vertrag zwischen Spiel und HTML-Oberfläche (HUD).
// Das Spiel liefert je Frame ein HudModel; die Oberfläche zeichnet es und meldet Bedienungen über HudActions.
// Alle Texte für den Spieler sind Englisch; Symbole kommen als Kennungen, die die Oberfläche selbst zeichnet.

/** Art eines Objekts im Raum (Objektart). */
export type EntityType = "bee" | "fly" | "flowerPatch" | "hive" | "island" | "nest";

/** Verweis auf ein Objekt (Objektverweis). */
export interface EntityRef {
  readonly type: EntityType;
  readonly id: number;
}

/** Verbindungszustand (Netzstatus). */
export type ConnectionStatus = "offline" | "connecting" | "joining" | "online" | "reconnecting" | "reload-required";

/** Werte der eigenen Biene (Schiffsanzeige). */
export interface PlayerHud {
  readonly name: string;
  readonly hp: number;
  readonly maxHp: number;
  readonly energy: number;
  readonly maxEnergy: number;
  readonly speed: number;
  readonly maxSpeed: number;
  /** Gewähltes Tempo als Anteil des Höchsttempos. */
  readonly throttle: number;
  readonly cargo: number;
  readonly cargoGold: number;
  readonly cargoCapacity: number;
  readonly honey: number;
  readonly isGhost: boolean;
  readonly isDocked: boolean;
  readonly isWarping: boolean;
  readonly position: { readonly x: number; readonly y: number; readonly z: number };
  /** Kompassrichtung der Flugrichtung in Grad (0 = +Z). */
  readonly headingDeg: number;
  /** Aktueller Befehl, z. B. "Orbit 20 m: Blowfly". */
  readonly commandLabel: string;
}

/** Symbol eines Moduls (Modulsymbol), gleich dem Modulschlüssel in shared/rules.ts. */
export type ModuleIcon = "laserLeft" | "laserRight" | "gatling" | "stinger" | "collector" | "boost" | "repair" | "scanner";

/** Ein Modulplatz F1–F8 (Modulanzeige). */
export interface ModuleHud {
  readonly slot: number;
  readonly title: string;
  readonly hotkey: string;
  /** Symbol der Schaltfläche. */
  readonly icon: ModuleIcon;
  readonly active: boolean;
  /** Fortschritt des laufenden Zyklus 0..1. */
  readonly cycleProgress: number;
  /** Aktivierbar (Ziel passt, Energie reicht, nicht angedockt). */
  readonly available: boolean;
  readonly stopping: boolean;
  readonly tooltip: string;
}

/** Ein aufgeschaltetes Ziel (Zielanzeige). */
export interface TargetHud {
  readonly ref: EntityRef;
  readonly name: string;
  readonly hpRatio: number;
  readonly distance: number;
  readonly isActive: boolean;
  /** Aufschaltfortschritt 0..1; 1 = aufgeschaltet. */
  readonly lockProgress: number;
  readonly hostile: boolean;
}

/** Infofeld des ausgewählten Objekts (Auswahl). */
export interface SelectionHud {
  readonly ref: EntityRef;
  readonly name: string;
  readonly typeLabel: string;
  readonly distance: number;
  readonly speed: number;
  readonly hpRatio: number | undefined;
  readonly detail: string;
  readonly canApproach: boolean;
  readonly canOrbit: boolean;
  readonly canKeepRange: boolean;
  readonly canAlign: boolean;
  readonly canWarp: boolean;
  readonly canDock: boolean;
  readonly canLock: boolean;
  readonly isLocked: boolean;
  readonly orbitDistance: number;
  readonly keepRangeDistance: number;
}

/** Zeile der Objektliste (Overview). */
export interface OverviewRow {
  readonly ref: EntityRef;
  readonly name: string;
  readonly typeLabel: string;
  readonly distance: number;
  readonly speed: number;
  readonly hostile: boolean;
  readonly isLocked: boolean;
  readonly isSelected: boolean;
  /** Dieses Objekt hat die eigene Biene im Visier (Fliege mit Aggro). */
  readonly isAttackingMe: boolean;
  /** Reiter, auf denen die Zeile erscheint. */
  readonly tabs: readonly OverviewTab[];
}

export type OverviewTab = "all" | "combat" | "mining" | "navigation";

/** Klammer um ein Objekt im Raum, in Bildschirmpixeln (Raumklammer). */
export interface BracketHud {
  readonly ref: EntityRef;
  readonly x: number;
  readonly y: number;
  /** Bildschirmgröße des Objekts in Pixeln (Klammer mindestens 14 px). */
  readonly size: number;
  readonly onScreen: boolean;
  readonly name: string;
  readonly distance: number;
  readonly hpRatio: number | undefined;
  readonly isLocked: boolean;
  readonly isSelected: boolean;
  readonly isActiveTarget: boolean;
  readonly hostile: boolean;
  readonly showLabel: boolean;
}

/** Eintrag im Ereignisprotokoll (Protokoll). */
export interface LogEntry {
  readonly id: number;
  readonly time: number;
  readonly text: string;
  readonly kind: "combat" | "loot" | "quest" | "taunt" | "system" | "warning";
}

/** Symbol eines Befehls oder Kontextmenü-Eintrags (Befehlssymbol). */
export type CommandIcon = "select" | "approach" | "orbit" | "keepRange" | "align" | "warp" | "dock" | "stop" | "lock" | "unlock" | "flyHere" | "home";

/** Eintrag des Kontextmenüs (Menüeintrag): Symbol, englischer Text für Tooltip und Vorlesen, optional ein Zusatz wie "20 m". */
export interface ContextMenuEntry {
  readonly icon: CommandIcon;
  readonly label: string;
  readonly detail?: string;
  readonly hotkey?: string;
  readonly enabled: boolean;
  readonly run: () => void;
}

/** Upgrade in der Werkstatt (Werkstatt-Eintrag). */
export interface UpgradeHud {
  readonly kind: string;
  readonly title: string;
  readonly effect: string;
  readonly level: number;
  readonly maxLevel: number;
  readonly cost: number | undefined;
  readonly affordable: boolean;
}

/** Quest im Quest-Brett (Quest-Eintrag). */
export interface QuestHud {
  readonly id: number;
  readonly title: string;
  readonly brief: string;
  readonly progress: number;
  readonly goal: number;
  readonly reward: number;
  readonly completed: boolean;
  readonly repeatable: boolean;
  readonly completions: number;
}

/** Zeile der Rangliste (Rangliste). */
export interface LeaderboardRow {
  readonly rank: number;
  readonly name: string;
  readonly honey: number;
  readonly kills: number;
  readonly isSelf: boolean;
}

/** Stationsmenü im Bienenstock (Stationsmenü). */
export interface StationHud {
  readonly hiveId: number;
  readonly hiveName: string;
  readonly isHome: boolean;
  readonly honeyDelivered: number;
  readonly cargo: number;
  readonly cargoGold: number;
  readonly depositValue: number;
  readonly honey: number;
  readonly hp: number;
  readonly maxHp: number;
  readonly repairCost: number;
  readonly upgrades: readonly UpgradeHud[];
  readonly quests: readonly QuestHud[];
  readonly leaderboard: readonly LeaderboardRow[];
  /** Erfolge; `key` ist der Schlüssel aus shared/achievements.ts (für das Symbol). */
  readonly achievements: ReadonlyArray<{ readonly key: string; readonly title: string; readonly description: string; readonly earned: boolean }>;
}

/** Tagesabschnitt für das Symbol der Uhr (Tagesphase). */
export type DayPhaseIcon = "night" | "dawn" | "morning" | "noon" | "afternoon" | "evening";

/** Wetterlage für das Wettersymbol (Wetter), gleich den Namen in shared/weather.ts. */
export type WeatherIcon = "clear" | "fair" | "misty-morning" | "overcast" | "shower" | "storm";

/** Uhr und Wetter für die Anzeige (Himmelsanzeige). */
export interface SkyHud {
  readonly clock: string;
  readonly phase: DayPhaseIcon;
  readonly phaseLabel: string;
  readonly weather: WeatherIcon;
  readonly weatherLabel: string;
  readonly isNight: boolean;
}

/** Alles, was die Oberfläche in einem Frame zeigt (HUD-Modell). */
export interface HudModel {
  readonly connection: ConnectionStatus;
  readonly started: boolean;
  readonly player: PlayerHud | undefined;
  readonly modules: readonly ModuleHud[];
  readonly targets: readonly TargetHud[];
  readonly selection: SelectionHud | undefined;
  readonly overview: readonly OverviewRow[];
  readonly brackets: readonly BracketHud[];
  readonly log: readonly LogEntry[];
  readonly station: StationHud | undefined;
  readonly sky: SkyHud;
  /** Kurzer, mittiger Hinweis (z. B. "You are a ghost — fly to a hive"). */
  readonly banner: string | undefined;
  /** Feste Tastenhilfe ein- oder ausgeblendet. */
  readonly showHelp: boolean;
  readonly fps: number;
}

/** Befehle an die eigene Biene (Flugbefehl). */
export type FlightCommand = "approach" | "orbit" | "keepRange" | "align" | "warp" | "dock" | "stop";

/** Bedienungen der Oberfläche, die das Spiel ausführt (HUD-Aktionen). */
export interface HudActions {
  start(name: string): void;
  select(ref: EntityRef | undefined): void;
  lock(ref: EntityRef): void;
  unlock(ref: EntityRef): void;
  setActiveTarget(ref: EntityRef): void;
  command(command: FlightCommand, ref?: EntityRef, distance?: number): void;
  setOrbitDistance(distance: number): void;
  setKeepRangeDistance(distance: number): void;
  toggleModule(slot: number): void;
  setThrottle(throttle: number): void;
  undock(): void;
  deposit(): void;
  repair(): void;
  buyUpgrade(kind: string): void;
  setHomeHive(): void;
  returnHome(): void;
  buzz(): void;
  setQuality(tier: "auto" | "low" | "medium" | "high" | "ultra"): void;
  setVolume(master: number, music: number): void;
  setInvertY(invert: boolean): void;
  setReduceFlashes(reduce: boolean): void;
  toggleHelp(): void;
  /** Wird aufgerufen, wenn die Oberfläche Tastatureingaben für sich beansprucht (Texteingabe). */
  setTyping(typing: boolean): void;
}

/** Einstellungen, die das Menü zeigt (Menüwerte). */
export interface HudSettings {
  readonly quality: "auto" | "low" | "medium" | "high" | "ultra";
  readonly masterVolume: number;
  readonly musicVolume: number;
  readonly invertY: boolean;
  readonly reduceFlashes: boolean;
  readonly suggestedName: string;
}
