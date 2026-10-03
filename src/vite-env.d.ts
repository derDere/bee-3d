// Typen der Vite-Umgebungsvariablen — ohne import-Anweisungen, damit die Erweiterung global bleibt.

interface ImportMetaEnv {
  /** Aktiviert die Debug-API im Profil-Build. */
  readonly VITE_DEBUG_API?: string;
  /** WebSocket-Adresse des SpacetimeDB-Servers; leer = gleicher Host unter /stdb/. */
  readonly VITE_SPACETIMEDB_HOST?: string;
  /** Name der Weltdatenbank. */
  readonly VITE_SPACETIMEDB_DB_NAME?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
