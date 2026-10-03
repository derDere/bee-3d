// tools/loadtest/src/bots.ts — Lasttest mit kopflosen Bots, die den echten Netzwerkcode des Spiels nutzen (NetClient).
// Aufruf: npx tsx src/bots.ts --bots 50 --seconds 60 [--area 400] [--compression none] [--confirmed false]
//         [--uri ws://127.0.0.1:3000] [--db bee-world] [--metrics http://127.0.0.1:3000/v1/metrics]
import { NetClient, type LocalBee } from "../../../src/net/netClient";
import type { ReportedPose } from "../../../src/net/poseReporter";
import { MemoryTokenStore } from "../../../src/net/spacetimeSession";
import { compareSnapshots, databaseIdentity, scrapeMetrics } from "./metrics";

/** Parameter eines Laufs (Laufparameter). */
interface RunOptions {
  readonly uri: string;
  readonly database: string;
  readonly metricsUrl: string | undefined;
  readonly bots: number;
  readonly seconds: number;
  readonly warmupSeconds: number;
  readonly area: number;
  readonly compression: "gzip" | "brotli" | "none";
  readonly confirmed: boolean;
}

/** Flugtempo der Bots in m/s, unter dem Höchsttempo einer Biene ohne Upgrades. */
const BotSpeed = 10;

function parseOptions(argv: readonly string[]): RunOptions {
  const get = (name: string, fallback: string): string => {
    const index = argv.indexOf(`--${name}`);
    return index >= 0 && index + 1 < argv.length ? (argv[index + 1] ?? fallback) : fallback;
  };
  const bots = Number(get("bots", "50"));
  return {
    uri: get("uri", "ws://127.0.0.1:3000"),
    database: get("db", "bee-world"),
    metricsUrl: argv.includes("--metrics") ? get("metrics", "") : undefined,
    bots,
    seconds: Number(get("seconds", "30")),
    warmupSeconds: Number(get("warmup", "20")),
    area: Number(get("area", String(Math.round(60 * Math.sqrt(bots))))), // konstante Dichte: ~6 sichtbare Bienen
    compression: get("compression", "none") as RunOptions["compression"],
    confirmed: get("confirmed", "false") === "true",
  };
}

/** Zählt empfangene WebSocket-Bytes und -Nachrichten aller Bots (Leitungszähler). */
class WireCounter {
  public bytes = 0;
  public messages = 0;

  /** Ersetzt die globale WebSocket-Klasse durch eine zählende Unterklasse; vor dem ersten Verbinden aufrufen. */
  public install(): void {
    const Base = globalThis.WebSocket;
    const counter = this;
    class CountingWebSocket extends Base {
      public constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols);
        this.addEventListener("message", (event: MessageEvent) => {
          const data = event.data as ArrayBuffer | string;
          counter.bytes += typeof data === "string" ? data.length : data.byteLength;
          counter.messages++;
        });
      }
    }
    globalThis.WebSocket = CountingWebSocket as typeof WebSocket;
  }
}

/** Gemeinsame Zähler aller Bots (Laufstatistik). */
class RunStats {
  public online = 0;
  public reducerErrors = 0;
  public readonly latenciesMs: number[] = [];

  public percentile(p: number): number | null {
    if (this.latenciesMs.length === 0) {
      return null;
    }
    const sorted = [...this.latenciesMs].sort((a, b) => a - b);
    const value = sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? 0;
    return Math.round(value * 10) / 10;
  }
}

/**
 * Ein simulierter Spieler (Bot): tritt über den NetClient bei, fliegt vom Einsetzpunkt in eine zufällige
 * Richtung hinaus und umkreist dann den Startpunkt; meldet seine Pose wie der Browser-Client.
 */
class Bot implements LocalBee {
  private readonly stats: RunStats;
  private readonly net: NetClient;
  private readonly name: string;
  private readonly ringRadius: number;
  private readonly heading: number;
  private readonly sent: Array<{ readonly x: number; readonly atMs: number }> = [];
  private readonly pose = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, aimYaw: 0, aimPitch: 0, clientFlags: 0 };
  private readonly spawn = { x: 0, y: 0, z: 0 };
  private spawnedAtMs: number | undefined;
  private timer: ReturnType<typeof setInterval> | undefined;

  public constructor(index: number, options: RunOptions, stats: RunStats) {
    this.stats = stats;
    this.name = `bot ${index}`;
    this.ringRadius = 20 + Math.random() * (options.area / 2);
    this.heading = Math.random() * Math.PI * 2;
    this.net = new NetClient(
      { uri: options.uri, database: options.database, confirmedReads: options.confirmed, compression: options.compression },
      new MemoryTokenStore(),
      this,
      {
        onStatus: (status) => {
          if (status === "online") {
            this.stats.online++;
          }
        },
        onCombatEvent: () => undefined,
        onOwnBee: (row) => this.onOwnRow(row.x),
        onRejected: (reducer) => {
          if (reducer !== "buzz") {
            this.stats.reducerErrors++;
          }
        },
        onTokenRejected: () => undefined,
      },
    );
  }

  // ---------- LocalBee ----------

  public get reportedPose(): ReportedPose {
    return this.pose;
  }

  public get reporting(): boolean {
    return this.spawnedAtMs !== undefined;
  }

  public correctTo(x: number, y: number, z: number): void {
    // Die erste Korrektur ist der Einsetzpunkt des Servers; von dort startet die Flugbahn
    if (this.spawnedAtMs === undefined) {
      this.spawn.x = x;
      this.spawn.y = y;
      this.spawn.z = z;
      this.spawnedAtMs = performance.now();
    }
    this.pose.x = x;
    this.pose.y = y;
    this.pose.z = z;
  }

  // ---------- Lauf ----------

  public start(): void {
    this.net.start();
    this.net.join(this.name);
    this.timer = setInterval(() => this.step(), 1000 / 60); // wie ein Render-Takt mit 60 fps
  }

  public stop(): void {
    if (this.timer !== undefined) {
      clearInterval(this.timer);
    }
    this.net.dispose();
  }

  private step(): void {
    const now = performance.now();
    if (this.spawnedAtMs !== undefined) {
      const t = (now - this.spawnedAtMs) / 1000;
      const outbound = this.ringRadius / BotSpeed;
      let angle = this.heading;
      let radius = Math.min(this.ringRadius, t * BotSpeed);
      // Gier aus der Flugrichtung: erst radial hinaus, dann tangential auf der Kreisbahn
      let yaw = Math.atan2(Math.cos(angle), Math.sin(angle));
      if (t > outbound) {
        angle = this.heading + ((t - outbound) * BotSpeed) / this.ringRadius;
        radius = this.ringRadius;
        yaw = Math.atan2(-Math.sin(angle), Math.cos(angle));
      }
      this.pose.x = this.spawn.x + Math.cos(angle) * radius;
      this.pose.y = this.spawn.y + 30 * Math.min(1, t / 10);
      this.pose.z = this.spawn.z + Math.sin(angle) * radius;
      this.pose.yaw = yaw;
      this.sent.push({ x: this.pose.x, atMs: now });
      if (this.sent.length > 240) {
        this.sent.shift();
      }
      if (Math.random() < 0.0005) {
        this.net.buzz(); // Abklingzeit-Fehler sind erwartet
      }
    }
    this.net.frameUpdate(1 / 60, 1);
  }

  private onOwnRow(x: number): void {
    const match = this.sent.find((entry) => Math.abs(entry.x - x) < 0.001);
    if (match !== undefined) {
      this.stats.latenciesMs.push(performance.now() - match.atMs);
    }
  }
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const wire = new WireCounter();
  wire.install();
  const stats = new RunStats();
  const bots = Array.from({ length: options.bots }, (_, i) => new Bot(i, options, stats));
  for (const bot of bots) {
    bot.start();
    await new Promise((resolve) => setTimeout(resolve, 10)); // sanfter Anlauf statt Verbindungssturm
  }
  // Aufwärmen: Bots fliegen vom Stock hinaus auf ihre Kreisbahnen
  await new Promise((resolve) => setTimeout(resolve, options.warmupSeconds * 1000));
  const httpBase = options.uri.replace(/^ws/, "http");
  const dbIdentity = options.metricsUrl !== undefined ? await databaseIdentity(httpBase, options.database) : undefined;
  const before = options.metricsUrl !== undefined ? await scrapeMetrics(options.metricsUrl) : undefined;
  const bytes0 = wire.bytes;
  const messages0 = wire.messages;
  stats.latenciesMs.length = 0;
  await new Promise((resolve) => setTimeout(resolve, options.seconds * 1000));
  const after = options.metricsUrl !== undefined ? await scrapeMetrics(options.metricsUrl) : undefined;
  const perBot = (value: number): number => Math.round((value / options.seconds / options.bots) * 100) / 100;
  const report = {
    options,
    online: stats.online,
    reducerErrors: stats.reducerErrors,
    client: {
      kilobytesPerSecPerBot: perBot((wire.bytes - bytes0) / 1024),
      messagesPerSecPerBot: perBot(wire.messages - messages0),
      ownUpdateLatencyMs: { p50: stats.percentile(50), p95: stats.percentile(95), samples: stats.latenciesMs.length },
    },
    server: before !== undefined && after !== undefined && dbIdentity !== undefined ? compareSnapshots(before, after, dbIdentity, options.seconds) : null,
  };
  console.log(JSON.stringify(report, null, 2));
  for (const bot of bots) {
    bot.stop();
  }
  await new Promise((resolve) => setTimeout(resolve, 1000));
  process.exit(0);
}

void main();
