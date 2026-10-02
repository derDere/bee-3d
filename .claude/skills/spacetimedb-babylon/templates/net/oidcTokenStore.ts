// src/net/oidcTokenStore.ts — Token-Speicher für Konten eines OIDC-Anbieters.
import type { TokenStore } from './spacetimeSession';

/** Aktuelles ID-Token des OIDC-Anbieters; die OIDC-Bibliothek erneuert es still im Hintergrund (ID-Token-Quelle). */
export interface IdTokenSource {
  current(): string | undefined;
  /** Startet die Anmeldung neu, z. B. nach einem abgelaufenen oder abgelehnten Token. */
  requestSignIn(): void;
}

/** Liefert bei jedem (Wieder-)Verbinden das frische ID-Token; SpacetimeDB speichert nichts selbst (OIDC-Token). */
export class OidcTokenStore implements TokenStore {
  private readonly source: IdTokenSource;

  public constructor(source: IdTokenSource) {
    this.source = source;
  }

  public load(): string | undefined {
    return this.source.current();
  }

  public save(_token: string): void {
    // Das Token gehört dem Anbieter; die Sitzung meldet hier nur zurück, womit sie verbunden ist.
  }

  public clear(): void {
    this.source.requestSignIn();
  }
}
