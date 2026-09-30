# Déploiement EasyCNC sur un LXC (accès par IP sur le LAN)

EasyCNC est un site statique : le serveur ne fait que livrer les fichiers. La CNC reste branchée en USB sur le PC
qui ouvre la page (Web Serial), pas sur le serveur.

## Pourquoi HTTPS

Web Serial n'est autorisé que sur une page « sécurisée » (HTTPS ou localhost). En `http://192.168.x.x`, tout marche
sauf le bouton « Connecter la machine ». Le script met donc Caddy en HTTPS avec un certificat interne.

## Installation

1. Créer un LXC Debian 12 (ou Ubuntu 24.04), lui donner une IP fixe (ex. 192.168.1.50).
2. Copier le dossier `EasyCNC` dans le conteneur (scp, `pct push`, partage…).
3. En root :

```bash
cd EasyCNC/deploy
chmod +x install.sh
./install.sh            # détecte l'IP du conteneur ; ou : ./install.sh 192.168.1.50
```

4. Ouvrir `https://<IP>` dans Chrome ou Edge. Au premier accès : **Paramètres avancés → Continuer vers…**
   (certificat non reconnu, c'est normal). Le bouton « Connecter la machine » fonctionne ensuite.

## Mise à jour (avec git, recommandé)

Cloner le dépôt dans le conteneur (`git clone <url> EasyCNC`, puis `cd EasyCNC/deploy && ./install.sh`). Ensuite, à chaque mise à jour :

```bash
cd EasyCNC/deploy && ./update.sh    # git pull + republication
```

## Mise à jour (sans git)

Recopier le dossier puis relancer `./install.sh` : il remplace les fichiers, sans toucher à la configuration.

## Création automatique du conteneur (Proxmox, style Helper-Scripts)

Le dépôt étant public, une seule commande suffit sur l'hôte Proxmox, en root :

```bash
bash -c "$(wget -qLO - https://raw.githubusercontent.com/Anthanaab/Easycnc/main/deploy/easycnc.sh)"
```

(Ou copier `easycnc.sh` sur l'hôte et lancer `bash easycnc.sh`.)

Un menu propose des réglages par défaut (DHCP, 1 cœur, 512 Mo, 4 Go) ou avancés (ID, IP fixe, stockage…). Le script crée
le LXC Debian 12, installe git + Caddy, clone le dépôt et publie l'appli en HTTPS. Un jeton GitHub n'est demandé que si le
dépôt est privé.

Mise à jour : taper `update` dans le conteneur (`pct enter <CTID>`) ou `pct exec <CTID> -- update` depuis l'hôte.

## Supprimer l'avertissement (facultatif)

Installer le certificat racine du serveur (`/var/lib/caddy/.local/share/caddy/pki/authorities/local/root.crt`) dans
les « Autorités de certification racines de confiance » de Windows du PC de l'atelier (double-clic → Installer).

## À savoir

- Profils machines, fraises perso et projet en cours sont enregistrés **dans le navigateur**, par adresse : changer
  d'IP ou de navigateur = repartir de zéro. Utiliser « Enregistrer » et « Exporter mes profils » pour les sauvegarder.
- Aucune authentification : à garder sur le réseau local.
- Si l'IP du conteneur change, relancer `./install.sh <nouvelle IP>` (le certificat est lié à l'adresse).
- Ubuntu 22.04 n'a pas Caddy dans ses dépôts : utiliser Debian 12 / Ubuntu 24.04, ou installer Caddy via son dépôt officiel.
