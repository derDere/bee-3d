# Reverse proxy for SpacetimeDB

The public proxy forwards the game's WebSocket and the token exchange and nothing else (policy and
reasons: skill `spacetimedb-security`, `references/infrastructure.md`). The game is served
same-origin: `https://bee.example.com/` for the static client, `https://bee.example.com/stdb/` for
SpacetimeDB with the prefix stripped. The client uses `withUri('wss://bee.example.com/stdb/')` —
the SDK resolves `v1/…` relative to that URI, so only the trailing slash keeps the prefix
[verified 2.10.2].

The snippets below are starting points; the AI agent checks them against the proxy version in use
before deployment [recommendation].

## Routes after the prefix

| Allowed | Notes |
|---|---|
| `GET /v1/database/bee-world/subscribe` | WebSocket upgrade; query string carries `token`, `compression`, `confirmed` |
| `POST /v1/identity/websocket-token` | Called by the SDK before every connect when it holds a token |
| `GET /v1/ping` | Optional health for external monitors |
| `/v1/database/bee-world/route/*` | Only when the module defines HTTP handlers |

All other paths under `/stdb/` → 404.

## Traefik v3 (Docker labels on the `spacetimedb` service)

```yaml
labels:
  - traefik.enable=true
  - traefik.docker.network=${EDGE_NETWORK}
  - traefik.http.routers.bee-stdb.rule=Host(`bee.example.com`) && (Path(`/stdb/v1/database/bee-world/subscribe`) || (Method(`POST`) && Path(`/stdb/v1/identity/websocket-token`)) || Path(`/stdb/v1/ping`))
  - traefik.http.routers.bee-stdb.entrypoints=websecure
  - traefik.http.routers.bee-stdb.tls.certresolver=letsencrypt
  - traefik.http.routers.bee-stdb.middlewares=bee-stdb-strip,bee-stdb-conns,bee-stdb-rate
  - traefik.http.middlewares.bee-stdb-strip.stripprefix.prefixes=/stdb
  # Gleichzeitige Verbindungen je Client-IP (ohne sourcecriterion zählt Traefik je Host!)
  - traefik.http.middlewares.bee-stdb-conns.inflightreq.amount=8
  - traefik.http.middlewares.bee-stdb-conns.inflightreq.sourcecriterion.ipstrategy.depth=0
  # Neue Verbindungen und Token-Tausch je IP
  - traefik.http.middlewares.bee-stdb-rate.ratelimit.average=5
  - traefik.http.middlewares.bee-stdb-rate.ratelimit.burst=20
  - traefik.http.middlewares.bee-stdb-rate.ratelimit.sourcecriterion.ipstrategy.depth=0
  - traefik.http.services.bee-stdb.loadbalancer.server.port=3000
```

- `inFlightReq` groups by request host unless a `sourceCriterion` is set (Traefik 3.7 reference);
  `ipStrategy.depth=0` uses the remote address. Behind another proxy, `depth=1` reads the client
  from `X-Forwarded-For`.
- A WebSocket counts as one in-flight request for its whole lifetime, which turns `inFlightReq`
  into a per-IP connection limit [recommendation: confirm in a test].
- Access logs: disable them for this router or drop the query string (the URL carries a
  short-lived token).
- Unmatched `/stdb/…` paths go to whichever router matches next (usually the static client);
  none of them reaches SpacetimeDB.

## nginx

```nginx
map $http_upgrade $connection_upgrade { default upgrade; '' close; }
limit_conn_zone $binary_remote_addr zone=stdb_conns:10m;
limit_req_zone  $binary_remote_addr zone=stdb_rate:10m rate=5r/s;
log_format stdb_noquery '$remote_addr [$time_local] "$request_method $uri" $status $body_bytes_sent';

server {
    listen 443 ssl;
    server_name bee.example.com;
    # … TLS-Zertifikate, statischer Client unter / …

    location = /stdb/v1/database/bee-world/subscribe {
        access_log /var/log/nginx/stdb.log stdb_noquery;   # $uri ohne Query → kein Token im Log
        limit_conn stdb_conns 8;
        limit_req zone=stdb_rate burst=20 nodelay;
        proxy_pass http://spacetimedb:3000/v1/database/bee-world/subscribe;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_set_header Host $host;
        proxy_read_timeout 120s;
    }

    location = /stdb/v1/identity/websocket-token {
        limit_except POST { deny all; }
        limit_req zone=stdb_rate burst=20 nodelay;
        client_max_body_size 64k;
        proxy_pass http://spacetimedb:3000/v1/identity/websocket-token;
        proxy_set_header Host $host;
    }

    location = /stdb/v1/ping { proxy_pass http://spacetimedb:3000/v1/ping; }

    location /stdb/ { return 404; }
}
```

Exact-match locations (`location =`) keep the allowlist literal; `proxy_pass` with a URI replaces
the matched path.

## HAProxy

```haproxy
frontend fe_https
    bind :443 ssl crt /etc/haproxy/certs/
    mode http
    # Pfad ohne Query im Log: %HPO statt %r/%HU
    log-format "%ci [%tr] %ft %b %ST %B %HM %HPO"
    stick-table type ip size 100k expire 60s store conn_cur,http_req_rate(10s)
    http-request track-sc0 src
    acl stdb_path  path_beg /stdb/
    acl stdb_ws    path /stdb/v1/database/bee-world/subscribe
    acl stdb_token path /stdb/v1/identity/websocket-token
    acl stdb_ping  path /stdb/v1/ping
    acl is_post    method POST
    http-request deny deny_status 404 if stdb_path !stdb_ws !stdb_token !stdb_ping
    http-request deny deny_status 405 if stdb_token !is_post
    http-request deny deny_status 429 if stdb_path { sc_conn_cur(0) gt 8 }
    http-request deny deny_status 429 if stdb_path { sc_http_req_rate(0) gt 50 }
    use_backend be_stdb if stdb_path
    default_backend be_web

backend be_stdb
    mode http
    http-request replace-path /stdb(/.*) \1
    timeout tunnel 1h
    server stdb spacetimedb:3000 check
```

`timeout tunnel` governs upgraded WebSocket connections; it must exceed the server's ping
interval (15 s) by far.

## Local development

No proxy: the Vite dev server serves the client, and the client connects to
`ws://127.0.0.1:3000` (the container port bound to loopback). `127.0.0.1` instead of
`localhost` follows skill `babylon-game-dev` (secure context, company web filter).
