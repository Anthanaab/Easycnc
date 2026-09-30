# EasyCNC

Logiciel web gratuit de dessin + G-code pour petites CNC GRBL (3018 & co). Usage personnel.

## Lancer

- Double-clic sur `index.html` (Chrome ou Edge), **ou** `powershell -File serve.ps1` puis http://localhost:8080.
- Fonctionne hors ligne : Clipper et three.js sont embarqués dans `js/vendor/`.
- La connexion USB utilise Web Serial (Chrome / Edge uniquement).

## Utilisation

1. **Dessiner** : réglez le matériau, ajoutez des formes (ou importez un SVG), choisissez pour chacune *contour extérieur / intérieur / sur le tracé / poche* et la profondeur.
2. **Fraiser** : profil machine → matériau + fraise → paramètres (calculés automatiquement, modifiables) → aperçu animé → G-code ou envoi direct à la machine.

Raccourcis : molette = zoom, Suppr, Ctrl+Z/Y, Ctrl+D (dupliquer), Ctrl+A, flèches (Maj = 10 mm, Alt = 0,1 mm), Maj+clic = multi-sélection.

## Profils

- Machines : `js/data.js` (profils intégrés, **valeurs indicatives**) + profils perso créés dans l'app (stockés dans le navigateur, exportables/importables en JSON).
- Fraises : idem. Matériaux : `js/data.js` (`MATERIALS`, charge par dent, passe, recouvrement).

## Structure

| Fichier | Rôle |
|---|---|
| `js/geometry.js` | formes, transformations, détection de clic |
| `js/toolpath.js` | parcours (offset Clipper, rampes hélicoïdales, poches) |
| `js/gcode.js` | post-processeur GRBL |
| `js/grbl.js` | Web Serial, streaming avec comptage de caractères, jog, pause/arrêt |
| `js/editor.js` | canvas : édition, historique, simulation |
| `js/booleans.js`, `js/text.js`, `js/relief.js`, `js/view3d.js` | opérations sur les formes, texte, gravure 3D, vue 3D |
| `js/carve.js`, `js/app.js`, `js/managers.js` | interface |

## Fonctions

- **Formes** : rectangle, cercle, polygone, étoile, texte (5 polices embarquées), import SVG, **relief 3D** depuis une image en niveaux de gris.
- **Édition** : déplacer / redimensionner / pivoter, multi-sélection, alignement et répartition, fusion / soustraction / intersection.
- **Usinage** : contour extérieur / intérieur, sur le tracé (gravure), poche, **V-carve** (lettres et logos en V), **tenons de maintien**, **surfaçage** du dessus.
- **Aperçu** : plan 2D et vue 3D avec matière enlevée, simulation animée, mesures.
- **Machine** : profils par marque, 33 fraises (droites, sphériques, V, hélices spéciales, surfaçage), matériaux, connexion GRBL (Web Serial), déplacements, palpage Z guidé, **essai à blanc**, chargement d’un fichier G-code, sauvegarde/restauration des réglages.

## Limites actuelles

- Le V-carve évide mal les zones très larges (fond en crêtes) : évidez-les d abord à la fraise droite.
- Relief 3D : usinage long (compter environ 1 h pour 100 × 100 mm avec une fraise de 3 mm), les bords très abrupts sont adoucis par le rayon de la fraise, et la précision est limitée par l image importée (300 px max).
- La vue 3D a une résolution d'environ 0,5 mm : elle sert à contrôler le résultat, elle n'influence pas le G-code.
- Le texte est sur une seule ligne de base (plusieurs lignes possibles), avec une police par bloc ; il ne suit pas une courbe.
- Les profils machines fournis sont indicatifs, et les paramètres de coupe calculés sont des valeurs de départ prudentes, à ajuster selon votre machine.
- Avant la première vraie coupe, lancez toujours un **essai à blanc** (option de l'onglet Fraiser : le parcours est relevé et la broche reste éteinte).

## Licences des composants embarqués (`js/vendor/`)

Clipper (Boost), three.js (MIT), opentype.js (MIT), polices Roboto (Apache 2.0), Oswald / Playfair Display / Pacifico (SIL OFL).
