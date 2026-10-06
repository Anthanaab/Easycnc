# Déploiement LXC Proxmox — EasyCNC

Serveur web statique (nginx + HTTPS auto-signé) dans un **conteneur LXC Debian 12**.

> Le **CNC reste branché en USB sur le PC** qui ouvre la page (Web Serial est côté
> navigateur). L'LXC ne fait que servir l'application sur le réseau, en HTTPS
> (obligatoire pour que Web Serial soit autorisé).

## Depuis l'hôte Proxmox (en root)

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/Anthanaab/Easycnc/main/deploy/proxmox/create-ct.sh)"
```

Variables surchargeables :

```bash
CTID=210 CORES=2 RAM=2048 DISK=8 STORAGE=local-lvm BRIDGE=vmbr0 \
  bash create-ct.sh
```

Par défaut : **nom `Easycnc`** et **ID choisi automatiquement** (le prochain libre
après tes conteneurs/VM existants). Le script crée le conteneur, l'installe
(Node 20, nginx, build) et affiche l'URL `https://<ip-du-conteneur>/`.

## Dans un LXC Debian/Ubuntu existant (en root)

```bash
apt-get update && apt-get install -y curl
curl -fsSL https://raw.githubusercontent.com/Anthanaab/Easycnc/main/deploy/proxmox/install.sh | bash
# ou avec options : bash install.sh <repo_url> <branche>
```

## Mise à jour

```bash
update          # dans le conteneur : MAJ système (apt) + git pull + rebuild + reload nginx
```

## Accès

Ouvre `https://<ip>/` dans **Chrome/Edge**, accepte le certificat auto-signé
(*Avancé → Continuer*), puis **Connecter** pour la CNC.

## Notes

- Si l'IP du conteneur change, régénère le certificat :
  `REGEN_CERT=1 bash install.sh`.
- Le conteneur est `unprivileged` avec `nesting=1` (nécessaire pour systemd/nginx).
- Suppression : `pct stop <CTID> && pct destroy <CTID>`.
