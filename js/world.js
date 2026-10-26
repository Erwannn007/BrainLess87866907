// Monde ouvert infini, généré par morceaux (chunks) de 32x32 tuiles à la demande.
import { fbm, hash2 } from './noise.js';

export const T = { WATER: 0, SAND: 1, GRASS: 2, FOREST: 3, STONE: 4, SNOW: 5, MEADOW: 6, DEEP: 7 };

export const O = {
  NONE: 0, OAK_S: 1, OAK_M: 2, OAK_L: 3, PINE: 4, PINE_L: 5, SNOW_PINE: 6, CHERRY: 7,
  BUSH: 8, BERRY: 9, ROCK: 10, ROCK_L: 11, ROCK_MOSS: 12, GRASS: 13,
  FLOWER_R: 14, FLOWER_Y: 15, FLOWER_B: 16, FLOWER_W: 17, MUSHROOM: 18,
  STUMP: 19, LOG: 20, PEBBLES: 21, LILY: 22, REEDS: 23,
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
};

const CS = 32;

export class World {
  constructor(seed) {
    this.seed = seed;
    this.chunks = new Map();
    this.mods = new Map(); // "x,y" -> objet (0 = détruit)
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

  setObj(x, y, o) {
    this.chunk(x >> 5, y >> 5).obj[this.idx(x, y)] = o;
    this.mods.set(x + ',' + y, o);
  }

  walkable(x, y) {
    const t = this.typeAt(x, y);
    return t !== T.WATER && t !== T.DEEP;
  }

  generate(cx, cy) {
    const n = CS * CS;
    const c = { type: new Uint8Array(n), h: new Uint8Array(n), obj: new Uint8Array(n), v: new Uint8Array(n) };
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
    // Les modifications du joueur (arbres cassés, etc.) sont réappliquées.
    for (let ly = 0; ly < CS; ly++) {
      for (let lx = 0; lx < CS; lx++) {
        const m = this.mods.get((cx * CS + lx) + ',' + (cy * CS + ly));
        if (m !== undefined) c.obj[ly * CS + lx] = m;
      }
    }
    return c;
  }

  genCell(x, y) {
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
