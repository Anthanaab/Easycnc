#!/usr/bin/env bash
# Met à jour EasyCNC depuis git puis republie sur Caddy. Usage (en root) : ./update.sh [IP]
set -euo pipefail
cd "$(dirname "$0")/.."
git pull --ff-only
./deploy/install.sh "$@"
