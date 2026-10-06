export interface TutorialSection {
  title: string
  items: string[]
}

export const TUTORIAL: TutorialSection[] = [
  {
    title: "Réglage de la machine",
    items: [
      "Connecter la CNC en USB (Web Serial), choisir le profil machine correct.",
      "Réglages GRBL : lire $$ et sauvegarder avant toute modification.",
      "Vérifier $130/$131/$132 (courses), $100-102 (pas/mm), $110-112 (vitesses max).",
      "Activer le homing ($22=1) et vérifier le sens du Z ($23) avec le plateau retiré.",
      "Régler le palpeur ($6) et tester le palpage Z guidé.",
    ],
  },
  {
    title: "Avant chaque travail",
    items: [
      "Fixer solidement la pièce et vérifier le serrage de la fraise.",
      "Dégager un Z de sécurité suffisant.",
      "Définir l'origine (coin de la pièce) et palper le Z0.",
      "Lancer un essai à blanc (Z rehaussé, broche coupée).",
      "Porter lunettes/protection, main sur l'arrêt d'urgence.",
    ],
  },
  {
    title: "Conception 2D (fraisage)",
    items: [
      "Ajouter des formes ou importer un SVG / texte.",
      "Choisir matériau + fraise, vérifier les paramètres calculés.",
      "Définir l'opération (contour ext/int, sur le tracé, poche, V-carve).",
      "Générer et vérifier l'aperçu, puis charger dans Pilotage.",
    ],
  },
  {
    title: "Usinages spéciaux",
    items: [
      "Tenons : activer et régler largeur/hauteur/espacement pour retenir la pièce.",
      "Surfaçage : passer sur toute la surface avant le reste.",
      "V-carve : fraise V et opération « V-carve », profondeur = docMax de la fraise.",
    ],
  },
  {
    title: "Mode laser",
    items: [
      "Vérifier le mode laser $32=1.",
      "Renseigner la puissance max (S) du module et mettre des lunettes adaptées.",
      "Cadrer à faible puissance pour positionner la pièce.",
      "Faire un essai sur une chute avant la pièce finale.",
    ],
  },
  {
    title: "PCB",
    items: [
      "Importer Gerber (cuivre, contour) et Excellon (perçage).",
      "Isolation avec une fraise V : écartement + passes multiples.",
      "Palper la grille pour le nivellement automatique du plateau.",
      "Percer puis détourer (tenons pour maintenir la carte).",
    ],
  },
  {
    title: "Relief 3D",
    items: [
      "Importer une image en niveaux de gris.",
      "Régler la résolution (pas) et la profondeur max.",
      "Utiliser une fraise sphérique ; simuler la durée avant de lancer.",
    ],
  },
  {
    title: "Dépannage",
    items: [
      "Alarme : déverrouiller avec $X, vérifier $20/$21 et les fin de course.",
      "Position perdue : refaire le homing.",
      "Perte de pas : réduire avance/passe, vérifier $100-102.",
      "Palpage en échec : vérifier le câblage et $6.",
    ],
  },
]
