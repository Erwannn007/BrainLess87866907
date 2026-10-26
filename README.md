# BRAINLESS

Jeu perso en pixel art isométrique, monde ouvert dans la nature, où l'on joue Brainless
(le Nomu de l'USJ, *My Hero Academia* saison 1). Ça tourne dans Safari sur iPhone et
s'installe sur l'écran d'accueil (PWA, marche hors-ligne).

## Jouer
- **iPhone** : ouvrir l'URL GitHub Pages dans Safari → Partager → *Sur l'écran d'accueil*.
- Pouce gauche : joystick pour marcher (debout).
- **>> SPRINT** (maintenir) : galop de bête à quatre pattes qui pulvérise arbres et rochers, fait trembler l'écran et vide la barre de sprint.
- **A COUP** : tapoter = enchaînement de boxeur (direct gauche, direct droit, crochet). Maintenir = il se met en position et arme un gros coup qui souffle tout devant lui au relâchement. **^ SAUT** : saut (permet de grimper une marche de plus).
- **B CHARGE** (maintenir) : il se met sur les coudes et gonfle ; au relâchement il lève les bras et frappe le sol. Plus la charge est longue, plus la zone détruite est grande.
- Les boutons se combinent en glissant : pars de SPRINT et glisse sur SAUT ou COUP, il saute ou frappe sans arrêter de sprinter.
- Demi-tour en plein sprint : il dérape et laisse des traces ; lâcher le sprint en pleine course : il freine.
- Eau : il patauge dans l'eau peu profonde (plus lent) et nage en eau profonde (sur place quand il ne bouge pas, brasse puissante en sprint ; pas de saut ni d'attaque en nageant).
- Clavier : flèches/ZQSD, Maj = sprint, Espace = saut, J = coup, K (maintenir) = charge.
- Son : tout est synthétisé en direct (pas, galop, coups, arbres qui craquent et tombent, rochers, charge, cri, frappe au sol, vent, eau, oiseaux le jour, grillons la nuit). Icône haut-parleur en haut à droite (ou M) pour couper.
- La position, les arbres abattus et l'heure sont sauvegardés automatiquement.

## Comment c'est fait
Aucune image : tout est dessiné par code au lancement.
- `js/raster.js` : mini moteur "3D → pixel art" (capsules, z-buffer, ombrage 4 tons tramé, contours).
- `js/nomu.js` : squelette de Brainless + poses (repos, marche, course, coup, smash), cuites en frames × 8 directions.
- `js/sprites.js` : arbres, rochers, fleurs, herbes, eau animée, tuiles.
- `js/world.js` : monde infini généré par chunks (lacs, rivières, forêts, montagnes enneigées).
- `js/audio.js` : tous les sons, générés par Web Audio.
- `js/main.js` : boucle de jeu, caméra, rendu iso, contrôles tactiles, jour/nuit, particules.
- `tools/make-icons.mjs` : régénère les icônes depuis le sprite (`node tools/make-icons.mjs`).
- `tools/preview.mjs` : aperçu PNG agrandi des sprites. La charte graphique est dans `CLAUDE.md`.

Après une mise à jour, change `VERSION` dans `sw.js` pour que l'iPhone récupère la nouvelle version.
