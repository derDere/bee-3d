// src/hud/beeBadge.ts — oben links: Bienenplakette mit Porträt (Summen), Namensband, Verbindungsstatus,
// Honigglas (Lebenspunkte), Nektartropfen (Energie) und Pollenkörbchen (Ladung).

import { createButton, createElement, HintSlot, NumberSlot, setHint, setVisible, TextSlot } from "./dom";
import { formatInteger } from "./format";
import { HoneyJarGauge, NectarDropGauge, PollenBasketGauge } from "./gauges";
import type { ConnectionStatus, HudActions, HudModel } from "./hudTypes";
import { createIconButton, createKeyBadge } from "./iconButton";
import { createIcon, IconSlot, type IconName } from "./icons";

/** Darstellung eines Verbindungszustands; Ampelfarben wie im 2D-Vorbild (Statusanzeige). */
interface StatusLook {
  readonly tone: string;
  readonly icon: IconName;
  readonly label: string;
}

const StatusLooks: Readonly<Record<ConnectionStatus, StatusLook>> = {
  offline: { tone: "is-bad", icon: "close", label: "Offline – exploring on your own" },
  connecting: { tone: "is-busy", icon: "dots", label: "Connecting…" },
  joining: { tone: "is-busy", icon: "dots", label: "Joining the world…" },
  online: { tone: "is-good", icon: "check", label: "Connected" },
  reconnecting: { tone: "is-busy", icon: "dots", label: "Reconnecting…" },
  "reload-required": { tone: "is-bad", icon: "reload", label: "New version – please reload" },
};

/** Ein Füllstandsbild mit Zahl darunter (Vitalanzeige). */
function createVital(parent: HTMLElement, className: string, label: string, detail: string, gauge: SVGSVGElement): HTMLDivElement {
  const vital = createElement("div", `vital ${className}`, parent);
  setHint(vital, label, detail);
  vital.appendChild(gauge);
  return vital;
}

/** Bienenplakette oben links (Bienenplakette). */
export class BeeBadge {
  /** Wurzelelement (Bedienfeld für den Feldschutz). */
  public readonly element: HTMLDivElement;
  private readonly portrait: HTMLButtonElement;
  private readonly status: HTMLSpanElement;
  private readonly statusIcon: IconSlot;
  private readonly statusHint: HintSlot;
  private readonly statusText: TextSlot;
  private readonly statusLabel: HTMLSpanElement;
  private readonly reload: HTMLButtonElement;
  private readonly name: TextSlot;
  private readonly jar = new HoneyJarGauge();
  private readonly drop = new NectarDropGauge();
  private readonly basket = new PollenBasketGauge();
  private readonly hp: NumberSlot;
  private readonly energy: NumberSlot;
  private readonly cargo: NumberSlot;
  private readonly capacity: NumberSlot;
  private readonly cargoVital: HTMLDivElement;
  private readonly actions: HudActions;
  private connection: ConnectionStatus | undefined;
  private fps = -1;

  private readonly onBuzz = (): void => this.actions.buzz();
  private readonly onReload = (): void => window.location.reload();

  public constructor(parent: HTMLElement, actions: HudActions) {
    this.actions = actions;
    this.element = createElement("div", "bee-badge", parent);

    const portraitBox = createElement("div", "portrait-box", this.element);
    this.portrait = createButton("portrait", portraitBox);
    this.portrait.tabIndex = -1;
    setHint(this.portrait, "Buzz (B)", "Everyone nearby hears you.");
    createElement("span", "portrait-frame", this.portrait).appendChild(createIcon("beeFace", "portrait-face"));
    createKeyBadge("B", this.portrait);
    this.portrait.addEventListener("click", this.onBuzz);
    this.status = createElement("span", "status-pip", portraitBox);
    this.statusIcon = new IconSlot(this.status, "status-icon");
    this.statusHint = new HintSlot(this.status);

    const side = createElement("div", "badge-side", this.element);
    const ribbonRow = createElement("div", "badge-ribbon-row", side);
    const ribbon = createElement("div", "name-ribbon", ribbonRow);
    this.name = new TextSlot(createElement("span", "name-ribbon-text", ribbon));
    this.statusLabel = createElement("span", "status-label", ribbonRow);
    this.statusText = new TextSlot(this.statusLabel);
    this.reload = createIconButton("reload-btn", "reload", "Reload the page", ribbonRow);
    this.reload.hidden = true;
    this.reload.addEventListener("click", this.onReload);

    const vitals = createElement("div", "vitals", side);
    const hpVital = createVital(vitals, "vital-hp", "Health", "Your honey jar. Heal with the nectar power (F7) or in a hive.", this.jar.element);
    this.hp = new NumberSlot(createElement("span", "vital-value", hpVital), formatInteger);
    const energyVital = createVital(vitals, "vital-energy", "Nectar", "Energy for your powers. Refills by itself.", this.drop.element);
    this.energy = new NumberSlot(createElement("span", "vital-value", energyVital), formatInteger);
    this.cargoVital = createVital(vitals, "vital-cargo", "Pollen basket", "Bring your pollen to a hive to make honey.", this.basket.element);
    const cargo = createElement("span", "vital-value", this.cargoVital);
    this.cargo = new NumberSlot(createElement("span", "", cargo), formatInteger);
    createElement("span", "vital-of", cargo, "/");
    this.capacity = new NumberSlot(createElement("span", "", cargo), formatInteger);
  }

  public update(model: HudModel): void {
    this.updateConnection(model.connection, model.fps);
    const player = model.player;
    setVisible(this.element, player !== undefined);
    if (player === undefined) {
      return;
    }
    this.name.set(player.name);
    this.element.classList.toggle("is-ghost", player.isGhost);
    this.jar.set(player.maxHp > 0 ? player.hp / player.maxHp : 0);
    this.hp.set(player.hp);
    this.drop.set(player.maxEnergy > 0 ? player.energy / player.maxEnergy : 0);
    this.energy.set(player.energy);
    const total = player.cargo + player.cargoGold;
    this.basket.set(player.cargoCapacity > 0 ? total / player.cargoCapacity : 0, total > 0 ? player.cargoGold / total : 0);
    this.cargo.set(total);
    this.capacity.set(player.cargoCapacity);
    this.cargoVital.classList.toggle("is-full", player.cargoCapacity > 0 && total >= player.cargoCapacity);
  }

  public dispose(): void {
    this.portrait.removeEventListener("click", this.onBuzz);
    this.reload.removeEventListener("click", this.onReload);
    this.element.remove();
  }

  private updateConnection(connection: ConnectionStatus, fps: number): void {
    const look = StatusLooks[connection];
    const roundedFps = Math.round(fps);
    if (connection !== this.connection) {
      if (this.connection !== undefined) {
        this.status.classList.remove(StatusLooks[this.connection].tone);
      }
      this.connection = connection;
      this.status.classList.add(look.tone);
      this.statusIcon.set(look.icon);
      this.statusText.set(look.label);
      setVisible(this.statusLabel, connection !== "online");
      setVisible(this.reload, connection === "reload-required");
      this.fps = -1;
    }
    if (roundedFps !== this.fps) {
      this.fps = roundedFps;
      this.statusHint.set(look.label, `${roundedFps} fps`);
    }
  }
}
