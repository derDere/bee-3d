import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { BeeStats } from "../../../shared/rules";
import type { FrameSystem } from "../../core/gameLoop";
import type { EntityRef } from "../../hud/hudTypes";
import { refKey, type SpaceObject, type SpaceObjects } from "./spaceObjects";

/** Laufende oder fertige Aufschaltung eines Ziels (Aufschaltung). */
export interface TargetLock {
  readonly ref: EntityRef;
  readonly key: string;
  /** 0..1; 1 = aufgeschaltet. */
  progress: number;
  readonly seconds: number;
}

/** Ergebnis eines Aufschaltversuchs (Aufschaltergebnis). */
export type LockResult = "started" | "already" | "notLockable" | "outOfRange" | "tooMany";

/** Aufschaltzeit in Sekunden nach Zielgröße (kleine Ziele dauern länger, wie die Signatur in EVE): Schmeißfliege ≈ 1,6 s. */
function lockSeconds(radius: number): number {
  return Math.max(0.6, Math.min(2.5, 0.75 / Math.sqrt(Math.max(0.05, radius))));
}

/**
 * Auswahl und Aufschaltungen der eigenen Biene (Zielerfassung): ein ausgewähltes Objekt für Infofeld und
 * Befehle, mehrere aufgeschaltete Ziele für Module, eines davon aktiv. Aufschaltungen brauchen Zeit, enden
 * außerhalb der Reichweite und verschwinden mit dem Ziel.
 */
export class Targeting implements FrameSystem {
  private readonly objects: SpaceObjects;
  private readonly origin: () => Vector3;
  private readonly stats: () => BeeStats;
  private readonly lockList: TargetLock[] = [];
  private selectedKey: string | undefined;
  private activeKey: string | undefined;
  /** Meldet fertige Aufschaltungen (Ton, Protokoll). */
  public onLocked: ((lock: TargetLock) => void) | undefined;

  public constructor(objects: SpaceObjects, origin: () => Vector3, stats: () => BeeStats) {
    this.objects = objects;
    this.origin = origin;
    this.stats = stats;
  }

  public get selected(): SpaceObject | undefined {
    return this.selectedKey === undefined ? undefined : this.objects.get(this.selectedKey);
  }

  public get locks(): readonly TargetLock[] {
    return this.lockList;
  }

  /** Aktives Ziel (aufgeschaltet), auf das Module feuern. */
  public get activeTarget(): SpaceObject | undefined {
    if (this.activeKey === undefined) {
      return undefined;
    }
    const lock = this.lockList.find((entry) => entry.key === this.activeKey);
    return lock !== undefined && lock.progress >= 1 ? this.objects.get(lock.key) : undefined;
  }

  public get activeKeyValue(): string | undefined {
    return this.activeKey;
  }

  public isLocked(key: string): boolean {
    return this.lockList.some((lock) => lock.key === key && lock.progress >= 1);
  }

  public hasLock(key: string): boolean {
    return this.lockList.some((lock) => lock.key === key);
  }

  public select(ref: EntityRef | undefined): void {
    this.selectedKey = ref === undefined ? undefined : refKey(ref);
  }

  /** Beginnt eine Aufschaltung; die Dauer hängt von der Zielgröße ab. */
  public lock(ref: EntityRef): LockResult {
    const key = refKey(ref);
    if (this.hasLock(key)) {
      return "already";
    }
    const object = this.objects.get(key);
    if (object === undefined || !object.lockable) {
      return "notLockable";
    }
    if (Vector3.Distance(object.position, this.origin()) > this.stats().lockRange) {
      return "outOfRange";
    }
    if (this.lockList.length >= this.stats().maxLocks) {
      return "tooMany";
    }
    this.lockList.push({ ref, key, progress: 0, seconds: lockSeconds(object.radius) });
    return "started";
  }

  public unlock(ref: EntityRef): void {
    this.remove(refKey(ref));
  }

  public setActive(ref: EntityRef): void {
    const key = refKey(ref);
    if (this.hasLock(key)) {
      this.activeKey = key;
    }
  }

  /** Löst alle Aufschaltungen (Tod, Andocken, Warp). */
  public clearLocks(): void {
    this.lockList.length = 0;
    this.activeKey = undefined;
  }

  public frameUpdate(dt: number): void {
    const origin = this.origin();
    const range = this.stats().lockRange * 1.1;
    for (let i = this.lockList.length - 1; i >= 0; i--) {
      const lock = this.lockList[i];
      if (lock === undefined) {
        continue;
      }
      const object = this.objects.get(lock.key);
      if (object === undefined || Vector3.Distance(object.position, origin) > range) {
        this.remove(lock.key);
        continue;
      }
      if (lock.progress < 1) {
        lock.progress = Math.min(1, lock.progress + dt / lock.seconds);
        if (lock.progress >= 1) {
          this.activeKey ??= lock.key;
          this.onLocked?.(lock);
        }
      }
    }
    if (this.selectedKey !== undefined && this.objects.get(this.selectedKey) === undefined) {
      this.selectedKey = undefined;
    }
  }

  private remove(key: string): void {
    const index = this.lockList.findIndex((lock) => lock.key === key);
    if (index >= 0) {
      this.lockList.splice(index, 1);
    }
    if (this.activeKey === key) {
      this.activeKey = this.lockList.find((lock) => lock.progress >= 1)?.key;
    }
  }
}
