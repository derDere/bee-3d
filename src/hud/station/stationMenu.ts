// src/hud/station/stationMenu.ts — Stationsmenü als gemütliche Wabenhalle: Holzschild mit dem Stocknamen,
// Waben-Reiter mit Symbolen, Seiten, Symbolknöpfe für Heimatstock und Abdocken.

import { createButton, createElement, NumberSlot, setHint, setVisible, TextSlot } from "../dom";
import { formatInteger } from "../format";
import type { HudActions, StationHud } from "../hudTypes";
import { createIconButton } from "../iconButton";
import { createIcon, type IconName } from "../icons";
import { AchievementPage } from "./achievementPage";
import { DepositPage } from "./depositPage";
import { HealPage } from "./healPage";
import { LeaderboardPage } from "./leaderboardPage";
import { QuestPage } from "./questPage";
import type { StationPage } from "./stationPage";
import { WorkshopPage } from "./workshopPage";

/** Reiter der Wabenhalle nach `spieldesign.md` (Stationsreiter). */
type StationTab = "deposit" | "workshop" | "quests" | "heal" | "leaderboard" | "achievements";

const Tabs: ReadonlyArray<{ readonly tab: StationTab; readonly icon: IconName; readonly label: string }> = [
  { tab: "deposit", icon: "deposit", label: "Deposit pollen" },
  { tab: "workshop", icon: "hammer", label: "Workshop" },
  { tab: "quests", icon: "scroll", label: "Quests" },
  { tab: "heal", icon: "heart", label: "Healer" },
  { tab: "leaderboard", icon: "crown", label: "Leaderboard" },
  { tab: "achievements", icon: "medal", label: "Medals" },
];

/** Wabenhalle beim Andocken (Stationsmenü). */
export class StationMenu {
  private readonly element: HTMLElement;
  private readonly name: TextSlot;
  private readonly homeBadge: HTMLSpanElement;
  private readonly delivered: NumberSlot;
  private readonly wallet: NumberSlot;
  private readonly tabButtons: HTMLButtonElement[] = [];
  private readonly pages: Readonly<Record<StationTab, StationPage>>;
  private readonly homeButton: HTMLButtonElement;
  private tab: StationTab = "deposit";
  private hiveId: number | undefined;
  private station: StationHud | undefined;

  public constructor(parent: HTMLElement, actions: HudActions) {
    this.element = createElement("section", "hall", parent);
    this.element.setAttribute("role", "dialog");
    this.element.setAttribute("aria-labelledby", "hud-hall-name");

    const sign = createElement("header", "hall-sign", this.element);
    createIcon("hive", "hall-crest", sign);
    const titles = createElement("div", "hall-titles", sign);
    const name = createElement("h2", "hall-name", titles);
    name.id = "hud-hall-name";
    this.name = new TextSlot(name);
    const sub = createElement("div", "hall-sub", titles);
    this.homeBadge = createElement("span", "hall-home", sub);
    setHint(this.homeBadge, "Your home hive");
    createIcon("home", "hall-home-icon", this.homeBadge);
    const balance = createElement("span", "hall-balance", sub);
    setHint(balance, "Honey delivered to this hive");
    createIcon("deposit", "hall-balance-icon", balance);
    this.delivered = new NumberSlot(createElement("span", "", balance), formatInteger);
    const wallet = createElement("div", "hall-wallet", sign);
    setHint(wallet, "Your honey");
    createIcon("honey", "hall-wallet-icon", wallet);
    this.wallet = new NumberSlot(createElement("span", "hall-wallet-value", wallet), formatInteger);

    const main = createElement("div", "hall-main", this.element);
    const tabList = createElement("div", "hall-tabs", main);
    tabList.setAttribute("role", "tablist");
    tabList.setAttribute("aria-orientation", "vertical");
    for (const { tab, icon, label } of Tabs) {
      const button = createButton("icon-btn hall-tab", tabList);
      button.setAttribute("role", "tab");
      setHint(button, label);
      createIcon(icon, "icon-btn-icon", button);
      button.addEventListener("click", () => this.setTab(tab));
      this.tabButtons.push(button);
    }
    const content = createElement("div", "hall-page", main);
    this.pages = {
      deposit: new DepositPage(actions),
      workshop: new WorkshopPage(actions),
      quests: new QuestPage(),
      heal: new HealPage(actions),
      leaderboard: new LeaderboardPage(),
      achievements: new AchievementPage(),
    };
    for (const { tab } of Tabs) {
      const page = this.pages[tab];
      page.element.setAttribute("role", "tabpanel");
      content.appendChild(page.element);
    }

    const footer = createElement("footer", "hall-footer", this.element);
    this.homeButton = createIconButton("round-btn hall-home-btn", "home", "Make this my home hive", footer);
    this.homeButton.addEventListener("click", () => actions.setHomeHive());
    const undock = createIconButton("round-btn big-btn hall-undock", "undock", "Undock and fly out", footer);
    undock.addEventListener("click", () => actions.undock());
    this.refreshTabs();
  }

  public update(station: StationHud): void {
    this.station = station;
    if (station.hiveId !== this.hiveId) {
      // Neues Andocken beginnt beim Abliefern
      this.hiveId = station.hiveId;
      this.setTab("deposit");
    }
    this.name.set(station.hiveName);
    setVisible(this.homeBadge, station.isHome);
    setVisible(this.homeButton, !station.isHome);
    this.delivered.set(station.honeyDelivered);
    this.wallet.set(station.honey);
    this.pages[this.tab].update(station);
  }

  /** Nach dem Abdocken beginnt das nächste Andocken wieder beim Abliefern. */
  public reset(): void {
    this.hiveId = undefined;
    this.station = undefined;
  }

  public dispose(): void {
    this.element.remove();
  }

  private setTab(tab: StationTab): void {
    if (tab === this.tab) {
      return;
    }
    this.tab = tab;
    this.refreshTabs();
    if (this.station !== undefined) {
      this.pages[tab].update(this.station);
    }
  }

  private refreshTabs(): void {
    Tabs.forEach(({ tab }, index) => {
      const current = tab === this.tab;
      const button = this.tabButtons[index];
      button.classList.toggle("is-current", current);
      button.setAttribute("aria-selected", String(current));
      setVisible(this.pages[tab].element, current);
    });
  }
}
