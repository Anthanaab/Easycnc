#!/usr/bin/env bash
#
# EasyCNC - installation DANS un LXC Debian/Ubuntu (a lancer en root).
# Installe Node 20 + nginx, clone le depot, build, et sert l'app en HTTPS
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

echo "==> Node.js 20 (NodeSource)"
if ! command -v node >/dev/null 2>&1 || [ "$(node -v | sed 's/v//;s/\..*//')" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi

echo "==> Recuperation du depot"
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" fetch --all
  git -C "$APP_DIR" checkout "$BRANCH"
  git -C "$APP_DIR" pull --ff-only origin "$BRANCH"
else
  git clone --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
fi

echo "==> Build"
cd "$APP_DIR"
npm ci
npm run build

echo "==> Deploiement web"
mkdir -p "$WEB_DIR"
rm -rf "${WEB_DIR:?}/"*
cp -r "$APP_DIR/dist/." "$WEB_DIR/"

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
  root $WEB_DIR;
  index index.html;
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

# commande de mise a jour (systeme + EasyCNC)
cat > /usr/local/bin/update <<'UPD'
#!/usr/bin/env bash
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
echo "==> Mise a jour du systeme"
apt-get update
apt-get -y upgrade
echo "==> Mise a jour d'EasyCNC"
cd /opt/easycnc
git pull --ff-only
npm ci
npm run build
rm -rf /var/www/easycnc/*
cp -r /opt/easycnc/dist/. /var/www/easycnc/
systemctl reload nginx
echo "Systeme + EasyCNC mis a jour."
UPD
chmod +x /usr/local/bin/update
# /usr/bin est toujours dans le PATH (certains conteneurs n'ont pas /usr/local/bin).
ln -sf /usr/local/bin/update /usr/bin/update

echo
echo "======================================================"
echo " EasyCNC installe."
echo " Ouvre : https://${IP}/  (certificat auto-signe a accepter)"
echo " Mise a jour : update"
echo "======================================================"
