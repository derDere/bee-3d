// src/hud/station/stationPage.ts — gemeinsame Schnittstelle der Reiterseiten im Stationsmenü.

import type { StationHud } from "../hudTypes";

/** Reiterseite des Stationsmenüs (Stationsseite). */
export interface StationPage {
  readonly element: HTMLElement;
  update(station: StationHud): void;
}
