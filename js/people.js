// Villageois et chevaliers : petits squelettes en capsules, comme Brainless, cuits en
// frames x 8 directions. Un humain fait ~27 px de haut (Brainless ~40 px).
import { renderModel, ramp, rotZ, add, ik, hash, makeBuffer } from './raster.js';
import { dirFacing } from './nomu.js';

const SKIN_A = ramp('#7a4632', '#b5714f', '#e0a27a', '#f6c9a0');
const SKIN_B = ramp('#4a2a1c', '#7a4a30', '#a56a45', '#c98b5e');
const HAIR_BROWN = ramp('#24140c', '#3e2414', '#5e3a20', '#80522e');
const HAIR_BLOND = ramp('#7a5a1c', '#b08a30', '#d8b44e', '#f0d77a');
const HAIR_GREY = ramp('#5a5a62', '#8a8a92', '#b8b8c0', '#e2e2e8');
const HAIR_RED = ramp('#5a1e0e', '#8a3418', '#b4522a', '#d8763e');
const GREEN = ramp('#22361c', '#3b5a2c', '#567d3a', '#7aa452');
const BROWN = ramp('#2e1c10', '#4e3220', '#6e4a2e', '#8e6440');
const STRAW = ramp('#6e5420', '#a3812f', '#cfa94a', '#ead37a');
const RED = ramp('#4a1018', '#7d1f2a', '#a83240', '#d0545c');
const CREAM = ramp('#8f8470', '#c2b8a0', '#e6dcc4', '#fbf4e2');
const BLUE = ramp('#1a2a4a', '#2a4474', '#3d62a0', '#5d88c8');
const TEAL = ramp('#163a3a', '#245858', '#357a74', '#52a094');
const PURPLE = ramp('#2e1a3e', '#4a2c62', '#6a4488', '#8f66ae');
const STEEL = ramp('#353b48', '#626b7c', '#9aa3b4', '#dfe5ee');
const GOLD = ramp('#6b4a10', '#b0851e', '#e0b23a', '#ffe07a');
const SHOE = ramp('#1a100a', '#2e1c10', '#4a2e1a', '#6b4426');
const WOODC = ramp('#3d2614', '#5e3d22', '#86593a', '#a87a52');
const PLUME = ramp('#5e0c18', '#9c1628', '#d22838', '#ff5a5e');
const EYE = [24, 16, 14];
const BLOOD = ramp('#3e060c', '#6e0e18', '#a01824', '#d02c36');

// Les habitants. `voice` = hauteur du cri (Hz).
export const PEOPLE = {
  farmer: { kind: 'civ', skin: SKIN_A, hair: HAIR_BROWN, top: GREEN, legs: BROWN, hat: 'straw', voice: 230 },
  woman: { kind: 'civ', skin: SKIN_A, hair: HAIR_BLOND, top: RED, legs: BROWN, dress: RED, apron: CREAM, scarf: CREAM, scale: 0.95, voice: 430 },
  child: { kind: 'civ', skin: SKIN_A, hair: HAIR_RED, top: BLUE, legs: BROWN, scale: 0.68, head: 3.7, voice: 640 },
  elder: { kind: 'civ', skin: SKIN_B, hair: HAIR_GREY, top: PURPLE, legs: PURPLE, dress: PURPLE, beard: HAIR_GREY, cane: true, scale: 0.94, bent: 1.6, voice: 180 },
  merchant: { kind: 'civ', skin: SKIN_B, hair: HAIR_BROWN, top: TEAL, legs: BROWN, apron: CREAM, beret: RED, beard: HAIR_BROWN, voice: 290 },
  knight: { kind: 'knight', skin: SKIN_A, hair: HAIR_BROWN, top: BLUE, legs: STEEL, scale: 1.05, voice: 200 },
};
export const CIVILIANS = ['farmer', 'woman', 'child', 'elder', 'merchant'];

export const PEOPLE_ANIMS = {
  civ: {
    idle: { frames: 4, fps: 4 }, walk: { frames: 6, fps: 9 }, flee: { frames: 6, fps: 13 },
    wave: { frames: 4, fps: 7 }, ko: { frames: 1, fps: 1 }, dead: { frames: 1, fps: 1 }, crushed: { frames: 1, fps: 1 },
  },
  knight: {
    idle: { frames: 4, fps: 4 }, walk: { frames: 6, fps: 9 }, run: { frames: 6, fps: 12 },
    attack: { frames: 6, fps: 12 }, hurt: { frames: 2, fps: 8 }, ko: { frames: 1, fps: 1 },
    dead: { frames: 1, fps: 1 }, crushed: { frames: 1, fps: 1 },
  },
};

export const PEOPLE_W = 48, PEOPLE_H = 54, PEOPLE_OX = 24, PEOPLE_OY = 45;
const TAU = Math.PI * 2;

function basePose() {
  return {
    fL: [-1.9, 0, 0], fR: [1.9, 0, 0], hL: [-4.4, 0.3, 8.6], hR: [4.4, 0.3, 8.6],
    bob: 0, lean: 0, twist: 0, fall: 0, sword: [0.15, 0.55, 0.82],
  };
}

const lerp = (a, b, u) => a + (b - a) * u;
function keyed(keys, t) {
  const full = keys.map(k => ({ t: k.t, p: Object.assign(basePose(), k.p) }));
  for (let i = 0; i < full.length - 1; i++) {
    if (t <= full[i + 1].t) {
      let u = (t - full[i].t) / (full[i + 1].t - full[i].t);
      u = Math.max(0, Math.min(1, u));
      u = u * u * (3 - 2 * u);
      const a = full[i].p, b = full[i + 1].p, out = {};
      for (const k in a) out[k] = Array.isArray(a[k]) ? a[k].map((v, j) => lerp(v, b[k][j], u)) : lerp(a[k], b[k], u);
      return out;
    }
  }
  return full[full.length - 1].p;
}

export function personPose(kind, anim, t) {
  const p = basePose();
  const ph = t * TAU, s = Math.sin(ph), c = Math.cos(ph);
  const knight = kind === 'knight';
  const guard = () => { p.hR = [3.8, 3, 9.5]; p.hL = [-3.4, 3.4, 11]; };
  if (anim === 'idle') {
    p.bob = s * 0.25;
    p.hL = [-4.4, 0.3, 8.6 + s * 0.25]; p.hR = [4.4, 0.3, 8.6 + s * 0.25];
    if (knight) guard();
  } else if (anim === 'walk' || anim === 'run' || anim === 'flee') {
    const run = anim !== 'walk', st = run ? 4.2 : 3, lift = run ? 2.2 : 1.3;
    p.fL = [-1.9, s * st, Math.max(0, c) * lift];
    p.fR = [1.9, -s * st, Math.max(0, -c) * lift];
    p.hL = [-4.2, -s * 2.4, 8.8]; p.hR = [4.2, s * 2.4, 8.8];
    p.bob = (1 - Math.abs(s)) * (run ? 1 : 0.6) - 0.3;
    p.twist = s * 0.12;
    p.lean = run ? 1.6 : 0.4;
    if (anim === 'flee') {
      // il court en agitant les bras au-dessus de la tête
      p.hL = [-4.8 - c * 0.8, 1 + s, 20.5 + s * 1.5];
      p.hR = [4.8 + c * 0.8, 1 - s, 20.5 - s * 1.5];
    }
    if (knight) { guard(); p.hR[2] += s * 0.4; p.sword = [0.2, 0.75, 0.62]; }
  } else if (anim === 'wave') {
    p.hR = [5 + Math.sin(ph) * 1.6, 1.2, 21.5];
    p.twist = 0.1 + s * 0.05;
    p.bob = Math.abs(s) * 0.3;
  } else if (anim === 'ko' || anim === 'dead' || anim === 'crushed') {
    p.fall = 1;
    p.blood = anim !== 'ko' ? 1 : 0;
    p.hL = [-6.5, 1.5, 11]; p.hR = [6.5, 0, 12];
    p.fL = [-2.6, 0, 0]; p.fR = [2.4, 1, 0];
    p.sword = [0.9, 0.2, 0.3];
  } else if (anim === 'attack') {
    const g = { hR: [3.8, 3, 9.5], hL: [-3.4, 3.4, 11], sword: [0.15, 0.55, 0.82] };
    return keyed([
      { t: 0, p: g },
      { t: 0.35, p: { hR: [2.5, -1, 21.5], hL: [-3.6, 2.6, 12], sword: [0, -0.55, 0.84], twist: -0.3, lean: -0.4, fR: [1.9, -1.5, 0] } },
      { t: 0.55, p: { hR: [1.5, 6.5, 11], hL: [-4, 1.5, 10], sword: [0, 0.85, -0.5], twist: 0.35, lean: 1.6, fL: [-1.9, 2.5, 0], fR: [1.9, -2, 0] } },
      { t: 0.75, p: { hR: [2, 6, 10], hL: [-4, 1.5, 10], sword: [0.2, 0.8, -0.55], twist: 0.3, lean: 1.4, fL: [-1.9, 2.5, 0], fR: [1.9, -2, 0] } },
      { t: 1, p: g },
    ], t);
  } else if (anim === 'hurt') {
    p.lean = -1.6; p.bob = -0.4;
    p.hR = [5, -0.5, 14]; p.hL = [-4.6, 1, 13];
    p.sword = [0.6, 0, 0.8];
    p.fL = [-2.2, 1.5, 0]; p.fR = [2.2, -1, 0];
  }
  return p;
}

export function personParts(type, P) {
  const D = PEOPLE[type];
  const knight = D.kind === 'knight';
  const parts = [];
  const hipZ = 11 + P.bob;
  const bent = D.bent || 0;
  const lean = P.lean + bent;
  // haut du corps : torsion autour de l'axe vertical, penché vers l'avant au-dessus des hanches
  const U = (p) => { const r = rotZ(p, P.twist); return [r[0], r[1] + lean * Math.max(0, r[2] - 11) / 9, r[2] + P.bob]; };
  const hip = [0, 0, hipZ];
  const limb = knight ? STEEL : D.legs;

  // jambes et chaussures
  for (const side of [-1, 1]) {
    const f = side < 0 ? P.fL : P.fR, g = side < 0 ? 8 : 9;
    const hj = [side * 1.9, 0, hipZ];
    const ankle = [f[0], f[1], 1.2 + f[2]];
    const knee = ik(hj, ankle, 5.4, 5.2, [0, 1, 0.1]);
    parts.push({ a: hj, b: knee, r1: 1.75, r2: 1.5, ramp: limb, group: g });
    parts.push({ a: knee, b: ankle, r1: 1.45, r2: 1.25, ramp: limb, group: g,
      tex: knight ? (p) => (p.t < 0.15 ? Math.min(3, p.shade + 1) : p.shade) : undefined });
    parts.push({ a: ankle, b: add(ankle, [0, 2, -0.3]), r1: 1.15, r2: 1, ramp: knight ? STEEL : SHOE, group: g });
  }
  // bassin + buste
  parts.push({ a: hip, r1: 2.7, ramp: D.dress || (knight ? D.top : D.legs), group: 1 });
  const front = (p, k) => p.nx * p.fc[0] + p.ny * p.fc[1] + p.nz * p.fc[2] > k;
  const topTex = (p) => {
    if (D.apron && front(p, 0.45) && Math.abs(p.ex) < p.r * 0.5) return D.apron[Math.min(3, p.shade + 1)];
    if (knight && front(p, 0.4)) {
      // croix dorée sur le tabard
      if (Math.abs(p.ex) < p.r * 0.2 || Math.abs(p.t - 0.55) < 0.1) return GOLD[Math.min(3, p.shade + 1)];
    }
    if (Math.abs(p.t - 0.05) < 0.08) return (knight ? GOLD : BROWN)[Math.max(1, p.shade)]; // ceinture
    return p.shade;
  };
  parts.push({ a: U([0, 0, 11]), b: U([0, 0, 17.6]), r1: 3, r2: 3.5, ramp: D.top, group: 1, tex: topTex });
  if (D.dress) {
    // robe : un cône du bassin jusqu'au sol
    parts.push({ a: U([0, 0, 12.5]), b: [0, 0.3 + lean * 0.3, 1.6], r1: 3, r2: 4.4, ramp: D.dress, group: 1,
      tex: (p) => (D.apron && front(p, 0.45) && Math.abs(p.ex) < p.r * 0.45 && p.t < 0.85 ? D.apron[Math.min(3, p.shade + 1)] : p.shade) });
  }
  if (knight) {
    for (const side of [-1, 1]) parts.push({ a: U([side * 3.6, -0.2, 17.6]), r1: 2, ramp: STEEL, group: 2 + (side > 0 ? 1 : 0) }); // épaulières
  }

  // bras
  const hands = {};
  for (const side of [-1, 1]) {
    const h = U(side < 0 ? P.hL : P.hR), g = side < 0 ? 6 : 7;
    const sh = U([side * 3.5, 0, 17.2]);
    const el = ik(sh, h, 4.3, 4.3, [side * 0.5, -0.6, -0.4]);
    parts.push({ a: sh, b: el, r1: 1.35, r2: 1.2, ramp: knight ? STEEL : D.top, group: g });
    parts.push({ a: el, b: h, r1: 1.2, r2: 1.05, ramp: knight ? STEEL : D.top, group: g,
      tex: knight ? undefined : (p) => (p.t > 0.8 ? D.top[Math.max(0, p.shade - 1)] : p.shade) });
    parts.push({ a: h, r1: 1.25, ramp: knight ? STEEL : D.skin, group: g });
    hands[side] = h;
  }
  if (D.cane) {
    const h = hands[1];
    parts.push({ a: h, b: [h[0] + 0.6, h[1] + 1.4, 0], r1: 0.5, ramp: WOODC, group: 11 });
  }
  if (knight) {
    // épée dans la main droite, bouclier au bras gauche
    const h = hands[1], d = P.sword, dl = Math.hypot(...d);
    const dir = d.map(v => v / dl);
    const at = (k) => add(h, dir.map(v => v * k));
    const perp = [dir[1], -dir[0], 0];
    parts.push({ a: at(-1.2), b: at(1), r1: 0.5, ramp: SHOE, group: 12 });
    parts.push({ a: add(at(1.1), perp.map(v => v * 1.7)), b: add(at(1.1), perp.map(v => v * -1.7)), r1: 0.5, ramp: GOLD, group: 12 });
    parts.push({ a: at(1.8), b: at(10.5), r1: 0.62, r2: 0.35, ramp: STEEL, group: 12,
      tex: (p) => (Math.abs(p.ex) < 0.3 ? 3 : p.shade) });
    const sl = add(hands[-1], [-1.3, 0.9, 0]);
    parts.push({ a: add(sl, [0, 0, 2.7]), b: add(sl, [0, 0.3, -2.4]), r1: 2.9, r2: 1.6, ramp: BLUE, group: 13,
      tex: (p) => {
        const d2 = Math.hypot(p.ex, p.ey) / p.r;
        if (d2 > 0.74) return GOLD[Math.min(3, p.shade)];
        if (d2 < 0.22 && front(p, 0.2)) return GOLD[3];
        return p.shade;
      } });
  }

  // tête
  const hr = D.head || 3.1;
  const head = U([0, 0.3, 17.6 + hr * 1.25]);
  if (knight) {
    parts.push({ a: head, r1: hr + 0.3, ramp: STEEL, group: 4, tex: (p) => {
      const hs = -p.ny * 0.866 + p.nz * 0.5;
      if (front(p, 0.3) && Math.abs(hs - 0.08) < 0.13) return [14, 12, 16]; // fente du heaume
      if (front(p, 0.5) && Math.abs(p.ex) < p.r * 0.12 && hs < 0.05) return Math.max(0, p.shade - 1);
      return p.shade;
    } });
    parts.push({ a: add(head, rotZ([0, -0.6, 3.2], P.twist)), b: add(head, rotZ([0, -3.8, 5.4], P.twist)), r1: 1.3, r2: 0.6, ramp: PLUME, group: 5 });
  } else {
    const hairR = D.scarf || D.hair;
    parts.push({ a: head, r1: hr, ramp: D.skin, group: 4, tex: (p) => {
      const hs = -p.ny * 0.866 + p.nz * 0.5; // hauteur du point sur la tête
      if (hs > (D.scarf ? 0.58 : 0.66) || !front(p, D.scarf ? 0.3 : 0.15)) return hairR[p.shade];
      return p.shade;
    } });
    for (const side of [-1, 1]) {
      parts.push({ a: add(head, rotZ([side * hr * 0.36, hr * 0.85, -0.1], P.twist)), r1: 0.55, ramp: [EYE, EYE, EYE, EYE], group: 5 });
    }
    if (D.beard) {
      parts.push({ a: add(head, rotZ([0, hr * 0.6, -hr * 0.55], P.twist)), r1: hr * 0.62, ramp: D.beard, group: 5,
        tex: (p) => (front(p, -0.1) ? p.shade : null) });
    }
    if (D.hat === 'straw') {
      // chapeau de paille : un disque de petites sphères + la calotte
      const top = add(head, [0, 0, hr * 0.75]);
      for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) {
        if (i * i + j * j > 5) continue;
        parts.push({ a: add(top, rotZ([i * 1.45, j * 1.45, 0], P.twist)), r1: 1.25, ramp: STRAW, group: 10,
          tex: (p) => (p.ny < -0.2 ? 3 : 2) });
      }
      parts.push({ a: add(top, [0, 0, 1.2]), r1: 2.3, ramp: STRAW, group: 10, tex: (p) => (Math.abs(p.ny) < 0.18 ? RED[2] : p.shade) });
    }
    if (D.beret) parts.push({ a: add(head, rotZ([0, -0.7, hr * 0.95], P.twist)), r1: hr * 0.68, ramp: D.beret, group: 10 });
  }

  // mort : du sang sur les vêtements et la peau
  if (P.blood) {
    for (const part of parts) {
      const t0 = part.tex;
      part.tex = (p) => {
        const r = t0 ? t0(p) : p.shade;
        if (r === null) return null;
        return hash(p.x >> 1, p.y, 77) < 0.3 ? BLOOD[Math.min(3, Math.max(1, p.shade))] : r;
      };
    }
  }
  // KO : tout le corps bascule sur le dos
  if (P.fall) {
    const th = P.fall * Math.PI / 2, cs = Math.cos(th), sn = Math.sin(th);
    const tr = (p) => [p[0], p[1] * cs - p[2] * sn + 11 * P.fall, p[1] * sn + p[2] * cs + 2.4 * P.fall];
    for (const part of parts) { part.a = tr(part.a); if (part.b) part.b = tr(part.b); }
  }
  return parts;
}

export function renderPerson(type, anim, t, dir) {
  const D = PEOPLE[type];
  const buf = renderModel(personParts(type, personPose(D.kind, anim, t)), {
    w: PEOPLE_W, h: PEOPLE_H, ox: PEOPLE_OX, oy: PEOPLE_OY,
    facing: dirFacing(dir), scale: D.scale || 1,
  });
  return anim === 'crushed' ? squash(buf, dir) : buf;
}

// Écrasé par la frappe au sol : le corps est aplati contre le sol et élargi, éclaboussé de sang.
function squash(src, seed) {
  const { w, h, ox, oy } = src;
  const out = makeBuffer(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const sx = Math.round(ox + (x - ox) / 1.25), sy = Math.round(oy + (y - oy) / 0.42);
    if (sx < 0 || sy < 0 || sx >= w || sy >= h) continue;
    const o = (sy * w + sx) * 4;
    if (src.data[o + 3]) out.set(x, y, [src.data[o], src.data[o + 1], src.data[o + 2]]);
  }
  for (let i = 0; i < 26; i++) {
    const a = hash(i, seed, 3) * Math.PI * 2, r = 6 + hash(i, seed, 4) * 9;
    const x = Math.round(ox + Math.cos(a) * r), y = Math.round(oy + Math.sin(a) * r * 0.45);
    if (!out.get(x, y)) out.set(x, y, BLOOD[1 + (i % 3)]);
  }
  return Object.assign(out, { ox, oy });
}
