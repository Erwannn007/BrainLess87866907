// Monde ouvert infini, généré par morceaux (chunks) de 32x32 tuiles à la demande.
import { fbm, hash2, mulberry32 } from './noise.js';

export const T = { WATER: 0, SAND: 1, GRASS: 2, FOREST: 3, STONE: 4, SNOW: 5, MEADOW: 6, DEEP: 7, PATH: 8, DIRT: 9, COBBLE: 10,
  // sous terre et dedans : sol de tanière, parois de terre (filons de pierre, de fer), roche dure,
  // plancher, murs d'intérieur (plâtre, peaux), et le vide autour d'une pièce
  DEN: 11, EARTH: 12, EARTH_STONE: 13, EARTH_IRON: 14, BEDROCK: 15, PLANK: 16, WALL_IN: 17, WALL_HIDE: 18, VOID: 19 };

export const O = {
  NONE: 0, OAK_S: 1, OAK_M: 2, OAK_L: 3, PINE: 4, PINE_L: 5, SNOW_PINE: 6, CHERRY: 7,
  BUSH: 8, BERRY: 9, ROCK: 10, ROCK_L: 11, ROCK_MOSS: 12, GRASS: 13,
  FLOWER_R: 14, FLOWER_Y: 15, FLOWER_B: 16, FLOWER_W: 17, MUSHROOM: 18,
  STUMP: 19, LOG: 20, PEBBLES: 21, LILY: 22, REEDS: 23,
  // Bâtiments : 2x2 tuiles. L'objet est posé sur la tuile de devant (ancre) ; les 3 autres
  // tuiles portent un "morceau" qui renvoie vers l'ancre. Chaque bâtiment a 3 états.
  PART_W: 24, PART_N: 25, PART_NW: 26,
  COTTAGE: 27, COTTAGE_D: 28, COTTAGE_R: 29,
  HOUSE: 30, HOUSE_D: 31, HOUSE_R: 32,
  INN: 33, INN_D: 34, INN_R: 35,
  BARN: 36, BARN_D: 37, BARN_R: 38,
  TOWER: 39, TOWER_D: 40, TOWER_R: 41,
  // Objets de village (1 tuile)
  WELL: 42, STALL: 43, FENCE_X: 44, FENCE_Y: 45, BARREL: 46, CRATE: 47, HAY: 48,
  WHEAT: 49, CABBAGE: 50, LANTERN: 51, PLANKS: 52, WELL_R: 53,
  // remparts des villes fortifiées (1 tuile chacun)
  WALL: 54, WALL_D: 55, WALL_R: 56, WALL_TOWER: 57, WALL_TOWER_D: 58,
  // ce que laisse le feu
  BURNT: 59,
  // constructions de Brainless (fabriquées dans l'inventaire, posées sur la grille)
  WALL_WOOD: 60, WALL_STONE: 61, SPIKES: 62, CAMPFIRE: 63, CHEST: 64, NEST: 65, TORCH: 66,
  // ses abris (2x2) : le repaire (une maison à sa tête) et l'entrée de la tanière
  HUT: 67, HUT_D: 68, HUT_R: 69, LAIR: 70, LAIR_D: 71, LAIR_R: 72,
  // sorties (échelle de la tanière, porte d'un intérieur) et meubles
  DEN_EXIT: 73, DOOR_OUT: 74, TABLE: 75, SHELF: 76, BED: 77, RUG: 78, BONES: 79, TOTEM: 80,
  // sa tanière vivante : une cage à prisonniers, un présentoir à trophées, un ancien Nomu fossilisé
  CAGE: 81, RACK: 82, FOSSIL: 83,
};

// Résistance des bâtiments : points de vie avant d'être abîmé, puis avant de s'effondrer.
export const BUILDINGS = {
  cottage: { ids: [O.COTTAGE, O.COTTAGE_D, O.COTTAGE_R], hp: [4, 4], mat: 'thatch', tall: 28 },
  house: { ids: [O.HOUSE, O.HOUSE_D, O.HOUSE_R], hp: [6, 6], mat: 'tile', tall: 36 },
  inn: { ids: [O.INN, O.INN_D, O.INN_R], hp: [8, 8], mat: 'slate', tall: 46 },
  barn: { ids: [O.BARN, O.BARN_D, O.BARN_R], hp: [5, 5], mat: 'barn', tall: 33 },
  tower: { ids: [O.TOWER, O.TOWER_D, O.TOWER_R], hp: [11, 11], mat: 'stone', tall: 74 },
  // construits par Brainless (`built`) : on y entre (`room` : un intérieur, `den` : la tanière)
  hut: { ids: [O.HUT, O.HUT_D, O.HUT_R], hp: [7, 7], mat: 'hide', tall: 34, built: true, room: true },
  lair: { ids: [O.LAIR, O.LAIR_D, O.LAIR_R], hp: [10, 10], mat: 'stone', tall: 20, built: true, den: true },
};
// les bâtiments de village dans lesquels il peut entrer (un intérieur meublé)
export const ENTERABLE = { cottage: 1, house: 1, inn: 1, barn: 1, tower: 1, hut: 1, lair: 1 };

// Collision (rayon en tuiles) et résistance aux coups. `tall` = hauteur en pixels (une marche = 8) :
// en sautant, Brainless passe par-dessus quand ses pieds sont plus hauts (saut normal ≈ 23,
// super saut BOND ≈ 60). `lift` = Brainless peut l'arracher et le lancer (le poids : 1 léger, 3 un arbre).
// `fuel` = ça brûle (secondes de combustible ; les bâtiments brûlent selon leur toit, voir `BURN_MAT`).
export const OBJ_INFO = {
  [O.OAK_S]: { solid: 0.28, tall: 26, hp: 2, tree: true, lift: 2.5, fuel: 12 }, [O.OAK_M]: { solid: 0.3, tall: 32, hp: 3, tree: true, lift: 3, fuel: 14 },
  [O.OAK_L]: { solid: 0.34, tall: 38, hp: 4, tree: true, lift: 3, fuel: 16 }, [O.PINE]: { solid: 0.28, tall: 30, hp: 3, tree: true, lift: 3, fuel: 12 },
  [O.PINE_L]: { solid: 0.32, tall: 38, hp: 4, tree: true, lift: 3, fuel: 14 }, [O.SNOW_PINE]: { solid: 0.3, tall: 31, hp: 3, tree: true, lift: 3, fuel: 8 },
  [O.CHERRY]: { solid: 0.3, tall: 35, hp: 3, tree: true, petals: true, lift: 3, fuel: 12 },
  [O.BUSH]: { solid: 0.3, tall: 11, hp: 1, leafy: true, fuel: 5 }, [O.BERRY]: { solid: 0.3, tall: 11, hp: 1, leafy: true, fuel: 5 },
  [O.ROCK]: { solid: 0.3, tall: 8, hp: 2, rock: true, lift: 1.5 }, [O.ROCK_L]: { solid: 0.38, tall: 14, hp: 4, rock: true, lift: 2.5 },
  [O.ROCK_MOSS]: { solid: 0.32, tall: 9, hp: 3, rock: true, lift: 1.5 },
  [O.STUMP]: { solid: 0.25, tall: 7, hp: 2, wood: true, fuel: 7 }, [O.LOG]: { solid: 0.3, tall: 7, hp: 2, wood: true, lift: 2, fuel: 9 },
  [O.GRASS]: { hp: 0, small: true, fuel: 1.5 }, [O.FLOWER_R]: { hp: 0, small: true, fuel: 1.5 }, [O.FLOWER_Y]: { hp: 0, small: true, fuel: 1.5 },
  [O.FLOWER_B]: { hp: 0, small: true, fuel: 1.5 }, [O.FLOWER_W]: { hp: 0, small: true, fuel: 1.5 }, [O.MUSHROOM]: { hp: 0, small: true },
  [O.PEBBLES]: { hp: 0, small: true }, [O.LILY]: { hp: 0, small: true }, [O.REEDS]: { hp: 0, small: true, fuel: 1.5 },
  [O.PART_W]: { part: [1, 0] }, [O.PART_N]: { part: [0, 1] }, [O.PART_NW]: { part: [1, 1] },
  // village : `crime` = combien ça énerve les villageois quand on le casse
  [O.WELL]: { solid: 0.36, tall: 22, hp: 5, prop: 'stone', village: true, crime: 1.5, next: O.WELL_R },
  [O.WELL_R]: { solid: 0.3, tall: 11, hp: 3, prop: 'stone', village: true, crime: 0.3, next: O.PEBBLES },
  [O.STALL]: { solid: 0.34, tall: 18, hp: 2, prop: 'stall', village: true, crime: 1, next: O.PLANKS, fuel: 7 },
  [O.FENCE_X]: { solid: 0.22, tall: 11, hp: 1, prop: 'wood', village: true, crime: 0.2, next: O.PLANKS, fuel: 4 },
  [O.FENCE_Y]: { solid: 0.22, tall: 11, hp: 1, prop: 'wood', village: true, crime: 0.2, next: O.PLANKS, fuel: 4 },
  [O.BARREL]: { solid: 0.24, tall: 10, hp: 1, prop: 'barrel', village: true, crime: 0.3, lift: 1, fuel: 7 },
  [O.CRATE]: { solid: 0.24, tall: 10, hp: 1, prop: 'wood', village: true, crime: 0.3, next: O.PLANKS, lift: 1, fuel: 6 },
  [O.HAY]: { solid: 0.3, tall: 9, hp: 1, prop: 'hay', village: true, crime: 0.2, lift: 1, fuel: 7 },
  [O.LANTERN]: { solid: 0.14, tall: 20, hp: 1, prop: 'lantern', village: true, crime: 0.5, lift: 1, fuel: 3 },
  [O.WHEAT]: { hp: 0, small: true, crop: true, village: true, crime: 0.1, fuel: 2.5 },
  [O.CABBAGE]: { hp: 0, small: true, crop: true, village: true, crime: 0.1, fuel: 1.5 },
  [O.PLANKS]: { hp: 0, small: true, fuel: 4 },
  [O.BURNT]: { solid: 0.25, tall: 20, hp: 1, wood: true, burnt: true, lift: 2 },
  // constructions (`built`) : `light` = flamme allumée, `spikes` = blesse qui marche dessus
  [O.WALL_WOOD]: { tilebox: true, tall: 18, hp: 5, prop: 'wood', built: true, fuel: 10 },
  [O.WALL_STONE]: { tilebox: true, tall: 18, hp: 10, prop: 'stone', built: true },
  [O.SPIKES]: { hp: 2, prop: 'wood', built: true, spikes: true, fuel: 4 },
  [O.CAMPFIRE]: { solid: 0.3, tall: 6, hp: 2, prop: 'stone', built: true, light: true },
  [O.TORCH]: { solid: 0.12, tall: 16, hp: 1, prop: 'wood', built: true, light: true, fuel: 3 },
  [O.CHEST]: { solid: 0.3, tall: 9, hp: 3, prop: 'wood', built: true, rot: true, fuel: 6 },
  [O.NEST]: { hp: 3, prop: 'hay', built: true, fuel: 6 },
  // `rot` : se tourne sur 4 directions (`world.rots`)
  [O.TABLE]: { solid: 0.34, tall: 10, hp: 2, prop: 'wood', built: true, rot: true, fuel: 6 },
  [O.SHELF]: { solid: 0.3, tall: 20, hp: 2, prop: 'wood', built: true, rot: true, fuel: 7 },
  [O.BED]: { solid: 0.36, tall: 8, hp: 2, prop: 'wood', built: true, rot: true, fuel: 7 },
  [O.RUG]: { hp: 1, prop: 'hay', built: true, rot: true, flat: true, fuel: 3 },
  [O.BONES]: { solid: 0.28, tall: 9, hp: 2, prop: 'stone', built: true, rot: true },
  [O.TOTEM]: { solid: 0.16, tall: 24, hp: 2, prop: 'wood', built: true, rot: true, fuel: 4 },
  [O.CAGE]: { hp: 6, prop: 'wood', built: true, cage: true, fuel: 6 }, // on y enferme un prisonnier (on marche dedans)
  [O.RACK]: { solid: 0.3, tall: 18, hp: 3, prop: 'wood', built: true, rot: true, fuel: 6 },
  [O.FOSSIL]: { solid: 0.34, tall: 8, hp: 6, prop: 'stone', fossil: true },
  // sorties : on marche dessus pour remonter / sortir
  [O.DEN_EXIT]: { exit: true },
  [O.DOOR_OUT]: { exit: true },
  // `tilebox` : bloque toute la tuile (un mur continu, pas un tronc rond)
  [O.WALL]: { tilebox: true, tall: 28, hp: 8, prop: 'stone', village: true, crime: 1, next: O.WALL_D },
  [O.WALL_D]: { tilebox: true, tall: 20, hp: 8, prop: 'stone', village: true, crime: 1, next: O.WALL_R },
  [O.WALL_TOWER]: { tilebox: true, tall: 38, hp: 14, prop: 'stone', village: true, crime: 1.5, next: O.WALL_TOWER_D },
  [O.WALL_TOWER_D]: { tilebox: true, tall: 30, hp: 10, prop: 'stone', village: true, crime: 1.5, next: O.WALL_R },
  [O.WALL_R]: { hp: 0, small: true },
};
for (const name in BUILDINGS) {
  const b = BUILDINGS[name];
  b.ids.forEach((id, state) => {
    OBJ_INFO[id] = {
      building: name, state, mat: b.mat, village: !b.built, built: !!b.built, rot: !!b.built, room: !!b.room, den: !!b.den,
      box: state < 2 ? 0.76 : 0, // demi-largeur de la boîte de collision (en tuiles) ; la ruine se traverse
      tall: b.tall,
      hp: state < 2 ? b.hp[state] : 0, next: state < 2 ? b.ids[state + 1] : 0,
    };
  });
}

const CS = 32;
export const VG = 80; // une région de 80x80 tuiles a au plus un village
export const VILLAGE_KINDS = ['HAMEAU', 'VILLAGE', 'GRAND VILLAGE', 'VILLE FORTIFIEE'];

export class World {
  // params : { villages, heroes, wildlife, weather, relief, water, difficulty }, chacun 0, 1 ou 2
  constructor(seed, params = {}) {
    this.seed = seed;
    this.p = { villages: 1, heroes: 1, wildlife: 1, weather: 1, relief: 1, water: 1, difficulty: 1, ...params };
    this.chunks = new Map();
    this.mods = new Map(); // "x,y" -> objet (0 = détruit)
    this.terr = new Map(); // "x,y" -> [type, hauteur, instant] : sol creusé par les coups
    this.wear = new Map(); // "x,y" -> [niveau 1..3, instant] : sol fissuré
    this.villages = new Map();
    this.deaths = new Map(); // id du village -> { civ, knight } : les morts ne reviennent pas
    this.chests = new Map(); // "x,y" -> contenu d'un coffre posé par Brainless
    this.rots = new Map(); // "x,y" -> 0..3 : quart de tour d'une construction
    this.racks = new Map(); // "x,y" -> trophées exposés sur un présentoir
    this.captives = []; // prisonniers laissés là (tanière, repaire) quand il ressort
    this.ruins = new Map(); // "x,y" -> instant où une maison de village est tombée en ruine (elle sera rebâtie)
    this._lastKey = null;
    this._lastChunk = null;
  }

  chunk(cx, cy) {
    const key = cx + ',' + cy;
    if (key === this._lastKey) return this._lastChunk;
    let c = this.chunks.get(key);
    if (!c) {
      c = this.generate(cx, cy);
      this.chunks.set(key, c);
    }
    this._lastKey = key;
    this._lastChunk = c;
    return c;
  }

  idx(x, y) { return (y & (CS - 1)) * CS + (x & (CS - 1)); }
  typeAt(x, y) { return this.chunk(x >> 5, y >> 5).type[this.idx(x, y)]; }
  hAt(x, y) { return this.chunk(x >> 5, y >> 5).h[this.idx(x, y)]; }
  objAt(x, y) { return this.chunk(x >> 5, y >> 5).obj[this.idx(x, y)]; }
  varAt(x, y) { return this.chunk(x >> 5, y >> 5).v[this.idx(x, y)]; }
  wearAt(x, y) { return this.chunk(x >> 5, y >> 5).w[this.idx(x, y)]; }

  setObj(x, y, o) {
    this.chunk(x >> 5, y >> 5).obj[this.idx(x, y)] = o;
    this.mods.set(x + ',' + y, o);
    this.rots.delete(x + ',' + y);
  }
  rotAt(x, y) { return this.rots.get(x + ',' + y) || 0; }
  setRot(x, y, k) { if (k) this.rots.set(x + ',' + y, k); else this.rots.delete(x + ',' + y); }

  setTile(x, y, t, h, stamp) {
    const c = this.chunk(x >> 5, y >> 5), i = this.idx(x, y);
    c.type[i] = t; c.h[i] = h;
    this.terr.set(x + ',' + y, [t, h, stamp]);
  }

  setWear(x, y, level, stamp) {
    this.chunk(x >> 5, y >> 5).w[this.idx(x, y)] = level;
    if (level > 0) this.wear.set(x + ',' + y, [level, stamp]);
    else this.wear.delete(x + ',' + y);
  }

  // Tuile d'ancrage du bâtiment qui occupe (x, y), ou null.
  anchorOf(x, y) {
    const info = OBJ_INFO[this.objAt(x, y)];
    if (!info) return null;
    if (info.part) return [x + info.part[0], y + info.part[1]];
    if (info.building) return [x, y];
    return null;
  }

  walkable(x, y) {
    const t = this.typeAt(x, y);
    return t !== T.WATER && t !== T.DEEP;
  }

  generate(cx, cy) {
    const n = CS * CS;
    const c = { type: new Uint8Array(n), h: new Uint8Array(n), obj: new Uint8Array(n), v: new Uint8Array(n), w: new Uint8Array(n) };
    for (let ly = 0; ly < CS; ly++) {
      for (let lx = 0; lx < CS; lx++) {
        const x = cx * CS + lx, y = cy * CS + ly;
        const i = ly * CS + lx;
        const cell = this.genCell(x, y);
        c.type[i] = cell.t;
        c.h[i] = cell.h;
        c.obj[i] = cell.o;
        c.v[i] = (hash2(x, y, this.seed + 5) * 4) | 0;
      }
    }
    // Les modifications du joueur (arbres cassés, sol creusé, fissures…) sont réappliquées.
    for (let ly = 0; ly < CS; ly++) {
      for (let lx = 0; lx < CS; lx++) {
        const key = (cx * CS + lx) + ',' + (cy * CS + ly), i = ly * CS + lx;
        const m = this.mods.get(key);
        if (m !== undefined) c.obj[i] = m;
        const t = this.terr.get(key);
        if (t) { c.type[i] = t[0]; c.h[i] = t[1]; }
        const w = this.wear.get(key);
        if (w) c.w[i] = w[0];
      }
    }
    return c;
  }

  // Terrain naturel, avant les villages.
  genTerrain(x, y) {
    const s = this.seed;
    let e = fbm(x * 0.016, y * 0.016, s, 5);
    // Garantit de la terre autour du point de départ.
    e += 0.12 * Math.exp(-(x * x + y * y) / (2 * 30 * 30));
    e += [0.035, 0, -0.045][this.p.water]; // plus ou moins de mers et de lacs
    const m = fbm(x * 0.028 + 500, y * 0.028 - 300, s + 7, 3);
    const dr = Math.abs(fbm(x * 0.009 + 1000, y * 0.009, s + 13, 3) - 0.5);

    let t, h = 0;
    if (e < 0.33) t = T.DEEP;
    else if (e < 0.375) t = T.WATER;
    else if (e < 0.4) t = T.SAND;
    else {
      h = Math.min(6, 1 + Math.floor((e - 0.4) / [0.075, 0.055, 0.042][this.p.relief]));
      if (e > 0.71) t = T.SNOW;
      else if (e > 0.665) t = T.STONE;
      else if (m > 0.55) t = T.FOREST;
      else if (m < 0.43) t = T.MEADOW;
      else t = T.GRASS;
    }

    // Rivières qui creusent des vallées en terrasses.
    if (t !== T.DEEP && t !== T.WATER && e < 0.8) {
      if (dr < 0.011) { t = T.WATER; h = 0; }
      else {
        const cap = Math.floor((dr - 0.011) / 0.009);
        if (cap === 0) { t = T.SAND; h = 0; }
        else if (h > cap) { h = cap; if (t === T.SNOW || t === T.STONE) t = T.GRASS; }
      }
    }

    const r = hash2(x, y, s + 99), r2 = hash2(x, y, s + 177);
    const dens = fbm(x * 0.06, y * 0.06, s + 31, 2);
    let o = O.NONE;
    switch (t) {
      case T.FOREST:
        if (r < 0.2 + dens * 0.25) o = (h >= 4 || r2 < 0.3) ? (r2 < 0.12 ? O.PINE_L : O.PINE) : (r2 < 0.55 ? O.OAK_M : r2 < 0.8 ? O.OAK_L : O.OAK_S);
        else if (r < 0.5) o = r2 < 0.5 ? O.BUSH : r2 < 0.7 ? O.BERRY : r2 < 0.85 ? O.MUSHROOM : O.GRASS;
        else if (r < 0.56) o = O.GRASS;
        else if (r < 0.575) o = O.ROCK_MOSS;
        break;
      case T.GRASS:
        if (r < 0.006) o = O.CHERRY;
        else if (r < 0.04) o = r2 < 0.5 ? O.OAK_M : r2 < 0.8 ? O.OAK_S : O.OAK_L;
        else if (r < 0.06) o = O.BUSH;
        else if (r < 0.22) o = O.GRASS;
        else if (r < 0.28) o = O.FLOWER_R + ((r2 * 4) | 0);
        else if (r < 0.29) o = O.ROCK;
        break;
      case T.MEADOW:
        if (r < 0.012) o = O.CHERRY;
        else if (r < 0.02) o = O.OAK_M;
        else if (r < 0.3) o = O.FLOWER_R + ((r2 * 4) | 0);
        else if (r < 0.45) o = O.GRASS;
        else if (r < 0.457) o = O.ROCK;
        break;
      case T.SAND:
        if (r < 0.02) o = O.ROCK;
        else if (r < 0.045) o = O.PEBBLES;
        else if (r < 0.07) o = O.REEDS;
        break;
      case T.STONE:
        if (r < 0.06) o = r2 < 0.4 ? O.ROCK_L : O.ROCK;
        else if (r < 0.14) o = O.PINE;
        else if (r < 0.18) o = O.PEBBLES;
        break;
      case T.SNOW:
        if (r < 0.08) o = O.SNOW_PINE;
        else if (r < 0.11) o = O.ROCK;
        break;
      case T.WATER:
        if (r < 0.025) o = O.LILY;
        break;
    }
    return { t, h, o };
  }

  // Terrain + villages : le sol est aplani autour du village, les arbres retirés,
  // puis on pose les chemins, les maisons et les objets du plan du village.
  genCell(x, y) {
    const cell = this.genTerrain(x, y);
    const wet = cell.t === T.WATER || cell.t === T.DEEP;
    const rx = Math.floor(x / VG), ry = Math.floor(y / VG);
    for (let j = -1; j <= 1; j++) {
      for (let i = -1; i <= 1; i++) {
        const v = this.villageIn(rx + i, ry + j);
        if (!v) continue;
        const d = Math.hypot(x - v.cx, y - v.cy);
        if (d >= v.R + 7) continue;
        if (wet) {
          // une ville comble l'eau à l'intérieur de ses remparts ; ailleurs l'eau reste de l'eau
          if (v.kind !== 3 || Math.max(Math.abs(x - v.cx), Math.abs(y - v.cy)) > Math.floor(v.R * 0.68) + 1) return cell;
          cell.t = T.GRASS; cell.h = v.hv; cell.o = O.NONE;
        }
        const w = Math.min(1, (v.R + 7 - d) / 5), k = w * w * (3 - 2 * w);
        cell.h = Math.round(cell.h + (v.hv - cell.h) * k);
        if (d < v.R + 2) {
          if (cell.t !== T.MEADOW) cell.t = T.GRASS;
          if (cell.o && !(OBJ_INFO[cell.o] || {}).small) cell.o = O.NONE;
        }
        const c = v.cells.get(x + ',' + y);
        if (c) {
          if (c.t !== undefined) { cell.t = c.t; cell.o = O.NONE; }
          if (c.o !== undefined) cell.o = c.o;
        }
        return cell;
      }
    }
    return cell;
  }

  // ---------------------------------------------------------------- villages
  villagesNear(x, y) {
    const rx = Math.floor(x / VG), ry = Math.floor(y / VG), out = [];
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      const v = this.villageIn(rx + i, ry + j);
      if (v) out.push(v);
    }
    return out;
  }

  villageIn(rx, ry) {
    const key = rx + ',' + ry;
    if (this.villages.has(key)) return this.villages.get(key);
    const v = this.planVillage(rx, ry);
    this.villages.set(key, v);
    return v;
  }

  // Le sol est-il assez plat et sec pour poser un village de rayon R en (cx, cy) ?
  // Une ville (grand rayon) est moins exigeante : seul l'intérieur des remparts doit être sec.
  siteOk(cx, cy, R) {
    const c = this.genTerrain(cx, cy);
    if (!(c.t === T.GRASS || c.t === T.MEADOW || c.t === T.FOREST) || c.h < 1 || c.h > 4) return null;
    const town = R > 20, Rc = town ? Math.ceil(R * 0.97) : R + 2;
    let n = 0, bad = 0, steep = 0, wet = 0;
    for (let dy = -Rc; dy <= Rc; dy += 2) {
      for (let dx = -Rc; dx <= Rc; dx += 2) {
        if (dx * dx + dy * dy > Rc * Rc) continue;
        const s = this.genTerrain(cx + dx, cy + dy);
        n++;
        if (s.t === T.WATER || s.t === T.DEEP) { if (!town) return null; wet++; }
        if (s.t === T.STONE || s.t === T.SNOW || s.t === T.SAND) bad++;
        if (Math.abs(s.h - c.h) > 1) steep++;
      }
    }
    if (bad > n * (town ? 0.3 : 0.2) || steep > n * (town ? 0.45 : 0.3) || wet > n * 0.25) return null;
    return c.h;
  }

  planVillage(rx, ry) {
    const s = this.seed;
    const home = rx === 0 && ry === 0; // un grand village pas loin du départ
    if (!home && hash2(rx, ry, s + 501) > [0.3, 0.55, 0.78][this.p.villages]) return null;
    const rng = mulberry32((s ^ Math.imul(rx, 92821) ^ Math.imul(ry, 68917)) >>> 0);
    const roll = rng();
    let kind = home ? 2 : roll < 0.32 ? 0 : roll < 0.65 ? 1 : roll < 0.86 ? 2 : 3;
    let R = [7, 10, 13, 24][kind];
    let cx = 0, cy = 0, hv = null;
    if (home) {
      // le site plat le plus proche du départ, en spirale
      for (let rad = 14; rad < 60 && hv === null; rad += 2) {
        for (let k = 0; k < rad * 3 && hv === null; k++) {
          const a = (k / (rad * 3)) * Math.PI * 2;
          cx = Math.round(Math.cos(a) * rad); cy = Math.round(Math.sin(a) * rad);
          hv = this.siteOk(cx, cy, R);
        }
      }
    }
    for (let tries = 0; tries < (kind === 3 ? 40 : 14) && hv === null && !home; tries++) {
      // une ville prend presque toute sa région : son centre reste loin des bords
      const m = kind === 3 ? 32 : 24;
      cx = rx * VG + m + Math.floor(rng() * (VG - 2 * m));
      cy = ry * VG + m + Math.floor(rng() * (VG - 2 * m));
      hv = this.siteOk(cx, cy, R);
      if (hv === null && kind === 3 && tries === 39) { kind = 2; R = 13; tries = -1; } // pas de place : un grand village
    }
    if (hv === null) return null;

    // garnison : un nombre fixe de chevaliers par village, sans renforts
    const v = { id: rx + ',' + ry, kind, name: VILLAGE_KINDS[kind], cx, cy, R, hv, cells: new Map(), houses: [], tower: null, garrison: [1, 3, 5, 10][kind], folk: 0 };
    const K = (x, y) => x + ',' + y;
    const occ = new Set(); // tuiles réservées (bâtiments + leur marge)
    const bld = new Set(); // tuiles sous un bâtiment
    const put = (x, y, c) => v.cells.set(K(x, y), Object.assign(v.cells.get(K(x, y)) || {}, c));
    const free = (x, y) => !occ.has(K(x, y)) && !(v.cells.get(K(x, y)) || {}).o && Math.hypot(x - cx, y - cy) < R;

    if (kind === 3) return this.planTown(v, rng, { K, occ, bld, put });

    // place centrale : pavés pour les gros villages, terre battue sinon, un puits au milieu
    const pr = kind === 2 ? 3 : kind === 1 ? 2 : 1;
    for (let dy = -pr; dy <= pr; dy++) for (let dx = -pr; dx <= pr; dx++) {
      if (dx * dx + dy * dy > pr * pr + 1) continue;
      put(cx + dx, cy + dy, { t: kind === 2 ? T.COBBLE : T.PATH });
      occ.add(K(cx + dx, cy + dy));
    }
    put(cx, cy, { o: O.WELL });

    // bâtiments, du plus important au plus petit
    const want = [
      ['cottage', 'cottage', 'barn'],
      ['house', 'cottage', 'house', 'barn', 'cottage', 'house', rng() < 0.6 ? 'inn' : 'cottage'],
      ['tower', 'inn', 'house', 'house', 'cottage', 'barn', 'house', 'cottage', 'house', 'cottage', 'house', 'barn', 'cottage'],
    ][kind];
    for (const type of want) {
      for (let tries = 0; tries < 40; tries++) {
        const a = rng() * Math.PI * 2, d = pr + 2.5 + rng() * (R - pr - 3.5);
        const ax = Math.round(cx + Math.cos(a) * d), ay = Math.round(cy + Math.sin(a) * d);
        let ok = true;
        for (let y = ay - 2; y <= ay + 1 && ok; y++) for (let x = ax - 2; x <= ax + 1 && ok; x++) {
          if (occ.has(K(x, y))) ok = false;
          if (x >= ax - 1 && y >= ay - 1 && Math.hypot(x - cx, y - cy) > R - 0.5) ok = false;
        }
        if (!ok) continue;
        for (let y = ay - 2; y <= ay + 1; y++) for (let x = ax - 2; x <= ax + 1; x++) occ.add(K(x, y));
        for (const [x, y] of [[ax - 1, ay - 1], [ax - 1, ay], [ax, ay - 1], [ax, ay]]) bld.add(K(x, y));
        put(ax - 1, ay - 1, { o: O.PART_NW }); put(ax - 1, ay, { o: O.PART_W }); put(ax, ay - 1, { o: O.PART_N });
        put(ax, ay, { o: BUILDINGS[type].ids[0] });
        const h = { type, ax, ay, door: [ax, ay + 1.3] };
        v.houses.push(h);
        if (type === 'tower') v.tower = h;
        break;
      }
    }

    v.folk = Math.min(12, 2 + v.houses.length);
    // héros (chacun a un alter) : surtout dans les grands villages
    const hc = home ? (this.p.heroes === 2 ? 1 : 0) : rng() < [[0, 0, 0.15], [0, 0.15, 0.4], [0.25, 0.6, 1]][kind][this.p.heroes] ? 1 : 0;
    v.heroes = this.pickHeroes(rng, hc);

    // chemins de terre de chaque porte jusqu'à la place
    for (const h of v.houses) {
      let x = h.ax, y = h.ay + 1;
      for (let step = 0; step < 60; step++) {
        if (Math.hypot(x - cx, y - cy) <= pr) break;
        if (!bld.has(K(x, y)) && !(v.cells.get(K(x, y)) || {}).o) put(x, y, { t: T.PATH });
        const dx = cx - x, dy = cy - y;
        const sx = Math.sign(dx), sy = Math.sign(dy);
        const first = Math.abs(dx) > Math.abs(dy) || (Math.abs(dx) === Math.abs(dy) && step % 2) ? [sx, 0] : [0, sy];
        const second = first[0] ? [0, sy] : [sx, 0];
        if (!bld.has(K(x + first[0], y + first[1]))) { x += first[0]; y += first[1]; } else { x += second[0]; y += second[1]; }
      }
    }
    const isPath = (x, y) => { const c = v.cells.get(K(x, y)); return c && (c.t === T.PATH || c.t === T.COBBLE); };
    const freeProp = (x, y) => free(x, y) && !isPath(x, y) && !bld.has(K(x, y));

    // champs cultivés, entourés d'une clôture pour les villages
    const fields = [1, 2, 3][kind];
    for (let f = 0; f < fields; f++) {
      for (let tries = 0; tries < 30; tries++) {
        const fw = 3 + ((rng() * 2) | 0), fh = 2 + ((rng() * 2) | 0);
        const a = rng() * Math.PI * 2, d = R * 0.55 + rng() * R * 0.35;
        const x0 = Math.round(cx + Math.cos(a) * d - fw / 2), y0 = Math.round(cy + Math.sin(a) * d - fh / 2);
        const fence = kind > 0;
        const m = fence ? 1 : 0;
        let ok = true;
        for (let y = y0 - m; y < y0 + fh + m && ok; y++) for (let x = x0 - m; x < x0 + fw + m && ok; x++) if (!freeProp(x, y)) ok = false;
        if (!ok) continue;
        const crop = rng() < 0.5 ? O.WHEAT : O.CABBAGE;
        for (let y = y0; y < y0 + fh; y++) for (let x = x0; x < x0 + fw; x++) { put(x, y, { t: T.DIRT, o: crop }); occ.add(K(x, y)); }
        if (fence) {
          const gap = (rng() * (fw + 2)) | 0;
          for (let x = x0 - 1; x <= x0 + fw; x++) {
            if (x - x0 + 1 !== gap) put(x, y0 + fh, { o: O.FENCE_X });
            put(x, y0 - 1, { o: O.FENCE_X });
            occ.add(K(x, y0 - 1)); occ.add(K(x, y0 + fh));
          }
          for (let y = y0; y < y0 + fh; y++) {
            put(x0 - 1, y, { o: O.FENCE_Y }); put(x0 + fw, y, { o: O.FENCE_Y });
            occ.add(K(x0 - 1, y)); occ.add(K(x0 + fw, y));
          }
        }
        break;
      }
    }

    // tonneaux, caisses et foin contre les maisons ; lanternes devant les portes
    for (const h of v.houses) {
      const spots = [[h.ax + 1, h.ay - 1], [h.ax + 1, h.ay], [h.ax - 2, h.ay], [h.ax - 1, h.ay - 2], [h.ax, h.ay - 2]];
      const n = h.type === 'barn' ? 3 : (rng() * 3) | 0;
      for (let i = 0; i < n; i++) {
        const [x, y] = spots[(rng() * spots.length) | 0];
        if (!isPath(x, y) && !(v.cells.get(K(x, y)) || {}).o) put(x, y, { o: h.type === 'barn' ? (rng() < 0.6 ? O.HAY : O.CRATE) : rng() < 0.5 ? O.BARREL : O.CRATE });
      }
      if (kind > 0 && !isPath(h.ax + 1, h.ay + 1) && !(v.cells.get(K(h.ax + 1, h.ay + 1)) || {}).o) put(h.ax + 1, h.ay + 1, { o: O.LANTERN });
    }
    // étals de marché et lanternes autour de la place
    if (kind > 0) {
      for (let i = 0; i < 4; i++) {
        const a = i * Math.PI / 2 + 0.4, d = pr + 1;
        const x = Math.round(cx + Math.cos(a) * d), y = Math.round(cy + Math.sin(a) * d);
        if (freeProp(x, y)) put(x, y, { o: i < kind * 2 ? O.STALL : O.LANTERN });
      }
      for (const [dx, dy] of [[1, 1], [-1, -1], [1, -1], [-1, 1]]) {
        const x = cx + dx * (pr + 1), y = cy + dy * (pr + 1);
        if (freeProp(x, y)) put(x, y, { o: O.LANTERN });
      }
    }
    // quelques arbres pour faire joli
    for (let i = 0; i < 2 + kind * 2; i++) {
      const a = rng() * Math.PI * 2, d = R * 0.5 + rng() * R * 0.45;
      const x = Math.round(cx + Math.cos(a) * d), y = Math.round(cy + Math.sin(a) * d);
      if (freeProp(x, y) && freeProp(x + 1, y) && freeProp(x, y + 1)) put(x, y, { o: rng() < 0.4 ? O.CHERRY : O.OAK_M });
    }
    return v;
  }

  // Ville fortifiée : une enceinte carrée de remparts avec 4 portes, des rues pavées en croix,
  // une grande place, et des maisons serrées dans chaque quartier.
  planTown(v, rng, { K, occ, bld, put }) {
    const { cx, cy } = v;
    const Wd = Math.floor(v.R * 0.68); // demi-côté de l'enceinte
    // remparts : portes au milieu de chaque côté, flanquées de deux tours ; tours aux coins
    for (let d = -Wd; d <= Wd; d++) {
      for (const [x, y, along] of [[cx + d, cy - Wd, d], [cx + d, cy + Wd, d], [cx - Wd, cy + d, d], [cx + Wd, cy + d, d]]) {
        occ.add(K(x, y));
        const corner = Math.abs(d) === Wd;
        if (Math.abs(along) <= 1 && !corner) { put(x, y, { t: T.COBBLE }); continue; } // la porte
        put(x, y, { o: corner || Math.abs(along) === 2 ? O.WALL_TOWER : O.WALL });
      }
    }
    // rues pavées de porte à porte (3 de large) et grande place
    for (let d = -Wd + 1; d < Wd; d++) for (let w = -1; w <= 1; w++) {
      put(cx + d, cy + w, { t: T.COBBLE }); put(cx + w, cy + d, { t: T.COBBLE });
      occ.add(K(cx + d, cy + w)); occ.add(K(cx + w, cy + d));
    }
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      if (dx * dx + dy * dy > 18) continue;
      put(cx + dx, cy + dy, { t: T.COBBLE }); occ.add(K(cx + dx, cy + dy));
    }
    put(cx, cy, { o: O.WELL });
    // bâtiments : on remplit chaque quartier
    const place = (type, ax, ay) => {
      for (let y = ay - 2; y <= ay + 1; y++) for (let x = ax - 2; x <= ax + 1; x++) {
        if (occ.has(K(x, y)) || Math.max(Math.abs(x - cx), Math.abs(y - cy)) >= Wd) return false;
      }
      for (let y = ay - 2; y <= ay + 1; y++) for (let x = ax - 2; x <= ax + 1; x++) occ.add(K(x, y));
      for (const [x, y] of [[ax - 1, ay - 1], [ax - 1, ay], [ax, ay - 1], [ax, ay]]) bld.add(K(x, y));
      put(ax - 1, ay - 1, { o: O.PART_NW }); put(ax - 1, ay, { o: O.PART_W }); put(ax, ay - 1, { o: O.PART_N });
      put(ax, ay, { o: BUILDINGS[type].ids[0] });
      const h = { type, ax, ay, door: [ax, ay + 1.3] };
      v.houses.push(h);
      if (type === 'tower' && !v.tower) v.tower = h;
      return true;
    };
    // deux tours de garde près de la place, puis les maisons
    place('tower', cx + 6, cy + 6); place('tower', cx - 4, cy - 4); place('inn', cx + 6, cy - 3);
    for (let tries = 0; tries < 600 && v.houses.length < 32; tries++) {
      const ax = cx + Math.round((rng() * 2 - 1) * (Wd - 2)), ay = cy + Math.round((rng() * 2 - 1) * (Wd - 2));
      const r = rng();
      place(r < 0.5 ? 'house' : r < 0.75 ? 'cottage' : r < 0.9 ? 'inn' : 'barn', ax, ay);
    }
    // étals le long de la rue principale, lanternes et tonneaux
    for (let d = -Wd + 3; d < Wd - 2; d += 3) {
      for (const [x, y] of [[cx + d, cy + 2], [cx + d, cy - 2], [cx + 2, cy + d], [cx - 2, cy + d]]) {
        if (occ.has(K(x, y)) || (v.cells.get(K(x, y)) || {}).o) continue;
        const r = rng();
        put(x, y, { o: Math.abs(d) < 8 ? (r < 0.6 ? O.STALL : O.LANTERN) : r < 0.35 ? O.LANTERN : r < 0.6 ? O.BARREL : O.CRATE });
        occ.add(K(x, y));
      }
    }
    v.folk = 20;
    v.heroes = this.pickHeroes(rng, [1, 2, 3][this.p.heroes]);
    v.champion = Math.floor(rng() * 5); // le champion de la ville : un héros légendaire, bien plus coriace
    return v;
  }

  // n héros tous différents (indices dans la liste des héros).
  pickHeroes(rng, n) {
    const all = [0, 1, 2, 3, 4];
    for (let i = all.length - 1; i > 0; i--) { const j = (rng() * (i + 1)) | 0; [all[i], all[j]] = [all[j], all[i]]; }
    return all.slice(0, n);
  }

  // Cherche une tuile d'herbe libre près de l'origine.
  findSpawn() {
    for (let rad = 0; rad < 200; rad++) {
      for (let dy = -rad; dy <= rad; dy++) {
        for (let dx = -rad; dx <= rad; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== rad) continue;
          const t = this.typeAt(dx, dy);
          if ((t === T.GRASS || t === T.MEADOW) && this.objAt(dx, dy) === O.NONE) return { x: dx + 0.5, y: dy + 0.5 };
        }
      }
    }
    return { x: 0.5, y: 0.5 };
  }
}

// ---------------------------------------------------------------- sous terre et dedans
// Les lieux où l'on entre sont des petits mondes à part, avec le même moteur : le jeu
// remplace `world` le temps qu'il y reste. `solid(x, y)` = paroi (bloque toujours).

// Ce que coûte une paroi de terre à creuser (coups), et ce qu'elle rend.
export const DIG = {
  [T.EARTH]: { hp: 2, drops: [['dirt', 1]] },
  [T.EARTH_STONE]: { hp: 5, drops: [['stone', 2]] },
  [T.EARTH_IRON]: { hp: 6, drops: [['iron', 1], ['stone', 1]] },
};
const WALL_H = 2; // hauteur des parois de la tanière (en marches)

// La tanière : un immense bloc de terre (80x80 tuiles, bordé de roche dure) où il creuse ses salles.
// Au départ, une petite grotte avec l'échelle qui remonte.
export const DEN_R = 40;
export class Den extends World {
  constructor(seed) {
    super(seed + 4242);
    this.den = true;
    this.realm = 'den';
    this.exitKey = '0,-3'; // l'échelle
    this.found = new Set(); // tuiles creusées où une trouvaille est déjà sortie
  }
  villageIn() { return null; }
  solid(x, y) { const t = this.typeAt(x, y); return t === T.EARTH || t === T.EARTH_STONE || t === T.EARTH_IRON || t === T.BEDROCK; }
  genCell(x, y) {
    if (Math.max(Math.abs(x + 0.5), Math.abs(y + 0.5)) > DEN_R) return { t: T.BEDROCK, h: WALL_H, o: O.NONE };
    if (Math.hypot(x + 0.5, (y + 0.5) * 1.15) < 3.4) return { t: T.DEN, h: 0, o: x === 0 && y === -3 ? O.DEN_EXIT : O.NONE };
    const s = this.seed;
    if (fbm(x * 0.11, y * 0.11, s + 3, 3) > 0.67 && hash2(x, y, s + 4) < 0.8) return { t: T.EARTH_STONE, h: WALL_H, o: O.NONE };
    if (fbm(x * 0.17 + 50, y * 0.17, s + 9, 2) > 0.7 && hash2(x, y, s + 5) < 0.6) return { t: T.EARTH_IRON, h: WALL_H, o: O.NONE };
    return { t: T.EARTH, h: WALL_H, o: O.NONE };
  }
  findSpawn() { return { x: 0.5, y: 0.5 }; }
  // Ce qu'on trouve parfois en creusant une paroi (une seule fois par tuile, voir `found`)
  secretAt(x, y) {
    if (Math.hypot(x, y) < 7 || hash2(x, y, this.seed + 77) > 0.014) return null;
    const r = hash2(x, y, this.seed + 78);
    return r < 0.4 ? 'chest' : r < 0.62 ? 'bones' : r < 0.84 ? 'fossil' : 'spring';
  }
  loot(key) {
    const rng = mulberry32((this.seed ^ (key.length * 7919 + key.charCodeAt(1) * 31 + key.charCodeAt(key.length - 1))) >>> 0), out = [];
    for (const [id, n, p] of [['iron', 4, 0.8], ['stone', 6, 0.6], ['steak', 3, 0.5], ['emblem', 1, 0.25], ['helmet', 1, 0.3], ['berries', 5, 0.4]]) if (rng() < p) out.push({ id, n: 1 + Math.floor(rng() * n) });
    return out;
  }
}

// Les intérieurs : une pièce de w x h tuiles (x de 0 à w-1, y de 0 à h-1), murs hauts au fond,
// murets devant (on voit dedans), une porte au milieu du mur de devant. Meublée selon la maison.
const ROOMS = {
  cottage: { w: 6, h: 5, floor: T.PLANK, wall: T.WALL_IN, items: [[0, 0, O.BED, 0], [2, 0, O.SHELF, 0], [5, 0, O.BARREL, 0], [3, 2, O.TABLE, 0], [0, 3, O.CHEST, 3], [5, 3, O.CRATE, 0], [2, 3, O.RUG, 0]] },
  house: { w: 7, h: 6, floor: T.PLANK, wall: T.WALL_IN, items: [[0, 0, O.BED, 0], [1, 0, O.BED, 0], [3, 0, O.SHELF, 0], [4, 0, O.SHELF, 0], [6, 0, O.CHEST, 0], [3, 3, O.TABLE, 1], [2, 3, O.RUG, 1], [0, 5, O.CRATE, 0], [6, 5, O.BARREL, 0], [6, 2, O.LANTERN, 0]] },
  inn: { w: 9, h: 7, floor: T.PLANK, wall: T.WALL_IN, items: [[0, 0, O.CHEST, 0], [2, 0, O.SHELF, 0], [3, 0, O.SHELF, 0], [8, 0, O.BARREL, 0], [8, 1, O.BARREL, 0], [8, 2, O.BARREL, 0], [2, 3, O.TABLE, 0], [5, 3, O.TABLE, 1], [2, 5, O.TABLE, 1], [6, 5, O.RUG, 0], [0, 6, O.LANTERN, 0], [0, 3, O.BED, 3]] },
  barn: { w: 8, h: 6, floor: T.DIRT, wall: T.WALL_IN, items: [[0, 0, O.HAY, 0], [1, 0, O.HAY, 0], [0, 1, O.HAY, 0], [6, 0, O.CRATE, 0], [7, 0, O.CRATE, 0], [7, 1, O.BARREL, 0], [4, 3, O.PLANKS, 0], [0, 5, O.CHEST, 3], [7, 5, O.HAY, 0]] },
  tower: { w: 5, h: 5, floor: T.PLANK, wall: T.WALL_IN, items: [[0, 0, O.CRATE, 0], [1, 0, O.CRATE, 0], [4, 0, O.BARREL, 0], [4, 1, O.BARREL, 0], [2, 0, O.SHELF, 0], [0, 4, O.CHEST, 3], [4, 4, O.LANTERN, 0]] },
  hut: { w: 7, h: 7, floor: T.DEN, wall: T.WALL_HIDE, items: [[3, 3, O.RUG, 0], [0, 0, O.TOTEM, 0]] },
};
export const ROOM_NAMES = { cottage: 'CHAUMIERE', house: 'MAISON', inn: 'AUBERGE', barn: 'GRANGE', tower: 'TOUR DE GUET', hut: 'SON REPAIRE' };

export class Room extends World {
  constructor(seed, kind) {
    super(seed);
    const R = ROOMS[kind];
    this.realm = 'room';
    this.kind = kind;
    this.w = R.w; this.h = R.h;
    this.floorT = R.floor; this.wallT = R.wall;
    this.door = [Math.floor(R.w / 2), R.h];
    this.exitKey = this.door[0] + ',' + this.door[1];
    this.items = new Map(R.items.map(([x, y, o, k]) => [x + ',' + y, [o, k]]));
    for (const [k, [, r]] of this.items) if (r) this.rots.set(k, r);
    this.village = kind !== 'hut';
  }
  villageIn() { return null; }
  solid(x, y) { const t = this.typeAt(x, y); return t === this.wallT || t === T.VOID; }
  genCell(x, y) {
    const { w, h } = this;
    if (x === this.door[0] && y === this.door[1]) return { t: this.floorT, h: 0, o: O.DOOR_OUT };
    if (x >= 0 && x < w && y >= 0 && y < h) { const it = this.items.get(x + ',' + y); return { t: this.floorT, h: 0, o: it ? it[0] : O.NONE }; }
    if (x >= -1 && x <= w && y >= -1 && y <= h) return { t: this.wallT, h: x === -1 || y === -1 ? 4 : 1, o: O.NONE }; // murs du fond hauts, murets devant
    return { t: T.VOID, h: 0, o: O.NONE };
  }
  findSpawn() { return { x: this.door[0] + 0.5, y: this.h - 0.6 }; }
  // le contenu d'un coffre de villageois, la première fois qu'on l'ouvre
  loot(key) {
    if (!this.village) return null;
    const rng = mulberry32((this.seed ^ (key.length * 7919 + key.charCodeAt(0) * 31)) >>> 0);
    const out = [];
    const pool = [['berries', 6], ['steak', 3], ['wood', 8], ['straw', 6], ['iron', 2], ['stone', 5]];
    for (const [id, n] of pool) if (rng() < 0.45) out.push({ id, n: 1 + Math.floor(rng() * n) });
    return out;
  }
}
