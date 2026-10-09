# Contribuer à EasyCNC

Merci pour l'intérêt porté au projet ! Ce guide résume l'essentiel.

## Prérequis

- **Node.js 20+** et npm
- **Chrome ou Edge** pour tester la connexion Web Serial à la CNC

## Installation (développement)

```bash
git clone https://github.com/Anthanaab/Easycnc.git
cd Easycnc
npm install
npm run dev        # http://localhost:5173
```

Web Serial exige un **contexte sécurisé** : `localhost` convient ; pour un accès
par IP, il faut HTTPS (place un certificat dans `certs/key.pem` et
`certs/cert.pem`, Vite l'utilise automatiquement).

## Scripts

| Commande | Rôle |
|---|---|
| `npm run dev` | serveur de développement (HTTPS si `certs/` présent) |
| `npm run build` | typecheck + build de production (`dist/`) |
| `npm run preview` | prévisualiser le build |
| `npm run typecheck` | vérification TypeScript |
| `npm test` | tests unitaires (Vitest, `src/__tests__/`) |
| `npm run test:install` | installe le navigateur Playwright (une fois) |
| `npm run test:e2e` | tests end-to-end |

Avant toute PR, assure-toi que **`npm run typecheck`**, **`npm test`** et
**`npm run build`** passent. Toute modification du protocole GRBL, du streamer
ou du post-processeur doit être couverte par un test.

## Organisation du code

- `src/grbl/` — Web Serial, protocole GRBL, palpage.
- `src/cam/` — géométrie, FAO (Clipper), post-processeur, laser, PCB, relief, simulation.
- `src/data/` — profils machines, matériaux, fraises, presets laser, tutoriel.
- `src/components/` — interface (React).
- `src/state/` — stores Zustand (machine, conception, UI, projets).
- `deploy/proxmox/` — scripts de déploiement LXC.

## Conventions

- **TypeScript strict** ; pas de `any` non justifié.
- Code et commentaires : **français** cohérent avec le reste du projet.
- Toute chaîne visible par l'utilisateur passe par **l'i18n** (`useT()` / `t('…')`).
- Éviter les régressions de sécurité (limites machine, contrôle `$32`, essai à blanc).

## Branches & commits

- Branches : `feat/…`, `fix/…`, `docs/…`.
- Messages de commit clairs, à l'impératif (ex. `laser: fix focus en mouvement`).

## Pull requests

1. Décris le **problème** et la **solution**.
2. Indique comment **tester** (étapes, matériau, machine).
3. Capture d'écran/photo si c'est visuel.
4. Garde des PR **ciblées** (un sujet à la fois).

## Signaler un bug

Ouvre une *issue* avec : version/machine (profil), ce que tu attendais, ce qui
s'est passé, et les messages de la **Console** (FR/EN).
