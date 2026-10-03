import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { WarpMinDistance } from "../../../shared/world";
import type {
  BracketHud,
  ConnectionStatus,
  EntityRef,
  HudModel,
  ModuleHud,
  OverviewRow,
  PlayerHud,
  SelectionHud,
  SkyHud,
  StationHud,
  TargetHud,
} from "../../hud/hudTypes";
import type { GameLog } from "../gameLog";
import type { ScreenPoint, ScreenProjector } from "../screenProjector";
import type { SpaceObject, SpaceObjects } from "../targeting/spaceObjects";
import type { Targeting } from "../targeting/targeting";

/** Wie weit Klammern je Objektart erscheinen (Meter). */
const BracketRanges: Readonly<Record<string, number>> = {
  fly: 900,
  bee: 900,
  flowerPatch: 260,
  hive: Number.POSITIVE_INFINITY,
  nest: 4000,
  island: 160,
};
const MaxOverviewRows = 80;
const MinBracketPixels = 14;

/** Quellen des HUD-Modells (HUD-Quellen). */
export interface HudSources {
  readonly objects: SpaceObjects;
  readonly targeting: Targeting;
  readonly projector: ScreenProjector;
  readonly log: GameLog;
  connection(): ConnectionStatus;
  started(): boolean;
  origin(): Vector3;
  player(): PlayerHud | undefined;
  modules(): readonly ModuleHud[];
  station(): StationHud | undefined;
  sky(): SkyHud;
  banner(): string | undefined;
  showHelp(): boolean;
  fps(): number;
  lookAt(): EntityRef | undefined;
  orbitDistance(): number;
  keepRangeDistance(): number;
  isDocked(): boolean;
}

/**
 * Baut je Frame das HUD-Modell aus dem Spielzustand (HUD-Aufbereitung): Overview nach Entfernung,
 * Raumklammern in Bildschirmpixeln, Ziele, Auswahl, Modulleiste und Stationsmenü.
 */
export class HudPresenter {
  private readonly sources: HudSources;
  private readonly screen: ScreenPoint = { x: 0, y: 0, depth: 0, onScreen: false };

  public constructor(sources: HudSources) {
    this.sources = sources;
  }

  public build(): HudModel {
    const s = this.sources;
    s.projector.update();
    const origin = s.origin();
    const docked = s.isDocked();
    const entries = docked ? [] : this.sortedObjects(origin);
    return {
      connection: s.connection(),
      started: s.started(),
      player: s.player(),
      modules: s.modules(),
      targets: docked ? [] : this.targets(origin),
      selection: docked ? undefined : this.selection(origin),
      overview: entries.slice(0, MaxOverviewRows).map((entry) => this.overviewRow(entry.object, entry.distance)),
      brackets: docked ? [] : this.brackets(entries),
      log: s.log.entries,
      station: s.station(),
      sky: s.sky(),
      banner: s.banner(),
      showHelp: s.showHelp(),
      fps: s.fps(),
      lookAt: s.lookAt(),
    };
  }

  /** Nächstes Objekt nahe einem Bildschirmpunkt (für Klicks in den Raum). */
  public objectAt(x: number, y: number, radiusPx = 22): SpaceObject | undefined {
    const s = this.sources;
    s.projector.update();
    const origin = s.origin();
    let best: SpaceObject | undefined;
    let bestScore = Number.POSITIVE_INFINITY;
    for (const object of s.objects.all()) {
      const distance = Vector3.Distance(object.position, origin);
      if (distance > (BracketRanges[object.ref.type] ?? 0) && s.targeting.selected !== object) {
        continue;
      }
      s.projector.project(object.position, this.screen);
      if (!this.screen.onScreen) {
        continue;
      }
      const size = Math.max(MinBracketPixels, s.projector.pixelSize(object.radius, this.screen.depth));
      const offset = Math.hypot(this.screen.x - x, this.screen.y - y);
      if (offset > Math.max(radiusPx, size * 0.5)) {
        continue;
      }
      // Nahe Objekte und kleine Abstände zum Mauszeiger gewinnen
      const score = offset + this.screen.depth * 0.002;
      if (score < bestScore) {
        bestScore = score;
        best = object;
      }
    }
    return best;
  }

  private sortedObjects(origin: Vector3): Array<{ object: SpaceObject; distance: number }> {
    const entries: Array<{ object: SpaceObject; distance: number }> = [];
    for (const object of this.sources.objects.all()) {
      entries.push({ object, distance: Math.max(0, Vector3.Distance(object.position, origin) - object.radius) });
    }
    return entries.sort((a, b) => a.distance - b.distance);
  }

  private overviewRow(object: SpaceObject, distance: number): OverviewRow {
    const targeting = this.sources.targeting;
    return {
      ref: object.ref,
      name: object.name,
      typeLabel: object.typeLabel,
      distance,
      speed: object.velocity.length(),
      hostile: object.hostile,
      isLocked: targeting.hasLock(object.key),
      isSelected: targeting.selected === object,
      isAttackingMe: object.attackingMe,
      tabs: object.tabs,
    };
  }

  private targets(origin: Vector3): TargetHud[] {
    const s = this.sources;
    const active = s.targeting.activeTarget;
    const rows: TargetHud[] = [];
    for (const lock of s.targeting.locks) {
      const object = s.objects.get(lock.key);
      if (object === undefined) {
        continue;
      }
      rows.push({
        ref: lock.ref,
        name: object.name,
        hpRatio: object.hpRatio ?? 1,
        distance: Math.max(0, Vector3.Distance(object.position, origin) - object.radius),
        isActive: active === object,
        lockProgress: lock.progress,
        hostile: object.hostile,
      });
    }
    return rows;
  }

  private selection(origin: Vector3): SelectionHud | undefined {
    const s = this.sources;
    const object = s.targeting.selected;
    if (object === undefined) {
      return undefined;
    }
    const distance = Math.max(0, Vector3.Distance(object.position, origin) - object.radius);
    return {
      ref: object.ref,
      name: object.name,
      typeLabel: object.typeLabel,
      distance,
      speed: object.velocity.length(),
      hpRatio: object.hpRatio,
      detail: object.detail,
      canApproach: true,
      canOrbit: true,
      canKeepRange: true,
      canAlign: true,
      canWarp: distance >= WarpMinDistance,
      canDock: object.ref.type === "hive",
      canLock: object.lockable && !s.targeting.hasLock(object.key),
      isLocked: s.targeting.hasLock(object.key),
      orbitDistance: s.orbitDistance(),
      keepRangeDistance: s.keepRangeDistance(),
    };
  }

  private brackets(entries: ReadonlyArray<{ object: SpaceObject; distance: number }>): BracketHud[] {
    const s = this.sources;
    const active = s.targeting.activeTarget;
    const brackets: BracketHud[] = [];
    for (const { object, distance } of entries) {
      const selected = s.targeting.selected === object;
      const locked = s.targeting.hasLock(object.key);
      if (distance > (BracketRanges[object.ref.type] ?? 0) && !selected && !locked) {
        continue;
      }
      s.projector.project(object.position, this.screen);
      if (this.screen.depth <= 0) {
        continue;
      }
      const size = Math.max(MinBracketPixels, s.projector.pixelSize(object.radius, this.screen.depth));
      const showLabel = selected || locked || object.attackingMe || (object.ref.type === "hive" && distance < 2500) || (object.hostile && object.ref.type === "fly" && distance < 120);
      brackets.push({
        ref: object.ref,
        x: this.screen.x,
        y: this.screen.y,
        size,
        onScreen: this.screen.onScreen,
        name: object.name,
        distance,
        hpRatio: object.ref.type === "bee" || object.ref.type === "fly" ? object.hpRatio : undefined,
        isLocked: locked,
        isSelected: selected,
        isActiveTarget: active === object,
        hostile: object.hostile,
        showLabel,
      });
    }
    return brackets;
  }
}
