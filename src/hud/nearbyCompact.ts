// src/hud/nearbyCompact.ts — kompakte Nearby-Karte: je Objektart eine große Symbolzeile mit dem nächsten
// Objekt dieser Art, seiner Entfernung und der Anzahl in der Nähe. Fliegen, die angreifen, haben Vorrang.

import { createElement, HintSlot, NumberSlot, setVisible, TextSlot } from "./dom";
import { EntityToneClass } from "./entities";
import { distanceStep, formatDistance, formatInteger } from "./format";
import type { EntityType, OverviewRow } from "./hudTypes";
import { createIcon } from "./icons";

/** Gruppe der kompakten Karte (Nearby-Gruppe). */
interface NearbyGroup {
  readonly type: EntityType;
  readonly label: string;
}

/** Feste Reihenfolge: Gefahr zuerst, dann Sammeln, Heimat, Freunde und Orte. */
const Groups: readonly NearbyGroup[] = [
  { type: "fly", label: "Nearest fly" },
  { type: "flowerPatch", label: "Nearest flowers" },
  { type: "hive", label: "Nearest hive" },
  { type: "bee", label: "Nearest bee" },
  { type: "nest", label: "Nearest fly nest" },
  { type: "island", label: "Nearest island" },
];

const GroupIndex: Readonly<Record<EntityType, number>> = {
  fly: 0,
  flowerPatch: 1,
  hive: 2,
  bee: 3,
  nest: 4,
  island: 5,
};

/** Ob `candidate` die Zeile einer Gruppe eher verdient als `current`: Angreifer zuerst, sonst das nähere. */
function isBetter(candidate: OverviewRow, current: OverviewRow | undefined): boolean {
  if (current === undefined) {
    return true;
  }
  if (candidate.isAttackingMe !== current.isAttackingMe) {
    return candidate.isAttackingMe;
  }
  return candidate.distance < current.distance;
}

/** Zeile einer Gruppe (Gruppenzeile). */
class GroupRowView {
  public readonly element: HTMLLIElement;
  public current: OverviewRow | undefined;
  private readonly group: NearbyGroup;
  private readonly name: TextSlot;
  private readonly distance: NumberSlot;
  private readonly count: NumberSlot;
  private readonly hint: HintSlot;
  private shownCount = -1;

  public constructor(parent: HTMLElement, group: NearbyGroup) {
    this.group = group;
    this.element = createElement("li", `nc-row ${EntityToneClass[group.type]}`, parent);
    const icon = createElement("span", "nc-icon", this.element);
    createIcon(group.type, "nc-icon-svg", icon);
    this.count = new NumberSlot(createElement("span", "nc-count", icon), formatInteger);
    const text = createElement("span", "nc-text", this.element);
    this.name = new TextSlot(createElement("span", "nc-name", text));
    this.distance = new NumberSlot(createElement("span", "nc-distance", text), formatDistance, distanceStep);
    const badges = createElement("span", "nc-badges", this.element);
    createIcon("lock", "nc-lock", badges);
    createIcon("alert", "nc-alert", badges);
    this.hint = new HintSlot(this.element);
  }

  public update(row: OverviewRow | undefined, count: number): void {
    this.current = row;
    setVisible(this.element, row !== undefined);
    if (row === undefined) {
      return;
    }
    const classes = this.element.classList;
    classes.toggle("is-hostile", row.hostile);
    classes.toggle("is-attacking", row.isAttackingMe);
    classes.toggle("is-locked", row.isLocked);
    classes.toggle("is-selected", row.isSelected);
    this.name.set(row.name);
    this.distance.set(row.distance);
    this.count.set(count);
    if (count !== this.shownCount) {
      this.shownCount = count;
      this.hint.set(this.group.label, count === 1 ? "The only one nearby." : `${formatInteger(count)} nearby. Open the full list for all of them.`);
    }
  }
}

/** Kompakte Nearby-Karte (Nächste je Art). */
export class NearbyCompact {
  public readonly element: HTMLUListElement;
  private readonly views: GroupRowView[] = [];
  private readonly byElement = new WeakMap<Element, GroupRowView>();
  private readonly best: Array<OverviewRow | undefined> = Groups.map(() => undefined);
  private readonly counts: number[] = Groups.map(() => 0);

  public constructor(parent: HTMLElement) {
    this.element = createElement("ul", "nearby-compact", parent);
    for (const group of Groups) {
      const view = new GroupRowView(this.element, group);
      this.byElement.set(view.element, view);
      this.views.push(view);
    }
  }

  public update(rows: readonly OverviewRow[]): void {
    for (let index = 0; index < Groups.length; index++) {
      this.best[index] = undefined;
      this.counts[index] = 0;
    }
    for (const row of rows) {
      const index = GroupIndex[row.ref.type];
      this.counts[index]++;
      if (isBetter(row, this.best[index])) {
        this.best[index] = row;
      }
    }
    for (let index = 0; index < Groups.length; index++) {
      this.views[index].update(this.best[index], this.counts[index]);
    }
  }

  /** Objekt der Zeile unter einem Ereignisziel. */
  public rowAt(target: EventTarget | null): OverviewRow | undefined {
    const element = target instanceof Element ? target.closest(".nc-row") : null;
    return element === null ? undefined : this.byElement.get(element)?.current;
  }
}
