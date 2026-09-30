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
| `js/carve.js`, `js/app.js`, `js/managers.js` | interface |

## Limites actuelles

Pas de texte (convertir en tracés dans un SVG), pas de tenons/onglets, pas de V-carve ni de 3D, simulation 2D seulement.
Testez toujours un premier programme **sans fraise / en l'air** avant de couper.
