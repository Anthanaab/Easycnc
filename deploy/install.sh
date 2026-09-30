#!/usr/bin/env bash
# Installe / met à jour EasyCNC dans un LXC Debian 12 ou Ubuntu 24.04 (Caddy, HTTPS avec certificat interne).
# Usage (en root, depuis le dossier deploy/) :  ./install.sh [IP]
set -euo pipefail

IP="${1:-$(hostname -I | awk '{print $1}')}"
SRC="$(cd "$(dirname "$0")/.." && pwd)"
WEB=/var/www/easycnc

if ! command -v caddy >/dev/null 2>&1; then
  apt-get update
  apt-get install -y caddy
fi

# Fichiers de l'application (statiques)
mkdir -p "$WEB"
rm -rf "$WEB"/index.html "$WEB"/css "$WEB"/js
cp -r "$SRC"/index.html "$SRC"/css "$SRC"/js "$WEB"/

# HTTPS sur l'IP avec un certificat émis par l'autorité interne de Caddy.
# (Web Serial exige une page HTTPS ; au premier accès, accepter l'avertissement du navigateur.)
cat > /etc/caddy/Caddyfile <<EOF
https://$IP {
	tls internal
	root * $WEB
	encode gzip
	file_server
}

http://$IP {
	redir https://$IP{uri} permanent
}
EOF

systemctl enable --now caddy
systemctl reload caddy || systemctl restart caddy

echo
echo "EasyCNC disponible sur : https://$IP"
echo "Certificat racine (à installer sur le PC pour supprimer l'avertissement) :"
echo "  /var/lib/caddy/.local/share/caddy/pki/authorities/local/root.crt"
