// src/hud/targetBubbles.ts — aufgeschaltete Ziele als Seifenblasen über der Wabenleiste: Blütenblätter zeigen
// die Lebenspunkte, die Blase bläst sich beim Aufschalten auf, das aktive Ziel trägt eine Krone.

import { createButton, createElement, NumberSlot, StyleSlot, TextSlot } from "./dom";
import { EntityToneClass, entityKey } from "./entities";
import { clamp01, distanceStep, formatDistance } from "./format";
import type { HudContext } from "./hudContext";
import type { EntityRef, TargetHud } from "./hudTypes";
import { createIcon } from "./icons";
import { KeyedViews, type KeyedView } from "./keyedViews";

const Ink = "#5b3a1e";
/** Zahl der Blütenblätter im Lebenspunkte-Kranz. */
const PetalCount = 10;

/** Kranz aus Blütenblättern um die Blase (Blütenkranz). */
function petalRing(): string {
  let petals = "";
  for (let index = 0; index < PetalCount; index++) {
    petals += `<path class="petal-hp" d="M50 3c6.4 0 9.6 6 9.6 11.4S55.4 24 50 24s-9.6-4.2-9.6-9.6S43.6 3 50 3z" transform="rotate(${index * (360 / PetalCount)} 50 50)" stroke="${Ink}" stroke-width="2.6"/>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" class="bubble-petals" viewBox="0 0 100 100" aria-hidden="true" focusable="false">${petals}</svg>`;
}

/** Ein aufgeschaltetes Ziel als Blase (Zielblase). */
class BubbleView implements KeyedView {
  public readonly element: HTMLButtonElement;
  public seen = 0;
  public current: TargetHud | undefined;
  private readonly orb: HTMLSpanElement;
  private readonly petals: SVGPathElement[];
  private readonly lock: StyleSlot;
  private readonly name: TextSlot;
  private readonly distance: NumberSlot;
  private shownPetals = -1;
  private lockStep = -1;
  private tier = "";

  public constructor() {
    this.element = createButton("bubble");
    this.element.tabIndex = -1;
    const holder = document.createElement("template");
    holder.innerHTML = petalRing();
    const ring = holder.content.firstElementChild;
    if (!(ring instanceof SVGSVGElement)) {
      throw new Error("Blütenkranz ließ sich nicht anlegen.");
    }
    const stage = createElement("span", "bubble-stage", this.element);
    stage.appendChild(ring);
    this.petals = Array.from(ring.querySelectorAll<SVGPathElement>(".petal-hp"));
    createElement("span", "bubble-lockring", stage);
    this.orb = createElement("span", "bubble-orb", stage);
    createIcon("crown", "bubble-crown", stage);
    this.lock = new StyleSlot(this.element, "--lock");
    this.name = new TextSlot(createElement("span", "bubble-name", this.element));
    this.distance = new NumberSlot(createElement("span", "bubble-distance", this.element), formatDistance, distanceStep);
  }

  public get ref(): EntityRef | undefined {
    return this.current?.ref;
  }

  public update(target: TargetHud): void {
    if (this.current === undefined) {
      // Art und Symbol stehen mit dem Schlüssel fest
      createIcon(target.ref.type, "bubble-icon", this.orb);
      this.element.classList.add(EntityToneClass[target.ref.type]);
    }
    this.current = target;
    const lock = clamp01(target.lockProgress);
    const locked = lock >= 1;
    const classes = this.element.classList;
    classes.toggle("is-active", target.isActive);
    classes.toggle("is-locking", !locked);
    classes.toggle("is-hostile", target.hostile);
    const lockStep = Math.round(lock * 50);
    if (lockStep !== this.lockStep) {
      this.lockStep = lockStep;
      this.lock.set(String(lockStep / 50));
    }
    const shown = locked ? Math.ceil(clamp01(target.hpRatio) * PetalCount) : 0;
    if (shown !== this.shownPetals) {
      this.shownPetals = shown;
      for (let index = 0; index < PetalCount; index++) {
        this.petals[index].classList.toggle("is-lost", index >= shown);
      }
      this.element.setAttribute("aria-label", `${target.name}: ${Math.round(clamp01(target.hpRatio) * 100)}% health`);
    }
    const tier = target.hpRatio > 0.6 ? "hp-high" : target.hpRatio > 0.3 ? "hp-mid" : "hp-low";
    if (tier !== this.tier) {
      if (this.tier !== "") {
        classes.remove(this.tier);
      }
      this.tier = tier;
      classes.add(tier);
    }
    this.name.set(target.name);
    this.distance.set(target.distance);
  }
}

/** Zielblasen über der Wabenleiste (Zielblasen). */
export class TargetBubbles {
  /** Wurzelelement (Bedienfeld für den Feldschutz). */
  public readonly element: HTMLDivElement;
  private readonly context: HudContext;
  private readonly views: KeyedViews<BubbleView>;
  private readonly byElement = new WeakMap<Element, BubbleView>();

  private readonly onClick = (event: MouseEvent): void => {
    const ref = this.viewAt(event.target)?.ref;
    if (ref === undefined) {
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.shiftKey) {
      this.context.actions.unlock(ref);
    } else {
      this.context.actions.setActiveTarget(ref);
    }
  };

  private readonly onContextMenu = (event: MouseEvent): void => {
    const target = this.viewAt(event.target)?.current;
    if (target === undefined) {
      return;
    }
    event.preventDefault();
    const subject = { ref: target.ref, distance: target.distance, isLocked: true, isActiveTarget: target.isActive };
    this.context.openEntityMenu(subject, target.name, event.clientX, event.clientY);
  };

  public constructor(parent: HTMLElement, context: HudContext) {
    this.context = context;
    this.element = createElement("div", "target-bubbles", parent);
    this.element.setAttribute("aria-label", "Locked targets");
    this.views = new KeyedViews<BubbleView>(
      () => {
        const view = new BubbleView();
        this.byElement.set(view.element, view);
        view.element.title = "Make active target";
        return view;
      },
      (view) => view.element.remove(),
    );
    this.element.addEventListener("click", this.onClick);
    this.element.addEventListener("contextmenu", this.onContextMenu);
  }

  public update(targets: readonly TargetHud[]): void {
    this.views.begin();
    for (const target of targets) {
      this.views.claim(entityKey(target.ref)).update(target);
    }
    this.views.end();
    this.views.arrange(this.element);
  }

  public dispose(): void {
    this.element.removeEventListener("click", this.onClick);
    this.element.removeEventListener("contextmenu", this.onContextMenu);
    this.views.clear();
    this.element.remove();
  }

  private viewAt(target: EventTarget | null): BubbleView | undefined {
    const button = target instanceof Element ? target.closest(".bubble") : null;
    return button === null ? undefined : this.byElement.get(button);
  }
}
