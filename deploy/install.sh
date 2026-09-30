#!/usr/bin/env bash
# Installe / met à jour EasyCNC dans un LXC Debian 12 ou Ubuntu 24.04 :
#   - Caddy (HTTPS avec certificat interne) qui sert l'appli et transmet /api au service de stockage ;
#   - service easycnc-api (Python 3) qui enregistre réglages et projets dans /var/lib/easycnc.
# Usage (en root, depuis le dossier deploy/) :  ./install.sh [IP]
set -euo pipefail

IP="${1:-$(hostname -I | awk '{print $1}')}"
SRC="$(cd "$(dirname "$0")/.." && pwd)"
WEB=/var/www/easycnc
DATA=/var/lib/easycnc
PORT=8787

export DEBIAN_FRONTEND=noninteractive
NEED=()
command -v caddy >/dev/null 2>&1 || NEED+=(caddy)
command -v python3 >/dev/null 2>&1 || NEED+=(python3)
if [ "${#NEED[@]}" -gt 0 ]; then
  apt-get update
  apt-get install -y "${NEED[@]}"
fi

# Fichiers de l'application (statiques)
mkdir -p "$WEB"
rm -rf "$WEB"/index.html "$WEB"/css "$WEB"/js
cp -r "$SRC"/index.html "$SRC"/css "$SRC"/js "$WEB"/

# Service de stockage (utilisateur système dédié ; les données sont conservées entre les mises à jour)
id -u easycnc >/dev/null 2>&1 || useradd --system --home-dir "$DATA" --shell /usr/sbin/nologin easycnc
mkdir -p "$DATA"
chown -R easycnc:easycnc "$DATA"
chmod 750 "$DATA"
cat > /etc/systemd/system/easycnc-api.service <<UNIT
[Unit]
Description=EasyCNC - stockage des reglages et des projets
After=network.target

[Service]
User=easycnc
Group=easycnc
Environment=EASYCNC_DATA=$DATA
Environment=EASYCNC_PORT=$PORT
ExecStart=/usr/bin/python3 $SRC/server/easycnc_api.py
Restart=on-failure
RestartSec=3
NoNewPrivileges=yes

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable easycnc-api >/dev/null 2>&1
systemctl restart easycnc-api

# HTTPS sur l'IP avec un certificat émis par l'autorité interne de Caddy (Web Serial exige HTTPS).
cat > /etc/caddy/Caddyfile <<CADDY
https://$IP {
	tls internal
	encode gzip

	handle /api/* {
		reverse_proxy 127.0.0.1:$PORT
	}

	handle {
		root * $WEB
		file_server
	}
}

http://$IP {
	redir https://$IP{uri} permanent
}
CADDY

systemctl enable --now caddy
systemctl reload caddy || systemctl restart caddy

# Vérification du service de stockage
sleep 1
if python3 - "$PORT" <<'PY'
import sys, urllib.request, json
try:
    r = json.load(urllib.request.urlopen('http://127.0.0.1:%s/api/ping' % sys.argv[1], timeout=3))
    sys.exit(0 if r.get('ok') else 1)
except Exception:
    sys.exit(1)
PY
then
  API="OK (données dans $DATA)"
else
  API="NON DISPONIBLE - consultez : journalctl -u easycnc-api -n 30"
fi

echo
echo "EasyCNC disponible sur : https://$IP"
echo "Stockage serveur : $API"
echo "Certificat racine (à installer sur le PC pour supprimer l'avertissement) :"
echo "  /var/lib/caddy/.local/share/caddy/pki/authorities/local/root.crt"
