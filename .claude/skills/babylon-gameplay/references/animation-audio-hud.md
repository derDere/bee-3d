# Animation, Audio, HUD

## AnimationGroups

- Steuerung: `play(loop?)`, `start(loop?, speedRatio?, from?, to?, isAdditive?)`, `pause()`,
  `stop()`, `reset()`, `restart()`, `goToFrame()`; Eigenschaften `speedRatio`, `loopAnimation`,
  `isAdditive`, `mask`, `weight`.
- `weight` steht standardmäßig auf −1 (Gewichtung aus); 0 bedeutet angehalten.
- `enableBlending` + `blendingSpeed` addiert die Überblendung pro ausgewertetem Frame und hängt
  damit von der Bildrate ab. Bildratenunabhängig: alle Loops laufen lassen und `weight` mit dt
  nachführen.

```ts
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { AnimatorAvatar } from "@babylonjs/core/Animations/animatorAvatar";
import type { AnimationGroup } from "@babylonjs/core/Animations/animationGroup";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";

/** Überblendet zwischen geloopten AnimationGroups über Gewichte (Animationsmischer). */
export class AnimationMixer {
  private readonly fadeSeconds: number;
  private readonly weights = new Map<AnimationGroup, number>();
  private active: AnimationGroup | null = null;

  public constructor(groups: readonly AnimationGroup[], fadeSeconds = 0.25) {
    this.fadeSeconds = fadeSeconds;
    for (const group of groups) {
      group.stop();
      group.weight = 0;
      group.play(true);
      this.weights.set(group, 0);
    }
  }

  public crossFadeTo(group: AnimationGroup, speedRatio = 1): void {
    this.active = group;
    group.speedRatio = speedRatio;
  }

  /** dt in Sekunden. */
  public update(dt: number): void {
    const step = this.fadeSeconds > 0 ? dt / this.fadeSeconds : 1;
    for (const [group, weight] of this.weights) {
      const target = group === this.active ? 1 : 0;
      const next = weight < target ? Math.min(target, weight + step) : Math.max(target, weight - step);
      this.weights.set(group, next);
      group.weight = next;
    }
  }
}
```

## Prozedurale Animation: Flügelschlag

In `onBeforeRenderObservable` drehen, also nach der Auswertung der AnimationGroups:
Ruhe-Quaternion × Schwung-Quaternion. Bei glTF-Skeletten den verknüpften Knoten
(`bone.getTransformNode()`) animieren, nicht den Bone.

```ts
/** Prozeduraler Flügelschlag auf zwei Knoten (Flügelschlag). */
export class WingFlapper {
  public frequencyHz: number;
  public amplitudeRad: number;
  private readonly leftWing: TransformNode;
  private readonly rightWing: TransformNode;
  private readonly leftRest: Quaternion;
  private readonly rightRest: Quaternion;
  private readonly swing = new Quaternion();
  private readonly flapAxis = Vector3.Forward();
  private phase = 0;

  public constructor(leftWing: TransformNode, rightWing: TransformNode, frequencyHz = 20, amplitudeRad = 0.9) {
    this.leftWing = leftWing;
    this.rightWing = rightWing;
    this.frequencyHz = frequencyHz;
    this.amplitudeRad = amplitudeRad;
    // glTF-Knoten besitzen bereits rotationQuaternion; sonst aus den Euler-Winkeln anlegen
    leftWing.rotationQuaternion ??= Quaternion.FromEulerVector(leftWing.rotation);
    rightWing.rotationQuaternion ??= Quaternion.FromEulerVector(rightWing.rotation);
    this.leftRest = leftWing.rotationQuaternion.clone();
    this.rightRest = rightWing.rotationQuaternion.clone();
  }

  /** dt in Sekunden; effort 0..1 skaliert den Ausschlag (Schweben bis Steigen). */
  public update(dt: number, effort: number): void {
    this.phase = (this.phase + dt * this.frequencyHz * Math.PI * 2) % (Math.PI * 2);
    const angle = Math.sin(this.phase) * this.amplitudeRad * effort;
    Quaternion.RotationAxisToRef(this.flapAxis, angle, this.swing);
    this.leftRest.multiplyToRef(this.swing, this.leftWing.rotationQuaternion!);
    Quaternion.RotationAxisToRef(this.flapAxis, -angle, this.swing);
    this.rightRest.multiplyToRef(this.swing, this.rightWing.rotationQuaternion!);
  }
}
```

Sehr schnelle Bewegungen (Insektenflügel mit 20+ Hz) flimmern bei 60 fps — zusätzlich eine
halbtransparente „Bewegungsunschärfe-Scheibe" einblenden oder Frequenz und Amplitude
künstlerisch wählen; das Ergebnis beurteilt der User in Bewegung.

## Retargeting (ab 9.0)

```ts
/** Überträgt eine Animation eines anderen Rigs auf den eigenen Charakter (Retargeting). */
export function retargetOnto(characterRoot: TransformNode, sourceGroup: AnimationGroup): AnimationGroup {
  // Quelle muss beim Aufruf in Ruhepose stehen
  sourceGroup.stop();
  sourceGroup.goToFrame(0);
  const avatar = new AnimatorAvatar("player", characterRoot);
  avatar.showWarnings = false;
  return avatar.retargetAnimationGroup(sourceGroup, {
    animationGroupName: `${sourceGroup.name}_retargeted`,
    fixRootPosition: true,
    mapNodeNames: new Map([["mixamorig:Hips", "Hips"]]),
  });
}
```

Weitere Optionen: `fixAnimations`, `checkHierarchy`, `retargetAnimationKeys`,
`fixGroundReference`, `rootNodeName`, `groundReferenceNodeName`. Nur Quellen, die
TransformNodes animieren (wie glTF).

## Audio (AudioEngineV2)

```ts
import { CreateAudioEngineAsync } from "@babylonjs/core/AudioV2/webAudio/webAudioEngine";
import type { AudioEngineV2 } from "@babylonjs/core/AudioV2/abstractAudio/audioEngineV2";
import type { AudioBus } from "@babylonjs/core/AudioV2/abstractAudio/audioBus";
import type { StaticSound } from "@babylonjs/core/AudioV2/abstractAudio/staticSound";
import type { StreamingSound } from "@babylonjs/core/AudioV2/abstractAudio/streamingSound";
import { SpatialAudioAttachmentType } from "@babylonjs/core/AudioV2/spatialAudioAttachmentType";
import type { Camera } from "@babylonjs/core/Cameras/camera";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";

/** Audio-Grundgerüst mit Bussen für Musik und Effekte (Audiosystem). */
export class AudioSystem {
  public readonly musicBus: AudioBus;
  public readonly sfxBus: AudioBus;
  private readonly engine: AudioEngineV2;

  private constructor(engine: AudioEngineV2, musicBus: AudioBus, sfxBus: AudioBus) {
    this.engine = engine;
    this.musicBus = musicBus;
    this.sfxBus = sfxBus;
  }

  public static async createAsync(): Promise<AudioSystem> {
    // Der eigene Start-Button übernimmt das Entsperren; Babylons Unmute-Button daher aus
    const engine = await CreateAudioEngineAsync({ disableDefaultUI: true, volume: 1 });
    const musicBus = await engine.createBusAsync("music", { volume: 0.6 });
    const sfxBus = await engine.createBusAsync("sfx", { volume: 1 });
    return new AudioSystem(engine, musicBus, sfxBus);
  }

  /** Aus einem Klick oder Tastendruck heraus aufrufen (Autoplay-Sperre). */
  public async unlockAsync(): Promise<void> {
    await this.engine.unlockAsync();
  }

  public attachListener(camera: Camera): void {
    this.engine.listener.attach(camera);
  }

  public loadMusicAsync(url: string): Promise<StreamingSound> {
    return this.engine.createStreamingSoundAsync("music", url, { loop: true, outBus: this.musicBus });
  }

  public loadEffectAsync(name: string, url: string, maxInstances = 4): Promise<StaticSound> {
    return this.engine.createSoundAsync(name, url, { maxInstances, outBus: this.sfxBus });
  }

  /** Räumlicher Dauerton (z. B. Summen), der einem Knoten folgt. */
  public async loadSpatialLoopAsync(name: string, url: string, node: TransformNode): Promise<StaticSound> {
    const sound = await this.engine.createSoundAsync(name, url, {
      loop: true,
      outBus: this.sfxBus,
      spatialEnabled: true,
      spatialMaxDistance: 60,
      spatialDistanceModel: "inverse",
    });
    sound.spatial.attach(node, false, SpatialAudioAttachmentType.Position);
    return sound;
  }

  public set masterVolume(value: number) {
    this.engine.volume = value;
  }

  public async suspendAsync(): Promise<void> {
    await this.engine.pauseAsync();
  }

  public async resumeAsync(): Promise<void> {
    await this.engine.resumeAsync();
  }

  public dispose(): void {
    this.engine.dispose();
  }
}
```

- Engine-Optionen (`IWebAudioEngineOptions`): `audioContext`, `disableDefaultUI`,
  `defaultUIParentElement`, `resumeOnInteraction` (Standard an), `resumeOnPause` (Standard an),
  `volume`, `parameterRampDuration`.
- Sound-Optionen: `maxInstances`, `autoplay`, `loop`, `volume`, `pitch`, `playbackRate`,
  `loopStart`/`loopEnd`, `outBus`, `spatial*`, `stereo*`; `setVolume(v, { duration, shape })`.
- Ein Loop, der vor dem Entsperren gestartet wird, beginnt nach dem Entsperren; ein One-Shot
  nicht.
- Die Doku beschreibt `disableDefaultUI` vertauscht: `true` blendet den Unmute-Button aus.
- Prozedurale Effekte ohne Audiodateien: ZzFX oder jsfxr (Skill `babylon-assets`).

## HUD mit Babylon GUI

```ts
import { AdvancedDynamicTexture } from "@babylonjs/gui/2D/advancedDynamicTexture";
import { TextBlock } from "@babylonjs/gui/2D/controls/textBlock";
import { Rectangle } from "@babylonjs/gui/2D/controls/rectangle";
import { StackPanel } from "@babylonjs/gui/2D/controls/stackPanel";
import { Control } from "@babylonjs/gui/2D/controls/control";
import type { Scene } from "@babylonjs/core/scene";

/** Spiel-HUD mit Punktestand und Energieleiste (Anzeige). */
export class Hud {
  private readonly ui: AdvancedDynamicTexture;
  private readonly score: TextBlock;
  private readonly energyFill: Rectangle;
  private lastScore = -1;

  public constructor(scene: Scene) {
    this.ui = AdvancedDynamicTexture.CreateFullscreenUI("hud", true, scene);
    this.ui.idealWidth = 1280; // Pixelwerte beziehen sich auf 1280 px Breite

    const panel = new StackPanel("topLeft");
    panel.isVertical = false;
    panel.height = "64px";
    panel.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
    panel.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
    panel.paddingLeft = "16px";
    this.ui.addControl(panel);

    this.score = new TextBlock("score", "0");
    this.score.width = "160px";
    this.score.color = "white";
    this.score.fontSize = 32;
    this.score.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
    panel.addControl(this.score);

    const energyFrame = new Rectangle("energyFrame");
    energyFrame.width = "240px";
    energyFrame.height = "16px";
    energyFrame.thickness = 2;
    energyFrame.color = "white";
    energyFrame.top = "72px";
    energyFrame.left = "16px";
    energyFrame.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
    energyFrame.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
    this.ui.addControl(energyFrame);

    this.energyFill = new Rectangle("energyFill");
    this.energyFill.thickness = 0;
    this.energyFill.background = "#f5c518";
    this.energyFill.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
    energyFrame.addControl(this.energyFill);
  }

  /** Nur bei Wertänderung schreiben: jede Änderung markiert die GUI-Textur als neu zu zeichnen. */
  public setScore(value: number): void {
    if (value !== this.lastScore) {
      this.lastScore = value;
      this.score.text = String(value);
    }
  }

  /** Füllstand 0..1; eine Zahl ohne Einheit ist bei width ein Anteil. */
  public setEnergy(fraction: number): void {
    this.energyFill.width = Math.max(0, Math.min(1, fraction));
  }

  public dispose(): void {
    this.ui.dispose();
  }
}
```

- Skalierung: `idealWidth` oder `idealHeight`, optional `useSmallestIdeal`,
  `renderAtIdealSize` (günstiger), `renderScale`.
- GUI-Editor-Inhalte: als JSON mit dem Spiel ausliefern und per
  `ui.parseFromURLAsync(url)` bzw. `parseSerializedObject(json)` laden. Jede im JSON verwendete
  Control-Klasse muss importiert sein (oder der Barrel `@babylonjs/gui/2D`).
- Leistung: Text nur bei Änderung setzen, `useBitmapCache` für komplexe Controls,
  `disablePicking` für reine Anzeige-Ebenen. Auf HiDPI-Displays wirkt Text ohne
  `adaptToDeviceRatio` unscharf (kostet Leistung).
- An Weltobjekte gebundene Labels: `control.linkWithMesh(mesh)`.

## HTML-Overlay für Menüs

- Menüs, Einstellungen, Dialoge in HTML/CSS über dem Canvas.
- HUD-Container mit `pointer-events: none`, einzelne Buttons mit `pointer-events: auto`.
- Nach dem Schließen eines Menüs `canvas.focus()`, damit die Tastatur wieder ankommt.
- Der Start-Button ist zugleich die Nutzeraktion für `audio.unlockAsync()` und Pointer Lock.
