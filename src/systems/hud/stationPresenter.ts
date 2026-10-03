import { AchievementList } from "../../../shared/achievements";
import { questInfo } from "../../../shared/quests";
import { HoneyPerGoldPollen, HoneyPerPollen, HpPerHoney, MaxUpgradeLevel, UpgradeCosts, Upgrades, type UpgradeLevels } from "../../../shared/rules";
import type { HivePlacement } from "../../../shared/worldgen";
import type { LeaderboardRow, QuestHud, StationHud, UpgradeHud } from "../../hud/hudTypes";
import type { Replica } from "../../net/replica";

const LeaderboardSize = 10;

/** Baut das Stationsmenü des Bienenstocks, in dem die eigene Biene angedockt ist (Stationsmenü). */
export class StationPresenter {
  private readonly hives: readonly HivePlacement[];
  private readonly replica: Replica;

  public constructor(hives: readonly HivePlacement[], replica: Replica) {
    this.hives = hives;
    this.replica = replica;
  }

  public build(hiveId: number, levels: UpgradeLevels, hp: number, maxHp: number): StationHud | undefined {
    const hive = this.hives[hiveId];
    const stats = this.replica.stats;
    const me = this.replica.playerId;
    if (hive === undefined || stats === undefined) {
      return undefined;
    }
    const profile = me === undefined ? undefined : this.replica.profiles.get(me);
    const missing = Math.max(0, maxHp - hp);
    return {
      hiveId,
      hiveName: hive.name,
      isHome: profile?.homeHive === hiveId,
      honeyDelivered: this.replica.hives.get(hiveId)?.honeyDelivered ?? 0,
      cargo: stats.cargo,
      cargoGold: stats.cargoGold,
      depositValue: stats.cargo * HoneyPerPollen + stats.cargoGold * HoneyPerGoldPollen,
      honey: stats.honey,
      hp,
      maxHp,
      repairCost: Math.ceil(missing / HpPerHoney),
      upgrades: this.upgrades(levels, stats.honey),
      quests: this.quests(),
      leaderboard: this.leaderboard(me),
      achievements: AchievementList.map((achievement) => ({
        key: achievement.key,
        title: achievement.title,
        description: achievement.description,
        earned: (stats.achievements & achievement.bit) !== 0,
      })),
    };
  }

  private upgrades(levels: UpgradeLevels, honey: number): UpgradeHud[] {
    return Upgrades.map((upgrade) => {
      const level = levels[upgrade.kind];
      const cost = level < MaxUpgradeLevel ? UpgradeCosts[level] : undefined;
      return {
        kind: upgrade.kind,
        title: upgrade.title,
        effect: upgrade.effect,
        level,
        maxLevel: MaxUpgradeLevel,
        cost,
        affordable: cost !== undefined && honey >= cost,
      };
    });
  }

  /** Freigeschaltete Quests; erledigte Einmal-Quests stehen am Ende. */
  private quests(): QuestHud[] {
    const rows: QuestHud[] = [];
    for (const row of this.replica.quests) {
      const info = questInfo(row.questId);
      if (info === undefined) {
        continue;
      }
      const completed = !info.repeatable && row.completions > 0;
      rows.push({
        id: info.id,
        title: info.title,
        brief: info.brief,
        progress: completed ? info.goal : row.progress,
        goal: info.goal,
        reward: info.reward,
        completed,
        repeatable: info.repeatable,
        completions: row.completions,
      });
    }
    return rows.sort((a, b) => Number(a.completed) - Number(b.completed) || a.id - b.id);
  }

  private leaderboard(me: number | undefined): LeaderboardRow[] {
    return [...this.replica.scores.values()]
      .sort((a, b) => b.honeyTotal - a.honeyTotal || b.kills - a.kills)
      .slice(0, LeaderboardSize)
      .map((score, index) => ({
        rank: index + 1,
        name: this.replica.nameOf(score.playerId),
        honey: score.honeyTotal,
        kills: score.kills,
        isSelf: score.playerId === me,
      }));
  }
}
