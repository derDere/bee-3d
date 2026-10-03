// src/systems/audio/synth/recipes/combat.ts — Kampfklänge: Laser, Gatling, Stachel, Spucke, Treffer, Fliegentod.
import { Clip } from "../clip";
import {
  Crackle,
  NoiseSource,
  Oscillator,
  StateVariableFilter,
  TwoPi,
  expLerp,
  saturate,
  smoothstep,
  strike,
} from "../dsp";
import { chirpTone, plop, splat } from "../layers";
import { OneShotLevel, punchyLevel, type SoundRecipe } from "./recipeTypes";

/** Laserauge: heller „Tzing“-Anschlag, sirrender FM-Ton mit elektrischem Brummen und Funkenknistern. */
const laser: SoundRecipe = {
  id: "laser",
  variants: 2,
  rateFactor: 1,
  level: OneShotLevel,
  build({ sampleRate, random }, variant) {
    const base = variant === 0 ? 1180 : 1330;
    const zap = new Oscillator(sampleRate);
    const carrier = new Oscillator(sampleRate);
    const modulator = new Oscillator(sampleRate);
    const hum = new Oscillator(sampleRate);
    const humTone = new StateVariableFilter(sampleRate);
    const crackle = new Crackle(sampleRate, random);
    const crackleBand = new StateVariableFilter(sampleRate);
    const tone = new StateVariableFilter(sampleRate);
    return Clip.render(sampleRate, 0.8, (t) => {
      const zapPart = zap.sine(base * 0.7 + base * 2.4 * Math.exp(-t / 0.016)) * strike(t, 0.002, 0.03);
      const body = strike(t - 0.01, 0.02, 0.3) * (1 - smoothstep(0.6, 0.79, t));
      const frequency = base * (1 + 0.013 * Math.sin(TwoPi * 23 * t)) * (1 - 0.08 * t);
      const index = 0.8 + 0.8 * Math.exp(-t / 0.1);
      const whine = carrier.sine(frequency, index * modulator.sine(frequency * 0.5));
      const buzz = humTone.lowpass(hum.pulse(frequency / 16, 0.4), 950, 0.9);
      const sparks = crackleBand.bandpass(crackle.next(170 * body), 4300, 1.3);
      return tone.lowpass(zapPart * 0.8 + (whine * 0.55 + buzz * 0.2) * body + sparks * 0.4, 6500, 0.75);
    }).fadeOut(0.02);
  },
};

/** Pollen-Gatling: eine Salve aus sechs weichen Plopps in 0,4 s, passend zu einem Modulzyklus. */
const gatling: SoundRecipe = {
  id: "gatling",
  variants: 3,
  rateFactor: 1,
  level: OneShotLevel,
  build({ sampleRate, random }, variant) {
    const pitch = [1, 1.07, 0.94][variant] ?? 1;
    const clip = Clip.silence(sampleRate, 0.56);
    for (let k = 0; k < 6; k++) {
      const pop = plop(sampleRate, random, {
        startHz: 1150 * pitch * random.range(0.92, 1.08),
        endHz: 250 * pitch * random.range(0.92, 1.08),
        pitchTau: 0.011,
        tau: 0.024,
        puff: 0.28,
        overtone: 0.3,
      });
      const at = 0.006 + k * 0.071 + random.range(-0.005, 0.005);
      clip.mix(pop, at, (k === 5 ? 0.8 : 1) * random.range(0.85, 1.1));
    }
    return clip.process(() => {
      const soften = new StateVariableFilter(sampleRate);
      return (value) => soften.lowpass(value, 5200, 0.7);
    });
  },
};

/** Stachelrakete beim Start: „Thwip“ von der Sehne, aufsteigendes Zischen und ein leises Pfeifen. */
const stingerLaunch: SoundRecipe = {
  id: "stingerLaunch",
  variants: 2,
  rateFactor: 1,
  level: punchyLevel(1.5),
  build({ sampleRate, random }, variant) {
    const lift = variant === 0 ? 1 : 1.12;
    const thwip = new Oscillator(sampleRate);
    const whistle = new Oscillator(sampleRate);
    const noise = new NoiseSource(random);
    const band = new StateVariableFilter(sampleRate);
    const click = new StateVariableFilter(sampleRate);
    const tone = new StateVariableFilter(sampleRate);
    return Clip.render(sampleRate, 0.7, (t) => {
      const white = noise.white();
      const release =
        thwip.sine(260 * lift + 640 * lift * Math.exp(-t / 0.008)) * strike(t, 0.001, 0.014) * 0.6 +
        click.highpass(white, 2500) * strike(t, 0.0004, 0.003) * 0.4;
      const hiss =
        band.bandpass(white, expLerp(1700 * lift, 6400 * lift, smoothstep(0, 0.45, t)), 1.4) *
        strike(t - 0.008, 0.025, 0.21) *
        (1 + 0.14 * Math.sin(TwoPi * 38 * t));
      const whistlePart = whistle.sine(expLerp(1500 * lift, 3100 * lift, Math.min(1, t / 0.5))) * strike(t - 0.02, 0.05, 0.18) * 0.1;
      return tone.lowpass(release + hiss + whistlePart, 9000, 0.7);
    }).fadeOut(0.03);
  },
};

/** Stachel-Einschlag: kleines Comic-„Poff“ mit Wumms, Rauschschlag, Funken und hellem Spitzen-Klirren. */
const stingerImpact: SoundRecipe = {
  id: "stingerImpact",
  variants: 2,
  rateFactor: 1,
  level: punchyLevel(2.5),
  build({ sampleRate, random }, variant) {
    const tink = variant === 0 ? 2400 : 2680;
    const thump = new Oscillator(sampleRate);
    const ring = new Oscillator(sampleRate);
    const noise = new NoiseSource(random);
    const burst = new StateVariableFilter(sampleRate);
    const crackle = new Crackle(sampleRate, random, 0.0012);
    const crackleTone = new StateVariableFilter(sampleRate);
    return Clip.render(sampleRate, 0.75, (t) => {
      const low = thump.sine(48 + 105 * Math.exp(-t / 0.03)) * strike(t, 0.002, 0.09) * 0.9;
      const blast =
        burst.lowpass(noise.white() * 0.6 + noise.brown() * 0.9, expLerp(6000, 380, smoothstep(0, 0.28, t)), 0.8) * strike(t, 0.001, 0.11);
      const sparks = crackleTone.highpass(crackle.next(320 * Math.exp(-t / 0.12)), 2000) * 0.32;
      const tip = ring.sine(tink) * strike(t, 0.0008, 0.045) * 0.16;
      return low + blast + sparks + tip;
    }).fadeOut(0.05);
  },
};

/** Fliegenspucke: „Ptui“ — Lippenplosiv, Zungenklick und ein nasser, aufsteigender Pfeifton. */
const spit: SoundRecipe = {
  id: "spit",
  variants: 2,
  rateFactor: 1,
  level: punchyLevel(1.5),
  build({ sampleRate, random }, variant) {
    const voice = variant === 0 ? 1 : 1.15;
    const noise = new NoiseSource(random);
    const lip = new StateVariableFilter(sampleRate);
    const tongue = new StateVariableFilter(sampleRate);
    const wetBand = new StateVariableFilter(sampleRate);
    const pop = new Oscillator(sampleRate);
    const whistle = new Oscillator(sampleRate);
    const whistleOctave = new Oscillator(sampleRate, 0.3);
    return Clip.render(sampleRate, 0.36, (t) => {
      const white = noise.white();
      const plosive =
        lip.lowpass(white, 1400, 0.8) * strike(t, 0.0008, 0.006) * 0.8 +
        pop.sine(85 + 120 * Math.exp(-t / 0.01)) * strike(t, 0.001, 0.02) * 0.5;
      const tick = tongue.highpass(white, 3000) * strike(t - 0.04, 0.0005, 0.003) * 0.45;
      const glide = expLerp(640 * voice, 1700 * voice, smoothstep(0.05, 0.21, t));
      const envelope = strike(t - 0.05, 0.025, 0.075);
      const gurgle = 1 + 0.25 * Math.sin(TwoPi * 32 * t);
      const tone = (whistle.sine(glide) * 0.6 + whistleOctave.sine(glide * 2) * 0.18) * envelope * gurgle;
      const wet = wetBand.bandpass(white, glide * 1.2, 3) * envelope * 0.5;
      return plosive + tick + tone + wet;
    }).fadeOut(0.03);
  },
};

/** Spucke trifft: „Platsch“ mit schmatzender Resonanz und Tröpfchen. */
const spitHit: SoundRecipe = {
  id: "spitHit",
  variants: 2,
  rateFactor: 1,
  level: punchyLevel(2.5),
  build({ sampleRate, random }, variant) {
    return splat(sampleRate, random, {
      seconds: 0.5,
      brightHz: 7000,
      darkHz: variant === 0 ? 520 : 600,
      sweepSeconds: 0.12,
      tau: 0.075,
      squelchFromHz: 1500,
      squelchToHz: 430,
      thumpHz: 120,
      droplets: 5,
    });
  },
};

/** Fliegentod: dicker „Splat“, danach stotterndes, absinkendes Brummen und ein kleines „Plink“ zum Schluss. */
const flyDeath: SoundRecipe = {
  id: "flyDeath",
  variants: 2,
  rateFactor: 1,
  level: OneShotLevel,
  build({ sampleRate, random }, variant) {
    const start = 0.07;
    const end = variant === 0 ? 0.95 : 0.85;
    const impact = splat(sampleRate, random, {
      seconds: 0.6,
      brightHz: 5500,
      darkHz: 300,
      sweepSeconds: 0.14,
      tau: 0.09,
      squelchFromHz: 1250,
      squelchToHz: 340,
      thumpHz: 100,
      droplets: 6,
    });
    const buzz = new Oscillator(sampleRate);
    const gate = new Oscillator(sampleRate, 0.25);
    const shape = new StateVariableFilter(sampleRate);
    const formant = new StateVariableFilter(sampleRate);
    const span = end - start;
    const dying = Clip.render(sampleRate, span + 0.05, (t) => {
      const progress = smoothstep(0, span, t);
      const frequency = expLerp(variant === 0 ? 270 : 240, 55, Math.pow(progress, 0.8));
      const raw = saturate(buzz.pulse(frequency, 0.35) * 1.4, 1.8);
      const opening = 0.5 + 0.5 * gate.sine(18 - 9 * progress);
      const stutter = 1 - smoothstep(0.2, 0.85, progress) * 0.85 * (1 - opening * opening);
      const body = shape.lowpass(raw, 2500, 0.8) * 0.7 + formant.bandpass(raw, 800, 1.2) * 0.5;
      return body * strike(t, 0.03, 0.45) * stutter;
    }).fadeOut(0.04);
    const plink = chirpTone(sampleRate, {
      fromHz: variant === 0 ? 330 : 392,
      toHz: variant === 0 ? 300 : 360,
      glideSeconds: 0.05,
      tau: 0.07,
      octave: 0.3,
    });
    return Clip.silence(sampleRate, 1.15).mix(impact, 0).mix(dying, start, 0.55).mix(plink, end - 0.03, 0.3);
  },
};

/** Biene getroffen: Chitin-„Tock“ und ein kurzes, niedliches „Iep!“. */
const beeHit: SoundRecipe = {
  id: "beeHit",
  variants: 2,
  rateFactor: 1,
  level: punchyLevel(1.8),
  build({ sampleRate, random }, variant) {
    const squeakHz = variant === 0 ? 1350 : 1050;
    const noise = new NoiseSource(random);
    const shell = new StateVariableFilter(sampleRate);
    const thud = new Oscillator(sampleRate);
    const squeak = new Oscillator(sampleRate);
    const squeakOctave = new Oscillator(sampleRate, 0.25);
    return Clip.render(sampleRate, 0.32, (t) => {
      const tock =
        shell.bandpass(noise.white(), 2600, 3) * strike(t, 0.0005, 0.007) * 0.9 +
        thud.sine(130 + 170 * Math.exp(-t / 0.012)) * strike(t, 0.001, 0.04) * 0.6;
      const local = t - 0.016;
      const contour = squeakHz * (1 + 0.45 * Math.sin(Math.PI * Math.min(1, Math.max(0, local) / 0.13)));
      const frequency = contour * (1 + 0.025 * Math.sin(TwoPi * 28 * t));
      const eep = (squeak.sine(frequency) + 0.2 * squeakOctave.sine(frequency * 2)) * strike(local, 0.008, 0.06) * 0.35;
      return tock + eep;
    }).fadeOut(0.02);
  },
};

/** Rezepte der Kampfklänge. */
export const CombatRecipes: readonly SoundRecipe[] = [laser, gatling, stingerLaunch, stingerImpact, spit, spitHit, flyDeath, beeHit];
