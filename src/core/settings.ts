import { isQualityTier, type QualityTier } from "./quality";

/** Persistente Spieleinstellungen (Einstellungen). */
export interface GameSettings {
  readonly version: 1;
  quality: QualityTier | "auto";
  masterVolume: number;
  musicVolume: number;
  invertY: boolean;
  mouseSensitivity: number;
  reduceFlashes: boolean;
  /** Größe der Oberfläche als Faktor (1 = Grundgröße). */
  uiScale: number;
  playerName: string;
}

const DefaultSettings: GameSettings = {
  version: 1,
  quality: "auto",
  masterVolume: 0.8,
  musicVolume: 0.5,
  invertY: false,
  mouseSensitivity: 1,
  reduceFlashes: false,
  uiScale: 1,
  playerName: "",
};

/** Liest und schreibt Einstellungen versioniert im localStorage; bei Fehlern gelten Standardwerte. */
export class SettingsStore {
  private readonly storageKey: string;
  private current: GameSettings;

  public constructor(storageKey = "bee3d:settings") {
    this.storageKey = storageKey;
    this.current = this.load();
  }

  public get value(): GameSettings {
    return this.current;
  }

  /** Übernimmt Änderungen und speichert sie. */
  public update(changes: Partial<Omit<GameSettings, "version">>): GameSettings {
    this.current = { ...this.current, ...changes };
    try {
      window.localStorage.setItem(this.storageKey, JSON.stringify(this.current));
    } catch {
      // Speicher voll oder blockiert (privater Modus): Einstellungen gelten nur für diese Sitzung
    }
    return this.current;
  }

  private load(): GameSettings {
    try {
      const raw = window.localStorage.getItem(this.storageKey);
      if (!raw) {
        return { ...DefaultSettings };
      }
      const parsed = JSON.parse(raw) as Partial<GameSettings>;
      if (parsed.version !== DefaultSettings.version) {
        return { ...DefaultSettings };
      }
      const merged = { ...DefaultSettings, ...parsed };
      return { ...merged, quality: merged.quality === "auto" || isQualityTier(merged.quality) ? merged.quality : "auto" };
    } catch {
      return { ...DefaultSettings };
    }
  }
}
