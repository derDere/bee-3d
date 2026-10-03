// src/hud/station/stationMenu.ts — Stationsmenü beim Andocken: schmale Seitenleiste links und höchstens ein kompaktes
// Fenster daneben. Die Bildmitte bleibt frei, dort schwebt die Biene im Hangar. Beim Andocken ist kein Fenster offen.

import { createElement } from "../dom";
import type { HudActions, StationHud } from "../hudTypes";
import { AchievementPage } from "./achievementPage";
import { DepositPage } from "./depositPage";
import { HealPage } from "./healPage";
import { LeaderboardPage } from "./leaderboardPage";
import { QuestPage } from "./questPage";
import { StationBar } from "./stationBar";
import { StationPages, type StationPage, type StationPageKey, type StationPageSpec } from "./stationPage";
import { StationWindow } from "./stationWindow";
import { WorkshopPage } from "./workshopPage";

const WindowId = "hud-hall-window";

function specOf(page: StationPageKey): StationPageSpec {
  const spec = StationPages.find((candidate) => candidate.key === page);
  if (spec === undefined) {
    throw new Error(`Unknown hive page ${page}.`);
  }
  return spec;
}

/** Wabenhalle beim Andocken: Seitenleiste und Seitenfenster (Stationsmenü). */
export class StationMenu {
  private readonly element: HTMLElement;
  private readonly bar: StationBar;
  private readonly pageWindow: StationWindow;
  private readonly pages: Readonly<Record<StationPageKey, StationPage>>;
  private page: StationPageKey | undefined;
  private hiveId: number | undefined;
  private station: StationHud | undefined;

  public constructor(parent: HTMLElement, actions: HudActions) {
    this.element = createElement("div", "hall", parent);
    this.bar = new StationBar(this.element, actions, { togglePage: (page) => this.togglePage(page) }, WindowId);
    this.pageWindow = new StationWindow(this.element, WindowId, () => this.closeWindow());
    this.pages = {
      deposit: new DepositPage(actions),
      workshop: new WorkshopPage(actions),
      quests: new QuestPage(),
      heal: new HealPage(actions),
      leaderboard: new LeaderboardPage(),
      achievements: new AchievementPage(),
    };
  }

  /** Ob gerade ein Seitenfenster offen ist. */
  public get isWindowOpen(): boolean {
    return this.page !== undefined;
  }

  public update(station: StationHud): void {
    if (station.hiveId !== this.hiveId) {
      // Neues Andocken beginnt ohne offenes Fenster
      this.hiveId = station.hiveId;
      this.closeWindow();
    }
    this.station = station;
    this.bar.update(station);
    if (this.page !== undefined) {
      this.pageWindow.update(station);
      this.pages[this.page].update(station);
    }
  }

  /** Schließt das offene Fenster (Schließknopf, Esc, erneuter Klick auf seinen Wabenknopf). */
  public closeWindow(): void {
    if (this.page === undefined) {
      return;
    }
    this.page = undefined;
    this.pageWindow.hide();
    this.bar.setOpenPage(undefined);
  }

  /** Nach dem Abdocken: Fenster zu, das nächste Andocken beginnt wieder ohne Fenster. */
  public reset(): void {
    this.closeWindow();
    this.hiveId = undefined;
    this.station = undefined;
  }

  public dispose(): void {
    this.pageWindow.dispose();
    this.bar.dispose();
    this.element.remove();
  }

  private togglePage(page: StationPageKey): void {
    if (page === this.page) {
      this.closeWindow();
      return;
    }
    this.page = page;
    this.pageWindow.show(specOf(page), this.pages[page]);
    this.bar.setOpenPage(page);
    if (this.station !== undefined) {
      this.pageWindow.update(this.station);
      this.pages[page].update(this.station);
    }
  }
}
