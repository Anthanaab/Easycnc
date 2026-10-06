# EasyCNC

Logiciel **web** (100 % navigateur) pour piloter et usiner avec une CNC GRBL
(ex. Lunyee / Genmitsu 3018) : connexion USB via **Web Serial**, conception 2D,
FAO (fraisage / laser / PCB), aperçu 3D et envoi du G-code.

## Fonctionnalités

- **Pilotage** : connexion GRBL (Web Serial), DRO, jog continu (souris + clavier),
  overrides avance/broche/rapide, feed hold / cycle start, palpage Z guidé,
  essai à blanc, homing, suivi alarme/origine.
- **Machines & outils** : profils machines éditables, matériaux, **fraises créables/éditables**
  (sélecteur visuel avec icône par type), calcul automatique des paramètres de coupe.
- **Conception 2D** : formes (rectangle, cercle, polygone, étoile), **texte** (5 polices),
  **import SVG**, opérations **booléennes**, alignement/répartition, **undo/redo**,
  **magnétisme**, brut (matière) visible, déplaçable à la souris.
- **FAO fraisage** : contour ext/int, sur le tracé, poche, **V-carve**, **tenons de maintien**,
  **surfaçage**, entrée **rampe**, sens horaire/anti-horaire, optimisation des parcours,
  unités **mm/pouces (G21/G20)**, sortie **arcs G2/G3**, export `.nc`.
- **Vue 3D** : simulation d'enlèvement de matière (heightmap) selon la **forme réelle de l'outil**
  (droite, sphérique, V), brut solide, lecture/pause.
- **Laser** : contour/remplissage, gravure d'image (niveaux de gris / seuil / dithering),
  overscan, **focus Z**, compensation de trait, vérification `$32`, grille de test déplaçable, cadrage.
- **PCB** : import **Gerber** (cuivre, contour) et **Excellon** (perçage) + **ZIP**,
  isolation, perçage, détourage, **dégagement cuivre**, **nivellement automatique** du plateau.
- **Relief 3D** : depuis une image niveaux de gris, ébauche + finitions, simulation.
- **Projets** : sauvegarde/chargement/export JSON, autosave + miniatures ; **tutoriel** intégré.
- **Interface** : thème clair/sombre, **FR/EN**, PWA hors-ligne, raccourcis clavier.

## Prérequis

- **Chrome ou Edge** (Web Serial) — Firefox/Safari non supportés pour la connexion série.
- Node.js 20+ pour le développement.

## Installation & lancement

```bash
npm install
npm run dev        # https://localhost:5173
```

Web Serial exige un **contexte sécurisé**. `localhost` convient ; en accès réseau par IP,
il faut du **HTTPS**. Placez un certificat dans `certs/key.pem` et `certs/cert.pem`
(auto-signé accepté : `Avancé → Continuer`). Vite l'utilise automatiquement.

```bash
# build de production
npm run build
npm run preview
```

## Utilisation rapide

1. **Pilotage → Connecter** (sélection du port USB, 115200 bauds).
2. Réglez la machine (Réglages GRBL), faites le **homing** puis **palpez Z0**.
3. Onglet **Conception 2D** : dessinez/importez, choisissez matériau + fraise + opération,
   vérifiez l'aperçu, puis **Charger dans Pilotage**.
4. Lancez un **essai à blanc**, puis la coupe.

## Raccourcis

- `Ctrl+1…7` : changer d'onglet
- `Ctrl+Z` / `Ctrl+Shift+Z` (ou `Ctrl+Y`) : annuler / rétablir (conception)
- Flèches : jog X/Y par pas ; `Page ↑/↓` : jog Z
- `Échap` : fermer une fenêtre

## Sécurité

- Le démarrage est **bloqué** si le programme dépasse la **zone de travail** de la machine.
- Un programme **LASER** ne démarre que si `$32=1` ; un programme de **fraisage** refuse `$32=1`.
- **Lunettes** obligatoires en laser, surveillance permanente, main sur l'arrêt d'urgence.
- Les profils/paramètres fournis sont **indicatifs** : vérifiez-les sur votre machine.

## Tests

```bash
npm run typecheck
npm run test:e2e        # nécessite : npm run test:install (une fois)
```

## Pile technique

React + TypeScript + Vite · Three.js (3D) · Clipper (offsets/booléens) ·
opentype.js (texte) · JSZip (PCB) · Web Serial (GRBL) · PWA (vite-plugin-pwa).

## Licence & contribution

- Licence **MIT** — voir [`LICENSE`](LICENSE).
- Licences des composants tiers (polices, bibliothèques) — voir [`THIRD_PARTY.md`](THIRD_PARTY.md).
- Pour contribuer — voir [`CONTRIBUTING.md`](CONTRIBUTING.md).
- Déploiement LXC Proxmox — voir [`deploy/proxmox/README.md`](deploy/proxmox/README.md).
