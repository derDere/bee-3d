import type { Camera } from "@babylonjs/core/Cameras/camera";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";
import { Random } from "../../../shared/random";
import { WorldRadius } from "../../../shared/world";
import type { CloudDensityField, CloudSample } from "./cloudDensityField";
import { LightningBolt } from "./lightningBolt";
import { smoothstep } from "./skyMath";

/** Empfänger des Donners: Ort und Stärke (0..1) jedes Blitzes; das Spiel spielt ihn verzögert nach Entfernung ab. */
export type ThunderListener = (position: Vector3, intensity: number) => void;

/** Ausgang der Blitzregie (Blitzziel): Leuchten in den Wolken und Belichtungsstoß. */
export interface LightningTarget {
  setLightning(x: number, y: number, z: number, intensity: number, flashEv: number): void;
}

/** Ein Puls eines Blitzes (Teilentladung): Startzeit und Spitzenwert. */
interface FlashPulse {
  readonly time: number;
  readonly peak: number;
}

/** Ein laufender Blitz (Blitzereignis). */
interface Strike {
  /** Leuchtzentrum in der Wolke. */
  readonly glow: Vector3;
  readonly distance: number;
  readonly energy: number;
  readonly pulses: readonly FlashPulse[];
  readonly attack: number;
  readonly decay: number;
  readonly duration: number;
  readonly hasChannel: boolean;
  /** Zahl der sichtbaren Kanäle (1 bis `MaxChannels`). */
  readonly channels: number;
  age: number;
}

/** Ort eines Blitzes: Leuchtpunkt in der Wolke und, falls vorhanden, die Wolkenbasis darunter (Einschlagstelle). */
interface StrikeSite {
  readonly glow: Vector3;
  readonly base: Vector3 | undefined;
}

/** Entfernungen der Einschlagpunkte um die Kamera (m). */
const MinDistance = 300;
const MaxDistance = 4000;
/** Versuche der Suche nach einer Gewitterwolke je Blitz. */
const SearchAttempts = 28;
/** Gewitterwolken, unter denen ein ausgelöster Blitz die sichtbarste wählt. */
const ForcedCandidates = 5;
/** Ausgelöste Blitze suchen ihre Wolke im Blickfeld: halber Öffnungswinkel um die Blickrichtung (rad). */
const ForcedViewSpread = 0.55;
/** Mindestwerte für eine Gewitterwolke: Regenzellen-Anteil und Dichte. */
const StormCellThreshold = 0.25;
const StormDensityThreshold = 0.15;
/** Höchstens ein Blitz je Intervall (Barrierefreiheit: WCAG 2.3.1 erlaubt bis drei Blitze je Sekunde). */
const MinIntervalSeconds = 1.2;
const ReducedMinIntervalSeconds = 3;
/** Anteil der Blitze mit sichtbarem Kanal unter der Wolke; die übrigen leuchten nur in der Wolke. */
const ChannelChance = 0.45;
/** Sichtbarkeit des Kanals: Dauer und Ausblendung (s). */
const ChannelSeconds = 0.15;
const ChannelFadeSeconds = 0.05;
/** Suche der Wolkenbasis unter dem Leuchtpunkt (m) und Dichte, ab der die Luft klar ist. */
const BaseSearchStep = 25;
const BaseSearchDepth = 1400;
const ClearAirDensity = 0.03;
/** Form des Kanals: Fallhöhe und seitliche Drift (m). */
const ChannelDropMin = 500;
const ChannelDropMax = 1300;
const ChannelDrift = 260;
/** Stichproben der Sichtbarkeit von der Kamera zum Kanal. */
const VisibilitySteps = 14;
/** Helligkeiten: Leuchten in der Wolke, Belichtungsstoß (EV), Kanal (HDR). */
const GlowIntensity = 14;
const FlashEvPeak = 1.0;
const ChannelBrightness = 30;
/** Nachglühen der Wolke nach den Pulsen. */
const AfterglowLevel = 0.12;
const AfterglowSeconds = 0.35;
/** Pulsform: Anstieg und Abklingen (s); mit „Blitze reduzieren“ ein einzelner, weicher Puls. */
const PulseAttack = 0.012;
const PulseDecay = 0.07;
const ReducedPulseAttack = 0.06;
const ReducedPulseDecay = 0.25;
/** Dämpfung mit „Blitze reduzieren“. */
const ReducedFlashEvFactor = 0.2;
const ReducedChannelFactor = 0.3;
const ReducedGlowFactor = 0.6;
/** Farbe des Kanals: bläuliches Weiß (#9ECBFF), der Kern wird im HDR weiß. */
const ChannelColor = new Color3(0.62, 0.8, 1.0);
/** Höchstzahl gleichzeitiger Kanäle eines Blitzes und Rate, ab der mehrere Kanäle auftreten (Gewitter). */
const MaxChannels = 3;
const MultiChannelRate = 6;
/** Seitlicher Abstand weiterer Kanäle vom ersten (m). */
const ChannelSpread = 700;

/**
 * Gewitterblitze (Blitzregie): wählt Einschlagpunkte in Gewitterwolken 300 m – 4 km um die Kamera, mit einer Rate
 * aus der Wetterlage. Jeder Blitz besteht aus mehreren schnellen Pulsen: Die Wolke leuchtet von innen
 * (`setLightning` am Ziel), die Szene bekommt einen Belichtungsstoß, unter der Wolke erscheint oft ein
 * verzweigter Kanal. Jeder Blitz geht an den Donner-Empfänger.
 */
export class LightningDirector {
  private readonly camera: Camera;
  private readonly target: LightningTarget;
  private readonly bolts: LightningBolt[];
  private readonly random: Random;
  private field: CloudDensityField | undefined;
  private thunderListener: ThunderListener | undefined;
  private reduceFlashes = false;
  private enabled = true;
  private strike: Strike | undefined;
  private sinceLastStrike = Number.POSITIVE_INFINITY;
  private strikes = 0;
  private flash = 0;
  private ratePerMinute = 0;
  private readonly sample: CloudSample = { density: 0, body: 0, rainCell: 0 };
  private readonly candidate = new Vector3();
  private readonly direction = new Vector3();

  public constructor(scene: Scene, camera: Camera, target: LightningTarget, seed: number) {
    this.camera = camera;
    this.target = target;
    this.bolts = Array.from({ length: MaxChannels }, () => new LightningBolt(scene));
    this.random = new Random(seed);
  }

  /** CPU-Dichtefeld der Wolken für die Suche nach Gewitterwolken und die Sichtbarkeit des Kanals. */
  public setDensityField(field: CloudDensityField | undefined): void {
    this.field = field;
  }

  /** Empfänger des Donners für jeden Blitz; undefined meldet ihn ab. */
  public setThunderListener(listener: ThunderListener | undefined): void {
    this.thunderListener = listener;
  }

  /** „Blitze reduzieren“: dämpft Belichtungsstoß, Kanal und Leuchten; jeder Blitz ist ein einzelner weicher Puls ohne Flackern. */
  public setReduceFlashes(reduce: boolean): void {
    this.reduceFlashes = reduce;
  }

  /** Effektschalter der Debug-API. */
  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.endStrike();
    }
  }

  /** Luftperspektive des Kanals wie bei den Wolken. */
  public setHaze(distance: number, strength: number): void {
    for (const bolt of this.bolts) {
      bolt.setHaze(distance, strength);
    }
  }

  /** Ob gerade ein Blitz läuft. */
  public get isActive(): boolean {
    return this.strike !== undefined;
  }

  /** Zahl der Blitze seit dem Start. */
  public get strikeCount(): number {
    return this.strikes;
  }

  /** Helligkeit des laufenden Blitzes 0..1 (für Regen und Ton). */
  public get flashLevel(): number {
    return this.flash;
  }

  /** Löst sofort einen Blitz mit Kanal aus (Prüfungen): unter der sichtbarsten Gewitterwolke im Blickfeld, sonst vor der Kamera. */
  public trigger(): void {
    if (!this.enabled) {
      return;
    }
    this.startStrike(true);
  }

  /** Rückt die Blitze um `dt` Sekunden vor (0 = Pause hält den Blitz an). */
  public update(dt: number, strikesPerMinute: number): void {
    if (!this.enabled) {
      return;
    }
    this.ratePerMinute = strikesPerMinute;
    this.sinceLastStrike += dt;
    if (this.strike !== undefined) {
      this.advanceStrike(dt);
      return;
    }
    const interval = this.reduceFlashes ? ReducedMinIntervalSeconds : MinIntervalSeconds;
    if (strikesPerMinute <= 0 || dt <= 0 || this.sinceLastStrike < interval) {
      return;
    }
    const probability = 1 - Math.exp(-(strikesPerMinute / 60) * dt);
    if (this.random.chance(probability)) {
      this.startStrike(false);
    }
  }

  private startStrike(force: boolean): void {
    const site = this.findSite(force);
    if (site === undefined) {
      return;
    }
    const camera = this.camera.globalPosition;
    const reduce = this.reduceFlashes;
    const hasChannel = site.base !== undefined && (force || this.random.chance(ChannelChance));
    const pulses = this.createPulses(reduce);
    const attack = reduce ? ReducedPulseAttack : PulseAttack;
    const decay = reduce ? ReducedPulseDecay : PulseDecay;
    const lastPulse = pulses[pulses.length - 1]?.time ?? 0;
    const energy = this.random.range(0.55, 1);
    let thunderPosition = site.glow;
    let channels = 0;
    if (hasChannel && site.base !== undefined) {
      thunderPosition = this.buildChannel(this.bolts[0], site.base);
      channels = 1 + this.buildExtraChannels(site.glow);
    }
    this.strike = {
      glow: site.glow,
      distance: Vector3.Distance(camera, site.glow),
      energy,
      pulses,
      attack,
      decay,
      duration: Math.max(lastPulse + attack + decay * 5, AfterglowSeconds * 3, hasChannel ? ChannelSeconds + ChannelFadeSeconds : 0),
      hasChannel,
      channels,
      age: 0,
    };
    this.strikes++;
    this.sinceLastStrike = 0;
    this.thunderListener?.(thunderPosition.clone(), energy * (hasChannel ? 1 : 0.75));
    this.advanceStrike(0);
  }

  /** Mehrere schnelle Pulse (Hauptentladung und Nachentladungen); reduziert ein einzelner Puls. */
  private createPulses(reduce: boolean): FlashPulse[] {
    const pulses: FlashPulse[] = [{ time: 0, peak: 1 }];
    if (reduce) {
      return pulses;
    }
    const count = 2 + this.random.int(3);
    let time = 0;
    for (let i = 1; i < count; i++) {
      time += this.random.range(0.045, 0.13);
      pulses.push({ time, peak: this.random.range(0.45, 0.9) });
    }
    return pulses;
  }

  private envelope(strike: Strike): number {
    let level = 0;
    for (const pulse of strike.pulses) {
      const t = strike.age - pulse.time;
      if (t < 0) {
        continue;
      }
      level += pulse.peak * (t < strike.attack ? t / strike.attack : Math.exp(-(t - strike.attack) / strike.decay));
    }
    return Math.min(1, level);
  }

  private advanceStrike(dt: number): void {
    const strike = this.strike;
    if (strike === undefined) {
      return;
    }
    strike.age += dt;
    if (strike.age > strike.duration) {
      this.endStrike();
      return;
    }
    const reduce = this.reduceFlashes;
    const level = this.envelope(strike);
    const glow = Math.min(1, level + AfterglowLevel * Math.exp(-strike.age / AfterglowSeconds));
    const proximity = 1 - 0.6 * smoothstep(MinDistance, MaxDistance, strike.distance);
    const glowIntensity = GlowIntensity * strike.energy * glow * (reduce ? ReducedGlowFactor : 1);
    const flashEv = FlashEvPeak * strike.energy * level * proximity * (reduce ? ReducedFlashEvFactor : 1);
    this.target.setLightning(strike.glow.x, strike.glow.y, strike.glow.z, glowIntensity, flashEv);
    this.flash = level * strike.energy * (reduce ? 0.5 : 1);

    let channel = 0;
    if (strike.hasChannel && strike.age < ChannelSeconds + ChannelFadeSeconds) {
      const fade = 1 - smoothstep(ChannelSeconds, ChannelSeconds + ChannelFadeSeconds, strike.age);
      channel = ChannelBrightness * strike.energy * Math.max(level, 0.35) * fade * (reduce ? ReducedChannelFactor : 1);
    }
    const pixelAngle = this.pixelAngle();
    this.bolts.forEach((bolt, index) => bolt.show(ChannelColor, index < strike.channels ? channel * (1 - 0.2 * index) : 0, pixelAngle));
  }

  private endStrike(): void {
    if (this.strike === undefined) {
      return;
    }
    this.strike = undefined;
    this.flash = 0;
    this.target.setLightning(0, 0, 0, 0, 0);
    const pixelAngle = this.pixelAngle();
    for (const bolt of this.bolts) {
      bolt.show(ChannelColor, 0, pixelAngle);
    }
  }

  private pixelAngle(): number {
    const height = this.camera.getScene().getEngine().getRenderHeight();
    return (2 * Math.tan(this.camera.fov / 2)) / Math.max(1, height);
  }

  /**
   * Sucht eine Gewitterwolke in 300 m – 4 km um die Kamera. Ohne Treffer gibt es keinen Blitz. Erzwungene Blitze
   * suchen im Blickfeld und wählen unter mehreren Gewitterwolken die mit der am besten sichtbaren Wolkenbasis, sonst
   * die dichteste gefundene Wolke oder einen Punkt vor der Kamera.
   */
  private findSite(force: boolean): StrikeSite | undefined {
    const camera = this.camera.globalPosition;
    const field = this.field;
    const wanted = force ? ForcedCandidates : 1;
    const candidates: Vector3[] = [];
    let densest: Vector3 | undefined;
    let densestScore = 0;
    const forward = this.camera.getDirection(Vector3.Forward(this.camera.getScene().useRightHandedSystem));
    const viewAzimuth = Math.atan2(forward.z, forward.x);
    if (field?.isReady) {
      for (let attempt = 0; attempt < SearchAttempts && candidates.length < wanted; attempt++) {
        const azimuth = force ? viewAzimuth + this.random.range(-ForcedViewSpread, ForcedViewSpread) : this.random.range(0, 2 * Math.PI);
        const elevation = this.random.range(-0.45, 0.6);
        const distance = this.random.range(MinDistance, MaxDistance);
        this.direction.set(Math.cos(elevation) * Math.cos(azimuth), Math.sin(elevation), Math.cos(elevation) * Math.sin(azimuth));
        camera.addToRef(this.direction.scaleInPlace(distance), this.candidate);
        if (this.candidate.length() > WorldRadius - 400) {
          continue;
        }
        const sample = field.sample(this.candidate.x, this.candidate.y, this.candidate.z, this.sample);
        if (sample.density > StormDensityThreshold && sample.rainCell > StormCellThreshold) {
          candidates.push(this.candidate.clone());
          continue;
        }
        const score = sample.density * (0.2 + sample.rainCell);
        if (score > densestScore) {
          densestScore = score;
          densest = this.candidate.clone();
        }
      }
    }
    if (candidates.length === 0) {
      if (!force) {
        return undefined;
      }
      const glow = densestScore > 0.01 && densest !== undefined ? densest : this.pointAheadOfCamera();
      return { glow, base: this.findCloudBase(glow) ?? glow.clone() };
    }
    let chosen: StrikeSite | undefined;
    let bestVisibility = -1;
    for (const glow of candidates) {
      const base = this.findCloudBase(glow);
      const visibility = base !== undefined && field !== undefined ? field.transmittance(camera, base, VisibilitySteps) : 0;
      if (chosen === undefined || visibility > bestVisibility) {
        chosen = { glow, base: base ?? (force ? glow.clone() : undefined) };
        bestVisibility = visibility;
      }
    }
    return chosen;
  }

  /** Punkt 1,2 km vor der Kamera, etwas über Augenhöhe (erzwungene Blitze ohne Wolke). */
  private pointAheadOfCamera(): Vector3 {
    const forward = this.camera.getDirection(Vector3.Forward(this.camera.getScene().useRightHandedSystem));
    forward.y = 0;
    if (forward.lengthSquared() < 1e-6) {
      forward.set(1, 0, 0);
    }
    forward.normalize();
    return this.camera.globalPosition.add(forward.scaleInPlace(1200)).addInPlaceFromFloats(0, 220, 0);
  }

  /** Wolkenbasis unter einem Punkt: der erste Punkt darunter in klarer Luft. */
  private findCloudBase(point: Vector3): Vector3 | undefined {
    const field = this.field;
    if (field === undefined || !field.isReady) {
      return undefined;
    }
    for (let drop = BaseSearchStep; drop <= BaseSearchDepth; drop += BaseSearchStep) {
      if (field.density(point.x, point.y - drop, point.z) < ClearAirDensity) {
        return new Vector3(point.x, point.y - drop + BaseSearchStep * 0.5, point.z);
      }
    }
    return undefined;
  }

  /** Weitere Kanäle im Gewitter: Basen seitlich versetzt unter derselben Zelle; liefert ihre Zahl. */
  private buildExtraChannels(glow: Vector3): number {
    if (this.ratePerMinute < MultiChannelRate) {
      return 0;
    }
    const wanted = this.random.int(MaxChannels);
    let built = 0;
    for (let attempt = 0; attempt < wanted * 2 && built < wanted; attempt++) {
      const [dx, dz] = this.random.unitXZ();
      const distance = this.random.range(0.4, 1) * ChannelSpread;
      const base = this.findCloudBase(new Vector3(glow.x + dx * distance, glow.y, glow.z + dz * distance));
      const bolt = this.bolts[1 + built];
      if (base !== undefined && bolt !== undefined) {
        this.buildChannel(bolt, base);
        built++;
      }
    }
    return built;
  }

  /** Baut einen Kanal von der Wolkenbasis nach unten; liefert den Ort des Donners (Kanalmitte). */
  private buildChannel(bolt: LightningBolt | undefined, base: Vector3): Vector3 {
    const start = base.add(new Vector3(0, 40, 0));
    const end = base.add(new Vector3(this.random.range(-ChannelDrift, ChannelDrift), -this.random.range(ChannelDropMin, ChannelDropMax), this.random.range(-ChannelDrift, ChannelDrift)));
    // Der Kanal bleibt in der Weltkugel
    const limit = WorldRadius - 150;
    if (end.length() > limit) {
      end.scaleInPlace(limit / end.length());
    }
    const camera = this.camera.globalPosition.clone();
    const field = this.field;
    bolt?.build(start, end, this.random, (point) => (field?.isReady ? field.transmittance(camera, point, VisibilitySteps) : 1));
    return Vector3.Center(start, end);
  }

  public dispose(): void {
    this.endStrike();
    for (const bolt of this.bolts) {
      bolt.dispose();
    }
  }
}
