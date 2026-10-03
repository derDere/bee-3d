// src/hud/nearbySheet.ts — links: „Nearby“-Karte. Kompakt zeigt sie je Objektart das nächste Objekt als große
// Symbolzeile; aufgeklappt die ganze Liste mit Symbol-Reitern, Symbol-Sortierknöpfen und Objektzeilen.
// Klick wählt aus, Strg+Klick schaltet auf, Doppelklick fliegt hin, Rechtsklick öffnet das Blütenkranz-Menü.

import { createElement, NumberSlot, setHint, setVisible, TextSlot } from "./dom";
import { EntityToneClass, entityKey, TypeSortOrder } from "./entities";
import { distanceStep, formatDistance, formatSpeed, speedStep } from "./format";
import { applyEntityClick, applyEntityDoubleClick, type HudContext } from "./hudContext";
import type { OverviewRow, OverviewTab } from "./hudTypes";
import { createIconButton } from "./iconButton";
import { createIcon, type IconName } from "./icons";
import { KeyedViews, type KeyedView } from "./keyedViews";
import { NearbyCompact } from "./nearbyCompact";

/** Sortierung der Liste (Sortierschlüssel). */
type SortKey = "distance" | "name" | "type";

const Tabs: ReadonlyArray<{ readonly tab: OverviewTab; readonly icon: IconName; readonly label: string }> = [
  { tab: "all", icon: "tabAll", label: "Everything" },
  { tab: "combat", icon: "fly", label: "Enemies" },
  { tab: "mining", icon: "flowerPatch", label: "Flowers" },
  { tab: "navigation", icon: "tabNavigation", label: "Places" },
];

const Sorts: ReadonlyArray<{ readonly key: SortKey; readonly icon: IconName; readonly label: string }> = [
  { key: "distance", icon: "sortDistance", label: "Sort by distance" },
  { key: "name", icon: "sortName", label: "Sort by name" },
  { key: "type", icon: "sortType", label: "Sort by kind" },
];

/** Die Reihenfolge wird höchstens so oft neu sortiert, damit Zeilen beim Anklicken nicht springen. */
const ResortIntervalMs = 500;

/** Zeile der ganzen Liste (Nearby-Zeile). */
class NearbyRowView implements KeyedView {
  public readonly element: HTMLLIElement;
  public seen = 0;
  public current: OverviewRow | undefined;
  private readonly iconBubble: HTMLSpanElement;
  private readonly name: TextSlot;
  private readonly typeLabel: TextSlot;
  private readonly speed: NumberSlot;
  private readonly distance: NumberSlot;

  public constructor() {
    this.element = createElement("li", "nb-row");
    this.iconBubble = createElement("span", "nb-icon", this.element);
    const text = createElement("span", "nb-text", this.element);
    this.name = new TextSlot(createElement("span", "nb-name", text));
    const meta = createElement("span", "nb-meta", text);
    this.typeLabel = new TextSlot(createElement("span", "nb-type", meta));
    this.speed = new NumberSlot(createElement("span", "nb-speed", meta), formatSpeed, speedStep);
    this.distance = new NumberSlot(createElement("span", "nb-distance", this.element), formatDistance, distanceStep);
    const badges = createElement("span", "nb-badges", this.element);
    createIcon("lock", "nb-lock", badges);
    createIcon("alert", "nb-alert", badges);
  }

  public update(row: OverviewRow): void {
    if (this.current === undefined) {
      // Art und Symbol stehen mit dem Schlüssel fest
      createIcon(row.ref.type, "nb-icon-svg", this.iconBubble);
      this.element.classList.add(EntityToneClass[row.ref.type]);
    }
    this.current = row;
    const classes = this.element.classList;
    classes.toggle("is-hostile", row.hostile);
    classes.toggle("is-attacking", row.isAttackingMe);
    classes.toggle("is-locked", row.isLocked);
    classes.toggle("is-selected", row.isSelected);
    classes.toggle("is-moving", row.speed >= 0.5);
    this.name.set(row.name);
    this.typeLabel.set(row.typeLabel);
    this.speed.set(row.speed);
    this.distance.set(row.distance);
  }
}

/** Objektkarte links (Nearby-Karte). */
export class NearbySheet {
  /** Wurzelelement der Karte (Bedienfeld für den Feldschutz). */
  public readonly element: HTMLElement;
  private readonly context: HudContext;
  private readonly compact: NearbyCompact;
  private readonly tabButtons: HTMLButtonElement[] = [];
  private readonly sortButtons: HTMLButtonElement[] = [];
  private readonly list: HTMLUListElement;
  private readonly empty: HTMLDivElement;
  private readonly count: NumberSlot;
  private readonly toggle: HTMLButtonElement;
  private readonly views: KeyedViews<NearbyRowView>;
  private readonly byElement = new WeakMap<Element, NearbyRowView>();
  private readonly visible: OverviewRow[] = [];
  private readonly collator = new Intl.Collator("en", { sensitivity: "base", numeric: true });
  private tab: OverviewTab = "all";
  private sortKey: SortKey = "distance";
  private sortDirection = 1;
  private sortDirty = true;
  private sortedAt = 0;
  private keySum = Number.NaN;
  private keyCount = -1;
  private expanded = false;

  private readonly compare = (a: OverviewRow, b: OverviewRow): number => {
    // Gleichstand nach Schlüssel auflösen, damit die Reihenfolge stabil bleibt
    return this.sortDirection * this.compareBy(this.sortKey, a, b) || entityKey(a.ref) - entityKey(b.ref);
  };

  private readonly onRowClick = (event: MouseEvent): void => {
    const row = this.rowAt(event.target);
    if (row !== undefined) {
      applyEntityClick(event, row.ref, this.context.actions);
    }
  };

  private readonly onRowDoubleClick = (event: MouseEvent): void => {
    const row = this.rowAt(event.target);
    if (row !== undefined) {
      applyEntityDoubleClick(event, row.ref, this.context.actions);
    }
  };

  private readonly onRowContextMenu = (event: MouseEvent): void => {
    const row = this.rowAt(event.target);
    if (row === undefined) {
      return;
    }
    event.preventDefault();
    const subject = { ref: row.ref, distance: row.distance, isLocked: row.isLocked, isActiveTarget: false };
    this.context.openEntityMenu(subject, row.name, event.clientX, event.clientY);
  };

  public constructor(parent: HTMLElement, context: HudContext) {
    this.context = context;
    this.element = createElement("section", "nearby", parent);
    this.element.setAttribute("aria-label", "Nearby");

    const head = createElement("div", "nearby-head", this.element);
    const title = createElement("div", "nearby-title", head);
    setHint(title, "Nearby", "Everything your antennae can sense right now.");
    createIcon("lens", "nearby-title-icon", title);
    this.count = new NumberSlot(createElement("span", "nearby-count", title), (value) => String(value));
    const tabs = createElement("div", "nearby-tabs", head);
    tabs.setAttribute("role", "tablist");
    for (const { tab, icon, label } of Tabs) {
      const button = createIconButton("nearby-tab", icon, label, tabs);
      button.tabIndex = -1;
      button.setAttribute("role", "tab");
      button.addEventListener("click", () => this.setTab(tab));
      this.tabButtons.push(button);
    }
    this.toggle = createIconButton("nearby-toggle", "chevron", "Show the full list", head);
    this.toggle.tabIndex = -1;
    this.toggle.addEventListener("click", () => this.setExpanded(!this.expanded));

    this.compact = new NearbyCompact(this.element);

    const body = createElement("div", "nearby-body", this.element);
    const sorts = createElement("div", "nearby-sorts", body);
    for (const { key, icon, label } of Sorts) {
      const button = createIconButton("nearby-sort", icon, label, sorts);
      button.tabIndex = -1;
      button.addEventListener("click", () => this.sortBy(key));
      this.sortButtons.push(button);
    }
    const scroller = createElement("div", "nearby-scroll", body);
    this.list = createElement("ul", "nearby-list", scroller);
    this.empty = createElement("div", "nearby-empty", scroller);
    createIcon("flowerPatch", "nearby-empty-icon", this.empty);
    createElement("span", "", this.empty, "Nothing here yet. Fly on and look around!");
    this.empty.hidden = true;

    this.views = new KeyedViews<NearbyRowView>(
      () => {
        const view = new NearbyRowView();
        this.byElement.set(view.element, view);
        return view;
      },
      (view) => view.element.remove(),
    );
    this.element.addEventListener("click", this.onRowClick);
    this.element.addEventListener("dblclick", this.onRowDoubleClick);
    this.element.addEventListener("contextmenu", this.onRowContextMenu);
    this.refreshTabs();
    this.refreshSorts();
    this.setExpanded(false);
  }

  public update(rows: readonly OverviewRow[]): void {
    if (!this.expanded) {
      this.count.set(rows.length);
      this.compact.update(rows);
      return;
    }
    this.visible.length = 0;
    let keySum = 0;
    for (const row of rows) {
      // „Everything“ zeigt jede Zeile; die anderen Reiter filtern nach row.tabs
      if (this.tab === "all" || row.tabs.includes(this.tab)) {
        this.visible.push(row);
        keySum += entityKey(row.ref);
      }
    }
    this.count.set(this.visible.length);
    const now = performance.now();
    const membershipChanged = keySum !== this.keySum || this.visible.length !== this.keyCount;
    const resort = this.sortDirty || membershipChanged || now - this.sortedAt >= ResortIntervalMs;
    if (resort) {
      this.visible.sort(this.compare);
      this.sortedAt = now;
      this.sortDirty = false;
      this.keySum = keySum;
      this.keyCount = this.visible.length;
    }
    this.views.begin();
    for (const row of this.visible) {
      this.views.claim(entityKey(row.ref)).update(row);
    }
    this.views.end();
    if (resort) {
      this.views.arrange(this.list);
    }
    setVisible(this.empty, this.visible.length === 0);
  }

  public dispose(): void {
    this.element.removeEventListener("click", this.onRowClick);
    this.element.removeEventListener("dblclick", this.onRowDoubleClick);
    this.element.removeEventListener("contextmenu", this.onRowContextMenu);
    this.views.clear();
    this.element.remove();
  }

  private setTab(tab: OverviewTab): void {
    if (tab !== this.tab) {
      this.tab = tab;
      this.sortDirty = true;
      this.refreshTabs();
    }
  }

  /** Kompakt: eine Zeile je Art. Aufgeklappt: ganze Liste mit Reitern und Sortierung. */
  private setExpanded(expanded: boolean): void {
    this.expanded = expanded;
    this.sortDirty = true;
    this.element.classList.toggle("is-expanded", expanded);
    setHint(this.toggle, expanded ? "Show less" : "Show the full list", expanded ? "Back to the nearest of each kind." : "With tabs and sorting.");
    this.toggle.setAttribute("aria-expanded", String(expanded));
  }

  private sortBy(key: SortKey): void {
    if (key === this.sortKey) {
      this.sortDirection = -this.sortDirection;
    } else {
      this.sortKey = key;
      this.sortDirection = 1;
    }
    this.sortDirty = true;
    this.refreshSorts();
  }

  private refreshTabs(): void {
    Tabs.forEach(({ tab }, index) => {
      const button = this.tabButtons[index];
      button.setAttribute("aria-selected", String(tab === this.tab));
      button.classList.toggle("is-current", tab === this.tab);
    });
  }

  private refreshSorts(): void {
    Sorts.forEach(({ key }, index) => {
      const button = this.sortButtons[index];
      const current = key === this.sortKey;
      button.classList.toggle("is-current", current);
      button.classList.toggle("is-descending", current && this.sortDirection < 0);
      button.setAttribute("aria-pressed", String(current));
    });
  }

  private compareBy(key: SortKey, a: OverviewRow, b: OverviewRow): number {
    switch (key) {
      case "distance":
        return a.distance - b.distance;
      case "name":
        return this.collator.compare(a.name, b.name);
      case "type":
        return TypeSortOrder[a.ref.type] - TypeSortOrder[b.ref.type] || a.distance - b.distance;
    }
  }

  private rowAt(target: EventTarget | null): OverviewRow | undefined {
    const element = target instanceof Element ? target.closest(".nb-row") : null;
    if (element !== null) {
      return this.byElement.get(element)?.current;
    }
    return this.compact.rowAt(target);
  }
}
