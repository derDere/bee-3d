// src/hud/station/leaderboardPage.ts — Reiter „Rangliste“: die fleißigsten Bienen nach abgeliefertem Honig.

import { createElement, NumberSlot, setHint, setVisible, TextSlot } from "../dom";
import { formatInteger } from "../format";
import type { LeaderboardRow, StationHud } from "../hudTypes";
import { createIcon } from "../icons";
import type { StationPage } from "./stationPage";

/** Zeile der Rangliste (Ranglistenzeile). */
class LeaderboardRowView {
  public readonly element: HTMLLIElement;
  private readonly rank: NumberSlot;
  private readonly name: TextSlot;
  private readonly honey: NumberSlot;
  private readonly kills: NumberSlot;
  private podium = "";

  public constructor(parent: HTMLElement) {
    this.element = createElement("li", "rank-row", parent);
    const badge = createElement("span", "rank-badge", this.element);
    createIcon("crown", "rank-crown", badge);
    this.rank = new NumberSlot(createElement("span", "rank-number", badge), formatInteger);
    this.name = new TextSlot(createElement("span", "rank-name", this.element));
    const honey = createElement("span", "rank-honey", this.element);
    setHint(honey, "Honey delivered");
    createIcon("honey", "rank-icon", honey);
    this.honey = new NumberSlot(createElement("span", "", honey), formatInteger);
    const kills = createElement("span", "rank-kills", this.element);
    setHint(kills, "Flies defeated");
    createIcon("stinger", "rank-icon", kills);
    this.kills = new NumberSlot(createElement("span", "", kills), formatInteger);
  }

  public update(row: LeaderboardRow): void {
    this.rank.set(row.rank);
    this.name.set(row.name);
    this.honey.set(row.honey);
    this.kills.set(row.kills);
    this.element.classList.toggle("is-self", row.isSelf);
    const podium = row.rank === 1 ? "is-gold" : row.rank === 2 ? "is-silver" : row.rank === 3 ? "is-bronze" : "";
    if (podium !== this.podium) {
      if (this.podium !== "") {
        this.element.classList.remove(this.podium);
      }
      this.podium = podium;
      if (podium !== "") {
        this.element.classList.add(podium);
      }
    }
  }
}

/** Seite „Rangliste“ (Rangliste). */
export class LeaderboardPage implements StationPage {
  public readonly element: HTMLDivElement;
  private readonly list: HTMLOListElement;
  private readonly rows: LeaderboardRowView[] = [];
  private readonly empty: HTMLParagraphElement;

  public constructor() {
    this.element = createElement("div", "leaderboard-page");
    this.list = createElement("ol", "rank-list", this.element);
    this.empty = createElement("p", "hall-note", this.element, "Nobody has delivered honey yet. Be the first bee!");
  }

  public update(station: StationHud): void {
    const rows = station.leaderboard;
    while (this.rows.length < rows.length) {
      this.rows.push(new LeaderboardRowView(this.list));
    }
    for (let index = 0; index < this.rows.length; index++) {
      const view = this.rows[index];
      const row = rows[index];
      setVisible(view.element, row !== undefined);
      if (row !== undefined) {
        view.update(row);
      }
    }
    setVisible(this.empty, rows.length === 0);
  }
}
