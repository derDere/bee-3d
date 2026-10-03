// server/src/access.ts — Zugangsregeln: Verbindungsprüfung, Betreiberrechte, Spieler des Aufrufers.
import { SenderError } from "spacetimedb/server";
import type { Ctx } from "./schema";

/** Vertrauenswürdige OIDC-Aussteller mit erwarteter Audience; leer = nur Gäste und Betreiber. */
const TrustedIssuers: ReadonlyArray<{ readonly issuer: string; readonly audience: string }> = [];
/** Vom Server ausgestellte anonyme Identitäten (iss "localhost") zulassen. */
const AllowGuests = true;

/** Ob der Aufrufer der Betreiber ist (die Identität, die das Modul zuerst veröffentlicht hat). */
export function isOwner(ctx: Ctx): boolean {
  const owner = ctx.db.config.id.find(0)?.owner;
  return owner !== undefined && owner.isEqual(ctx.sender);
}

/** Bricht ab, wenn der Aufrufer nicht der Betreiber ist (Betreiberrecht). */
export function requireOwner(ctx: Ctx): void {
  if (!isOwner(ctx)) {
    throw new SenderError("owner only");
  }
}

/** Lehnt Verbindungen ab, deren Token nicht von uns oder einem vertrauenswürdigen Aussteller stammt (Zugangsprüfung). */
export function assertTrustedCaller(ctx: Ctx): void {
  if (isOwner(ctx)) {
    return; // Betreiber-Werkzeuge (CLI, MCP)
  }
  const jwt = ctx.senderAuth.jwt;
  if (jwt === null) {
    throw new SenderError("token required");
  }
  if (jwt.issuer === "localhost") {
    if (!AllowGuests) {
      throw new SenderError("guest access disabled");
    }
    return;
  }
  const trusted = TrustedIssuers.some((entry) => entry.issuer === jwt.issuer && jwt.audience.includes(entry.audience));
  if (!trusted) {
    throw new SenderError("untrusted token");
  }
}

/** Kompakte Spieler-ID des Aufrufers (Spieler-ID). */
export function requirePlayerId(ctx: Ctx): number {
  const entry = ctx.db.account.identity.find(ctx.sender);
  if (!entry) {
    throw new SenderError("join first");
  }
  return entry.playerId;
}

/** Prüft eine Gleitkommazahl auf Endlichkeit (Zahlprüfung). */
export function requireFinite(...values: readonly number[]): void {
  for (const value of values) {
    if (!Number.isFinite(value)) {
      throw new SenderError("number not finite");
    }
  }
}
