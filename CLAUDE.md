# BRAINLESS — charte de design et règles du projet

Jeu perso en pixel art isométrique, monde ouvert dans la nature, où l'on joue **Brainless**
(le Nomu de l'USJ, *My Hero Academia* saison 1). PWA hébergée sur GitHub Pages, jouée dans
Safari iOS et installée sur l'écran d'accueil. Tout est en JS vanilla (modules ES), **sans
aucune image ni son externe** : chaque sprite et chaque son est généré par code au lancement.

Avant de créer ou de modifier un sprite, relis cette charte et regarde les planches de
référence `docs/ref-brainless.png`, `docs/ref-nature.png`, `docs/ref-village.png`,
`docs/ref-people.png` et `docs/ref-beasts.png` (avec l'outil Read) : tout ce qui est nouveau doit avoir l'air de sortir
du même jeu.

---

## 1. Les règles d'or du style

1. **Pas d'images dessinées à la main dans des fichiers.** On construit un modèle (capsules +
   sphères) ou on dessine pixel par pixel dans un buffer, et on « cuit » le sprite au lancement.
2. **Isométrique 2:1 strict.** Caméra à 30° (`SIN_A = 0.5`, `COS_A = 0.866`), tuile = losange
   de 32×16 px, une marche de hauteur = 8 px.
3. **Rampe de 4 tons par matière**, du plus sombre au plus clair (`ramp(ombre, sombre, base,
   lumière)`). Jamais de dégradé lisse, jamais d'anti-aliasing.
4. **Lumière unique en haut à gauche, légèrement devant** (`L = norm(-0.55, -0.7, 0.5)`).
   Les ombres tombent en bas à droite.
5. **Tramage Bayer 4×4** à la frontière entre deux tons (déjà fait par `renderModel`).
6. **Contour « sel-out »** : le contour n'est pas noir pur. C'est la couleur du pixel voisin
   multipliée par environ 0.28 (sprites 3D) ou 0.3–0.45 (sprites dessinés à la main).
   Plus des lignes internes là où une partie passe nettement devant une autre (groupes
   différents, écart de profondeur > 2.5).
7. **Texture par pixels « bruités »** : `hash(x, y, seed)` pour assombrir ~15 % des pixels et en
   éclaircir ~7 %. Ça donne le grain feuillage / roche / herbe. Pas de motif régulier visible.
8. **Couleurs saturées mais pas fluo.** Verts naturels, bleus profonds pour l'eau, tons terre.
   Le néon est réservé aux effets d'énergie (charge) et aux lucioles.
9. **Tout bouge un peu** : végétation qui se balance doucement avec le vent (horloge `swayT`, qui
   avance plus vite quand `windT` souffle après les gros coups ou l'orage ; ne jamais multiplier `time`
   par une rafale, ça fait clignoter), eau animée sur 4 frames, respiration au repos.
10. **Lisible à la taille réelle.** Le jeu s'affiche à environ 240 px de haut en pixels logiques. Un
    détail de moins de 2 px ne se verra pas. Toujours juger un sprite à ×1 *et* agrandi.

## 2. Résolution et projection

- Écran : la plus petite dimension fait ~240 pixels de jeu, mis à l'échelle par un facteur
  **entier** de pixels physiques (`resize()` dans `main.js`) pour rester net.
- Monde → écran : `isoX = (x - y) * 16`, `isoY = (x + y) * 8`, hauteur soustraite à `y`.
- Ordre de dessin : rangée par rangée (diagonales `d = x + y`). Dans une rangée : tuiles,
  puis traces au sol, puis objets et joueur triés par profondeur.
- Un objet a son **point d'ancrage au sol, au centre de sa tuile** (`ox`, `oy` du buffer).

## 3. Le moteur de sprites (`js/raster.js`)

- `renderModel(parts, { w, h, ox, oy, facing, scale })` : rend une liste de capsules ou sphères.
  - `part = { a:[x,f,z], b?:[x,f,z], r1, r2?, ramp, tex?, group? }`. Coordonnées du modèle :
    `x` = droite, `f` = avant, `z` = haut, en pixels avant `scale`. Pour une sphère, on ne met pas de `b`.
  - `tex(p)` reçoit `{nx, ny, nz, x, y, ex, ey, t, r, shade, fc}` et renvoie un index de ton
    (0–3), une couleur `[r,g,b]`, ou `null` pour un trou (pantalon déchiré, jupe de sapin…).
  - `group` : les parties d'un même groupe n'ont pas de ligne de contour entre elles.
  - `facing = [cx, ct]` : direction du regard dans le plan caméra. Le personnage a 8 directions,
    `dirFacing(k)` avec `k * 45°`, et `k = 2` = face caméra.
- `ik(racine, bout, l1, l2, plier)` : genoux et coudes en cinématique inverse (le bout est
  maintenu à bonne distance de la racine, sinon le genou part à l'infini).
- **Planches de sprites** (`toSprite` / `draw` dans `main.js`) : au chargement, chaque sprite cuit
  (Brainless, habitants, animaux, bâtiments, objets, fissures, sang) est rogné au plus près de son
  dessin puis rangé dans une planche de 2048x2048. On le dessine avec `draw(sprite, x, y)` (coin
  haut-gauche = position du point d'ancrage moins `sprite.ox/oy`), jamais avec `ctx.drawImage`
  directement. Deux jeux de planches : `atlasMain` (cuit une fois) et `atlasNomu` (Brainless, vidé et
  recuit à chaque mutation visible par `rebakeNomu`, le jeu attend sur un écran « MUTATION… »). Les tuiles, l'eau, les
  ombres et les boutons restent de petits canvas à part. `drawCentered` / `drawTurned` dessinent un
  sprite tourné d'un quart de tour (rotation exacte, les pixels restent nets).
- Les cadres de cuisson sont larges exprès (le rognage les rend gratuits) : un membre ne doit
  jamais toucher le bord du cadre, sinon il est coupé net. Vérifier avec un scan de toutes les
  frames avant d'ajouter un modèle.
- `makeBuffer(w, h)` + `outlineBuffer(buf, k)` : dessin pixel par pixel (fleurs, herbes, UI).

## 4. Brainless (`js/nomu.js`)

**Référence visuelle :** un Nomu bleu indigo très foncé, rayé de rouge. Son gros cerveau
orange-brun est enfoncé entre de grosses épaules (mais pas énormes). Il a de petits yeux clairs
sous le cerveau et un **bec doré en V** qui descend sur le torse. Il porte un pantalon beige
jusqu'aux genoux et des **bandes grises en forme de tête de mort** sur les tibias. Taille fine,
bras très longs, grandes mains à 4 doigts griffus recourbés, grands pieds à orteils. Les rayures
rouges sont **peu nombreuses mais épaisses** (épaule, dos, un avant-bras).

| Matière | Rampe (ombre → lumière) |
|---|---|
| Peau | `#090a20 #151848 #22276b #343b8e` |
| Rayures | `#4e0c18 #9c1628 #d22838 #ff5a5e` |
| Cerveau | `#5e2716 #9a4a2c #c97249 #e9a173` (plis = ton −1 en sinusoïdes) |
| Pantalon | `#6e5124 #a9853f #d4b062 #efd08a` |
| Bandes-crânes | `#55575e #8d9097 #c4c6cb #eceef0` (orbites `#14141a`) |
| Bec | `#6b4a10 #b0851e #e0b23a #ffe07a` (intérieur `#0a081a`) |
| Yeux | `#7c6a1c #c9b44a #eee298 #fffbe0` (pupille 1 px) |
| Pointes des griffes | `#3a3f78 #585ea0 #8086c4 #aab0e0` |

- Sprite : 88×88, origine (44, 70), `SCALE = 0.75`, environ 40 px de haut debout.
- Une animation = une fonction `poseFor(anim, t)` qui renvoie une pose. On l'écrit soit avec des
  sinus (cycles : marche, galop, nage), soit avec `keyed([{t, p}])` (actions : coups, frappe au
  sol, saut). Paramètres d'une pose : `fL fR` (pieds), `hL hR` (mains), `bob lean twist hipTwist
  crouch lift breathe jaw nod pitch headUp handsAbs elbowDown swell curl`.
  - `pitch` bascule le buste vers l'avant (≈ 1.1–1.3 : quatre pattes, négatif : se cabre).
  - `handsAbs: 1` = mains en coordonnées absolues (au sol), sinon relatives au haut du corps.
  - `swell` gonfle tout le corps (charge).
- Chaque animation est déclarée dans `ANIMS` (`frames`, `fps`) et cuite automatiquement dans
  les 8 directions au chargement. Rien d'autre à brancher pour le rendu.
- **Esprit des mouvements** : une **bête**, organique et sauvage, jamais robotique.
  - Grandes amplitudes, le poids qui bascule, les hanches qui tournent.
  - Bras qui vont loin (galop étiré/ramassé, frappes en diagonale qui traversent tout le corps).
  - Coups (`jabL jabR hook`) : diagonales violentes, de haut-dehors à bas-dedans puis une montante ;
    en spammant, la rafale `rush` : voûté (buste basculé, tête rentrée), bras fantômes (`P.ghosts`,
    rampe `GHOST`, avant-bras + poing seulement, jamais vers le sol) en éventail + un armé au-dessus
    de l'épaule, image rémanente en jeu, coup dans un éventail de ±110° (`doRushHit`). Effets :
    arcs de choc, éclairs d'impact (`spark`), poussière, vent — mais le sol n'est jamais abîmé.
  - Gueule qui s'ouvre (`jaw`) à l'effort.
  - Allures debout selon le joystick (`stickSpeed`) : marche lente, marche (`walk`), grand pas
    (`stride`, mélange marche/course), course debout à fond (`jog`). La vitesse réelle (`player.spd`)
    rattrape la vitesse voulue en douceur et l'allure suit la vitesse réelle (`gaitStep`, cycle de
    pas `player.phase` partagé : changer d'allure ne fait pas sauter les jambes). Il ralentit sur
    quelques pas quand on lâche. Sprint à quatre pattes, avec transitions `drop` (il plonge sur les
    mains) et `rise` (il se redresse en courant). Clavier : C maintenu = marcher.
  - **Attraper et lancer** (bouton PRENDRE) : `grab` (il fond dessus, empoigne à t = 0.4, hisse
    au-dessus de sa tête), `carry` / `carryWalk` (marche lourde, plus lente selon le poids, pas de
    galop) / `carryJump`, `throwAim` (charge tirée derrière la nuque, il vise au stick et dose la
    force, trajectoire en pointillés et point de chute au sol), `throw` (lancer à deux mains, lâché à
    t = 0.4), `heave` (COUP en portant : il fracasse sa charge au sol devant lui). Ce qu'il porte est
    dessiné au point entre ses mains, `holdPoint(anim, t, dir, one)` (précalculé dans `holdPts`) ; un
    arbre passe en travers au-dessus de sa tête.
  - **À une main** (`lightLoad` : poids ≤ 1.5, pas un arbre — habitants, chevaliers, héros, lapin,
    loup, cerf, caisses, tonneaux, foin, lanternes, petits rochers) : la main droite tient, la prise
    pend au bout du bras sans toucher le sol. `grab1`, `carry1`, `carryWalk1`, `carryJump1`, galop sur
    trois membres `run1` (+ `drop1` / `rise1` ; un habitant qui gigote est alors traîné à
    l'horizontale), lancer de javelot `throwAim1` (bras libre tendu vers la cible, prise armée
    derrière) / `throw1`. ÉCRASER repasse à deux mains (`heave`).

- **Mutations** (`js/mutations.js`) : à chaque niveau (`LEVEL_AT`, 19 niveaux), le jeu se met en
  pause et propose 3 mutations (`draw3`, une par branche si possible) ; arbre à 3 branches BRUTE /
  PRÉDATEUR / COLOSSE, `req` = il faut l'une de ces mutations. `look: true` : elle se voit,
  `nomuParts(P, M)` lit le même nom (bras de titan, griffes d'acier, poings-masses, dos d'épines,
  pattes rayées, bec béant, yeux rouges `EYE_RED`, queue, carapace d'os, gros cerveau, peau cramoisie
  `SKIN_FIRE`, masse = taille x1.13 `sizeOf`). Les effets de jeu sont lus par `mut(id)` dans `main.js`.
  Dans l'onglet MUTATIONS, une mutation acquise peut être désactivée (`player.mutOff` : plus d'effet ni
  d'apparence, elle compte toujours pour l'arbre) et, active, son apparence cachée (`player.lookOff` :
  l'effet reste). `mut(id)` = acquise et active ; Brainless est cuit avec `shownMuts()`.
- **Alters** : dévorés = possédés (`player.alters`), 3 emplacements équipés (`player.equip`, onglet
  ALTERS du sac), niveau 1 à 3 en dévorant un autre héros du même type (`alterLv`).

## 5. Le décor (`js/sprites.js`, `js/world.js`)

| Matière | Rampe |
|---|---|
| Écorce | `#2e1c10 #553620 #7a5233 #9a6d45` |
| Feuillage | `#1d4728 #2d6a33 #4a923d #7dc257` (forêt : `#183d24 #255a2d #3b7c37 #62a64c`) |
| Sapin | `#123327 #1c4c35 #2a6843 #448a52` (+ neige `#9cb0c6 … #ffffff`) |
| Cerisier | `#86365a #c55c88 #ec8fb2 #ffc8dc` |
| Roche | `#34373f #5a5f6b #838894 #b1b6bf` (mousse `#2b4a23 … #86b356`) |
| Buisson | `#1a4424 #28622f #3f8a3a #69b14f` |
| Herbe (sol) | `#4b8a35 #5c9e3f #73b84d #8fd162` |
| Prairie | `#5c9e3f #6fb34a #86c75a #a3d96f` |
| Sable | `#c9b06c #dfc98a #ecdca2 #f6ebbf` |
| Pierre / Neige | `#6f747f … #b8bcc4` / `#c9d5e1 … #ffffff` |
| Terre (flancs) | `#4a2f1c #62402a #7a5233 #8e6440` |
| Eau / Eau profonde | `#1f4f86 #2a66a6 #3f86c6 #8cc6ee` / `#163a6a … #6fa9dc` |
| Chemin | `#7a5a3a #94704a #ab875a #c29e6e` (petits cailloux) |
| Terre retournée (cratères, champs) | `#4f3220 #664330 #7d5638 #946a44` (mottes) |
| Pavés | `#5f5a52 #7f786c #9d9586 #bdb4a2` (pierres en quinconce, joints ton 0) |

- **Arbres** : tronc en capsule effilée + houppier en grappe de 5 à 7 sphères. On a 4 frames
  de balancement (`SWAY_FRAMES`), et le haut bouge plus que le bas. Le canevas fait 60×78,
  avec l'origine en (30, 70).
- **Sapins** : un tronc à racines, puis 5 étages de branches. Chaque étage = un cœur conique (un ton
  plus sombre : la profondeur sous les rameaux) et une couronne de 5 à 8 rameaux en capsules qui
  partent du tronc et retombent, en éventail décalé d'un étage à l'autre : silhouette dentelée.
  Bouts des rameaux un ton plus clairs, dessous à l'ombre, aiguilles en grain `hash`, quelques
  pommes de pin `#5a3a1e`. Sapin enneigé : la neige se pose sur le dessus des rameaux (`ny < 0`).
- **Rochers** : 2 à 4 sphères qui se chevauchent, une ombre au sol, mousse sur le dessus si besoin.
- **Petits objets** (herbes, fleurs, roseaux, cailloux, nénuphars) : dessinés pixel par pixel,
  2 à 3 frames de balancement, contour sel-out.
- **Tuiles** : losange 32×16 (ligne `r` du losange : de `14-2r` à `17+2r`). Les flancs gauches
  sont plus clairs que les flancs droits. Il y a une strate plus sombre tous les 8 px, et une
  lèvre d'herbe ou de neige de 2–3 px qui coule sur le flanc. Liserés : clairs sur les bords
  hauts, sombres sur les bords bas quand le voisin est plus bas.
- Toute nouvelle matière de tuile doit fournir : dessus (4 tons), flanc (rampe dédiée),
  grain par `hash`.
- Les objets ont des infos de gameplay dans `OBJ_INFO` (`solid`, `tall`, `hp`, `tree`, `rock`,
  `leafy`, `small`, `lift` = Brainless peut l'arracher et le lancer, avec son poids de 1 à 3…). Chaque nouvel objet y a sa ligne, et sa génération dans `genCell`.
- `tall` = hauteur de l'obstacle en pixels (un peu sous le haut du sprite ; bâtiments : dans
  `BUILDINGS`). En l'air, on passe par-dessus quand les pieds sont plus hauts (`obstacleAt`) :
  saut normal ≈ 23 (rochers, clôtures, tonneaux), super saut BOND ≈ 60 (arbres, remparts,
  maisons ; pas la tour de guet). Retombé dans un obstacle, `escapeObstacle` le pose de l'autre
  côté s'il avançait, sinon au plus près. Sans `tall`, l'obstacle bloque toujours.

- **Inventaire** (`js/items.js`) : 36 cases (`player.inv`, les 9 premières = la barre), piles de 64.
  Matériaux (bois, pierre, paille, fer), nourriture (viande crue, cuite, baies), trophées (casque,
  bouclier, emblème), constructions. Ce qu'on casse lâche ses matériaux (`DROPS`, `RUIN_DROPS`,
  `lootOf` pour chevaliers et héros) : des objets qui sautent puis volent jusqu'à lui (`drops`).
  Repu, ce qu'il dévore en trop devient de la viande crue. Icônes 12x12 dessinées par code (`buildIcons`).
- **Sac** (icône en haut à droite, I/Tab, croix bas), **style Minecraft** : panneau gris 176x166 en
  relief (`mcPanel`), cases creusées 18x18 (`mcSlot`), boutons (`mcButton`), infobulles sombres à
  liseré violet (`drawTip`), onglets attachés au-dessus. Onglets SAC (Brainless qui tourne dans son
  cadre, ses 3 alters équipés à gauche comme une armure, sa réserve d'alters ; ou COFFRE), MUTATIONS
  (cases reliées comme l'écran des progrès), ATELIER (livre de recettes, 5 par ligne, ingrédients ->
  résultat), CARTE (`drawMapTab`) et SUCCES (`drawAchTab`) ; un coffre n'a que les 3 premiers.
  Objets (`slotClick`) : main vide, un toucher/clic choisit l'objet et affiche son nom et ses infos
  (`invUI.pick`, cadre blanc), le retoucher le prend, le retoucher vite l'envoie de l'autre côté
  (`quickMove`, aussi Maj+clic) ; main pleine, un toucher pose (fusionner ou échanger) ; glisser-déposer,
  appui long ou clic droit = la moitié (ou poser un seul), lâché hors du panneau = tombe par terre
  (`dropCursor`).
  Le jeu est en pause tant qu'il est ouvert (`overlayOpen`) : l'interface a sa propre horloge `rt()`.
  Clavier/manette : la direction vise la case voisine (`overlayNav`), X = clic droit, Maj+Entrée / Y =
  de l'autre côté. Barre d'objets façon Minecraft (`drawHotbar`, gros cadre blanc, nom de l'objet).
- **Constructions** (`O.WALL_WOOD … O.TORCH`, `built: true`, sprites dans `buildings.js`) : choisies
  dans la barre, un aperçu vert/rouge s'affiche sur la tuile devant lui (`placeTarget`), UTILISER les
  pose. Le bouton N devient OUVRIR (coffre, contenu dans `world.chests`, sauvé), DORMIR (nid : nuit
  passée, vie pleine, il s'y réveille après une défaite), CUIRE (feu de camp : viande crue -> cuite).
  Piège à piques : blesse qui marche dessus. Feu de camp et torche : flamme animée et lueur la nuit.
- **Mode BÂTIR** (**seulement dans la tanière** : icône marteau à gauche du sac, B au clavier, R3 à la
  manette ; dehors il répond « SEULEMENT DANS TA TANIÈRE » ; refusé en combat). Dehors, on pose depuis la
  barre d'objets (`tryPlace`, `placeTarget` : devant lui, face à lui ; un abri 2x2 deux tuiles devant).
  Les murs, palissades et pièges ne se fabriquent plus (ceux déjà posés restent) :
  le monde se fige (`updateBuild` : seules les animations tournent), la caméra se détache de Brainless
  (`build.cx/cy`, glisser au doigt avec élan, deux doigts quand un outil est choisi, ZQSD, stick) dans
  une portée `buildR()` (9 tuiles dehors, 12 dans la tanière ; grille pointillée, bord doré). Tiroir en
  bas à onglets (`BUILD_TABS` : CREUSER (tanière seulement), MURS, FEU, ABRIS, MEUBLES) : on glisse une
  case sur une tuile (aperçu vert/rouge, visée 14 px au-dessus du doigt), ou on la choisit puis on
  touche les tuiles. Au doigt, ce qui s'oriente passe d'abord par un aperçu en attente (`build.pend`)
  avec des flèches ◀ ▶ de part et d'autre et POSER dessous (`rotControls`, boutons dans le monde) ;
  retoucher l'aperçu le pose aussi. Brainless est caché pendant qu'on bâtit (sa tuile en pointillés
  rouges). Ce qui manque au sac est fabriqué à la pose si les matériaux y sont (« + »).
  Toucher une construction posée la choisit (contour doré, ses flèches la tournent sur place). L'appui
  long (clic droit, X) la soulève (`builtAtScreen` teste les pixels du dessin : une étagère devant ne vole
  pas le doigt) : on la repose ailleurs, ou on la lâche
  sur le tiroir pour la ranger (un coffre rend son contenu). Bandeau : ANNULER (`build.undo`, aussi pour
  creuser/remblayer), TOURNER, CENTRER, OK. Charte de l'écran `BUI` : peau indigo, rayures rouges,
  griffures, bec doré en V, cerveau pour « fabricable ».
- **Rotation** : les objets `rot: true` (meubles, coffre, abris) se tournent sur 4 directions, rangées
  dans `world.rots` (sauvé ; `setObj` l'efface). Sprites : `buildRotSprites()` (`buildings.js`) rend
  chaque objet 4 fois avec `rotPrims(prims, k)` (les volumes tournent, les matières voient leurs
  coordonnées d'origine) ; en jeu `objRot[id][k]`. La palissade, elle, passe de `FENCE_X` à `FENCE_Y`.
  `turnPrims(prims, angle)` tourne d'un angle quelconque (l'entrée des abris ronds face à la caméra).
- **Ses abris** (2x2, `BUILDINGS` avec `built: true`, ne se posent que dehors sur 4 tuiles plates) :
  le REPAIRE (`O.HUT`, une hutte à sa tête : murs de peau rayés, coutures d'os, dôme de cerveau plissé,
  yeux allumés la nuit, bec doré au-dessus de la porte, défenses ; matière `hide`) et la TANIÈRE
  (`O.LAIR`, tertre d'herbe, gueule noire cerclée de pierres, crâne, griffures). 3 états comme les
  autres bâtiments. Meubles : table, étagère, lit, tapis (on marche dessus), tas d'os, totem (yeux rouges).

## 5 bis. Dedans : tanière et intérieurs (`Den`, `Room` dans `world.js`)

- On entre en poussant contre la porte d'un bâtiment (`realmDoors`, côté `doorOf` : +y pour une maison
  de village, face caméra et tournée pour ses abris) ou avec N (ENTRER / SORTIR). `enterRealm` remplace
  `world` par un petit monde à part ; ce qui vit dehors (habitants, objets au sol, feux, débris…) est mis
  de côté (`realm.stash`) et retrouvé à la sortie (`exitRealm`, `doorLock` : il ne rentre pas tant qu'il
  pousse encore). Dedans : pas de villages, de faune, de météo, de lucioles ni de flair ; teinte fixe
  (`drawSky`), `darkness()` constant (les lueurs restent allumées). `world.solid(x, y)` = paroi (bloque
  toujours, arrête les projectiles). La porte et l'échelle (`exit`) sont incassables ; une sortie cassée
  par une ancienne version revient au chargement (`exitKey`). Sauvegarde : `realmData` (clé -> mods, terr, wear, coffres, rots),
  Brainless est sauvé devant la porte. Dormir dans un nid dedans : il se réveille devant sa porte.
- **Intérieurs** (`Room`, clé `room:x,y`, suit la maison quand on la déplace) : pièce w x h, murs du fond
  hauts (`T.WALL_IN` plâtre et poutres, `T.WALL_HIDE` peaux rayées pour son repaire), murets devant, vide
  noir autour (`T.VOID`), porte (`O.DOOR_OUT`) au milieu du mur de devant. Meublés selon `ROOMS`
  (chaumière, maison, auberge, grange, tour ; son repaire est vide) ; un coffre de villageois est rempli
  à la première ouverture (`Room.loot`).
- **Tanière** (`Den`, une seule par monde, toutes les entrées y mènent) : 80x80 tuiles de terre bordées de
  roche dure (`T.BEDROCK`), une petite grotte au départ avec l'échelle (`O.DEN_EXIT`). Parois hautes de 2
  marches : terre (`T.EARTH`, 2 coups, rend de la TERRE), filons de pierre (`T.EARTH_STONE`, 5 coups) et
  de fer (`T.EARTH_IRON`, 6 coups) (`DIG`). On creuse à coups de poing (`digTile`, fissures sur la paroi),
  au gros coup et à la frappe au sol, ou au mode BÂTIR : CREUSER se peint au doigt sur les parois qui
  touchent une salle (marquées en orange), REMBLAYER remet une paroi pour 1 TERRE.

## 5 ter. Un monde qui réagit

- **Saisons** (`season`, `seasonOf`, 3 jours de jeu chacune : `SEASON_LEN`) : printemps (chênes en
  fleurs, cerisiers roses et pétales), été (cerisier vert), automne (chênes roux/dorés `AUTUMN`, feuilles
  qui tombent, herbe jaunie `AUTUMN_TOPS`), hiver (arbres nus et enneigés, sapins enneigés, sol
  `WINTER_TOP` où percent des brins, pas de fleurs, neige au lieu de pluie). Sprites : `buildSeasonSprites()`
  -> `seasonImgs[saison][objet]`, lus par `objFrames(o)` ; tuiles : `blockBuffer(type, h, v, saison)`,
  cache vidé au changement. Annonce à chaque nouvelle saison.
- **Oiseaux** (`birds`) : volées de 3 à 6 (moineaux, corbeaux l'hiver, mésanges) posées dans l'herbe, qui
  picorent et sautillent ; toute la volée s'envole (`sfx.flap`) quand il court près d'elle ou frappe fort.
  Au sol, triés par rangée comme les habitants ; en vol, par-dessus.
- **Carte** (onglet CARTE, icône parchemin, V au clavier) : vue en losanges comme le jeu, seulement les
  morceaux 32x32 déjà parcourus (`explored`, sauvé). Villages (noms sans chevauchement), ses abris,
  l'expédition, lui. Glisser au doigt, `-`/`+` (1 à 8 tuiles par pixel), ICI.
- **Succès** (`ACHIEVEMENTS`, 16) : vérifiés toutes les 2 s, annoncés un par un, sauvés
  (`player.achieved`). Compteurs dans `stats` (mangés, héros, creusés, posés, encagés, expéditions,
  champions, fossiles).
- **Tanière vivante** : un habitant porté en entrant dans un abri devient **prisonnier** (`captive`,
  `kidnap` : perdu pour son village). Lâché près d'une **cage** (`O.CAGE`, dessinée en deux moitiés autour
  de lui, `cageFront`), il y est enfermé et secoue les barreaux ; libre, il file vers la sortie et
  s'échappe. On le reprend, on le tue, on le dévore. Prisonniers sauvés par lieu (`captives`).
  **Présentoir** (`O.RACK`, N : EXPOSER) : casque/bouclier 1, emblème 2, couronne 3 -> +3 % de force par
  point (`trophyBonus`, 45 % au plus). **Trouvailles** en creusant (`Den.secretAt`, une fois par tuile,
  `found`) : coffre enfoui (`Den.loot`), ossements (viande), **ancien Nomu** fossilisé (`O.FOSSIL`,
  N : EXAMINER, +15 évolution), source d'eau.
- **Expéditions** (`expedition`) : l'**infamie** (`player.infamy`, barre MENACE) monte avec les méfaits
  (villageois 1, chevalier 2, héros 4, enlèvement 2, maison rasée 3) et retombe doucement. À `EXP_AT`, le
  royaume envoie 3 à 8 chevaliers (+ 1-2 héros) qui le traquent (`n.exp`, `v: 'exp'`, flèche au bord de
  l'écran). S'il a un abri, ils l'**assiègent** (`updateExpMember`) ; absent ou caché dedans, ils cognent
  l'entrée et finissent par **libérer ses prisonniers** (`freeCaptives`) ; s'il ressort, ils l'attendent
  devant la porte. Tous tués : expédition repoussée, infamie divisée par 2. Un abri abîmé se range au mode
  BÂTIR et se repose neuf.
- **Champions** : chaque ville fortifiée a son champion (`v.champion`, un héros ×4 PV, coups plus forts,
  nom doré couronné). Mort une fois pour toutes (`deaths.champion`) ; il lâche sa COURONNE ; le dévorer
  donne beaucoup d'évolution et une mutation de plus.
- **Reconstruction** : une maison de village rasée (`world.ruins`, sauvé) est rebâtie au bout de 10 min de
  jeu s'il est à plus de 28 tuiles ; en revenant : « LE VILLAGE A ÉTÉ RECONSTRUIT ».
- **Villageois chez eux** : en entrant dans une maison, ceux qui y sont rentrés (nuit, pluie) sont là
  (`bringResidents`) : endormis dans les lits la nuit (`outsideDark`), réveillés en sursaut s'il approche,
  ils fuient dans les coins en criant. Tués ou blessés chez eux : le village est en alerte à sa sortie.

## 6. Villages et bâtiments (`js/buildings.js`, `js/world.js`)

- **Moteur de volumes** : `renderSolids(prims)` lance un rayon iso par pixel dans des boîtes,
  toits à deux pans (`gable` + `gableWall`), pyramides, cylindres, ellipsoïdes et capsules.
  Coordonnées `u` (= x monde), `v` (= y monde), `z` ; 16 unités = 1 tuile, 8 = une marche.
  Même charte que le reste : 4 tons par matière, lumière `L = (-0.25, 0.55, 0.8)` (face gauche
  claire, face droite sombre, dessus le plus clair), grain `hash`, lignes internes, contour 0.3.
  Les textures sont des fonctions de `(u, v, z)` : joints de pierre, colombages, rangées de tuiles…
  Une fenêtre met `q.glow = 1` : elle est rallumée la nuit (couche `glow`, mode `lighter`).
- **Bâtiments** : 2x2 tuiles. L'objet est posé sur la tuile de devant (l'ancre) ; les 3 autres
  tuiles portent `PART_W / PART_N / PART_NW` qui renvoient vers l'ancre. Le sprite est centré sur
  le coin commun des 4 tuiles. Collision = une boîte (`box`). Dans le tri de profondeur, un
  bâtiment passe avant tout ce qui est sur sa rangée, et Brainless/les habitants passent devant
  s'ils sont du côté +x ou +y.
- **3 états** par bâtiment : intact → abîmé (trous dans le toit, fissures, crépi tombé, vitres
  cassées, gravats) → ruine (murs cassés en dents, plancher, gravats, poutres calcinées).
  On le voit **trembler** à chaque coup (`hits`). Résistance (`BUILDINGS` dans `world.js`) :

  | Bâtiment | Toit | PV avant abîmé / avant ruine |
  |---|---|---|
  | Chaumière | chaume `#6e5420 … #ead37a` | 4 / 4 |
  | Maison à colombages | tuiles `#5e1f17 … #d9744c` | 6 / 6 |
  | Grange | bardeaux `#2e1a10 … #8c5a36`, murs `#4a1410 … #c45a44` | 5 / 5 |
  | Auberge | ardoise `#252b38 … #7083a0` | 8 / 8 |
  | Tour de guet | ardoise, pierre `#3f434b … #a7acb5` | 11 / 11 |
  | Son repaire | dôme de cerveau `#5e2716 … #e9a173`, peau `#090a20 … #343b8e` | 7 / 7 |
  | Sa tanière | tertre de terre et d'herbe, pierres, crâne | 10 / 10 |

  Les dégâts de zone baissent avec la distance (`base x (1 - 0.75 d/R)`) : un coup chargé à bout
  portant rase une chaumière, plus loin il l'abîme seulement ; la tour encaisse plusieurs coups.
- **Objets de village** (1 tuile) : puits, étal, clôtures, tonneau, caisse, foin, lanterne (allumée
  la nuit), blé, choux, planches. Chacun a sa ligne `OBJ_INFO` (`prop`, `crime`, `next` = ce qu'il
  devient une fois cassé).
- **Génération** (`planVillage`) : au plus un village par région de 80x80 tuiles, sur un site plat
  et sec (`siteOk`). Hameau (R 7), village (R 10), grand village (R 13, place pavée, tour). Le sol
  est aplani, les arbres retirés, puis place + puits, bâtiments, chemins de chaque porte à la
  place, champs clôturés, objets, lanternes, quelques arbres. Un grand village est garanti près
  du départ.
- **Villes fortifiées** (`planTown`, R 24) : enceinte carrée de remparts (`WALL`, `WALL_TOWER`,
  1 tuile chacun, `tilebox` = toute la tuile bloque, 3 états jusqu'aux gravats), 4 portes flanquées
  de tours, rues pavées en croix, grande place, ~30 bâtiments, étals et lanternes le long des rues.
  Elles comblent l'eau à l'intérieur de leurs remparts. Garnison 10, 20 habitants, 1 à 3 héros.

## 7. Habitants (`js/people.js`)

- Même moteur que Brainless (capsules + sphères, `renderModel`), environ 27 px de haut (enfant
  ~19 px), 64x62, origine (32, 50). Visage = partie avant de la tête (`dot(n, fc)`), cheveux au-dessus.
  Robes (paysanne, ancien) : le cône s'arrête aux chevilles et son ourlet suit le pas (`hem`),
  les mains passent dehors, et le haut est d'une autre couleur que la robe, sinon les bras s'y fondent.
- Villageois : paysan (chapeau de paille), paysanne (robe, tablier, foulard), enfant, ancien
  (barbe, canne, dos voûté), marchand (béret, tablier). Anims : `idle walk flee wave ko dead crushed`.
- Chevalier : armure `#353b48 #626b7c #9aa3b4 #dfe5ee`, tabard bleu à croix dorée, plumet rouge,
  épée, bouclier. Anims : `idle walk run attack hurt ko dead crushed`.
- Morts : `dead` = la pose KO tachée de sang (`#3e060c #6e0e18 #a01824 #d02c36`), `crushed` = la
  même image aplatie (x1.25 en largeur, x0.42 en hauteur) et éclaboussée. Au sol, une flaque
  (`bloodBuffer`) qui s'efface en 3 min ; le cadavre en 2 min 30.
- Comportement : ils se promènent, saluent Brainless quand il est calme, rentrent dormir la nuit,
  s'enfuient en criant quand il fait le méchant, volent et tombent KO (étoiles) quand on les frappe.
- **Garnisons, pas de renforts** : chaque village a un nombre fixe d'habitants (`folk`) et de
  chevaliers (`garrison` : hameau 1, village 3, grand village 5) qui patrouillent. Les morts sont
  comptés par village (`world.deaths`, sauvegardé) et ne reviennent jamais. Un méfait fait monter
  la colère du village (`anger`) ; au-dessus de 1, la cloche sonne et seuls les gens de CE village
  assez proches réagissent (pas de messager). Les chevaliers abandonnent quand le village s'est
  calmé (25 s) ou quand Brainless quitte leur territoire.
- **Héros** (`kind: 'hero'`, anims `+ special`) : REMPART (absorption, mêlée lourde), RESSORT
  (bond sur Brainless), TURBO (charge en ligne droite), ACIER (poings de fer), ECLAIR (foudre à
  distance, cible clignotante au sol). Combinaison, gants et bottes d'une couleur d'accent, masque
  ou visière, cape, emblème. Nom et barre de vie au-dessus de la tête. Ils résistent à l'écrasement
  tant qu'ils ont plus de 40 % de vie. Dévorer un héros donne son alter.
- **Combat des héros** : garde de boxeur sautillante, enchaînements (`COMBOS` : direct, cross,
  uppercut, coup de pied circulaire, écrasement) où ils avancent en frappant. Les gros coups
  (`kb` >= 6) projettent Brainless en arrière, parfois en l'air (`lift`), avec un arrêt sur image
  (`hitstop`) et son animation `hurt` ; sa charge est perdue. REMPART et ACIER se mettent en garde
  (`block`) quand il arme un coup : un coup chargé à fond brise la garde.
- **Déplacements** : `steer` teste 16 directions en regardant 0,6 tuile devant et garde sa
  direction précédente ; `unstick` sort de l'obstacle celui qui s'y retrouve coincé. Les
  habitants apparaissent en fondu, et sortent des maisons quand Brainless est assez près pour voir.
- **Tuer** : la frappe au sol écrase tous ceux qui sont sous lui (`crushed`) ; frapper quelqu'un
  de KO à terre l'achève ; un gros coup chargé à bout portant tue en retombant.
- Vie de Brainless : 100, super régénération (12 PV/s) après 4 s sans coup ; les héros frappent ×2 (+12 % par niveau de Brainless, champion ×1.5 de plus, `heroMul`) ; à 0 il s'effondre et se
  réveille au départ, et les villages se calment.
- **Visée du gros coup** : pendant la charge (maintenir COUP), le stick oriente Brainless sans le
  déplacer (`player.aim`, direction continue, le sprite prend la plus proche des 8). Un cône en
  tirets jaunes (axe rouge) montre au sol la zone qui sera balayée et grandit avec la charge.
- **Faim et évolution** : la faim descend (plus vite en sprint) ; vide, Brainless perd de la vie et
  ne se régénère plus. Près d'un cadavre, le bouton N devient **DÉVORER** (`eat`, 5 bouchées).
  Chaque proie rapporte de la nourriture et des points d'évolution (`mealOf`) ; les niveaux
  (`LEVEL_AT`) donnent +15 de vie max et +12 % de force. Alters (`ALTERS`) : ABSORPTION (dégâts / 2),
  BOND (saut x1.6 + onde de choc), MOTEUR (sprint x1.35, endurance), FER (coups x1.5), FOUDRE
  (éclairs en chaîne sur les coups chargés, il se soigne avec la foudre de l'orage).
- **Attraper, porter, lancer** (`grabTarget`, `seize`, `releaseHeld`, `flight`) : arbres (déracinés,
  le tronc reste là où ils retombent), rochers (ils se fendent), tonneaux, caisses, foin, lanternes,
  habitants, animaux, cadavres. Un habitant porté gigote (anim `held`) et crie ; un chevalier se
  dégage au bout de 3,5 s, un héros en forme en 1,3 s (coup de pied, recul). Il lâche tout s'il
  encaisse un gros coup, nage ou s'effondre. En vol (gravité `THROW_G`), un projectile fauche ceux
  qu'il croise et percute arbres, rochers, murs et maisons (`hitObstacleAt`, dégâts `throwDmg` selon
  poids et force) ; léger, il éclate au premier choc ; lourd (≥ 2.5), il traverse la foule et écrase
  ceux sur qui il retombe. Lancé fort, un habitant meurt en retombant ; à l'eau, il coule.
- **Feu** (`fires`, `ignite`, `updateFires`) : une tuile en feu chauffe, consume son combustible
  (`fuel` dans `OBJ_INFO` ; bâtiments selon le toit, `BURN_MAT` / `BURN_FUEL` : chaume > grange >
  tuiles > ardoise, la pierre ne brûle pas) puis retombe. Bien chaude, elle allume ses voisines selon
  leur inflammabilité (foin, chaume, blé, buissons, arbres ; l'herbe rase à peine). Ça part d'une
  lanterne brisée ou lancée (`oilSplash`), de la foudre (orage, alter FOUDRE), d'une charge en feu
  qu'on lance. La pluie l'étouffe, une frappe au sol ou un gros coup le souffle (`blowFires`), les
  villageois font la chaîne des seaux depuis le puits (état `bucket`, ils sortent même la nuit).
  Consumé (60 % du combustible) : arbre calciné (`O.BURNT`), objet en cendres, herbe noircie (terre,
  elle repousse), maison qui s'abîme puis s'effondre (`damageBuilding(.., quiet)` : pas un méfait).
  Ceux qui touchent les flammes prennent feu (`burnNpc`) : ils courent en hurlant, propagent le feu
  et peuvent en mourir ; Brainless brûle un peu, l'eau l'éteint. 70 tuiles en feu au plus.
- **Flair** (N / R / L1) : il lève la tête et renifle (`sniff`), puis une flèche, la distance et
  des filets d'odeur rouges indiquent pendant 12 s le village le plus proche qui a encore des
  vivants (`nearestPrey`).

## 8. Faune et météo

- **Faune** (`js/beasts.js`) : quadrupèdes en capsules, 56x56, origine (28, 44). Vus pile de face ou de
  dos (directions 2 et 6), on les tourne de ~25° (`beastFacing`) : sinon un quadrupède n'est
  qu'un trait de 4 px. Pattes écartées, oreilles assez grandes pour dépasser de la tête. Lapin (fuit en
  zigzag), cerf (bois, fuit vite), sanglier (défenses, charge si on l'approche ou le frappe), loup
  (meute de 3, chasse la nuit, fuit blessé). Ils apparaissent hors écran selon le biome et
  repartent quand Brainless s'éloigne ; quantité réglée par le paramètre FAUNE.
- **Météo** (`updateWeather`) : clair, couvert, pluie, orage, tirés au sort selon le
  paramètre METEO (pas de brouillard : retiré, il voilait l'écran ; l'hiver, il neige partout). Pluie = gouttes de 6 px en espace
  écran + éclaboussures ; neige à la place sur la neige et en altitude ; ciel couvert =
  teinte plus sombre. L'orage agite la végétation et la foudre frappe (souvent un arbre) : éclair
  en zigzag `#8fd8ff`/blanc, flash, tonnerre retardé selon la distance. Les villageois rentrent
  quand il pleut fort.

## 9. Effets visuels

- **Particules** : 1–2 px, couleurs tirées de listes de 3–4 teintes de la matière
  (`LEAF_COLS`, `ROCK_COLS`, `WOOD_COLS`, `DUST_COLS`, `WATER_COLS`…).
- **Traînées** (`streak: true`) : quelques pixels alignés sur la vitesse, pour le vent et
  l'énergie.
- **Feu** : flammes pixel (`flameBuffer`, 3 tailles x 4 images, `#c8281e … #fff3b0`, contour 0.45)
  placées selon ce qui brûle (`flamesOf`), ravivées après la teinte de nuit avec un halo orange
  (`drawFireGlow`) ; fumée `SMOKE_COLS` et braises `EMBER_COLS` qui montent, vapeur `STEAM_COLS`
  sous les seaux, cendres au sol (`ashBuffer`). Son : « vouf » à l'allumage, sifflement à
  l'extinction, crépitement et grondement continus selon le feu autour (`fireNear`).
- **Énergie de charge** : jaune → orange → rouge
  (`#fff3b0/#ffe28a`, `#ffb347/#ff9a3c`, `#ff5a5a/#ff2e63`). Le corps s'illumine en `lighter`.
- **Ondes de choc / arcs** : pointillés `#fff6d8` qui s'étendent et s'effacent.
- **Eau** : ronds `#e8f6ff`, écume `#eaf7ff`, gerbes blanches et bleu clair.
- **Sol abîmé** : fissures en 3 niveaux (`crackBuffer`, une version par matière) ; un coup chargé
  au maximum creuse un **cratère** (la tuile descend d'une marche, l'herbe devient terre, 2 marches
  au plus). Les fissures se referment et l'herbe repousse avec le temps (`healGround`).
- **Effondrement** : la maison intacte s'enfonce dans un nuage de poussière et laisse la ruine.
- **Traces au sol** : 3×1 px, couleur selon le sol (terre `#3d2b1a`, sable `#a88b52`,
  neige `#9fb3c8`, pierre `#4f535c`), disparaissent en 9 s.
- **Secousse d'écran** (`shake`) dosée selon l'impact : pas ≈ 1.5, coup ≈ 2.5, gros coup 5–16.
- **Jour/nuit** : teinte `multiply` (`SKY` dans `main.js`). Les lucioles sont dessinées après la teinte.

## 10. Interface

- Police pixel maison 3×5 (`js/font.js`), en majuscules, avec une ombre décalée de 1 px.
- Boutons ronds pixel (`circleBuf`) : COUP rouge `[225,70,90]`, CHARGE violet
  `[120,90,220]`, SAUT vert `[70,170,110]`, SPRINT jaune `[230,170,50]`. Le libellé est sous
  le bouton.
- Toujours respecter les zones sûres iOS (`safe.t/r/b/l`).
- 3 modes de contrôle (`inputMode`) : `touch` (boutons à l'écran), `keys` (clavier + souris, PC),
  `pad` (manette, `js/pad.js`, ex. AYN Thor). Les boutons tactiles ne s'affichent qu'en `touch` ;
  l'aide (`HINTS`) s'adapte au mode. Toute nouvelle action doit être jouable dans les 3 modes.
- Bouton N (rose) : FLAIR, ou DÉVORER près d'un cadavre, OUVRIR / DORMIR / CUIRE près d'une
  construction (R au clavier, L1 à la manette).
- Barre d'objets (en bas au milieu, en haut en portrait) : toucher une case = la choisir, la toucher
  encore = l'utiliser ; clavier 1–9 / molette et T ; manette croix gauche/droite et haut (la croix ne
  sert plus à marcher en jeu, `pad.sx/sy` = le stick seul). Sac : icône, I/Tab, croix bas.
  Bouton P (bleu-vert `[60,165,190]`) : PRENDRE, puis LANCER (maintenir = viser) ; le libellé de
  COUP devient ÉCRASER quand il porte (L / G / clic molette au clavier, R1 à la manette).
  Icône maison en haut à droite (Échap, Start) : retour à l'accueil. Icône note à côté (N au
  clavier, et sur l'accueil) : musique du jeu / ma musique / aucune.
- **Écran d'accueil** (`js/menu.js`, en HTML pour le clavier de l'iPhone) : titre, liste des
  mondes, création d'un monde (nom, graine, 7 paramètres à 3 crans : villages, héros, faune,
  météo, relief, eau, difficulté). Le monde défile en fond. Utilisable au doigt, au clavier et à
  la manette. Mondes et sauvegardes dans `js/saves.js` (un monde = une clé `localStorage`).

## 11. Son (`js/audio.js`)

- Tout est synthétisé avec Web Audio : `noise()` (bruit filtré) et `tone()` (oscillateur avec
  glissement). On les combine en couches : un **impact grave** (sine 60–120 Hz qui descend), une
  **texture** (bruit filtré selon la matière) et un **détail** (craquements, gouttes en petits
  `square`).
- Chaque nouvelle action visible a son son. On utilise `gate()` pour éviter les doublons quand
  beaucoup de choses cassent en même temps.
- **Musique** (`updateMusic`) : générée en direct en ré dorien, nappes et basse sur rém / si♭ / fa / do,
  mélodie pentatonique au hasard dans un écho ; plus sombre et rare la nuit ; tambours, basse
  martelée et tempo plus rapide selon `dangerLevel()` (chevaliers, héros, cloche).
- **Ma musique** (`cycleMusic`, sauvé dans `localStorage`) : en mode `mine`, la session audio iOS
  passe en `ambient` (le jeu se mélange à Spotify au lieu de le couper, et se tait avec le bouton
  silencieux) et la musique du jeu se coupe ; sinon `playback`.

## 12. Comment ajouter un nouveau sprite (méthode)

1. Choisir la technique : volume (→ `renderModel` avec capsules/sphères) ou petit détail
   plat (→ `makeBuffer` + `outlineBuffer`).
2. Définir une rampe de 4 tons cohérente avec les tableaux ci-dessus (même luminosité
   d'ombre, même saturation).
3. Ajouter le grain (`hash`) et les détails par `tex`.
4. **Vérifier en image** avant d'intégrer :
   - `node tools/preview.mjs nomu /tmp/x.png '[["anim",0.25,1]]'` (poses de Brainless)
   - `node tools/preview.mjs nomu-sheet /tmp/x.png anim` (une anim × 8 directions)
   - `node tools/preview.mjs nature /tmp/x.png` (tout le décor)
   - `node tools/preview.mjs village /tmp/x.png` (bâtiments x 3 états, objets, tuiles, fissures)
   - `node tools/preview.mjs built /tmp/x.png` (ses abris et ses meubles x 4 rotations, tuiles de dessous et de dedans)
   - `node tools/preview.mjs people /tmp/x.png` (habitants à côté de Brainless)
   - `node tools/preview.mjs people-sheet /tmp/x.png knight attack` (une anim x 8 directions)
   - `node tools/preview.mjs beasts /tmp/x.png` (la faune)
   - `node tools/preview.mjs beast-sheet /tmp/x.png wolf` (une espèce x 8 directions)

   Puis ouvrir le PNG avec Read et comparer aux planches `docs/ref-*.png`.
5. Brancher le gameplay (`OBJ_INFO`, génération, sons, particules) et tester en jeu.
6. Si le style de référence change volontairement, régénérer les planches :
   `node tools/preview.mjs nomu docs/ref-brainless.png` et
   `node tools/preview.mjs nature docs/ref-nature.png`, `node tools/preview.mjs village docs/ref-village.png`,
   `node tools/preview.mjs people docs/ref-people.png`.
7. Si Brainless change, régénérer les icônes : `node tools/make-icons.mjs`.

## 13. Publication

- Branche `main` servie par GitHub Pages (racine). Pas d'étape de build.
- **À chaque mise à jour, lancer `node tools/bump.mjs`** : il incrémente `VERSION` dans `sw.js`
  (sinon l'iPhone garde l'ancienne version en cache) et le numéro affiché sur l'écran d'accueil
  (`js/version.js`). Tout nouveau fichier JS doit être ajouté à la liste `FILES`.
- Test local : `python3 -m http.server 8765` puis `http://localhost:8765/` ; `#debug` à la
  fin de l'URL expose `window.BRAINLESS` (monde, joueur, `createWorld`, `startWorld`, habitants,
  `tod`, `weather`, `doSlam`, `doBigPunch`…) pour les tests automatisés.
- Les commentaires et textes du jeu sont en français.
