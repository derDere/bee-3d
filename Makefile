# ==========================================================================
# Makefile bee-3d -- einziger Einstiegspunkt fuer alle Projektbefehle.
#
# Die Logik liegt in tools/*.py (Python ist ueberall vorhanden), damit jedes
# Target unter Windows-make, Linux und WSL identisch laeuft. Triviale Docker-
# Aufrufe stehen direkt im Target.
#
# Frischer Klon -> laufendes Demo-System:  make start wait init seed open
# Neustart nach Code-Aenderung:             make stop start wait
# ==========================================================================

.DEFAULT_GOAL := help

# Per Aufruf ueberschreibbar, z. B. `make wait TIMEOUT=300` oder `make logs SERVICE=spacetimedb`.
TAIL ?= 200
TIMEOUT ?= 180

.PHONY: help compile start stop update wait init seed open logs clear

help: ## Diese Befehlsuebersicht anzeigen
	python tools/make_help.py

compile: ## Client und SpacetimeDB-Modul bauen (npm ci, Typpruefung, Bundle, Bindings, Produktions-Build)
	python tools/ensure_env.py
	python tools/compile.py

start: compile ## Stack hochfahren, Modul veroeffentlichen, in dev den Vite-Dev-Server starten
	docker compose up -d --build
	python tools/spacetimedb_publish.py
	python tools/devserver.py start

stop: ## Stack und Dev-Server herunterfahren (gemountete Daten bleiben erhalten)
	python tools/devserver.py stop
	docker compose down

update: ## (prod) Stack auf die neue Version bringen und das Modul veroeffentlichen
	docker compose pull --ignore-buildable
	docker compose build --pull
	docker compose up -d
	python tools/spacetimedb_publish.py

wait: ## Blockieren, bis alle Services und der Dev-Server betriebsbereit sind
	python tools/wait.py --timeout $(TIMEOUT)
	python tools/devserver.py wait

init: ## Weltzustand anlegen (Bienenstoecke, Nester, Blumenfelder) -- keine Demodaten
	python tools/init.py

seed: ## Demodaten schreiben (Rangliste, Stockbilanzen, Start-Wetter)
	python tools/seed.py

open: ## Das Spiel im Browser oeffnen
	python tools/open_app.py

logs: ## Service-Logs live mitverfolgen (SERVICE=<name> grenzt auf einen Service ein)
	docker compose logs -f --tail=$(TAIL) $(SERVICE)

clear: ## Alle Laufzeitdaten entfernen und den Weltzustand neu anlegen
	python tools/clear.py
