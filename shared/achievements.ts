// shared/achievements.ts — Erfolge als Bitmaske in player_stats.achievements (Erfolge).

/** Ein Erfolg (Erfolg). */
export interface AchievementInfo {
  /** Schlüssel für Symbol und Anzeige. */
  readonly key: string;
  readonly bit: number;
  readonly title: string;
  readonly description: string;
}

export const Achievements = {
  firstSting: { key: "firstSting", bit: 1 << 0, title: "First Sting", description: "Defeated your first fly." },
  pollenRoyalty: { key: "pollenRoyalty", bit: 1 << 1, title: "Pollen Royalty", description: "Collected 1,000 pollen." },
  ghostHour: { key: "ghostHour", bit: 1 << 2, title: "Ghost Hour", description: "Flew through the night as a ghost." },
  exterminator: { key: "exterminator", bit: 1 << 3, title: "Exterminator", description: "Defeated 100 flies." },
  stormRunner: { key: "stormRunner", bit: 1 << 4, title: "Storm Runner", description: "Touched the cloud rim of the world." },
  queenSlayer: { key: "queenSlayer", bit: 1 << 5, title: "Queen Slayer", description: "Defeated the Fly Queen." },
  goldDigger: { key: "goldDigger", bit: 1 << 6, title: "Gold Digger", description: "Collected your first gold pollen." },
  globetrotter: { key: "globetrotter", bit: 1 << 7, title: "Globetrotter", description: "Docked at all nine hives." },
} as const satisfies Record<string, AchievementInfo>;

export const AchievementList: readonly AchievementInfo[] = Object.values(Achievements);
