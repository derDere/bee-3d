// tools/loadtest/src/metrics.ts — liest Prometheus-Metriken des SpacetimeDB-Servers und bildet Differenzen.

/** Ein Abzug aller Metrikzeilen: Schlüssel `name{labels}` → Wert (Metrik-Schnappschuss). */
export type MetricSnapshot = Map<string, number>;

/** Lädt `/v1/metrics` (nur im internen Netz erreichbar machen) und parst die Textform. */
export async function scrapeMetrics(metricsUrl: string): Promise<MetricSnapshot> {
  const response = await fetch(metricsUrl);
  if (!response.ok) {
    throw new Error(`metrics request failed: ${response.status}`);
  }
  const snapshot: MetricSnapshot = new Map();
  for (const line of (await response.text()).split('\n')) {
    if (line.length === 0 || line.startsWith('#')) {
      continue;
    }
    const space = line.lastIndexOf(' ');
    const value = Number(line.slice(space + 1));
    if (Number.isFinite(value)) {
      snapshot.set(line.slice(0, space), value);
    }
  }
  return snapshot;
}

/** Hex-Identität einer Datenbank; die Metriken tragen sie im Label `db`. */
export async function databaseIdentity(httpBase: string, database: string): Promise<string> {
  const response = await fetch(new URL(`v1/database/${database}/identity`, httpBase));
  if (!response.ok) {
    throw new Error(`identity lookup failed: ${response.status}`);
  }
  return (await response.text()).trim();
}

/** Summe aller Serien eines Namens, deren Labels alle Teilstrings enthalten (Seriensumme). */
function sum(snapshot: MetricSnapshot, name: string, ...labelParts: string[]): number {
  let total = 0;
  for (const [key, value] of snapshot) {
    if (key.startsWith(`${name}{`) && labelParts.every((part) => key.includes(part))) {
      total += value;
    }
  }
  return total;
}

/** Kennzahlen eines Messfensters zwischen zwei Schnappschüssen (Messfenster-Auswertung). */
export interface WindowReport {
  websocketBytesPerSec: number; // Nutzlast an alle Clients zusammen
  websocketPayloadsPerSec: number;
  reducerMicrosAvg: Record<string, number>;
  reducerCalls: Record<string, number>;
  databaseThreadBusyPercent: number;
  scheduledDelayAvgMs: number;
  scheduledLateShare: number; // Anteil > 50 ms
  outgoingQueueDisconnects: number;
}

/** Vergleicht zwei Schnappschüsse für eine Datenbank über `seconds` Sekunden. */
export function compareSnapshots(before: MetricSnapshot, after: MetricSnapshot, dbIdentity: string, seconds: number): WindowReport {
  const db = `db="${dbIdentity}"`;
  const delta = (name: string, ...parts: string[]): number => sum(after, name, db, ...parts) - sum(before, name, db, ...parts);
  const reducerMicrosAvg: Record<string, number> = {};
  const reducerCalls: Record<string, number> = {};
  let busySeconds = 0;
  for (const key of after.keys()) {
    const match = /^spacetime_reducer_plus_query_duration_sec_count\{.*reducer="([^"]+)"/.exec(key);
    if (match === null || !key.includes(db)) {
      continue;
    }
    const reducer = match[1]!;
    const calls = delta('spacetime_reducer_plus_query_duration_sec_count', `reducer="${reducer}"`);
    const secs = delta('spacetime_reducer_plus_query_duration_sec_sum', `reducer="${reducer}"`);
    if (calls > 0) {
      reducerCalls[reducer] = calls;
      reducerMicrosAvg[reducer] = Math.round((secs / calls) * 1e6 * 10) / 10;
      busySeconds += secs;
    }
  }
  const delayCount = delta('spacetime_scheduled_function_delay_seconds_count');
  const delaySum = delta('spacetime_scheduled_function_delay_seconds_sum');
  const onTime = delta('spacetime_scheduled_function_delay_seconds_bucket', 'le="0.05"');
  // spacetime_num_bytes_sent_to_clients_total zählt jede Auswertung nur einmal, nicht je Empfänger;
  // die tatsächlich gesendete Menge steht in spacetime_websocket_sent_msg_size_bytes.
  return {
    websocketBytesPerSec: Math.round(delta('spacetime_websocket_sent_msg_size_bytes_sum') / seconds),
    websocketPayloadsPerSec: Math.round(delta('spacetime_websocket_sent_msg_size_bytes_count') / seconds),
    reducerMicrosAvg,
    reducerCalls,
    databaseThreadBusyPercent: Math.round((busySeconds / seconds) * 1000) / 10,
    scheduledDelayAvgMs: delayCount > 0 ? Math.round((delaySum / delayCount) * 10_000) / 10 : 0,
    scheduledLateShare: delayCount > 0 ? Math.round((1 - onTime / delayCount) * 1000) / 1000 : 0,
    outgoingQueueDisconnects: sum(after, 'spacetime_client_outgoing_queue_disconnects_total') - sum(before, 'spacetime_client_outgoing_queue_disconnects_total'),
  };
}
