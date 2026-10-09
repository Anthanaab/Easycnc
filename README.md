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
  Machine référencée (`$H`), le contrôle se fait en **coordonnées machine** (origine de travail
  et Z de sécurité compris, courses `$130-$132`) ; sinon, contrôle approximatif sur le plateau.
- Démarrage seulement si GRBL est **Idle** ; lignes trop longues pour GRBL refusées avant envoi.
- « Programme terminé » n'est annoncé qu'une fois les **mouvements réellement finis** (`G4 P0`).
- Sur **erreur GRBL** en cours de programme, ou sur **Stop** : feed hold, attente de l'arrêt,
  puis reset (la position est conservée). Le bouton **Reset** reste un arrêt immédiat.
- Pendant un programme, les commandes manuelles (console, jog, palpage…) sont **refusées**,
  sauf pendant une **pause M0** (changement d'outil) où la machine est à l'arrêt ; l'état modal
  (unités, G90/G91, avance, broche) est restauré à la reprise.
- Jog continu borné à la course machine et annulé si la fenêtre perd le focus.
- Fermer la page pendant un programme demande confirmation.
- **Reprise à une ligne** (après coupure / arrêt) : état modal rejoué, Z de sécurité,
  placement, broche relancée puis plongée. Refusée si ambiguë (G91, G92, G53, arc modal).
- Import SVG nettoyé (scripts, gestionnaires d'événements, liens externes retirés).
- Un programme **LASER** ne démarre que si `$32=1` ; un programme de **fraisage** refuse `$32=1`.
- **Lunettes** obligatoires en laser, surveillance permanente, main sur l'arrêt d'urgence.
- Les profils/paramètres fournis sont **indicatifs** : vérifiez-les sur votre machine.

## Tests

```bash
npm run typecheck
npm test                # tests unitaires (Vitest) : protocole GRBL, streamer, FAO, G-code
npm run test:e2e        # nécessite : npm run test:install (une fois)
```

`npm run build` exécute aussi les tests unitaires. La CI GitHub Actions
(`.github/workflows/ci.yml`) lance typecheck, tests, build et tests e2e à chaque push / PR.

### Vérification sur la machine (après une mise à jour)

À faire **en essai à blanc** (fraise au-dessus de la pièce, ou sans fraise) :

1. Connexion : la console affiche la bannière `Grbl …` puis les réglages `$$`.
2. Homing, puis palpage Z0 ; vérifier Z0 dans le DRO.
3. Programme avec changement d'outil (2 fraises) : à la pause M0, jog et re-palpage
   doivent marcher, « Reprendre » relance la broche puis continue.
4. **Stop** en pleine coupe : la machine décélère puis s'arrête, broche coupée,
   pas d'alarme ; la position reste valable.
5. Reprise à une ligne après un Stop.
6. Laser (`$32=1`) : focus à faible puissance, le point doit s'allumer.

## Pile technique

React + TypeScript + Vite · Three.js (3D) · Clipper (offsets/booléens) ·
opentype.js (texte) · JSZip (PCB) · Web Serial (GRBL) · PWA (vite-plugin-pwa).

## Licence & contribution

- Licence **MIT** — voir [`LICENSE`](LICENSE).
- Licences des composants tiers (polices, bibliothèques) — voir [`THIRD_PARTY.md`](THIRD_PARTY.md).
- Pour contribuer — voir [`CONTRIBUTING.md`](CONTRIBUTING.md).
- Déploiement LXC Proxmox — voir [`deploy/proxmox/README.md`](deploy/proxmox/README.md).
