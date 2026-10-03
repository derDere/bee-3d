// src/entities/effects/effectTypes.ts — Vertrag der Kampf- und Spieleffekte (Effekte).
// Das Spiel ruft die Methoden bei Ereignissen auf; Positionen beweglicher Objekte kommen als Abfragefunktion,
// damit Strahlen und Geschosse ihrem Ziel folgen. Liefert eine Abfrage undefined, ist das Objekt weg.
import type { Vector3 } from "@babylonjs/core/Maths/math.vector";

/** Liefert die aktuelle Weltposition eines Objekts oder undefined, wenn es verschwunden ist (Positionsquelle). */
export type PositionSource = () => Vector3 | undefined;

/** Art eines Treffers für Funken und Farben (Trefferart). */
export type ImpactKind = "laser" | "pollen" | "stinger" | "spit";

/** Kampf- und Spieleffekte (Effektsystem). */
export interface EffectsApi {
  /** Roter Laserstrahl aus einem Auge; hit = trifft (Funken am Ziel), sonst knapp vorbei. */
  laserBeam(from: PositionSource, to: PositionSource, durationSeconds: number, hit: boolean): void;
  /** Laser ins Leere beim freien Zielen (Maus): Strahl in eine Richtung, solange active() wahr ist. */
  freeLaser(from: PositionSource, direction: () => Vector3 | undefined, active: () => boolean): void;
  /** Pollen-Leuchtspuren aus sechs Beinen; hits Treffer von shots. */
  gatlingBurst(origins: readonly PositionSource[], to: PositionSource, shots: number, hits: number): void;
  /** Salve zielsuchender Stachelraketen mit Rauchspur, Einschlag nach flightSeconds. */
  stingerVolley(from: PositionSource, to: PositionSource, count: number, flightSeconds: number): void;
  /** Grüne Spuckeballen einer Fliege, Einschlag nach flightSeconds. */
  spit(from: PositionSource, to: PositionSource, count: number, flightSeconds: number): void;
  /** Treffer an einer Stelle; strength 0..1 skaliert Größe und Helligkeit. */
  impact(position: Vector3, kind: ImpactKind, strength: number): void;
  /** Eine Fliege platzt (Fleck, Flügel, Partikel). */
  flyDeath(position: Vector3, size: number): void;
  /** Die Biene wird zum Geist (cyanes Aufleuchten). */
  beeDeath(position: Vector3): void;
  /** Wiederbelebung im Bienenstock (goldenes Aufleuchten). */
  revive(position: Vector3): void;
  /** Pollenstrom von einem Blumenfeld zur Biene; golden = Goldpollen. */
  collectStream(from: Vector3, to: PositionSource, durationSeconds: number, golden: boolean): void;
  /** Summen: Schallring um die Biene. */
  buzzRing(at: PositionSource): void;
  /** Heilung: grünlich-goldenes Funkeln. */
  heal(at: PositionSource): void;
  /** Duftscanner: sich ausbreitende Welle. */
  scanPulse(position: Vector3, radius: number): void;
  /** Andocken/Abdocken: Lichtblitz am Flugloch. */
  dockFlash(position: Vector3): void;
  /** Warp: Schlieren um die Kamera, intensity 0..1, Flugrichtung als Einheitsvektor. */
  setWarp(intensity: number, direction: Vector3): void;
  /** Fahrtwind-Partikel um die Kamera (Tempo-Eindruck), speed in m/s. */
  setSpeedMotes(speed: number, direction: Vector3): void;
  /** Gibt alle Ressourcen frei. */
  dispose(): void;
}
