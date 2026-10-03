// src/hud/controlsReference.ts — Inhalt der Steuerungshilfe nach `spec/steuerung.md`, auf Englisch.

import type { IconName } from "./icons";

/** Zeile der Steuerungshilfe (Steuerungseintrag). */
export interface ControlRow {
  readonly input: string;
  readonly effect: string;
  readonly note?: string;
}

/** Abschnitt der Steuerungshilfe (Steuerungsabschnitt). */
export interface ControlSection {
  readonly title: string;
  readonly icon: IconName;
  /** `true`: Eingaben sind Tasten und erscheinen als Tastenkappe; `false`: Gesten oder Mausbewegungen. */
  readonly keys: boolean;
  readonly intro?: string;
  readonly rows: readonly ControlRow[];
  readonly footnote?: string;
}

/** Vollständige Steuerungshilfe für das Menü (Steuerungshilfe). */
export const ControlSections: readonly ControlSection[] = [
  {
    title: "Mouse",
    icon: "select",
    keys: false,
    rows: [
      { input: "Drag with the left button", effect: "Turn the camera around your bee" },
      { input: "Mouse wheel", effect: "Zoom from 0.5 m to 400 m" },
      { input: "Click an object", effect: "Select it, in space or in the Nearby list" },
      { input: "Double-click empty space", effect: "Your bee turns that way and flies off" },
      { input: "Ctrl + click an object", effect: "Lock it as a target" },
      { input: "Ctrl + Shift + click", effect: "Unlock a target" },
      { input: "Right-click", effect: "Flower menu with every command" },
      { input: "Click the speed stem", effect: "Set your speed as a share of top speed" },
      { input: "Hold Alt + left button", effect: "Both laser eyes fire at the point under the cursor; an enemy there gets hit without locking" },
    ],
  },
  {
    title: "Commands",
    icon: "keyboard",
    keys: true,
    intro: "Hold the key and click an object. Without a click the command goes to your selection.",
    rows: [
      {
        input: "Q",
        effect: "Approach",
        note: "Without a selection, Q opens the dial: the first click sets direction and distance, the second the height. Your bee flies exactly there and stops.",
      },
      { input: "W", effect: "Orbit", note: "20 m by default (10, 20, 40 or 80 m in the bubble)" },
      { input: "E", effect: "Keep range", note: "15 m by default (5, 15, 30 or 60 m in the bubble)" },
      { input: "A", effect: "Align", note: "Turns your flight direction toward the target" },
      { input: "S", effect: "Warp", note: "To objects at least 150 m away" },
      { input: "D", effect: "Dock", note: "Hives only, within 45 m" },
      { input: "Ctrl + Space", effect: "Stop" },
      { input: "F1–F8", effect: "Powers", note: "Work on the active target; press again to stop after the cycle" },
      { input: "B", effect: "Buzz", note: "Everyone nearby hears you" },
      { input: "Tab", effect: "Next locked target becomes active" },
      { input: "H", effect: "Show or hide the key help" },
      { input: "Esc", effect: "Menu, or close the flower menu" },
    ],
    footnote: "Target gone: orbiting keeps flying in the last direction, keeping range stops.",
  },
  {
    title: "Manual flight",
    icon: "speed",
    keys: true,
    rows: [
      { input: "← →", effect: "Turn left or right" },
      { input: "↑ ↓", effect: "Nose up or down" },
      { input: "R", effect: "Speed up" },
      { input: "F", effect: "Slow down" },
    ],
    footnote: "Any arrow key ends the current command and switches to manual flight.",
  },
  {
    title: "Touch",
    icon: "flyHere",
    keys: false,
    rows: [
      { input: "Left half of the screen", effect: "Thumb stick for your flight direction" },
      { input: "Right half of the screen", effect: "Thumb stick for aiming; while you hold it, both laser eyes fire that way" },
      { input: "Tap", effect: "Select" },
      { input: "Double-tap", effect: "Fly there" },
      { input: "Two-finger drag", effect: "Turn the camera" },
      { input: "Pinch", effect: "Zoom" },
      { input: "Round buttons", effect: "Commands and powers" },
    ],
  },
];

/** Eintrag der festen Tastenhilfe und der Starthilfe mit Symbol (Kurzhilfe-Eintrag). */
export interface QuickHelpRow {
  readonly icon: IconName;
  readonly input: string;
  readonly effect: string;
}

/** Feste Tastenhilfe (Taste H). */
export const QuickHelp: readonly QuickHelpRow[] = [
  { icon: "approach", input: "Q", effect: "Approach" },
  { icon: "orbit", input: "W", effect: "Orbit" },
  { icon: "keepRange", input: "E", effect: "Keep range" },
  { icon: "align", input: "A", effect: "Align" },
  { icon: "warp", input: "S", effect: "Warp" },
  { icon: "dock", input: "D", effect: "Dock" },
  { icon: "stop", input: "Ctrl+Space", effect: "Stop" },
  { icon: "laserLeft", input: "F1–F8", effect: "Powers" },
  { icon: "lock", input: "Tab", effect: "Next target" },
  { icon: "buzz", input: "B", effect: "Buzz" },
  { icon: "speed", input: "← ↑ → ↓", effect: "Manual flight" },
  { icon: "boost", input: "R / F", effect: "Faster / slower" },
  { icon: "menu", input: "Esc", effect: "Menu" },
  { icon: "help", input: "H", effect: "Hide this help" },
];

/** Das Wichtigste für den ersten Flug auf dem Startbildschirm (Starthilfe). */
export const StartHelp: readonly QuickHelpRow[] = [
  { icon: "select", input: "Drag", effect: "Look around" },
  { icon: "flyHere", input: "Double-click", effect: "Fly there" },
  { icon: "lock", input: "Ctrl + click", effect: "Lock a target" },
  { icon: "approach", input: "Q W E A S D", effect: "Commands" },
  { icon: "laserLeft", input: "F1–F8", effect: "Powers" },
  { icon: "help", input: "H", effect: "Key help" },
];
