import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { ModuleSlots, flyInfo, laserStats } from "../../../shared/rules";
import { hiveDockPoint, type HivePlacement } from "../../../shared/worldgen";
import { WarpMinDistance } from "../../../shared/world";
import type { CommandTarget, TargetSource } from "../../entities/player/flightController";
import type { PlayerBee } from "../../entities/player/playerBee";
import type { ContextMenuEntry, EntityRef, FlightCommand } from "../../hud/hudTypes";
import type { AudioApi } from "../audio/audioTypes";
import type { GameLog } from "../gameLog";
import type { ModuleController } from "../modules/moduleController";
import { refKey, type SpaceObject, type SpaceObjects } from "../targeting/spaceObjects";
import type { Targeting } from "../targeting/targeting";

/** Was die Befehlszentrale vom Spiel braucht (Befehlsumgebung). */
export interface CommandEnvironment {
  readonly player: PlayerBee;
  readonly objects: SpaceObjects;
  readonly targeting: Targeting;
  readonly modules: ModuleController;
  readonly log: GameLog;
  readonly audio: AudioApi;
  readonly hives: readonly HivePlacement[];
  /** Heimatstock des Spielers. */
  homeHive(): number;
  /** Andockpunkt eines Stocks (Weltlage vor dem Flugloch). */
  dockPoint(hiveId: number): Vector3;
  /** Ob der Server die Biene führt (sonst Erkundungsmodus). */
  online(): boolean;
  /** Freies Zielen beginnt: Laserstrahlen in Zielrichtung zeigen, solange es dauert. */
  startFreeAimBeams(): void;
  /** Objekt, das die Kamera ansieht; undefined = eigene Biene (Ansehen). */
  lookTarget(): EntityRef | undefined;
  /** Richtet die Kamera auf ein Objekt oder zurück auf die eigene Biene (Ansehen). */
  lookAt(ref: EntityRef | undefined): void;
  showContextMenu(x: number, y: number, entries: readonly ContextMenuEntry[], title?: string): void;
}

const OrbitChoices = [10, 20, 40, 80] as const;
const KeepRangeChoices = [5, 15, 30, 60] as const;
/** Winkel um den Mauszeiger, in dem das freie Zielen eine Fliege erfasst (rad). */
const FreeAimCone = (3.5 * Math.PI) / 180;
/** Ein Warp zu einem Fliegennest endet so weit davor, außerhalb des Schwarms (Meter). */
const NestWarpStandoff = 180;

/**
 * Befehlszentrale (Befehle): übersetzt Klicks, Tasten und HUD-Knöpfe in Flugbefehle nach EVE-Vorbild,
 * Aufschaltungen und Modulaktivierungen. Ziele werden als Quellen übergeben, damit Befehle beweglichen
 * Objekten folgen und bei verschwundenen Zielen nach EVE-Regeln enden.
 */
export class CommandCenter {
  private readonly env: CommandEnvironment;
  public orbitDistance: number = OrbitChoices[1];
  public keepRangeDistance: number = KeepRangeChoices[1];
  private freeAimTarget: string | undefined;
  private freeAimActive = false;
  private dockHive: number | undefined;
  private readonly scratch = new Vector3();

  public constructor(env: CommandEnvironment) {
    this.env = env;
  }

  /** Stock, an dem gerade angedockt werden soll. */
  public get pendingDockHive(): number | undefined {
    return this.dockHive;
  }

  /** Andocken abgeschlossen oder abgebrochen: kein erneutes Andocken nach dem Abdocken. */
  public finishDocking(): void {
    this.dockHive = undefined;
  }

  public get isFreeAiming(): boolean {
    return this.freeAimActive;
  }

  // ---------- Auswahl und Ziele ----------

  public select(ref: EntityRef | undefined): void {
    this.env.targeting.select(ref);
    if (ref !== undefined) {
      this.env.audio.playUi("click");
    }
  }

  public lock(ref: EntityRef): void {
    const result = this.env.targeting.lock(ref);
    const object = this.env.objects.get(refKey(ref));
    const name = object?.name ?? "Target";
    switch (result) {
      case "started":
        this.env.audio.playUi("lock");
        break;
      case "notLockable":
        this.env.log.add(`${name} can't be locked.`, "system");
        break;
      case "outOfRange":
        this.env.log.add(`${name} is beyond lock range (${Math.round(this.env.player.stats.lockRange)} m).`, "warning");
        this.env.audio.playUi("error");
        break;
      case "tooMany":
        this.env.log.add(`At most ${this.env.player.stats.maxLocks} targets at once — Feeler Antennae add more.`, "warning");
        this.env.audio.playUi("error");
        break;
      default:
        break;
    }
  }

  public unlock(ref: EntityRef): void {
    this.env.targeting.unlock(ref);
  }

  public setActiveTarget(ref: EntityRef): void {
    this.env.targeting.setActive(ref);
  }

  /** Tab: nächstes aufgeschaltetes Ziel wird aktiv. */
  public cycleTarget(): void {
    const locks = this.env.targeting.locks.filter((lock) => lock.progress >= 1);
    if (locks.length === 0) {
      return;
    }
    const active = this.env.targeting.activeTarget;
    const index = locks.findIndex((lock) => lock.key === active?.key);
    const next = locks[(index + 1) % locks.length];
    if (next !== undefined) {
      this.env.targeting.setActive(next.ref);
    }
  }

  public setOrbitDistance(distance: number): void {
    this.orbitDistance = distance;
  }

  public setKeepRangeDistance(distance: number): void {
    this.keepRangeDistance = distance;
  }

  // ---------- Flugbefehle ----------

  /** Flugbefehl auf ein Objekt; ohne Objekt auf die Auswahl. */
  public command(command: FlightCommand, ref?: EntityRef, distance?: number): void {
    const controller = this.env.player.controller;
    if (this.env.player.condition.docked) {
      this.env.log.add("Undock first.", "system");
      return;
    }
    if (command === "stop") {
      this.dockHive = undefined;
      controller.stop();
      return;
    }
    const object = ref !== undefined ? this.env.objects.get(refKey(ref)) : this.env.targeting.selected;
    if (object === undefined) {
      this.env.log.add("Nothing selected.", "system");
      return;
    }
    const source = this.env.objects.source(object.ref);
    this.dockHive = undefined;
    switch (command) {
      case "approach":
        controller.approach(source, object.name);
        break;
      case "orbit":
        controller.orbit(source, distance ?? this.orbitDistance, object.name);
        break;
      case "keepRange":
        controller.keepRange(source, distance ?? this.keepRangeDistance, object.name);
        break;
      case "align":
        controller.align(source, object.name);
        break;
      case "warp":
        this.warpTo(object, source);
        break;
      case "dock":
        this.dockAt(object);
        break;
    }
  }

  public flyDirection(direction: Vector3): void {
    if (this.env.player.condition.docked) {
      return;
    }
    this.dockHive = undefined;
    this.env.player.controller.flyDirection(direction);
  }

  public flyToPoint(point: Vector3): void {
    if (this.env.player.condition.docked) {
      return;
    }
    this.dockHive = undefined;
    this.env.player.controller.flyToPoint(point);
  }

  public changeThrottle(delta: number): void {
    this.setThrottle(this.env.player.controller.throttle + delta);
  }

  public setThrottle(throttle: number): void {
    const controller = this.env.player.controller;
    controller.throttle = Math.max(0, Math.min(1, throttle));
    if (controller.command === "idle" && controller.throttle > 0.05) {
      controller.flyDirection(controller.heading);
    }
  }

  public steer(yaw: number, pitch: number): void {
    if (!this.env.player.condition.docked) {
      this.env.player.controller.steer(yaw, pitch);
    }
  }

  /** Geister warpen ohne Mindestabstand zum Heimatstock, alle anderen fliegen per Warp heim. */
  public returnHome(): void {
    const hiveId = this.env.homeHive();
    const hive = this.env.hives[hiveId];
    if (hive === undefined) {
      return;
    }
    const dockPoint = this.env.dockPoint(hiveId);
    const target = this.fixedTarget(dockPoint, 0);
    const ghost = this.env.player.condition.ghost;
    const distance = Vector3.Distance(this.env.player.position, dockPoint);
    if (distance < WarpMinDistance && !ghost) {
      this.dockAt(this.env.objects.get(`hive:${hiveId}`), hiveId);
      return;
    }
    if (this.env.player.controller.warp(target, hive.name, ghost)) {
      this.dockHive = hiveId; // nach dem Warp automatisch andocken
    }
  }

  /** Je Frame: nach einem Heimweg-Warp schließt das Andocken an. */
  public update(): void {
    const hiveId = this.dockHive;
    const controller = this.env.player.controller;
    if (hiveId === undefined || controller.command !== "idle" || controller.warpPhase !== undefined || this.env.player.condition.docked) {
      return;
    }
    if (Vector3.Distance(this.env.player.position, this.env.dockPoint(hiveId)) < 60) {
      this.dockAt(this.env.objects.get(`hive:${hiveId}`), hiveId);
    } else {
      this.dockHive = undefined;
    }
  }

  // ---------- Kontextmenü ----------

  /** Kontextmenü für ein Objekt oder den Raum in Blickrichtung. */
  public contextMenu(x: number, y: number, ref: EntityRef | undefined, direction: Vector3): void {
    const object = ref === undefined ? undefined : this.env.objects.get(refKey(ref));
    const entries: ContextMenuEntry[] = [];
    if (object === undefined) {
      entries.push({ icon: "flyHere", label: "Fly this way", enabled: true, run: () => this.flyDirection(direction) });
      entries.push({ icon: "stop", label: "Stop", hotkey: "Space", enabled: true, run: () => this.command("stop") });
      entries.push({ icon: "home", label: "Return home", enabled: true, run: () => this.returnHome() });
      this.env.showContextMenu(x, y, entries);
      return;
    }
    const distance = Vector3.Distance(object.position, this.env.player.position) - object.radius;
    const locked = this.env.targeting.hasLock(object.key);
    entries.push({ icon: "select", label: `Select ${object.name}`, enabled: true, run: () => this.select(object.ref) });
    entries.push({ icon: "approach", label: "Approach", hotkey: "Q", enabled: true, run: () => this.command("approach", object.ref) });
    // Je ein Blatt mit dem eingestellten Abstand; andere Abstände bietet der Befehlsring der Auswahl an
    const orbit = this.orbitDistance;
    const keep = this.keepRangeDistance;
    entries.push({ icon: "orbit", label: `Orbit at ${orbit} m`, detail: `${orbit} m`, hotkey: "W", enabled: true, run: () => this.command("orbit", object.ref, orbit) });
    entries.push({ icon: "keepRange", label: `Keep range at ${keep} m`, detail: `${keep} m`, hotkey: "E", enabled: true, run: () => this.command("keepRange", object.ref, keep) });
    entries.push({ icon: "align", label: "Align", hotkey: "A", enabled: true, run: () => this.command("align", object.ref) });
    entries.push({ icon: "warp", label: "Warp", hotkey: "S", enabled: distance >= WarpMinDistance, run: () => this.command("warp", object.ref) });
    if (object.ref.type === "hive") {
      entries.push({ icon: "dock", label: "Dock", hotkey: "D", enabled: true, run: () => this.command("dock", object.ref) });
    }
    const watched = this.env.lookTarget();
    const looking = watched !== undefined && refKey(watched) === object.key;
    entries.push(
      looking
        ? { icon: "lookAt", label: "Look at my bee", enabled: true, active: true, run: () => this.env.lookAt(undefined) }
        : { icon: "lookAt", label: `Look at ${object.name}`, enabled: true, run: () => this.env.lookAt(object.ref) },
    );
    if (object.lockable) {
      entries.push(
        locked
          ? { icon: "unlock", label: "Unlock target", hotkey: "Ctrl+Shift+Click", enabled: true, run: () => this.unlock(object.ref) }
          : { icon: "lock", label: "Lock target", hotkey: "Ctrl+Click", enabled: true, run: () => this.lock(object.ref) },
      );
    }
    this.env.showContextMenu(x, y, entries, object.name);
  }

  // ---------- Freies Zielen ----------

  /**
   * Alt + Maus bzw. rechter Touch-Stick: beide Laseraugen feuern in die Zielrichtung; liegt dort eine
   * Fliege in Reichweite, treffen sie diese ohne Aufschalten.
   */
  public freeAim(active: boolean, direction: Vector3): void {
    const player = this.env.player;
    if (!active) {
      if (this.freeAimActive) {
        this.freeAimActive = false;
        player.freeAim = false;
        if (this.freeAimTarget !== undefined) {
          this.env.modules.stop(ModuleSlots.laserLeft);
          this.env.modules.stop(ModuleSlots.laserRight);
        }
        this.freeAimTarget = undefined;
      }
      return;
    }
    if (player.condition.docked || player.condition.ghost) {
      return;
    }
    if (!this.freeAimActive) {
      this.env.startFreeAimBeams();
    }
    this.freeAimActive = true;
    player.freeAim = true;
    player.aimDirection.copyFrom(direction).normalize();
    const fly = this.flyAlong(player.position, player.aimDirection);
    const key = fly?.key;
    if (key !== this.freeAimTarget && fly !== undefined) {
      this.env.modules.activateOn(ModuleSlots.laserLeft, fly);
      this.env.modules.activateOn(ModuleSlots.laserRight, fly);
      this.freeAimTarget = key;
    }
  }

  // ---------- Hilfen ----------

  private warpTo(object: SpaceObject, source: TargetSource): void {
    const controller = this.env.player.controller;
    if (object.ref.type === "hive") {
      // Warp zum Stock endet vor dem Flugloch
      const target = this.fixedTarget(this.env.dockPoint(object.ref.id), 0);
      controller.warp(target, object.name, this.env.player.condition.ghost && object.ref.id === this.env.homeHive());
      return;
    }
    if (object.ref.type === "nest") {
      // Warp zum Nest endet mit Abstand: erst umsehen, dann angreifen
      const standoff = object.position.subtract(this.env.player.position).normalize().scaleInPlace(-NestWarpStandoff).addInPlace(object.position);
      controller.warp(this.fixedTarget(standoff, 0), object.name);
      return;
    }
    controller.warp(source, object.name);
  }

  private dockAt(object: SpaceObject | undefined, hiveId = object?.ref.id): void {
    if (object === undefined || object.ref.type !== "hive" || hiveId === undefined) {
      this.env.log.add("You can only dock at hives.", "system");
      return;
    }
    if (!this.env.online()) {
      this.env.log.add("Docking needs a connection to the bee server.", "warning");
      return;
    }
    this.dockHive = hiveId;
    this.env.player.controller.dock(this.fixedTarget(this.env.dockPoint(hiveId), 0), object.name);
  }

  /** Feste Zielquelle an einem Punkt (Andockpunkt, Warp-Landepunkt). */
  private fixedTarget(point: Vector3, radius: number): TargetSource {
    const target: CommandTarget = { position: point.clone(), velocity: Vector3.Zero(), radius };
    return () => target;
  }

  /** Fliege in Laserreichweite, die dem Zielstrahl am nächsten liegt. */
  private flyAlong(origin: Vector3, direction: Vector3): SpaceObject | undefined {
    const laser = laserStats(this.env.player.levels);
    const range = laser.optimal + 2 * laser.falloff;
    let best: SpaceObject | undefined;
    let bestAngle = FreeAimCone;
    for (const object of this.env.objects.all()) {
      if (object.ref.type !== "fly") {
        continue;
      }
      object.position.subtractToRef(origin, this.scratch);
      const distance = this.scratch.length();
      if (distance > range || distance < 1e-3) {
        continue;
      }
      const size = Math.atan(Math.max(object.radius, flyInfo(0).length * 0.5) / distance);
      const angle = Math.acos(Math.max(-1, Math.min(1, Vector3.Dot(this.scratch, direction) / distance))) - size;
      if (angle < bestAngle) {
        bestAngle = angle;
        best = object;
      }
    }
    return best;
  }
}

/** Andockpunkt eines Stocks als Weltvektor. */
export function dockPointOf(hive: HivePlacement): Vector3 {
  const point = hiveDockPoint(hive, 3);
  return new Vector3(point.x, point.y, point.z);
}
