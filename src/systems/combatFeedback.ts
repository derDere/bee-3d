import type { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { EntityKinds, EventKinds } from "../../shared/events";
import { FlyTaunts, questInfo } from "../../shared/quests";
import { flyInfo } from "../../shared/rules";
import type { EffectsApi, PositionSource } from "../entities/effects/effectTypes";
import type { CombatEvent } from "../net/bindings/types";
import type { AudioApi } from "./audio/audioTypes";
import type { GameLog } from "./gameLog";

/** Lagen und Rückmeldungen, die die Ereignisdarstellung braucht (Ereignisumgebung). */
export interface FeedbackContext {
  readonly effects: EffectsApi;
  readonly audio: AudioApi;
  readonly log: GameLog;
  /** Eigene Spieler-ID. */
  me(): number | undefined;
  beePosition(playerId: number): Vector3 | undefined;
  /** Weltlage eines Bienenauges (0 links, 1 rechts). */
  beeEye(playerId: number, eye: 0 | 1): Vector3 | undefined;
  beeLeg(playerId: number, leg: number): Vector3 | undefined;
  beeStinger(playerId: number): Vector3 | undefined;
  flyPosition(flyId: number): Vector3 | undefined;
  flyKind(flyId: number): number | undefined;
  patchPosition(patchId: number): Vector3 | undefined;
  hiveEntrance(hiveId: number): Vector3 | undefined;
  /** Die eigene Biene wurde getroffen (Kamerawackeln, Rand-Aufblitzen). */
  onOwnHit(damage: number): void;
  /** Der eigene Duftscanner hat gepulst. */
  onOwnScan(): void;
  /** Eine eigene Quest ist erledigt. */
  onQuestDone(title: string, reward: number): void;
  /** Die eigene Biene ist gestorben. */
  onOwnDeath(): void;
}

/**
 * Übersetzt Kampf- und Spielereignisse des Servers in Effekte, Klänge und Protokolleinträge
 * (Ereignisdarstellung). Strahlen und Geschosse folgen ihren Zielen über Positionsquellen.
 */
export class CombatFeedback {
  private readonly context: FeedbackContext;

  public constructor(context: FeedbackContext) {
    this.context = context;
  }

  public handle(event: CombatEvent): void {
    const c = this.context;
    const me = c.me();
    const mine = event.sourceKind === EntityKinds.bee && event.sourceId === me;
    const atMe = event.targetKind === EntityKinds.bee && event.targetId === me;
    switch (event.kind) {
      case EventKinds.laserShot: {
        const eye: 0 | 1 = event.aux === 1 ? 1 : 0;
        const hit = event.value > 0;
        c.effects.laserBeam(() => c.beeEye(event.sourceId, eye), this.flySource(event.targetId), 0.35, hit);
        this.play("laser", c.beePosition(event.sourceId), 0.8);
        if (mine) {
          c.log.add(hit ? `${eye === 0 ? "Left" : "Right"} laser: ${event.value} damage to ${this.flyName(event.targetId)}` : `${eye === 0 ? "Left" : "Right"} laser missed`, "combat");
        }
        break;
      }
      case EventKinds.gatlingBurst: {
        const legs: PositionSource[] = [0, 1, 2, 3, 4, 5].map((leg) => () => c.beeLeg(event.sourceId, leg));
        c.effects.gatlingBurst(legs, this.flySource(event.targetId), 6, event.aux);
        this.play("gatling", c.beePosition(event.sourceId), 0.7);
        if (mine && event.aux > 0) {
          c.log.add(`Pollen gatling: ${event.aux} hits, ${(event.value / 10).toFixed(1)} damage`, "combat");
        }
        break;
      }
      case EventKinds.missileLaunch:
        c.effects.stingerVolley(() => c.beeStinger(event.sourceId), this.flySource(event.targetId), event.aux, event.value / 100);
        this.play("stingerLaunch", c.beePosition(event.sourceId), 0.9);
        if (mine) {
          c.log.add(`${event.aux} stinger missiles on their way to ${this.flyName(event.targetId)}`, "combat");
        }
        break;
      case EventKinds.missileImpact: {
        // Den Einschlag zeigt die Stachelsalve selbst; hier nur Klang und Protokoll
        const at = c.flyPosition(event.targetId);
        this.play("stingerImpact", at, 1);
        if (mine) {
          c.log.add(`Stingers hit: ${(event.value / 10).toFixed(1)} damage`, "combat");
        }
        break;
      }
      case EventKinds.spitLaunch:
        c.effects.spit(this.flySource(event.sourceId), () => c.beePosition(event.targetId), event.aux, event.value / 100);
        this.play("spit", c.flyPosition(event.sourceId), 0.8);
        break;
      case EventKinds.spitImpact: {
        // Den Platscher zeigt der Spuckeballen selbst; hier nur Klang, Kamerawackeln und Protokoll
        const at = c.beePosition(event.targetId);
        const damage = event.value / 10;
        this.play(damage > 0 ? "spitHit" : "spit", at, damage > 0 ? 1 : 0.4);
        if (atMe) {
          if (damage > 0) {
            c.onOwnHit(damage);
            c.log.add(`Splat! Fly spit hit you: −${Math.round(damage)} HP`, "warning");
          } else {
            c.log.add("Dodged the spit!", "combat");
          }
        }
        break;
      }
      case EventKinds.flyKilled: {
        const at = c.flyPosition(event.targetId);
        if (at !== undefined) {
          c.effects.flyDeath(at.clone(), flyInfo(event.aux).length);
        }
        this.play("flyDeath", at, 1);
        if (mine) {
          c.log.add(`${flyInfo(event.aux).title} went splat! +${event.value} honey bounty`, "loot");
        }
        break;
      }
      case EventKinds.beeKilled: {
        const at = c.beePosition(event.targetId);
        if (at !== undefined) {
          c.effects.beeDeath(at.clone());
        }
        this.play("beeDeath", at, 1);
        if (atMe) {
          c.onOwnDeath();
          c.log.add("You are a ghost now. Fly to a hive to be revived.", "warning");
        }
        break;
      }
      case EventKinds.collect: {
        const from = c.patchPosition(event.targetId);
        if (from !== undefined) {
          c.effects.collectStream(from, () => c.beePosition(event.sourceId), 1.2, event.aux === 1);
        }
        this.play("collect", c.beePosition(event.sourceId), 0.6);
        if (mine) {
          c.log.add(event.aux === 1 ? `+${event.value} gold pollen collected` : `+${event.value} pollen collected`, "loot");
        }
        break;
      }
      case EventKinds.aggro:
        if (atMe) {
          const taunt = FlyTaunts[event.aux % FlyTaunts.length] ?? "Bzzz!";
          c.log.add(`${this.flyName(event.sourceId)}: “${taunt}”`, "taunt");
        }
        break;
      case EventKinds.buzz:
        c.effects.buzzRing(() => c.beePosition(event.sourceId));
        this.play("buzz", c.beePosition(event.sourceId), 1);
        break;
      case EventKinds.heal:
        c.effects.heal(() => c.beePosition(event.sourceId));
        this.play("heal", c.beePosition(event.sourceId), 0.7);
        if (mine) {
          c.log.add(`Nectar heal: +${event.value} HP`, "combat");
        }
        break;
      case EventKinds.dock:
      case EventKinds.undock: {
        const at = c.hiveEntrance(event.targetId);
        if (at !== undefined) {
          c.effects.dockFlash(at);
        }
        this.play(event.kind === EventKinds.dock ? "dock" : "undock", at, 0.8);
        break;
      }
      case EventKinds.warp:
        this.play("warpStart", c.beePosition(event.sourceId), 1);
        break;
      case EventKinds.scan: {
        const at = c.beePosition(event.sourceId);
        if (at !== undefined) {
          c.effects.scanPulse(at.clone(), 2000);
        }
        this.play("scan", at, 0.8);
        if (mine) {
          c.onOwnScan();
          c.log.add("Scent scanner: gold flowers within 2 km marked", "system");
        }
        break;
      }
      case EventKinds.questDone:
        if (mine) {
          const title = questInfo(event.aux)?.title ?? "Quest";
          c.onQuestDone(title, event.value);
          c.log.add(`Quest complete: ${title} (+${event.value} honey)`, "quest");
          c.audio.playUi("quest");
        }
        break;
      case EventKinds.revive: {
        const at = c.hiveEntrance(event.targetId);
        if (at !== undefined) {
          c.effects.revive(at);
        }
        this.play("revive", at, 1);
        if (mine) {
          c.log.add("Revived! The comb hall smells of fresh honey.", "system");
        }
        break;
      }
      default:
        break;
    }
  }

  private flySource(flyId: number): PositionSource {
    return () => this.context.flyPosition(flyId);
  }

  private flyName(flyId: number): string {
    const kind = this.context.flyKind(flyId);
    return kind === undefined ? "Fly" : flyInfo(kind).title;
  }

  private play(sound: Parameters<AudioApi["playAt"]>[0], at: Vector3 | undefined, intensity: number): void {
    if (at !== undefined) {
      this.context.audio.playAt(sound, at, intensity);
    }
  }
}
