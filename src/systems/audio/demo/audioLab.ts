// src/systems/audio/demo/audioLab.ts — Entwicklungsseite des Tonsystems: Knöpfe für jeden Klang, Regler für Tempo,
// Wetter, Wolke, Nacht und Fliegenabstand, Pegelmesser hinter dem Limiter und Bericht der Klangbank.
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Random } from "../../../../shared/random";
import { AudioSystem } from "../audioSystem";
import type { UiSound, WorldSound } from "../audioTypes";
import type { SoundBankReport } from "../soundBank";
import { UiSoundCatalog, WorldSoundCatalog } from "../soundCatalog";

/** Messwerte des Ausgangspegels hinter dem Limiter (Pegelanzeige). */
interface MeterReading {
  peak: number;
  rms: number;
  maxPeak: number;
  /** Messfenster mit mindestens einer Abtastung ≥ 0,999. */
  clipWindows: number;
}

/** Prüfschnittstelle der Seite für automatisierte Läufe (Prüfhilfe). */
interface AudioLabApi {
  readonly ready: Promise<void>;
  readonly lab: AudioLab;
}

/** Einstellbare Größen der Seite. */
interface LabState {
  distance: number;
  azimuth: number;
  intensity: number;
  speed: number;
  ghost: boolean;
  flyActive: boolean;
  flyDistance: number;
  wind: number;
  rain: number;
  cloud: number;
  night: number;
  master: number;
  music: number;
}

const WorldSounds = Object.keys(WorldSoundCatalog) as WorldSound[];
const UiSounds = Object.keys(UiSoundCatalog) as UiSound[];
/** Messtakt des Pegelmessers; das Analysefenster (2048 Abtastungen) überlappt die Takte. */
const MeterIntervalMs = 20;

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (found === null) {
    throw new Error(`Element #${id} fehlt.`);
  }
  return found as T;
}

function toDb(value: number): string {
  return value > 1e-6 ? `${(20 * Math.log10(value)).toFixed(1)}` : "−∞";
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/** Entwicklungsseite des Tonsystems (Audio Lab). */
class AudioLab {
  public system: AudioSystem | null = null;
  public readonly meter: MeterReading = { peak: 0, rms: 0, maxPeak: 0, clipWindows: 0 };
  public error: string | null = null;
  private readonly state: LabState = {
    distance: 20,
    azimuth: 30,
    intensity: 1,
    speed: 0.3,
    ghost: false,
    flyActive: false,
    flyDistance: 40,
    wind: 0.25,
    rain: 0,
    cloud: 0,
    night: 0,
    master: 0.8,
    music: 0.5,
  };
  private readonly listener = Vector3.Zero();
  private readonly forward = new Vector3(0, 0, 1);
  private readonly up = Vector3.Up();
  private readonly random = new Random(7);
  private analyser: AnalyserNode | null = null;
  private samples: Float32Array<ArrayBuffer> = new Float32Array(2048);
  private meterTimer: ReturnType<typeof setInterval> | null = null;

  public async startAsync(): Promise<void> {
    this.buildControls();
    const status = element<HTMLSpanElement>("status");
    try {
      const system = await AudioSystem.createAsync();
      this.system = system;
      this.applyAll();
      this.analyser = system.createOutputAnalyser();
      this.samples = new Float32Array(this.analyser.fftSize);
      this.meterTimer = setInterval(() => this.tick(), MeterIntervalMs);
      this.renderBank(system.diagnostics().bank);
      const unlock = element<HTMLButtonElement>("unlock");
      unlock.disabled = false;
      unlock.addEventListener("click", () => void this.unlockAsync());
      status.textContent = `Bereit (${system.diagnostics().contextState}) — „Ton starten“ klicken.`;
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
      status.textContent = `Fehler: ${this.error}`;
      console.error("[audio-lab]", error);
    }
  }

  public async unlockAsync(): Promise<void> {
    await this.system?.unlockAsync();
    const diagnostics = this.system?.diagnostics();
    element<HTMLSpanElement>("status").textContent = `Kontext: ${diagnostics?.contextState ?? "?"}, ${diagnostics?.sampleRate ?? "?"} Hz`;
  }

  /** Raumklang an der eingestellten Richtung und Entfernung. */
  public playWorld(sound: WorldSound): void {
    const radians = (this.state.azimuth * Math.PI) / 180;
    const position = new Vector3(Math.sin(radians) * this.state.distance, 0, Math.cos(radians) * this.state.distance);
    this.system?.playAt(sound, position, this.state.intensity);
  }

  public resetMeter(): void {
    this.meter.maxPeak = 0;
    this.meter.clipWindows = 0;
  }

  /** Großkampf: viele Raumklänge in schneller Folge plus Donner; liefert die Pegelspitzen. */
  public async stressAsync(seconds = 3): Promise<MeterReading> {
    const system = this.system;
    if (system === null) {
      throw new Error("Tonsystem nicht bereit.");
    }
    this.resetMeter();
    const kinds: WorldSound[] = ["gatling", "gatling", "gatling", "laser", "spit", "spitHit", "stingerLaunch", "stingerImpact", "beeHit", "flyDeath"];
    system.playAt("thunder", new Vector3(250, 180, 300), 1);
    const end = performance.now() + seconds * 1000;
    while (performance.now() < end) {
      for (let k = 0; k < 3; k++) {
        const [x, z] = this.random.unitXZ();
        const distance = this.random.range(4, 60);
        system.playAt(this.random.pick(kinds), new Vector3(x * distance, this.random.range(-5, 5), z * distance), 1);
      }
      await wait(40);
    }
    await wait(1500);
    return { ...this.meter };
  }

  /** Beendet Messung und Tonsystem (Prüfung des Aufräumens). */
  public dispose(): void {
    if (this.meterTimer !== null) {
      clearInterval(this.meterTimer);
      this.meterTimer = null;
    }
    this.analyser?.disconnect();
    this.analyser = null;
    this.system?.dispose();
    this.system = null;
    element<HTMLSpanElement>("status").textContent = "Tonsystem entsorgt.";
  }

  /** Spielt alle Raumklänge nacheinander. */
  public async playAllWorldAsync(gapMs = 900): Promise<void> {
    for (const sound of WorldSounds) {
      this.playWorld(sound);
      await wait(gapMs);
    }
  }

  private tick(): void {
    const system = this.system;
    if (system === null) {
      return;
    }
    system.setListener(this.listener, this.forward, this.up);
    if (this.analyser !== null) {
      this.analyser.getFloatTimeDomainData(this.samples);
      let peak = 0;
      let sum = 0;
      for (const value of this.samples) {
        peak = Math.max(peak, Math.abs(value));
        sum += value * value;
      }
      this.meter.peak = peak;
      this.meter.rms = Math.sqrt(sum / this.samples.length);
      this.meter.maxPeak = Math.max(this.meter.maxPeak, peak);
      if (peak >= 0.999) {
        this.meter.clipWindows++;
      }
      this.renderMeter(system.diagnostics().activeVoices);
    }
  }

  private applyAll(): void {
    const system = this.system;
    if (system === null) {
      return;
    }
    const s = this.state;
    system.setVolumes(s.master, s.music);
    system.setWingBuzz(s.speed, s.ghost);
    system.setNearestFly(s.flyActive ? s.flyDistance : Number.POSITIVE_INFINITY);
    system.setEnvironment(s.wind, s.rain, s.cloud);
    system.setNightFactor(s.night);
  }

  private buildControls(): void {
    const world = element<HTMLDivElement>("world-controls");
    this.addSlider(world, "Abstand", 0, 400, 1, "distance", (v) => `${v} m`);
    this.addSlider(world, "Richtung", -180, 180, 5, "azimuth", (v) => `${v}°`);
    this.addSlider(world, "Intensität", 0, 1, 0.05, "intensity", (v) => v.toFixed(2));
    const worldButtons = element<HTMLDivElement>("world-buttons");
    for (const sound of WorldSounds) {
      this.addButton(worldButtons, sound, () => this.playWorld(sound));
    }
    const uiButtons = element<HTMLDivElement>("ui-buttons");
    for (const sound of UiSounds) {
      this.addButton(uiButtons, sound, () => this.system?.playUi(sound));
    }
    const tests = element<HTMLDivElement>("test-buttons");
    this.addButton(tests, "Großkampf (3 s)", () => void this.stressAsync());
    this.addButton(tests, "Alle Raumklänge", () => void this.playAllWorldAsync());
    this.addButton(tests, "Spitzen zurücksetzen", () => this.resetMeter());
    this.addButton(tests, "Tonsystem entsorgen", () => this.dispose());

    const loops = element<HTMLDivElement>("loop-controls");
    this.addSlider(loops, "Tempo", 0, 1, 0.01, "speed", (v) => v.toFixed(2));
    this.addCheck(loops, "Geist", "ghost");
    this.addCheck(loops, "Fliege in der Nähe", "flyActive");
    this.addSlider(loops, "Abstand Fliege", 0, 200, 1, "flyDistance", (v) => `${v} m`);

    const environment = element<HTMLDivElement>("environment-controls");
    this.addSlider(environment, "Wind", 0, 1, 0.01, "wind", (v) => v.toFixed(2));
    this.addSlider(environment, "Regen", 0, 1, 0.01, "rain", (v) => v.toFixed(2));
    this.addSlider(environment, "Wolke", 0, 1, 0.01, "cloud", (v) => v.toFixed(2));
    this.addSlider(environment, "Nacht", 0, 1, 0.01, "night", (v) => v.toFixed(2));
    this.addSlider(environment, "Master", 0, 1, 0.01, "master", (v) => v.toFixed(2));
    this.addSlider(environment, "Musik", 0, 1, 0.01, "music", (v) => v.toFixed(2));
  }

  private addButton(parent: HTMLElement, label: string, onClick: () => void): void {
    const button = document.createElement("button");
    button.textContent = label;
    button.dataset.sound = label;
    button.addEventListener("click", onClick);
    parent.append(button);
  }

  private addSlider(
    parent: HTMLElement,
    label: string,
    min: number,
    max: number,
    step: number,
    key: { [K in keyof LabState]: LabState[K] extends number ? K : never }[keyof LabState],
    format: (value: number) => string,
  ): void {
    const row = document.createElement("label");
    row.className = "slider";
    const name = document.createElement("span");
    name.textContent = label;
    const input = document.createElement("input");
    input.type = "range";
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(this.state[key]);
    input.dataset.key = key;
    const output = document.createElement("output");
    output.textContent = format(this.state[key]);
    input.addEventListener("input", () => {
      this.state[key] = Number(input.value);
      output.textContent = format(this.state[key]);
      this.applyAll();
    });
    row.append(name, input, output);
    parent.append(row);
  }

  private addCheck(parent: HTMLElement, label: string, key: "ghost" | "flyActive"): void {
    const row = document.createElement("label");
    row.className = "check";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = this.state[key];
    input.dataset.key = key;
    input.addEventListener("change", () => {
      this.state[key] = input.checked;
      this.applyAll();
    });
    row.append(input, document.createTextNode(label));
    parent.append(row);
  }

  private renderMeter(activeVoices: number): void {
    const meter = element<HTMLDivElement>("meter");
    const fill = Math.max(0, Math.min(1, (20 * Math.log10(Math.max(this.meter.peak, 1e-6)) + 60) / 60));
    meter.innerHTML =
      `<div class="bar"><div class="fill" style="width:${(fill * 100).toFixed(1)}%"></div></div>` +
      `<span>Spitze ${toDb(this.meter.peak)} dBFS</span>` +
      `<span>Effektiv ${toDb(this.meter.rms)} dBFS</span>` +
      `<span>Höchste Spitze ${toDb(this.meter.maxPeak)} dBFS</span>` +
      `<span>Übersteuerte Fenster ${this.meter.clipWindows}</span>` +
      `<span>Stimmen ${activeVoices}</span>`;
  }

  private renderBank(report: SoundBankReport): void {
    const rows = report.sounds
      .map((sound) => {
        const bad = !sound.finite || sound.peak > 0.99 || sound.rms < 0.001;
        return (
          `<tr><td>${sound.id}</td><td>${sound.variant}</td><td>${sound.seconds.toFixed(2)}</td><td>${sound.sampleRate}</td>` +
          `<td>${sound.channels}</td><td class="${bad ? "bad" : ""}">${toDb(sound.peak)}</td><td>${toDb(sound.rms)}</td>` +
          `<td>${toDb(sound.loudness)}</td><td>${sound.milliseconds.toFixed(1)}</td></tr>`
        );
      })
      .join("");
    const seconds = report.sounds.reduce((sum, sound) => sum + sound.seconds * sound.channels, 0);
    element<HTMLDivElement>("bank").innerHTML =
      `<p>${report.sounds.length} Puffer, ${seconds.toFixed(1)} s Audio, ${(report.bytes / 1048576).toFixed(1)} MB, ` +
      `Rechenzeit ${report.generationMilliseconds.toFixed(0)} ms, bis bereit ${report.totalMilliseconds.toFixed(0)} ms, ` +
      `${report.workers > 0 ? `${report.workers} Worker` : "im Hauptthread"}</p>` +
      `<table><thead><tr><th>Klang</th><th>Var.</th><th>Dauer s</th><th>Rate Hz</th><th>Kanäle</th><th>Spitze dBFS</th>` +
      `<th>Effektiv dBFS</th><th>Lautheit dBFS</th><th>ms</th></tr></thead><tbody>${rows}</tbody></table>`;
  }
}

const lab = new AudioLab();
const api: AudioLabApi = { ready: lab.startAsync(), lab };
(window as unknown as { __audioLab: AudioLabApi }).__audioLab = api;
