// shared/quests.ts — Quests der Geschichte „The Storm and the Fly Queen“ und wiederholbare Aufträge (Spieltexte Englisch).

/** Zähler, die eine Quest voranbringen (Questzähler). */
export type QuestCounter =
  | "islandVisit"
  | "pollenCollected"
  | "pollenDelivered"
  | "blowflyKill"
  | "brummerKill"
  | "queenKill"
  | "anyFlyKill"
  | "nightPollen"
  | "goldPollen"
  | "distinctHives"
  | "edgeTouch";

/** Eine Quest (Quest). */
export interface QuestInfo {
  readonly id: number;
  readonly title: string;
  /** Auftragstext der Stockkönigin. */
  readonly brief: string;
  readonly counter: QuestCounter;
  readonly goal: number;
  readonly reward: number;
  readonly repeatable: boolean;
  /** Quest, die vorher abgeschlossen sein muss (0 = keine). */
  readonly requires: number;
}

export const Quests: readonly QuestInfo[] = [
  {
    id: 1,
    title: "First Flight",
    brief: "Welcome, new bee! Out there, islands full of flowers float between the clouds. Fly to one — don't worry, they don't bite. The flies do.",
    counter: "islandVisit",
    goal: 1,
    reward: 20,
    repeatable: false,
    requires: 0,
  },
  {
    id: 2,
    title: "Pollen Sample",
    brief: "Point your pollen collector (F5) at a flower patch. Bring 30 pollen, then we'll talk about your salary.",
    counter: "pollenCollected",
    goal: 30,
    reward: 30,
    repeatable: false,
    requires: 1,
  },
  {
    id: 3,
    title: "Homecoming",
    brief: "Pollen in your pants makes no honey. Dock (D) and deliver it. We will count every grain.",
    counter: "pollenDelivered",
    goal: 1,
    reward: 25,
    repeatable: false,
    requires: 2,
  },
  {
    id: 4,
    title: "No Buzzing Allowed",
    brief: "Blowflies keep spitting on our flowers! Make three of them regret it. Laser eyes on F1 and F2, gatling on F3.",
    counter: "blowflyKill",
    goal: 3,
    reward: 60,
    repeatable: false,
    requires: 3,
  },
  {
    id: 5,
    title: "Night Shift",
    brief: "At night the flowers glow and give more pollen. And no, you may not sleep in: 50 pollen after dark!",
    counter: "nightPollen",
    goal: 50,
    reward: 80,
    repeatable: false,
    requires: 4,
  },
  {
    id: 6,
    title: "Comb Tour",
    brief: "Say hello to the neighbours. Dock at three different hives — warp (S) saves your wings.",
    counter: "distinctHives",
    goal: 3,
    reward: 90,
    repeatable: false,
    requires: 5,
  },
  {
    id: 7,
    title: "Gold Rush",
    brief: "Rumour has it there are golden flowers. The scent scanner (F8) finds them. Bring me 10 gold pollen and I'll write you a poem.",
    counter: "goldPollen",
    goal: 10,
    reward: 150,
    repeatable: false,
    requires: 6,
  },
  {
    id: 8,
    title: "Big Bluebottles",
    brief: "Bluebottles are twice as big and three times as rude. Take down two of them — and bring friends.",
    counter: "brummerKill",
    goal: 2,
    reward: 160,
    repeatable: false,
    requires: 7,
  },
  {
    id: 9,
    title: "Storm Runner",
    brief: "Far out, the world turns to cotton wool: the cloud rim. Fly there, touch it once and come back — with all six legs, please.",
    counter: "edgeTouch",
    goal: 1,
    reward: 120,
    repeatable: false,
    requires: 8,
  },
  {
    id: 10,
    title: "The Fly Queen",
    brief: "The Fly Queen lives in Maggot Keep near the cloud rim. She is huge, she is gross, she has to go. Alone you'll end up a puddle — bring a swarm.",
    counter: "queenKill",
    goal: 1,
    reward: 800,
    repeatable: false,
    requires: 9,
  },
  {
    id: 101,
    title: "Delivery Order",
    brief: "The hive is hungry. 100 pollen, as usual. Thank you.",
    counter: "pollenDelivered",
    goal: 100,
    reward: 40,
    repeatable: true,
    requires: 3,
  },
  {
    id: 102,
    title: "Pest Control",
    brief: "Ten fewer flies, ten fewer worries.",
    counter: "anyFlyKill",
    goal: 10,
    reward: 70,
    repeatable: true,
    requires: 3,
  },
];

/** Quest nach ID. */
export function questInfo(id: number): QuestInfo | undefined {
  return Quests.find((quest) => quest.id === id);
}

/** Sprüche der Fliegen beim Aufschalten (Fliegensprüche). */
export const FlyTaunts: readonly string[] = [
  "Bzzzt! Your honey is mine!",
  "I'll spit in your combs!",
  "Buzz off, stripes!",
  "Smell that? That's fear. And compost.",
  "Go buzz somewhere else!",
  "Yellow and black? Like a warning sign. Good.",
  "I've sat on things you don't want to know about.",
  "Come closer, little stripy!",
];

/** Namensvorschläge beim Start (Bienennamen). */
export const BeeNames: readonly string[] = [
  "Bumble Betty",
  "Sir Buzzalot",
  "Honey Badger",
  "Stingy Sue",
  "Waxwell",
  "Pollen Paul",
  "Nectarina",
  "Wingrid",
  "Beeatrice",
  "Captain Fuzz",
  "Buzzy McBuzzface",
  "Queen of Nothing",
];
