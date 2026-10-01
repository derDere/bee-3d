import { Engine } from "@babylonjs/core/Engines/engine";
import { WebGPUEngine } from "@babylonjs/core/Engines/webgpuEngine";
import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";
import type { BackendName } from "./types";

export interface EngineHandle {
  engine: AbstractEngine;
  /** Tatsächlich verwendetes Backend (kann vom gewünschten abweichen). */
  backend: BackendName;
}

/** Erzeugt WebGPU (Standard) oder WebGL2; fällt bei fehlender WebGPU-Unterstützung zurück. */
export async function createEngine(canvas: HTMLCanvasElement, requested: BackendName): Promise<EngineHandle> {
  if (requested === "webgpu" && (await WebGPUEngine.IsSupportedAsync)) {
    const gpuEngine = new WebGPUEngine(canvas, { antialias: true, adaptToDeviceRatio: false });
    await gpuEngine.initAsync();
    return { engine: gpuEngine, backend: "webgpu" };
  }
  // Hardware-Skalierung 1: ein Bildschirmpixel entspricht einem Renderpixel (reproduzierbare Screenshots).
  const glEngine = new Engine(canvas, true, { preserveDrawingBuffer: true }, false);
  return { engine: glEngine, backend: "webgl2" };
}
