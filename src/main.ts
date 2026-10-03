import "./style.css";
import { createEngine } from "./core/engineFactory";
import { Game } from "./core/game";

/** Einstieg: Canvas, Engine, Spiel; im Dev- und Profil-Build zusätzlich die Debug-API. */
async function main(): Promise<void> {
  const canvas = document.getElementById("renderCanvas");
  if (!(canvas instanceof HTMLCanvasElement)) {
    throw new Error("Canvas #renderCanvas is missing.");
  }
  const hudRoot = document.getElementById("hud");
  if (!(hudRoot instanceof HTMLElement)) {
    throw new Error("HUD container #hud is missing.");
  }
  const engine = await createEngine(canvas);
  const game = await Game.createAsync(engine, hudRoot);
  if (import.meta.env.DEV || import.meta.env.VITE_DEBUG_API === "true") {
    const { installDebugApi } = await import("./debug/debugApi");
    installDebugApi(game);
  }
  game.start();
}

void main().catch((error: unknown) => {
  console.error(error);
  const message = document.createElement("pre");
  message.className = "fatal";
  message.textContent = `Bee3D could not start:\n${String(error)}`;
  document.body.appendChild(message);
});
