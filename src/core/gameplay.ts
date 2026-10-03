import type { CascadedShadowGenerator } from "@babylonjs/core/Lights/Shadows/cascadedShadowGenerator";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";
import { NoHive } from "../../shared/events";
import { isNightHours } from "../../shared/dayClock";
import { BeeNames } from "../../shared/quests";
import { flyInfo, upgradeLevelsOf } from "../../shared/rules";
import type { WeatherName } from "../../shared/weather";
import type { WorldLayout } from "../../shared/worldgen";
import type { WorldIndex } from "../../shared/worldIndex";
import { BeeAvatar, BeeModelFile } from "../entities/beeAvatar";
import type { VirtualInput } from "../debug/debugTypes";
import type { EffectsApi } from "../entities/effects/effectTypes";
import { FlyViews } from "../entities/flyViews";
import { PlayerBee } from "../entities/player/playerBee";
import { RemoteBeeViews } from "../entities/remoteBeeViews";
import type { ConnectionStatus, ContextMenuEntry, DayPhaseIcon, HudActions, HudModel, HudSettings, PlayerHud, SkyHud, StationHud } from "../hud/hudTypes";
import type { BeeState } from "../net/bindings/types";
import { BrowserTokenStore, bindPageLifecycle } from "../net/browserSession";
import { resolveSessionOptions } from "../net/netConfig";
import { NetClient, type NetStatus } from "../net/netClient";
import type { SkySystem } from "../rendering/sky/skySystem";
import type { AudioApi } from "../systems/audio/audioTypes";
import type { CameraRig } from "../systems/cameraRig";
import { CombatFeedback } from "../systems/combatFeedback";
import { CommandCenter, dockPointOf } from "../systems/commands/commandCenter";
import { GameLog } from "../systems/gameLog";
import { HudPresenter } from "../systems/hud/hudPresenter";
import { StationPresenter } from "../systems/hud/stationPresenter";
import { InputController, type InputActions, type TouchSource } from "../systems/input/inputController";
import { QDial } from "../systems/input/qDial";
import { ModuleController } from "../systems/modules/moduleController";
import { ScreenProjector } from "../systems/screenProjector";
import { SpaceObjects } from "../systems/targeting/spaceObjects";
import { Targeting } from "../systems/targeting/targeting";
import type { HiveViews } from "../world/hiveViews";
import type { FrameSystem, GameLoop } from "./gameLoop";
import type { ModelLibrary } from "./modelLibrary";
import type { QualityTier } from "./quality";
import type { SettingsStore } from "./settings";

/** Die HTML-Oberfläche aus Sicht des Spiels (Oberfläche). */
export interface HudView {
  /** Erhält den Tastaturfokus zurück, wenn ein Menü der Oberfläche schließt. */
  keyboardHome: HTMLElement | undefined;
  update(model: HudModel): void;
  showContextMenu(x: number, y: number, entries: readonly ContextMenuEntry[], title?: string): void;
  hideContextMenu(): void;
  readonly touch: TouchSource;
  dispose(): void;
}

/** Dienste der Spielwelt, auf denen das Spielgeschehen aufsetzt (Spieldienste). */
export interface GameplayServices {
  readonly scene: Scene;
  readonly canvas: HTMLCanvasElement;
  readonly hudRoot: HTMLElement;
  readonly loop: GameLoop;
  readonly cameraRig: CameraRig;
  readonly layout: WorldLayout;
  readonly world: WorldIndex;
  readonly library: ModelLibrary;
  readonly shadows: CascadedShadowGenerator;
  readonly sky: SkySystem;
  readonly settings: SettingsStore;
  readonly hives: HiveViews;
  readonly effects: EffectsApi;
  readonly audio: AudioApi;
  createHud(actions: HudActions, settings: HudSettings): HudView;
  applyQuality(tier: QualityTier | "auto"): void;
  /** Nachtleuchten 0..1 aus dem Sonnenstand. */
  nightGlow(): number;
  /** Lokale Weltzeit, solange kein Server-Takt vorliegt. */
  localWorldSeconds(): number;
}

const BannerSeconds = 6;
const RejectionTexts: Readonly<Record<string, string>> = {
  "too far": "Too far away.",
  "too close": "Too close to warp.",
  cooldown: "Not ready yet.",
  "out of range": "Target out of range.",
  "not enough honey": "Not enough honey.",
  "no honey": "No honey for healing.",
  "cargo empty": "No cargo to deliver.",
  "max level": "Maximum level reached.",
  "modules offline": "Modules offline.",
  "not enough energy": "Not enough energy.",
  "no pollen": "No pollen left for ammo.",
  "cargo full": "Pollen pants full — back to the hive!",
  "patch empty": "This flower patch is picked clean.",
  "already warping": "Already warping.",
  "too many targets": "Too many enemies at once — Feeler Antennae allow more.",
};
const StatusTexts: Readonly<Record<NetStatus, string>> = {
  offline: "Exploration mode without server.",
  connecting: "Connecting to the bee server …",
  ready: "Bee server reachable.",
  joining: "Entering the sky sphere …",
  online: "Connected — happy buzzing!",
  reconnecting: "Connection lost — keep exploring, reconnecting …",
  "reload-required": "New game version — please reload the page.",
};

/**
 * Spielgeschehen (Spielgeschehen): eigene Biene, Netzanbindung, Objektliste, Zielerfassung, Module, Eingabe,
 * Darstellung fremder Bienen und Fliegen, Ereignisse, Ton und HUD. Läuft auch ohne Server (Erkundungsmodus).
 */
export class Gameplay {
  public readonly player: PlayerBee;
  public readonly objects: SpaceObjects;
  public readonly targeting: Targeting;
  public readonly modules: ModuleController;
  public readonly commands: CommandCenter;
  public readonly log = new GameLog();
  private readonly services: GameplayServices;
  private readonly projector: ScreenProjector;
  private readonly presenter: HudPresenter;
  private readonly station: StationPresenter;
  private readonly feedback: CombatFeedback;
  private readonly remoteBees: RemoteBeeViews;
  private readonly flies: FlyViews;
  private readonly dial: QDial;
  private readonly input: InputController;
  private readonly hud: HudView;
  private readonly net: NetClient;
  /** Aktionen der Oberfläche; auch für die Debug-API. */
  public readonly actions: HudActions;
  private unbindLifecycle: (() => void) | undefined;
  private started = false;
  private playerName = "";
  private showHelp = false;
  private bannerText: string | undefined;
  private bannerUntil = 0;
  private dockedHive: number | undefined;
  private lastDockedHive = 0;
  private wasGhost = false;
  private weatherKey = "";
  private fpsValue = 60;
  private readonly forward = new Vector3();
  private readonly up = new Vector3();
  private readonly thunderTimers = new Set<ReturnType<typeof setTimeout>>();

  private constructor(services: GameplayServices, avatar: BeeAvatar) {
    this.services = services;
    this.player = new PlayerBee(avatar, services.world, {
      requestWarp: (target) => this.requestWarp(target),
      requestDock: () => this.requestDock(),
      notice: (text) => this.log.add(text, "system"),
    });
    for (const mesh of avatar.renderMeshes) {
      services.shadows.addShadowCaster(mesh, false);
    }
    this.spawnLocally();
    const options = resolveSessionOptions(import.meta.env, window.location);
    this.net = new NetClient(options, new BrowserTokenStore(options.uri, options.database), this.player, {
      onStatus: (status) => this.onNetStatus(status),
      onCombatEvent: (event) => this.feedback.handle(event),
      onOwnBee: (row) => this.onOwnBee(row),
      onRejected: (reducer, message) => this.onRejected(reducer, message),
      onTokenRejected: () => this.log.add("Your saved account was invalid — you are flying with a new guest account.", "warning"),
    });
    const replica = this.net.replica;
    this.objects = new SpaceObjects({
      layout: services.layout,
      world: services.world,
      replica,
      origin: () => this.player.position,
      worldSeconds: () => this.worldSeconds(),
    });
    this.targeting = new Targeting(this.objects, () => this.player.position, () => this.player.stats);
    this.targeting.onLocked = (lock) => {
      const object = this.objects.get(lock.key);
      if (object !== undefined) {
        this.log.add(`Locked: ${object.name}`, "combat");
      }
    };
    this.modules = new ModuleController({
      activate: (slot, kind, id) => this.net.activateModule(slot, kind, id),
      deactivate: (slot) => this.net.deactivateModule(slot),
      modules: () => replica.modules,
      stats: () => replica.stats,
      beeStats: () => this.player.stats,
      levels: () => this.player.levels,
      origin: () => this.player.position,
      activeTarget: () => this.targeting.activeTarget,
      selected: () => this.targeting.selected,
      worldSeconds: () => this.worldSeconds(),
      offline: () => this.modulesOfflineReason(),
      notice: (text) => this.log.add(text, "system"),
    });
    this.projector = new ScreenProjector(services.scene, services.cameraRig.camera, services.canvas);
    this.dial = new QDial(services.scene, this.projector, services.hudRoot, () => this.player.position, (point) => this.commands.flyToPoint(point));
    this.input = new InputController(services.canvas, services.cameraRig, this.projector, this.dial, this.inputActions());
    this.actions = this.hudActions();
    this.hud = services.createHud(this.actions, this.hudSettings());
    this.hud.keyboardHome = services.canvas;
    this.commands = new CommandCenter({
      player: this.player,
      objects: this.objects,
      targeting: this.targeting,
      modules: this.modules,
      log: this.log,
      audio: services.audio,
      hives: services.layout.hives,
      homeHive: () => this.homeHive(),
      dockPoint: (hiveId) => this.dockPoint(hiveId),
      online: () => this.net.isOnline,
      startFreeAimBeams: () => this.startFreeAimBeams(),
      showContextMenu: (x, y, entries, title) => this.hud.showContextMenu(x, y, entries, title),
    });
    this.remoteBees = new RemoteBeeViews(services.scene, services.library, replica, services.shadows);
    this.flies = new FlyViews(services.scene, services.library, replica, services.shadows);
    this.station = new StationPresenter(services.layout.hives, replica);
    this.presenter = new HudPresenter({
      objects: this.objects,
      targeting: this.targeting,
      projector: this.projector,
      log: this.log,
      connection: () => hudConnection(this.net.currentStatus),
      started: () => this.started,
      origin: () => this.player.position,
      player: () => this.playerHud(),
      modules: () => this.modules.hud(),
      station: () => this.stationHud(),
      sky: () => this.skyHud(),
      banner: () => this.banner(),
      showHelp: () => this.showHelp,
      fps: () => this.fpsValue,
      orbitDistance: () => this.commands.orbitDistance,
      keepRangeDistance: () => this.commands.keepRangeDistance,
      isDocked: () => this.player.condition.docked,
    });
    this.feedback = new CombatFeedback({
      effects: services.effects,
      audio: services.audio,
      log: this.log,
      me: () => this.net.playerId,
      beePosition: (id) => (id === this.net.playerId ? this.player.renderPosition : this.remoteBees.avatarOf(id)?.root.position),
      beeEye: (id, eye) => this.avatarFor(id)?.eyeWorld(eye, new Vector3()),
      beeLeg: (id, leg) => this.avatarFor(id)?.legWorld(leg, new Vector3()),
      beeStinger: (id) => this.avatarFor(id)?.stingerWorld(new Vector3()),
      flyPosition: (id) => this.flies.positionOf(id),
      flyKind: (id) => replica.flies.rowOf(id)?.kind,
      patchPosition: (id) => {
        const patch = services.layout.patches[id];
        return patch === undefined ? undefined : new Vector3(patch.x, patch.y, patch.z);
      },
      hiveEntrance: (id) => services.hives.anchorsOf(id)?.entrance,
      onOwnHit: (damage) => services.cameraRig.addShake(Math.min(1, damage / 25)),
      onOwnScan: () => this.objects.revealScan(),
      onQuestDone: (title, reward) => this.showBanner(`Quest complete: ${title} — +${reward} honey`),
      onOwnDeath: () => this.targeting.clearLocks(),
    });
    this.input.setTouchSource(this.hud.touch);
    this.input.setInvertY(services.settings.value.invertY);
    services.sky.setThunderListener((position, intensity) => this.scheduleThunder(position, intensity));
    // Die Kamera kennt die Biene von Anfang an; bis zum Start zeigt sie einen freien Kamerapunkt
    services.cameraRig.follow(this.player, (from, to) => this.cameraClearance(from, to));
    // Schon der Startbildschirm zeigt, ob der Bienenserver erreichbar ist; beigetreten wird beim Losfliegen
    this.net.start();
    this.unbindLifecycle = bindPageLifecycle(this.net);
  }

  /** Lädt Bienen- und Fliegenmodelle und baut das Spielgeschehen auf. */
  public static async createAsync(services: GameplayServices): Promise<Gameplay> {
    const [avatar] = await Promise.all([BeeAvatar.createAsync(services.scene, services.library, "playerBee"), services.library.load(BeeModelFile)]);
    const gameplay = new Gameplay(services, avatar);
    await gameplay.flies.preloadAsync();
    return gameplay;
  }

  // ---------- Takt ----------

  /** Frame-System vor der Kamera: Netz, Logik und Darstellung der Figuren. */
  public readonly beforeCamera: FrameSystem = { frameUpdate: (dt, alpha) => this.frameBeforeCamera(dt, alpha) };

  /** Frame-System nach der Kamera: HUD, Ton und Effekte an der Kamera. */
  public readonly afterCamera: FrameSystem = { frameUpdate: (dt) => this.frameAfterCamera(dt) };

  public fixedUpdate(dt: number): void {
    this.input.fixedUpdate();
    this.player.fixedUpdate(dt);
    this.collideWithHives();
  }

  /** Weltzeit: Server-Takt, sobald er bekannt ist, sonst die lokale Uhr. */
  public worldSeconds(): number {
    const clock = this.net.clock;
    return clock.isSynchronised ? clock.worldSecondsAt(performance.now()) : this.services.localWorldSeconds();
  }

  public get netState(): Readonly<Record<string, unknown>> {
    return { ...this.net.state() };
  }

  public dropConnection(): void {
    this.net.dropConnection();
  }

  /** Startet das Spiel mit Namen (Startbildschirm, auch Debug-API). */
  public start(name: string): void {
    if (this.started) {
      return;
    }
    const clean = name.trim().slice(0, 24) || randomBeeName();
    this.playerName = clean;
    this.started = true;
    this.services.settings.update({ playerName: clean });
    void this.services.audio.unlockAsync();
    this.services.cameraRig.resumeOrbit();
    this.frameBeeFromFront();
    this.net.join(clean);
    this.showBanner(`Welcome, ${clean}! Double-click into the sky to fly, hold Q/W/E and click to give orders.`);
  }

  /** Aktuelles HUD-Modell (Debug-API). */
  public hudModel(): HudModel {
    return this.presenter.build();
  }

  /** Virtuelle Eingabe der Debug-API für die nächsten Logikschritte. */
  public setVirtualInput(input: VirtualInput | undefined): void {
    this.input.setVirtualInput(input);
  }

  public setWeather(name: string): void {
    this.net.setWeather(name);
  }

  public snapshot(): Readonly<Record<string, unknown>> {
    const p = this.player.position;
    const condition = this.player.condition;
    return {
      started: this.started,
      player: {
        name: this.playerName,
        x: Math.round(p.x * 10) / 10,
        y: Math.round(p.y * 10) / 10,
        z: Math.round(p.z * 10) / 10,
        speed: Math.round(this.player.speed * 10) / 10,
        command: this.player.controller.command,
        commandLabel: this.player.controller.commandLabel,
        hp: condition.hp,
        ghost: condition.ghost,
        docked: condition.docked,
        lengthMeters: 0.2,
      },
      targets: { selected: this.targeting.selected?.key, locks: this.targeting.locks.map((lock) => lock.key), active: this.targeting.activeTarget?.key },
      objects: [...this.objects.all()].length,
      net: this.netState,
    };
  }

  public dispose(): void {
    for (const timer of this.thunderTimers) {
      clearTimeout(timer);
    }
    this.thunderTimers.clear();
    this.services.sky.setThunderListener(undefined);
    this.unbindLifecycle?.();
    this.net.dispose();
    this.input.dispose();
    this.dial.dispose();
    this.hud.dispose();
    this.remoteBees.dispose();
    this.flies.dispose();
    this.player.dispose();
  }

  // ---------- Frame ----------

  private frameBeforeCamera(dt: number, alpha: number): void {
    this.fpsValue += (1 / Math.max(dt, 1e-3) - this.fpsValue) * Math.min(1, dt * 2);
    this.net.frameUpdate(dt, alpha);
    const stats = this.net.replica.stats;
    if (stats !== undefined) {
      this.player.setUpgrades(upgradeLevelsOf(stats));
    }
    this.syncWeather();
    const night = isNightHours(this.services.sky.clock.hours);
    this.player.setNight(night);
    this.remoteBees.setNight(night);
    this.flies.setNightGlow(this.services.nightGlow());
    this.objects.frameUpdate();
    this.targeting.frameUpdate(dt);
    this.modules.frameUpdate();
    this.commands.update();
    this.player.frameUpdate(dt, alpha);
    this.remoteBees.frameUpdate(dt);
    this.flies.frameUpdate(dt);
    this.updateDocking(stats?.dockedHive);
  }

  private frameAfterCamera(_dt: number): void {
    const rig = this.services.cameraRig;
    const camera = rig.camera;
    const controller = this.player.controller;
    camera.getDirectionToRef(Vector3.Forward(), this.forward);
    camera.getDirectionToRef(Vector3.Up(), this.up);
    const audio = this.services.audio;
    audio.setListener(camera.globalPosition, this.forward, this.up);
    audio.setWingBuzz(this.player.condition.docked ? 0 : Math.min(1, controller.speed / Math.max(1, controller.maxSpeed)), this.player.condition.ghost);
    audio.setNearestFly(this.nearestFlyDistance());
    const weather = this.services.sky.weather.blended;
    audio.setEnvironment(Math.min(1, weather.wind / 10 + controller.boundaryPressure * 0.6), weather.rain, this.services.sky.cameraCloudDensity);
    audio.setNightFactor(this.services.nightGlow());
    const warping = controller.isWarping;
    // Warp-Schlieren und Fahrtwind gehören zur Spielkamera hinter der Biene, nicht zu freien Kamerapunkten
    const following = rig.mode === "orbit";
    this.services.effects.setWarp(warping && following ? 1 : 0, controller.heading);
    this.services.effects.setSpeedMotes(this.player.condition.docked || !following ? 0 : controller.speed, controller.heading);
    rig.setFovKick(warping ? 1 : Math.min(0.35, controller.speed / 120));
    if (controller.boundaryPressure > 0.3) {
      rig.addShake(controller.boundaryPressure * 0.04);
    }
    this.hud.update(this.presenter.build());
  }

  // ---------- Netz ----------

  private onNetStatus(status: NetStatus): void {
    const warning = status === "offline" || status === "reconnecting" || status === "reload-required";
    this.log.add(StatusTexts[status], warning ? "warning" : "system");
    if (status === "reconnecting") {
      this.targeting.clearLocks();
    }
  }

  private onOwnBee(row: BeeState): void {
    this.player.applyServerRow(row);
    const ghost = this.player.condition.ghost;
    if (ghost && !this.wasGhost) {
      this.showBanner("You are a ghost — fly to a hive (Return home) to be revived.");
    }
    this.wasGhost = ghost;
  }

  private onRejected(reducer: string, message: string): void {
    const text = RejectionTexts[message] ?? message;
    this.log.add(`${text}`, "warning");
    this.services.audio.playUi("error");
    if (reducer === "dock") {
      this.player.controller.stop();
    }
  }

  private requestWarp(target: Vector3): void {
    const controller = this.player.controller;
    if (!this.net.isOnline) {
      controller.warpGranted(); // Erkundungsmodus: der Client fliegt allein
      return;
    }
    this.targeting.clearLocks();
    this.net
      .beginWarp(target.x, target.y, target.z)
      .then(() => controller.warpGranted())
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        controller.warpRejected(RejectionTexts[message] ?? message);
      });
  }

  private requestDock(): void {
    const hiveId = this.commands.pendingDockHive;
    if (hiveId !== undefined) {
      this.net.dock(hiveId);
    }
  }

  private syncWeather(): void {
    const row = this.net.replica.weather;
    const key = row === undefined ? "" : `${row.weather}@${row.sinceWorldSeconds}`;
    if (key === this.weatherKey) {
      return;
    }
    this.weatherKey = key;
    this.services.sky.setServerWeather(row === undefined ? undefined : { weather: row.weather as WeatherName, sinceWorldSeconds: row.sinceWorldSeconds });
  }

  // ---------- Station ----------

  private updateDocking(statsHive: number | undefined): void {
    const docked = this.player.condition.docked;
    const hiveId = docked && statsHive !== undefined && statsHive !== NoHive ? statsHive : undefined;
    if (hiveId === this.dockedHive) {
      return;
    }
    this.dockedHive = hiveId;
    this.services.hives.setDocked(hiveId);
    const rig = this.services.cameraRig;
    if (hiveId === undefined) {
      this.hud.hideContextMenu();
      if (this.started) {
        rig.resumeOrbit();
        this.faceAwayFromHive(this.lastDockedHive);
        this.frameBeeFromFront();
      }
      return;
    }
    // Angedockt: der Andockbefehl ist erledigt, nach dem Abdocken schwebt die Biene vor dem Flugloch
    this.lastDockedHive = hiveId;
    this.player.controller.stop();
    this.commands.finishDocking();
    this.targeting.clearLocks();
    const anchors = this.services.hives.anchorsOf(hiveId);
    if (anchors !== undefined) {
      rig.setHangar(anchors.hangarCamera, anchors.hangar);
    }
    this.services.audio.playUi("confirm");
  }

  private stationHud(): StationHud | undefined {
    const hiveId = this.dockedHive;
    if (hiveId === undefined) {
      return undefined;
    }
    const condition = this.player.condition;
    return this.station.build(hiveId, this.player.levels, condition.hp, condition.maxHp);
  }

  // ---------- Anzeige ----------

  private playerHud(): PlayerHud | undefined {
    if (!this.started) {
      return undefined;
    }
    const controller = this.player.controller;
    const stats = this.net.replica.stats;
    const condition = this.player.condition;
    const heading = controller.heading;
    const beeStats = this.player.stats;
    const energy = stats === undefined ? beeStats.maxEnergy : Math.min(beeStats.maxEnergy, stats.energy + Math.max(0, this.worldSeconds() - stats.energyAt) * beeStats.energyRegen);
    const position = this.player.position;
    return {
      name: this.playerName,
      hp: condition.hp,
      maxHp: condition.maxHp,
      energy,
      maxEnergy: beeStats.maxEnergy,
      speed: controller.speed,
      maxSpeed: controller.maxSpeed,
      throttle: controller.throttle,
      cargo: stats?.cargo ?? 0,
      cargoGold: stats?.cargoGold ?? 0,
      cargoCapacity: beeStats.cargoCapacity,
      honey: stats?.honey ?? 0,
      isGhost: condition.ghost,
      isDocked: condition.docked,
      isWarping: controller.isWarping,
      position: { x: position.x, y: position.y, z: position.z },
      headingDeg: ((Math.atan2(heading.x, heading.z) * 180) / Math.PI + 360) % 360,
      commandLabel: controller.commandLabel,
    };
  }

  private skyHud(): SkyHud {
    const hours = this.services.sky.clock.hours;
    const h = Math.floor(hours);
    const m = Math.floor((hours - h) * 60);
    const state = this.services.sky.weather.state;
    const weather = state.blend >= 0.5 ? state.to : state.from;
    const phase = dayPhase(hours);
    return {
      clock: `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`,
      phase,
      phaseLabel: PhaseLabels[phase],
      weather,
      weatherLabel: WeatherLabels[weather],
      isNight: isNightHours(hours),
    };
  }

  private banner(): string | undefined {
    if (this.player.condition.ghost && !this.player.condition.docked) {
      return "You are a ghost — fly to a hive to be revived.";
    }
    return performance.now() < this.bannerUntil ? this.bannerText : undefined;
  }

  private showBanner(text: string): void {
    this.bannerText = text;
    this.bannerUntil = performance.now() + BannerSeconds * 1000;
  }

  // ---------- Aktionen ----------

  private hudActions(): HudActions {
    return {
      start: (name) => this.start(name),
      select: (ref) => {
        const command = this.input.consumeHeldCommand();
        this.commands.select(ref);
        if (command !== undefined && ref !== undefined) {
          this.commands.command(command, ref);
        }
      },
      lock: (ref) => (this.input.shiftHeld ? this.commands.unlock(ref) : this.commands.lock(ref)),
      unlock: (ref) => this.commands.unlock(ref),
      setActiveTarget: (ref) => this.commands.setActiveTarget(ref),
      command: (command, ref, distance) => this.commands.command(command, ref, distance),
      setOrbitDistance: (distance) => this.commands.setOrbitDistance(distance),
      setKeepRangeDistance: (distance) => this.commands.setKeepRangeDistance(distance),
      toggleModule: (slot) => this.modules.toggle(slot),
      setThrottle: (throttle) => this.commands.setThrottle(throttle),
      undock: () => this.net.undock(),
      deposit: () => {
        this.net.deposit();
        this.services.audio.playUi("deposit");
      },
      repair: () => this.net.repair(),
      buyUpgrade: (kind) => {
        this.net.buyUpgrade(kind);
        this.services.audio.playUi("upgrade");
      },
      setHomeHive: () => {
        this.net.setHomeHive();
        this.log.add("Home hive set.", "system");
      },
      returnHome: () => this.commands.returnHome(),
      buzz: () => this.buzz(),
      setQuality: (tier) => this.services.applyQuality(tier),
      setVolume: (master, music) => {
        this.services.settings.update({ masterVolume: master, musicVolume: music });
        this.services.audio.setVolumes(master, music);
      },
      setInvertY: (invert) => {
        this.services.settings.update({ invertY: invert });
        this.input.setInvertY(invert);
      },
      setReduceFlashes: (reduce) => {
        this.services.settings.update({ reduceFlashes: reduce });
        this.services.sky.setReduceFlashes(reduce);
      },
      toggleHelp: () => {
        this.showHelp = !this.showHelp;
      },
      setTyping: (typing) => this.input.setTyping(typing),
    };
  }

  private inputActions(): InputActions {
    return {
      objectAt: (x, y) => this.presenter.objectAt(x, y)?.ref,
      hasSelection: () => this.targeting.selected !== undefined,
      select: (ref) => this.commands.select(ref),
      lock: (ref) => this.commands.lock(ref),
      unlock: (ref) => this.commands.unlock(ref),
      command: (command, ref) => this.commands.command(command, ref),
      flyDirection: (direction) => this.commands.flyDirection(direction),
      toggleModule: (slot) => this.modules.toggle(slot),
      changeThrottle: (delta) => this.commands.changeThrottle(delta),
      throttle: () => this.player.controller.throttle,
      steer: (yaw, pitch) => this.commands.steer(yaw, pitch),
      buzz: () => this.buzz(),
      cycleTarget: () => this.commands.cycleTarget(),
      toggleHelp: () => {
        this.showHelp = !this.showHelp;
      },
      contextMenu: (x, y, ref, direction) => this.commands.contextMenu(x, y, ref, direction),
      freeAim: (active, direction) => this.commands.freeAim(active, direction),
    };
  }

  private hudSettings(): HudSettings {
    const settings = this.services.settings.value;
    return {
      quality: settings.quality,
      masterVolume: settings.masterVolume,
      musicVolume: settings.musicVolume,
      invertY: settings.invertY,
      reduceFlashes: settings.reduceFlashes,
      suggestedName: settings.playerName || randomBeeName(),
    };
  }

  /** Kamera dreiviertel von vorn auf die Biene: Gesicht im Bild, Stock bzw. Flugrichtung dahinter. */
  private frameBeeFromFront(): void {
    const heading = this.player.controller.heading;
    this.services.cameraRig.setOrbit(1.1, 0.12, Math.atan2(heading.x, heading.z) + 0.65);
  }

  /** Nach dem Abdocken zeigt die Biene vom Flugloch weg in den Raum. */
  private faceAwayFromHive(hiveId: number): void {
    const hive = this.services.layout.hives[hiveId];
    if (hive !== undefined) {
      this.player.controller.heading.set(hive.sin, 0, hive.cos).normalize();
    }
  }

  /** Laserstrahlen aus beiden Augen in die Zielrichtung, solange frei gezielt wird. */
  private startFreeAimBeams(): void {
    for (const eye of [0, 1] as const) {
      this.services.effects.freeLaser(
        () => this.player.avatar.eyeWorld(eye, new Vector3()),
        () => this.player.aimDirection,
        () => this.commands.isFreeAiming,
      );
    }
  }

  /** Donner folgt dem Blitz mit Schallgeschwindigkeit (343 m/s), höchstens 12 s später. */
  private scheduleThunder(position: Vector3, intensity: number): void {
    const distance = Vector3.Distance(position, this.services.cameraRig.camera.globalPosition);
    const delayMs = Math.min(12_000, (distance / 343) * 1000);
    const timer = setTimeout(() => {
      this.thunderTimers.delete(timer);
      this.services.audio.playAt("thunder", position, intensity);
    }, delayMs);
    this.thunderTimers.add(timer);
  }

  private buzz(): void {
    if (this.net.isOnline) {
      this.net.buzz();
      return;
    }
    // Erkundungsmodus: nur lokal summen
    this.services.effects.buzzRing(() => this.player.renderPosition);
    this.services.audio.playAt("buzz", this.player.renderPosition, 1);
  }

  // ---------- Hilfen ----------

  private avatarFor(playerId: number): BeeAvatar | undefined {
    return playerId === this.net.playerId ? this.player.avatar : this.remoteBees.avatarOf(playerId);
  }

  private homeHive(): number {
    const me = this.net.playerId;
    return (me === undefined ? undefined : this.net.replica.profiles.get(me)?.homeHive) ?? 0;
  }

  private dockPoint(hiveId: number): Vector3 {
    const hive = this.services.layout.hives[hiveId] ?? this.services.layout.hives[0];
    if (hive === undefined) {
      return Vector3.Zero();
    }
    return dockPointOf(hive);
  }

  /** Setzt die Biene vor den Heimatstock, bis der Server ihre Lage meldet. */
  private spawnLocally(): void {
    const point = this.dockPoint(0);
    this.player.correctTo(point.x, point.y, point.z);
    const hive = this.services.layout.hives[0];
    if (hive !== undefined) {
      // Blick vom Stock weg in den Raum
      this.player.controller.heading.set(hive.sin, 0, hive.cos).normalize();
    }
    this.player.setOfflineCondition();
  }

  private modulesOfflineReason(): string | undefined {
    const condition = this.player.condition;
    if (!this.net.isOnline) {
      return "Modules need a connection to the bee server.";
    }
    if (condition.docked) {
      return "Modules are switched off inside the hive.";
    }
    if (condition.ghost) {
      return "Ghosts can't fight.";
    }
    if (this.player.controller.isWarping) {
      return "Modules are offline during warp.";
    }
    return undefined;
  }

  /** Bienenstöcke sind fest: einfache Ellipsoid-Kollision um den Strohkorb. */
  private collideWithHives(): void {
    if (this.player.condition.docked || this.player.controller.isWarping) {
      return;
    }
    const position = this.player.controller.position;
    for (const hive of this.services.layout.hives) {
      const dx = (position.x - hive.x) / 7.6;
      const dy = (position.y - (hive.y - 2.2)) / 9.8;
      const dz = (position.z - hive.z) / 7.6;
      const r = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (r < 1 && r > 1e-4) {
        const push = 1 / r;
        position.set(hive.x + dx * push * 7.6, hive.y - 2.2 + dy * push * 9.8, hive.z + dz * push * 7.6);
      }
    }
  }

  /** Kamera nicht in Bienenstöcke schieben (Inseln prüft die Kollisionsfunktion der Welt). */
  private cameraClearance(from: Vector3, to: Vector3): number {
    const distance = Vector3.Distance(from, to);
    const steps = 8;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const x = from.x + (to.x - from.x) * t;
      const y = from.y + (to.y - from.y) * t;
      const z = from.z + (to.z - from.z) * t;
      if (this.services.world.penetration(x, y, z, 0.1) !== undefined) {
        return Math.max(0.3, distance * ((i - 1) / steps));
      }
    }
    return distance;
  }

  private nearestFlyDistance(): number {
    let best = Number.POSITIVE_INFINITY;
    const replica = this.net.replica;
    const camera = this.services.cameraRig.camera.globalPosition;
    replica.flies.forEach((_id, pose, row) => {
      const distance = Math.hypot(pose.x - camera.x, pose.y - camera.y, pose.z - camera.z) / Math.max(0.5, flyInfo(row.kind).length / 0.45);
      best = Math.min(best, distance);
    });
    return best;
  }
}

/** Netzstatus für die Anzeige: „bereit“ heißt für den Spieler schon „verbunden“. */
function hudConnection(status: NetStatus): ConnectionStatus {
  return status === "ready" ? "online" : status;
}

function randomBeeName(): string {
  return BeeNames[Math.floor(Math.random() * BeeNames.length)] ?? "Bee";
}

const PhaseLabels: Readonly<Record<DayPhaseIcon, string>> = {
  night: "Night",
  dawn: "Dawn",
  morning: "Morning",
  noon: "Noon",
  afternoon: "Afternoon",
  evening: "Evening",
};

const WeatherLabels: Readonly<Record<WeatherName, string>> = {
  clear: "Clear",
  fair: "Fair",
  "misty-morning": "Misty morning",
  overcast: "Overcast",
  shower: "Showers",
  storm: "Thunderstorm",
};

/** Tagesabschnitt zu den Sonnenstunden (Tagesphase). */
function dayPhase(hours: number): DayPhaseIcon {
  if (hours < 4.2 || hours >= 20.3) {
    return "night";
  }
  if (hours < 5.75) {
    return "dawn";
  }
  if (hours < 9.3) {
    return "morning";
  }
  if (hours < 14.7) {
    return "noon";
  }
  if (hours < 18.25) {
    return "afternoon";
  }
  return "evening";
}
