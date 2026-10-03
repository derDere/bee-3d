import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { BeeFlags, FlyStates } from "../../../shared/events";
import { IslandCatalog } from "../../../shared/islandCatalog";
import type { FlowerSpecies } from "../../../shared/islandCatalogTypes";
import { ScannerRange, flyInfo, patchPollenAt } from "../../../shared/rules";
import type { WorldLayout } from "../../../shared/worldgen";
import type { WorldIndex } from "../../../shared/worldIndex";
import type { FrameSystem } from "../../core/gameLoop";
import type { CommandTarget, TargetSource } from "../../entities/player/flightController";
import type { EntityRef, EntityType, OverviewTab } from "../../hud/hudTypes";
import type { Replica } from "../../net/replica";

/** Ein Objekt im Raum, das gewählt, aufgeschaltet und angeflogen werden kann (Raumobjekt). */
export interface SpaceObject extends CommandTarget {
  readonly ref: EntityRef;
  readonly key: string;
  readonly position: Vector3;
  readonly velocity: Vector3;
  radius: number;
  name: string;
  typeLabel: string;
  detail: string;
  hostile: boolean;
  hpRatio: number | undefined;
  attackingMe: boolean;
  tabs: readonly OverviewTab[];
  lockable: boolean;
  /** Zuletzt im Frame mit dieser Nummer gesehen. */
  frame: number;
}

/** Schlüssel eines Objektverweises (Objektschlüssel). */
export function refKey(ref: EntityRef): string {
  return `${ref.type}:${ref.id}`;
}

const SpeciesLabels: Readonly<Record<FlowerSpecies, string>> = {
  daisy: "Daisies",
  poppy: "Poppies",
  lupine: "Lupines",
  buttercup: "Buttercups",
  bluebell: "Bluebells",
};

const IslandLabels: Readonly<Record<string, string>> = {
  tiny: "Islet",
  blossom: "Blossom Isle",
  hill: "Hill Isle",
  meadow: "Meadow Isle",
  cliff: "Cliff Isle",
  grove: "Grove Isle",
  terrace: "Terrace Isle",
  lake: "Lake Isle",
  nest: "Rot Isle",
};

const FlyStateLabels: Readonly<Record<number, string>> = {
  [FlyStates.dormant]: "dozing",
  [FlyStates.patrol]: "patrolling",
  [FlyStates.chase]: "attacking",
  [FlyStates.flee]: "fleeing",
  [FlyStates.returnHome]: "heading home",
};

const AllTab: readonly OverviewTab[] = ["all"];
const CombatTabs: readonly OverviewTab[] = ["all", "combat"];
const MiningTabs: readonly OverviewTab[] = ["all", "mining"];
const NavigationTabs: readonly OverviewTab[] = ["all", "navigation"];
const NestTabs: readonly OverviewTab[] = ["all", "combat", "navigation"];

/** Reichweiten der Objektliste je Art in Metern. */
const PatchRange = 900;
const IslandRange = 1600;
const MaxIslands = 30;
const HiveRadius = 9;
const NestRadius = 24;
/** So lange zeigt der Duftscanner entfernte Goldblumen (ms). */
const ScanRevealMs = 60_000;

/** Laufende Quellen, aus denen die Objektliste gespeist wird (Objektquellen). */
export interface SpaceObjectSources {
  readonly layout: WorldLayout;
  readonly world: WorldIndex;
  readonly replica: Replica;
  /** Lage der eigenen Biene. */
  readonly origin: () => Vector3;
  /** Weltsekunden für nachwachsende Blumenfelder. */
  readonly worldSeconds: () => number;
}

/**
 * Objektliste der Umgebung (Raumobjekte): Fliegen, Bienen, Blumenfelder, Bienenstöcke, Nester und Inseln mit
 * Lage, Tempo, Größe und Anzeige-Texten. Wird je Frame aktualisiert; Einträge bleiben als Objekte erhalten,
 * damit Befehle und Aufschaltungen ihnen folgen können.
 */
export class SpaceObjects implements FrameSystem {
  private readonly sources: SpaceObjectSources;
  private readonly objects = new Map<string, SpaceObject>();
  private frame = 0;
  private scanUntilMs = 0;

  public constructor(sources: SpaceObjectSources) {
    this.sources = sources;
  }

  public get(key: string): SpaceObject | undefined {
    return this.objects.get(key);
  }

  public all(): IterableIterator<SpaceObject> {
    return this.objects.values();
  }

  /** Duftscanner: Goldblumen im Umkreis von 2 km erscheinen eine Minute lang in der Objektliste. */
  public revealScan(): void {
    this.scanUntilMs = performance.now() + ScanRevealMs;
  }

  /** Befehlsziel, das dem Objekt folgt und undefined liefert, sobald es verschwunden ist. */
  public source(ref: EntityRef): TargetSource {
    const key = refKey(ref);
    return () => this.objects.get(key);
  }

  public frameUpdate(): void {
    this.frame++;
    const origin = this.sources.origin();
    this.updateFlies();
    this.updateBees();
    this.updatePatches(origin);
    this.updateStatic(origin);
    for (const [key, object] of this.objects) {
      if (object.frame !== this.frame) {
        this.objects.delete(key);
      }
    }
  }

  private upsert(type: EntityType, id: number): SpaceObject {
    const key = `${type}:${id}`;
    let object = this.objects.get(key);
    if (object === undefined) {
      object = {
        ref: { type, id },
        key,
        position: new Vector3(),
        velocity: new Vector3(),
        radius: 1,
        name: "",
        typeLabel: "",
        detail: "",
        hostile: false,
        hpRatio: undefined,
        attackingMe: false,
        tabs: AllTab,
        lockable: false,
        frame: this.frame,
      };
      this.objects.set(key, object);
    }
    object.frame = this.frame;
    return object;
  }

  private updateFlies(): void {
    const me = this.sources.replica.playerId;
    this.sources.replica.flies.forEach((flyId, pose, row) => {
      const info = flyInfo(row.kind);
      const object = this.upsert("fly", flyId);
      object.position.set(pose.x, pose.y, pose.z);
      object.velocity.set(pose.vx, pose.vy, pose.vz);
      object.radius = info.length * 0.5;
      object.name = info.title;
      object.typeLabel = row.kind === 2 ? "Boss" : "Fly";
      object.detail = `${FlyStateLabels[row.state] ?? ""} · ${row.hp}/${info.maxHp} HP`;
      object.hostile = true;
      object.hpRatio = row.hp / info.maxHp;
      object.attackingMe = me !== undefined && row.target === me && row.state === FlyStates.chase;
      object.tabs = CombatTabs;
      object.lockable = true;
    });
  }

  private updateBees(): void {
    const replica = this.sources.replica;
    replica.bees.forEach((playerId, pose, row) => {
      if ((row.flags & BeeFlags.docked) !== 0) {
        return;
      }
      const ghost = (row.flags & BeeFlags.ghost) !== 0;
      const object = this.upsert("bee", playerId);
      object.position.set(pose.x, pose.y, pose.z);
      object.velocity.set(pose.vx, pose.vy, pose.vz);
      object.radius = 0.15;
      object.name = replica.nameOf(playerId);
      object.typeLabel = ghost ? "Ghost" : "Bee";
      object.detail = ghost ? "on the way home" : `${row.hp}/${row.maxHp} HP`;
      object.hostile = false;
      object.hpRatio = row.maxHp > 0 ? row.hp / row.maxHp : undefined;
      object.attackingMe = false;
      object.tabs = AllTab;
      object.lockable = true;
    });
  }

  private updatePatches(origin: Vector3): void {
    const replica = this.sources.replica;
    const now = this.sources.worldSeconds();
    const scanning = performance.now() < this.scanUntilMs;
    for (const patch of this.sources.world.patchesNear(origin.x, origin.y, origin.z, scanning ? ScannerRange : PatchRange)) {
      if (!patch.golden && Math.hypot(patch.x - origin.x, patch.y - origin.y, patch.z - origin.z) > PatchRange) {
        continue;
      }
      const object = this.upsert("flowerPatch", patch.id);
      object.position.set(patch.x, patch.y, patch.z);
      object.velocity.setAll(0);
      object.radius = patch.radius;
      object.name = patch.golden ? `${SpeciesLabels[patch.species]} (Gold Pollen)` : SpeciesLabels[patch.species];
      object.typeLabel = "Flower Patch";
      const row = replica.patches.get(patch.id);
      const pollen = row === undefined ? patch.capacity : patchPollenAt(row.pollen, row.storedAt, patch.capacity, now);
      object.detail = `Pollen ${pollen}/${patch.capacity} · ${patch.flowers} blossoms`;
      object.hostile = false;
      object.hpRatio = pollen / Math.max(1, patch.capacity);
      object.attackingMe = false;
      object.tabs = MiningTabs;
      object.lockable = true;
    }
  }

  private updateStatic(origin: Vector3): void {
    const { layout, replica } = this.sources;
    for (const hive of layout.hives) {
      const object = this.upsert("hive", hive.id);
      object.position.set(hive.x, hive.y, hive.z);
      object.velocity.setAll(0);
      object.radius = HiveRadius;
      object.name = hive.name;
      object.typeLabel = "Hive";
      const state = replica.hives.get(hive.id);
      object.detail = state === undefined ? "Station" : `${state.honeyDelivered} honey stored · ${state.visits} visits`;
      object.hostile = false;
      object.hpRatio = undefined;
      object.attackingMe = false;
      object.tabs = NavigationTabs;
      object.lockable = false;
    }
    for (const nest of layout.nests) {
      const object = this.upsert("nest", nest.id);
      object.position.set(nest.x, nest.y, nest.z);
      object.velocity.setAll(0);
      object.radius = NestRadius;
      object.name = nest.name;
      object.typeLabel = "Fly Nest";
      object.detail = nest.hasQueen ? "Home of the Fly Queen" : "Blowfly breeding ground";
      object.hostile = true;
      object.hpRatio = undefined;
      object.attackingMe = false;
      object.tabs = NestTabs;
      object.lockable = false;
    }
    const islands = this.sources.world
      .islandsNear(origin.x, origin.z, IslandRange)
      .map((island) => ({ island, distance: Math.hypot(island.x - origin.x, island.top - origin.y, island.z - origin.z) }))
      .filter((entry) => entry.distance < IslandRange && !entry.island.isNest)
      .sort((a, b) => a.distance - b.distance)
      .slice(0, MaxIslands);
    for (const { island } of islands) {
      const object = this.upsert("island", island.id);
      object.position.set(island.x, island.top, island.z);
      object.velocity.setAll(0);
      object.radius = island.radius;
      const key = IslandCatalog[island.model]?.key ?? "";
      object.name = `${IslandLabels[key] ?? "Island"} ${island.id}`;
      object.typeLabel = "Island";
      object.detail = `${Math.round(island.radius * 2)} m · ${island.patchCount} flower patches`;
      object.hostile = false;
      object.hpRatio = undefined;
      object.attackingMe = false;
      object.tabs = NavigationTabs;
      object.lockable = false;
    }
  }
}
