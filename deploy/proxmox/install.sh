#!/usr/bin/env bash
#
# EasyCNC - installation DANS un LXC Debian/Ubuntu (a lancer en root).
# Installe Node 22 + nginx, clone le depot, build, et sert l'app en HTTPS
# (certificat auto-signe) pour que Web Serial fonctionne via l'IP.
#
# Usage:
#   bash install.sh [REPO_URL] [BRANCH]
#   REPO_URL par defaut: https://github.com/Anthanaab/Easycnc.git
#   BRANCH   par defaut: main
#
set -euo pipefail

REPO_URL="${1:-https://github.com/Anthanaab/Easycnc.git}"
BRANCH="${2:-main}"
APP_DIR="/opt/easycnc"
WEB_DIR="/var/www/easycnc"
CERT_DIR="/etc/ssl/easycnc"

if [ "$(id -u)" -ne 0 ]; then
  echo "A executer en root (dans le conteneur LXC)." >&2
  exit 1
fi

# Garde-fou : ne jamais installer sur l'HOTE Proxmox lui-meme.
if [ -d /etc/pve ] || command -v pveversion >/dev/null 2>&1; then
  echo "ERREUR : cet hote est un noeud Proxmox." >&2
  echo "install.sh doit tourner DANS le conteneur LXC." >&2
  echo "Sur l'hote, cree d'abord le conteneur avec :" >&2
  echo "  bash -c \"\$(curl -fsSL https://raw.githubusercontent.com/Anthanaab/Easycnc/main/deploy/proxmox/create-ct.sh)\"" >&2
  exit 1
fi

echo "==> Paquets de base"
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y git curl ca-certificates nginx openssl

echo "==> Node.js 22 (NodeSource)"
if ! command -v node >/dev/null 2>&1 || [ "$(node -v | sed 's/v//;s/\..*//')" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

echo "==> Utilisateur de service 'easycnc' (build et mises a jour sans root)"
if ! id easycnc >/dev/null 2>&1; then
  useradd --system --home-dir /var/lib/easycnc --create-home --shell /usr/sbin/nologin easycnc
fi
# HOME explicite : sinon npm/git peuvent tenter d'ecrire dans /root (EACCES).
as_app() { runuser -u easycnc -- env HOME=/var/lib/easycnc "$@"; }

echo "==> Recuperation du depot"
mkdir -p "$APP_DIR"
if [ -d "$APP_DIR/.git" ]; then
  # Installation precedente faite en root : on rend le depot a l'utilisateur de service.
  chown -R easycnc:easycnc "$APP_DIR"
  as_app git -C "$APP_DIR" remote set-url origin "$REPO_URL"
else
  chown easycnc:easycnc "$APP_DIR"
  as_app git clone --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
fi

echo "==> Dossier web"
mkdir -p "$WEB_DIR"
# Ancienne installation : fichiers servis directement a la racine -> on les retire
# (desormais : releases/<version> + lien "current").
if [ ! -L "$WEB_DIR/current" ]; then
  find "$WEB_DIR" -mindepth 1 -maxdepth 1 ! -name releases -exec rm -rf {} +
fi
chown -R easycnc:easycnc "$WEB_DIR"

echo "==> Build + deploiement"
as_app env BRANCH="$BRANCH" APP_DIR="$APP_DIR" WEB_DIR="$WEB_DIR" bash "$APP_DIR/deploy/proxmox/update-app.sh"

echo "==> Certificat auto-signe"
IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
HOST="$(hostname)"
mkdir -p "$CERT_DIR"
if [ ! -f "$CERT_DIR/cert.pem" ] || [ -n "${REGEN_CERT:-}" ]; then
  openssl req -x509 -newkey rsa:2048 -nodes \
    -keyout "$CERT_DIR/key.pem" -out "$CERT_DIR/cert.pem" -days 825 \
    -subj "/CN=EasyCNC" \
    -addext "subjectAltName=IP:${IP},IP:127.0.0.1,DNS:${HOST},DNS:localhost"
  chmod 600 "$CERT_DIR/key.pem"
fi

echo "==> Service de mise a jour depuis l'interface web"
cat > /etc/systemd/system/easycnc-updater.service <<UNIT
[Unit]
Description=EasyCNC - mise a jour depuis l'interface web
After=network-online.target
Wants=network-online.target

[Service]
User=easycnc
Group=easycnc
Environment=APP_DIR=$APP_DIR
Environment=WEB_DIR=$WEB_DIR
Environment=BRANCH=$BRANCH
Environment=PORT=8787
ExecStart=/usr/bin/node $APP_DIR/deploy/proxmox/update-server.mjs
Restart=on-failure
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable easycnc-updater
systemctl restart easycnc-updater

echo "==> Configuration nginx"
cat > /etc/nginx/sites-available/easycnc <<NGINX
server {
  listen 80 default_server;
  listen [::]:80 default_server;
  return 301 https://\$host\$request_uri;
}
server {
  listen 443 ssl default_server;
  listen [::]:443 ssl default_server;
  ssl_certificate     $CERT_DIR/cert.pem;
  ssl_certificate_key $CERT_DIR/key.pem;
  root $WEB_DIR/current;
  index index.html;
  # Service worker et page d'entree jamais mis en cache HTTP : les mises a
  # jour sont detectees tout de suite.
  location = /sw.js {
    add_header Cache-Control "no-cache";
  }
  location = /index.html {
    add_header Cache-Control "no-cache";
  }
  location /api/ {
    proxy_pass http://127.0.0.1:8787;
    proxy_set_header Host \$host;
    proxy_read_timeout 60s;
  }
  location / {
    try_files \$uri \$uri/ /index.html;
  }
}
NGINX
rm -f /etc/nginx/sites-enabled/default
ln -sf /etc/nginx/sites-available/easycnc /etc/nginx/sites-enabled/easycnc
nginx -t
systemctl enable nginx
systemctl restart nginx

# commande de mise a jour (systeme + EasyCNC + configuration)
cat > /usr/local/bin/update <<UPD
#!/usr/bin/env bash
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
echo "==> Mise a jour du systeme"
apt-get update
apt-get -y upgrade
echo "==> Mise a jour d'EasyCNC (et de sa configuration)"
runuser -u easycnc -- env HOME=/var/lib/easycnc git -C $APP_DIR pull --ff-only origin $BRANCH
bash $APP_DIR/deploy/proxmox/install.sh "$REPO_URL" "$BRANCH"
UPD
chmod +x /usr/local/bin/update
# /usr/bin est toujours dans le PATH (certains conteneurs n'ont pas /usr/local/bin).
ln -sf /usr/local/bin/update /usr/bin/update

echo "==> Verification du service de mise a jour"
UPDATER_OK=0
for _ in 1 2 3 4 5 6 7 8 9 10; do
  if curl -fsk https://127.0.0.1/api/update/status >/dev/null 2>&1; then UPDATER_OK=1; break; fi
  sleep 1
done
if [ "$UPDATER_OK" = 1 ]; then
  echo "    OK : la mise a jour depuis l'interface est active."
else
  echo "    ATTENTION : /api/update ne repond pas. Diagnostic :" >&2
  systemctl --no-pager status easycnc-updater >&2 || true
  journalctl -u easycnc-updater -n 20 --no-pager >&2 || true
fi

echo
echo "======================================================"
echo " EasyCNC installe."
echo " Ouvre : https://${IP}/  (certificat auto-signe a accepter)"
echo " Mise a jour : bouton dans Reglages > Mise a jour, ou commande 'update'"
echo "======================================================"
