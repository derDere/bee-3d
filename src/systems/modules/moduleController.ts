import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { EntityKinds } from "../../../shared/events";
import {
  CollectorRange,
  ModuleSlotCount,
  ModuleSlots,
  Modules,
  collectorYield,
  energyAt,
  gatlingStats,
  laserStats,
  moduleCycleSeconds,
  moduleRange,
  stingerRange,
  stingerStats,
  type BeeStats,
  type ModuleInfo,
  type UpgradeLevels,
} from "../../../shared/rules";
import type { FrameSystem } from "../../core/gameLoop";
import type { ModuleHud } from "../../hud/hudTypes";
import type { MyModuleRow, MyStatsRow } from "../../net/bindings/types";
import type { SpaceObject } from "../targeting/spaceObjects";

/** Was der Modulregler vom Spiel braucht (Modulumgebung). */
export interface ModuleEnvironment {
  /** Schaltet ein Modul auf dem Server ein (Ziel als Objektart und ID). */
  activate(slot: number, targetKind: number, targetId: number): void;
  /** Schaltet ein Modul nach dem laufenden Zyklus aus. */
  deactivate(slot: number): void;
  readonly modules: () => readonly MyModuleRow[];
  readonly stats: () => MyStatsRow | undefined;
  readonly beeStats: () => BeeStats;
  readonly levels: () => UpgradeLevels;
  readonly origin: () => Vector3;
  readonly activeTarget: () => SpaceObject | undefined;
  readonly selected: () => SpaceObject | undefined;
  readonly worldSeconds: () => number;
  /** Module offline (angedockt, Geist, Warp). */
  readonly offline: () => string | undefined;
  readonly notice: (text: string) => void;
}

interface CycleClock {
  nextCycleAtMs: bigint;
  startedAtMs: number;
}

/**
 * Modulleiste F1–F8 nach EVE-Vorbild (Modulregler): schaltet Module über den Server ein und aus, wählt das
 * Ziel nach Modulart (aktives Ziel, Blumenfeld, selbst) und liefert die Anzeige samt Zyklusfortschritt.
 */
export class ModuleController implements FrameSystem {
  private readonly env: ModuleEnvironment;
  private readonly cycles = new Map<number, CycleClock>();
  private readonly hudRows: ModuleHud[] = [];

  public constructor(env: ModuleEnvironment) {
    this.env = env;
  }

  public isActive(slot: number): boolean {
    return this.env.modules().some((row) => row.slot === slot);
  }

  /** Laufende Aktivierung eines Platzes (Ziel für Effekte). */
  public activation(slot: number): MyModuleRow | undefined {
    return this.env.modules().find((row) => row.slot === slot);
  }

  /** Schaltet ein Modul ein oder (nach dem laufenden Zyklus) aus. */
  public toggle(slot: number): void {
    const running = this.activation(slot);
    if (running !== undefined && !running.stopAfterCycle) {
      this.env.deactivate(slot);
      return;
    }
    this.activateOn(slot, this.defaultTarget(Modules[slot]));
  }

  /** Beendet ein laufendes Modul nach dem Zyklus. */
  public stop(slot: number): void {
    const running = this.activation(slot);
    if (running !== undefined && !running.stopAfterCycle) {
      this.env.deactivate(slot);
    }
  }

  /** Aktiviert ein Modul auf ein bestimmtes Ziel (freies Zielen, Zielwechsel). */
  public activateOn(slot: number, target: SpaceObject | undefined): void {
    const info = Modules[slot];
    if (info === undefined) {
      return;
    }
    const reason = this.env.offline();
    if (reason !== undefined) {
      this.env.notice(reason);
      return;
    }
    if (info.target === "self") {
      this.env.activate(slot, EntityKinds.bee, 0);
      return;
    }
    if (target === undefined) {
      this.env.notice(info.target === "enemy" ? `${info.title}: no locked enemy target.` : `${info.title}: select a flower patch within ${CollectorRange} m.`);
      return;
    }
    const range = moduleRange(slot, this.env.levels());
    const distance = Vector3.Distance(target.position, this.env.origin()) - (info.target === "flowerPatch" ? target.radius : 0);
    if (distance > range) {
      this.env.notice(`${info.title}: ${target.name} is out of range (${Math.round(distance)} m of ${Math.round(range)} m).`);
      return;
    }
    const kind = target.ref.type === "fly" ? EntityKinds.fly : EntityKinds.flowerPatch;
    this.env.activate(slot, kind, target.ref.id);
  }

  public frameUpdate(): void {
    const now = performance.now();
    for (const row of this.env.modules()) {
      const clock = this.cycles.get(row.slot);
      if (clock === undefined || clock.nextCycleAtMs !== row.nextCycleAtMs) {
        this.cycles.set(row.slot, { nextCycleAtMs: row.nextCycleAtMs, startedAtMs: now });
      }
    }
  }

  /** Anzeige der Modulleiste. */
  public hud(): readonly ModuleHud[] {
    const levels = this.env.levels();
    const stats = this.env.stats();
    const energy = stats === undefined ? this.env.beeStats().maxEnergy : energyAt(stats.energy, stats.energyAt, this.env.beeStats(), this.env.worldSeconds());
    const offline = this.env.offline() !== undefined;
    const now = performance.now();
    this.hudRows.length = 0;
    for (let slot = 0; slot < ModuleSlotCount; slot++) {
      const info = Modules[slot];
      if (info === undefined) {
        continue;
      }
      const row = this.activation(slot);
      const clock = this.cycles.get(slot);
      const cycleMs = moduleCycleSeconds(slot, levels) * 1000;
      const progress = row !== undefined && clock !== undefined ? Math.min(1, (now - clock.startedAtMs) / cycleMs) : 0;
      this.hudRows.push({
        slot,
        title: info.title,
        hotkey: info.hotkey,
        icon: info.key,
        active: row !== undefined,
        cycleProgress: progress,
        available: !offline && energy >= info.energyCost && (stats === undefined || info.pollenCost <= stats.cargo + stats.cargoGold),
        stopping: row?.stopAfterCycle ?? false,
        tooltip: this.tooltip(info, levels),
      });
    }
    return this.hudRows;
  }

  /** Ziel nach Modulart: Waffen auf das aktive Ziel, der Sammler auf ein Blumenfeld. */
  private defaultTarget(info: ModuleInfo | undefined): SpaceObject | undefined {
    if (info === undefined) {
      return undefined;
    }
    const active = this.env.activeTarget();
    const selected = this.env.selected();
    if (info.target === "enemy") {
      return active?.ref.type === "fly" ? active : undefined;
    }
    if (info.target === "flowerPatch") {
      if (active?.ref.type === "flowerPatch") {
        return active;
      }
      return selected?.ref.type === "flowerPatch" ? selected : undefined;
    }
    return undefined;
  }

  private tooltip(info: ModuleInfo, levels: UpgradeLevels): string {
    const energy = info.energyCost > 0 ? ` · ${info.energyCost} energy` : "";
    const pollen = info.pollenCost > 0 ? ` · ${info.pollenCost} pollen per cycle` : "";
    const cycle = `Cycle ${formatSeconds(moduleCycleSeconds(info.slot, levels))} s${energy}${pollen}`;
    switch (info.slot) {
      case ModuleSlots.laserLeft:
      case ModuleSlots.laserRight: {
        const laser = laserStats(levels);
        return `${info.title} (${info.hotkey}) — ${laser.damage.toFixed(1)} damage, optimal ${Math.round(laser.optimal)} m, falloff ${laser.falloff} m, tracking ${laser.tracking} rad/s. ${cycle}. Each eye fires at its own target.`;
      }
      case ModuleSlots.gatling: {
        const gatling = gatlingStats(levels);
        return `${info.title} (${info.hotkey}) — ${gatling.shots} × ${gatling.damage} damage from all six legs, optimal ${gatling.optimal} m, falloff ${gatling.falloff} m, tracking ${gatling.tracking} rad/s. ${cycle}.`;
      }
      case ModuleSlots.stinger: {
        const stinger = stingerStats(levels);
        return `${info.title} (${info.hotkey}) — ${stinger.count} homing stingers × ${stinger.damage} damage, ${stinger.speed} m/s for ${stinger.flightSeconds} s (range ${stingerRange(levels)} m), explosion radius ${stinger.explosionRadius} m, explosion velocity ${stinger.explosionVelocity} m/s. ${cycle}.`;
      }
      case ModuleSlots.collector:
        return `${info.title} (${info.hotkey}) — ${collectorYield(levels)} pollen per cycle from a flower patch within ${CollectorRange} m, more at night. ${cycle}.`;
      case ModuleSlots.boost:
        return `${info.title} (${info.hotkey}) — double speed while active. ${cycle}.`;
      case ModuleSlots.repair:
        return `${info.title} (${info.hotkey}) — heals hit points with nectar. ${cycle}.`;
      case ModuleSlots.scanner:
        return `${info.title} (${info.hotkey}) — reveals gold flowers and nests within 2 km. ${cycle}.`;
      default:
        return info.title;
    }
  }
}

/** Sekunden mit höchstens zwei Nachkommastellen, ohne überflüssige Nullen (0.45, 0.5, 8). */
function formatSeconds(seconds: number): string {
  return String(Number(seconds.toFixed(2)));
}
