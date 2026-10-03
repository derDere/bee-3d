// src/hud/station/achievementPage.ts — Reiter „Erfolge“: Medaillen mit Symbol, errungen bunt, offen grau.

import { createElement, NumberSlot, setHint, setVisible, TextSlot } from "../dom";
import { formatInteger } from "../format";
import type { StationHud } from "../hudTypes";
import { achievementIcon, IconSlot } from "../icons";
import type { StationPage } from "./stationPage";

type Achievement = StationHud["achievements"][number];

/** Medaille eines Erfolgs (Erfolgsmedaille). */
class AchievementView {
  public readonly element: HTMLLIElement;
  private readonly icon: IconSlot;
  private readonly title: TextSlot;
  private readonly description: TextSlot;

  public constructor(parent: HTMLElement) {
    this.element = createElement("li", "achievement", parent);
    this.icon = new IconSlot(createElement("span", "achievement-medal", this.element), "achievement-icon");
    const text = createElement("div", "achievement-text", this.element);
    this.title = new TextSlot(createElement("div", "achievement-title", text));
    this.description = new TextSlot(createElement("div", "achievement-description", text));
  }

  public update(achievement: Achievement): void {
    this.icon.set(achievementIcon(achievement.key));
    this.title.set(achievement.title);
    this.description.set(achievement.description);
    this.element.classList.toggle("is-earned", achievement.earned);
  }
}

/** Seite „Erfolge“ (Erfolge). */
export class AchievementPage implements StationPage {
  public readonly element: HTMLDivElement;
  private readonly list: HTMLUListElement;
  private readonly views: AchievementView[] = [];
  private readonly earned: NumberSlot;
  private readonly total: NumberSlot;

  public constructor() {
    this.element = createElement("div", "achievement-page");
    const summary = createElement("div", "achievement-summary", this.element);
    setHint(summary, "Medals earned");
    this.earned = new NumberSlot(createElement("span", "achievement-earned", summary), formatInteger);
    createElement("span", "", summary, "/");
    this.total = new NumberSlot(createElement("span", "", summary), formatInteger);
    this.list = createElement("ul", "achievement-list", this.element);
  }

  public update(station: StationHud): void {
    const achievements = station.achievements;
    while (this.views.length < achievements.length) {
      this.views.push(new AchievementView(this.list));
    }
    let earned = 0;
    for (let index = 0; index < this.views.length; index++) {
      const view = this.views[index];
      const achievement = achievements[index];
      setVisible(view.element, achievement !== undefined);
      if (achievement !== undefined) {
        view.update(achievement);
        earned += achievement.earned ? 1 : 0;
      }
    }
    this.earned.set(earned);
    this.total.set(achievements.length);
  }
}
