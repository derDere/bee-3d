// shared/weather.ts — Wetterlagen und deterministischer Wetterplan (Wetter).
// Jeder Client berechnet dieselbe Lage aus Weltseed und Weltzeit; der Betreiber kann eine Lage erzwingen.
import { DaySeconds, WorldStartOffsetSeconds, dayIndex, solarHours } from "./dayClock";
import { hashUnit } from "./random";

/** Name einer Wetterlage (Wetterlage). */
export type WeatherName = "clear" | "fair" | "misty-morning" | "overcast" | "shower" | "storm";

export const WeatherNames: readonly WeatherName[] = ["clear", "fair", "misty-morning", "overcast", "shower", "storm"];

/** Abschnitt des Tages, in dem eine Wetterlage gilt (Wetterabschnitt). */
interface WeatherSlot {
  readonly name: string;
  /** Beginn in Sekunden seit Tagesbeginn der Tageskurve. */
  readonly startSecond: number;
  readonly odds: readonly (readonly [WeatherName, number])[];
}

// Tagesbeginn der Kurve ist 20:20 (Nachtbeginn): 0 Nacht, 300 Dämmerung, 510 Vormittag, 750 Mittag,
// 960 Nachmittag, 1200 Abend.
const Slots: readonly WeatherSlot[] = [
  { name: "night", startSecond: 0, odds: [["clear", 0.5], ["fair", 0.3], ["overcast", 0.2]] },
  { name: "dawn", startSecond: 300, odds: [["misty-morning", 0.65], ["fair", 0.2], ["overcast", 0.15]] },
  { name: "morning", startSecond: 630, odds: [["fair", 0.6], ["clear", 0.25], ["overcast", 0.15]] },
  { name: "noon", startSecond: 840, odds: [["fair", 0.55], ["clear", 0.2], ["shower", 0.15], ["overcast", 0.1]] },
  { name: "afternoon", startSecond: 1050, odds: [["fair", 0.3], ["shower", 0.3], ["storm", 0.25], ["overcast", 0.15]] },
  { name: "evening", startSecond: 1260, odds: [["clear", 0.4], ["fair", 0.4], ["shower", 0.1], ["overcast", 0.1]] },
];

/** Echtsekunden, über die eine neue Lage in die alte überblendet. */
export const WeatherTransitionSeconds = 45;

/** Momentaufnahme des Wetters: Überblendung zweier Lagen (Wetterzustand). */
export interface WeatherState {
  readonly from: WeatherName;
  readonly to: WeatherName;
  /** 0 = ganz `from`, 1 = ganz `to`. */
  readonly blend: number;
  /** Seed der aktuellen Lage für Blitze und Regenböen. */
  readonly seed: number;
}

/** Erzwungene Lage des Betreibers (Tabelle world_weather). */
export interface WeatherOverride {
  readonly weather: WeatherName;
  readonly sinceWorldSeconds: number;
}

/** Lage im Abschnitt `slotIndex` des Tages `day`. */
function pickWeather(seed: number, day: number, slotIndex: number): WeatherName {
  const slot = Slots[slotIndex];
  if (slot === undefined) {
    return "fair";
  }
  let roll = hashUnit(seed, day, slotIndex, 0x77ea);
  // Klare Nächte machen neblige Morgen wahrscheinlicher (Strahlungsnebel).
  if (slot.name === "dawn" && pickWeather(seed, day, 0) === "clear") {
    roll *= 0.75;
  }
  for (const [name, probability] of slot.odds) {
    if (roll < probability) {
      return name;
    }
    roll -= probability;
  }
  return slot.odds[0]?.[0] ?? "fair";
}

/** Wetter zur Weltzeit (Wetterplan), optional mit Betreiber-Vorgabe. */
export function weatherAt(seed: number, worldSeconds: number, override?: WeatherOverride): WeatherState {
  const day = dayIndex(worldSeconds);
  const secondOfDay = (((worldSeconds + WorldStartOffsetSeconds) % DaySeconds) + DaySeconds) % DaySeconds;
  let slotIndex = 0;
  for (let i = 0; i < Slots.length; i++) {
    if (secondOfDay >= (Slots[i]?.startSecond ?? 0)) {
      slotIndex = i;
    }
  }
  const current = pickWeather(seed, day, slotIndex);
  const previous = slotIndex > 0 ? pickWeather(seed, day, slotIndex - 1) : pickWeather(seed, day - 1, Slots.length - 1);
  const sinceSlotStart = secondOfDay - (Slots[slotIndex]?.startSecond ?? 0);
  const scheduled: WeatherState = {
    from: previous,
    to: current,
    blend: Math.min(1, sinceSlotStart / WeatherTransitionSeconds),
    seed: (seed ^ (day * 7919 + slotIndex * 104729)) >>> 0,
  };
  if (override === undefined) {
    return scheduled;
  }
  const sinceOverride = worldSeconds - override.sinceWorldSeconds;
  if (sinceOverride < 0) {
    return scheduled;
  }
  return {
    from: sinceOverride < WeatherTransitionSeconds ? scheduled.to : override.weather,
    to: override.weather,
    blend: Math.min(1, sinceOverride / WeatherTransitionSeconds),
    seed: (seed ^ Math.floor(override.sinceWorldSeconds)) >>> 0,
  };
}

/** Ob gerade ein Gewitter herrscht (für Quests und Ton). */
export function isStorm(state: WeatherState): boolean {
  return (state.to === "storm" && state.blend > 0.5) || (state.from === "storm" && state.blend < 0.5);
}

/** Sonnenstunden zur Weltzeit (Bequemlichkeit für den Server). */
export function hoursAt(worldSeconds: number): number {
  return solarHours(worldSeconds);
}
