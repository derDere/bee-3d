---
name: babylon-gameplay
description: Spielsysteme für Babylon.js-9-Browserspiele in TypeScript — Spieltakt mit festem Zeitschritt, Pause und Sichtbarkeit, Architektur (Systeme, Behaviors, Szenenwechsel, AssetContainer, Einstellungen), Havok-Physik (Physics V2, Trigger, Kollisionen, Raycasts, Character Controller für Flugfiguren), Input (Tastatur, Gamepad, Pointer Lock, Touch, Aktionsschicht mit virtuellen Eingaben), Verfolgerkamera und Tiefenpräzision, Animation (AnimationGroups, prozedural, Retargeting), AudioEngineV2 sowie HUD und Menüs. Laden beim Bauen oder Ändern von Spiellogik, Steuerung, Kamera, Physik, Animation, Ton oder HUD.
---

# Spielsysteme

Verifizierte Bausteine (kompiliert gegen Babylon 9.29, Havok zur Laufzeit getestet):

- [references/loop-and-architecture.md](references/loop-and-architecture.md) — Spieltakt, Pause, Szenenwechsel, Einstellungen
- [references/physics.md](references/physics.md) — Havok, Trigger, Kollisionen, Raycasts, Flugkörper
- [references/input-camera.md](references/input-camera.md) — Tastatur, Gamepad, Maus, Touch, Aktionsschicht, Verfolgerkamera
- [references/animation-audio-hud.md](references/animation-audio-hud.md) — Animation, Audio, HUD

Signaturen vor dem Einbau gegen die installierten Typings prüfen (Skill `babylon-game-dev`).

## Grundsätze

- **Systeme sind Klassen** mit einer Verantwortung. Der `GameLoop` treibt sie:
  `fixedUpdate(dt)` für Logik, Bewegung und Physiksteuerung im festen Takt,
  `frameUpdate(dt, alpha)` für Kamera, Darstellung und HUD einmal pro Frame.
- **Reihenfolge in `scene.render()`:** `onBeforeAnimationsObservable` → Animationen → Physik
  (`onBeforePhysicsObservable` → Schritt → `onAfterPhysicsObservable`) → `camera.update()` →
  `onBeforeRenderObservable` → Zeichnen → `onAfterRenderObservable`. Prozedurale
  Überschreibungen, Kamera und HUD gehören in `onBeforeRenderObservable`.
- **Zeit in Sekunden**, Frame-Delta begrenzt (≤ 0,1 s), damit ein Ruckler keine Sprünge erzeugt.
- **Eingaben laufen über eine Aktionsschicht.** Die Spiellogik liest benannte Aktionen
  (`forward`, `yaw` …), nie Tasten. So speist die Debug-API (`simulateInput`) virtuelle
  Eingaben ein, und Tastatur, Gamepad und Touch sind austauschbar.
- **Jedes System hat `dispose()`** und meldet seine Observer ab.

## Spieltakt und Pause

- Fester Logiktakt 1/60 s über einen Akkumulator (höchstens 5 Schritte pro Frame). Havok mit
  `new HavokPlugin(true, havok)` rechnet mit dem Frame-Delta.
- Volle Determinismus-Kette (Engine-Optionen `deterministicLockstep`, `lockstepMaxSteps`,
  `timeStep`, dazu `scene.onBeforeStepObservable`) nur bei echtem Bedarf: Zwischen den Schritten
  wird nicht interpoliert, auf 120/144-Hz-Displays ruckelt die Bewegung dann im 60-Hz-Raster.
- **Pause:** `scene.physicsEnabled = false` und `scene.animationTimeScale = 0`; die Renderschleife
  läuft weiter (Menüs, Standbilder). `scene.animationsEnabled = false` lässt Animationen beim
  Fortsetzen um die gesamte Pausendauer springen. Audio: `audioEngine.pauseAsync()` /
  `resumeAsync()`.
- Versteckter Tab (`visibilitychange`) → Pause. Größenänderung: `ResizeObserver` am Canvas →
  `engine.resize()`.

## Physik (Havok, Physics V2)

- **Einrichten:** `HavokPhysics({ locateFile: () => havokWasmUrl })` mit `?url`-Import der WASM,
  `optimizeDeps.exclude: ["@babylonjs/havok"]`, Side-Effect-Imports
  `Physics/joinedPhysicsEngineComponent` und `Physics/v2/physicsEngineComponent`.
- **Bewegungsarten:** `STATIC`, `ANIMATED` (entspricht kinematisch), `DYNAMIC`. Ein reiner
  `ANIMATED`-Körper fliegt ohne Ereignis durch statische Geometrie.
- **Flugfigur:** `PhysicsCharacterController` mit Kugelform und Schwerkraft null — je Takt
  `checkSupport` → `setVelocity` → `integrate(dt, support, gravity)`; die Darstellung übernimmt
  `getPosition()` im Frame-Update. Er gleitet an Hindernissen entlang und schiebt dynamische
  Objekte. Alternative mit Abprall und Kontaktereignissen: `DYNAMIC`-Körper mit
  `setGravityFactor(0)`, Trägheit null und Dämpfung.
- **Trigger** (`shape.isTrigger = true`) melden sich nur weltweit über
  `plugin.onTriggerCollisionObservable` (`TRIGGER_ENTERED` / `TRIGGER_EXITED`) und beachten die
  Filtermasken. Immer `collider` **und** `collidedAgainst` prüfen.
- **Kollisionen:** pro Körper `setCollisionCallbackEnabled(true)` → `getCollisionObservable()`;
  Ende über `setCollisionEndedCallbackEnabled(true)` → `COLLISION_FINISHED`.
- **Raycasts:** `plugin.raycast(from, to, result, { collideWith, shouldHitTriggers })` mit einem
  wiederverwendeten `PhysicsRaycastResult`.
- **Kollisionsebenen** als Bitmasken-Objekt (`as const`), Formen einfach halten (Kugel, Box,
  Kapsel). Formen werden geteilt und separat entsorgt; Körper erst nach dem Physikschritt
  entsorgen (`onAfterPhysicsObservable.addOnce`).

## Input und Kamera

- **Tastatur:** `scene.onKeyboardObservable`, gehaltene und frisch gedrückte `event.code`-Werte
  in Sets (layoutunabhängig); bei `blur` leeren. Die Listener hängen am Canvas — DOM-Buttons,
  die den Fokus nehmen, stoppen die Tastatureingabe, bis der Canvas wieder fokussiert ist.
- **Gamepad:** `DeviceSourceManager` → `getDeviceSource(DeviceType.Xbox)?.getInput(XboxInput.LStickXAxis)`;
  Y-Achsen sind nach oben negativ, Totzone filtern.
- **Maus:** `canvas.requestPointerLock()` aus einem Klick, `movementX/Y` bei `POINTERMOVE`,
  `scene.skipPointerMovePicking = true`.
- **Touch:** Joystick per Babylon GUI oder HTML; `VirtualJoystick` legt einen Overlay-Canvas über
  die Szene, der GUI- und Szenen-Ereignisse blockiert.
- **Kamera:** eigene Verfolgerkamera auf `TargetCamera` mit bildratenunabhängiger Glättung
  (`1 - Math.exp(-k * dt)`) und Raycast gegen Verdeckung. `FollowCamera` taugt für Prototypen
  (Glättung pro Frame, keine Verdeckungsprüfung), `ArcRotateCamera` für Menüs und Fotomodus,
  `UniversalCamera` als freie Debug-Kamera.
- **Tiefenpräzision:** `camera.minZ = 0.1`, `camera.maxZ = 0` (unendliche Fernebene, wie in den
  offiziellen Atmosphäre-Beispielen). Mit dem Atmosphäre-Addon bleibt der Reverse-Depth-Buffer
  aus — der Himmel wird damit schwarz. Logarithmische Tiefe (`material.useLogarithmicDepth`) nur
  bei Z-Fighting. Details: [references/input-camera.md](references/input-camera.md).

## Animation, Audio, HUD

- **AnimationGroups:** bildratenunabhängiges Überblenden über `weight` (alle Loops laufen,
  Gewichte folgen dt). `enableBlending`/`blendingSpeed` wirkt pro Frame und hängt damit von der
  Bildrate ab.
- **Prozedural** (z. B. Flügelschlag): TransformNodes in `onBeforeRenderObservable` drehen —
  Ruhe-Quaternion × Schwung-Quaternion. Bei glTF-Skeletten `bone.getTransformNode()` animieren.
- **Retargeting** (ab 9.0): `AnimatorAvatar.retargetAnimationGroup()`; Quelle in Ruhepose.
- **Audio:** `CreateAudioEngineAsync({ disableDefaultUI: true })`, eigener Start-Button ruft
  `unlockAsync()` auf (Nutzeraktion). Busse für Musik und Effekte, Musik als Streaming-Sound,
  räumliche Sounds an Knoten gehängt, Listener an der Kamera. Die Legacy-Audio-Engine ist seit
  8.0 standardmäßig aus.
- **HUD und Menüs:** Menüs und Einstellungen in HTML/CSS (Barrierefreiheit, Formulare,
  Schriften); HUD im Spiel und an Weltobjekte gebundene Labels mit Babylon GUI
  (`AdvancedDynamicTexture.CreateFullscreenUI`, `idealWidth`). Text nur bei Wertänderung setzen.
  HTML-HUD-Container bekommen `pointer-events: none`.

## Architektur

- Babylon schreibt kein ECS vor. Komposition: `Game` besitzt Engine, Szene, Spieltakt und
  Systeme; Spielobjekte sind Klassen, die ihre Knoten besitzen; wiederverwendbare Knotenlogik
  als `Behavior` (`node.addBehavior`); Ereignisse über Observables.
- **Szenenwechsel:** neue Szene aufbauen → `whenReadyAsync()` → umschalten → alte Szene
  entsorgen. Pause und Ergebnisbildschirm sind Overlays auf der Spielszene.
- **Modelle:** einmal per `LoadAssetContainerAsync` laden, Kopien über
  `instantiateModelsToScene`.
- **Einstellungen:** versioniertes JSON im `localStorage` mit try/catch-Rückfall.
- **Zustandsautomat:** Union-Typ der Zustände plus eine Klasse je Zustand.
- **Logiktests ohne Rendering:** `NullEngine` (`@babylonjs/core/Engines/nullEngine`) läuft in
  Node — geeignet für Physik- und Spiellogik-Tests.
