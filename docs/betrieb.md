# Betrieb

Hinweise für einen Betrieb außerhalb der Entwicklungsumgebung (`APP_ENV` test, qs, prod).

## Netz und Proxy

- TLS terminiert ein vorgelagerter Proxy; der `web`-Container spricht intern HTTP auf
  `${WEB_BIND}:${WEB_PORT}` (Standard `127.0.0.1:8080`).
- Der Proxy setzt `X-Forwarded-For`. `TRUSTED_PROXY_CIDR` nennt seinen Adressbereich; nur ihm glaubt
  nginx die Client-Adresse. Damit gelten die Grenzen (8 WebSockets, 5 Anfragen/s mit Burst 20) je
  Spieler. Gedrosselte Anfragen beantwortet nginx mit 429.
- nginx löst `spacetimedb` zur Laufzeit über das Docker-DNS auf; ein neu erzeugter Server-Container
  bleibt ohne Neustart von `web` erreichbar.
- Der SpacetimeDB-Container braucht keinen Zugang nach außen. Eine Firewall-Regel (Docker-Kette
  `DOCKER-USER`) oder ein Egress-Proxy sperrt ausgehende Verbindungen; erst ein künftiger
  OIDC-Anbieter braucht eine Ausnahme.

## Daten

- Laufzeitdaten, Schlüssel und das Besitzer-Token liegen unter `mounts/` (nicht versioniert) und
  gehören ins Backup.
- `make clear` löscht alle Laufzeitdaten und läuft nur mit `APP_ENV=dev` oder `test` gegen einen
  lokalen Server. In Produktion sperrt `spacetime lock bee-world` die Datenbank zusätzlich gegen
  versehentliches Löschen.
- Spieler sind Gäste: Das Token im `localStorage` des Browsers ist ihr einziger Zugang. Der Client
  löscht es nur bei einer echten Ablehnung (401/403) des Token-Tauschs.

## Bekannte Grenzen

| Thema | Stand |
|---|---|
| Konten | Jeder neue Gast legt öffentliche Profil- und Ranglistenzeilen an, die alle Clients laden. Für einen privaten Spielerkreis unkritisch; für einen offenen Betrieb braucht es eine Online-Liste, eine begrenzte Rangliste, ein Budget für neue Konten und das Aufräumen verwaister Gäste. |
| Abmelden im Kampf | Beim Trennen verlässt die Biene sofort die Welt; Spucke im Flug verfällt. |
| Content Security Policy | Noch nicht gesetzt; vor einem offenen Betrieb mit allen genutzten Quellen (Worker, WASM) ergänzen und testen. |
| Fliegen-Schreiblast | Aktive Fliegen schreiben zwei Zeilen je 100 ms; bei vielen Kämpfen wächst das Commit-Log entsprechend. |
