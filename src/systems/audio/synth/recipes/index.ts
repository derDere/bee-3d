// src/systems/audio/synth/recipes/index.ts — alle Klangrezepte des Tonsystems.
import { CombatRecipes } from "./combat";
import { CreatureRecipes } from "./creatures";
import { EventRecipes } from "./events";
import { InstrumentRecipes } from "./instruments";
import type { SoundRecipe } from "./recipeTypes";
import { UiRecipes } from "./ui";
import { WeatherRecipes } from "./weather";

/** Alle Rezepte in Erzeugungsreihenfolge (Rezeptliste). */
export const AllRecipes: readonly SoundRecipe[] = [
  ...CreatureRecipes,
  ...CombatRecipes,
  ...EventRecipes,
  ...WeatherRecipes,
  ...UiRecipes,
  ...InstrumentRecipes,
];
