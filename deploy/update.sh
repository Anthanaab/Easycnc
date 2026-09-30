#!/usr/bin/env bash
# Met à jour EasyCNC depuis git puis republie sur Caddy. Usage (en root) : ./update.sh [IP]
# 'reset --hard' plutôt que 'pull' : le serveur ne contient aucune modification locale, et cela
# fonctionne même si l'historique du dépôt a été réécrit.
set -euo pipefail
cd "$(dirname "$0")/.."
git fetch origin
git reset --hard origin/main
chmod +x deploy/*.sh
./deploy/install.sh "$@"
