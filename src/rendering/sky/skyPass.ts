import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";
import type { Effect } from "@babylonjs/core/Materials/effect";
import { EffectRenderer, EffectWrapper } from "@babylonjs/core/Materials/effectRenderer";
import type { Matrix } from "@babylonjs/core/Maths/math.vector";
import { FullscreenVertexShader } from "./shaders/fullscreenVertex";

/** Ein Dreieck über den ganzen Bildschirm wie im Atmosphäre-Addon (Vollbild-Renderer der Himmelspässe). */
export function createSkyPassRenderer(engine: AbstractEngine): EffectRenderer {
  return new EffectRenderer(engine, { indices: [0, 2, 1], positions: [-1, -1, -1, 3, 3, -1] });
}

/**
 * Vollbildpass der Himmelsdarstellung (Himmelspass): gemeinsamer Vertex-Shader mit Sichtstrahl `vRay` und
 * Bildkoordinate `vUV`, GLSL-Quelltext ohne ShaderStore.
 */
export function createSkyPass(engine: AbstractEngine, name: string, fragmentShader: string, uniforms: readonly string[], samplers: readonly string[], defines: readonly string[]): EffectWrapper {
  return new EffectWrapper({
    engine,
    name,
    vertexShader: FullscreenVertexShader,
    fragmentShader,
    attributeNames: ["position"],
    uniformNames: ["inverseViewProjectionNoTranslation", "nearNdc", ...uniforms],
    samplerNames: [...samplers],
    defines: defines.map((define) => `#define ${define}`),
    useShaderStore: false,
  });
}

/** Setzt die Uniforms des gemeinsamen Vertex-Shaders (Sichtstrahl aus der Drehungs-Projektion). */
export function bindSkyPassView(effect: Effect, engine: AbstractEngine, inverseViewProjectionNoTranslation: Matrix): void {
  effect.setMatrix("inverseViewProjectionNoTranslation", inverseViewProjectionNoTranslation);
  effect.setFloat("nearNdc", engine.isNDCHalfZRange ? 0 : -1);
}
