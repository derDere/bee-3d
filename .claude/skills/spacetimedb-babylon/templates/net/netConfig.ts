// src/net/netConfig.ts — Verbindungsziel aus der Vite-Umgebung (Netzkonfiguration).
import type { SessionOptions } from './spacetimeSession';

/** Vite-Variablen der Netzschicht; ohne Angabe gilt derselbe Host unter /stdb/ (Produktion hinter dem Proxy). */
export interface NetEnv {
  readonly VITE_SPACETIMEDB_HOST?: string;
  readonly VITE_SPACETIMEDB_DB_NAME?: string;
}

/** Baut die Sitzungsoptionen des Spiels, z. B. `resolveSessionOptions(import.meta.env, window.location)`. */
export function resolveSessionOptions(env: NetEnv, location: Pick<Location, 'protocol' | 'host'>): SessionOptions {
  const sameOrigin = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/stdb/`;
  return {
    uri: env.VITE_SPACETIMEDB_HOST || sameOrigin, // leerer Wert in .env zählt als nicht gesetzt
    database: env.VITE_SPACETIMEDB_DB_NAME || 'bee-world',
    confirmedReads: false, // Bewegung verträgt nach einem Serverabsturz verlorene Zeilen
    compression: 'none', // kleine Updates: gleiche Bytes, weniger Server-CPU
  };
}
