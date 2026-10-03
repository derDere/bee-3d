import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";
import { Engine } from "@babylonjs/core/Engines/engine";
import { WebGPUEngine } from "@babylonjs/core/Engines/webgpuEngine";
import { WebGPUTintWASM } from "@babylonjs/core/Engines/WebGPU/webgpuTintWASM";
import { MeshoptCompression } from "@babylonjs/core/Meshes/Compression/meshoptCompression";
import { Logger } from "@babylonjs/core/Misc/logger";

const Base = import.meta.env.BASE_URL;

/** Selbst gehostete Übersetzer für GLSL-Shader unter WebGPU (glslang → SPIR-V, twgsl → WGSL). */
const GlslangOptions = { jsPath: `${Base}babylon/glslang/glslang.js`, wasmPath: `${Base}babylon/glslang/glslang.wasm` };
const TwgslOptions = { jsPath: `${Base}babylon/twgsl/twgsl.js`, wasmPath: `${Base}babylon/twgsl/twgsl.wasm` };

/** Selbst gehosteter Meshopt-Decoder für die komprimierten Modelle (EXT_meshopt_compression); kein CDN zur Laufzeit. */
export function configureSelfHostedDecoders(): void {
  MeshoptCompression.Configuration = { decoder: { url: `${Base}babylon/meshopt/meshopt_decoder.js` } };
}

/** Erzeugt die Render-Engine: WebGPU bevorzugt, WebGL2 als Rückfallebene (Engine-Fabrik). */
export async function createEngine(canvas: HTMLCanvasElement): Promise<AbstractEngine> {
  configureSelfHostedDecoders();
  const forceWebGl = new URLSearchParams(window.location.search).get("engine") === "webgl2";
  if (!forceWebGl && (await WebGPUEngine.IsSupportedAsync)) {
    try {
      // Alle Adapter-Features: Texturkompression, timestamp-query, Float-Filterung, Dual-Source-Blending.
      const engine = new WebGPUEngine(canvas, {
        antialias: false,
        stencil: true,
        powerPreference: "high-performance",
        enableAllFeatures: true,
        setMaximumLimits: true,
      });
      // Die Wolken-Raymarcher nutzen textureLod in Schleifen; die Gleichförmigkeitsanalyse würde
      // übersetzte GLSL-Shader sonst wegen nicht-uniformer Kontrollflüsse ablehnen.
      WebGPUTintWASM.DisableUniformityAnalysis = true;
      await engine.initAsync(GlslangOptions, TwgslOptions);
      return engine;
    } catch (error) {
      Logger.Warn(`WebGPU nicht verfügbar, nutze WebGL2: ${String(error)}`);
    }
  }
  return new Engine(canvas, false, { stencil: true, powerPreference: "high-performance", preserveDrawingBuffer: false });
}
