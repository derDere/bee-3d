// src/net/browserSession.ts — Browser-Teile der Sitzung: Token im localStorage und Seiten-Lebenszyklus.
import type { TokenStore } from "./spacetimeSession";

/** Alles, was eine Verbindung sofort prüfen kann: SpacetimeSession oder NetClient (Wiederaufnahme). */
export interface Resumable {
  resumeNow(): void;
}

/** Hält das Token je Server und Datenbank im localStorage; ohne Speicher gilt es nur für diese Sitzung (Browser-Token). */
export class BrowserTokenStore implements TokenStore {
  private readonly key: string;
  private fallback: string | undefined;

  public constructor(uri: string, database: string) {
    this.key = `spacetimedb:${uri}:${database}:token`;
  }

  public load(): string | undefined {
    try {
      return window.localStorage.getItem(this.key) ?? this.fallback;
    } catch {
      return this.fallback; // privater Modus oder blockierter Speicher
    }
  }

  public save(token: string): void {
    this.fallback = token;
    try {
      window.localStorage.setItem(this.key, token);
    } catch {
      // Speicher nicht verfügbar: Token bleibt bis zum Neuladen im Speicher
    }
  }

  public clear(): void {
    this.fallback = undefined;
    try {
      window.localStorage.removeItem(this.key);
    } catch {
      // nichts zu tun
    }
  }
}

/**
 * Prüft die Verbindung, sobald die Seite zurückkehrt (sichtbar, Fokus, online, aus dem bfcache);
 * eingefrorene Tabs verlieren Sockets oft ohne onclose (Seiten-Lebenszyklus).
 * @returns Funktion, die alle Listener wieder entfernt.
 */
export function bindPageLifecycle(session: Resumable): () => void {
  const resume = (): void => session.resumeNow();
  const onVisibility = (): void => {
    if (document.visibilityState === "visible") {
      resume();
    }
  };
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("focus", resume);
  window.addEventListener("online", resume);
  window.addEventListener("pageshow", resume);
  return () => {
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("focus", resume);
    window.removeEventListener("online", resume);
    window.removeEventListener("pageshow", resume);
  };
}
