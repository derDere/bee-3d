# Projekt aufsetzen — Details

Alle Versionen live nachschlagen (`npm view <paket> version`); Befehle laufen im Repo-Root.

## 1. Gerüst erzeugen

Die Vite-Vorlage `vanilla-ts` liefert aktuelle Standards für `tsconfig.json`, `package.json`
und `index.html`. Das Repo-Root enthält bereits `.git`, `.claude/` und `.mcp.json` — deshalb
das Gerüst in einem leeren Unterordner erzeugen und die Dateien übernehmen:

```
npm create vite@latest .temp/scaffold -- --template vanilla-ts --no-interactive
```

Danach `index.html`, `package.json`, `tsconfig.json`, `src/` und `public/` ins Root verschieben,
`.gitignore` zusammenführen, die Demo-Inhalte der Vorlage entfernen und `.temp/` in
`.gitignore` aufnehmen.

⚠ `--overwrite` leert das Zielverzeichnis bis auf `.git` — im Repo-Root würde das `.claude/`
und `.mcp.json` löschen.

## 2. Pakete

```
npm install @babylonjs/core@latest @babylonjs/loaders@latest @babylonjs/materials@latest @babylonjs/gui@latest @babylonjs/addons@latest @babylonjs/havok@latest
npm install --save-dev @babylonjs/inspector@latest
```

- Nur aufnehmen, was gebraucht wird; weitere Framework-Pakete bei Bedarf:
  `@babylonjs/post-processes`, `@babylonjs/procedural-textures`, `@babylonjs/serializers`,
  `@babylonjs/ktx2decoder` (selbst gehostete KTX2-Transcoder, Skill `babylon-assets`).
- Aktualisieren: denselben Befehl mit **allen** installierten `@babylonjs/*`-Framework-Paketen
  ausführen, damit die Versionen gleich bleiben (`npm outdated` zeigt Abweichungen).
- `@babylonjs/inspector` bringt React, Fluent UI und die Node-Editoren als Peer-Abhängigkeiten
  mit — deshalb nur als devDependency und nur per dynamischem Import.

## 3. TypeScript

Die Vorlage setzt u. a. `moduleResolution: "bundler"`, `verbatimModuleSyntax`,
`erasableSyntaxOnly`, `noEmit`, `noUnusedLocals`, `noUnusedParameters` und
`"types": ["vite/client"]`. Ergänzen bzw. beachten:

- `"strict": true` ausdrücklich setzen.
- `verbatimModuleSyntax`: reine Typen mit `import type` importieren.
- `noUncheckedSideEffectImports` ist Standard: Ein vertippter Side-Effect-Import ist ein
  Compile-Fehler.
- TypeScript in der neuesten Version. Wird `typescript-eslint` eingesetzt, dessen
  `peerDependencies` prüfen; reicht die Unterstützung nicht bis zur neuesten Major, die höchste
  unterstützte Version pinnen und den Grund in `package.json` unter `"//"` notieren.

## 4. Vite-Konfiguration

```ts
// vite.config.ts
import { defineConfig } from "vite";

export default defineConfig({
  optimizeDeps: {
    // Havok lädt seine WASM-Datei relativ zum eigenen Modul; Vorbündeln würde den Pfad brechen.
    exclude: ["@babylonjs/havok"],
  },
  server: { host: "127.0.0.1", port: 5173, strictPort: true },
  preview: { host: "127.0.0.1", port: 4173, strictPort: true },
});
```

Warum `127.0.0.1`: Die Loopback-Adresse ist ein sicherer Kontext (WebGPU verfügbar), und der
Firmen-Webfilter fängt den Hostnamen `localhost` ab. `strictPort` hält die URL für Agenten
stabil.

Assets (`.glb`, `.env`, `.ktx2`, `.hdr`) liegen unter `public/` und werden über
`import.meta.env.BASE_URL` adressiert (Skill `babylon-assets`).

## 5. npm-Skripte und Profil-Build

```json
{
  "scripts": {
    "dev": "vite",
    "typecheck": "tsc",
    "build": "tsc && vite build",
    "build:profile": "tsc && vite build --mode profile",
    "preview": "vite preview"
  }
}
```

`tsc` prüft nur (die Vorlage setzt `noEmit`). Der Profil-Build ist ein Produktions-Build mit
Debug-API für Messungen (Skill `babylon-performance`):

```
# .env.profile — Produktions-Build mit aktivierter Debug-API für Leistungsmessungen
VITE_DEBUG_API=true
```

```ts
// src/vite-env.d.ts — ohne import-Anweisungen, damit die Typerweiterung global bleibt
interface ImportMetaEnv {
  /** Aktiviert die Debug-API im Profil-Build. */
  readonly VITE_DEBUG_API?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
```

## 6. Canvas

```html
<!-- index.html (Ausschnitt) -->
<canvas id="renderCanvas"></canvas>
```

```css
html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; }
#renderCanvas { display: block; width: 100%; height: 100%; touch-action: none; }
```

`touch-action: none` überlässt Touch-Gesten dem Spiel.

## 7. Engine-Fabrik

```ts
// src/core/engineFactory.ts
import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";
import { Engine } from "@babylonjs/core/Engines/engine";
import { WebGPUEngine } from "@babylonjs/core/Engines/webgpuEngine";
import { Logger } from "@babylonjs/core/Misc/logger";

/** Erzeugt die Render-Engine: WebGPU bevorzugt, WebGL2 als Rückfallebene. */
export async function createEngine(canvas: HTMLCanvasElement): Promise<AbstractEngine> {
  const forceWebGl = new URLSearchParams(window.location.search).get("engine") === "webgl2";
  if (!forceWebGl && (await WebGPUEngine.IsSupportedAsync)) {
    try {
      // Alle Adapter-Features: Texturkompression (BC/ASTC/ETC2), timestamp-query, Float-Filterung, Dual-Source-Blending.
      const engine = new WebGPUEngine(canvas, {
        antialias: true,
        stencil: true,
        powerPreference: "high-performance",
        enableAllFeatures: true,
        setMaximumLimits: true,
      });
      await engine.initAsync();
      return engine;
    } catch (error) {
      Logger.Warn(`WebGPU nicht verfügbar, nutze WebGL2: ${String(error)}`);
    }
  }
  return new Engine(canvas, true, { stencil: true, powerPreference: "high-performance" });
}
```

- `WebGPUEngine.IsSupportedAsync` ist ein statischer Getter, der ein Promise liefert (ohne
  Klammern aufrufen).
- `EngineFactory.CreateAsync` ist für Spiele ungeeignet: Es registriert nur einen Teil der
  Engine-Erweiterungen und fällt bei einem WebGPU-Fehler nicht auf WebGL2 zurück.
- `adaptToDeviceRatio` ist standardmäßig aus; die Renderauflösung steuern die Qualitätsstufen
  über `engine.setHardwareScalingLevel()` (Skill `babylon-performance`).

## 8. Loader registrieren

```ts
import { registerBuiltInLoaders } from "@babylonjs/loaders/dynamic";

// Registriert glTF, OBJ, STL, FBX, USD, SPLAT, BVH; jeder Lader wird erst beim ersten Gebrauch nachgeladen.
registerBuiltInLoaders();
```

Nur glTF, sofort geladen: `import "@babylonjs/loaders/glTF/2.0";`.
Der Paket-Root-Import `@babylonjs/loaders` bündelt sämtliche Lader.

## 9. Dev-Diagnose

- `SetMissingSideEffectWarningsEnabled(true)` und die Debug-API laufen im Dev-Build
  (siehe [debug-api.md](debug-api.md)).
- Inspector v2 bei Bedarf: `await window.__game.showInspector()` oder direkt
  `ShowInspector(scene, { layoutMode: "overlay" })` aus `@babylonjs/inspector` (dynamisch
  importiert). `scene.debugLayer.show()` funktioniert nach dem Import ebenfalls.
- Babylon-Logzeilen beginnen in der Konsole mit `BJS -`. Shader-Fehler erscheinen als
  `Unable to compile effect`, WebGPU-Validierungsfehler als `WebGPU uncaptured error`.

## 10. Build prüfen

- `npm run build` — der Typecheck ist Teil des Builds.
- In `dist/assets` liegen kein Debug- und kein Inspector-Chunk.
- `npm run preview` zeigt den Produktions-Build unter `http://127.0.0.1:4173/`.
