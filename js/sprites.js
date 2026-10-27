// Tous les sprites du décor, générés par code (aucune image externe).
import { renderModel, ramp, hex, hash, makeBuffer, outlineBuffer } from './raster.js';
import { T, O } from './world.js';

const BARK = ramp('#2e1c10', '#553620', '#7a5233', '#9a6d45');
const LEAF = ramp('#1d4728', '#2d6a33', '#4a923d', '#7dc257');
const LEAF_FOREST = ramp('#183d24', '#255a2d', '#3b7c37', '#62a64c');
const CHERRY = ramp('#86365a', '#c55c88', '#ec8fb2', '#ffc8dc');
const PINE = ramp('#123327', '#1c4c35', '#2a6843', '#448a52');
const SNOWY = ramp('#9cb0c6', '#c9d6e4', '#eaf1f8', '#ffffff');
const CONE = hex('#5a3a1e'); // pomme de pin
const ROCK = ramp('#34373f', '#5a5f6b', '#838894', '#b1b6bf');
const MOSS = ramp('#2b4a23', '#3f6b2e', '#5d8e3c', '#86b356');
const BUSH = ramp('#1a4424', '#28622f', '#3f8a3a', '#69b14f');
const STEM = ramp('#a69b86', '#cfc6b2', '#ece6d8', '#ffffff');
const MUSH = ramp('#6e1414', '#a8221f', '#d9412f', '#f2735a');
const CHAR = ramp('#120d0c', '#2a201c', '#45362e', '#62503f'); // bois calciné
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
    // Sapin : un tronc à racines, puis des étages de branches. Chaque étage = un cœur conique
    // plus une couronne de rameaux qui partent du tronc et retombent : la silhouette est
    // dentelée comme un vrai sapin. Bouts des rameaux plus clairs, dessous dans l'ombre,
    // aiguilles en grain, quelques pommes de pin ; la neige se pose sur le dessus des rameaux.
    const snow = kind === 'snowpine', rnd = (k) => hash(k, seed, 41);
    const needles = (i, core) => (p) => {
      const r = hash(p.x, p.y, seed + i * 13);
      if (snow && p.ny < (core ? -0.55 : -0.2) && r < 0.88) return SNOWY[Math.min(3, p.shade + (p.ny < -0.6 ? 1 : 0))];
      if (!core && r > 0.988 && p.t > 0.35 && p.ny > -0.2) return CONE;
      let sh = p.shade;
      if (core) sh--; // le cœur, sous les rameaux : de la profondeur entre les étages
      else if (p.t > 0.72) sh++; // les bouts au soleil
      if (p.ny > 0.5) sh--; // le dessous
      if (r < 0.17) sh--; else if (r > 0.95) sh++;
      return Math.max(0, Math.min(3, sh));
    };
    parts.push({ a: [0, 0, 0], b: [sw(12), 0, 12], r1: 2.3, r2: 1.3, ramp: BARK, group: 1,
      tex: (p) => ((p.y % 3 === 0 || hash(p.x, p.y, 8) < 0.15) && p.shade > 0 ? p.shade - 1 : p.shade) });
    for (const [x, y] of [[-2.8, 1.3], [2.6, -1.2], [0.8, 2.8]]) parts.push({ a: [x, y, 0.3], b: [0, 0, 2.6], r1: 1.25, r2: 1, ramp: BARK, group: 1 });
    const tiers = [[9.5, 11, 8], [14.5, 9.3, 8], [19.5, 7.5, 7], [24.2, 5.7, 6], [28.5, 4, 5]];
    tiers.forEach(([z, R, n], i) => {
      const g = 2 + i;
      parts.push({ a: [sw(z - 1), 0, z - 1], b: [sw(z + 6), 0, z + 6], r1: R * 0.6, r2: 0.9, ramp: PINE, group: g, tex: needles(i, true) });
      for (let k = 0; k < n; k++) {
        const a = (k / n + rnd(i * 17 + k) * 0.1 + i * 0.29) * Math.PI * 2, rr = R * (0.82 + rnd(i * 17 + k + 7) * 0.26);
        const ez = z - 2 - rnd(i * 31 + k) * 1.4, sz = z + 1.2;
        parts.push({ a: [sw(sz) + Math.cos(a) * 1.2, Math.sin(a) * 1.2, sz], b: [sw(ez) + Math.cos(a) * rr, Math.sin(a) * rr, ez],
          r1: 2.5 - i * 0.22, r2: 1.05, ramp: PINE, group: g, tex: needles(i, false) });
      }
    });
    parts.push({ a: [sw(31), 0, 31], b: [sw(38), 0, 38], r1: 1.7, r2: 0.35, ramp: PINE, group: 8, tex: needles(6, true) });
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
  // arbre calciné : tronc noirci, branches nues, écorce craquelée
  S[O.BURNT] = [bake([
    { a: [0, 0, 0], b: [0.5, 0, 16], r1: 3, r2: 1.5, ramp: CHAR, group: 1,
      tex: (p) => (hash(p.x, p.y, 11) < 0.2 ? Math.max(0, p.shade - 1) : (p.x + p.y) % 4 === 0 && p.shade > 1 ? p.shade - 1 : p.shade) },
    { a: [-2.4, 1, 0.5], r1: 1.8, ramp: CHAR, group: 1 },
    { a: [2.2, -1, 0.5], r1: 1.7, ramp: CHAR, group: 1 },
    { a: [0.3, 0, 10], b: [-6, 1, 18], r1: 1.3, r2: 0.5, ramp: CHAR, group: 2 },
    { a: [0.4, 0, 12], b: [5.5, -1, 20], r1: 1.2, r2: 0.5, ramp: CHAR, group: 3 },
    { a: [0.5, 0, 15], b: [1.5, 1, 23], r1: 1, r2: 0.45, ramp: CHAR, group: 4 },
    { a: [-3, 0.6, 15], b: [-5.5, 0, 18.5], r1: 0.7, r2: 0.4, ramp: CHAR, group: 5 },
  ], 52, 56, 26, 49, 1.4)];
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
// Pavés : grille de pierres en losange, joints sombres, chaque pierre a sa teinte.
function cobbleShade(x, r, seed) {
  const u = (x - 16) / 2 + r, v = r - (x - 16) / 2; // axes du monde dans la tuile
  const row = Math.floor(v / 4);
  const uu = u + (row & 1) * 2.5;
  if (v - row * 4 < 0.9 || uu - Math.floor(uu / 5) * 5 < 0.9) return 0;
  const k = hash(Math.floor(uu / 5), row, seed + 11);
  return k < 0.3 ? 1 : k < 0.85 ? 2 : 3;
}

const TOPS = {
  [T.GRASS]: ramp('#4b8a35', '#5c9e3f', '#73b84d', '#8fd162'),
  [T.FOREST]: ramp('#2f6329', '#3c7533', '#4f9142', '#68a854'),
  [T.MEADOW]: ramp('#5c9e3f', '#6fb34a', '#86c75a', '#a3d96f'),
  [T.SAND]: ramp('#c9b06c', '#dfc98a', '#ecdca2', '#f6ebbf'),
  [T.STONE]: ramp('#6f747f', '#878c96', '#9ea3ac', '#b8bcc4'),
  [T.SNOW]: ramp('#c9d5e1', '#e3eaf1', '#f3f7fa', '#ffffff'),
  [T.PATH]: ramp('#7a5a3a', '#94704a', '#ab875a', '#c29e6e'),
  [T.DIRT]: ramp('#4f3220', '#664330', '#7d5638', '#946a44'),
  [T.COBBLE]: ramp('#5f5a52', '#7f786c', '#9d9586', '#bdb4a2'),
  [T.DEN]: ramp('#2a1d14', '#3a2a1c', '#4a3624', '#5c4630'), // terre battue
  [T.EARTH]: ramp('#4a2f1c', '#5e3d26', '#73502f', '#8a6440'),
  [T.EARTH_STONE]: ramp('#4a2f1c', '#5e3d26', '#73502f', '#8a6440'),
  [T.EARTH_IRON]: ramp('#4a2f1c', '#5e3d26', '#73502f', '#8a6440'),
  [T.BEDROCK]: ramp('#141218', '#1f1c25', '#2b2733', '#3a3545'),
  [T.PLANK]: ramp('#3d2614', '#5e3d22', '#86593a', '#a87a52'),
  [T.WALL_IN]: ramp('#24160c', '#3b2414', '#5a3a20', '#7a5233'),
  [T.WALL_HIDE]: ramp('#090a20', '#151848', '#22276b', '#343b8e'),
};
const PLASTERS = ramp('#8f7f62', '#c2b08a', '#e3d4ae', '#f6ecd0');
const HIDES = ramp('#090a20', '#151848', '#22276b', '#343b8e');
const STRIPE = ramp('#4e0c18', '#9c1628', '#d22838', '#ff5a5e');
const BONE = ramp('#55575e', '#8d9097', '#c4c6cb', '#eceef0');
const VEIN = { [T.EARTH_STONE]: ramp('#3f434b', '#5e636e', '#808590', '#a7acb5'), [T.EARTH_IRON]: ramp('#5a2a10', '#9a4a1c', '#c9732e', '#f0b070') };
const DIRT = ramp('#4a2f1c', '#62402a', '#7a5233', '#8e6440');
const SANDSIDE = ramp('#8f7444', '#a88b52', '#c2a364', '#d4b97c');
const STONESIDE = ramp('#3f434b', '#575b64', '#6c717b', '#82878f');

export const TILE_W = 32, TILE_H = 16;

// Mur d'intérieur vu de dedans : plâtre et poutres (village) ou peaux indigo rayées de rouge,
// cousues d'os (son repaire). `d` = profondeur sous le haut du mur.
function innerWall(type, x, d, sideH, left, r) {
  let s = left ? 2 : 1;
  if (r < 0.1) s--; else if (r > 0.95) s++;
  s = Math.max(0, Math.min(3, s));
  if (type === T.WALL_IN) {
    if (d <= 2 || d >= sideH - 1) return TOPS[T.WALL_IN][d <= 1 ? 2 : 1]; // poutre et plinthe
    if (x % 16 === 3) return TOPS[T.WALL_IN][1]; // poteaux
    return PLASTERS[s];
  }
  if (d <= 1) return BONE[2];
  if (d >= 9 && d <= 11) return STRIPE[left ? 2 : 1];
  if (x % 8 === 0 && d % 3 === 1) return BONE[1]; // coutures
  return HIDES[s];
}

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
  const earthy = type === T.PATH || type === T.DIRT;
  const earthWall = type === T.EARTH || type === T.EARTH_STONE || type === T.EARTH_IRON;
  const sideRamp = type === T.SAND ? SANDSIDE : grassy || earthy || earthWall || type === T.DEN ? DIRT : type === T.BEDROCK ? top : STONESIDE;
  const seed = type * 31 + v * 7;

  // faces latérales
  for (let x = 0; x < TILE_W; x++) {
    const edge = x < 16 ? 8 + (x >> 1) : 8 + ((31 - x) >> 1);
    const left = x < 16;
    for (let d = 1; d <= sideH; d++) {
      const y = edge + d;
      const r = hash(x, y, seed + 3);
      let c;
      if (type === T.WALL_IN || type === T.WALL_HIDE) { c = innerWall(type, x, d, sideH, left, r); b.set(x, y, c); continue; }
      if (VEIN[type] && hash(x >> 1, y >> 1, seed + 9) < (type === T.EARTH_IRON ? 0.16 : 0.3)) { c = VEIN[type][left ? 2 : 1]; if (r > 0.9) c = VEIN[type][3]; b.set(x, y, c); continue; }
      if (earthWall && hash(x, y >> 2, seed + 12) < 0.04) { b.set(x, y, DIRT[0]); continue; } // racines
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
      if (type === T.DIRT) {
        // terre retournée : mottes claires avec leur ombre dessous
        if (h > 0.9) { s = 3; b.set(x, r + 1, top[0]); } else if (h < 0.22) s = 0;
      }
      if (type === T.PATH && h > 0.975) { s = 3; b.set(x + 1, r, STONESIDE[2]); } // petits cailloux
      if (type === T.COBBLE) s = cobbleShade(x, r, seed);
      if (type === T.PLANK) { const u = (x - 16) / 2 + r; s = ((u + 64) % 4) < 0.8 ? 0 : h < 0.15 ? 1 : 2; } // lames de plancher
      if (type === T.DEN && h > 0.94) { s = 3; b.set(x, r + 1, top[0]); } // cailloux
      if (VEIN[type] && hash(x >> 1, r >> 1, seed + 7) < (type === T.EARTH_IRON ? 0.2 : 0.32)) { b.set(x, r, VEIN[type][h > 0.6 ? 3 : 2]); continue; }
      if (earthWall && h > 0.965) s = 3;
      if (type === T.WALL_IN || type === T.WALL_HIDE) s = h < 0.2 ? 0 : 1;
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

// Fissures sur le dessus d'une tuile, après un gros coup. Niveau 1 à 3 ;
// `mat` : 'earth' (herbe, terre), 'sand', 'stone', 'snow'. Le niveau 3 laisse voir le dessous.
const CRACK = {
  earth: { line: '#2e1e12', patch: ['#62402a', '#7a5233'], chip: '#8e6440' },
  sand: { line: '#8f7444', patch: ['#c2a364', '#d4b97c'], chip: '#f6ebbf' },
  stone: { line: '#2c2f36', patch: ['#575b64', '#6c717b'], chip: '#c9cdd4' },
  snow: { line: '#7f93aa', patch: ['#b8c6d6', '#a8b8ca'], chip: '#ffffff' },
};
export function crackBuffer(mat, level, v) {
  const C = CRACK[mat], line = hex(C.line), chip = hex(C.chip), patch = C.patch.map(hex);
  const b = makeBuffer(TILE_W, TILE_H);
  const inside = (x, y) => { if (y < 1 || y > 14) return false; const [x0, x1] = rowSpan(y); return x > x0 + 1 && x < x1 - 1; };
  // terre à nu, au niveau 3
  if (level >= 3) {
    for (let y = 0; y < 16; y++) for (let x = 0; x < TILE_W; x++) {
      if (!inside(x, y)) continue;
      const dx = (x - 16) / 9, dy = (y - 8) / 4.5;
      if (dx * dx + dy * dy + hash(x, y, v + 40) * 0.5 < 0.8) b.set(x, y, patch[hash(x, y, v) < 0.7 ? 0 : 1]);
    }
  }
  // fissures en zigzag qui partent du centre
  const n = [3, 5, 7][level - 1];
  for (let i = 0; i < n; i++) {
    let x = 16 + (hash(i, v, 2) - 0.5) * 4, y = 8 + (hash(i, v, 3) - 0.5) * 2;
    const a0 = (i / n) * Math.PI * 2 + hash(i, v, 4);
    const len = 4 + level * 2 + hash(i, v, 5) * 4;
    for (let k = 0; k < len; k++) {
      const a = a0 + (hash(i, k, v + 7) - 0.5) * 1.4;
      x += Math.cos(a) * 1.2; y += Math.sin(a) * 0.6;
      const px = Math.round(x), py = Math.round(y);
      if (!inside(px, py)) break;
      b.set(px, py, line);
      if (k % 3 === 1 && inside(px, py + 1) && !b.get(px, py + 1)) b.set(px, py + 1, chip, 110); // bord éclairé
    }
  }
  // éclats
  for (let i = 0; i < level * 2; i++) {
    const x = 6 + ((hash(i, v, 8) * 20) | 0), y = 3 + ((hash(i, v, 9) * 10) | 0);
    if (inside(x, y)) b.set(x, y, chip, 220);
  }
  return Object.assign(b, { ox: 16, oy: 0 });
}

// Flaque de sang au sol (ellipse 2:1 aux bords irréguliers, quelques gouttes autour).
export function bloodBuffer(rw, seed) {
  const B = ramp('#3e060c', '#6e0e18', '#a01824', '#d02c36');
  const w = rw * 2 + 10, h = rw + 8;
  const b = makeBuffer(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = (x + 0.5 - w / 2) / rw, dy = (y + 0.5 - h / 2) / (rw / 2);
    const d = dx * dx + dy * dy, edge = 0.7 + hash(x >> 1, y, seed) * 0.45;
    if (d > edge) continue;
    const r = hash(x, y, seed + 1);
    b.set(x, y, B[d > edge - 0.25 ? 0 : r > 0.93 ? 3 : r < 0.3 ? 1 : 2]);
  }
  for (let i = 0; i < rw; i++) {
    const a = hash(i, seed, 2) * Math.PI * 2, r = rw * (1.05 + hash(i, seed, 3) * 0.4);
    b.set(Math.round(w / 2 + Math.cos(a) * r), Math.round(h / 2 + Math.sin(a) * r * 0.5), B[1]);
  }
  return Object.assign(b, { ox: w / 2, oy: h / 2 });
}

// Cendres au sol après un feu : flaque grise irrégulière, quelques braises.
export function ashBuffer(rw, seed) {
  const A = ramp('#1a1716', '#2c2826', '#3e3935', '#57514a');
  const w = rw * 2 + 8, h = rw + 6;
  const b = makeBuffer(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = (x + 0.5 - w / 2) / rw, dy = (y + 0.5 - h / 2) / (rw / 2);
    const d = dx * dx + dy * dy, edge = 0.65 + hash(x >> 1, y, seed) * 0.5;
    if (d > edge) continue;
    const r = hash(x, y, seed + 5);
    if (d > edge - 0.3 && r < 0.4) continue; // bord poudreux
    b.set(x, y, r > 0.985 ? hex('#c8401c') : A[r > 0.9 ? 3 : r < 0.35 ? 0 : r < 0.7 ? 1 : 2]);
  }
  return Object.assign(b, { ox: w / 2, oy: h / 2 });
}

// Flamme : langue de feu pixel, du cœur blanc-jaune aux bords rouges, qui ondule sur 4 images.
// size 0 (herbe), 1 (objet, habitant), 2 (arbre, toit).
const FIRE = ['#c8281e', '#ff5a2a', '#ff9a3c', '#ffd23f', '#fff3b0'].map(hex);
export function flameBuffer(size, frame) {
  const W = [7, 11, 15][size], H = [10, 16, 23][size];
  const b = makeBuffer(W + 4, H + 5);
  const ph = frame / 4 * Math.PI * 2;
  for (let y = 0; y < H; y++) {
    const u = (H - 1 - y) / (H - 1); // 0 au pied, 1 à la pointe
    const hw = W / 2 * (1 - Math.pow(u, 1.3)) * (0.88 + 0.12 * Math.sin(ph + u * 5));
    const cx = W / 2 + 2 + Math.sin(u * 3.2 + ph) * u * W * 0.2;
    for (let x = 0; x < W + 4; x++) {
      const dx = Math.abs(x + 0.5 - cx) / Math.max(0.6, hw);
      if (dx > 1) continue;
      if (u > 0.5 && hash(x, y + frame * 13, size) < (u - 0.5) * 1.5) continue; // la pointe se déchire
      const heat = (1 - dx) * (1.05 - u * 0.85) + (hash(x, y, frame + 7) - 0.5) * 0.18;
      b.set(x, y + 3, FIRE[heat > 0.72 ? 4 : heat > 0.52 ? 3 : heat > 0.34 ? 2 : heat > 0.16 ? 1 : 0]);
    }
  }
  // étincelles qui s'échappent au-dessus
  for (let i = 0; i < 1 + size; i++) b.set(2 + Math.floor(hash(i, frame, size + 3) * W), Math.floor(hash(frame, i, size + 9) * 4), FIRE[2 + (i & 1)]);
  outlineBuffer(b, 0.45);
  return Object.assign(b, { ox: (W >> 1) + 2, oy: H + 3 });
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
