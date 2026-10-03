// src/hud/uiScale.ts — Größe der Oberfläche (UI scale): erlaubte Stufen und das Anwenden als Faktor auf `--u`.

/** Kleinste und größte Stufe sowie die Schrittweite der Einstellung „UI scale“ (Faktor, 1 = Grundgröße). */
export const UiScaleMin = 0.7;
export const UiScaleMax = 1.3;
export const UiScaleStep = 0.1;

/** Rundet einen gespeicherten Faktor auf die nächste erlaubte Stufe; Unbrauchbares ergibt die Grundgröße. */
export function normalizeUiScale(scale: number): number {
  if (!Number.isFinite(scale)) {
    return 1;
  }
  const clamped = Math.min(UiScaleMax, Math.max(UiScaleMin, scale));
  return Math.round(clamped / UiScaleStep) / Math.round(1 / UiScaleStep);
}

/** Setzt den Faktor auf die Oberfläche; hud.css multipliziert `--u` damit (Oberflächengröße). */
export function applyUiScale(root: HTMLElement, scale: number): void {
  root.style.setProperty("--ui-scale", String(scale));
}
