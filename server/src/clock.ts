// server/src/clock.ts — Zeitbezug des Moduls: Taktnummer, Weltsekunden, Millisekunden.
import { TickSeconds } from "../../shared/world";
import type { Ctx } from "./schema";

const TickMicros = TickSeconds * 1_000_000;

/** Weltbeginn in Mikrosekunden (aus config; vor init der Transaktionszeitpunkt). */
function epochMicros(ctx: Ctx): bigint {
  return ctx.db.config.id.find(0)?.epochMicros ?? ctx.timestamp.microsSinceUnixEpoch;
}

/**
 * Taktnummer seit Weltbeginn, aus der Zeit abgeleitet statt je Takt gespeichert (Taktnummer): ein
 * Takt ohne Änderungen schreibt so nichts ins Commit-Log.
 */
export function currentTick(ctx: Ctx): number {
  return Math.round(Number(ctx.timestamp.microsSinceUnixEpoch - epochMicros(ctx)) / TickMicros);
}

/** Sekunden seit Weltbeginn (Weltsekunden) — Grundlage für Tageszeit, Wetter, Nachwachsen, Energie. */
export function worldSeconds(ctx: Ctx): number {
  return Number(ctx.timestamp.microsSinceUnixEpoch - epochMicros(ctx)) / 1_000_000;
}

/** Transaktionszeit in Millisekunden seit 1970 (für Abklingzeiten und Zyklen). */
export function nowMs(ctx: Ctx): bigint {
  return ctx.timestamp.microsSinceUnixEpoch / 1000n;
}

/** Millisekunden als bigint aus Sekunden. */
export function secondsToMs(seconds: number): bigint {
  return BigInt(Math.round(seconds * 1000));
}
