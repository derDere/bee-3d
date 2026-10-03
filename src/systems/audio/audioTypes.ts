// src/systems/audio/audioTypes.ts — Vertrag des Tonsystems (Ton). Alle Klänge entstehen prozedural.
import type { Vector3 } from "@babylonjs/core/Maths/math.vector";

/** Kurze Oberflächenklänge (UI-Klang). */
export type UiSound = "click" | "hover" | "error" | "confirm" | "quest" | "upgrade" | "lock" | "deposit";

/** Räumliche Einzelklänge (Raumklang). */
export type WorldSound =
  | "laser"
  | "gatling"
  | "stingerLaunch"
  | "stingerImpact"
  | "spit"
  | "spitHit"
  | "flyDeath"
  | "beeHit"
  | "beeDeath"
  | "revive"
  | "collect"
  | "dock"
  | "undock"
  | "warpStart"
  | "warpEnd"
  | "buzz"
  | "heal"
  | "scan"
  | "thunder";

/** Tonsystem (Tonsystem). */
export interface AudioApi {
  /** Schaltet den Ton nach einer Nutzeraktion frei (Browser-Vorgabe). */
  unlockAsync(): Promise<void>;
  setVolumes(master: number, music: number): void;
  playUi(sound: UiSound): void;
  /** Klang an einer Weltposition; intensity 0..1 skaliert Lautstärke (z. B. Donnerentfernung). */
  playAt(sound: WorldSound, position: Vector3, intensity?: number): void;
  /** Hörer an der Kamera: Position und Blickrichtung je Frame. */
  setListener(position: Vector3, forward: Vector3, up: Vector3): void;
  /** Flügelsummen der eigenen Biene: Tempo 0..1, Geist klingt hohl. */
  setWingBuzz(speed01: number, ghost: boolean): void;
  /** Brummen der Fliegen in der Nähe: Abstand der nächsten Fliege in Metern (Infinity = keine). */
  setNearestFly(distance: number): void;
  /** Wind (Tempo 0..1), Regen 0..1, Wolkendichte an der Kamera 0..1 (dämpft die Höhen). */
  setEnvironment(wind01: number, rain01: number, inCloud01: number): void;
  /** Stimmung nach Tageszeit: 0 = Tag, 1 = Nacht; Morgen und Abend mischen. */
  setNightFactor(night01: number): void;
  dispose(): void;
}
