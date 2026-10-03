// src/hud/lookAtBadge.ts — Hinweis beim Ansehen (wie in EVE): Auge und Name des angesehenen Objekts über den
// Zielblasen, dazu ein runder Knopf, der die Kamera zurück auf die eigene Biene richtet.

import { createElement, HintSlot, setVisible, TextSlot } from "./dom";
import { entityName, EntityTypeLabel, sameEntity } from "./entities";
import type { EntityRef, HudActions, HudModel } from "./hudTypes";
import { createIconButton } from "./iconButton";
import { createIcon } from "./icons";

/** Hinweis „Ansehen“ mit Rückkehrknopf (Ansehen-Hinweis). */
export class LookAtBadge {
  /** Wurzelelement (Bedienfeld für den Feldschutz). */
  public readonly element: HTMLDivElement;
  private readonly name: TextSlot;
  private readonly hint: HintSlot;
  private readonly back: HTMLButtonElement;
  private readonly actions: HudActions;
  private ref: EntityRef | undefined;
  /** Zuletzt gefundener Name; Objekte jenseits von Liste und Klammern behalten so ihren Namen. */
  private knownName: string | undefined;

  private readonly onBack = (): void => this.actions.lookAt(undefined);

  public constructor(parent: HTMLElement, actions: HudActions) {
    this.actions = actions;
    this.element = createElement("div", "look-badge", parent);
    this.element.setAttribute("role", "status");
    this.element.hidden = true;
    const label = createElement("span", "look-badge-label", this.element);
    this.hint = new HintSlot(label);
    createIcon("lookAt", "look-badge-eye", label);
    this.name = new TextSlot(createElement("span", "look-badge-name", label));
    this.back = createIconButton("round-btn look-badge-back", "beeFace", "Back to my bee", this.element, undefined, "Point the camera at your own bee again.");
    this.back.tabIndex = -1;
    this.back.addEventListener("click", this.onBack);
  }

  /** Jeden Frame im Flug; ohne angesehenes Objekt bleibt der Hinweis verborgen. */
  public update(model: HudModel): void {
    const ref = model.lookAt;
    setVisible(this.element, ref !== undefined);
    if (ref === undefined) {
      this.ref = undefined;
      this.knownName = undefined;
      return;
    }
    if (!sameEntity(ref, this.ref)) {
      this.ref = ref;
      this.knownName = undefined;
    }
    this.knownName = entityName(model, ref) ?? this.knownName;
    const name = this.knownName ?? EntityTypeLabel[ref.type];
    this.name.set(name);
    this.hint.set(`Looking at ${name}`, "The camera follows it. Your bee keeps flying as before.");
  }

  public dispose(): void {
    this.back.removeEventListener("click", this.onBack);
    this.element.remove();
  }
}
