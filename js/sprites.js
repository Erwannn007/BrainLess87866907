// Tous les sprites du décor, générés par code (aucune image externe).
import { renderModel, ramp, hex, hash, makeBuffer, outlineBuffer } from './raster.js';
import { T, O } from './world.js';

const BARK = ramp('#2e1c10', '#553620', '#7a5233', '#9a6d45');
const LEAF = ramp('#1d4728', '#2d6a33', '#4a923d', '#7dc257');
const LEAF_FOREST = ramp('#183d24', '#255a2d', '#3b7c37', '#62a64c');
const CHERRY = ramp('#86365a', '#c55c88', '#ec8fb2', '#ffc8dc');
const PINE = ramp('#123327', '#1c4c35', '#2a6843', '#448a52');
const SNOWY = ramp('#9cb0c6', '#c9d6e4', '#eaf1f8', '#ffffff');
const ROCK = ramp('#34373f', '#5a5f6b', '#838894', '#b1b6bf');
const MOSS = ramp('#2b4a23', '#3f6b2e', '#5d8e3c', '#86b356');
const BUSH = ramp('#1a4424', '#28622f', '#3f8a3a', '#69b14f');
const STEM = ramp('#a69b86', '#cfc6b2', '#ece6d8', '#ffffff');
const MUSH = ramp('#6e1414', '#a8221f', '#d9412f', '#f2735a');
const WOOD_TOP = hex('#c9a06a');

export const TREE_W = 60, TREE_H = 78, TREE_OX = 30, TREE_OY = 70;
export const SWAY_FRAMES = 4;

const leafTex = (seed, swayPx) => (p) => {
  const r = hash(Math.round(p.x - swayPx), p.y, seed);
  if (r < 0.17) return Math.max(0, p.shade - 1);
  if (r > 0.93) return Math.min(3, p.shade + 1);
  return p.shade;
};

function treeParts(kind, f, seed) {
  const sway = Math.sin(f / SWAY_FRAMES * Math.PI * 2);
  const parts = [];
  const sw = (z) => sway * 0.06 * Math.max(0, z - 10); // le haut bouge plus que le bas
  if (kind === 'oak' || kind === 'cherry') {
    const leaves = kind === 'cherry' ? CHERRY : (seed & 1 ? LEAF : LEAF_FOREST);
    parts.push({ a: [0, 0, 0], b: [sw(16), 0, 17], r1: 3.4, r2: 2.4, ramp: BARK, group: 1,
      tex: (p) => ((p.x + 1) % 3 === 0 && p.shade > 0 ? p.shade - 1 : p.shade) });
    parts.push({ a: [-2.5, 1, 0.5], r1: 2, ramp: BARK, group: 1 });
    parts.push({ a: [2.5, -1, 0.5], r1: 2, ramp: BARK, group: 1 });
    const blobs = [[0, 0, 25, 10], [-7, 2, 21, 7], [7, 1, 21, 7.5], [-2, -6, 27, 8], [4, 5, 28, 7], [-4, 2, 32, 6.5], [3, -2, 33, 6]];
    blobs.forEach(([x, y, z, r], i) => {
      parts.push({ a: [x + sw(z), y, z], r1: r, ramp: leaves, group: 2 + (i > 3 ? 1 : 0), tex: leafTex(seed + i, sway * 0.06 * (z - 10)) });
    });
  } else if (kind === 'pine' || kind === 'snowpine') {
    parts.push({ a: [0, 0, 0], b: [0, 0, 10], r1: 2.6, r2: 2, ramp: BARK, group: 1 });
    const layers = [[7, 10, 20], [13, 8.2, 26], [19, 6.4, 31], [25, 4.6, 36]];
    layers.forEach(([z, r, top], i) => {
      parts.push({
        a: [sw(z), 0, z], b: [sw(top), 0, top], r1: r, r2: 0.6, ramp: PINE, group: 2 + i,
        tex: (p) => {
          if (p.t === 0 && p.ey > p.r * 0.25) return null; // jupe plate, pas de fond arrondi
          if (kind === 'snowpine' && (p.y + i) % 3 !== 0 && hash(p.x, p.y, 3) < (p.y + i) % 3 * 0.45) return SNOWY[Math.min(3, p.shade + 1)];
          if ((p.y + i) % 3 === 0) return Math.max(0, p.shade - 1);
          return p.shade;
        },
      });
    });
  }
  return parts;
}

function bake(parts, w, h, ox, oy, scale = 1, facing = [0, 1]) {
  return renderModel(parts, { w, h, ox, oy, scale, facing });
}

// ---------- objets du décor ----------
export function buildObjectSprites() {
  const S = {}; // S[objId] = [frames...]
  const tree = (kind, scale, seed) => {
    const frames = [];
    for (let f = 0; f < SWAY_FRAMES; f++) frames.push(bake(treeParts(kind, f, seed), TREE_W, TREE_H, TREE_OX, TREE_OY, scale));
    return frames;
  };
  S[O.OAK_S] = tree('oak', 0.75, 3);
  S[O.OAK_M] = tree('oak', 0.95, 4);
  S[O.OAK_L] = tree('oak', 1.15, 7);
  S[O.PINE] = tree('pine', 1.0, 1);
  S[O.PINE_L] = tree('pine', 1.25, 2);
  S[O.SNOW_PINE] = tree('snowpine', 1.05, 5);
  S[O.CHERRY] = tree('cherry', 1.05, 9);

  const bush = (berry) => {
    const frames = [];
    for (let f = 0; f < 2; f++) {
      const s = f ? 0.4 : 0;
      frames.push(bake([
        { a: [-3 + s, 0, 4], r1: 5, ramp: BUSH, tex: berryTex(berry, 1) },
        { a: [3.5 + s, 1, 3.6], r1: 4.6, ramp: BUSH, tex: berryTex(berry, 2) },
        { a: [0.5 + s, -1.5, 7], r1: 4.8, ramp: BUSH, tex: berryTex(berry, 3) },
      ], 32, 28, 16, 23));
    }
    return frames;
  };
  S[O.BUSH] = bush(false);
  S[O.BERRY] = bush(true);

  const rockTex = (moss) => (p) => {
    if (moss && p.ny < -0.35 && hash(p.x, p.y, 9) < 0.8) return MOSS[p.shade];
    if (hash(p.x, p.y, 4) < 0.08) return Math.max(0, p.shade - 1);
    return p.shade;
  };
  S[O.ROCK] = [bake([
    { a: [0, 0, 3], r1: 5, ramp: ROCK, group: 1, tex: rockTex(false) },
    { a: [4, 1.5, 2], r1: 3.2, ramp: ROCK, group: 2, tex: rockTex(false) },
    { a: [-3, 2, 1.8], r1: 2.6, ramp: ROCK, group: 3, tex: rockTex(false) },
  ], 32, 24, 16, 19)];
  S[O.ROCK_L] = [bake([
    { a: [0, 0, 5], r1: 8, ramp: ROCK, group: 1, tex: rockTex(false) },
    { a: [6, 2, 3], r1: 5, ramp: ROCK, group: 2, tex: rockTex(false) },
    { a: [-5, 3, 2.5], r1: 4.2, ramp: ROCK, group: 3, tex: rockTex(false) },
    { a: [-1, -3, 10], r1: 4.5, ramp: ROCK, group: 4, tex: rockTex(false) },
  ], 40, 34, 20, 27)];
  S[O.ROCK_MOSS] = [bake([
    { a: [0, 0, 3.5], r1: 6, ramp: ROCK, group: 1, tex: rockTex(true) },
    { a: [4.5, 2, 2.2], r1: 3.6, ramp: ROCK, group: 2, tex: rockTex(true) },
  ], 32, 26, 16, 20)];
  S[O.STUMP] = [bake([
    { a: [0, 0, 0], b: [0, 0, 3.5], r1: 3.8, ramp: BARK, group: 1,
      tex: (p) => (p.ny < -0.55 ? (hash(p.x, p.y, 2) < 0.3 ? BARK[3] : WOOD_TOP) : p.shade) },
    { a: [-3, 1.5, 0.5], r1: 1.8, ramp: BARK, group: 1 },
  ], 24, 20, 12, 16)];
  S[O.LOG] = [bake([
    { a: [-7, 1, 2.6], b: [7, -1, 2.6], r1: 3, ramp: BARK, group: 1,
      tex: (p) => ((p.x % 4 === 0) && p.shade > 0 ? p.shade - 1 : p.shade) },
  ], 34, 20, 17, 15, 1, [0.7, 0.7])];
  S[O.MUSHROOM] = [bake([
    { a: [0, 0, 0], b: [0, 0, 3], r1: 1.2, ramp: STEM, group: 1 },
    { a: [0, 0, 4], r1: 2.8, ramp: MUSH, group: 2, tex: (p) => (hash(p.x, p.y, 7) < 0.18 && p.ny < 0.3 ? STEM[3] : p.shade) },
    { a: [3.5, 1.5, 0], b: [3.5, 1.5, 1.8], r1: 0.8, ramp: STEM, group: 3 },
    { a: [3.5, 1.5, 2.4], r1: 1.7, ramp: MUSH, group: 4 },
  ], 20, 18, 9, 14)];

  S[O.GRASS] = grassFrames();
  S[O.FLOWER_R] = flowerFrames('#e2453c', '#ff8a7a');
  S[O.FLOWER_Y] = flowerFrames('#f2c230', '#fff08a');
  S[O.FLOWER_B] = flowerFrames('#5a78e6', '#9fb6ff');
  S[O.FLOWER_W] = flowerFrames('#e9ecf2', '#ffffff');
  S[O.PEBBLES] = [pebbles()];
  S[O.LILY] = [lily()];
  S[O.REEDS] = reedFrames();
  return S;
}

function berryTex(berry, s) {
  return (p) => {
    const r = hash(p.x, p.y, s);
    if (berry && r < 0.07 && p.shade >= 1) return hex(r < 0.035 ? '#d8283c' : '#ff5a6e');
    if (r > 0.9) return Math.min(3, p.shade + 1);
    if (r < 0.2) return Math.max(0, p.shade - 1);
    return p.shade;
  };
}

function grassFrames() {
  const cols = ramp('#2f6b2c', '#468a37', '#5fa843', '#85c95a');
  const blades = [[-5, 7, -1], [-3, 10, 0], [-1, 12, 1], [1, 9, 0], [3, 11, 1], [5, 8, 2], [0, 6, 2], [-6, 5, 1]];
  const frames = [];
  for (let f = 0; f < 3; f++) {
    const b = makeBuffer(20, 18);
    const sway = [0, 1, -1][f];
    for (const [bx, len, c] of blades) {
      for (let i = 0; i < len; i++) {
        const k = i / len;
        const x = 10 + bx + Math.round(sway * k * k * 2 + (bx > 0 ? k * 1.5 : -k * 1.5));
        b.set(x, 16 - i, cols[Math.min(3, c + (k > 0.7 ? 1 : 0))]);
      }
    }
    frames.push(Object.assign(outlineBuffer(b, 0.4), { ox: 10, oy: 15 }));
  }
  return frames;
}

function flowerFrames(petal, light) {
  const P = hex(petal), PL = hex(light), C = hex('#f6d23a'), G = hex('#3f8a35'), GL = hex('#5fa843');
  const frames = [];
  const heads = [[-3, 7], [2, 9], [4, 5]];
  for (let f = 0; f < 2; f++) {
    const b = makeBuffer(18, 16);
    const sw = f;
    for (const [hx, hh] of heads) {
      for (let i = 0; i < hh; i++) b.set(9 + hx + (i > hh * 0.6 ? sw : 0), 14 - i, i % 3 ? G : GL);
      const cx = 9 + hx + sw, cy = 14 - hh;
      b.set(cx - 1, cy, P); b.set(cx + 1, cy, P); b.set(cx, cy - 1, PL); b.set(cx, cy + 1, P); b.set(cx, cy, C);
    }
    b.set(6, 13, GL); b.set(7, 12, G); b.set(12, 13, GL);
    frames.push(Object.assign(outlineBuffer(b, 0.35), { ox: 9, oy: 14 }));
  }
  return frames;
}

function reedFrames() {
  const G = ramp('#4e6b2a', '#6b8c35', '#8fae4a', '#b4cc6a');
  const B = hex('#6b4426');
  const frames = [];
  for (let f = 0; f < 3; f++) {
    const b = makeBuffer(18, 22);
    const sway = [0, 1, -1][f];
    [[-4, 15], [-1, 18], [2, 14], [5, 16]].forEach(([bx, len], j) => {
      for (let i = 0; i < len; i++) b.set(9 + bx + (i > len * 0.6 ? sway : 0), 20 - i, G[(j + (i > 8 ? 1 : 0)) % 4]);
      if (j % 2) { const x = 9 + bx + sway; b.set(x, 20 - len, B); b.set(x, 21 - len, B); b.set(x, 22 - len, B); }
    });
    frames.push(Object.assign(outlineBuffer(b, 0.4), { ox: 9, oy: 19 }));
  }
  return frames;
}

function pebbles() {
  const R = ramp('#4f535c', '#7a7f8a', '#a2a7b1', '#c9cdd4');
  const b = makeBuffer(16, 10);
  [[4, 5, 2], [9, 6, 1], [11, 3, 1], [6, 2, 1]].forEach(([x, y, r]) => {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r - 1; dx <= r + 1; dx++) {
      if (dx * dx / ((r + 1) * (r + 1)) + dy * dy / (r * r) > 1.05) continue;
      b.set(x + dx, y + dy, R[dy < 0 ? 3 : dy === 0 ? 2 : 1]);
    }
  });
  return Object.assign(outlineBuffer(b, 0.4), { ox: 8, oy: 6 });
}

function lily() {
  const G = ramp('#2c6b33', '#3f8f3e', '#5fb350', '#8ad66a');
  const b = makeBuffer(16, 10);
  for (let y = -3; y <= 3; y++) for (let x = -6; x <= 6; x++) {
    if (x * x / 36 + y * y / 9 > 1) continue;
    if (x > 0 && Math.abs(y) <= Math.max(0, x / 3) - 0.5) continue; // l'encoche
    b.set(8 + x, 5 + y, G[y < -1 ? 3 : y < 1 ? 2 : 1]);
  }
  b.set(6, 4, hex('#ffd9e6')); b.set(5, 4, hex('#ff9cc0')); b.set(6, 3, hex('#ffffff')); b.set(7, 4, hex('#ff9cc0'));
  return Object.assign(outlineBuffer(b, 0.45), { ox: 8, oy: 5 });
}

// Ombre au sol (ellipse pixel, 2:1).
export function shadowBuffer(rw, rh) {
  const w = rw * 2 + 2, h = rh * 2 + 2;
  const b = makeBuffer(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = (x + 0.5 - w / 2) / rw, dy = (y + 0.5 - h / 2) / rh;
    if (dx * dx + dy * dy <= 1) b.set(x, y, [10, 20, 18], 70);
  }
  return Object.assign(b, { ox: w / 2, oy: h / 2 });
}

// ---------- tuiles isométriques ----------
const TOPS = {
  [T.GRASS]: ramp('#4b8a35', '#5c9e3f', '#73b84d', '#8fd162'),
  [T.FOREST]: ramp('#2f6329', '#3c7533', '#4f9142', '#68a854'),
  [T.MEADOW]: ramp('#5c9e3f', '#6fb34a', '#86c75a', '#a3d96f'),
  [T.SAND]: ramp('#c9b06c', '#dfc98a', '#ecdca2', '#f6ebbf'),
  [T.STONE]: ramp('#6f747f', '#878c96', '#9ea3ac', '#b8bcc4'),
  [T.SNOW]: ramp('#c9d5e1', '#e3eaf1', '#f3f7fa', '#ffffff'),
};
const DIRT = ramp('#4a2f1c', '#62402a', '#7a5233', '#8e6440');
const SANDSIDE = ramp('#8f7444', '#a88b52', '#c2a364', '#d4b97c');
const STONESIDE = ramp('#3f434b', '#575b64', '#6c717b', '#82878f');

export const TILE_W = 32, TILE_H = 16;

// Largeur de la ligne r du losange (0..15) : de 14-2r à 17+2r.
export function rowSpan(r) {
  const rr = r < 8 ? r : 15 - r;
  return [14 - 2 * rr, 17 + 2 * rr];
}

export function blockBuffer(type, level, v) {
  const sideH = level * 8 + 7;
  const b = makeBuffer(TILE_W, TILE_H + sideH);
  const top = TOPS[type];
  const grassy = type === T.GRASS || type === T.FOREST || type === T.MEADOW;
  const sideRamp = type === T.SAND ? SANDSIDE : grassy ? DIRT : STONESIDE;
  const seed = type * 31 + v * 7;

  // faces latérales
  for (let x = 0; x < TILE_W; x++) {
    const edge = x < 16 ? 8 + (x >> 1) : 8 + ((31 - x) >> 1);
    const left = x < 16;
    for (let d = 1; d <= sideH; d++) {
      const y = edge + d;
      const r = hash(x, y, seed + 3);
      let c;
      if (grassy && (d <= 2 || (d === 3 && hash(x, 0, seed) < 0.5))) c = top[left ? 1 : 0];
      else if (type === T.SNOW && (d <= 3 || (d === 4 && hash(x, 0, seed) < 0.5))) c = top[left ? 2 : 0];
      else {
        let s = left ? 2 : 1;
        if (d % 8 === 0) s -= 1; // strates
        if (r < 0.12) s -= 1; else if (r > 0.94) s += 1;
        if (grassy && r > 0.985) c = STONESIDE[2];
        else c = sideRamp[Math.max(0, Math.min(3, s))];
      }
      b.set(x, y, c);
    }
  }
  // dessus
  for (let r = 0; r < 16; r++) {
    const [x0, x1] = rowSpan(r);
    for (let x = x0; x <= x1; x++) {
      const h = hash(x, r, seed);
      let s = 1;
      if (h < 0.13) s = 0; else if (h > 0.88) s = 2;
      if (grassy && h > 0.972) { s = 3; b.set(x, r + 1, top[0]); }
      if (type === T.STONE && h > 0.95) s = 0;
      if (type === T.SNOW && h > 0.97) s = 3;
      b.set(x, r, top[s]);
    }
  }
  // fleurettes et cailloux sur certaines variantes
  if (type === T.MEADOW && v % 2 === 0) {
    const cols = ['#fff3a0', '#ffffff', '#ff9ec0'].map(hex);
    for (let i = 0; i < 4; i++) {
      const r = 3 + ((hash(i, v, 5) * 10) | 0), [x0, x1] = rowSpan(r);
      b.set(x0 + 2 + ((hash(i, v, 6) * (x1 - x0 - 4)) | 0), r, cols[i % 3]);
    }
  }
  return Object.assign(b, { ox: 16, oy: 0 });
}

const WATER = ramp('#1f4f86', '#2a66a6', '#3f86c6', '#8cc6ee');
const DEEPW = ramp('#163a6a', '#1d4b82', '#2c64a3', '#6fa9dc');

export function waterBuffer(deep, frame, v) {
  const C = deep ? DEEPW : WATER;
  const b = makeBuffer(TILE_W, TILE_H);
  for (let r = 0; r < 16; r++) {
    const [x0, x1] = rowSpan(r);
    for (let x = x0; x <= x1; x++) {
      const w = Math.sin(x * 0.45 + r * 1.3 + frame * Math.PI / 2 + v * 1.7) + Math.sin(x * 0.2 - r * 0.7 - frame * Math.PI / 2);
      let s = 1;
      if (w > 1.55) s = 3; else if (w > 1.05) s = 2; else if (w < -1.4) s = 0;
      b.set(x, r, C[s]);
    }
  }
  return Object.assign(b, { ox: 16, oy: 0 });
}

// Lignes de bord : 0 haut-gauche, 1 haut-droite, 2 bas-droite, 3 bas-gauche.
export function edgeBuffer(edge, color, alpha, thick = 1) {
  const b = makeBuffer(TILE_W, TILE_H);
  const c = hex(color);
  for (let r = 0; r < 16; r++) {
    if ((edge <= 1) !== (r < 8)) continue;
    const [x0, x1] = rowSpan(r);
    for (let k = 0; k < 2 * thick; k++) {
      if (edge === 0 || edge === 3) b.set(x0 + k, r, c, alpha);
      else b.set(x1 - k, r, c, alpha);
    }
  }
  return Object.assign(b, { ox: 16, oy: 0 });
}

// Écume animée sur les bords d'eau touchant la terre.
export function foamBuffer(edge, frame) {
  const b = makeBuffer(TILE_W, TILE_H);
  const c = hex('#d8eefb');
  for (let r = 0; r < 16; r++) {
    if ((edge <= 1) !== (r < 8)) continue;
    const [x0, x1] = rowSpan(r);
    const w = 2 + ((Math.sin(r * 0.9 + frame * 1.6) + 1) * 1.2 | 0);
    for (let k = 0; k < w; k++) {
      if (hash(r, k, frame) < 0.25 && k > 1) continue;
      if (edge === 0 || edge === 3) b.set(x0 + k, r, c, k < 2 ? 230 : 140);
      else b.set(x1 - k, r, c, k < 2 ? 230 : 140);
    }
  }
  return Object.assign(b, { ox: 16, oy: 0 });
}
