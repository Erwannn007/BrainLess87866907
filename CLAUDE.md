# BRAINLESS — charte de design et règles du projet

Jeu perso en pixel art isométrique, monde ouvert dans la nature, où l'on joue **Brainless**
(le Nomu de l'USJ, *My Hero Academia* saison 1). PWA hébergée sur GitHub Pages, jouée dans
Safari iOS et installée sur l'écran d'accueil. Tout est en JS vanilla (modules ES), **sans
aucune image ni son externe** : chaque sprite et chaque son est généré par code au lancement.

Avant de créer ou de modifier un sprite, relis cette charte et regarde les planches de
référence `docs/ref-brainless.png` et `docs/ref-nature.png` (avec l'outil Read) : tout ce qui
est nouveau doit avoir l'air de sortir du même jeu.

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
9. **Tout bouge un peu** : végétation qui se balance avec le vent (`windT` amplifie après les
   gros coups), eau animée sur 4 frames, respiration au repos.
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
- `ik(racine, bout, l1, l2, plier)` : genoux et coudes en cinématique inverse.
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

- Sprite : 64×76, origine (32, 62), `SCALE = 0.75`, environ 40 px de haut debout.
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
  - Bras qui vont loin (galop étiré/ramassé, swings de l'extérieur vers l'intérieur).
  - Gueule qui s'ouvre (`jaw`) à l'effort.
  - Marche debout ; sprint à quatre pattes.

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

- **Arbres** : tronc en capsule effilée + houppier en grappe de 5 à 7 sphères. On a 4 frames
  de balancement (`SWAY_FRAMES`), et le haut bouge plus que le bas. Le canevas fait 60×78,
  avec l'origine en (30, 70).
- **Sapins** : couches de capsules effilées dont le dessous arrondi est coupé (« jupe plate »),
  avec des stries horizontales tous les 3 px.
- **Rochers** : 2 à 4 sphères qui se chevauchent, une ombre au sol, mousse sur le dessus si besoin.
- **Petits objets** (herbes, fleurs, roseaux, cailloux, nénuphars) : dessinés pixel par pixel,
  2 à 3 frames de balancement, contour sel-out.
- **Tuiles** : losange 32×16 (ligne `r` du losange : de `14-2r` à `17+2r`). Les flancs gauches
  sont plus clairs que les flancs droits. Il y a une strate plus sombre tous les 8 px, et une
  lèvre d'herbe ou de neige de 2–3 px qui coule sur le flanc. Liserés : clairs sur les bords
  hauts, sombres sur les bords bas quand le voisin est plus bas.
- Toute nouvelle matière de tuile doit fournir : dessus (4 tons), flanc (rampe dédiée),
  grain par `hash`.
- Les objets ont des infos de gameplay dans `OBJ_INFO` (`solid`, `hp`, `tree`, `rock`,
  `leafy`, `small`…). Chaque nouvel objet y a sa ligne, et sa génération dans `genCell`.

## 6. Effets visuels

- **Particules** : 1–2 px, couleurs tirées de listes de 3–4 teintes de la matière
  (`LEAF_COLS`, `ROCK_COLS`, `WOOD_COLS`, `DUST_COLS`, `WATER_COLS`…).
- **Traînées** (`streak: true`) : quelques pixels alignés sur la vitesse, pour le vent et
  l'énergie.
- **Énergie de charge** : jaune → orange → rouge
  (`#fff3b0/#ffe28a`, `#ffb347/#ff9a3c`, `#ff5a5a/#ff2e63`). Le corps s'illumine en `lighter`.
- **Ondes de choc / arcs** : pointillés `#fff6d8` qui s'étendent et s'effacent.
- **Eau** : ronds `#e8f6ff`, écume `#eaf7ff`, gerbes blanches et bleu clair.
- **Traces au sol** : 3×1 px, couleur selon le sol (terre `#3d2b1a`, sable `#a88b52`,
  neige `#9fb3c8`, pierre `#4f535c`), disparaissent en 9 s.
- **Secousse d'écran** (`shake`) dosée selon l'impact : pas ≈ 1.5, coup ≈ 2.5, gros coup 5–16.
- **Jour/nuit** : teinte `multiply` (`SKY` dans `main.js`). Les lucioles sont dessinées après la teinte.

## 7. Interface

- Police pixel maison 3×5 (`js/font.js`), en majuscules, avec une ombre décalée de 1 px.
- Boutons ronds pixel (`circleBuf`) : COUP rouge `[225,70,90]`, CHARGE violet
  `[120,90,220]`, SAUT vert `[70,170,110]`, SPRINT jaune `[230,170,50]`. Le libellé est sous
  le bouton.
- Toujours respecter les zones sûres iOS (`safe.t/r/b/l`).

## 8. Son (`js/audio.js`)

- Tout est synthétisé avec Web Audio : `noise()` (bruit filtré) et `tone()` (oscillateur avec
  glissement). On les combine en couches : un **impact grave** (sine 60–120 Hz qui descend), une
  **texture** (bruit filtré selon la matière) et un **détail** (craquements, gouttes en petits
  `square`).
- Chaque nouvelle action visible a son son. On utilise `gate()` pour éviter les doublons quand
  beaucoup de choses cassent en même temps.

## 9. Comment ajouter un nouveau sprite (méthode)

1. Choisir la technique : volume (→ `renderModel` avec capsules/sphères) ou petit détail
   plat (→ `makeBuffer` + `outlineBuffer`).
2. Définir une rampe de 4 tons cohérente avec les tableaux ci-dessus (même luminosité
   d'ombre, même saturation).
3. Ajouter le grain (`hash`) et les détails par `tex`.
4. **Vérifier en image** avant d'intégrer :
   - `node tools/preview.mjs nomu /tmp/x.png '[["anim",0.25,1]]'` (poses de Brainless)
   - `node tools/preview.mjs nomu-sheet /tmp/x.png anim` (une anim × 8 directions)
   - `node tools/preview.mjs nature /tmp/x.png` (tout le décor)

   Puis ouvrir le PNG avec Read et comparer aux planches `docs/ref-*.png`.
5. Brancher le gameplay (`OBJ_INFO`, génération, sons, particules) et tester en jeu.
6. Si le style de référence change volontairement, régénérer les planches :
   `node tools/preview.mjs nomu docs/ref-brainless.png` et
   `node tools/preview.mjs nature docs/ref-nature.png`.
7. Si Brainless change, régénérer les icônes : `node tools/make-icons.mjs`.

## 10. Publication

- Branche `main` servie par GitHub Pages (racine). Pas d'étape de build.
- **À chaque mise à jour, incrémenter `VERSION` dans `sw.js`** sinon l'iPhone garde
  l'ancienne version en cache. Tout nouveau fichier JS doit être ajouté à la liste `FILES`.
- Test local : `python3 -m http.server 8765` puis `http://localhost:8765/` ; `#debug` à la
  fin de l'URL expose `window.BRAINLESS` (monde, joueur, stats…) pour les tests automatisés.
- Les commentaires et textes du jeu sont en français.
