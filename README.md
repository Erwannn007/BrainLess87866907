# BRAINLESS

Jeu perso en pixel art isométrique, monde ouvert dans la nature, où l'on joue Brainless
(le Nomu de l'USJ, *My Hero Academia* saison 1). Ça tourne dans Safari sur iPhone et
s'installe sur l'écran d'accueil (PWA, marche hors-ligne).

## Jouer
- **iPhone** : ouvrir l'URL GitHub Pages dans Safari → Partager → *Sur l'écran d'accueil*.
- Pouce gauche : joystick (pousser à fond = courir). **A** : coup de poing. **B** : smash au sol.
- Clavier : flèches/ZQSD, Maj = marcher, Espace/J = coup, K/E = smash.
- La position, les arbres abattus et l'heure sont sauvegardés automatiquement.

## Comment c'est fait
Aucune image : tout est dessiné par code au lancement.
- `js/raster.js` : mini moteur "3D → pixel art" (capsules, z-buffer, ombrage 4 tons tramé, contours).
- `js/nomu.js` : squelette de Brainless + poses (repos, marche, course, coup, smash), cuites en frames × 8 directions.
- `js/sprites.js` : arbres, rochers, fleurs, herbes, eau animée, tuiles.
- `js/world.js` : monde infini généré par chunks (lacs, rivières, forêts, montagnes enneigées).
- `js/main.js` : boucle de jeu, caméra, rendu iso, contrôles tactiles, jour/nuit, particules.
- `tools/make-icons.mjs` : régénère les icônes depuis le sprite (`node tools/make-icons.mjs`).

Après une mise à jour, change `VERSION` dans `sw.js` pour que l'iPhone récupère la nouvelle version.
