// src/hud/station/stationPage.ts — Seiten der Wabenhalle: gemeinsame Schnittstelle und die Liste aller Seiten
// mit Symbol und englischem Namen.

import type { StationHud } from "../hudTypes";
import type { IconName } from "../icons";

/** Seite der Wabenhalle nach `spieldesign.md` (Stationsseite). */
export type StationPageKey = "deposit" | "workshop" | "quests" | "heal" | "leaderboard" | "achievements";

/** Inhalt einer Seite, den das Stationsfenster zeigt (Seiteninhalt). */
export interface StationPage {
  readonly element: HTMLElement;
  update(station: StationHud): void;
}

/** Symbol und Name einer Seite für Seitenleiste und Fenstertitel (Seitenbeschreibung). */
export interface StationPageSpec {
  readonly key: StationPageKey;
  readonly icon: IconName;
  readonly label: string;
}

/** Alle Seiten in der Reihenfolge der Seitenleiste. */
export const StationPages: readonly StationPageSpec[] = [
  { key: "deposit", icon: "deposit", label: "Deposit pollen" },
  { key: "workshop", icon: "hammer", label: "Workshop" },
  { key: "quests", icon: "scroll", label: "Quests" },
  { key: "heal", icon: "heart", label: "Healer" },
  { key: "leaderboard", icon: "crown", label: "Leaderboard" },
  { key: "achievements", icon: "medal", label: "Medals" },
];
