// server/src/views.ts — Views je Aufrufer: eigener Spielerstand, eigene Module, eigene Quests.
// Private Tabellen erreichen so nur ihren Besitzer; jede Zeile trägt einen Primärschlüssel (onUpdate im Client).
import { t } from "spacetimedb/server";
import spacetimedb, { playerStatsColumns } from "./schema";

const MyStatsRow = t.row("MyStatsRow", playerStatsColumns);

const MyModuleRow = t.row("MyModuleRow", {
  id: t.u64().primaryKey(),
  slot: t.u8(),
  targetKind: t.u8(),
  targetId: t.u32(),
  nextCycleAtMs: t.u64(),
  stopAfterCycle: t.bool(),
});

const MyQuestRow = t.row("MyQuestRow", {
  id: t.u64().primaryKey(),
  questId: t.u16(),
  progress: t.u32(),
  completions: t.u16(),
});

/** Eigener Spielerstand (Honig, Ladung, Energie, Upgrades). */
export const myStats = spacetimedb.view({ name: "my_stats", public: true }, t.array(MyStatsRow), (ctx) => {
  const entry = ctx.db.account.identity.find(ctx.sender);
  if (!entry) {
    return [];
  }
  const stats = ctx.db.playerStats.playerId.find(entry.playerId);
  return stats ? [stats] : [];
});

/** Eigene laufende Module. */
export const myModules = spacetimedb.view({ name: "my_modules", public: true }, t.array(MyModuleRow), (ctx) => {
  const entry = ctx.db.account.identity.find(ctx.sender);
  if (!entry) {
    return [];
  }
  return Array.from(ctx.db.moduleActivation.playerId.filter(entry.playerId)).map((row) => ({
    id: row.id,
    slot: row.slot,
    targetKind: row.targetKind,
    targetId: row.targetId,
    nextCycleAtMs: row.nextCycleAtMs,
    stopAfterCycle: row.stopAfterCycle,
  }));
});

/** Eigene Quests mit Fortschritt. */
export const myQuests = spacetimedb.view({ name: "my_quests", public: true }, t.array(MyQuestRow), (ctx) => {
  const entry = ctx.db.account.identity.find(ctx.sender);
  if (!entry) {
    return [];
  }
  return Array.from(ctx.db.questProgress.playerId.filter(entry.playerId)).map((row) => ({
    id: row.id,
    questId: row.questId,
    progress: row.progress,
    completions: row.completions,
  }));
});
