# Infrastructure hardening

What sits in front of and around the SpacetimeDB container. Concrete proxy and Docker files:
skill `spacetimedb-ops` (`references/proxy.md`, `references/docker.md`).

## Public route allowlist

The public reverse proxy forwards exactly these requests to SpacetimeDB and answers everything
else under the SpacetimeDB prefix with 403/404:

| Method and path (after the prefix) | Purpose |
|---|---|
| `GET /v1/database/<game-db>/subscribe` with WebSocket upgrade | Game connection |
| `POST /v1/identity/websocket-token` | SDK swaps a saved token for a short-lived one before every connect [source] |
| `GET /v1/ping` (optional) | External uptime check |
| `ANY /v1/database/<game-db>/route/<path>` (only when used) | Module HTTP handlers; each handler authenticates its caller itself |

Everything else stays internal [verified 2.10.2]:

| Route | Why blocked |
|---|---|
| `POST /v1/database`, `PUT /v1/database/<db>` | Anonymous clients may create databases on standalone servers |
| `POST /v1/identity` | Mints identities over plain HTTP; the SDK does not need it |
| `…/sql`, `…/call/<reducer>` | Anonymous reads of public tables and reducer calls outside the WebSocket limits |
| `…/schema`, `GET /v1/database/<db>` | Full schema including private table names; owner identity |
| `…/logs`, `…/names`, `DELETE …` | Owner tooling |
| `/v1/mcp`, `…/mcp` | Agent access |
| `/v1/metrics`, `/v1/prometheus/*`, `/v1/energy/*` | Unauthenticated monitoring data |
| `/internal/*` | Heap profiling controls |
| PGWire port | No TLS on standalone; password = token |

Operator access (publish, SQL, logs, MCP, metrics) goes through the internal network: the
server port bound to `127.0.0.1` on the host, an SSH tunnel, or a VPN — never the public proxy.

## Limits at the proxy

| Limit | Starting value [recommendation] |
|---|---|
| Concurrent WebSocket connections per IP | 8 |
| New connections and token exchanges per IP | 5 per second, burst 20 |
| Request body size on allowed routes | 64 KiB (token exchange carries none) |
| Idle timeout for upgraded connections | ≥ 60 s (the server pings every 15 s) |

The SpacetimeDB server itself only limits per connection: 16,384 queued incoming messages before
it closes the connection, 16K queued outgoing messages before it kicks a slow client [source].

## TLS and logging

- TLS terminates at the proxy; clients connect with `wss://`. The SpacetimeDB container speaks
  plain HTTP on the internal network only.
- The WebSocket URL carries a short-lived token as `?token=` [source]: access logs record the
  path without query string (nginx `$uri`, HAProxy `%HPO`, Traefik access logs with query
  stripped or disabled for this router).
- Same-origin deployment (`https://bee.example.com/` for the game, `/stdb/` for SpacetimeDB)
  avoids CORS configuration and third-party cookie issues.

## Container and host

| Measure | Reason |
|---|---|
| Image pinned to an exact version; release notes read before upgrades | 2.9.0 fixed a durability hole; security fixes arrive in patch releases |
| Runs as the image's non-root user `spacetime` | Default of the official image |
| No published host port in production except via the proxy network; development binds `127.0.0.1` | The server listens on all interfaces by default |
| `[module-http] enabled = false` | Blocks outbound HTTP from procedures and handlers (2.9.0) |
| Egress restricted to the OIDC issuer (host firewall or egress proxy) | Token validation fetches URLs named by the token's `iss`; no internal services reachable from the container |
| JWT signing keys on the persistent volume, in backups, readable only by the container user | Losing them logs out every guest and the CLI owner |
| CLI owner token (`/stdb/config/cli.toml` or the operator's CLI config) treated as a root credential | It can publish, delete and read everything |
| `spacetime lock <db>` on the production database | Prevents accidental deletion |
| Docker socket never mounted into the SpacetimeDB container | Container escape |
| Memory limit with headroom | OOM kills force a long commit-log replay |
