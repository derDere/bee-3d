// src/hud/iconButton.ts — runder Symbolknopf mit englischem Hinweis und Tastenabzeichen.

import { createButton, createElement, setHint } from "./dom";
import { createIcon, type IconName } from "./icons";

/** Legt ein kleines Tastenabzeichen an, z. B. „Q“ oder „F1“ (Tastenabzeichen). */
export function createKeyBadge(hotkey: string, parent: Node): HTMLSpanElement {
  const badge = createElement("span", "key-badge", parent, hotkey);
  badge.setAttribute("aria-hidden", "true");
  return badge;
}

/**
 * Runder Symbolknopf (Symbolknopf): nur ein Bild, der englische Text steht in title und aria-label;
 * ein Tastenkürzel erscheint als Abzeichen und im Hinweis.
 */
export function createIconButton(className: string, icon: IconName, label: string, parent?: Node, hotkey?: string, detail?: string): HTMLButtonElement {
  const button = createButton(`icon-btn ${className}`, parent);
  setHint(button, hotkey === undefined ? label : `${label} (${hotkey})`, detail);
  createIcon(icon, "icon-btn-icon", button);
  if (hotkey !== undefined) {
    createKeyBadge(hotkey, button);
  }
  return button;
}
