# Composants tiers / Third-party notices

EasyCNC est distribué sous licence **MIT** (voir `LICENSE`). Il embarque ou
utilise les composants tiers suivants, soumis à leurs propres licences.

## Bibliothèques (runtime)

| Composant | Version | Licence | Projet |
|---|---|---|---|
| React / React DOM | 18 | MIT | https://react.dev |
| Three.js | 0.169 | MIT | https://threejs.org |
| opentype.js | 1.3.4 | MIT | https://opentype.js.org |
| JSZip | 3.10 | MIT | https://stuk.github.io/jszip |
| clipper-lib | 6.4.2 | Boost Software License 1.0 | http://jsclipper.sourceforge.net |
| zustand | 4 | MIT | https://github.com/pmndrs/zustand |

## Polices embarquées (`src/cam/fonts.ts`)

Les polices sont intégrées en base64 pour un usage hors-ligne.

| Police | Licence |
|---|---|
| Roboto (Regular, Bold) | Apache License 2.0 |
| Oswald | SIL Open Font License 1.1 |
| Playfair Display | SIL Open Font License 1.1 |
| Pacifico | SIL Open Font License 1.1 |

Textes de licence complets : Apache-2.0 (<https://www.apache.org/licenses/LICENSE-2.0>)
et SIL OFL 1.1 (<https://scripts.sil.org/OFL>).

## Outils de développement (non distribués)

Vite, TypeScript, `@vitejs/plugin-react`, `vite-plugin-pwa`, Playwright —
sous licences MIT / Apache-2.0, utilisés uniquement au build et aux tests.

## Source des polices

Les données de police (`src/cam/fonts.ts`) proviennent du dépôt
[Anthanaab/Easycnc](https://github.com/Anthanaab/Easycnc).
