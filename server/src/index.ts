// server/src/index.ts — Einstieg des SpacetimeDB-Moduls bee-world.
// Das Schema ist der Default-Export; benannte Exporte sind ausschließlich Modulfunktionen
// (Reducer, Lebenszyklus, Views, Prozeduren) — ihr Name wird zum Funktionsnamen (snake_case).
import { t } from "spacetimedb/server";
import { ProtocolVersion } from "../../shared/protocol";
import spacetimedb from "./schema";

export default spacetimedb;

/** Liefert die Protokollversion des Moduls; Name, Parameter und Rückgabetyp bleiben für immer gleich (Versionsabgleich). */
export const protocolVersion = spacetimedb.procedure(t.u32(), () => ProtocolVersion);

export { init, seedDemo, setWeather, syncWorld } from "./admin";
export { activateModule, deactivateModule } from "./combat";
export { buyUpgrade, deposit, dock, repair, setHomeHive, undock } from "./hives";
export { beginWarp, buzz, join, onConnect, onDisconnect, reportPose, setName } from "./players";
export { worldTick } from "./tick";
export { myModules, myQuests, myStats } from "./views";
