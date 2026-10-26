// Monde ouvert infini, généré par morceaux (chunks) de 32x32 tuiles à la demande.
import { fbm, hash2, mulberry32 } from './noise.js';

export const T = { WATER: 0, SAND: 1, GRASS: 2, FOREST: 3, STONE: 4, SNOW: 5, MEADOW: 6, DEEP: 7, PATH: 8, DIRT: 9, COBBLE: 10 };

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
};

// Résistance des bâtiments : points de vie avant d'être abîmé, puis avant de s'effondrer.
export const BUILDINGS = {
  cottage: { ids: [O.COTTAGE, O.COTTAGE_D, O.COTTAGE_R], hp: [4, 4], mat: 'thatch' },
  house: { ids: [O.HOUSE, O.HOUSE_D, O.HOUSE_R], hp: [6, 6], mat: 'tile' },
  inn: { ids: [O.INN, O.INN_D, O.INN_R], hp: [8, 8], mat: 'slate' },
  barn: { ids: [O.BARN, O.BARN_D, O.BARN_R], hp: [5, 5], mat: 'barn' },
  tower: { ids: [O.TOWER, O.TOWER_D, O.TOWER_R], hp: [11, 11], mat: 'stone' },
};

// Collision (rayon en tuiles) et résistance aux coups.
export const OBJ_INFO = {
  [O.OAK_S]: { solid: 0.28, hp: 2, tree: true }, [O.OAK_M]: { solid: 0.3, hp: 3, tree: true },
  [O.OAK_L]: { solid: 0.34, hp: 4, tree: true }, [O.PINE]: { solid: 0.28, hp: 3, tree: true },
  [O.PINE_L]: { solid: 0.32, hp: 4, tree: true }, [O.SNOW_PINE]: { solid: 0.3, hp: 3, tree: true },
  [O.CHERRY]: { solid: 0.3, hp: 3, tree: true, petals: true },
  [O.BUSH]: { solid: 0.3, hp: 1, leafy: true }, [O.BERRY]: { solid: 0.3, hp: 1, leafy: true },
  [O.ROCK]: { solid: 0.3, hp: 2, rock: true }, [O.ROCK_L]: { solid: 0.38, hp: 4, rock: true },
  [O.ROCK_MOSS]: { solid: 0.32, hp: 3, rock: true },
  [O.STUMP]: { solid: 0.25, hp: 2, wood: true }, [O.LOG]: { solid: 0.3, hp: 2, wood: true },
  [O.GRASS]: { hp: 0, small: true }, [O.FLOWER_R]: { hp: 0, small: true }, [O.FLOWER_Y]: { hp: 0, small: true },
  [O.FLOWER_B]: { hp: 0, small: true }, [O.FLOWER_W]: { hp: 0, small: true }, [O.MUSHROOM]: { hp: 0, small: true },
  [O.PEBBLES]: { hp: 0, small: true }, [O.LILY]: { hp: 0, small: true }, [O.REEDS]: { hp: 0, small: true },
  [O.PART_W]: { part: [1, 0] }, [O.PART_N]: { part: [0, 1] }, [O.PART_NW]: { part: [1, 1] },
  // village : `crime` = combien ça énerve les villageois quand on le casse
  [O.WELL]: { solid: 0.36, hp: 5, prop: 'stone', village: true, crime: 1.5, next: O.WELL_R },
  [O.WELL_R]: { solid: 0.3, hp: 3, prop: 'stone', village: true, crime: 0.3, next: O.PEBBLES },
  [O.STALL]: { solid: 0.34, hp: 2, prop: 'stall', village: true, crime: 1, next: O.PLANKS },
  [O.FENCE_X]: { solid: 0.22, hp: 1, prop: 'wood', village: true, crime: 0.2, next: O.PLANKS },
  [O.FENCE_Y]: { solid: 0.22, hp: 1, prop: 'wood', village: true, crime: 0.2, next: O.PLANKS },
  [O.BARREL]: { solid: 0.24, hp: 1, prop: 'barrel', village: true, crime: 0.3 },
  [O.CRATE]: { solid: 0.24, hp: 1, prop: 'wood', village: true, crime: 0.3, next: O.PLANKS },
  [O.HAY]: { solid: 0.3, hp: 1, prop: 'hay', village: true, crime: 0.2 },
  [O.LANTERN]: { solid: 0.14, hp: 1, prop: 'lantern', village: true, crime: 0.5 },
  [O.WHEAT]: { hp: 0, small: true, crop: true, village: true, crime: 0.1 },
  [O.CABBAGE]: { hp: 0, small: true, crop: true, village: true, crime: 0.1 },
  [O.PLANKS]: { hp: 0, small: true },
};
for (const name in BUILDINGS) {
  const b = BUILDINGS[name];
  b.ids.forEach((id, state) => {
    OBJ_INFO[id] = {
      building: name, state, mat: b.mat, village: true,
      box: state < 2 ? 0.76 : 0, // demi-largeur de la boîte de collision (en tuiles) ; la ruine se traverse
      hp: state < 2 ? b.hp[state] : 0, next: state < 2 ? b.ids[state + 1] : 0,
    };
  });
}

const CS = 32;
export const VG = 80; // une région de 80x80 tuiles a au plus un village
export const VILLAGE_KINDS = ['HAMEAU', 'VILLAGE', 'GRAND VILLAGE'];

export class World {
  constructor(seed) {
    this.seed = seed;
    this.chunks = new Map();
    this.mods = new Map(); // "x,y" -> objet (0 = détruit)
    this.terr = new Map(); // "x,y" -> [type, hauteur, instant] : sol creusé par les coups
    this.wear = new Map(); // "x,y" -> [niveau 1..3, instant] : sol fissuré
    this.villages = new Map();
    this.deaths = new Map(); // id du village -> { civ, knight } : les morts ne reviennent pas
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
  }

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
    const m = fbm(x * 0.028 + 500, y * 0.028 - 300, s + 7, 3);
    const dr = Math.abs(fbm(x * 0.009 + 1000, y * 0.009, s + 13, 3) - 0.5);

    let t, h = 0;
    if (e < 0.33) t = T.DEEP;
    else if (e < 0.375) t = T.WATER;
    else if (e < 0.4) t = T.SAND;
    else {
      h = Math.min(6, 1 + Math.floor((e - 0.4) / 0.055));
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
    if (cell.t === T.WATER || cell.t === T.DEEP) return cell;
    const rx = Math.floor(x / VG), ry = Math.floor(y / VG);
    for (let j = -1; j <= 1; j++) {
      for (let i = -1; i <= 1; i++) {
        const v = this.villageIn(rx + i, ry + j);
        if (!v) continue;
        const d = Math.hypot(x - v.cx, y - v.cy);
        if (d >= v.R + 7) continue;
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
  siteOk(cx, cy, R) {
    const c = this.genTerrain(cx, cy);
    if (!(c.t === T.GRASS || c.t === T.MEADOW || c.t === T.FOREST) || c.h < 1 || c.h > 4) return null;
    let n = 0, bad = 0, steep = 0;
    for (let dy = -R - 2; dy <= R + 2; dy += 2) {
      for (let dx = -R - 2; dx <= R + 2; dx += 2) {
        if (dx * dx + dy * dy > (R + 2) * (R + 2)) continue;
        const s = this.genTerrain(cx + dx, cy + dy);
        n++;
        if (s.t === T.WATER || s.t === T.DEEP) return null;
        if (s.t === T.STONE || s.t === T.SNOW || s.t === T.SAND) bad++;
        if (Math.abs(s.h - c.h) > 1) steep++;
      }
    }
    if (bad > n * 0.2 || steep > n * 0.3) return null;
    return c.h;
  }

  planVillage(rx, ry) {
    const s = this.seed;
    const home = rx === 0 && ry === 0; // un grand village pas loin du départ
    if (!home && hash2(rx, ry, s + 501) > 0.55) return null;
    const rng = mulberry32((s ^ Math.imul(rx, 92821) ^ Math.imul(ry, 68917)) >>> 0);
    const roll = rng();
    const kind = home ? 2 : roll < 0.4 ? 0 : roll < 0.82 ? 1 : 2;
    const R = [7, 10, 13][kind];
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
    for (let tries = 0; tries < 14 && hv === null && !home; tries++) {
      cx = rx * VG + 24 + Math.floor(rng() * 32);
      cy = ry * VG + 24 + Math.floor(rng() * 32);
      hv = this.siteOk(cx, cy, R);
    }
    if (hv === null) return null;

    // garnison : un nombre fixe de chevaliers par village, sans renforts
    const v = { id: rx + ',' + ry, kind, name: VILLAGE_KINDS[kind], cx, cy, R, hv, cells: new Map(), houses: [], tower: null, garrison: [1, 3, 5][kind], folk: 0 };
    const K = (x, y) => x + ',' + y;
    const occ = new Set(); // tuiles réservées (bâtiments + leur marge)
    const bld = new Set(); // tuiles sous un bâtiment
    const put = (x, y, c) => v.cells.set(K(x, y), Object.assign(v.cells.get(K(x, y)) || {}, c));
    const free = (x, y) => !occ.has(K(x, y)) && !(v.cells.get(K(x, y)) || {}).o && Math.hypot(x - cx, y - cy) < R;

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
