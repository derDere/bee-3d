// src/hud/icons.ts — Symbolsatz der Oberfläche: selbst gezeichnete, verspielte Bilder im Bilderbuchstil
// (runde, gefüllte Formen, kräftige braune Konturen, ein weißer Glanzpunkt). Jedes Symbol ist ein eigenes
// Inline-SVG (32 × 32), damit Stilregeln und Animationen des Dokuments darauf wirken.

import type { CommandIcon, DayPhaseIcon, EntityType, ModuleIcon, WeatherIcon } from "./hudTypes";

/** Weitere Symbole der Oberfläche (Oberflächensymbol). */
export type UiIcon =
  | "honey"
  | "nectar"
  | "pollen"
  | "goldPollen"
  | "deposit"
  | "hammer"
  | "scroll"
  | "heart"
  | "crown"
  | "medal"
  | "undock"
  | "close"
  | "menu"
  | "help"
  | "sortDistance"
  | "sortName"
  | "sortType"
  | "tabAll"
  | "tabNavigation"
  | "chevron"
  | "speaker"
  | "music"
  | "mouseInvert"
  | "flashOff"
  | "qualityAuto"
  | "qualityLow"
  | "qualityMedium"
  | "qualityHigh"
  | "qualityUltra"
  | "play"
  | "keyboard"
  | "check"
  | "dots"
  | "reload"
  | "buzz"
  | "warning"
  | "info"
  | "sparkle"
  | "ghost"
  | "pencil"
  | "speed"
  | "alert"
  | "plus"
  | "arrow"
  | "loop"
  | "pollenKing"
  | "swatter"
  | "globe"
  | "lens"
  | "quiver"
  | "armor"
  | "beeFace";

/** Name eines Symbols (Symbolname). */
export type IconName = EntityType | CommandIcon | ModuleIcon | DayPhaseIcon | WeatherIcon | UiIcon;

// ---------- Farben und Zeichenhilfen ----------

const Ink = "#5b3a1e";
const Color = {
  honey: "#f7b52c",
  amber: "#e08a1e",
  cream: "#fff5dc",
  leaf: "#6dbb4a",
  leafDark: "#3f8e33",
  sky: "#7cc6f0",
  teal: "#4fc9d9",
  pink: "#f48fb1",
  red: "#e8564a",
  lilac: "#b38de0",
  white: "#ffffff",
  grey: "#b8ae9f",
  cloud: "#eef4fa",
  gold: "#ffd84d",
  wood: "#c98a4b",
  dark: "#3b3330",
  slime: "#9ccc3d",
  wing: "#e3f5ff",
  moon: "#fff0b0",
} as const;

const Outline = `stroke="${Ink}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"`;

function circle(cx: number, cy: number, r: number, fill: string): string {
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}" ${Outline}/>`;
}

function ellipse(cx: number, cy: number, rx: number, ry: number, fill: string, rotate = 0): string {
  const turn = rotate === 0 ? "" : ` transform="rotate(${rotate} ${cx} ${cy})"`;
  return `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${fill}"${turn} ${Outline}/>`;
}

function shape(d: string, fill: string): string {
  return `<path d="${d}" fill="${fill}" ${Outline}/>`;
}

function rect(x: number, y: number, width: number, height: number, radius: number, fill: string, rotate?: string): string {
  const turn = rotate === undefined ? "" : ` transform="rotate(${rotate})"`;
  return `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${radius}" fill="${fill}"${turn} ${Outline}/>`;
}

/** Nur Kontur, ohne Füllung (Strich). */
function line(d: string, width = 2, color: string = Ink): string {
  return `<path d="${d}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"/>`;
}

/** Fläche ohne Kontur, z. B. Pupillen oder Streifen (Fleck). */
function dot(cx: number, cy: number, r: number, fill: string, opacity = 1): string {
  const fade = opacity === 1 ? "" : ` opacity="${opacity}"`;
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}"${fade}/>`;
}

/** Weißer Glanzpunkt ohne Kontur (Glanz). */
function shine(cx: number, cy: number, rx: number, ry: number, rotate = 0): string {
  const turn = rotate === 0 ? "" : ` transform="rotate(${rotate} ${cx} ${cy})"`;
  return `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="#fff" opacity=".75"${turn}/>`;
}

/** Vierzackiger Funkelstern (Funkeln). */
function sparkle(cx: number, cy: number, r: number, fill: string = Color.gold): string {
  const k = r * 0.32;
  return shape(`M${cx} ${cy - r}L${cx + k} ${cy - k}L${cx + r} ${cy}L${cx + k} ${cy + k}L${cx} ${cy + r}L${cx - k} ${cy + k}L${cx - r} ${cy}L${cx - k} ${cy - k}z`, fill);
}

/** Wolke mit Mittelpunkt unten links bei (x, y) und Maßstab s (Wolke). */
function cloud(x: number, y: number, s: number, fill: string): string {
  return `<g transform="translate(${x} ${y}) scale(${s})">${shape("M0 0h15.5a4.6 4.6 0 0 0 .6-9.2 6.4 6.4 0 0 0-12.2 1.7A3.8 3.8 0 0 0 0 0z", fill)}</g>`;
}

/** Tropfenform (Tropfen). */
function drop(cx: number, top: number, height: number, fill: string): string {
  const w = height * 0.62;
  const bottom = top + height;
  return shape(`M${cx} ${top}C${cx - w * 0.35} ${top + height * 0.35} ${cx - w / 2} ${top + height * 0.52} ${cx - w / 2} ${bottom - w / 2}a${w / 2} ${w / 2} 0 0 0 ${w} 0C${cx + w / 2} ${top + height * 0.52} ${cx + w * 0.35} ${top + height * 0.35} ${cx} ${top}z`, fill);
}

/** Herzform (Herz). */
function heart(cx: number, cy: number, s: number, fill: string): string {
  return `<g transform="translate(${cx} ${cy}) scale(${s})">${shape("M0 7C-6-1-8-3.5-8-6.5A4 4 0 0 1 0-8a4 4 0 0 1 8 1.5C8-3.5 6-1 0 7z", fill)}</g>`;
}

/** Zahnrad aus acht abgerundeten Zähnen (Zahnrad). */
function gear(fill: string): string {
  let teeth = "";
  for (let index = 0; index < 8; index++) {
    teeth += rect(13.8, 2.6, 4.4, 6.4, 1.4, fill, `${index * 45} 16 16`);
  }
  return teeth + circle(16, 16, 9.2, fill) + circle(16, 16, 3.6, Color.cream);
}

/** Bienenkopf der Spielfigur (Bienengesicht). */
const BeeFace =
  line("M12.6 8.4C11.6 5.2 9.6 3.6 7.4 3.4") +
  line("M19.4 8.4c1-3.2 3-4.8 5.2-5") +
  dot(7, 3.4, 2, Color.dark) +
  dot(25, 3.4, 2, Color.dark) +
  ellipse(5.2, 14.5, 4.4, 2.8, Color.wing, -30) +
  ellipse(26.8, 14.5, 4.4, 2.8, Color.wing, 30) +
  circle(16, 18, 11, Color.honey) +
  shape("M6.6 13.2a11 11 0 0 1 18.8 0c-2.8 1.5-6 2.2-9.4 2.2s-6.6-.7-9.4-2.2z", Color.dark) +
  ellipse(11.8, 19, 2.6, 3.2, Color.white) +
  ellipse(20.2, 19, 2.6, 3.2, Color.white) +
  dot(12.3, 19.6, 1.7, Color.dark) +
  dot(20.7, 19.6, 1.7, Color.dark) +
  dot(12.9, 18.7, 0.6, Color.white) +
  dot(21.3, 18.7, 0.6, Color.white) +
  dot(8.8, 23.2, 1.7, Color.pink, 0.8) +
  dot(23.2, 23.2, 1.7, Color.pink, 0.8) +
  line("M13.4 24.4c1.5 1.4 3.7 1.4 5.2 0", 1.7);

const Markup: Readonly<Record<IconName, string>> = {
  // ---------- Objektarten ----------
  bee:
    ellipse(12.5, 9.8, 5, 3.4, Color.wing, -25) +
    ellipse(19.6, 9.4, 5, 3.4, Color.wing, 25) +
    ellipse(17, 19, 9, 7, Color.honey) +
    line("M15 12.6v12.8M20 13v12", 2.6, Color.dark) +
    shape("M25.6 17.2l3.6 1.8-3.6 1.8z", Color.dark) +
    circle(8.4, 18.2, 4.6, Color.dark) +
    dot(7.2, 17.2, 1.3, Color.white) +
    line("M7 13.9c-1-2-.6-3.9.9-4.8") +
    shine(16, 15.6, 2.8, 1.3, -15),
  fly:
    ellipse(9.6, 12, 6, 3.1, Color.cloud, 30) +
    ellipse(22.4, 12, 6, 3.1, Color.cloud, -30) +
    ellipse(16, 20.5, 7, 7.8, "#4b4f57") +
    line("M11.2 19.6h9.6M11.8 23.6h8.4", 1.4, "#737985") +
    circle(16, 11.6, 5.4, "#4b4f57") +
    circle(13.4, 10.8, 2.7, Color.red) +
    circle(18.6, 10.8, 2.7, Color.red) +
    dot(12.6, 9.9, 0.9, Color.white) +
    dot(17.8, 9.9, 0.9, Color.white) +
    line("M10.8 6.9l3.6 1.8M21.2 6.9l-3.6 1.8", 1.8),
  flowerPatch:
    line("M16 20v8.6", 2.4, Color.leafDark) +
    shape("M16 25.4c2.8-3.6 6.6-4 8-3.2-.8 3-4.8 4.4-8 3.2z", Color.leaf) +
    circle(16, 7.6, 4.3, Color.pink) +
    circle(22, 11.8, 4.3, Color.pink) +
    circle(19.7, 18.8, 4.3, Color.pink) +
    circle(12.3, 18.8, 4.3, Color.pink) +
    circle(10, 11.8, 4.3, Color.pink) +
    circle(16, 13.6, 3.6, Color.honey) +
    dot(15, 12.6, 1, Color.white, 0.8),
  hive:
    shape("M5 23.4c0-2 1.6-3.2 3.6-3.2h14.8c2 0 3.6 1.2 3.6 3.2v1.4c0 1.4-1.1 2.6-2.6 2.6H7.6C6.1 27.4 5 26.2 5 24.8z", Color.honey) +
    shape("M6.6 17.6c0-1.8 1.4-3 3.2-3h12.4c1.8 0 3.2 1.2 3.2 3v2.6H6.6z", Color.honey) +
    shape("M9 14.6C9 9.6 12.1 5.4 16 5.4s7 4.2 7 9.2z", Color.honey) +
    ellipse(16, 23.6, 2.6, 2.1, Color.dark) +
    shine(12.6, 10.4, 1.4, 2.6, 25),
  island:
    shape("M5.4 15.6h21.2l-4.4 7.4-3.9 6c-1.2 1.6-3.6 1.6-4.8 0L9.6 23z", "#b07a4a") +
    shape("M3.6 15.4c0-2.6 3.8-4.2 12.4-4.2s12.4 1.6 12.4 4.2c0 1.6-3.8 2.6-12.4 2.6S3.6 17 3.6 15.4z", Color.leaf) +
    line("M21.4 11.6V7.4", 2.4, "#7a4f2a") +
    circle(21.4, 6.4, 3.6, Color.leafDark) +
    dot(9.2, 14, 1.1, Color.pink) +
    dot(12.6, 13, 1, Color.white),
  nest:
    shape("M4.4 26.6c0-6 3-11 6-13.2C12 9.6 14.4 7.4 16 7.4s4 2.2 5.6 6c3 2.2 6 7.2 6 13.2z", "#9b7a9e") +
    ellipse(11.8, 19, 1.9, 2.3, Color.dark) +
    ellipse(19.8, 16, 1.6, 2, Color.dark) +
    ellipse(16.6, 22.8, 2.2, 2.4, Color.dark) +
    shape("M23.4 19.6c1.6 0 2.2 1.3 2.2 2.6s-.7 2.6-1.5 2.6-1.3-1.1-1.3-2.2.6-3 .6-3z", Color.slime),

  // ---------- Befehle ----------
  select: shape("M9 4.6l14.6 11.2-6.4 1.1 3.9 7.4-3.3 1.7-3.9-7.4-4.9 4.4z", Color.white) + line("M24.4 5.6l1-2.4M27.4 9.2l2.4-1M26.8 13.6l2.2.8", 1.8),
  approach:
    line("M23.6 6.4v19") +
    shape("M23.6 6.8l6 2.7-6 2.7z", Color.red) +
    shape("M3.6 18.6h11.6v-4l6.2 6-6.2 6v-4H3.6z", Color.honey) +
    line("M4 11.6h5.4M6 8h4", 1.6),
  orbit:
    circle(16, 16, 4.4, Color.honey) +
    `<path d="M16 4.4a11.6 11.6 0 1 1-10.4 6.5" fill="none" stroke="${Ink}" stroke-width="2.4" stroke-linecap="round" stroke-dasharray="3.4 3.2"/>` +
    shape("M2.9 9l3.1 4.1 4-3z", Ink),
  keepRange: circle(6.6, 16, 3.8, Color.sky) + circle(25.4, 16, 3.8, Color.honey) + line("M11.4 16h9.2M13.6 13.2L10.8 16l2.8 2.8M18.4 13.2l2.8 2.8-2.8 2.8", 2.2),
  align: circle(23.8, 9, 4.8, Color.white) + dot(23.8, 9, 2, Color.red) + line("M6 26.6c0-9.2 6-15.2 12.8-15.6", 2.4) + shape("M17.2 7.4l4 3.4-4.4 2.6z", Ink),
  warp:
    line("M4.4 11.6c4.2-3.2 13.2-3.2 15.2 1 1.4 3-2.2 5.6-5.2 4.2", 2.4) +
    line("M3.6 18.4c4.6 2 10.2 2.4 15.4-.6", 2.4) +
    line("M6.6 24.6c3.6 1.6 8.8 1.4 12.2-1", 2.4) +
    sparkle(25, 9, 4.4),
  dock:
    shape("M8 19.2c0-5 3.6-8.6 8-8.6s8 3.6 8 8.6z", Color.honey) +
    shape("M6.4 19.2h19.2v4.4c0 1.6-1.3 2.8-2.8 2.8H9.2c-1.6 0-2.8-1.2-2.8-2.8z", Color.honey) +
    ellipse(16, 22.8, 2.4, 1.9, Color.dark) +
    shape("M13.4 1.6h5.2v4h3.2L16 10.8l-5.8-5.2h3.2z", Color.sky),
  stop: shape("M11 3.4h10l7.6 7.6v10L21 28.6H11L3.4 21V11z", Color.red) + rect(9.2, 13.8, 13.6, 4.4, 2.2, Color.white),
  lock: circle(16, 16, 10, "#ffe9ef") + circle(16, 16, 4.2, Color.red) + line("M16 2v5.2M16 24.8V30M2 16h5.2M24.8 16H30", 2.6),
  unlock:
    circle(16, 16, 10, "#f1ece6") +
    circle(16, 16, 4.2, Color.grey) +
    line("M16 2v5.2M16 24.8V30M2 16h5.2M24.8 16H30", 2.6) +
    `<rect x="14.4" y="1.6" width="3.2" height="28.8" rx="1.6" fill="${Color.red}" stroke="${Ink}" stroke-width="1.6" transform="rotate(45 16 16)"/>`,
  flyHere:
    ellipse(9.4, 11.4, 5, 3, Color.wing, -20) +
    ellipse(22.6, 11.4, 5, 3, Color.wing, 20) +
    shape("M16 29.4c-5.2-6-8-10.2-8-14.2a8 8 0 0 1 16 0c0 4-2.8 8.2-8 14.2z", Color.honey) +
    circle(16, 14.8, 3, Color.white),
  home:
    rect(7.4, 14, 17.2, 14, 2.2, Color.cream) +
    shape("M3.8 15.6L16 4.8l12.2 10.8c.6.6.2 1.6-.6 1.6H4.4c-.8 0-1.2-1-.6-1.6z", Color.red) +
    heart(16, 21.6, 0.62, Color.pink),

  // ---------- Module ----------
  laserLeft:
    shape("M2.4 5.6l3.2-3.2 11 11.6-4.4 4.2z", "#ff7a6b") +
    sparkle(4.6, 4.6, 3.4, Color.white) +
    ellipse(19.4, 19.6, 9, 7, Color.white) +
    circle(19.4, 19.6, 4.2, Color.red) +
    dot(19.4, 19.6, 1.9, Color.dark) +
    dot(17.8, 18, 1.1, Color.white),
  laserRight:
    shape("M29.6 5.6l-3.2-3.2-11 11.6 4.4 4.2z", "#ff7a6b") +
    sparkle(27.4, 4.6, 3.4, Color.white) +
    ellipse(12.6, 19.6, 9, 7, Color.white) +
    circle(12.6, 19.6, 4.2, Color.red) +
    dot(12.6, 19.6, 1.9, Color.dark) +
    dot(11, 18, 1.1, Color.white),
  gatling:
    line("M3.6 8.4h9.6M5.4 15.4h12M3 22.4h9.2", 2) +
    circle(22.4, 8.6, 3.7, Color.honey) +
    circle(25.4, 17.4, 3.7, Color.honey) +
    circle(18.6, 24.8, 3.7, Color.honey) +
    dot(21.3, 7.5, 1, Color.white) +
    dot(24.3, 16.3, 1, Color.white) +
    dot(17.5, 23.7, 1, Color.white),
  stinger:
    `<g transform="rotate(-45 16 16)">` +
    shape("M8.6 14.2c-3 .4-5 1-6.2 1.8 1.2.8 3.2 1.4 6.2 1.8z", "#ff9a3c") +
    rect(8.4, 12.8, 14.4, 6.4, 3.2, Color.cream) +
    shape("M22 12.8l7.2 3.2-7.2 3.2z", Color.amber) +
    shape("M10.6 12.8l-2.6-3.6h4.6z", Color.red) +
    shape("M10.6 19.2l-2.6 3.6h4.6z", Color.red) +
    `</g>`,
  collector:
    `<g transform="rotate(-35 16 16)">` +
    rect(14.4, 2.6, 3.2, 12.8, 1.6, Color.wood) +
    rect(10.4, 14.6, 11.2, 5.2, 2, Color.honey) +
    shape("M11 19.8h10l-1.2 7.2h-7.6z", "#f9d77e") +
    line("M13.8 20.6l.4 5.6M16 20.6v5.6M18.2 20.6l-.4 5.6", 1.2) +
    `</g>` +
    circle(25.4, 24.4, 2.4, Color.gold) +
    circle(22.2, 28.2, 1.8, Color.gold),
  boost: ellipse(19.6, 11.4, 7.2, 4.4, Color.wing, -25) + ellipse(20.4, 19.6, 6.2, 3.6, Color.wing, 15) + line("M3 9.6h7.4M2 16h8.4M4 22.4h6.4", 2),
  repair: drop(16, 3.4, 26, Color.teal) + shape("M14.3 14.6h3.4v3.6h3.6v3.4h-3.6v3.6h-3.4v-3.6h-3.6v-3.4h3.6z", Color.white) + shine(11.6, 17.6, 1.4, 2.8, 20),
  scanner:
    shape("M7.4 28.6c0-5.2 3.8-8.4 8.6-8.4s8.6 3.2 8.6 8.4z", Color.honey) +
    line("M13 20.8C11.6 15.8 9 12.8 6 12M19 20.8c1.4-5 4-8 7-8.8", 2.2) +
    circle(6, 12, 2.4, Color.dark) +
    circle(26, 12, 2.4, Color.dark) +
    line("M3.2 6.6c1-1.7 3-2.5 4.8-2.1M24 4.5c1.8-.4 3.8.4 4.8 2.1M11.2 5.6c2.2-2.6 7.4-2.6 9.6 0", 1.7),

  // ---------- Tagesabschnitte ----------
  night: shape("M20.6 4.4A11.6 11.6 0 1 0 27.6 21 9.6 9.6 0 0 1 20.6 4.4z", Color.moon) + sparkle(8.6, 8, 3.4) + dot(26, 9.4, 1.3, Color.white),
  dawn: line("M3 22.6h26") + shape("M6.2 22.6a9.8 9.8 0 0 1 19.6 0z", "#ffb38a") + line("M16 6.2v3.2M7.4 9.8l2.2 2.3M24.6 9.8l-2.2 2.3", 2) + line("M7 26.6h18", 1.6),
  morning: circle(13.6, 13.6, 6.4, "#ffe066") + line("M13.6 3.2v2.6M3.2 13.6h2.6M6.2 6.2l1.8 1.8M21 6.2l-1.8 1.8M6.2 21l1.8-1.8", 2) + cloud(11.6, 27, 0.92, Color.white),
  noon:
    circle(16, 16, 7.4, Color.honey) +
    line("M16 2.4v3.2M16 26.4v3.2M2.4 16h3.2M26.4 16h3.2M6.4 6.4l2.2 2.2M23.4 23.4l2.2 2.2M6.4 25.6l2.2-2.2M23.4 8.6l2.2-2.2", 2.2) +
    dot(13.4, 15, 1, Color.dark) +
    dot(18.6, 15, 1, Color.dark) +
    line("M13.4 18.2c1.4 1.4 3.8 1.4 5.2 0", 1.5),
  afternoon: circle(15, 16.6, 6.8, "#ffc24a") + line("M15 4.6v3M4.4 16.6h3M7.6 9.2l2 2M22.4 9.2l-2 2M25.6 16.6h-3", 2) + line("M5.4 26.6h19.2", 1.8),
  evening: shape("M6 21.4a10 10 0 0 1 20 0z", "#ff8a4c") + line("M3 21.6h26") + line("M6.6 25.4h18.8M10.4 28.6h11.2", 1.8) + line("M21.4 7.4l1.6 1.4 1.6-1.4M25.6 10.6l1.2 1 1.2-1", 1.6),

  // ---------- Wetter ----------
  clear: sparkle(16, 16, 12) + dot(16, 16, 2.2, Color.white, 0.9) + sparkle(26, 6, 3, Color.white),
  fair: circle(11.6, 11.4, 5.8, Color.honey) + line("M11.6 2.6v2.2M2.8 11.4H5M5.4 5.2l1.6 1.6M17.8 5.2l-1.6 1.6", 2) + cloud(9.6, 26, 1.05, Color.white),
  "misty-morning": cloud(7.4, 17.4, 1.1, Color.cloud) + line("M4 22.4h15.6M9.6 26.2h18.4M5.6 29.6h12", 2, "#8fa0b3"),
  overcast: cloud(3.6, 18, 0.95, "#c9d3dc") + cloud(8.6, 25, 1.08, Color.white),
  shower: cloud(6.4, 18.6, 1.15, Color.cloud) + drop(10.6, 21.2, 6.6, Color.sky) + drop(17, 22.8, 6.6, Color.sky) + drop(23.4, 21.2, 6.6, Color.sky),
  storm: cloud(6, 17.4, 1.2, "#8a8fa3") + shape("M16.4 15.4l-4.6 7.4h4l-2.4 7 7.6-9.2h-4.4l3-5.2z", Color.gold),

  // ---------- Oberfläche ----------
  honey:
    shape("M7 13.6c0-1.4 1.1-2.6 2.6-2.6h12.8c1.4 0 2.6 1.2 2.6 2.6v9.4c0 3.6-2.9 6.6-6.6 6.6h-4.8C9.9 29.6 7 26.6 7 23z", Color.honey) +
    rect(5.4, 6.8, 21.2, 5.2, 2.6, Color.amber) +
    shape("M16 15.6l3.6 2v4.2L16 23.8l-3.6-2v-4.2z", Color.cream) +
    shine(10.6, 20.4, 1.2, 3.2),
  nectar: drop(16, 3, 26.4, Color.teal) + shine(11.8, 19, 1.6, 3.6, 18),
  pollen:
    line("M7.6 15.4C7.6 7.6 24.4 7.6 24.4 15.4", 2.2) +
    circle(11.4, 13.4, 3.6, Color.honey) +
    circle(17.4, 11.8, 3.6, Color.honey) +
    circle(21.8, 14.6, 3.2, Color.gold) +
    shape("M4.4 15.6h23.2l-2.6 10.4c-.4 1.6-1.8 2.6-3.4 2.6H10.4c-1.6 0-3-1-3.4-2.6z", Color.wood) +
    line("M8.6 19.4h14.8M9.8 23.4h12.4M12.4 15.6l1.4 13M19.6 15.6l-1.4 13", 1.3, "#8a5a2e"),
  goldPollen: circle(14, 17.6, 7.6, Color.gold) + shine(11.6, 14.6, 2.2, 1.4, -30) + sparkle(25, 7.4, 4) + sparkle(26, 21.4, 2.6, Color.white),
  deposit:
    shape("M8 15.6c0-1.3 1-2.4 2.4-2.4h11.2c1.4 0 2.4 1.1 2.4 2.4v8.2c0 3.2-2.6 5.8-5.8 5.8h-4.4C10.6 29.6 8 27 8 23.8z", Color.honey) +
    rect(6.6, 9.8, 18.8, 4.6, 2.3, Color.amber) +
    shape("M13.2 1.2h5.6v3.4h3.4L16 9.6 9.8 4.6h3.4z", Color.sky) +
    shine(11.6, 21.6, 1.1, 2.8),
  hammer:
    `<g transform="rotate(-40 16 16)">` +
    rect(14.2, 10.6, 3.6, 19, 1.8, Color.wood) +
    rect(7.2, 3.6, 17.6, 8.2, 2.6, "#9aa3ad") +
    `</g>` +
    shine(9.6, 8.6, 2, 1, -40),
  scroll:
    rect(6.4, 6.2, 19.2, 20, 2, Color.cream) +
    rect(4, 3.4, 24, 5, 2.5, Color.wood) +
    rect(4, 24, 24, 5, 2.5, Color.wood) +
    line("M10.2 13h11.6M10.2 16.8h11.6M10.2 20.6h7.6", 1.6),
  heart: heart(16, 16.4, 1.55, Color.pink) + shine(10.8, 11.2, 1.8, 2.6, -40),
  crown: shape("M4.4 23.4L3 9.4l7 5.8L16 5.4l6 9.8 7-5.8-1.4 14z", Color.gold) + rect(4.4, 22.8, 23.2, 5, 2, Color.amber) + dot(16, 16.6, 1.8, Color.red) + dot(9.6, 18.4, 1.3, Color.sky) + dot(22.4, 18.4, 1.3, Color.leaf),
  medal: shape("M9.4 2.6h5.2l3 8.8-4 2.6z", Color.sky) + shape("M22.6 2.6h-5.2l-3 8.8 4 2.6z", Color.red) + circle(16, 20.2, 8.4, Color.gold) + sparkle(16, 20.2, 4.6, Color.amber),
  undock: shape("M6.6 28.6V13.4a9.4 9.4 0 0 1 18.8 0v15.2z", Color.wood) + shape("M10.2 28.6V14.6a5.8 5.8 0 0 1 11.6 0v14z", Color.dark) + shape("M15.4 17.2l7.6-6.8v3.6h5.4v6.4H23v3.6z", Color.sky),
  close: line("M9.6 9.6l12.8 12.8M22.4 9.6L9.6 22.4", 3.4),
  menu: gear(Color.honey),
  help:
    shape("M5.6 6.6c0-1.6 1.3-3 3-3h14.8c1.6 0 3 1.4 3 3v13c0 1.6-1.4 3-3 3H15l-5.6 5.2v-5.2H8.6c-1.7 0-3-1.4-3-3z", Color.sky) +
    line("M12.6 10.4c0-2.2 1.6-3.4 3.4-3.4s3.4 1.2 3.4 3.2c0 2.6-3.4 2.8-3.4 5", 2.4) +
    dot(16, 18.6, 1.6, Ink),
  sortDistance: rect(2.4, 11.6, 27.2, 8.8, 2.4, Color.honey) + line("M7.6 11.6v4M12.2 11.6v2.6M16.8 11.6v4M21.4 11.6v2.6M26 11.6v4", 1.6),
  sortName: line("M3.6 15.4l4-10.2 4 10.2M5 11.8h5.2", 2.2) + line("M16.6 5.2h8.6l-8.6 10.2h8.6", 2.2) + line("M16 19v9.4M12.6 25.2l3.4 3.4 3.4-3.4", 2.4),
  sortType: circle(9.4, 9.4, 5.6, Color.pink) + shape("M22.6 3.6l6 10h-12z", Color.leaf) + rect(5.8, 18.8, 11, 10, 2.2, Color.sky) + circle(23.4, 23.6, 4.6, Color.honey),
  tabAll: sparkle(12.4, 13, 9) + sparkle(24.4, 9, 4.4, Color.pink) + sparkle(23.6, 23.4, 4.8, Color.sky),
  tabNavigation:
    rect(14.4, 4.2, 3.2, 25.2, 1.6, Color.wood) +
    shape("M5 7h17l4 3.4-4 3.4H5z", Color.honey) +
    shape("M27 15.4H10l-4 3.4 4 3.4h17z", Color.sky),
  chevron: line("M8.8 12.4L16 19.6l7.2-7.2", 3.4),
  speaker: shape("M4.4 12.4h5.4l7.2-6v19.2l-7.2-6H4.4z", Color.honey) + line("M20.6 11.2c2.4 2.6 2.4 7 0 9.6M24.2 7.8c4.4 4.6 4.4 11.8 0 16.4", 2.2),
  music: line("M12 24.6V7.4l14-3.4v17.2", 2.4) + ellipse(9.2, 24.6, 3.8, 3, Color.pink, -15) + ellipse(23.2, 21.2, 3.8, 3, Color.pink, -15),
  mouseInvert: rect(6, 4.2, 14.8, 23.6, 7.4, Color.white) + line("M13.4 4.6v7.4M6.2 12h14.4", 1.6) + line("M24.4 9.6l2.4-2.8 2.4 2.8M24.4 22.4l2.4 2.8 2.4-2.8M26.8 7v18", 1.8),
  flashOff: shape("M18.4 2.6L7.6 17.4h7.2l-2.6 12 12.2-16.2h-7.6l3.2-10.6z", Color.gold) + line("M4.6 4.6l22.8 22.8", 3.2, Color.red),
  qualityAuto:
    `<rect x="14.4" y="7.6" width="4" height="22" rx="2" fill="${Color.wood}" ${Outline} transform="rotate(40 16 16)"/>` +
    sparkle(21.4, 8.4, 6.2) +
    dot(9, 7, 1.5, Color.pink) +
    dot(27.2, 18.4, 1.3, Color.sky),
  qualityLow: sparkle(16, 16, 9.4),
  qualityMedium: sparkle(10.6, 16.6, 7.2) + sparkle(22.6, 12.6, 7.2),
  qualityHigh: sparkle(16, 9.4, 6.6) + sparkle(8.6, 21, 6.2) + sparkle(23.4, 21, 6.2),
  qualityUltra: shape("M8.4 4.2h15.2l5 7.2L16 28.6 3.4 11.4z", Color.sky) + line("M3.4 11.4h25.2M12 4.4l-2.2 7L16 28.4l6.2-17-2.2-7", 1.4) + shine(10.6, 8, 1.6, 0.9, -30),
  play: shape("M10.4 5.6c0-1.6 1.7-2.6 3.1-1.8l14 9.2c1.3.9 1.3 2.8 0 3.6l-14 9.2c-1.4.9-3.1-.1-3.1-1.8z", Color.leaf) + shine(14.2, 10.4, 1.3, 2.6, -30),
  keyboard:
    rect(2.6, 8.4, 26.8, 16, 3, Color.cream) +
    `<g fill="${Ink}"><rect x="6" y="12" width="3" height="3" rx=".8"/><rect x="10.8" y="12" width="3" height="3" rx=".8"/><rect x="15.6" y="12" width="3" height="3" rx=".8"/><rect x="20.4" y="12" width="3" height="3" rx=".8"/><rect x="8.4" y="17.4" width="15.2" height="3" rx="1"/></g>`,
  check: line("M7.2 16.8l5.6 5.6L25 10.2", 4),
  dots: dot(8, 16, 2.8, Ink) + dot(16, 16, 2.8, Ink) + dot(24, 16, 2.8, Ink),
  reload: line("M25.6 12.6A10.4 10.4 0 0 0 6.6 11.4M6.4 19.4a10.4 10.4 0 0 0 19 1.2", 2.8) + shape("M25.6 4.6v8.6H17z", Ink) + shape("M6.4 27.4v-8.6H15z", Ink),
  buzz: line("M11.4 21.4V7.6l11.8-2.8v13.8", 2.2) + ellipse(9, 21.6, 3.2, 2.6, Color.honey, -15) + ellipse(20.8, 18.8, 3.2, 2.6, Color.honey, -15) + line("M3.4 28c2-1.6 4-1.6 6 0s4 1.6 6 0 4-1.6 6 0 4 1.6 6 0", 1.8),
  warning: shape("M16 3.6c1 0 1.8.5 2.3 1.4l11 19.6c1 1.8-.3 3.8-2.3 3.8H5c-2 0-3.3-2-2.3-3.8l11-19.6c.5-.9 1.3-1.4 2.3-1.4z", Color.honey) + line("M16 11.6v7.6", 3) + dot(16, 23.4, 1.8, Ink),
  info: circle(16, 16, 12.4, Color.sky) + line("M16 14.6v8.4", 3.2) + dot(16, 9.6, 2, Ink),
  sparkle: sparkle(14.6, 16.4, 11) + sparkle(25.4, 7, 3.6, Color.white) + sparkle(25.6, 24.6, 2.6),
  ghost:
    shape("M6.4 28V14.6a9.6 9.6 0 0 1 19.2 0V28l-3.2-2.6-3.2 2.6-3.2-2.6-3.2 2.6-3.2-2.6z", "#e6fbff") +
    ellipse(12.6, 15.2, 1.8, 2.4, Color.dark) +
    ellipse(19.4, 15.2, 1.8, 2.4, Color.dark) +
    ellipse(16, 20.6, 1.8, 1.4, Color.dark),
  pencil: `<g transform="rotate(45 16 16)">${rect(12.4, 2, 7.2, 21, 1.6, Color.honey)}${shape("M12.4 23h7.2L16 30z", Color.cream)}${rect(12.4, 2, 7.2, 4, 1.2, Color.pink)}</g>`,
  speed: ellipse(18, 12.6, 9, 5.4, Color.wing, -20) + ellipse(18.6, 21.2, 7.2, 4.2, Color.wing, 10) + line("M2.6 12.4h4.6M3.6 18.4h4", 2),
  alert: circle(16, 16, 12, Color.red) + line("M16 9.4v8", 3.4, Color.white) + dot(16, 22.6, 2, Color.white),
  plus: shape("M13.6 5.2h4.8v8.4h8.4v4.8h-8.4v8.4h-4.8v-8.4H5.2v-4.8h8.4z", Color.leaf),
  arrow: shape("M4 12.4h11.6V6.8l12.4 9.2-12.4 9.2v-5.6H4z", Color.honey) + shine(9.4, 14.4, 3.4, 0.9),
  loop: line("M24.6 11.8a9.6 9.6 0 1 0 1.8 7.4", 3) + shape("M20.6 6.4l6.8-.2-1.4 6.8z", Ink),
  pollenKing: circle(16, 20.4, 8.2, Color.honey) + dot(13.4, 17.6, 1.2, Color.white) + shape("M8.6 12.2L7.6 3.6l4.6 3.8L16 1.8l3.8 5.6 4.6-3.8-1 8.6z", Color.gold),
  swatter: `<g transform="rotate(-35 16 16)">${rect(14.6, 14, 2.8, 16, 1.4, Color.wood)}${rect(8.6, 1.6, 14.8, 13.6, 3.4, Color.leaf)}${line("M12.4 5.4v6M16 5.4v6M19.6 5.4v6M10.8 8.4h10.4", 1.3)}</g>`,
  globe: circle(16, 16, 12, Color.sky) + shape("M9 9.4c3 .6 4.4 2.4 3.6 4.6-.8 2.2.6 3.6 2.6 4.2 1.4.4 1.2 2.6-.4 3.8-2 1.4-5.6.8-7.6-2.6", Color.leaf) + shape("M19.4 6.4c2.4.4 5.4 2.6 6.2 5.6-2 .4-3.8-.6-4.6-2-.8-1-1.8-1.6-1.6-3.6z", Color.leaf) + shine(11.4, 9.4, 2.4, 1.4, -30),
  lens: line("M20.4 20.4l7.2 7.2", 4.4, Color.wood) + circle(13.4, 13.4, 9.6, "#d9f2ff") + shine(10.2, 9.8, 2.6, 1.6, -40),
  quiver:
    rect(9, 12.6, 14, 16, 4, Color.wood) +
    line("M11.8 12.6L9.8 3.6M16 12.6V2.8M20.2 12.6l2-9", 2.2) +
    shape("M8.6 4.4l1-3 1.8 2.6z", Color.amber) +
    shape("M15 2.8l1-2.8 1 2.8z", Color.amber) +
    shape("M20.8 3.4l1.8-2.6 1 3z", Color.amber),
  armor: shape("M16 3l11 3.6v8.2c0 6.8-4.6 11.8-11 14.4C9.6 26.6 5 21.6 5 14.8V6.6z", Color.honey) + shape("M16 9.4l4 2.3v4.6L16 18.6l-4-2.3v-4.6z", Color.amber) + shine(10.4, 10.4, 1.2, 2.6),
  beeFace: BeeFace,
};

const Templates = new Map<IconName, SVGSVGElement>();

/** Vorlage eines Symbols, einmal geparst und danach nur noch geklont. */
function template(name: IconName): SVGSVGElement {
  let svg = Templates.get(name);
  if (svg === undefined) {
    const holder = document.createElement("template");
    holder.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" aria-hidden="true" focusable="false">${Markup[name]}</svg>`;
    const parsed = holder.content.firstElementChild;
    if (!(parsed instanceof SVGSVGElement)) {
      throw new Error(`Symbol ${name} ließ sich nicht anlegen.`);
    }
    svg = parsed;
    Templates.set(name, svg);
  }
  return svg;
}

/** Legt ein Symbol als eigenes Inline-SVG an (Symbol). */
export function createIcon(name: IconName, className = "", parent?: Node): SVGSVGElement {
  const svg = template(name).cloneNode(true) as SVGSVGElement;
  svg.setAttribute("class", className === "" ? "icon" : `icon ${className}`);
  parent?.appendChild(svg);
  return svg;
}

/** Symbolstelle, deren Bild wechseln kann; ersetzt das SVG nur bei geändertem Namen (Symbolfeld). */
export class IconSlot {
  private readonly host: HTMLElement;
  private readonly className: string;
  private current: IconName | undefined;
  private svg: SVGSVGElement | undefined;

  public constructor(host: HTMLElement, className = "") {
    this.host = host;
    this.className = className;
  }

  public set(name: IconName): void {
    if (name === this.current) {
      return;
    }
    this.current = name;
    const next = createIcon(name, this.className);
    if (this.svg === undefined) {
      this.host.appendChild(next);
    } else {
      this.svg.replaceWith(next);
    }
    this.svg = next;
  }
}

/** Alle Symbolnamen, z. B. für die Symboltafel der Entwicklungsseite. */
export const IconNames = Object.keys(Markup) as IconName[];

const UpgradeIcons: Readonly<Record<string, IconName>> = {
  lens: "lens",
  gatling: "gatling",
  quiver: "quiver",
  brush: "collector",
  cargo: "pollen",
  wings: "boost",
  armor: "armor",
  antenna: "scanner",
  nectar: "nectar",
};

/** Symbol eines Werkstatt-Upgrades nach seiner Art; Unbekanntes bekommt den Hammer. */
export function upgradeIcon(kind: string): IconName {
  return UpgradeIcons[kind] ?? "hammer";
}

const AchievementIcons: Readonly<Record<string, IconName>> = {
  firstSting: "stinger",
  pollenRoyalty: "pollenKing",
  ghostHour: "ghost",
  exterminator: "swatter",
  stormRunner: "storm",
  queenSlayer: "crown",
  goldDigger: "goldPollen",
  globetrotter: "globe",
};

/** Symbol eines Erfolgs nach seinem Schlüssel; Unbekanntes bekommt die Medaille. */
export function achievementIcon(key: string): IconName {
  return AchievementIcons[key] ?? "medal";
}
