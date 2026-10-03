import { Scene } from "@babylonjs/core/scene";
import { AnimationControl } from "./animationControl";
import { ContactSheet } from "./contactSheet";
import { DebugModes } from "./debugModes";
import { createEngine } from "./engineFactory";
import { LabController, renderFrames } from "./labApi";
import { collectStats } from "./modelStats";
import { computeBounds, loadModel } from "./modelLoader";
import { Overlay } from "./overlay";
import { readParams } from "./params";
import { Studio } from "./studio";

async function main(): Promise<void> {
  const params = readParams(window.location.search);
  const controller = new LabController(params.backend);
  window.__lab = controller;

  try {
    if (!params.modelUrl) throw new Error("URL-Parameter ?model=<url> fehlt.");
    const canvas = document.getElementById("lab-canvas") as HTMLCanvasElement;
    const overlayHost = document.getElementById("lab-overlay") as HTMLElement;

    const { engine, backend } = await createEngine(canvas, params.backend);
    const scene = new Scene(engine);
    // Rechtshändig: Modell bleibt in glTF-Koordinaten (+Y oben, +Z vorne), keine Spiegelung.
    scene.useRightHandedSystem = true;

    const model = await loadModel(scene, params.modelUrl);

    // Pose zuerst setzen, damit Box, Kameras und Raster zur sichtbaren Haltung passen.
    const animation = new AnimationControl(model.container.animationGroups);
    animation.setTime(params.animationName, params.animationTime);
    const bounds = computeBounds(model.meshes);

    const studio = new Studio(scene, bounds);
    studio.addShadowCasters(model.meshes);

    const debug = new DebugModes(scene, model.meshes);
    debug.set(params.debug);

    const stats = collectStats(model, bounds);
    const overlay = new Overlay(overlayHost);
    const sheet = new ContactSheet(
      scene,
      engine,
      bounds,
      { point: params.focus, size: params.focusSize, direction: params.focusDirection },
      overlay,
    );
    const [sx, sy, sz] = stats.boundingBox.size;
    const animationText = stats.animations.length > 0
      ? `anim ${params.animationName ?? "*"} t=${params.animationTime}s`
      : "no anim";
    sheet.setHeader(
      `${params.modelUrl.split("/").pop()} | bbox ${sx} x ${sy} x ${sz} m (X,Y,Z) | grid ${studio.gridStep} m | ` +
        `${stats.triangles} tris | ${animationText} | ${backend}`,
    );
    sheet.setView(params.view);

    engine.runRenderLoop(() => scene.render());
    await renderFrames(scene, 3);
    controller.markReady({
      backend, engine, scene, sheet, debug, animation, stats: () => stats,
    });
  } catch (error) {
    controller.markError(error instanceof Error ? error.message : String(error));
    console.error("[lab]", error);
  }
}

void main();
