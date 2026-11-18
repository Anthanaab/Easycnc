#!/usr/bin/env bash
#
# Met a jour EasyCNC (git pull + build + deploiement atomique).
# Tourne sous l'utilisateur "easycnc" (service de mise a jour web, ou
# commande "update" via runuser) : aucun droit root necessaire.
#
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/easycnc}"
WEB_DIR="${WEB_DIR:-/var/www/easycnc}"   # contient releases/ et le lien current
BRANCH="${BRANCH:-main}"

cd "$APP_DIR"
echo "==> Version actuelle : $(git rev-parse --short HEAD)"
echo "==> Recuperation de la derniere version ($BRANCH)"
git fetch --quiet origin "$BRANCH"
git checkout --quiet "$BRANCH"
git merge --ff-only "origin/$BRANCH"
echo "==> Nouvelle version : $(git rev-parse --short HEAD)"

echo "==> Dependances"
npm ci --no-audit --no-fund

echo "==> Build (typecheck + tests + build)"
npm run build

echo "==> Deploiement"
# Chaque version dans releases/<commit>, servie via le lien "current" :
# la bascule est atomique (jamais de site servi a moitie copie).
RELEASE="$(git rev-parse --short HEAD)-$(date +%Y%m%d%H%M%S)"
mkdir -p "$WEB_DIR/releases"
cp -r "$APP_DIR/dist" "$WEB_DIR/releases/$RELEASE"
ln -sfn "releases/$RELEASE" "$WEB_DIR/current.tmp"
# Remplacement atomique du lien (GNU : -T ; BSD/macOS : -h).
mv -T "$WEB_DIR/current.tmp" "$WEB_DIR/current" 2>/dev/null || mv -fh "$WEB_DIR/current.tmp" "$WEB_DIR/current"
# Garde les 2 dernieres versions.
ls -1dt "$WEB_DIR"/releases/* | tail -n +3 | xargs -r rm -rf
echo "==> Termine : $(git log -1 --format='%h %s')"
