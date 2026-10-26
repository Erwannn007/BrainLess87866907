# BRAINLESS

Jeu perso en pixel art isométrique, monde ouvert dans la nature, où l'on joue Brainless
(le Nomu de l'USJ, *My Hero Academia* saison 1). Ça tourne dans Safari sur iPhone et
s'installe sur l'écran d'accueil (PWA, marche hors-ligne).

## Jouer
- **Accueil** : JOUER, puis choisis un monde ou crée-en un (nom, graine, villages, héros, faune, météo, relief, eau, difficulté). Chaque monde est infini, généré à partir de sa graine, et a sa propre sauvegarde. L'icône maison en haut à droite ramène à l'accueil.
- **Faim et évolution** : la faim baisse ; près d'un cadavre, N devient DÉVORER. Manger fait évoluer Brainless (niveaux : plus de vie, plus de force). Dévorer un **héros** vole son alter (ABSORPTION, BOND, MOTEUR, FER, FOUDRE).
- **Villes fortifiées** : remparts, portes, rues pavées, grosse garnison et plusieurs héros.
- **Faune** : lapins, cerfs, sangliers (qui chargent), loups en meute la nuit.
- **Météo** : pluie, neige en montagne, brouillard, orages avec la foudre qui frappe.
- **iPhone** : ouvrir l'URL GitHub Pages dans Safari → Partager → *Sur l'écran d'accueil*.
- Pouce gauche : joystick pour marcher (debout).
- **>> SPRINT** (maintenir) : galop de bête à quatre pattes qui pulvérise arbres et rochers, fait trembler l'écran et vide la barre de sprint.
- **A COUP** : tapoter = enchaînement de boxeur (direct gauche, direct droit, crochet). Maintenir = il se met en position et arme un gros coup qui souffle tout devant lui au relâchement ; pendant la charge, le joystick le fait pivoter sur place pour viser (un cône en pointillés montre la zone touchée). **^ SAUT** : saut (permet de grimper une marche de plus).
- **B CHARGE** (maintenir) : il se met sur les coudes et gonfle ; au relâchement il lève les bras et frappe le sol. Plus la charge est longue, plus la zone détruite est grande.
- Les boutons se combinent en glissant : pars de SPRINT et glisse sur SAUT ou COUP, il saute ou frappe sans arrêter de sprinter.
- Demi-tour en plein sprint : il dérape et laisse des traces ; lâcher le sprint en pleine course : il freine.
- Eau : il patauge dans l'eau peu profonde (plus lent) et nage en eau profonde (sur place quand il ne bouge pas, brasse puissante en sprint ; pas de saut ni d'attaque en nageant).
- **Manette** (AYN Thor, Xbox, PlayStation…) : stick/croix = bouger, A = saut, X = coup (maintenir = coup chargé), Y/L2 = frappe au sol, B/R1/R2/L3 = sprint, Select = son. Vibrations si la manette les gère.
- **PC** : clic gauche = coup (maintenir = chargé), clic droit = frappe au sol, F = plein écran.
- Clavier : flèches/ZQSD, Maj = sprint, Espace = saut, J = coup, K (maintenir) = charge.
- Son : tout est synthétisé en direct (pas, galop, coups, arbres qui craquent et tombent, rochers, charge, cri, frappe au sol, vent, eau, oiseaux le jour, grillons la nuit). Icône haut-parleur en haut à droite (ou M) pour couper.
- **Villages** : hameaux, villages et grands villages (chaumières, maisons à colombages, granges, auberges, tours de guet, puits, étals, champs). Chaque bâtiment tremble sous les coups, s'abîme puis s'effondre ; un coup chargé rase tout ce qui est près et abîme ce qui est plus loin. La nuit, les fenêtres et les lanternes s'allument.
- **Habitants** : paysans, paysannes, enfants, anciens, marchands. Ils te saluent quand tu es calme, rentrent dormir la nuit, fuient en criant si tu fais le méchant.
- **Chevaliers** : chaque village a sa propre garnison (1, 3 ou 5 chevaliers), sans renforts. Si tu fais le méchant, la cloche sonne et ceux qui sont assez près te chargent. Barre de VIE ; Brainless se régénère tout seul. À 0, il s'effondre et se réveille au départ.
- **Tuer** : la frappe au sol écrase ceux qui sont sous toi ; frapper quelqu'un de KO l'achève. Les morts ne reviennent pas.
- **Flair** (bouton N, touche R, L1 à la manette) : Brainless lève la tête, renifle, et une flèche indique le village le plus proche où il reste de la viande fraîche.
- **Sol abîmé** : les coups chargés fissurent le sol et creusent des cratères ; l'herbe repousse avec le temps.
- La position, les arbres abattus, les maisons détruites, le sol creusé et l'heure sont sauvegardés automatiquement.

## Comment c'est fait
Aucune image : tout est dessiné par code au lancement.
- `js/raster.js` : mini moteur "3D → pixel art" (capsules, z-buffer, ombrage 4 tons tramé, contours).
- `js/nomu.js` : squelette de Brainless + poses (repos, marche, course, coup, smash), cuites en frames × 8 directions.
- `js/sprites.js` : arbres, rochers, fleurs, herbes, eau animée, tuiles, fissures.
- `js/buildings.js` : bâtiments et objets de village (rayons iso dans des volumes), 3 états chacun.
- `js/people.js` : villageois et chevaliers (squelettes en capsules, comme Brainless).
- `js/world.js` : monde infini généré par chunks (lacs, rivières, forêts, montagnes enneigées).
- `js/audio.js` : tous les sons, générés par Web Audio.
- `js/main.js` : boucle de jeu, caméra, rendu iso, contrôles tactiles, jour/nuit, particules.
- `tools/make-icons.mjs` : régénère les icônes depuis le sprite (`node tools/make-icons.mjs`).
- `tools/preview.mjs` : aperçu PNG agrandi des sprites. La charte graphique est dans `CLAUDE.md`.

Après une mise à jour, change `VERSION` dans `sw.js` pour que l'iPhone récupère la nouvelle version.
