// src/systems/audio/audioParams.ts — Hilfen für AudioParams: gleitende Zielwerte, Dezibel, Lautstärkekurve.

/** Begrenzt auf [0, 1]; ungültige Zahlen werden 0. */
export function clamp01(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }
  return value >= 1 ? 1 : value;
}

/** Dezibel in einen linearen Faktor. */
export function dbToGain(db: number): number {
  return Math.pow(10, db / 20);
}

/** Schiebereglerwert 0..1 in eine wahrnehmungsnahe Verstärkung (quadratische Lautstärkekurve). */
export function sliderToGain(value: number): number {
  const clamped = clamp01(value);
  return clamped * clamped;
}

/** Tiefpass-Güte für Web-Audio-Biquads in dB: −3 dB entspricht Butterworth (ohne Überhöhung). */
export const FlatLowpassQ = -3;

/**
 * Gleitender AudioParam (Parameterglättung): folgt neuen Zielwerten mit einer Zeitkonstante und überspringt
 * Änderungen unterhalb von epsilon. So bleiben Aufrufe je Frame billig und frei von Knacksern.
 */
export class SmoothedParam {
  private readonly context: BaseAudioContext;
  private readonly param: AudioParam;
  private readonly timeConstant: number;
  private readonly epsilon: number;
  private target: number;

  public constructor(context: BaseAudioContext, param: AudioParam, initial: number, timeConstant: number, epsilon = 1e-4) {
    this.context = context;
    this.param = param;
    this.timeConstant = timeConstant;
    this.epsilon = epsilon;
    this.target = initial;
    param.value = initial;
  }

  public get value(): number {
    return this.target;
  }

  public set(value: number, timeConstant = this.timeConstant): void {
    if (!Number.isFinite(value) || Math.abs(value - this.target) <= this.epsilon) {
      return;
    }
    this.target = value;
    this.param.setTargetAtTime(value, this.context.currentTime, timeConstant);
  }
}
