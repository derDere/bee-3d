// src/hud/hud.ts — HTML-Oberfläche des Spiels: setzt die Bausteine zusammen, verteilt das HudModel und
// kümmert sich um Modus, Menü (Esc), Größe der Oberfläche und Tastaturfokus. Die Spieltasten verarbeitet das
// Spiel selbst.

import "./hud.css";
import { BeeBadge } from "./beeBadge";
import { buildEntityCommands, DefaultCommandDistances, type CommandSubject } from "./commandMenu";
import { CompassBadge } from "./compassBadge";
import { createElement, setVisible } from "./dom";
import { FlightControls } from "./flightControls";
import { GhostVeil } from "./ghostVeil";
import { HelpCard } from "./helpCard";
import { HoneycombBar } from "./honeycombBar";
import type { HudContext } from "./hudContext";
import type { ContextMenuEntry, HudActions, HudModel, HudSettings } from "./hudTypes";
import { KeyboardClaims } from "./keyboardClaims";
import { LookAtBadge } from "./lookAtBadge";
import { MarkerLayer } from "./markers";
import { NearbySheet } from "./nearbySheet";
import { NoteLog } from "./noteLog";
import { PanelShield } from "./panelShield";
import { PetalMenu } from "./petalMenu";
import { RibbonBanner } from "./ribbonBanner";
import { SettingsMenu, type QualityChoice } from "./settingsMenu";
import { StartScreen } from "./startScreen";
import { StationMenu } from "./station/stationMenu";
import { TargetBubbles } from "./targetBubbles";
import { Tooltip } from "./tooltip";
import { TopBar } from "./topBar";
import { TouchSticks } from "./touchSticks";
import { applyUiScale, normalizeUiScale } from "./uiScale";
import { WorldSelection } from "./worldSelection";

export type { TouchSticks } from "./touchSticks";

/** Darstellungsart der Oberfläche (HUD-Modus). */
type HudMode = "start" | "flight" | "docked";

/** Ebenen, deren Bedienelemente beim Anklicken nicht den Tastaturfokus übernehmen (Spielebenen). */
const KeepFocusLayers = ".marker-layer, .layer-world, .layer-flight, .layer-common, .layer-station, .layer-overlay";
/** Texteingaben behalten ihr normales Fokusverhalten. */
const TextInputs = "input, select, textarea, [contenteditable]";

/**
 * HTML-Oberfläche über der 3D-Szene (HUD). Das Spiel ruft `update()` jeden Frame mit dem aktuellen
 * HudModel auf; die Oberfläche schreibt nur geänderte Werte ins DOM und meldet Bedienungen über HudActions.
 */
export class Hud {
  /** Virtuelle Sticks für Touch-Geräte. */
  public readonly touch: TouchSticks;
  /**
   * Element, das den Tastaturfokus zurückbekommt, wenn die Oberfläche ihn abgibt (Fokusheimat): nach
   * dem Start, nach dem Schließen des Menüs und nach dem Abdocken. Üblicherweise der Canvas des Spiels.
   */
  public keyboardHome: HTMLElement | undefined;

  private readonly root: HTMLElement;
  private readonly actions: HudActions;
  private readonly keyboard: KeyboardClaims;
  private readonly layers: readonly HTMLElement[];
  private readonly worldLayer: HTMLElement;
  private readonly touchLayer: HTMLElement;
  private readonly flightLayer: HTMLElement;
  private readonly commonLayer: HTMLElement;
  private readonly stationLayer: HTMLElement;
  private readonly startLayer: HTMLElement;
  private readonly menuLayer: HTMLElement;
  private readonly shield: PanelShield;
  private readonly markers: MarkerLayer;
  private readonly selection: WorldSelection;
  private readonly ghost: GhostVeil;
  private readonly badge: BeeBadge;
  private readonly topBar: TopBar;
  private readonly banner: RibbonBanner;
  private readonly notes: NoteLog;
  private readonly nearby: NearbySheet;
  private readonly lookBadge: LookAtBadge;
  private readonly targets: TargetBubbles;
  private readonly honeycomb: HoneycombBar;
  private readonly flight: FlightControls;
  private readonly compass: CompassBadge;
  private readonly help: HelpCard;
  private readonly station: StationMenu;
  private readonly startScreen: StartScreen;
  private readonly menu: SettingsMenu;
  private readonly petalMenu: PetalMenu;
  private readonly tooltip: Tooltip;
  private model: HudModel | undefined;
  private mode: HudMode | undefined;
  private menuOpen = false;
  private menuFocusReturn: Element | null = null;
  private orbitDistance = DefaultCommandDistances.orbit;
  private keepRangeDistance = DefaultCommandDistances.keepRange;

  /**
   * Esc gehört der Oberfläche und schließt das Oberste: Blütenkranz-Menü, dann das Menü, dann ein Fenster der
   * Wabenhalle; ist nichts davon offen, öffnet es das Menü. Ein Esc, das das Spiel schon verbraucht hat
   * (preventDefault, z. B. Wählscheibe schließen), bleibt unbeachtet.
   */
  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== "Escape" || event.defaultPrevented || event.isComposing || event.repeat) {
      return;
    }
    event.preventDefault();
    if (this.petalMenu.wasOpenAt(event.timeStamp)) {
      this.petalMenu.hide();
    } else if (this.menuOpen) {
      this.closeMenu();
    } else if (this.mode === "docked" && this.station.isWindowOpen) {
      this.station.closeWindow();
    } else {
      this.openMenu();
    }
  };

  /** Klicks auf Spiel-Bedienelemente lassen den Fokus beim Spiel, damit Tastenbefehle weiter ankommen. */
  private readonly onMouseDown = (event: MouseEvent): void => {
    const target = event.target;
    if (target instanceof Element && target.closest(KeepFocusLayers) !== null && target.closest(TextInputs) === null) {
      event.preventDefault();
    }
  };

  public constructor(root: HTMLElement, actions: HudActions, settings: HudSettings) {
    this.root = root;
    this.actions = actions;
    this.keyboard = new KeyboardClaims((claimed) => actions.setTyping(claimed));
    root.classList.add("hud");

    const context: HudContext = {
      actions,
      openEntityMenu: (subject, title, x, y) => this.openEntityMenu(subject, title, x, y),
      openChoices: (x, y, entries, title, current) => {
        this.tooltip.hide();
        this.petalMenu.show(x, y, entries, title, current);
      },
    };

    // Reihenfolge im DOM = Stapelreihenfolge: Raum und Auswahl im Raum unten, Bedienfelder darüber, Menüs oben
    this.shield = new PanelShield(root);
    this.markers = new MarkerLayer(root, context);
    this.worldLayer = this.layer("layer-world");
    const ghostLayer = this.layer("layer-ghost");
    this.touchLayer = this.layer("layer-touch");
    this.flightLayer = this.layer("layer-flight");
    this.commonLayer = this.layer("layer-common");
    this.stationLayer = this.layer("layer-station");
    this.startLayer = this.layer("layer-start");
    this.menuLayer = this.layer("layer-menu");
    const overlayLayer = this.layer("layer-overlay");
    this.layers = [this.worldLayer, ghostLayer, this.touchLayer, this.flightLayer, this.commonLayer, this.stationLayer, this.startLayer, this.menuLayer, overlayLayer];

    this.touch = new TouchSticks(this.touchLayer, root);

    // Im Flug: Auswahl am Objekt, Nearby-Karte links, unten Ansehen-Hinweis, Zielblasen und Wabenleiste, Kompass,
    // Tastenhilfe
    this.selection = new WorldSelection(this.worldLayer, context);
    this.nearby = new NearbySheet(this.flightLayer, context);
    const dock = createElement("div", "hud-dock", this.flightLayer);
    this.lookBadge = new LookAtBadge(dock, actions);
    this.targets = new TargetBubbles(dock, context);
    this.honeycomb = new HoneycombBar(dock, actions);
    this.flight = new FlightControls(dock, actions);
    this.compass = new CompassBadge(this.flightLayer);
    this.help = new HelpCard(this.flightLayer);
    this.ghost = new GhostVeil(ghostLayer, this.flightLayer, actions);

    // Nach dem Start immer sichtbar: Bienenplakette, Kopfleiste, Band und Protokoll
    this.badge = new BeeBadge(this.commonLayer, actions);
    this.topBar = new TopBar(this.commonLayer, actions, { toggleMenu: () => this.toggleMenu() });
    this.banner = new RibbonBanner(this.commonLayer);
    this.notes = new NoteLog(this.commonLayer);

    this.station = new StationMenu(this.stationLayer, actions);
    this.startScreen = new StartScreen(this.startLayer, settings, actions, this.keyboard);
    this.menu = new SettingsMenu(this.menuLayer, settings, actions, {
      close: () => this.closeMenu(),
      applyDisplay: (quality, reduceFlashes) => this.applyDisplay(quality, reduceFlashes),
      applyUiScale: (scale) => this.applyScale(scale),
    });
    this.petalMenu = new PetalMenu(root, overlayLayer);
    this.tooltip = new Tooltip(root, overlayLayer);

    // Bedienfelder, unter denen Markierungen ausblenden und denen die Auswahl im Raum ausweicht
    for (const panel of [
      this.badge.element,
      this.topBar.element,
      this.nearby.element,
      this.lookBadge.element,
      this.targets.element,
      this.honeycomb.element,
      this.flight.element,
      this.compass.element,
      this.notes.element,
      this.help.element,
      this.ghost.homeButton,
    ]) {
      this.shield.register(panel);
    }
    this.shield.register(this.banner.element, () => this.banner.isShown);

    this.applyDisplay(settings.quality, settings.reduceFlashes);
    this.applyScale(normalizeUiScale(settings.uiScale));
    setVisible(this.menuLayer, false);
    this.enterMode("start");
    window.addEventListener("keydown", this.onKeyDown);
    root.addEventListener("mousedown", this.onMouseDown);
  }

  /** Jeden Frame aufrufen; schreibt nur geänderte Werte ins DOM. */
  public update(model: HudModel): void {
    this.model = model;
    const mode: HudMode = !model.started ? "start" : model.station !== undefined ? "docked" : "flight";
    // Zuerst lesen, dann schreiben: Die Flächen der Bedienfelder stammen aus dem Layout des letzten Frames
    const now = performance.now();
    if (mode === "flight") {
      this.shield.refresh(now);
    }
    if (mode !== this.mode) {
      this.enterMode(mode);
    }
    if (model.selection !== undefined) {
      this.orbitDistance = model.selection.orbitDistance;
      this.keepRangeDistance = model.selection.keepRangeDistance;
    }
    if (mode === "start") {
      this.startScreen.update(model.connection);
    } else {
      const ghost = model.player?.isGhost === true;
      this.badge.update(model);
      this.topBar.update(model);
      this.banner.update(model.banner, ghost);
      this.notes.update(model.log);
      if (mode === "flight") {
        this.markers.update(model.brackets, this.shield);
        this.selection.update(model.selection, model.brackets, this.shield, now, model.lookAt);
        this.nearby.update(model.overview);
        this.lookBadge.update(model);
        this.targets.update(model.targets);
        this.honeycomb.update(model.modules);
        this.flight.update(model.player);
        this.compass.update(model.player);
        this.help.update(model.showHelp);
        this.ghost.update(ghost);
      } else if (model.station !== undefined) {
        this.station.update(model.station);
      }
    }
    if (this.menuOpen) {
      this.menu.update(model.showHelp);
    }
    this.tooltip.refresh();
  }

  /** Zeigt das Blütenkranz-Menü um Bildschirmkoordinaten (CSS-Pixel), z. B. nach einem Rechtsklick in den Raum. */
  public showContextMenu(x: number, y: number, entries: ReadonlyArray<ContextMenuEntry>, title?: string): void {
    this.tooltip.hide();
    this.petalMenu.show(x, y, entries, title);
  }

  public hideContextMenu(): void {
    this.petalMenu.hide();
  }

  /** Ob das Menü (Esc) offen ist. */
  public get isMenuOpen(): boolean {
    return this.menuOpen;
  }

  /** Öffnet oder schließt das Menü (wie die Taste Esc). */
  public toggleMenu(): void {
    if (this.menuOpen) {
      this.closeMenu();
    } else {
      this.openMenu();
    }
  }

  public openMenu(): void {
    if (this.menuOpen) {
      return;
    }
    this.menuOpen = true;
    this.menuFocusReturn = document.activeElement;
    this.petalMenu.hide();
    this.tooltip.hide();
    setVisible(this.menuLayer, true);
    this.keyboard.set("menu", true);
    this.menu.update(this.model?.showHelp ?? false);
    this.menu.focus();
  }

  public closeMenu(): void {
    if (!this.menuOpen) {
      return;
    }
    this.menuOpen = false;
    setVisible(this.menuLayer, false);
    this.keyboard.set("menu", false);
    this.restoreFocus(this.menuFocusReturn);
    this.menuFocusReturn = null;
  }

  public dispose(): void {
    window.removeEventListener("keydown", this.onKeyDown);
    this.root.removeEventListener("mousedown", this.onMouseDown);
    this.keyboard.releaseAll();
    this.touch.dispose();
    this.tooltip.dispose();
    this.petalMenu.dispose();
    this.menu.dispose();
    this.startScreen.dispose();
    this.station.dispose();
    this.notes.dispose();
    this.banner.dispose();
    this.topBar.dispose();
    this.badge.dispose();
    this.ghost.dispose();
    this.help.dispose();
    this.compass.dispose();
    this.flight.dispose();
    this.honeycomb.dispose();
    this.targets.dispose();
    this.lookBadge.dispose();
    this.nearby.dispose();
    this.selection.dispose();
    this.markers.dispose();
    this.shield.dispose();
    for (const layer of this.layers) {
      layer.remove();
    }
    this.root.classList.remove("hud", "mode-start", "mode-flight", "mode-docked", "hud--low", "hud--calm");
    this.root.style.removeProperty("--ui-scale");
  }

  private layer(name: string): HTMLDivElement {
    return createElement("div", `hud-layer ${name}`, this.root);
  }

  private enterMode(mode: HudMode): void {
    const previous = this.mode;
    this.mode = mode;
    if (previous !== undefined) {
      this.root.classList.remove(`mode-${previous}`);
    }
    this.root.classList.add(`mode-${mode}`);
    this.petalMenu.hide();
    this.tooltip.hide();
    this.shield.invalidate();

    const flight = mode === "flight";
    this.markers.setVisible(flight);
    setVisible(this.worldLayer, flight);
    setVisible(this.touchLayer, flight);
    setVisible(this.flightLayer, flight);
    setVisible(this.commonLayer, mode !== "start");
    setVisible(this.stationLayer, mode === "docked");
    setVisible(this.startLayer, mode === "start");
    if (!flight) {
      this.ghost.update(false);
    }

    if (previous === "start") {
      this.startScreen.release();
      this.returnFocusHome(this.startLayer);
    } else if (previous === "docked") {
      this.station.reset();
      this.returnFocusHome(this.stationLayer);
    }
    if (mode === "start" && previous === undefined && window.matchMedia("(pointer: fine)").matches) {
      // Auf Geräten mit Maus gleich tippen können; auf Touch-Geräten keine Bildschirmtastatur aufdrängen
      this.startScreen.focusName();
    }
  }

  private openEntityMenu(subject: CommandSubject, title: string, x: number, y: number): void {
    const distances = { orbit: this.orbitDistance, keepRange: this.keepRangeDistance };
    const entries = buildEntityCommands(subject, this.model?.selection, distances, this.actions, this.model?.lookAt);
    this.showContextMenu(x, y, entries, title);
  }

  /** Reagiert selbst auf Qualität (schlichtere Schatten bei „Low“) und „Fewer flashes“ (ruhige Warnungen). */
  private applyDisplay(quality: QualityChoice, reduceFlashes: boolean): void {
    this.root.classList.toggle("hud--low", quality === "low");
    this.root.classList.toggle("hud--calm", reduceFlashes);
  }

  /** Größe der Oberfläche als Faktor auf `--u`; Bedienfelder werden danach neu vermessen. */
  private applyScale(scale: number): void {
    applyUiScale(this.root, scale);
    this.petalMenu.hide();
    this.tooltip.hide();
    this.shield.invalidate();
  }

  /** Gibt den Fokus an die Fokusheimat, falls er in einer verschwindenden Ebene lag. */
  private returnFocusHome(layer: HTMLElement): void {
    const active = document.activeElement;
    if (active === null || active === document.body || layer.contains(active)) {
      this.restoreFocus(null);
    }
  }

  private restoreFocus(target: Element | null): void {
    if (target instanceof HTMLElement && target !== document.body && target.isConnected && target.closest("[hidden]") === null) {
      target.focus({ preventScroll: true });
      return;
    }
    if (this.keyboardHome !== undefined) {
      this.keyboardHome.focus({ preventScroll: true });
    } else if (document.activeElement instanceof HTMLElement && this.root.contains(document.activeElement)) {
      document.activeElement.blur();
    }
  }
}
