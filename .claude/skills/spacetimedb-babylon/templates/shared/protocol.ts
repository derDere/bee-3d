// shared/protocol.ts — Protokollversion, gemeinsam genutzt von SpacetimeDB-Modul und Browser-Client.

/**
 * Wird erhöht, sobald Clients mit älterem Code das neue Modul nicht mehr korrekt nutzen können:
 * geänderte oder entfernte Reducer, abonnierte Tabellen oder Spalten, geänderte Bedeutung von Werten
 * (Protokollversion). Ein Client mit anderer Version lädt neu, statt sich wieder zu verbinden.
 */
export const ProtocolVersion = 1;
