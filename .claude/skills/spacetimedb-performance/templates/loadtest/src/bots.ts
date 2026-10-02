// tools/loadtest/src/bots.ts — Lasttest mit kopflosen Bots, die den echten Netzwerkcode des Spiels nutzen.
// Aufruf: npx tsx src/bots.ts --bots 100 --seconds 60 [--rate 15] [--radius 1] [--compression none] [--confirmed false]
//         [--uri ws://127.0.0.1:3000] [--db bee-world] [--metrics http://127.0.0.1:3000/v1/metrics]
import type { Identity } from 'spacetimedb';
import { tables, type DbConnection } from '../../../src/net/bindings';
import type { BeeState } from '../../../src/net/bindings/types';
import { CellSubscriptions } from '../../../src/net/cellSubscriptions';
import { PoseReporter } from '../../../src/net/poseReporter';
import { MemoryTokenStore, SpacetimeSession } from '../../../src/net/spacetimeSession';
import { compareSnapshots, databaseIdentity, scrapeMetrics } from './metrics';

/** Parameter eines Laufs (Laufparameter). */
interface RunOptions {
  readonly uri: string;
  readonly database: string;
  readonly metricsUrl: string | undefined;
  readonly bots: number;
  readonly rateHz: number;
  readonly seconds: number;
  readonly warmupSeconds: number;
  readonly radius: number;
  readonly area: number;
  readonly compression: 'gzip' | 'brotli' | 'none';
  readonly confirmed: boolean;
}

function parseOptions(argv: readonly string[]): RunOptions {
  const get = (name: string, fallback: string): string => {
    const index = argv.indexOf(`--${name}`);
    return index >= 0 && index + 1 < argv.length ? argv[index + 1]! : fallback;
  };
  const bots = Number(get('bots', '50'));
  return {
    uri: get('uri', 'ws://127.0.0.1:3000'),
    database: get('db', 'bee-world'),
    metricsUrl: argv.includes('--metrics') ? get('metrics', '') : undefined,
    bots,
    rateHz: Number(get('rate', '15')),
    seconds: Number(get('seconds', '30')),
    warmupSeconds: Number(get('warmup', '5')),
    radius: Number(get('radius', '1')),
    area: Number(get('area', String(Math.round(60 * Math.sqrt(bots))))), // konstante Dichte: ~6 sichtbare Bienen
    compression: get('compression', 'none') as RunOptions['compression'],
    confirmed: get('confirmed', 'false') === 'true',
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
        this.addEventListener('message', (event: MessageEvent) => {
          const data = event.data as ArrayBuffer | string;
          counter.bytes += typeof data === 'string' ? data.length : data.byteLength;
          counter.messages++;
        });
      }
    }
    globalThis.WebSocket = CountingWebSocket as typeof WebSocket;
  }
}

/** Gemeinsame Zähler aller Bots (Laufstatistik). */
class RunStats {
  public connected = 0;
  public rowEvents = 0;
  public reducerErrors = 0;
  public readonly latenciesMs: number[] = [];

  public percentile(p: number): number | null {
    if (this.latenciesMs.length === 0) {
      return null;
    }
    const sorted = [...this.latenciesMs].sort((a, b) => a - b);
    return Math.round(sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]! * 10) / 10;
  }
}

/** Ein simulierter Spieler: tritt bei, fliegt im Kreis, meldet seine Pose (Bot). */
class Bot {
  private readonly index: number;
  private readonly options: RunOptions;
  private readonly stats: RunStats;
  private readonly session: SpacetimeSession;
  private readonly centreX: number;
  private readonly centreZ: number;
  private readonly phase: number;
  private readonly sent: Array<{ readonly x: number; readonly atMs: number }> = [];
  private connection: DbConnection | undefined;
  private cells: CellSubscriptions | undefined;
  private reporter: PoseReporter | undefined;
  private playerId: number | undefined;
  private timer: ReturnType<typeof setInterval> | undefined;

  public constructor(index: number, options: RunOptions, stats: RunStats) {
    this.index = index;
    this.options = options;
    this.stats = stats;
    this.centreX = (Math.random() - 0.5) * options.area;
    this.centreZ = (Math.random() - 0.5) * options.area;
    this.phase = Math.random() * Math.PI * 2;
    this.session = new SpacetimeSession(
      { uri: options.uri, database: options.database, confirmedReads: options.confirmed, compression: options.compression },
      new MemoryTokenStore(),
      {
        onReady: (connection, identity) => this.onReady(connection, identity),
        onLost: () => this.onLost(),
        onTokenRejected: () => undefined,
      }
    );
  }

  public start(): void {
    this.session.start();
  }

  public stop(): void {
    this.onLost();
    this.session.stop();
  }

  private onReady(connection: DbConnection, identity: Identity): void {
    this.connection = connection;
    this.stats.connected++;
    connection.db.beeState.onInsert((_ctx, row) => this.onBee(row));
    connection.db.beeState.onUpdate((_ctx, _old, row) => this.onBee(row));
    connection.db.beeState.onDelete(() => this.stats.rowEvents++);
    connection.db.playerProfile.onInsert((_ctx, profile) => {
      if (profile.identity.isEqual(identity)) {
        this.playerId = profile.playerId;
      }
    });
    connection.subscriptionBuilder().subscribe(tables.playerProfile.where((row) => row.identity.eq(identity)));
    connection.reducers.join({ name: `bot ${this.index}` }).catch(() => this.stats.reducerErrors++);
    this.cells = new CellSubscriptions(connection, this.options.radius);
    this.reporter = new PoseReporter(
      (pose) => {
        this.sent.push({ x: pose.x, atMs: performance.now() });
        if (this.sent.length > 64) {
          this.sent.shift();
        }
        connection.reducers.reportPose(pose).catch(() => this.stats.reducerErrors++);
      },
      this.options.rateHz
    );
    this.timer = setInterval(() => this.step(), 1000 / 60); // wie ein Render-Takt mit 60 fps
  }

  private onLost(): void {
    if (this.timer !== undefined) {
      clearInterval(this.timer);
    }
    this.timer = undefined;
    this.cells = undefined;
    this.reporter = undefined;
    this.connection = undefined;
  }

  private step(): void {
    const t = performance.now() / 1000;
    const angle = this.phase + t * 0.2; // ≈10 m/s auf einem 50-m-Kreis
    const x = this.centreX + Math.cos(angle) * 50;
    const z = this.centreZ + Math.sin(angle) * 50;
    this.cells?.update(x, z);
    this.reporter?.update(performance.now(), x, 60, z, angle, 0);
    if (Math.random() < 0.001) {
      this.connection?.reducers.buzz({}).catch(() => undefined); // Abklingzeit-Fehler sind erwartet
    }
  }

  private onBee(row: BeeState): void {
    this.stats.rowEvents++;
    if (row.playerId !== this.playerId) {
      return;
    }
    const match = this.sent.find((entry) => Math.abs(entry.x - row.x) < 0.001);
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
  await new Promise((resolve) => setTimeout(resolve, options.warmupSeconds * 1000));
  const httpBase = options.uri.replace(/^ws/, 'http');
  const dbIdentity = options.metricsUrl !== undefined ? await databaseIdentity(httpBase, options.database) : undefined;
  const before = options.metricsUrl !== undefined ? await scrapeMetrics(options.metricsUrl) : undefined;
  const bytes0 = wire.bytes;
  const messages0 = wire.messages;
  const rows0 = stats.rowEvents;
  stats.latenciesMs.length = 0;
  await new Promise((resolve) => setTimeout(resolve, options.seconds * 1000));
  const after = options.metricsUrl !== undefined ? await scrapeMetrics(options.metricsUrl) : undefined;
  const perBot = (value: number): number => Math.round((value / options.seconds / options.bots) * 100) / 100;
  const report = {
    options,
    connected: stats.connected,
    reducerErrors: stats.reducerErrors,
    client: {
      kilobytesPerSecPerBot: perBot((wire.bytes - bytes0) / 1024),
      messagesPerSecPerBot: perBot(wire.messages - messages0),
      rowEventsPerSecPerBot: perBot(stats.rowEvents - rows0),
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
