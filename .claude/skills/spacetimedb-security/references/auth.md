# Authentication and authorization

## Identities and tokens

- `Identity` = BLAKE3 hash of the token's `iss` and `sub` claims (32 bytes). The same user from
  the same issuer always has the same identity; the same person through another issuer has a
  different one.
- **Server-issued tokens** (anonymous connect or `POST /v1/identity`): ES256, `iss`
  `localhost`, `aud` `["spacetimedb"]`, random `sub`, **no `exp`** [verified 2.10.2]. They are
  valid only on the server whose signing keys created them. New keys (lost volume, rotation)
  invalidate every one of them: "Invalid Token: InvalidSignature".
- **OIDC tokens:** any JWT whose signature verifies against the JWKS that the issuer publishes
  through `<iss>/.well-known/openid-configuration`. The server checks signature and `exp`
  (60 s leeway; a missing `exp` never expires) — **not** issuer, **not** audience [source].
  Opaque access tokens do not work.
- The browser SDK exchanges the saved token for a short-lived token
  (`POST /v1/identity/websocket-token`) and passes that one as `?token=` in the WebSocket URL
  [source]; reverse-proxy access logs must not record query strings.
- `ctx.connectionId` names one connection; one identity may hold several (tabs, devices).

## Connection gate (module)

From the reference module (`skills/spacetimedb/templates/server/src/index.ts`) [verified 2.10.2]:

```ts
/** Vertrauenswürdige OIDC-Aussteller mit erwarteter Audience (Zugangsregeln). */
const TrustedIssuers: ReadonlyArray<{ readonly issuer: string; readonly audience: string }> = [
  { issuer: 'https://auth.example.com/realms/bee', audience: 'bee-web' },
];
const AllowGuests = true;

function assertTrustedCaller(ctx: Ctx): void {
  const owner = ctx.db.config.id.find(0)?.owner; // in init gespeichert: ctx.sender beim ersten Publish
  if (owner !== undefined && owner.isEqual(ctx.sender)) return; // Betreiber-Werkzeuge (CLI, MCP)
  const jwt = ctx.senderAuth.jwt;
  if (jwt === null) throw new SenderError('token required');
  if (jwt.issuer === 'localhost') {
    if (!AllowGuests) throw new SenderError('guest access disabled');
    return;
  }
  if (!TrustedIssuers.some((e) => e.issuer === jwt.issuer && jwt.audience.includes(e.audience))) {
    throw new SenderError('untrusted token');
  }
}

export const onConnect = spacetimedb.clientConnected((ctx) => {
  assertTrustedCaller(ctx); // Fehler → Verbindung abgelehnt; Modul-Log: "ERROR: on_connect: <Meldung>"
  // …
});
```

Rust form [verified 2.10.2]:

```rust
let jwt = ctx.sender_auth().jwt().ok_or("token required")?;
let is_guest = jwt.issuer() == "localhost";
if !is_guest && (jwt.issuer() != TRUSTED_ISSUER || !jwt.audience().iter().any(|a| a == TRUSTED_AUDIENCE)) {
    return Err("untrusted token".into());
}
```

Notes:

- A rejected client receives only `onConnectError` with the message "WebSocket error" — the
  same as a network failure [verified 2.10.2]. The game tells "login required" apart by its own
  state (for example: no OIDC token while guests are disabled), not by the error text.
- `clientConnected` runs for every WebSocket connection and for every HTTP SQL or reducer call
  [verified 2.10.2]. The gate therefore protects the HTTP API too, and code in it must stay cheap
  and must not create persistent rows.
- Reducers rely on the gate having run: every connection that reaches a reducer passed it.
  Scheduled reducers run with `ctx.senderAuth.isInternal` and the database identity as sender.
- With the 2.11 environment variables (not in 2.10.2), the issuer list moves from code into
  configuration; until then a change of issuers means a publish.

## Roles and admins

| Need | Pattern |
|---|---|
| Operator actions | Compare `ctx.sender` with the owner identity stored in `init` |
| Several admins | Private `admin` table (`identity` primary key) maintained by owner-only reducers |
| Roles from the identity provider | Read a custom claim: `ctx.senderAuth.jwt?.fullPayload['roles']` (TS), `serde_json` over `jwt.raw_payload()` (Rust); check `isInternal` first |
| Per-row ownership | `owner` column (compact player id) plus index; every write checks it against the caller's account |

## OIDC provider requirements

- Issues **JWT** ID or access tokens signed with an asymmetric key (ES256/RS256) published in
  JWKS.
- The `iss` value equals the discovery document's `issuer` exactly (scheme, host, path, trailing
  slash).
- **Reachable from the SpacetimeDB container:** the server fetches discovery and JWKS from the
  issuer URL that the browser sees. In Docker that public host name must resolve inside the
  container (public DNS, or an `extra_hosts` entry to the proxy); an internal service name
  would not match `iss`.
- The token's `aud` contains the game's client id; the module checks it.
- Tokens expire: the client's token store returns a fresh token on each (re)connect — the OIDC
  library's silent refresh feeds `TokenStore.load()` (skill `spacetimedb-babylon`).
- Browser flow: Authorization Code with PKCE (public client).

Candidates: SpacetimeAuth (managed by Clockwork Labs, beta, includes Steam tickets),
Auth0 or Clerk (managed), Keycloak, Authentik, Zitadel, Authelia (self-hosted), Better Auth
(library inside an own Node service). For a small self-hosted stack the provider's memory
footprint and operational load count as much as features [recommendation].

## Guests

- Token per server and database in `localStorage` (skill `spacetimedb-babylon`,
  `BrowserTokenStore`). Clearing site data loses the account; there is no recovery.
- Guests are free to create: the proxy limits new connections per IP, the module creates
  accounts only in an explicit `join` reducer, and a scheduled cleanup removes guest accounts
  without activity for a set period.
- Inform players that guest progress lives in this browser.

## Linking a guest to a login [recommendation]

Identities differ per issuer, so linking moves data from the guest identity to the OIDC
identity:

1. Guest connection calls a **procedure** `createLinkCode()` that stores a one-time code with
   the guest identity and a short expiry (minutes) in a private table and returns the code to
   the caller only (procedures return values; reducers do not).
2. The client logs in with the provider, reconnects with the OIDC token and calls
   `claimLinkCode(code)`.
3. The reducer checks code, expiry and that the caller is not a guest, then re-keys the account
   (delete the row with the guest identity, insert it with `ctx.sender`, keep the compact player
   id), updates the profile's identity column and deletes the code.

Codes come from secret-mixed randomness (below), are single-use and rate-limited per identity.

## Randomness that players cannot predict

`ctx.random` / `ctx.rng()` are seeded from `ctx.timestamp` (microseconds) [source]: every call
in one transaction draws from one sequence, and the seed is guessable within the precision of
the client's timing. Fine for cosmetic variation; for loot, odds and codes the module mixes in
secret state: the owner sets a secret seed once through an owner-only reducer (generated with a
cryptographic RNG on the operator machine), the module keeps it in a private table and advances
it on every draw.

## Signing keys

- Location: `--jwt-priv-key-path` / `--jwt-pub-key-path`, `[certificate-authority]` in
  `config.toml`, or generated into the CLI config directory on first start (`/stdb/config/` with
  `--root-dir=/stdb`) [verified 2.10.2].
- Losing or replacing them logs out every guest and the server-issued owner identity of the CLI
  (403 on publish). Keys belong on the persistent volume and in every backup (skill
  `spacetimedb-ops`).
- Rotation strategies (upstream key-rotation guide): clean slate (development), re-mint the
  owner token with the same `iss`/`sub` (keeps ownership), or OIDC-backed owner identity
  (recommended for production).
