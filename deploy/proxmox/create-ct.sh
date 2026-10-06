#!/usr/bin/env bash
#
# EasyCNC - creation d'un conteneur LXC sur un noeud Proxmox + installation.
# A lancer EN ROOT SUR L'HOTE PROXMOX.
#
# Utilisation (sur l'hote Proxmox) :
#   bash create-ct.sh
#
# L'ID du conteneur est choisi automatiquement (prochain libre apres tes CT/VM),
# le nom est "Easycnc". Surcharge possible :
#   CTID=210 CORES=2 RAM=2048 DISK=8 STORAGE=local-lvm BRIDGE=vmbr0 bash create-ct.sh
#
set -euo pipefail

CTID="${CTID:-}"
CT_HOSTNAME="${CT_HOSTNAME:-Easycnc}"
CORES="${CORES:-2}"
RAM="${RAM:-2048}"
DISK="${DISK:-8}"
STORAGE="${STORAGE:-local-lvm}"
BRIDGE="${BRIDGE:-vmbr0}"
REPO_URL="${REPO_URL:-https://github.com/Anthanaab/Easycnc.git}"
BRANCH="${BRANCH:-main}"
RAW_INSTALL="${RAW_INSTALL:-https://raw.githubusercontent.com/Anthanaab/Easycnc/${BRANCH}/deploy/proxmox/install.sh}"

if ! command -v pct >/dev/null 2>&1; then
  echo "pct introuvable : ce script doit etre lance sur un noeud Proxmox." >&2
  exit 1
fi

# ID automatique : le prochain libre apres les CT/VM existants.
if [ -z "$CTID" ]; then
  HIGHEST="$( { pct list 2>/dev/null | awk 'NR>1{print $1}'; qm list 2>/dev/null | awk 'NR>1{print $1}'; } | sort -n | tail -1 )"
  if [ -n "$HIGHEST" ]; then CTID="$((HIGHEST + 1))"; else CTID=200; fi
  while pct status "$CTID" >/dev/null 2>&1 || qm status "$CTID" >/dev/null 2>&1; do
    CTID="$((CTID + 1))"
  done
fi
echo "==> ID du conteneur : $CTID"

echo "==> Modele Debian 12"
pveam update >/dev/null 2>&1 || true
TEMPLATE_NAME="$(pveam available --section system 2>/dev/null | awk '{print $2}' | grep '^debian-12-standard' | tail -1 || true)"
if [ -z "$TEMPLATE_NAME" ]; then
  echo "Modele debian-12-standard introuvable (pveam)." >&2
  exit 1
fi
if ! pveam list local 2>/dev/null | grep -q "$TEMPLATE_NAME"; then
  echo "Telechargement de $TEMPLATE_NAME"
  pveam download local "$TEMPLATE_NAME"
fi
TEMPLATE="local:vztmpl/${TEMPLATE_NAME}"

echo "==> Creation du conteneur $CTID ($CT_HOSTNAME)"
pct create "$CTID" "$TEMPLATE" \
  --hostname "$CT_HOSTNAME" \
  --cores "$CORES" \
  --memory "$RAM" \
  --swap 512 \
  --rootfs "${STORAGE}:${DISK}" \
  --net0 "name=eth0,bridge=${BRIDGE},ip=dhcp" \
  --unprivileged 1 \
  --features nesting=1 \
  --onboot 1

echo "==> Demarrage"
pct start "$CTID"

echo "==> Attente du reseau"
for _ in $(seq 1 30); do
  if pct exec "$CTID" -- ping -c1 -W1 1.1.1.1 >/dev/null 2>&1; then break; fi
  sleep 2
done
pct exec "$CTID" -- bash -c 'command -v curl >/dev/null 2>&1 || (apt-get update && apt-get install -y curl ca-certificates)' >/dev/null 2>&1 || true

echo "==> Recuperation du script d'installation"
if [ -f "$(dirname "$0")/install.sh" ]; then
  pct push "$CTID" "$(dirname "$0")/install.sh" /root/install.sh
else
  pct exec "$CTID" -- bash -c "curl -fsSL '$RAW_INSTALL' -o /root/install.sh"
fi

echo "==> Installation dans le conteneur"
pct exec "$CTID" -- bash /root/install.sh "$REPO_URL" "$BRANCH"

IP="$(pct exec "$CTID" -- hostname -I 2>/dev/null | awk '{print $1}')"
echo
echo "======================================================"
echo " Conteneur $CTID ($CT_HOSTNAME) pret."
echo " Ouvre : https://${IP}/  (accepter le certificat auto-signe)"
echo " Console : pct enter $CTID   |   Mise a jour : pct exec $CTID -- update"
echo "======================================================"
