# Spieltakt und Architektur

## Spieltakt

Fester Logiktakt mit Akkumulator, Pause und Sichtbarkeitsbehandlung. Hängt sich in
`onBeforeRenderObservable` — also nach Animationen und Physik des Frames.

```ts
import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";
import type { Observer } from "@babylonjs/core/Misc/observable";
import type { Scene } from "@babylonjs/core/scene";

/** Spielsystem mit festem Zeitschritt (Spiellogik-Takt). */
export interface FixedStepSystem {
  fixedUpdate(dt: number): void;
}

/** Spielsystem, das einmal pro gerendertem Frame läuft (Darstellung, Kamera, HUD). */
export interface FrameSystem {
  frameUpdate(dt: number, alpha: number): void;
}

/** Spielschleife mit festem Logiktakt, Pause und Sichtbarkeitsbehandlung (Spielschleife). */
export class GameLoop {
  private readonly engine: AbstractEngine;
  private readonly scene: Scene;
  private readonly fixedDt: number;
  private readonly maxStepsPerFrame: number;
  private readonly fixedSystems: FixedStepSystem[] = [];
  private readonly frameSystems: FrameSystem[] = [];
  private readonly observer: Observer<Scene>;
  private readonly resizeObserver: ResizeObserver;
  private accumulator = 0;
  private paused = false;
  private readonly onVisibilityChange = (): void => {
    if (document.hidden) {
      this.setPaused(true);
    }
  };

  public constructor(engine: AbstractEngine, scene: Scene, fixedDt = 1 / 60, maxStepsPerFrame = 5) {
    this.engine = engine;
    this.scene = scene;
    this.fixedDt = fixedDt;
    this.maxStepsPerFrame = maxStepsPerFrame;
    this.observer = scene.onBeforeRenderObservable.add(() => this.tick());
    document.addEventListener("visibilitychange", this.onVisibilityChange);
    this.resizeObserver = new ResizeObserver(() => engine.resize());
    const canvas = engine.getRenderingCanvas();
    if (canvas) {
      this.resizeObserver.observe(canvas);
    }
  }

  public addFixed(system: FixedStepSystem): void {
    this.fixedSystems.push(system);
  }

  public addFrame(system: FrameSystem): void {
    this.frameSystems.push(system);
  }

  public get isPaused(): boolean {
    return this.paused;
  }

  public setPaused(paused: boolean): void {
    this.paused = paused;
    this.accumulator = 0;
    // Physik-Schritt aus, Animationszeit einfrieren; animationsEnabled = false würde beim Fortsetzen springen
    this.scene.physicsEnabled = !paused;
    this.scene.animationTimeScale = paused ? 0 : 1;
  }

  public start(): void {
    this.engine.runRenderLoop(() => this.scene.render());
  }

  private tick(): void {
    const frameDt = Math.min(this.engine.getDeltaTime() / 1000, 0.1);
    if (!this.paused) {
      this.accumulator += frameDt;
      let steps = 0;
      while (this.accumulator >= this.fixedDt && steps < this.maxStepsPerFrame) {
        for (const system of this.fixedSystems) {
          system.fixedUpdate(this.fixedDt);
        }
        this.accumulator -= this.fixedDt;
        steps++;
      }
      if (steps === this.maxStepsPerFrame) {
        // Nach einem Hänger nicht im Zeitraffer aufholen
        this.accumulator = 0;
      }
    }
    const alpha = this.accumulator / this.fixedDt;
    for (const system of this.frameSystems) {
      system.frameUpdate(this.paused ? 0 : frameDt, alpha);
    }
  }

  public dispose(): void {
    this.scene.onBeforeRenderObservable.remove(this.observer);
    document.removeEventListener("visibilitychange", this.onVisibilityChange);
    this.resizeObserver.disconnect();
    this.engine.stopRenderLoop();
  }
}
```

**Erweiterung für die Debug-API** (`__game.step(n)`): einen Zähler `pendingSteps` führen.
Solange er größer null ist, läuft der Takt trotz Pause weiter (Physik und Animationszeit
vorübergehend an), jeder feste Schritt zählt herunter; bei null wird wieder eingefroren und das
Promise erfüllt.

## Zeitquellen

| API | Bedeutung |
|---|---|
| `engine.getDeltaTime()` | rohe Frame-Zeit in ms |
| `scene.getAnimationRatio()` | begrenztes Delta × 60/1000, also 1,0 bei 60 fps |
| `scene.deltaTime` | nur vom Animationssystem gesetzt (Wanduhr × `animationTimeScale`) |
| `HavokPlugin(true, …)` | Physikschritt mit Frame-Delta; `HavokPlugin(false, …)` mit festem `setTimeStep` (Standard 1/60) einmal pro Frame |
| `plugin.setSubTimeStep(ms)` | teilt das Delta in Unterschritte |

Die Physik V2 begrenzt jeden Schritt auf ≤ 0,1 s.

## Behaviors

`Behavior`-Klassen eignen sich für wiederverwendbare Knotenlogik (Schweben, Drehen,
Hervorheben). Anhängen mit `node.addBehavior(behavior)`, entfernen mit
`node.removeBehavior(behavior)`.

```ts
import type { Behavior } from "@babylonjs/core/Behaviors/behavior";
import type { Observer } from "@babylonjs/core/Misc/observable";
import type { Nullable } from "@babylonjs/core/types";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";

/** Lässt ein Sammelobjekt sanft auf und ab schweben und rotieren (Schwebeverhalten). */
export class HoverBehavior implements Behavior<TransformNode> {
  public readonly name = "Hover";
  public attachedNode: Nullable<TransformNode> = null;
  private readonly amplitude: number;
  private readonly speed: number;
  private observer: Nullable<Observer<Scene>> = null;
  private baseY = 0;
  private time = 0;

  public constructor(amplitude = 0.25, speed = 2) {
    this.amplitude = amplitude;
    this.speed = speed;
  }

  public init(): void {}

  public attach(target: TransformNode): void {
    this.attachedNode = target;
    this.baseY = target.position.y;
    const scene = target.getScene();
    this.observer = scene.onBeforeRenderObservable.add(() => {
      const dt = scene.getEngine().getDeltaTime() / 1000;
      this.time += dt;
      target.position.y = this.baseY + Math.sin(this.time * this.speed) * this.amplitude;
      target.rotation.y += dt;
    });
  }

  public detach(): void {
    this.observer?.remove();
    this.observer = null;
    this.attachedNode = null;
  }
}
```

## Szenenwechsel und Modellbibliothek

```ts
import type { Scene } from "@babylonjs/core/scene";
import { LoadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader";
import type { AssetContainer, InstantiatedEntries } from "@babylonjs/core/assetContainer";
import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";

/** Ein Spielzustand mit eigener Szene (Spielzustand). */
export interface GameState {
  readonly scene: Scene;
  enterAsync(): Promise<void>;
  dispose(): void;
}

/** Schaltet zwischen Spielzuständen um und gibt die alte Szene frei (Szenenwechsel). */
export class SceneDirector {
  private current: GameState | null = null;

  public constructor(engine: AbstractEngine) {
    engine.runRenderLoop(() => this.current?.scene.render());
  }

  public async switchToAsync(next: GameState): Promise<void> {
    this.current?.scene.detachControl();
    await next.enterAsync();
    await next.scene.whenReadyAsync();
    const previous = this.current;
    this.current = next;
    previous?.dispose();
  }
}

/** Lädt ein Modell einmal und erzeugt beliebig viele Kopien (Modellbibliothek). */
export class ModelLibrary {
  private readonly scene: Scene;
  private readonly containers = new Map<string, AssetContainer>();

  public constructor(scene: Scene) {
    this.scene = scene;
  }

  public async preloadAsync(key: string, url: string): Promise<void> {
    this.containers.set(key, await LoadAssetContainerAsync(url, this.scene));
  }

  public spawn(key: string, name: string): InstantiatedEntries {
    const container = this.containers.get(key);
    if (!container) {
      throw new Error(`Model "${key}" was not preloaded.`);
    }
    return container.instantiateModelsToScene((source) => `${name}_${source}`, false, { doNotInstantiate: false });
  }

  public dispose(): void {
    for (const container of this.containers.values()) {
      container.dispose();
    }
    this.containers.clear();
  }
}
```

`LoadAssetContainerAsync` und `ImportMeshAsync` zeigen keinen Ladebildschirm;
`AppendSceneAsync`, `LoadSceneAsync` und `AssetsManager.load()` schon — dafür einen eigenen
`ILoadingScreen` setzen, `@babylonjs/core/Loading/loadingScreen` importieren oder
`SceneLoaderFlags.ShowLoadingScreen = false` setzen.

## Einstellungen

```ts
/** Persistente Spieleinstellungen (Einstellungen). */
export interface GameSettings {
  readonly version: 1;
  masterVolume: number;
  musicVolume: number;
  invertY: boolean;
  mouseSensitivity: number;
}

const DefaultSettings: GameSettings = { version: 1, masterVolume: 1, musicVolume: 0.6, invertY: false, mouseSensitivity: 1 };

/** Liest und schreibt Einstellungen versioniert im localStorage; bei Fehlern gelten Standardwerte. */
export class SettingsStore {
  private readonly storageKey: string;

  public constructor(storageKey: string) {
    this.storageKey = storageKey;
  }

  public load(): GameSettings {
    try {
      const raw = window.localStorage.getItem(this.storageKey);
      if (!raw) {
        return { ...DefaultSettings };
      }
      const parsed = JSON.parse(raw) as Partial<GameSettings>;
      return parsed.version === DefaultSettings.version ? { ...DefaultSettings, ...parsed } : { ...DefaultSettings };
    } catch {
      return { ...DefaultSettings };
    }
  }

  public save(settings: GameSettings): void {
    try {
      window.localStorage.setItem(this.storageKey, JSON.stringify(settings));
    } catch {
      // Speicher voll oder blockiert (privater Modus): Einstellungen gelten nur für diese Sitzung
    }
  }
}
```

## Zustandsautomat

```ts
/** Phasen des Spiels (Spielphase). */
export type GamePhase = "loading" | "title" | "playing" | "paused" | "results";
```

Je Phase eine Klasse mit `enter()`, `update(dt)`, `exit()`; ein `PhaseMachine` wechselt und ruft
die Übergänge auf. Pause und Ergebnis sind Overlays über der laufenden Spielszene.

## Logiktests ohne Rendering

`NullEngine` (`@babylonjs/core/Engines/nullEngine`) erzeugt Szenen ohne GPU. Havok lässt sich in
Node mit `HavokPhysics({ wasmBinary })` laden (WASM-Datei per `fs` einlesen). Damit laufen
Physik- und Spiellogik-Tests ohne Browser.
