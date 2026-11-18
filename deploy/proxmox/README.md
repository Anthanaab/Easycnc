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
(Node 22, nginx, build) et affiche l'URL `https://<ip-du-conteneur>/`.

## Dans un LXC Debian/Ubuntu existant (en root)

```bash
apt-get update && apt-get install -y curl
curl -fsSL https://raw.githubusercontent.com/Anthanaab/Easycnc/main/deploy/proxmox/install.sh | bash
# ou avec options : bash install.sh <repo_url> <branche>
```

## Mise à jour

**Depuis l'interface** : onglet **Réglages GRBL → Mise à jour → « Mettre à jour le
serveur »**. Le serveur récupère la dernière version (`main`), vérifie (typecheck +
tests), build et bascule le site d'un coup ; le journal s'affiche en direct. Une
fois terminé, un bandeau propose de **recharger la page**.

- Bouton désactivé pendant un programme ; la page n'est **jamais rechargée
  automatiquement** (un rechargement couperait la coupe en cours).
- En cas d'échec (build ou tests), l'ancienne version reste en service.
- Le service `easycnc-updater` tourne sous un utilisateur dédié `easycnc`
  (pas root) et ne peut qu'avancer sur la branche officielle (fast-forward).

**En ligne de commande** (dans le conteneur, en root) :

```bash
update          # MAJ système (apt) + EasyCNC + configuration (nginx, service)
```

> Installation antérieure à la mise à jour web : lancez **une fois**
> `bash /opt/easycnc/deploy/proxmox/install.sh` pour créer l'utilisateur
> `easycnc`, le service et la configuration nginx.

## Accès

Ouvre `https://<ip>/` dans **Chrome/Edge**, accepte le certificat auto-signé
(*Avancé → Continuer*), puis **Connecter** pour la CNC.

## Notes

- Si l'IP du conteneur change, régénère le certificat :
  `REGEN_CERT=1 bash install.sh`.
- Le conteneur est `unprivileged` avec `nesting=1` (nécessaire pour systemd/nginx).
- Suppression : `pct stop <CTID> && pct destroy <CTID>`.
