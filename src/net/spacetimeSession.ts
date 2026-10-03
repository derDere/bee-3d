// src/net/spacetimeSession.ts — Verbindungslebenszyklus zu SpacetimeDB mit automatischem Wiederverbinden.
// Umgebungsneutral (Browser und Node-Bots): kein Zugriff auf DOM oder localStorage.
import type { Identity } from "spacetimedb";
import { DbConnection, type ErrorContext } from "./bindings";

/** Speichert das langlebige SpacetimeDB-Token eines Spielers (Token-Speicher). */
export interface TokenStore {
  load(): string | undefined;
  save(token: string): void;
  clear(): void;
}

/** Hält das Token nur im Speicher, z. B. für Lasttest-Bots (Speicher-Token). */
export class MemoryTokenStore implements TokenStore {
  private token: string | undefined;

  public load(): string | undefined {
    return this.token;
  }

  public save(token: string): void {
    this.token = token;
  }

  public clear(): void {
    this.token = undefined;
  }
}

/** Verbindungsparameter einer Datenbank (Sitzungsoptionen). */
export interface SessionOptions {
  readonly uri: string;
  readonly database: string;
  readonly confirmedReads: boolean;
  readonly compression: "gzip" | "brotli" | "none";
}

/** Ereignisse, die das Spiel von der Sitzung erhält (Sitzungsereignisse). */
export interface SessionListener {
  /** Eine neue Verbindung steht; hier Zeilen-Callbacks und Abos registrieren. */
  onReady(connection: DbConnection, identity: Identity): void;
  /** Die Verbindung ist weg oder kam nicht zustande; die Sitzung verbindet selbst neu. */
  onLost(error: Error | undefined): void;
  /** Der Server hat das gespeicherte Token abgelehnt; es wurde gelöscht. */
  onTokenRejected(): void;
}

/** Besitzt die DbConnection und baut sie bei Abbruch mit exponentiellem Backoff neu auf (Verbindungssitzung). */
export class SpacetimeSession {
  private static readonly BaseDelayMs = 1_000;
  private static readonly MaxDelayMs = 30_000;

  private readonly options: SessionOptions;
  private readonly tokens: TokenStore;
  private readonly listener: SessionListener;
  private pending: DbConnection | undefined;
  private current: DbConnection | undefined;
  private attempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private stopped = true;

  public constructor(options: SessionOptions, tokens: TokenStore, listener: SessionListener) {
    this.options = options;
    this.tokens = tokens;
    this.listener = listener;
  }

  /** Die aktive Verbindung oder undefined während des (Wieder-)Verbindens. */
  public get connection(): DbConnection | undefined {
    return this.current;
  }

  /** Öffnet die erste Verbindung. */
  public start(): void {
    this.stopped = false;
    this.connect();
  }

  /** Schließt die Verbindung und bricht geplante Wiederverbindungen ab. */
  public stop(): void {
    this.stopped = true;
    this.clearTimer();
    for (const connection of [this.current, this.pending]) {
      if (connection?.isActive) {
        connection.disconnect();
      }
    }
    this.current = undefined;
    this.pending = undefined;
  }

  /**
   * Prüft die Verbindung sofort, z. B. wenn der Tab wieder sichtbar wird oder das Netz zurück ist:
   * ersetzt einen still gestorbenen Socket und zieht eine wartende Wiederverbindung vor.
   */
  public resumeNow(): void {
    if (this.stopped) {
      return;
    }
    if (this.current !== undefined && this.current.isSocketClosed) {
      this.current = undefined; // Socket starb im eingefrorenen Tab, ohne onclose
      this.listener.onLost(undefined);
    }
    if (this.current === undefined && this.pending === undefined) {
      this.clearTimer();
      this.attempt = 0;
      this.connect();
    }
  }

  private connect(): void {
    // Die Callbacks laufen asynchron nach build(); bis dahin ist `built` belegt.
    const built: DbConnection = DbConnection.builder()
      .withUri(this.options.uri)
      .withDatabaseName(this.options.database)
      .withToken(this.tokens.load())
      .withConfirmedReads(this.options.confirmedReads)
      .withCompression(this.options.compression)
      .onConnect((connection: DbConnection, identity: Identity, token: string) => {
        if (this.stopped || connection !== this.pending) {
          connection.disconnect(); // veraltete Verbindung aus einem früheren Versuch
          return;
        }
        this.pending = undefined;
        this.current = connection;
        this.attempt = 0;
        this.tokens.save(token); // das SDK liefert das langlebige Token, nie das kurzlebige WebSocket-Token
        this.listener.onReady(connection, identity);
      })
      .onConnectError((_ctx: ErrorContext, error: Error) => {
        if (built !== this.pending) {
          return;
        }
        this.pending = undefined;
        this.listener.onLost(error);
        if (error.message.startsWith("Failed to verify token")) {
          // Das SDK meldet jeden Fehler beim Token-Tausch so, auch 502/503 eines neu startenden Servers.
          // Gelöscht wird nur bei echter Ablehnung, sonst ginge der Fortschritt eines Gastes verloren.
          void this.isTokenRejected().then((rejected) => {
            if (rejected) {
              this.tokens.clear();
              this.listener.onTokenRejected();
            }
            this.scheduleReconnect();
          });
          return;
        }
        this.scheduleReconnect();
      })
      .onDisconnect((_ctx: ErrorContext, error?: Error) => {
        if (built !== this.current) {
          return; // bereits ersetzte Verbindung
        }
        this.current = undefined;
        this.listener.onLost(error);
        this.scheduleReconnect();
      })
      .build();
    this.pending = built;
  }

  /** Fragt den Token-Tausch selbst an: nur 401/403 heißt „Token abgelehnt“; 5xx, 429 und Netzfehler sind vorübergehend. */
  private async isTokenRejected(): Promise<boolean> {
    const token = this.tokens.load();
    if (token === undefined) {
      return false;
    }
    const url = new URL("v1/identity/websocket-token", this.options.uri.endsWith("/") ? this.options.uri : `${this.options.uri}/`);
    url.protocol = url.protocol === "wss:" ? "https:" : "http:";
    try {
      const response = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${token}` } });
      return response.status === 401 || response.status === 403;
    } catch {
      return false;
    }
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer !== undefined) {
      return;
    }
    const ceiling = Math.min(SpacetimeSession.BaseDelayMs * 2 ** this.attempt, SpacetimeSession.MaxDelayMs);
    const delay = ceiling / 2 + Math.random() * (ceiling / 2); // Jitter verteilt Wiederverbindungswellen
    this.attempt++;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      if (!this.stopped && this.current === undefined && this.pending === undefined) {
        this.connect();
      }
    }, delay);
  }

  private clearTimer(): void {
    if (this.reconnectTimer !== undefined) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
  }
}
