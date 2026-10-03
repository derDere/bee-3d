// src/hud/station/questPage.ts — Reiter „Quests“: Briefe der Stockkönigin als Schriftrollen mit Fortschritt und Belohnung.

import { createElement, NumberSlot, setHint, setVisible, StyleSlot, TextSlot } from "../dom";
import { clamp01, formatInteger } from "../format";
import type { QuestHud, StationHud } from "../hudTypes";
import { createIcon } from "../icons";
import { KeyedViews, type KeyedView } from "../keyedViews";
import type { StationPage } from "./stationPage";

/** Quest als Schriftrolle (Quest-Rolle). */
class QuestView implements KeyedView {
  public readonly element: HTMLLIElement;
  public seen = 0;
  private readonly title: TextSlot;
  private readonly reward: NumberSlot;
  private readonly brief: TextSlot;
  private readonly fill: StyleSlot;
  private readonly progress: NumberSlot;
  private readonly goal: NumberSlot;
  private readonly repeat: HTMLSpanElement;
  private readonly completions: NumberSlot;
  private fillStep = -1;

  public constructor() {
    this.element = createElement("li", "quest");
    const head = createElement("div", "quest-head", this.element);
    this.title = new TextSlot(createElement("h3", "quest-title", head));
    const reward = createElement("span", "quest-reward", head);
    setHint(reward, "Reward");
    createIcon("honey", "quest-reward-icon", reward);
    this.reward = new NumberSlot(createElement("span", "", reward), (value) => `+${formatInteger(value)}`);
    this.brief = new TextSlot(createElement("p", "quest-brief", this.element));
    const progress = createElement("div", "quest-progress", this.element);
    const bar = createElement("span", "quest-bar", progress);
    this.fill = new StyleSlot(createElement("span", "quest-bar-fill", bar), "transform");
    const count = createElement("span", "quest-count", progress);
    this.progress = new NumberSlot(createElement("span", "", count), formatInteger);
    createElement("span", "", count, "/");
    this.goal = new NumberSlot(createElement("span", "", count), formatInteger);
    this.repeat = createElement("span", "quest-repeat", this.element);
    setHint(this.repeat, "Repeatable");
    createIcon("loop", "quest-repeat-icon", this.repeat);
    this.completions = new NumberSlot(createElement("span", "", this.repeat), (value) => `×${formatInteger(value)}`);
    const stamp = createElement("span", "quest-stamp", this.element);
    createIcon("check", "quest-stamp-icon", stamp);
    createElement("span", "", stamp, "Done");
  }

  public update(quest: QuestHud): void {
    this.title.set(quest.title);
    this.reward.set(quest.reward);
    this.brief.set(quest.brief);
    const step = Math.round(clamp01(quest.goal > 0 ? quest.progress / quest.goal : 0) * 200);
    if (step !== this.fillStep) {
      this.fillStep = step;
      this.fill.set(`scaleX(${step / 200})`);
    }
    this.progress.set(Math.min(quest.progress, quest.goal));
    this.goal.set(quest.goal);
    this.element.classList.toggle("is-done", quest.completed);
    setVisible(this.repeat, quest.repeatable);
    if (quest.repeatable) {
      this.completions.set(quest.completions);
    }
  }
}

/** Seite „Quests“ (Quest-Brett). */
export class QuestPage implements StationPage {
  public readonly element: HTMLDivElement;
  private readonly list: HTMLUListElement;
  private readonly empty: HTMLParagraphElement;
  private readonly views: KeyedViews<QuestView>;

  public constructor() {
    this.element = createElement("div", "quest-page");
    this.list = createElement("ul", "quest-list", this.element);
    this.empty = createElement("p", "hall-note", this.element, "The queen has no tasks right now. Come back later!");
    this.views = new KeyedViews<QuestView>(
      () => new QuestView(),
      (view) => view.element.remove(),
    );
  }

  public update(station: StationHud): void {
    this.views.begin();
    for (const quest of station.quests) {
      this.views.claim(quest.id).update(quest);
    }
    this.views.end();
    this.views.arrange(this.list);
    setVisible(this.empty, station.quests.length === 0);
  }
}
