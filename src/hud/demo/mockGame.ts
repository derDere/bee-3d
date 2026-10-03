// src/hud/demo/mockGame.ts — Mock-Spiel der HUD-Entwicklungsseite: animierter Zustand, HudModel je Frame und
// HudActions, die jede Bedienung in der Konsole protokollieren und auf den Mock-Zustand anwenden.

import { AchievementList } from "../../../shared/achievements";
import { FlyTaunts, Quests } from "../../../shared/quests";
import { DockRange, HoneyPerGoldPollen, HoneyPerPollen, HpPerHoney, MaxUpgradeLevel, Modules, UpgradeCosts, Upgrades } from "../../../shared/rules";
import { WarpMinDistance } from "../../../shared/world";
import { isLockableType, sameEntity } from "../entities";
import { formatDistance } from "../format";
import type {
  BracketHud,
  ConnectionStatus,
  DayPhaseIcon,
  EntityRef,
  FlightCommand,
  HudActions,
  HudModel,
  LogEntry,
  ModuleHud,
  OverviewRow,
  SelectionHud,
  SkyHud,
  StationHud,
  TargetHud,
  WeatherIcon,
} from "../hudTypes";
import { createMockEntities, moveMockEntities, type MockEntity } from "./mockEntities";

/** Umschaltbare Lage der Entwicklungsseite (Demo-Szenario). */
export type DemoScenario = "start" | "flight" | "docked" | "ghost";

export const DemoScenarios: readonly DemoScenario[] = ["start", "flight", "docked", "ghost"];

const ModuleTips: readonly string[] = [
  "Optimal 55 m, falloff 35 m, tracking 0.35 rad/s.\n9 damage per cycle, 4 nectar.",
  "Like the left eye, with its own target.\n9 damage per cycle, 4 nectar.",
  "Six legs, 6 pellets × 0.6 damage.\nOptimal 20 m, 1 pollen per cycle.",
  "Volley of 3 stingers × 14 damage.\nRange 270 m, 15 nectar.",
  "6 pollen per cycle from up to 18 m.\n2 nectar.",
  "Doubles your top speed.\n10 nectar per second.",
  "+12 health per cycle.\n18 nectar.",
  "Shows gold flowers and nests up to 2 km.\n25 nectar.",
];

const Connections: readonly ConnectionStatus[] = ["online", "connecting", "joining", "reconnecting", "offline", "reload-required"];
const Weathers: ReadonlyArray<{ readonly icon: WeatherIcon; readonly label: string }> = [
  { icon: "clear", label: "Clear sky" },
  { icon: "fair", label: "Fair weather" },
  { icon: "misty-morning", label: "Misty morning" },
  { icon: "overcast", label: "Overcast" },
  { icon: "shower", label: "Rain shower" },
  { icon: "storm", label: "Thunderstorm" },
];

const LeaderboardNames: readonly string[] = ["Queen of Nothing", "Bumble Betty", "Honey Badger", "Stingy Sue", "Pollen Paul", "", "Buzz Aldrin", "Wing Wendy", "Nectarina", "Sir Buzzalot"];

/** Zustand eines Modulplatzes im Mock (Mock-Modul). */
interface MockModule {
  active: boolean;
  stopping: boolean;
  progress: number;
}

/** Aufschaltung im Mock (Mock-Ziel). */
interface MockTarget {
  readonly ref: EntityRef;
  lockProgress: number;
}

/** Sekunden, bis ein Ziel aufgeschaltet ist. */
const LockSeconds = 1.6;
/** Echtzeit-Sekunden je Spielstunde der Mock-Uhr. */
const SecondsPerHour = 20;
/** Drehgeschwindigkeit der Kamera beim Schwenken (Bogenmaß je Sekunde). */
const PanRadiansPerSecond = 0.25;

/** Tagesabschnitt einer Stunde für Symbol und Namen. */
function dayPhase(hours: number): { readonly icon: DayPhaseIcon; readonly label: string } {
  if (hours < 5 || hours >= 21) {
    return { icon: "night", label: "Night" };
  }
  if (hours < 7) {
    return { icon: "dawn", label: "Dawn" };
  }
  if (hours < 11) {
    return { icon: "morning", label: "Morning" };
  }
  if (hours < 14) {
    return { icon: "noon", label: "Noon" };
  }
  if (hours < 18) {
    return { icon: "afternoon", label: "Afternoon" };
  }
  return { icon: "evening", label: "Evening" };
}

/** Mock-Spiel für die HUD-Entwicklungsseite (Mock-Spiel). */
export class MockGame implements HudActions {
  public scenario: DemoScenario = "start";
  /** Die Oberfläche beansprucht gerade die Tastatur (setTyping). */
  public typing = false;
  /** Blickrichtung der Mock-Kamera um die Hochachse (Bogenmaß; positiv = nach rechts gedreht). */
  public cameraYaw = 0;
  /** Die Kamera schwenkt langsam im Kreis, damit Objekte aus dem Bild und hinter die Kamera wandern. */
  public cameraPanning = false;
  private readonly entities: MockEntity[] = createMockEntities();
  private readonly modules: MockModule[] = Modules.map(() => ({ active: false, stopping: false, progress: 0 }));
  private readonly log: LogEntry[] = [];
  private readonly upgradeLevels = new Map<string, number>([
    ["lens", 2],
    ["gatling", 1],
    ["cargo", 1],
    ["wings", 1],
    ["armor", 1],
    ["antenna", 2],
    ["nectar", 1],
  ]);
  private targets: MockTarget[] = [];
  private activeTarget: EntityRef | undefined;
  private selected: EntityRef | undefined;
  private time = 0;
  private nextLogTime = 2;
  private nextLogId = 1;
  private logCursor = 0;
  private playerName = "Waggle Walter";
  private hp = 96;
  private readonly maxHp = 120;
  private energy = 88;
  private readonly maxEnergy = 120;
  private speed = 8;
  private readonly maxSpeed = 15.1;
  private throttle = 0.6;
  private cargo = 64;
  private cargoGold = 4;
  private readonly cargoCapacity = 180;
  private honey = 1234;
  private readonly position = { x: 812, y: 146, z: -2210 };
  private heading = 42;
  private commandLabel = "";
  private orbitDistance = 20;
  private keepRangeDistance = 15;
  private warpUntil = 0;
  private showHelp = false;
  private banner: string | undefined;
  private bannerUntil = 0;
  private connectionIndex = 0;
  private skyHours = 9.4;
  private weatherIndex = 1;
  private isHome = true;
  private hiveDelivered = 48_210;

  public constructor() {
    this.resetFlight();
    for (let index = 0; index < 6; index++) {
      this.pushRandomLog();
    }
  }

  /** Wechselt die Lage der Seite; jede Lage beginnt mit passenden Werten. */
  public setScenario(scenario: DemoScenario): void {
    this.scenario = scenario;
    if (scenario === "flight") {
      this.resetFlight();
      this.showBanner("Welcome to the sky sphere!", 4);
    } else if (scenario === "ghost") {
      this.targets = [];
      this.activeTarget = undefined;
      this.hp = 0;
      this.cargo = 0;
      this.cargoGold = 0;
      this.commandLabel = "";
      this.banner = "You are a ghost – fly to a hive";
      this.bannerUntil = Number.POSITIVE_INFINITY;
      for (const module of this.modules) {
        module.active = false;
        module.stopping = false;
      }
    } else {
      this.banner = undefined;
    }
  }

  /** Schaltet den Verbindungszustand weiter (Testknopf der Seite). */
  public cycleConnection(): ConnectionStatus {
    this.connectionIndex = (this.connectionIndex + 1) % Connections.length;
    return Connections[this.connectionIndex];
  }

  /** Rückt den Mock um dt Sekunden vor. */
  public tick(dt: number): void {
    this.time += dt;
    moveMockEntities(this.entities, this.time, dt);
    if (this.cameraPanning) {
      this.cameraYaw = (this.cameraYaw + dt * PanRadiansPerSecond) % (2 * Math.PI);
    }
    const hourBefore = Math.floor(this.skyHours);
    this.skyHours = (this.skyHours + dt / SecondsPerHour) % 24;
    if (Math.floor(this.skyHours) !== hourBefore && Math.floor(this.skyHours) % 4 === 0) {
      // Alle vier Spielstunden wechselt das Wetter
      this.weatherIndex = (this.weatherIndex + 1) % Weathers.length;
    }
    if (this.scenario !== "flight" && this.scenario !== "ghost") {
      return;
    }
    const warping = this.time < this.warpUntil;
    const ghost = this.scenario === "ghost";
    const cruise = this.throttle * this.maxSpeed * (ghost ? 0.6 : 1);
    const target = warping ? 320 : cruise;
    const step = (warping ? 140 : 9) * dt;
    this.speed += Math.max(-step, Math.min(step, target - this.speed));
    this.heading = (this.heading + Math.sin(this.time * 0.11) * 6 * dt + 360) % 360;
    const radians = (this.heading * Math.PI) / 180;
    this.position.x += Math.sin(radians) * this.speed * dt;
    this.position.z += Math.cos(radians) * this.speed * dt;
    this.position.y += Math.sin(this.time * 0.3) * 0.6 * dt;
    if (!ghost) {
      this.hp = this.maxHp * (0.66 + 0.24 * Math.sin(this.time * 0.35));
      this.tickModules(dt);
      for (const lock of this.targets) {
        lock.lockProgress = Math.min(1, lock.lockProgress + dt / LockSeconds);
      }
    }
    this.energy = Math.min(this.maxEnergy, this.energy + 6 * dt);
    if (this.time >= this.nextLogTime) {
      this.nextLogTime = this.time + 2.6;
      this.pushRandomLog();
    }
    if (this.time > this.bannerUntil) {
      this.banner = undefined;
    }
  }

  /** Baut das HudModel des aktuellen Frames; Markierungen werden auf die Fenstergröße projiziert. */
  public snapshot(width: number, height: number, fps: number): HudModel {
    const started = this.scenario !== "start";
    const docked = this.scenario === "docked";
    const ghost = this.scenario === "ghost";
    const inSpace = started && !docked;
    return {
      connection: Connections[this.connectionIndex],
      started,
      player: started
        ? {
            name: this.playerName,
            hp: ghost ? 0 : this.hp,
            maxHp: this.maxHp,
            energy: this.energy,
            maxEnergy: this.maxEnergy,
            speed: docked ? 0 : this.speed,
            maxSpeed: this.maxSpeed,
            throttle: this.throttle,
            cargo: this.cargo,
            cargoGold: this.cargoGold,
            cargoCapacity: this.cargoCapacity,
            honey: this.honey,
            isGhost: ghost,
            isDocked: docked,
            isWarping: this.time < this.warpUntil,
            position: { ...this.position },
            headingDeg: this.heading,
            commandLabel: this.commandLabel,
          }
        : undefined,
      modules: this.moduleHud(ghost || docked),
      targets: inSpace ? this.targetHud() : [],
      selection: inSpace ? this.selectionHud() : undefined,
      overview: inSpace ? this.entities.map((entity) => this.overviewRow(entity, ghost)) : [],
      brackets: inSpace ? this.bracketHud(width, height) : [],
      log: [...this.log],
      station: docked ? this.stationHud() : undefined,
      sky: this.skyHud(),
      banner: this.banner,
      showHelp: this.showHelp,
      fps,
    };
  }

  // ---------- HudActions ----------

  public start(name: string): void {
    this.trace("start", name);
    this.playerName = name;
    this.setScenario("flight");
    this.showBanner(`Welcome to the sky sphere, ${name}!`, 4);
  }

  public select(ref: EntityRef | undefined): void {
    this.trace("select", ref);
    this.selected = ref;
  }

  public lock(ref: EntityRef): void {
    this.trace("lock", ref);
    if (!this.targets.some((target) => sameEntity(target.ref, ref))) {
      this.targets.push({ ref, lockProgress: 0 });
      this.activeTarget ??= ref;
      const entity = this.entity(ref);
      if (entity?.ref.type === "fly") {
        this.addLog("taunt", `${entity.name}: “${FlyTaunts[this.nextLogId % FlyTaunts.length]}”`);
      }
    }
  }

  public unlock(ref: EntityRef): void {
    this.trace("unlock", ref);
    this.targets = this.targets.filter((target) => !sameEntity(target.ref, ref));
    if (sameEntity(this.activeTarget, ref)) {
      this.activeTarget = this.targets[0]?.ref;
    }
  }

  public setActiveTarget(ref: EntityRef): void {
    this.trace("setActiveTarget", ref);
    this.activeTarget = ref;
  }

  public command(command: FlightCommand, ref?: EntityRef, distance?: number): void {
    this.trace("command", command, ref, distance);
    const entity = ref === undefined ? undefined : this.entity(ref);
    const name = entity?.name ?? "";
    switch (command) {
      case "stop":
        this.throttle = 0;
        this.commandLabel = "Stopping";
        break;
      case "approach":
        this.commandLabel = `Approach: ${name}`;
        break;
      case "orbit":
        this.commandLabel = `Orbit ${formatDistance(distance ?? this.orbitDistance)}: ${name}`;
        break;
      case "keepRange":
        this.commandLabel = `Keep range ${formatDistance(distance ?? this.keepRangeDistance)}: ${name}`;
        break;
      case "align":
        this.commandLabel = `Align: ${name}`;
        break;
      case "warp":
        if (entity !== undefined && entity.distance >= WarpMinDistance) {
          this.warpUntil = this.time + 3;
          this.commandLabel = `Warp: ${name}`;
        } else {
          this.addLog("warning", "Too close to warp – you need at least 150 m.");
        }
        break;
      case "dock":
        if (entity?.ref.type === "hive" && entity.distance <= DockRange) {
          this.setScenario("docked");
        } else {
          this.addLog("warning", "You can only dock at a hive within 45 m.");
        }
        break;
    }
  }

  public setOrbitDistance(distance: number): void {
    this.trace("setOrbitDistance", distance);
    this.orbitDistance = distance;
  }

  public setKeepRangeDistance(distance: number): void {
    this.trace("setKeepRangeDistance", distance);
    this.keepRangeDistance = distance;
  }

  public toggleModule(slot: number): void {
    this.trace("toggleModule", slot);
    const module = this.modules[slot];
    if (module === undefined || this.scenario !== "flight") {
      return;
    }
    if (module.active) {
      module.stopping = !module.stopping;
    } else {
      module.active = true;
      module.progress = 0;
    }
  }

  public setThrottle(throttle: number): void {
    this.trace("setThrottle", throttle);
    this.throttle = throttle;
  }

  public undock(): void {
    this.trace("undock");
    this.setScenario("flight");
    this.showBanner("Undocked. Have a good flight!", 3);
  }

  public deposit(): void {
    this.trace("deposit");
    const value = this.cargo * HoneyPerPollen + this.cargoGold * HoneyPerGoldPollen;
    this.honey += value;
    this.hiveDelivered += value;
    this.cargo = 0;
    this.cargoGold = 0;
  }

  public repair(): void {
    this.trace("repair");
    const cost = this.repairCost();
    if (this.honey >= cost) {
      this.honey -= cost;
      this.hp = this.maxHp;
    }
  }

  public buyUpgrade(kind: string): void {
    this.trace("buyUpgrade", kind);
    const level = this.upgradeLevels.get(kind) ?? 0;
    const cost = UpgradeCosts[level];
    if (cost !== undefined && this.honey >= cost) {
      this.honey -= cost;
      this.upgradeLevels.set(kind, level + 1);
    }
  }

  public setHomeHive(): void {
    this.trace("setHomeHive");
    this.isHome = true;
  }

  public returnHome(): void {
    this.trace("returnHome");
    this.hp = this.maxHp;
    this.setScenario("docked");
  }

  public buzz(): void {
    this.trace("buzz");
    this.addLog("system", "You buzz happily. Everyone nearby hears it.");
  }

  public setQuality(tier: "auto" | "low" | "medium" | "high" | "ultra"): void {
    this.trace("setQuality", tier);
  }

  public setVolume(master: number, music: number): void {
    this.trace("setVolume", master, music);
  }

  public setInvertY(invert: boolean): void {
    this.trace("setInvertY", invert);
  }

  public setReduceFlashes(reduce: boolean): void {
    this.trace("setReduceFlashes", reduce);
  }

  public toggleHelp(): void {
    this.trace("toggleHelp");
    this.showHelp = !this.showHelp;
  }

  public setTyping(typing: boolean): void {
    this.trace("setTyping", typing);
    this.typing = typing;
  }

  // ---------- Modellteile ----------

  private resetFlight(): void {
    const [fly, , bluebottle, , , , , , clover] = this.entities;
    this.targets = [
      { ref: fly.ref, lockProgress: 1 },
      { ref: clover.ref, lockProgress: 1 },
      { ref: bluebottle.ref, lockProgress: 0.25 },
    ];
    this.activeTarget = fly.ref;
    this.selected = fly.ref;
    this.hp = 96;
    this.commandLabel = `Orbit ${formatDistance(this.orbitDistance)}: ${fly.name}`;
    const startActive = [0, 1, 2, 4];
    this.modules.forEach((module, slot) => {
      module.active = startActive.includes(slot);
      module.stopping = slot === 1;
      module.progress = (slot * 0.23) % 1;
    });
  }

  private tickModules(dt: number): void {
    this.modules.forEach((module, slot) => {
      if (!module.active) {
        return;
      }
      module.progress += dt / Modules[slot].cycleSeconds;
      if (module.progress >= 1) {
        module.progress -= 1;
        this.energy = Math.max(0, this.energy - Modules[slot].energyCost);
        if (slot === 4) {
          this.cargo = Math.min(this.cargoCapacity - this.cargoGold, this.cargo + 6);
        }
        if (module.stopping) {
          module.active = false;
          module.stopping = false;
          module.progress = 0;
        }
      }
    });
  }

  private moduleHud(blocked: boolean): ModuleHud[] {
    return Modules.map((info, slot) => {
      const module = this.modules[slot];
      return {
        slot,
        title: info.title,
        hotkey: info.hotkey,
        icon: info.key,
        active: module.active,
        cycleProgress: module.progress,
        available: !blocked && this.energy >= info.energyCost,
        stopping: module.stopping,
        tooltip: ModuleTips[slot],
      };
    });
  }

  private targetHud(): TargetHud[] {
    const result: TargetHud[] = [];
    for (const lock of this.targets) {
      const entity = this.entity(lock.ref);
      if (entity === undefined) {
        continue;
      }
      result.push({
        ref: entity.ref,
        name: entity.name,
        hpRatio: this.hpRatio(entity) ?? 1,
        distance: entity.distance,
        isActive: sameEntity(this.activeTarget, entity.ref),
        lockProgress: lock.lockProgress,
        hostile: entity.hostile,
      });
    }
    return result;
  }

  private selectionHud(): SelectionHud | undefined {
    const entity = this.selected === undefined ? undefined : this.entity(this.selected);
    if (entity === undefined) {
      return undefined;
    }
    return {
      ref: entity.ref,
      name: entity.name,
      typeLabel: entity.typeLabel,
      distance: entity.distance,
      speed: entity.speed,
      hpRatio: this.hpRatio(entity),
      detail: entity.detail,
      canApproach: true,
      canOrbit: true,
      canKeepRange: true,
      canAlign: true,
      canWarp: entity.distance >= WarpMinDistance,
      canDock: entity.ref.type === "hive" && entity.distance <= DockRange,
      canLock: isLockableType(entity.ref.type),
      isLocked: this.isLocked(entity.ref),
      orbitDistance: this.orbitDistance,
      keepRangeDistance: this.keepRangeDistance,
    };
  }

  private overviewRow(entity: MockEntity, ghost: boolean): OverviewRow {
    return {
      ref: entity.ref,
      name: entity.name,
      typeLabel: entity.typeLabel,
      distance: entity.distance,
      speed: entity.speed,
      hostile: entity.hostile,
      isLocked: this.isLocked(entity.ref),
      isSelected: sameEntity(this.selected, entity.ref),
      isAttackingMe: entity.attacking && !ghost,
      tabs: entity.tabs,
    };
  }

  /**
   * Einfache Lochkamera mit 60° Bildwinkel, Blick voraus (+z) und um `cameraYaw` gedreht. Wie im Spiel fehlen
   * Objekte hinter der Kamera; `onScreen` gilt nur innerhalb des Fensters.
   */
  private bracketHud(width: number, height: number): BracketHud[] {
    const focal = height / (2 * Math.tan(Math.PI / 6));
    const cos = Math.cos(this.cameraYaw);
    const sin = Math.sin(this.cameraYaw);
    const result: BracketHud[] = [];
    for (const entity of this.entities) {
      const viewX = entity.x * cos - entity.z * sin;
      const viewZ = entity.x * sin + entity.z * cos;
      if (viewZ <= 0.5) {
        continue;
      }
      const x = width / 2 + (focal * viewX) / viewZ;
      const y = height / 2 - (focal * entity.y) / viewZ;
      const locked = this.isLocked(entity.ref);
      const selected = sameEntity(this.selected, entity.ref);
      result.push({
        ref: entity.ref,
        x,
        y,
        size: (focal * entity.size) / viewZ,
        onScreen: x >= 0 && y >= 0 && x <= width && y <= height,
        name: entity.name,
        distance: entity.distance,
        hpRatio: this.hpRatio(entity),
        isLocked: locked,
        isSelected: selected,
        isActiveTarget: sameEntity(this.activeTarget, entity.ref),
        hostile: entity.hostile,
        showLabel: locked || selected,
      });
    }
    return result;
  }

  private stationHud(): StationHud {
    return {
      hiveId: 1,
      hiveName: "Queen's Hive",
      isHome: this.isHome,
      honeyDelivered: this.hiveDelivered,
      cargo: this.cargo,
      cargoGold: this.cargoGold,
      depositValue: this.cargo * HoneyPerPollen + this.cargoGold * HoneyPerGoldPollen,
      honey: this.honey,
      hp: this.hp,
      maxHp: this.maxHp,
      repairCost: this.repairCost(),
      upgrades: Upgrades.map((upgrade) => {
        const level = this.upgradeLevels.get(upgrade.kind) ?? 0;
        const cost = level < MaxUpgradeLevel ? UpgradeCosts[level] : undefined;
        return { kind: upgrade.kind, title: upgrade.title, effect: upgrade.effect, level, maxLevel: MaxUpgradeLevel, cost, affordable: cost !== undefined && this.honey >= cost };
      }),
      quests: Quests.filter((quest) => quest.id <= 5 || quest.repeatable).map((quest) => {
        const done = quest.id <= 3;
        const progress = done ? quest.goal : quest.id === 4 ? 2 : quest.id === 5 ? 18 : quest.id === 101 ? 64 : 3;
        return {
          id: quest.id,
          title: quest.title,
          brief: quest.brief,
          progress,
          goal: quest.goal,
          reward: quest.reward,
          completed: done,
          repeatable: quest.repeatable,
          completions: quest.id === 101 ? 2 : 0,
        };
      }),
      leaderboard: LeaderboardNames.map((name, index) => ({
        rank: index + 1,
        name: name === "" ? this.playerName : name,
        honey: Math.round(52_000 / (index + 1.2)),
        kills: Math.round(240 / (index + 1)),
        isSelf: name === "",
      })),
      achievements: AchievementList.map((achievement, index) => ({
        key: achievement.key,
        title: achievement.title,
        description: achievement.description,
        earned: index < 3,
      })),
    };
  }

  private skyHud(): SkyHud {
    const hours = Math.floor(this.skyHours);
    const minutes = Math.floor((this.skyHours - hours) * 60);
    const phase = dayPhase(this.skyHours);
    const weather = Weathers[this.weatherIndex];
    return {
      clock: `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`,
      phase: phase.icon,
      phaseLabel: phase.label,
      weather: weather.icon,
      weatherLabel: weather.label,
      isNight: phase.icon === "night",
    };
  }

  // ---------- Hilfen ----------

  private pushRandomLog(): void {
    const fly = this.entities[0];
    const patterns: ReadonlyArray<() => void> = [
      () => this.addLog("combat", `Left laser eye hits the ${fly.name}: 11 damage.`),
      () => this.addLog("loot", "+6 pollen from the Clover Field."),
      () => this.addLog("taunt", `${fly.name}: “${FlyTaunts[this.logCursor % FlyTaunts.length]}”`),
      () => this.addLog("combat", `The ${fly.name} spits at you: 6 damage.`),
      () => this.addLog("quest", "Pollen Sample: 24 of 30 pollen collected."),
      () => this.addLog("system", "Bumble Betty is flying nearby."),
      () => this.addLog("warning", "Your basket is almost full – time to fly home?"),
      () => this.addLog("loot", "Blowfly defeated: +8 honey."),
    ];
    patterns[this.logCursor % patterns.length]();
    this.logCursor++;
  }

  private addLog(kind: LogEntry["kind"], text: string): void {
    this.log.push({ id: this.nextLogId++, time: Date.now(), text, kind });
    if (this.log.length > 40) {
      this.log.shift();
    }
  }

  private showBanner(text: string, seconds: number): void {
    this.banner = text;
    this.bannerUntil = this.time + seconds;
  }

  private entity(ref: EntityRef): MockEntity | undefined {
    return this.entities.find((entity) => sameEntity(entity.ref, ref));
  }

  private isLocked(ref: EntityRef): boolean {
    return this.targets.some((target) => sameEntity(target.ref, ref) && target.lockProgress >= 1);
  }

  private hpRatio(entity: MockEntity): number | undefined {
    if (entity.maxHp === undefined) {
      return undefined;
    }
    const wobble = 0.5 + 0.45 * Math.sin(this.time * 0.25 + entity.ref.id);
    return entity.ref.type === "fly" ? Math.max(0.05, wobble) : 0.85;
  }

  private repairCost(): number {
    return Math.ceil(Math.max(0, this.maxHp - this.hp) / HpPerHoney);
  }

  private trace(action: string, ...args: unknown[]): void {
    console.info(`[HUD action] ${action}`, ...args);
  }
}
