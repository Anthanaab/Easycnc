#!/usr/bin/env bash
# EasyCNC - création d'un conteneur LXC sur Proxmox VE (dans le style des Proxmox VE Helper-Scripts).
# À lancer en root sur l'hôte Proxmox :   bash easycnc.sh
# Variables facultatives : REPO, GITHUB_TOKEN (dépôt privé), CTID, CT_NAME, DISK, CORES, MEMORY, BRIDGE, IP, GW, STORAGE
set -Eeuo pipefail

APP="EasyCNC"
REPO="${REPO:-https://github.com/Anthanaab/Easycnc.git}"
LOG="/tmp/easycnc-install.log"
: > "$LOG"

# ---------- affichage ----------
YW=$'\033[33m'; GN=$'\033[1;92m'; RD=$'\033[01;31m'; BL=$'\033[36m'; DM=$'\033[2m'; CL=$'\033[m'
header_info() {
  clear
  cat <<"EOF"
  ______                 _____ _   _  _____
 |  ____|               / ____| \ | |/ ____|
 | |__   __ _ ___ _   _| |    |  \| | |
 |  __| / _` / __| | | | |    | . ` | |
 | |___| (_| \__ \ |_| | |____| |\  | |____
 |______\__,_|___/\__, |\_____|_| \_|\_____|
                   __/ |
                  |___/     Logiciel CNC en ligne (LXC)
EOF
  echo
}
msg_info()  { printf ' %s⏳ %s...%s' "$YW" "$1" "$CL"; }
msg_ok()    { printf '\r\033[K %s✔️  %s%s\n' "$GN" "$1" "$CL"; }
msg_error() { printf '\r\033[K %s✖️  %s%s\n' "$RD" "$1" "$CL" >&2; }
on_error() {
  msg_error "Erreur ligne $1. Dernières lignes du journal ($LOG) :"
  tail -n 15 "$LOG" >&2 || true
  exit 1
}
trap 'on_error $LINENO' ERR
run() { "$@" >>"$LOG" 2>&1; }

# ---------- vérifications ----------
[ "$(id -u)" -eq 0 ] || { echo "Lancez ce script en root sur l'hôte Proxmox." >&2; exit 1; }
command -v pct >/dev/null && command -v pvesm >/dev/null || { echo "Ce script doit tourner sur un hôte Proxmox VE." >&2; exit 1; }
command -v whiptail >/dev/null || { echo "whiptail est requis (apt install whiptail)." >&2; exit 1; }

header_info
whiptail --backtitle "EasyCNC" --title "$APP LXC" --yesno "Ceci va créer un nouveau conteneur LXC $APP.\n\nContinuer ?" 10 58 || exit 0

# ---------- réglages par défaut ----------
CTID="${CTID:-$(pvesh get /cluster/nextid)}"
CT_NAME="${CT_NAME:-easycnc}"
DISK="${DISK:-4}"; CORES="${CORES:-1}"; MEMORY="${MEMORY:-512}"
BRIDGE="${BRIDGE:-vmbr0}"; IP="${IP:-dhcp}"; GW="${GW:-}"
STORAGE="${STORAGE:-$(pvesm status -content rootdir | awk 'NR>1 {print $1}' | head -1)}"
TEMPLATE_STORAGE="${TEMPLATE_STORAGE:-$(pvesm status -content vztmpl | awk 'NR>1 {print $1}' | head -1)}"

ask() { # ask "Titre" "Question" "défaut" -> valeur
  whiptail --backtitle "EasyCNC" --title "$1" --inputbox "$2" 9 60 "$3" 3>&1 1>&2 2>&3
}

MODE=$(whiptail --backtitle "EasyCNC" --title "RÉGLAGES" --menu "Choisissez le mode d'installation :" 12 62 3 \
  1 "Réglages par défaut" \
  2 "Réglages avancés" \
  3 "Annuler" 3>&1 1>&2 2>&3) || exit 0
[ "$MODE" = "3" ] && exit 0

if [ "$MODE" = "2" ]; then
  CTID=$(ask "ID du conteneur" "ID du conteneur :" "$CTID")
  CT_NAME=$(ask "Nom d'hôte" "Nom d'hôte :" "$CT_NAME")
  CORES=$(ask "Processeur" "Nombre de cœurs :" "$CORES")
  MEMORY=$(ask "Mémoire" "RAM (Mo) :" "$MEMORY")
  DISK=$(ask "Disque" "Taille du disque (Go) :" "$DISK")
  STORAGE=$(ask "Stockage" "Stockage du conteneur :" "$STORAGE")
  BRIDGE=$(ask "Réseau" "Pont réseau :" "$BRIDGE")
  IP=$(ask "Adresse IP" "IP au format 192.168.1.50/24, ou 'dhcp' :" "$IP")
  if [ "$IP" != "dhcp" ]; then GW=$(ask "Passerelle" "Passerelle (ex. 192.168.1.1) :" "$GW"); fi
fi

if [ -z "${GITHUB_TOKEN:-}" ]; then
  # dépôt public : lisible sans jeton ; sinon on demande un jeton en lecture seule
  if ! curl -fsSI "${REPO%.git}" >/dev/null 2>&1; then
    GITHUB_TOKEN=$(whiptail --backtitle "EasyCNC" --title "Dépôt privé" --passwordbox \
      "Le dépôt n'est pas accessible publiquement.\nJeton d'accès GitHub (lecture seule) :" 10 62 3>&1 1>&2 2>&3) || exit 0
  fi
fi
GITHUB_TOKEN="${GITHUB_TOKEN:-}"

header_info
printf ' %sConteneur%s  %s (%s)   %sRessources%s  %s cœur(s), %s Mo, %s Go sur %s\n' "$BL" "$CL" "$CTID" "$CT_NAME" "$BL" "$CL" "$CORES" "$MEMORY" "$DISK" "$STORAGE"
printf ' %sRéseau%s     %s sur %s %s\n\n' "$BL" "$CL" "$IP" "$BRIDGE" "${GW:+(passerelle $GW)}"

# ---------- création ----------
msg_info "Téléchargement du modèle Debian 12"
run pveam update
TEMPLATE="$(pveam list "$TEMPLATE_STORAGE" | awk '/debian-12-standard/ {print $1}' | sed 's|.*/||' | sort -V | tail -1)"
if [ -z "$TEMPLATE" ]; then
  TEMPLATE="$(pveam available --section system | awk '/debian-12-standard/ {print $2}' | sort -V | tail -1)"
  run pveam download "$TEMPLATE_STORAGE" "$TEMPLATE"
fi
msg_ok "Modèle Debian 12 prêt"

NET="name=eth0,bridge=$BRIDGE,ip=$IP"
[ "$IP" != "dhcp" ] && [ -n "$GW" ] && NET="$NET,gw=$GW"
msg_info "Création du conteneur LXC $CTID"
run pct create "$CTID" "$TEMPLATE_STORAGE:vztmpl/$TEMPLATE" \
  --hostname "$CT_NAME" --cores "$CORES" --memory "$MEMORY" --swap 256 \
  --rootfs "$STORAGE:$DISK" --net0 "$NET" --tags "cnc;easycnc" \
  --unprivileged 1 --onboot 1 --start 1
msg_ok "Conteneur LXC $CTID créé et démarré"

msg_info "Attente du réseau"
for _ in $(seq 1 60); do
  pct exec "$CTID" -- getent hosts deb.debian.org >/dev/null 2>&1 && break
  sleep 2
done
pct exec "$CTID" -- getent hosts deb.debian.org >/dev/null 2>&1 || { msg_error "Pas de réseau dans le conteneur"; exit 1; }
CT_IP=""
for _ in $(seq 1 20); do
  CT_IP="$(pct exec "$CTID" -- hostname -I | awk '{print $1}')"
  [ -n "$CT_IP" ] && break
  sleep 1
done
msg_ok "Réseau opérationnel ($CT_IP)"

# ---------- installation dans le conteneur ----------
INNER="$(mktemp)"
cat > "$INNER" <<EOF
#!/usr/bin/env bash
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y git ca-certificates
TOKEN='$GITHUB_TOKEN'
if [ -n "\$TOKEN" ]; then
  git clone "https://\$TOKEN@${REPO#https://}" /opt/easycnc
  git -C /opt/easycnc remote set-url origin '$REPO'
  git config --global credential.helper store
  echo "https://\$TOKEN@github.com" > /root/.git-credentials
  chmod 600 /root/.git-credentials
else
  git clone '$REPO' /opt/easycnc
fi
chmod +x /opt/easycnc/deploy/*.sh
/opt/easycnc/deploy/install.sh "$CT_IP"
printf '#!/usr/bin/env bash\nexec /opt/easycnc/deploy/update.sh "\$@"\n' > /usr/bin/update
chmod +x /usr/bin/update
EOF
run pct push "$CTID" "$INNER" /root/inner.sh --perms 700
rm -f "$INNER"

msg_info "Installation d'$APP (git, Caddy, HTTPS interne)"
run pct exec "$CTID" -- bash /root/inner.sh
run pct exec "$CTID" -- rm -f /root/inner.sh
msg_ok "$APP installé"

DESC="<div align='center'><h2>EasyCNC</h2><p><a href='https://$CT_IP' target='_blank'>Ouvrir https://$CT_IP</a></p><p>Mise à jour : commande <code>update</code> dans le conteneur</p></div>"
run pct set "$CTID" --description "$DESC"
msg_ok "Terminé !"

echo
printf ' %s%s est accessible sur :%s  %shttps://%s%s\n' "$GN" "$APP" "$CL" "$BL" "$CT_IP" "$CL"
printf ' %s1er accès : « Paramètres avancés » puis « Continuer vers… » (certificat interne).%s\n' "$DM" "$CL"
printf ' %sMise à jour : tapez %supdate%s dans le conteneur (pct enter %s), ou : pct exec %s -- update%s\n' "$DM" "$YW" "$DM" "$CTID" "$CTID" "$CL"
[ "$IP" = "dhcp" ] && printf ' %sAstuce : réservez cette IP dans votre DHCP (le certificat HTTPS est lié à l'\''adresse).%s\n' "$DM" "$CL"
echo
