// Szenarien der Effekt-Werkstatt: je Knopf ein Effekt mit den Darstellern, Schalter für freien Laser,
// Warp und Fahrtwind sowie der Großkampf, der alle Effekte gleichzeitig und dauerhaft auslöst.
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { EffectsSystem } from "../effectsSystem";
import type { ImpactKind } from "../effectTypes";
import type { LabActors, LabBee, LabCreature, LabFly } from "./labActors";
import { LabProps, type LabScene } from "./labScene";

/** Ein auslösbares Szenario mit Beschriftung (Werkstatt-Szenario). */
export interface LabScenario {
  readonly id: string;
  readonly label: string;
  readonly group: string;
  readonly run: () => void;
}

/** Zeitversetzte Aktion der Werkstatt (geplante Aktion). */
interface ScheduledAction {
  time: number;
  readonly action: () => void;
}

/** Raketen- und Spucketempo aus der Spec (m/s): bestimmen die Flugzeit. */
const StingerSpeed = 45;
const SpitSpeed = 30;
const ForwardAxis = new Vector3(0, 0, 1);

/** Kampfplan eines Großkampf-Teilnehmers: Zeitpunkte der nächsten Aktionen (Kampftakt). */
interface BattleClock {
  laserLeft: number;
  laserRight: number;
  gatling: number;
  stingers: number;
  support: number;
  spit: number;
}

/** Szenarien, Schalter und Großkampf der Werkstatt (Werkstatt-Regie). */
export class LabScenarios {
  public readonly scenarios: readonly LabScenario[];
  private readonly effects: EffectsSystem;
  private readonly actors: LabActors;
  private readonly lab: LabScene;
  private readonly schedule: ScheduledAction[] = [];
  private readonly clocks = new Map<LabCreature, BattleClock>();
  private readonly forward = new Vector3();
  private readonly flyDirection = new Vector3();
  private time = 0;
  private freeLaserActive = false;
  private warpTarget = 0;
  private moteSpeed = 0;
  private battle = false;
  private nextDeath = 0;
  private nextQueenDeath = 0;
  private nextGhost = 0;

  public constructor(effects: EffectsSystem, actors: LabActors, lab: LabScene) {
    this.effects = effects;
    this.actors = actors;
    this.lab = lab;
    this.scenarios = this.createScenarios();
  }

  private createScenarios(): LabScenario[] {
    const a = this.actors;
    const [flyA, flyB, , brummer, queen] = a.flies;
    return [
      { id: "laserHit", label: "Laser Treffer", group: "Waffen", run: () => this.lasers(a.bee, flyA, flyB, true) },
      { id: "laserMiss", label: "Laser vorbei", group: "Waffen", run: () => this.lasers(a.bee, flyA, brummer, false) },
      { id: "gatling", label: "Gatling (2 s)", group: "Waffen", run: () => this.repeat(4, 0.5, () => this.gatling(a.bee, flyA, 4)) },
      { id: "stingers", label: "Stachelraketen", group: "Waffen", run: () => this.stingers(a.bee, brummer, 3) },
      { id: "spit", label: "Spucke", group: "Waffen", run: () => this.spit(flyA, a.bee, 1) },
      { id: "spitFan", label: "Spuckfächer", group: "Waffen", run: () => this.spit(queen, a.bee, 5) },
      { id: "impactLaser", label: "Laser", group: "Treffer", run: () => this.impact(flyA, "laser") },
      { id: "impactPollen", label: "Pollen", group: "Treffer", run: () => this.impact(flyA, "pollen") },
      { id: "impactStinger", label: "Stachel", group: "Treffer", run: () => this.impact(flyA, "stinger") },
      { id: "impactSpit", label: "Spucke", group: "Treffer", run: () => this.impact(flyA, "spit") },
      { id: "flyDeath", label: "Schmeißfliege", group: "Tod", run: () => this.killFly(flyA) },
      { id: "brummerDeath", label: "Brummer", group: "Tod", run: () => this.killFly(brummer) },
      { id: "queenDeath", label: "Königin", group: "Tod", run: () => this.killFly(queen) },
      { id: "beeDeath", label: "Bienentod", group: "Tod", run: () => this.effects.beeDeath(a.bee.root.position) },
      { id: "revive", label: "Wiederbelebung", group: "Tod", run: () => this.effects.revive(a.bee.root.position) },
      { id: "collect", label: "Sammelstrom", group: "Spiel", run: () => this.effects.collectStream(LabProps.flowerField, a.bee.center, 3, false) },
      { id: "collectGold", label: "Goldpollen", group: "Spiel", run: () => this.effects.collectStream(LabProps.flowerField, a.bee.center, 3, true) },
      { id: "buzz", label: "Summen", group: "Spiel", run: () => this.effects.buzzRing(a.bee.center) },
      { id: "heal", label: "Heilung", group: "Spiel", run: () => this.effects.heal(a.bee.center) },
      { id: "scan", label: "Duftscanner", group: "Spiel", run: () => this.effects.scanPulse(a.bee.root.position, 2000) },
      { id: "dock", label: "Andockblitz", group: "Spiel", run: () => this.effects.dockFlash(LabProps.hiveEntrance) },
    ];
  }

  /** Löst ein Szenario über seine Kennung aus; false, wenn es sie nicht gibt. */
  public trigger(id: string): boolean {
    const scenario = this.scenarios.find((candidate) => candidate.id === id);
    scenario?.run();
    return scenario !== undefined;
  }

  public get isFreeLaserActive(): boolean {
    return this.freeLaserActive;
  }

  /** Schaltet den freien Laser (Blickrichtung der Kamera) ein oder aus. */
  public toggleFreeLaser(): boolean {
    this.freeLaserActive = !this.freeLaserActive;
    if (this.freeLaserActive) {
      const bee = this.actors.bee;
      this.effects.freeLaser(bee.leftEye, () => this.forward, () => this.freeLaserActive);
    }
    return this.freeLaserActive;
  }

  /** Warp-Intensität 0..1 entlang der Blickrichtung. */
  public setWarp(intensity: number): void {
    this.warpTarget = intensity;
  }

  /** Fahrtwind-Tempo in m/s entlang der Blickrichtung. */
  public setMoteSpeed(speed: number): void {
    this.moteSpeed = speed;
  }

  public get isBattle(): boolean {
    return this.battle;
  }

  /** Schaltet den Großkampf: alle Bienen und Fliegen kämpfen dauerhaft, Effekte aller Art gleichzeitig. */
  public setBattle(enabled: boolean): void {
    this.battle = enabled;
    this.actors.setBattleCast(enabled);
    this.clocks.clear();
    if (enabled) {
      let index = 0;
      for (const bee of this.actors.allBees()) {
        this.clocks.set(bee, this.newClock(index++));
      }
      for (const fly of this.actors.allFlies()) {
        this.clocks.set(fly, this.newClock(index++));
      }
      this.nextDeath = this.time + 1;
      this.nextQueenDeath = this.time + 10;
      this.nextGhost = this.time + 4;
      this.moteSpeed = Math.max(this.moteSpeed, 14);
    }
  }

  public update(dt: number): void {
    this.time += dt;
    this.runSchedule();
    this.lab.camera.getDirectionToRef(ForwardAxis, this.forward);
    this.flyDirection.copyFrom(this.forward);
    this.effects.setWarp(this.warpTarget, this.flyDirection);
    this.effects.setSpeedMotes(this.moteSpeed, this.flyDirection);
    if (this.battle) {
      this.runBattle();
    }
  }

  // ---------- Einzelne Effekte ----------

  private lasers(bee: LabBee, left: LabFly, right: LabFly, hit: boolean): void {
    this.effects.laserBeam(bee.leftEye, left.center, 1.2, hit);
    this.effects.laserBeam(bee.rightEye, right.center, 1.2, hit);
  }

  private gatling(bee: LabBee, target: LabFly, hits: number): void {
    this.effects.gatlingBurst(bee.legs, target.center, 6, hits);
  }

  private stingers(bee: LabBee, target: LabFly, count: number): void {
    const distance = Vector3.Distance(bee.root.position, target.root.position);
    this.effects.stingerVolley(bee.abdomen, target.center, count, Math.max(0.6, distance / StingerSpeed));
  }

  private spit(fly: LabFly, target: LabBee, count: number): void {
    const distance = Vector3.Distance(fly.root.position, target.root.position);
    this.effects.spit(fly.mouth, target.center, count, Math.max(0.3, distance / SpitSpeed));
  }

  private impact(target: LabFly, kind: ImpactKind): void {
    this.effects.impact(target.root.position, kind, 1);
  }

  private killFly(fly: LabFly): void {
    if (fly.isAlive) {
      this.effects.flyDeath(fly.root.position, fly.length);
      fly.kill(3);
    }
  }

  private repeat(count: number, interval: number, action: () => void): void {
    for (let i = 0; i < count; i++) {
      this.schedule.push({ time: this.time + i * interval, action });
    }
  }

  private runSchedule(): void {
    for (let i = this.schedule.length - 1; i >= 0; i--) {
      const entry = this.schedule[i];
      if (entry.time <= this.time) {
        this.schedule.splice(i, 1);
        entry.action();
      }
    }
  }

  // ---------- Großkampf ----------

  private newClock(index: number): BattleClock {
    const offset = (index * 0.37) % 2;
    return {
      laserLeft: this.time + offset,
      laserRight: this.time + offset + 1,
      gatling: this.time + (index * 0.13) % 0.5,
      stingers: this.time + 1 + (index * 1.7) % 8,
      support: this.time + (index * 0.9) % 6,
      spit: this.time + (index * 0.41) % 2.5,
    };
  }

  private runBattle(): void {
    const bees = this.actors.allBees();
    const flies = this.actors.allFlies();
    for (let index = 0; index < bees.length; index++) {
      this.beeTurn(bees[index], index, flies);
    }
    for (const fly of flies) {
      this.flyTurn(fly, bees);
    }
    if (this.time >= this.nextDeath) {
      this.nextDeath = this.time + 1.6;
      const candidates = flies.filter((fly) => fly.isAlive && fly.kind === "blowfly");
      if (candidates.length > 0) {
        this.killFly(candidates[Math.floor(this.time * 7.3) % candidates.length]);
      }
    }
    if (this.time >= this.nextQueenDeath) {
      this.nextQueenDeath = this.time + 12;
      this.killFly(this.actors.flies[4]);
      this.killFly(this.actors.flies[3]);
    }
    if (this.time >= this.nextGhost) {
      this.nextGhost = this.time + 5;
      const wingman = this.actors.wingmen[Math.floor(this.time) % this.actors.wingmen.length];
      this.effects.beeDeath(wingman.root.position);
      const revivePoint = wingman.root.position.clone();
      this.schedule.push({ time: this.time + 2.5, action: () => this.effects.revive(revivePoint) });
    }
  }

  private beeTurn(bee: LabBee, index: number, flies: readonly LabFly[]): void {
    const clock = this.clocks.get(bee);
    const target = this.nearest(bee, flies);
    if (clock === undefined || target === undefined) {
      return;
    }
    const distance = Vector3.Distance(bee.root.position, target.root.position);
    if (this.time >= clock.laserLeft) {
      clock.laserLeft += 2;
      if (distance < 90) {
        this.effects.laserBeam(bee.leftEye, target.center, 1.2, (index + Math.floor(this.time)) % 3 !== 0);
      }
    }
    if (this.time >= clock.laserRight) {
      clock.laserRight += 2;
      const second = flies.find((fly) => fly.isAlive && fly !== target) ?? target;
      if (Vector3.Distance(bee.root.position, second.root.position) < 90) {
        this.effects.laserBeam(bee.rightEye, second.center, 1.2, (index + Math.floor(this.time)) % 4 !== 0);
      }
    }
    if (this.time >= clock.gatling) {
      clock.gatling += 0.5;
      if (distance < 65) {
        this.gatling(bee, target, 3 + (index % 3));
      }
    }
    if (this.time >= clock.stingers) {
      clock.stingers += 8;
      this.stingers(bee, target, 3);
    }
    if (this.time >= clock.support) {
      clock.support += 6;
      switch (index % 3) {
        case 0:
          this.effects.heal(bee.center);
          break;
        case 1:
          this.effects.collectStream(LabProps.flowerField, bee.center, 3, index % 2 === 0);
          break;
        default:
          this.effects.buzzRing(bee.center);
          break;
      }
    }
  }

  private flyTurn(fly: LabFly, bees: readonly LabBee[]): void {
    const clock = this.clocks.get(fly);
    const target = this.nearest(fly, bees);
    if (clock === undefined || target === undefined || this.time < clock.spit) {
      return;
    }
    const period = fly.kind === "queen" ? 4 : fly.kind === "brummer" ? 3.5 : 2.5;
    clock.spit += period;
    if (Vector3.Distance(fly.root.position, target.root.position) < 120) {
      this.spit(fly, target, fly.kind === "queen" ? 5 : 1);
    }
  }

  public dispose(): void {
    this.schedule.length = 0;
    this.clocks.clear();
    this.battle = false;
    this.freeLaserActive = false;
  }

  private nearest<T extends LabCreature>(from: LabCreature, candidates: readonly T[]): T | undefined {
    let best: T | undefined;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const candidate of candidates) {
      if (!candidate.isAlive || candidate === (from as LabCreature)) {
        continue;
      }
      const distance = Vector3.DistanceSquared(from.root.position, candidate.root.position);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = candidate;
      }
    }
    return best;
  }
}
