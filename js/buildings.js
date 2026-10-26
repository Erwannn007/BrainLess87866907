// Bâtiments et objets de village, générés par code.
// Les capsules et sphères de raster.js ne savent pas faire des murs droits : ici, chaque
// pixel lance un rayon isométrique dans de petits volumes (boîtes, toits, cylindres…).
// Le résultat suit la même charte : 4 tons par matière, lumière en haut à gauche,
// grain par hash, lignes internes et contour sel-out.
import { ramp, hex, hash, makeBuffer, outlineBuffer, renderModel } from './raster.js';
import { O, BUILDINGS } from './world.js';
import { mulberry32 } from './noise.js';

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map(v => v / 16 - 0.5);
const nrm = (x, y, z) => { const l = Math.hypot(x, y, z) || 1; return [x / l, y / l, z / l]; };
// Lumière en haut à gauche de l'écran, un peu devant : dans le monde, c'est vers -u, +v et le haut.
const L = nrm(-0.25, 0.55, 0.8);

// ---------------------------------------------------------------- matières
const PLASTER = ramp('#8f7f62', '#c2b08a', '#e3d4ae', '#f6ecd0');
const TIMBER = ramp('#2e1c10', '#4a2e1a', '#6b4426', '#8a5c36');
const STONE = ramp('#3f434b', '#5e636e', '#808590', '#a7acb5');
const BRICK = ramp('#5a2418', '#84392a', '#a8513a', '#c46e52');
const THATCH = ramp('#6e5420', '#a3812f', '#cfa94a', '#ead37a');
const TILE = ramp('#5e1f17', '#8f3423', '#b84d32', '#d9744c');
const SLATE = ramp('#252b38', '#3a4558', '#526079', '#7083a0');
const SHINGLE = ramp('#2e1a10', '#4a2c1a', '#6b4226', '#8c5a36');
const BARNRED = ramp('#4a1410', '#7a2318', '#a3362a', '#c45a44');
const TRIM = ramp('#8e8a80', '#c4c0b4', '#e6e2d6', '#fbf8ee');
const DOOR = ramp('#24160c', '#3b2414', '#5a3a20', '#7a5233');
const WOOD = ramp('#3d2614', '#5e3d22', '#86593a', '#a87a52');
const CHAR = ramp('#140d08', '#24180f', '#3a2819', '#523a26');
const INTERIOR = ramp('#0c0806', '#17100b', '#221810', '#2e2116');
const GLASS = hex('#1b2438'), GLASS2 = hex('#2b3a58'), GLINT = hex('#9fb6d8');
const SHUTTER_G = ramp('#1c3a26', '#2a5636', '#3c7448', '#5a9462');
const SHUTTER_B = ramp('#18284a', '#24406e', '#355a94', '#5078b4');
const CLOTH = ramp('#5e0c1c', '#981c30', '#c83444', '#ec5a5e');
const CREAMC = ramp('#9c917a', '#cfc4a8', '#ece2c8', '#fffaea');
const GOLDR = ramp('#6b4a10', '#b0851e', '#e0b23a', '#ffe07a');
const WATER = ramp('#0f2442', '#1f4f86', '#3f86c6', '#8cc6ee');
const METAL = ramp('#23262e', '#3a3f4a', '#5a606e', '#8a91a0');
const LAMP = hex('#ffd77a'), LAMP2 = hex('#fff0b8');
const GLOW = [255, 205, 110];

const ROOFS = { thatch: THATCH, tile: TILE, slate: SLATE, shingle: SHINGLE };

// ---------------------------------------------------------------- volumes
// u = axe x du monde (vers le bas à droite de l'écran), v = axe y (vers le bas à gauche), z = haut.
// 16 unités = 1 tuile, 8 unités de z = une marche. Écran : sx = u - v, sy = (u + v) / 2 - z.
const box = (u0, u1, v0, v1, z0, z1, rmp, mat) => ({ box: true, b: [u0, u1, v0, v1, z0, z1], ramp: rmp, mat });

function cylinder(cu, cv, r, z0, z1, rmp, mat, { inner = 0, bulge = 0, top = null } = {}) {
  const rAt = (z) => r + bulge * Math.sin(Math.PI * (z - z0) / (z1 - z0));
  const R = r + Math.max(0, bulge);
  return {
    b: [cu - R, cu + R, cv - R, cv + R, z0, z1], ramp: rmp, mat,
    inside(u, v, z) {
      if (z < z0 || z > (top ? Math.min(z1, top(u - cu, v - cv)) : z1)) return false;
      const d = Math.hypot(u - cu, v - cv);
      return d <= rAt(z) && d >= inner;
    },
    normal(u, v, z) {
      const zt = top ? Math.min(z1, top(u - cu, v - cv)) : z1;
      if (zt - z < 0.3) return [0, 0, 1];
      const du = u - cu, dv = v - cv, d = Math.hypot(du, dv) || 1;
      if (inner && d - inner < 0.35) return [-du / d, -dv / d, 0];
      return [du / d, dv / d, 0];
    },
  };
}

function ellipsoid(cu, cv, cz, a, b, c, rmp, mat, zmin = 0) {
  return {
    b: [cu - a, cu + a, cv - b, cv + b, Math.max(zmin, cz - c), cz + c], ramp: rmp, mat,
    inside(u, v, z) {
      if (z < zmin) return false;
      const x = (u - cu) / a, y = (v - cv) / b, w = (z - cz) / c;
      return x * x + y * y + w * w <= 1;
    },
    normal(u, v, z) { return nrm((u - cu) / (a * a), (v - cv) / (b * b), (z - cz) / (c * c)); },
  };
}

function capsule(A, B, r, rmp, mat) {
  const d = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], l2 = d[0] * d[0] + d[1] * d[1] + d[2] * d[2] || 1;
  const near = (u, v, z) => {
    let t = ((u - A[0]) * d[0] + (v - A[1]) * d[1] + (z - A[2]) * d[2]) / l2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    return [A[0] + d[0] * t, A[1] + d[1] * t, A[2] + d[2] * t];
  };
  return {
    b: [Math.min(A[0], B[0]) - r, Math.max(A[0], B[0]) + r, Math.min(A[1], B[1]) - r, Math.max(A[1], B[1]) + r, Math.min(A[2], B[2]) - r, Math.max(A[2], B[2]) + r],
    ramp: rmp, mat,
    inside(u, v, z) { const p = near(u, v, z); return (u - p[0]) ** 2 + (v - p[1]) ** 2 + (z - p[2]) ** 2 <= r * r; },
    normal(u, v, z) { const p = near(u, v, z); return nrm(u - p[0], v - p[1], z - p[2]); },
  };
}

// Toit à deux pans (coque d'épaisseur `thick`). Faîtage le long de `axis` ('u' ou 'v'),
// de a0 à a1 ; les pans descendent de part et d'autre de `c` sur une demi-largeur hw.
function gable({ axis, a0, a1, c = 0, hw, zb, rh, thick = 2.2, rmp, mat, hole = null }) {
  const k = rh / hw;
  const split = (u, v) => (axis === 'u' ? [u, v - c] : [v, u - c]);
  const roof = {
    b: axis === 'u' ? [a0, a1, c - hw, c + hw, zb - thick, zb + rh] : [c - hw, c + hw, a0, a1, zb - thick, zb + rh],
    ramp: rmp, roof: { axis, a0, a1, hw, c },
    inside(u, v, z) {
      const [a, w] = split(u, v);
      if (a < a0 || a > a1) return false;
      const d = Math.abs(w);
      if (d > hw) return false;
      const top = zb + rh * (1 - d / hw);
      if (z > top || z < top - thick) return false;
      return !(hole && hole(a, d, w));
    },
    normal(u, v) {
      const [a, w] = split(u, v), sg = w < 0 ? -1 : 1;
      if (a1 - a < 0.35) return axis === 'u' ? [1, 0, 0] : [0, 1, 0]; // tranche du pignon
      if (hw - Math.abs(w) < 0.3) return axis === 'u' ? [0, sg, 0.2] : [sg, 0, 0.2]; // bord de l'avant-toit
      return nrm(axis === 'u' ? 0 : sg * k, axis === 'u' ? sg * k : 0, 1);
    },
  };
  roof.mat = mat || roofMat(rmp === THATCH ? 'thatch' : rmp === TILE ? 'tile' : rmp === SLATE ? 'slate' : 'shingle', roof.roof, hole);
  return roof;
}

// Pignon : le triangle de mur sous le toit, du haut des murs jusque sous la coque.
function gableWall({ axis, a0, a1, c = 0, hw, zb, rh, thick = 2.2, wall, w, rmp, mat }) {
  return {
    b: axis === 'u' ? [a0, a1, c - w, c + w, wall - 0.5, zb + rh] : [c - w, c + w, a0, a1, wall - 0.5, zb + rh],
    ramp: rmp, mat,
    inside(u, v, z) {
      const a = axis === 'u' ? u : v, d = Math.abs((axis === 'u' ? v : u) - c);
      if (a < a0 || a > a1 || d > w || z < wall - 0.5) return false;
      return z <= zb + rh * (1 - d / hw) - thick * 0.7;
    },
  };
}

// Toit en pyramide (tour).
function pyramid(hw, zb, rh, thick, rmp, hole = null) {
  const k = rh / hw;
  return {
    b: [-hw, hw, -hw, hw, zb - thick, zb + rh], ramp: rmp,
    inside(u, v, z) {
      const d = Math.max(Math.abs(u), Math.abs(v));
      if (d > hw) return false;
      const top = zb + rh * (1 - d / hw);
      if (z > top || z < top - thick) return false;
      return !(hole && hole(u, v, z));
    },
    normal(u, v) {
      if (Math.abs(u) >= Math.abs(v)) return hw - Math.abs(u) < 0.3 ? [Math.sign(u), 0, 0.2] : nrm(Math.sign(u) * k, 0, 1);
      return hw - Math.abs(v) < 0.3 ? [0, Math.sign(v), 0.2] : nrm(0, Math.sign(v) * k, 1);
    },
    mat(q) {
      const d = Math.max(Math.abs(q.u), Math.abs(q.v));
      const row = Math.floor((hw - d) / 1.8), fr = (hw - d) / 1.8 - row;
      const along = Math.abs(q.u) >= Math.abs(q.v) ? q.v : q.u;
      if (fr < 0.35) return Math.max(0, q.shade - 1);
      if (((along + (row & 1) * 1.2) % 2.4 + 2.4) % 2.4 < 0.45) return Math.max(0, q.shade - 1);
      const r = hash(Math.floor(along / 2.4), row, 31);
      return r < 0.15 ? Math.max(0, q.shade - 1) : r > 0.9 ? Math.min(3, q.shade + 1) : q.shade;
    },
  };
}

// Texture des pans de toit selon la matière.
function roofMat(kind, R, hole) {
  return (q) => {
    const [a, w] = R.axis === 'u' ? [q.u, q.v - R.c] : [q.v, q.u - R.c];
    if (q.n[2] < 0.3) return Math.max(0, q.shade - 1); // tranches
    const d = Math.abs(w), down = R.hw - d;
    let s = q.shade;
    if (hole) {
      // tuiles arrachées autour d'un trou
      for (let e = 0.6; e <= 1.4; e += 0.8) if (hole(a, Math.max(0, d - e), w) || hole(a, d + e, w)) return hash(q.x, q.y, 3) < 0.5 ? 0 : 1;
    }
    if (d < 1.1) return Math.max(0, s - 1); // faîtage
    if (kind === 'thatch') {
      const row = Math.floor(down / 2.6), fr = down / 2.6 - row;
      if (fr < 0.3) return Math.max(0, s - 1);
      const r = hash(Math.floor(a * 1.4), row, 7);
      if (r < 0.2) s--; else if (r > 0.9) s++;
    } else if (kind === 'tile') {
      const row = Math.floor(down / 2), fr = down / 2 - row;
      if (fr < 0.4) return Math.max(0, s - 1);
      if ((((a + (row & 1) * 1.5) % 3) + 3) % 3 < 0.55) s--;
    } else {
      const sz = kind === 'slate' ? 1.8 : 2.2, row = Math.floor(down / sz), fr = down / sz - row;
      if (fr < 0.35) return Math.max(0, s - 1);
      if ((((a + (row & 1) * sz * 0.55) % (sz * 1.1)) + sz * 1.1) % (sz * 1.1) < 0.45) s--;
      const r = hash(Math.floor(a / (sz * 1.1)), row, 13);
      if (r < 0.15) s--; else if (r > 0.9) s++;
    }
    return Math.max(0, Math.min(3, s));
  };
}

// ---------------------------------------------------------------- rendu
const faceOf = (n) => (n[2] > 0.6 ? 't' : Math.abs(n[1]) >= Math.abs(n[0]) ? 'l' : 'r');

function classify(P, u, v, z) {
  for (const e of [0.2, 0.45, 0.9, 1.6]) {
    if (!P.inside(u, v, z + e)) return [0, 0, 1];
    if (!P.inside(u, v + e, z)) return [0, 1, 0];
    if (!P.inside(u + e, v, z)) return [1, 0, 0];
  }
  return [0, 0, 1];
}

/** Rend une liste de volumes en sprite pixel. Renvoie { img, glow } recadrés autour du dessin. */
function renderSolids(prims, W = 104, H = 150, OX = 52, OY = 116) {
  const n = W * H;
  const data = new Uint8ClampedArray(n * 4);
  const depth = new Float32Array(n).fill(-1e9);
  const pid = new Int16Array(n).fill(-1);
  const glow = new Uint8Array(n);
  const q = { u: 0, v: 0, z: 0, n: null, face: 't', shade: 0, x: 0, y: 0, glow: 0 };
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const sx = x + 0.5 - OX, sy = y + 0.5 - OY;
      let best = -1e9, bp = -1, bu = 0, bv = 0, bz = 0, bn = null;
      for (let i = 0; i < prims.length; i++) {
        const P = prims[i], b = P.b;
        const hu = 2 * b[1] - sx, hv = 2 * b[3] + sx, hz = 2 * (b[5] + sy);
        const hi = Math.min(hu, hv, hz);
        const lo = Math.max(2 * b[0] - sx, 2 * b[2] + sx, 2 * (b[4] + sy));
        if (hi < lo || hi <= best) continue;
        if (P.box) {
          best = hi; bp = i;
          bn = hi === hz ? [0, 0, 1] : hi === hv ? [0, 1, 0] : [1, 0, 0];
          bu = (hi + sx) / 2; bv = (hi - sx) / 2; bz = hi / 2 - sy;
          continue;
        }
        for (let s = hi; s >= lo && s > best; s -= 0.25) {
          const u = (s + sx) / 2, v = (s - sx) / 2, z = s / 2 - sy;
          if (P.inside(u, v, z)) {
            best = s; bp = i; bu = u; bv = v; bz = z;
            bn = P.normal ? P.normal(u, v, z) : classify(P, u, v, z);
            break;
          }
        }
      }
      if (bp < 0) continue;
      const P = prims[bp], idx = y * W + x;
      const lit = bn[0] * L[0] + bn[1] * L[1] + bn[2] * L[2] + BAYER[(y & 3) * 4 + (x & 3)] * 0.16;
      q.u = bu; q.v = bv; q.z = bz; q.n = bn; q.face = faceOf(bn); q.x = x; q.y = y; q.glow = 0;
      q.shade = lit < -0.45 ? 0 : lit < 0.25 ? 1 : lit < 0.7 ? 2 : 3;
      let res = P.mat ? P.mat(q) : q.shade;
      // grain : quelques pixels plus sombres ou plus clairs
      if (typeof res === 'number' && !P.smooth) {
        const r = hash(x, y, bp * 7 + 1);
        if (r < 0.08) res = Math.max(0, res - 1); else if (r > 0.965) res = Math.min(3, res + 1);
      }
      const col = typeof res === 'number' ? P.ramp[Math.max(0, Math.min(3, res))] : res;
      const o = idx * 4;
      data[o] = col[0]; data[o + 1] = col[1]; data[o + 2] = col[2]; data[o + 3] = 255;
      depth[idx] = best; pid[idx] = bp; glow[idx] = q.glow;
    }
  }
  // lignes internes : un voisin (haut/gauche/droite) passe nettement devant
  const src = new Uint8ClampedArray(data);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (pid[i] < 0) continue;
    const chk = (j) => pid[j] >= 0 && (pid[j] !== pid[i] ? depth[j] > depth[i] + 3 : depth[j] > depth[i] + 8);
    if ((y > 0 && chk(i - W)) || (x > 0 && chk(i - 1)) || (x < W - 1 && chk(i + 1))) {
      const o = i * 4;
      data[o] = src[o] * 0.55; data[o + 1] = src[o + 1] * 0.55; data[o + 2] = src[o + 2] * 0.55;
    }
  }
  return crop({ w: W, h: H, data }, glow, OX, OY);
}

// Recadre autour du dessin (+1 px pour le contour), détoure, sépare la couche lumineuse.
function crop(full, glow, OX, OY) {
  let x0 = full.w, y0 = full.h, x1 = -1, y1 = -1;
  for (let y = 0; y < full.h; y++) for (let x = 0; x < full.w; x++) {
    if (!full.data[(y * full.w + x) * 4 + 3]) continue;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  x0 = Math.max(0, x0 - 1); y0 = Math.max(0, y0 - 1); x1 = Math.min(full.w - 1, x1 + 1); y1 = Math.min(full.h - 1, y1 + 1);
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  const img = makeBuffer(w, h), lights = makeBuffer(w, h);
  let lit = false;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const s = ((y + y0) * full.w + x + x0) * 4, d = (y * w + x) * 4;
    for (let k = 0; k < 4; k++) img.data[d + k] = full.data[s + k];
    if (glow[(y + y0) * full.w + x + x0]) { lights.set(x, y, GLOW, 255); lit = true; }
  }
  outlineBuffer(img, 0.3);
  const ox = OX - x0, oy = OY - y0;
  return { img: Object.assign(img, { ox, oy }), glow: lit ? Object.assign(lights, { ox, oy }) : null };
}

// ---------------------------------------------------------------- murs
// Ouvertures : { f: 'l' (face +v, à gauche à l'écran) | 'r' (face +u), a0, a1, z0, z1, shutter?, arch? }
function inRect(o, a, z) { return a >= o.a0 && a <= o.a1 && z >= o.z0 && z <= o.z1; }

// Fissures : petits chemins en zigzag tirés au hasard sur chaque face.
function makeCracks(seed, W, H, n) {
  const rng = mulberry32(seed);
  const list = [];
  for (const f of ['l', 'r']) {
    for (let i = 0; i < n; i++) {
      let a = (rng() * 2 - 1) * W * 0.8, z = H * (0.45 + rng() * 0.5);
      const segs = [];
      for (let k = 0; k < 7; k++) {
        const a2 = a + (rng() - 0.5) * 3, z2 = z - 1 - rng() * 2;
        segs.push([a, z, a2, z2]);
        a = a2; z = z2;
        if (z < 1) break;
      }
      list.push({ f, segs });
    }
  }
  return list;
}
function onCrack(cracks, f, a, z) {
  for (const c of cracks) {
    if (c.f !== f) continue;
    for (const [a0, z0, a1, z1] of c.segs) {
      const da = a1 - a0, dz = z1 - z0, l2 = da * da + dz * dz;
      let t = ((a - a0) * da + (z - z0) * dz) / l2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      if (Math.hypot(a - (a0 + da * t), z - (z0 + dz * t)) < 0.5) return true;
    }
  }
  return false;
}

/**
 * Matière d'un mur.
 * style : 'plaster' (crépi + colombages), 'stone', 'planks' (grange), 'tower'
 * opts : { W, H, base (hauteur du soubassement en pierre), beams [z0, z1][], braces, openings, state, seed, ruin }
 */
function wallMat(style, o) {
  const cracks = o.state >= 1 ? makeCracks(o.seed, o.W, o.H, o.state === 1 ? 2 : 3) : [];
  const brokenWin = (w) => o.state >= 1 && hash(w.a0 * 7 | 0, w.z0 | 0, o.seed) < (o.state === 1 ? 0.5 : 1);
  return (q) => {
    const f = q.face;
    if (f === 't') {
      if (o.ruin) return (style === 'planks' ? TIMBER : style === 'plaster' ? PLASTER : STONE)[2]; // cassure fraîche
      return INTERIOR[Math.min(3, q.shade - 1 < 0 ? 0 : q.shade - 1)]; // intérieur sombre, vu par un trou du toit
    }
    const a = f === 'l' ? q.u : q.v, z = q.z;
    const outside = f === 'l' ? q.v > o.W - 0.8 : q.u > o.W - 0.8;
    if (o.ruin && !outside) {
      // dedans de la ruine : le même mur, dans l'ombre et noirci de suie
      const r = (style === 'plaster' ? PLASTER : style === 'planks' ? BARNRED : STONE);
      return hash(q.x, q.y, 21) < 0.3 ? CHAR[2] : r[Math.max(0, q.shade - 1)];
    }
    // ouvertures
    for (const w of o.openings) {
      if (w.f !== f) continue;
      if (w.door) {
        let top = w.z1;
        if (w.arch) top = w.z1 - (w.a1 - w.a0) / 2 + Math.sqrt(Math.max(0, ((w.a1 - w.a0) / 2) ** 2 - (a - (w.a0 + w.a1) / 2) ** 2));
        if (a >= w.a0 && a <= w.a1 && z >= w.z0 && z <= top) {
          if (a - w.a0 < 0.9 || w.a1 - a < 0.9 || top - z < 0.9) return (w.barn ? TRIM : TIMBER)[Math.max(0, q.shade - 1)];
          if (w.barn) {
            // porte de grange : deux battants avec chacun sa croix blanche
            const u = (a - w.a0) / (w.a1 - w.a0), t = (z - w.z0) / (w.z1 - w.z0);
            const half = u < 0.5 ? u * 2 : (u - 0.5) * 2;
            if (Math.abs(u - 0.5) < 0.05 || z - w.z0 < 0.9 || Math.abs(half - t) < 0.09 || Math.abs(half - (1 - t)) < 0.09) return TRIM[q.shade];
            return BARNRED[Math.max(0, q.shade - 1)];
          }
          if (o.state === 2) return INTERIOR[0];
          if (Math.abs(a - (w.a1 - 1.6)) < 0.5 && Math.abs(z - (w.z0 + (w.z1 - w.z0) * 0.45)) < 0.6) return GOLDR[2]; // poignée
          return DOOR[((a * 2) | 0) % 3 === 0 ? Math.max(0, q.shade - 1) : q.shade];
        }
        continue;
      }
      if (inRect(w, a, z)) {
        if (a - w.a0 < 0.7 || w.a1 - a < 0.7 || z - w.z0 < 0.7 || w.z1 - z < 0.7 || Math.abs(a - (w.a0 + w.a1) / 2) < 0.35) return TIMBER[q.shade >= 2 ? 2 : 1];
        if (w.hay) return z - w.z0 < 2.2 ? THATCH[hash(q.x, q.y, 5) < 0.5 ? 2 : 3] : INTERIOR[0];
        if (brokenWin(w)) return hash(q.x, q.y, 9) < 0.18 ? GLINT : INTERIOR[0];
        q.glow = 1;
        if ((((a - z) * 1.1) % 4 + 4) % 4 < 0.7) return GLINT;
        return z > (w.z0 + w.z1) / 2 ? GLASS2 : GLASS;
      }
      if (w.shutter && z >= w.z0 && z <= w.z1 && ((a >= w.a0 - 2.4 && a < w.a0) || (a > w.a1 && a <= w.a1 + 2.4))) {
        if (o.state >= 1 && a > w.a1 && hash(w.a0 | 0, w.z0 | 0, o.seed + 1) < 0.5) { /* volet arraché */ } else {
          return w.shutter[((z * 1.6) | 0) % 2 ? q.shade : Math.max(0, q.shade - 1)];
        }
      }
    }
    if (onCrack(cracks, f, a, z)) return [12, 9, 8];
    // matière de base
    if (o.sign && f === o.sign.f && inRect(o.sign, a, z)) return o.sign.paint(a, z, q);
    if (o.banner && f === o.banner.f && a >= o.banner.a0 && a <= o.banner.a1 && z <= o.banner.z1 && z >= o.banner.z0 - (Math.abs(((a * 1.3) % 2) - 1) < 0.5 ? 1 : 0)) {
      const cu = (o.banner.a0 + o.banner.a1) / 2, cz = (o.banner.z0 + o.banner.z1) / 2 + 1;
      const r = Math.hypot(a - cu, (z - cz) * 1.1);
      if (Math.abs(r - 2) < 0.6 || (r < 0.9)) return GOLDR[Math.min(3, q.shade + 1)];
      if (o.banner.z1 - z < 0.8 || a - o.banner.a0 < 0.6 || o.banner.a1 - a < 0.6) return GOLDR[q.shade];
      return CLOTH[q.shade];
    }
    const corner = Math.abs(a) > o.W - 1.5;
    if (style === 'planks') {
      if (corner) return TRIM[q.shade];
      return ((a + 20) % 2.6) < 0.5 ? Math.max(0, q.shade - 1) : q.shade;
    }
    if (style === 'stone' || style === 'tower' || z < (o.base || 0)) {
      const row = Math.floor(z / 3.2), fr = z / 3.2 - row;
      const aa = a + (row & 1) * 2.2;
      let s = q.shade;
      if (fr < 0.25 || ((aa % 4.4) + 4.4) % 4.4 < 0.5) s--; // joints
      else { const r = hash(Math.floor(aa / 4.4), row, o.seed + 3); if (r < 0.25) s--; else if (r > 0.85) s++; }
      s = Math.max(0, Math.min(3, s));
      return style === 'stone' || style === 'tower' ? s : STONE[s];
    }
    // crépi avec colombages
    if (corner) return TIMBER[q.shade];
    for (const [z0, z1] of o.beams || []) if (z >= z0 && z <= z1) return TIMBER[q.shade];
    if (o.braces) {
      for (const [b0, b1, z0, z1] of o.braces) {
        if (z < z0 || z > z1 || a < Math.min(b0, b1) || a > Math.max(b0, b1)) continue;
        const t = (z - z0) / (z1 - z0), ab = b0 + (b1 - b0) * t;
        if (Math.abs(a - ab) < 0.7) return TIMBER[q.shade];
      }
      for (const p of o.posts || []) if (Math.abs(a - p) < 0.6 && z > (o.base || 0)) return TIMBER[q.shade];
    }
    // crépi tombé : on voit les briques
    if (o.state >= 1) {
      const blot = Math.sin(a * 0.55 + o.seed) * Math.sin(z * 0.6 + o.seed * 0.7) + Math.sin(a * 1.3 - z * 0.4 + o.seed);
      if (blot > (o.state === 1 ? 1.15 : 0.8)) {
        const row = Math.floor(z / 1.6), aa = a + (row & 1) * 1.6;
        if (z / 1.6 - row < 0.3 || ((aa % 3.2) + 3.2) % 3.2 < 0.4) return PLASTER[0];
        return BRICK[q.shade];
      }
    }
    return q.shade;
  };
}

// ---------------------------------------------------------------- bâtiments
const roofHole = (seed, n, hw) => {
  const rng = mulberry32(seed);
  const holes = [];
  for (let i = 0; i < n; i++) holes.push([(rng() * 2 - 1) * 9, hw * (0.3 + rng() * 0.4), 2.6 + rng() * 1.8, i === 0 ? 1 : rng() < 0.5 ? -1 : 1]);
  return (a, d, w) => holes.some(([ha, hd, r, side]) => Math.sign(w || 1) === side && Math.hypot(a - ha, (d - hd) * 1.2) < r);
};

function rubble(seed, W, mats, n, spread, big) {
  const rng = mulberry32(seed);
  const out = [];
  for (let i = 0; i < n; i++) {
    const m = mats[i % mats.length];
    const a = (big ? 3 : 2) + rng() * (big ? 3 : 1.6);
    const cu = (rng() * 2 - 1) * spread + (big ? 0 : W * 0.75), cv = (rng() * 2 - 1) * spread + (big ? 0 : W * 0.75);
    out.push(ellipsoid(cu, cv, -0.5, a, a * (0.7 + rng() * 0.5), a * (0.5 + rng() * 0.3), m, (q) => {
      const r = hash(q.x, q.y, i);
      return r < 0.25 ? Math.max(0, q.shade - 1) : r > 0.85 ? Math.min(3, q.shade + 1) : q.shade;
    }));
  }
  return out;
}

// Murs en ruine : une coque de 2 d'épaisseur dont le haut est cassé en dents.
function ruinWalls(Wu, Wv, H, seed, mat) {
  const ph = [hash(seed, 1, 1) * 6, hash(seed, 2, 1) * 6, hash(seed, 3, 1) * 6];
  const jag = (u, v) => {
    const j = H * (0.34 + 0.14 * Math.sin(u * 0.3 + ph[0]) * Math.sin(v * 0.27 + ph[1]) + 0.1 * Math.sin((u - v) * 0.5 + ph[2]));
    const corner = Math.abs(u) > Wu - 2.5 && Math.abs(v) > Wv - 2.5 ? H * 0.16 : 0;
    return Math.max(2, Math.floor((j + corner) / 2) * 2);
  };
  return {
    b: [-Wu, Wu, -Wv, Wv, 0, H], ramp: STONE, mat,
    inside(u, v, z) {
      if (Math.abs(u) > Wu || Math.abs(v) > Wv || z < 0) return false;
      if (Math.abs(u) < Wu - 2 && Math.abs(v) < Wv - 2) return false;
      return z <= jag(u, v);
    },
  };
}

function floorPlanks(W) {
  return box(-W + 2, W - 2, -W + 2, W - 2, 0, 0.6, WOOD, (q) => (((q.u + 30) % 3) < 0.5 ? 0 : Math.max(0, q.shade - 1)));
}

const SPECS = {
  cottage: {
    W: 11, H: 13, style: 'plaster', base: 2.2, wallRamp: PLASTER,
    roof: { axis: 'u', a0: -13, a1: 13, hw: 14, zb: 12, rh: 13, rmp: THATCH },
    openings: [
      { f: 'l', door: true, a0: -2.5, a1: 2.5, z0: 0, z1: 9 },
      { f: 'l', a0: 5, a1: 8.5, z0: 4, z1: 8 }, { f: 'l', a0: -8.5, a1: -5, z0: 4, z1: 8 },
      { f: 'r', a0: -2, a1: 2, z0: 4, z1: 8, shutter: SHUTTER_G },
    ],
  },
  house: {
    W: 12, H: 20, style: 'plaster', base: 5, wallRamp: PLASTER,
    beams: [[10, 11.2], [18.8, 20]], braces: [[-11, -6, 11.2, 18.8], [11, 6, 11.2, 18.8]], posts: [-0.6],
    roof: { axis: 'v', a0: -14.5, a1: 14.5, hw: 14.5, zb: 19, rh: 12, rmp: TILE },
    chimney: [4, 7.5, -9, -5.5, 37],
    openings: [
      { f: 'l', door: true, a0: -8, a1: -3.5, z0: 0, z1: 10.2 },
      { f: 'l', a0: 2, a1: 6, z0: 4, z1: 8.5, shutter: SHUTTER_G },
      { f: 'l', a0: -8, a1: -4.5, z0: 13.5, z1: 17.5 }, { f: 'l', a0: 2.5, a1: 6, z0: 13.5, z1: 17.5 },
      { f: 'r', a0: -7, a1: -3.5, z0: 4, z1: 8.5, shutter: SHUTTER_G }, { f: 'r', a0: 3, a1: 6.5, z0: 4, z1: 8.5, shutter: SHUTTER_G },
      { f: 'r', a0: -3.5, a1: 3.5, z0: 13.5, z1: 17.5 }, { f: 'r', a0: -1.5, a1: 1.5, z0: 23, z1: 26 },
    ],
  },
  inn: {
    W: 13.5, H: 26, style: 'plaster', base: 12, wallRamp: PLASTER,
    beams: [[12, 13.2], [24.8, 26]], braces: [[-12.5, -7.5, 13.2, 24.8], [12.5, 7.5, 13.2, 24.8]], posts: [-4, 4],
    roof: { axis: 'u', a0: -16, a1: 16, hw: 16, zb: 25.5, rh: 15, rmp: SLATE },
    chimney: [-10, -6.5, 2, 5.5, 47],
    sign: { f: 'l', a0: 8.6, a1: 12.6, z0: 13.8, z1: 17.2 },
    openings: [
      { f: 'l', door: true, a0: -3.5, a1: 3.5, z0: 0, z1: 10 },
      { f: 'l', a0: -11, a1: -7, z0: 4, z1: 8.5 }, { f: 'l', a0: 6, a1: 10, z0: 4, z1: 8.5 },
      { f: 'l', a0: -9, a1: -5.5, z0: 16.5, z1: 21.5, shutter: SHUTTER_B }, { f: 'l', a0: 1, a1: 4.5, z0: 16.5, z1: 21.5, shutter: SHUTTER_B },
      { f: 'r', a0: -10, a1: -6, z0: 4, z1: 8.5 }, { f: 'r', a0: 5, a1: 9, z0: 4, z1: 8.5 },
      { f: 'r', a0: -8, a1: -4.5, z0: 16.5, z1: 21.5, shutter: SHUTTER_B }, { f: 'r', a0: 4.5, a1: 8, z0: 16.5, z1: 21.5, shutter: SHUTTER_B },
      { f: 'r', a0: -2, a1: 2, z0: 30, z1: 33.5 },
    ],
  },
  barn: {
    W: 12.5, H: 16, style: 'planks', wallRamp: BARNRED,
    roof: { axis: 'u', a0: -14.5, a1: 14.5, hw: 14.5, zb: 15.5, rh: 13, rmp: SHINGLE },
    openings: [
      { f: 'l', door: true, barn: true, a0: -6, a1: 6, z0: 0, z1: 13 },
      { f: 'r', a0: -3, a1: 3, z0: 19, z1: 24, hay: true },
      { f: 'r', a0: -9, a1: -5.5, z0: 6, z1: 9.5 },
    ],
  },
  tower: {
    W: 9.5, H: 46, style: 'tower', wallRamp: STONE,
    openings: [
      { f: 'l', door: true, arch: true, a0: -2.8, a1: 2.8, z0: 0, z1: 10 },
      { f: 'l', a0: -0.8, a1: 0.8, z0: 16, z1: 21 }, { f: 'l', a0: -1.6, a1: 1.6, z0: 39, z1: 42.5 },
      { f: 'r', a0: -0.8, a1: 0.8, z0: 22, z1: 27 }, { f: 'r', a0: -0.8, a1: 0.8, z0: 33, z1: 38 },
    ],
    banner: { f: 'l', a0: -3.6, a1: 3.6, z0: 25, z1: 36 },
  },
};

function innSign(a, z, q) {
  // une chope dorée sur fond de bois
  const cx = 10.6, cz = 15.5;
  if (Math.abs(a - cx) < 0.9 && Math.abs(z - cz) < 1.1) return GOLDR[Math.min(3, q.shade + 1)];
  if (Math.abs(a - cx - 1.3) < 0.4 && Math.abs(z - cz) < 0.6) return GOLDR[2];
  return WOOD[Math.max(0, q.shade - ((z * 2 | 0) % 2))];
}

export function buildingSprite(type, state) {
  const S = SPECS[type], seed = (type.length * 977 + state * 131) >>> 0;
  const { W, H } = S;
  const prims = [];
  const mat = wallMat(S.style, { ...S, state, seed, ruin: state === 2, sign: S.sign && { ...S.sign, paint: innSign } });
  const roofR = S.roof && S.roof.rmp;
  if (state < 2) {
    prims.push(box(-W, W, -W, W, 0, H, S.wallRamp, mat));
    if (S.sign) {
      prims.push(box(S.sign.a0, S.sign.a1, W + 0.6, W + 1.4, S.sign.z0, S.sign.z1, WOOD, (q) => (q.face === 'l' ? innSign(q.u, q.z, q) : q.shade)));
      prims.push(box(10, 10.8, W, W + 1.4, S.sign.z1, S.sign.z1 + 0.8, METAL));
    }
    if (S.roof) {
      const R = S.roof;
      const hole = state === 1 ? roofHole(seed, 2, R.hw) : null;
      prims.push(gable({ ...R, hole }));
      prims.push(gableWall({ ...R, a0: -W, a1: W, wall: H, w: W, rmp: S.wallRamp, mat }));
    }
    if (S.chimney) {
      const [u0, u1, v0, v1, top] = S.chimney;
      prims.push(box(u0, u1, v0, v1, H, state === 1 ? top - 6 : top, STONE, (q) => {
        if (q.face === 't') return state === 1 ? 1 : [20, 16, 14];
        const row = Math.floor(q.z / 2.4);
        return q.z / 2.4 - row < 0.3 ? Math.max(0, q.shade - 1) : q.shade;
      }));
    }
    if (type === 'tower') {
      prims.push(box(-W - 0.9, W + 0.9, -W - 0.9, W + 0.9, H - 4, H, STONE, (q) => {
        if (q.face === 't') return 1;
        const a = q.face === 'l' ? q.u : q.v;
        return ((a + 30) % 3) < 0.6 || q.z < H - 3.4 ? Math.max(0, q.shade - 1) : q.shade; // mâchicoulis
      }));
      const hole = state === 1 ? (u, v, z) => Math.hypot(u - 3, v + 2, (z - 55) * 0.6) < 3.6 : null;
      prims.push(pyramid(12, H - 0.5, 22, 2.4, SLATE, hole));
      if (state === 0) {
        prims.push(capsule([0, 0, H + 20], [0, 0, H + 31], 0.55, METAL));
        prims.push({ ...box(0.6, 8.5, -0.4, 0.4, H + 25.5, H + 30.5, CLOTH, (q) => (Math.abs(q.z - (H + 28)) < 0.6 ? GOLDR[2] : q.shade)), smooth: true });
      }
    }
    if (state === 1) prims.push(...rubble(seed + 5, W, [S.wallRamp, roofR || STONE, STONE], 3, 3, false));
  } else {
    prims.push(ruinWalls(W, W, type === 'tower' ? 26 : H, seed, mat));
    prims[prims.length - 1].ramp = S.wallRamp;
    prims.push(floorPlanks(W));
    if (S.chimney) {
      const [u0, u1, v0, v1] = S.chimney;
      prims.push(box(u0, u1, v0, v1, 0, H * 0.7, STONE, (q) => (q.face === 't' ? 1 : q.shade)));
    }
    const mats = [S.wallRamp, roofR || STONE, STONE, roofR || S.wallRamp];
    prims.push(...rubble(seed + 9, W, mats, type === 'tower' ? 7 : 6, W * 0.9, true));
    if (type !== 'tower') {
      prims.push(capsule([-W * 0.7, W * 0.2, 1], [W * 0.5, -W * 0.3, H * 0.55], 1.1, CHAR));
      prims.push(capsule([W * 0.4, W * 0.8, 0.8], [-W * 0.1, -W * 0.6, H * 0.35], 1, CHAR));
    }
  }
  return renderSolids(prims);
}

// ---------------------------------------------------------------- objets de village
function propSprite(prims) { return renderSolids(prims, 48, 56, 24, 40); }

function well(broken) {
  const stoneMat = (q) => {
    if (q.face === 't') return broken ? 2 : 3;
    const row = Math.floor(q.z / 2.2), ang = Math.atan2(q.v, q.u) * 4 + (row & 1) * 0.5;
    if (q.z / 2.2 - row < 0.3 || ((ang % 1) + 1) % 1 < 0.15) return Math.max(0, q.shade - 1);
    return q.shade;
  };
  const top = broken ? (du, dv) => 2.5 + 3 * (0.5 + 0.5 * Math.sin(Math.atan2(dv, du) * 3 + 1)) : null;
  const prims = [
    cylinder(0, 0, 6.4, 0, 6.5, STONE, stoneMat, { inner: 4.6, top }),
    { ...cylinder(0, 0, 4.7, 0, broken ? 1 : 3.5, WATER, (q) => (Math.abs(Math.hypot(q.u - 1, q.v - 1) - 2.2) < 0.4 ? 3 : 1)), smooth: true },
  ];
  if (!broken) {
    prims.push(box(-6.3, -5.1, -0.6, 0.6, 6, 16, WOOD), box(5.1, 6.3, -0.6, 0.6, 6, 16, WOOD));
    prims.push(gable({ axis: 'u', a0: -7.5, a1: 7.5, hw: 5.5, zb: 14.5, rh: 4.5, thick: 1.6, rmp: SHINGLE }));
    prims.push(capsule([-5.5, 0, 12.5], [5.5, 0, 12.5], 0.6, WOOD));
    prims.push(capsule([0, 0, 10.2], [0, 0, 12.5], 0.25, CREAMC));
    prims.push(cylinder(0, 0, 1.4, 8, 10.2, WOOD, (q) => (Math.abs(q.z - 9.6) < 0.3 ? 0 : q.shade)));
  } else {
    prims.push(box(-6.3, -5.1, -0.6, 0.6, 5, 9, WOOD));
    prims.push(...rubble(77, 6, [STONE, STONE, SHINGLE], 3, 4, false));
  }
  return propSprite(prims);
}

function stall() {
  const plank = (q) => (q.face !== 't' && ((q.z + 10) % 2.2) < 0.5 ? Math.max(0, q.shade - 1) : q.shade);
  const prims = [box(-6, 6, -2.5, 3, 0, 6, WOOD, plank)];
  const fruit = [[-4, -0.5, '#c8283a'], [-2, 1, '#e8862a'], [0, -0.8, '#c8283a'], [2, 1.2, '#6fb04c'], [4, -0.2, '#e8862a'], [-3, 1.6, '#f2c230'], [3, -1.4, '#c8283a']];
  for (const [u, v, c] of fruit) {
    const C = hex(c), R = [C.map(x => x * 0.45), C.map(x => x * 0.7), C, C.map(x => Math.min(255, x * 1.25))];
    prims.push({ ...ellipsoid(u, v, 7, 1.3, 1.3, 1.1, R, null, 6), smooth: true });
  }
  for (const [u, v] of [[-6, -2.2], [6, -2.2], [-6, 2.7], [6, 2.7]]) prims.push(capsule([u, v, 0], [u, v, 13.5], 0.55, WOOD));
  prims.push({ ...gable({ axis: 'u', a0: -7.5, a1: 7.5, c: 0.25, hw: 5.5, zb: 12.5, rh: 3, thick: 1, rmp: CLOTH,
    mat: (q) => ((Math.floor((q.u + 20) / 2.5) & 1) ? CREAMC[q.shade] : q.shade) }), smooth: true });
  return propSprite(prims);
}

function fence(axis) {
  const rail = (a0, a1, z0, z1) => (axis === 'u' ? box(a0, a1, -0.6, 0.6, z0, z1, WOOD) : box(-0.6, 0.6, a0, a1, z0, z1, WOOD));
  return propSprite([
    box(-1, 1, -1, 1, 0, 10, WOOD, (q) => (q.face === 't' ? 3 : q.shade)),
    rail(-8, 8, 6.2, 7.8), rail(-8, 8, 2.6, 4.2),
  ]);
}

function barrel() {
  return propSprite([cylinder(0, 0, 3.1, 0, 8.5, WOOD, (q) => {
    if (q.face === 't') return Math.abs(Math.hypot(q.u, q.v) - 2.2) < 0.4 ? 1 : 3;
    if (Math.abs(q.z - 1.7) < 0.5 || Math.abs(q.z - 6.8) < 0.5) return METAL[Math.min(3, q.shade + 1)];
    const ang = Math.atan2(q.v, q.u) / 0.5;
    return ((ang % 1) + 1) % 1 < 0.2 ? Math.max(0, q.shade - 1) : q.shade;
  }, { bulge: 0.6 })]);
}

function crate() {
  return propSprite([{ ...box(-3.8, 3.8, -3.8, 3.8, 0, 7.5, WOOD, (q) => {
    if (q.face === 't') return Math.abs(q.u) < 0.5 ? 2 : 3;
    const a = q.face === 'l' ? q.u : q.v;
    if (Math.abs(a) > 3 || q.z < 0.8 || q.z > 6.7) return Math.min(3, q.shade + 1); // cadre
    return Math.abs(q.z - 3.7) < 0.5 ? Math.max(0, q.shade - 1) : q.shade;
  }), smooth: true }]);
}

function hay() {
  return propSprite([box(-5, 5, -3.6, 3.6, 0, 6, THATCH, (q) => {
    const a = q.face === 'l' ? q.u : q.face === 'r' ? q.v : q.u;
    if (Math.abs(Math.abs(a) - 2.6) < 0.4) return SHINGLE[1];
    const r = hash(Math.floor(a * 1.5), Math.floor(q.z * 2) + (q.face === 't' ? Math.floor(q.v * 2) : 0), 3);
    return r < 0.25 ? Math.max(0, q.shade - 1) : r > 0.85 ? Math.min(3, q.shade + 1) : q.shade;
  })]);
}

function lantern() {
  return propSprite([
    box(-0.8, 0.8, -0.8, 0.8, 0, 20, SHINGLE, (q) => (q.face === 't' ? 2 : q.shade)),
    box(0, 3.6, -0.5, 0.5, 19, 20, METAL),
    box(1.4, 4.2, -1.4, 1.4, 13.6, 18, METAL, (q) => {
      const a = q.face === 'l' ? q.u : q.v;
      const edge = q.face === 't' || q.z < 14.3 || q.z > 17.3 || Math.abs(a - (q.face === 'l' ? 2.8 : 0)) > 0.85;
      if (edge) return q.shade;
      q.glow = 1;
      return q.z > 16 ? LAMP2 : LAMP;
    }),
    box(1, 4.6, -1.8, 1.8, 18, 18.9, METAL),
  ]);
}

function wheatFrames() {
  const S = ramp('#6e5420', '#a3812f', '#cfa94a', '#ead37a');
  const G = hex('#7a8a3a');
  const stalks = [[-6, 9], [-4, 11], [-2, 10], [0, 12], [2, 10], [4, 11], [6, 9], [-1, 8], [3, 8]];
  const frames = [];
  for (let f = 0; f < 3; f++) {
    const b = makeBuffer(20, 18);
    const sway = [0, 1, -1][f];
    stalks.forEach(([bx, len], j) => {
      for (let i = 0; i < len; i++) {
        const k = i / len, x = 10 + bx + (k > 0.6 ? sway : 0);
        const head = i > len - 4;
        b.set(x, 16 - i, head ? S[(i + j) % 2 ? 3 : 2] : i < 3 ? G : S[1]);
        if (head && (i + j) % 2) b.set(x + (j % 2 ? 1 : -1), 16 - i, S[2]);
      }
    });
    frames.push(Object.assign(outlineBuffer(b, 0.4), { ox: 10, oy: 15 }));
  }
  return frames;
}

function cabbage() {
  const C = ramp('#244a28', '#3f7a3a', '#62a04c', '#93c86a');
  const tex = (s) => (p) => {
    const vein = Math.abs(Math.sin(Math.atan2(p.ey, p.ex) * 3 + s)) < 0.2;
    return vein ? Math.min(3, p.shade + 1) : hash(p.x, p.y, s) < 0.15 ? Math.max(0, p.shade - 1) : p.shade;
  };
  return renderModel([
    { a: [-3.5, 1, 2.2], r1: 2.8, ramp: C, tex: tex(1) },
    { a: [3, -1, 2], r1: 2.6, ramp: C, tex: tex(2) },
    { a: [0.5, 3, 1.6], r1: 2, ramp: C, tex: tex(3) },
  ], { w: 22, h: 16, ox: 11, oy: 11, scale: 1 });
}

function planks() {
  const W = ramp('#3d2614', '#5e3d22', '#86593a', '#a87a52');
  const b = makeBuffer(20, 12);
  const plank = (x0, y0, len, dx, dy, c) => { for (let i = 0; i < len; i++) { b.set(x0 + i * dx, y0 + i * dy, W[c]); b.set(x0 + i * dx, y0 + i * dy + 1, W[c - 1]); } };
  plank(3, 4, 9, 1, 0.34, 3);
  plank(6, 8, 8, 1, -0.3, 2);
  plank(10, 3, 6, 1, 0.5, 2);
  b.set(5, 5, hex('#8a91a0')); b.set(13, 6, hex('#8a91a0'));
  return Object.assign(outlineBuffer(b, 0.35), { ox: 10, oy: 7 });
}

// Tous les sprites de village : S[id] = [{img, glow}…] (une seule frame sauf les blés).
export function buildVillageSprites() {
  const S = {};
  for (const type in BUILDINGS) {
    BUILDINGS[type].ids.forEach((id, state) => { S[id] = [buildingSprite(type, state)]; });
  }
  S[O.WELL] = [well(false)];
  S[O.WELL_R] = [well(true)];
  S[O.STALL] = [stall()];
  S[O.FENCE_X] = [fence('u')];
  S[O.FENCE_Y] = [fence('v')];
  S[O.BARREL] = [barrel()];
  S[O.CRATE] = [crate()];
  S[O.HAY] = [hay()];
  S[O.LANTERN] = [lantern()];
  S[O.WHEAT] = wheatFrames().map(img => ({ img, glow: null }));
  S[O.CABBAGE] = [{ img: cabbage(), glow: null }];
  S[O.PLANKS] = [{ img: planks(), glow: null }];
  return S;
}
