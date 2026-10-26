// BRAINLESS (le Nomu de l'USJ, saison 1) : modèle squelettique + animations.
// Chaque frame est calculée à partir d'une pose puis rendue en pixel art.
import { renderModel, ramp, rotZ, add, ik, hash } from './raster.js';

const SKIN = ramp('#08090e', '#161925', '#272c3f', '#3f4864');
const BRAIN = ramp('#6a2140', '#a33c5e', '#d8678a', '#f6a6bd');
const PANTS = ramp('#1d1914', '#352e26', '#4f4535', '#6a5e49');
const TEETH = ramp('#77746a', '#bbb6a4', '#e9e4d2', '#fffdf2');
const EYE = ramp('#7c6a1c', '#c9b44a', '#eee298', '#fffbe0');
const MOUTH = [22, 6, 12];
const PUPIL = [6, 4, 4];

export const SPRITE_W = 64, SPRITE_H = 68, ORIGIN_X = 32, ORIGIN_Y = 62;
export const SCALE = 0.8;

export const ANIMS = {
  idle: { frames: 6, fps: 6, loop: true },
  walk: { frames: 8, fps: 11, loop: true },
  run: { frames: 8, fps: 15, loop: true },
  punch: { frames: 8, fps: 18, loop: false },
  smash: { frames: 12, fps: 15, loop: false },
};

const smooth = (u) => u * u * (3 - 2 * u);
const lerp = (a, b, u) => a + (b - a) * u;
const lerpV = (a, b, u) => [lerp(a[0], b[0], u), lerp(a[1], b[1], u), lerp(a[2], b[2], u)];

function basePose() {
  return {
    fL: [-4.5, 0, 0], fR: [4.5, 0, 0],
    hL: [-14, 2.5, 16], hR: [14, 2.5, 16],
    bob: 0, lean: 0, twist: 0, crouch: 0, lift: 0, breathe: 0, jaw: 0, nod: 0,
  };
}

function blend(a, b, u) {
  const out = {};
  for (const k in a) out[k] = Array.isArray(a[k]) ? lerpV(a[k], b[k], u) : lerp(a[k], b[k], u);
  return out;
}

// Interpole une liste de clés [{t, pose}] (poses partielles complétées par la pose de base).
function keyed(keys, t) {
  const full = keys.map(k => ({ t: k.t, p: Object.assign(basePose(), k.p) }));
  for (let i = 0; i < full.length - 1; i++) {
    if (t <= full[i + 1].t) {
      const u = (t - full[i].t) / (full[i + 1].t - full[i].t);
      return blend(full[i].p, full[i + 1].p, smooth(Math.max(0, Math.min(1, u))));
    }
  }
  return full[full.length - 1].p;
}

export function poseFor(anim, t) {
  const TAU = Math.PI * 2;
  if (anim === 'idle') {
    const s = Math.sin(t * TAU);
    const p = basePose();
    p.breathe = s;
    p.bob = s * 0.5;
    p.hL = [-14, 2.5 + s * 0.6, 16 + s * 0.5];
    p.hR = [14, 2.5 - s * 0.6, 16 + s * 0.5];
    p.nod = Math.sin(t * TAU + 1) * 0.5;
    return p;
  }
  if (anim === 'walk' || anim === 'run') {
    const run = anim === 'run';
    const ph = t * TAU, s = Math.sin(ph), c = Math.cos(ph);
    const stride = run ? 7.5 : 5;
    const lift = run ? 4.5 : 2.5;
    const swing = run ? 7 : 4.5;
    const p = basePose();
    p.fL = [-4.5, s * stride, Math.max(0, c) * lift];
    p.fR = [4.5, -s * stride, Math.max(0, -c) * lift];
    p.hL = [-14, 2.5 - s * swing, 16 + Math.max(0, -s) * (run ? 4 : 2)];
    p.hR = [14, 2.5 + s * swing, 16 + Math.max(0, s) * (run ? 4 : 2)];
    p.bob = (1 - Math.abs(s)) * (run ? 1.6 : 1) - 0.6;
    p.twist = s * (run ? 0.16 : 0.1);
    p.lean = run ? 3.5 : 1;
    p.nod = c * 0.5;
    p.jaw = run ? 0.6 : 0;
    return p;
  }
  if (anim === 'punch') {
    return keyed([
      { t: 0, p: {} },
      { t: 0.28, p: { hR: [13, -9, 27], hL: [-10, 8, 24], twist: -0.45, lean: 1, crouch: 1.5, jaw: 0.5 } },
      { t: 0.42, p: { hR: [3, 21, 31], hL: [-13, -3, 19], twist: 0.5, lean: 4, fL: [-4.5, 4, 0], fR: [4.5, -3, 0], jaw: 1 } },
      { t: 0.62, p: { hR: [3, 20, 30], hL: [-13, -3, 19], twist: 0.45, lean: 4, fL: [-4.5, 4, 0], fR: [4.5, -3, 0], jaw: 1 } },
      { t: 1, p: {} },
    ], t);
  }
  if (anim === 'smash') {
    return keyed([
      { t: 0, p: {} },
      { t: 0.12, p: { crouch: 4, lean: 2, hL: [-13, 4, 14], hR: [13, 4, 14] } },
      { t: 0.32, p: { hL: [-7, 3, 54], hR: [7, 3, 54], lift: 8, lean: -1.5, jaw: 1, fL: [-4.5, -1, 1], fR: [4.5, 1, 1] } },
      { t: 0.48, p: { hL: [-6, 15, 7], hR: [6, 15, 7], crouch: 5, lean: 7, jaw: 1, fL: [-6, 0, 0], fR: [6, 0, 0] } },
      { t: 0.75, p: { hL: [-6, 15, 7], hR: [6, 15, 7], crouch: 5, lean: 7, jaw: 0.7, fL: [-6, 0, 0], fR: [6, 0, 0] } },
      { t: 1, p: {} },
    ], t);
  }
  return basePose();
}

export function nomuParts(P) {
  const tw = P.twist;
  const ub = [0, P.lean * 0.6, P.bob + P.lift - P.crouch * 0.8];
  const hip = [0, P.lean * 0.15, 20 - P.crouch + P.bob + P.lift];
  const U = (p) => add(rotZ(p, tw), ub); // point du haut du corps
  const parts = [];

  // --- jambes ---
  for (const side of [-1, 1]) {
    const f = side < 0 ? P.fL : P.fR;
    const g = side < 0 ? 8 : 9;
    const hipJ = add(hip, [side * 5, 0, 0]);
    const ankle = [f[0], f[1], 3 + f[2] + P.lift];
    const knee = ik(hipJ, ankle, 9.5, 9, [0, 1, 0.15]);
    const mid = lerpV(knee, ankle, 0.5);
    parts.push({ a: hipJ, b: knee, r1: 5, r2: 4.4, ramp: PANTS, group: g });
    parts.push({
      a: knee, b: mid, r1: 4.4, r2: 4.1, ramp: PANTS, group: g,
      tex: (p) => (p.t > 0.65 && hash(p.x, p.y, side) < 0.45 ? null : p.shade), // bas déchiré
    });
    parts.push({ a: mid, b: ankle, r1: 3.3, r2: 2.9, ramp: SKIN, group: g });
    parts.push({ a: ankle, b: add(ankle, [side * 0.5, 4.2, -1.8]), r1: 2.7, r2: 2.3, ramp: SKIN, group: g });
  }
  parts.push({ a: hip, r1: 7, ramp: PANTS, group: 10 });

  // --- torse massif ---
  parts.push({ a: add(hip, [0, 1.5, 3]), b: U([0, 0.5, 29]), r1: 7.6, r2: 8.6, ramp: SKIN, group: 1 });
  parts.push({ a: U([-7, -0.5, 32.5]), b: U([7, -0.5, 32.5]), r1: 7, ramp: SKIN, group: 1 });
  parts.push({ a: U([0, -3, 36.5 + P.breathe * 0.3]), r1: 7.5, ramp: SKIN, group: 1 });
  parts.push({ a: U([-4.7, 4.3, 30.5 + P.breathe * 0.3]), r1: 5.3, ramp: SKIN, group: 11 });
  parts.push({ a: U([4.7, 4.3, 30.5 + P.breathe * 0.3]), r1: 5.3, ramp: SKIN, group: 12 });
  // abdos
  parts.push({ a: add(hip, [-2.2, 5.6, 6.5]), b: add(lerpV(hip, U([0, 0, 29]), 0.62), [-2.2, 5.2, 0]), r1: 2.6, ramp: SKIN, group: 13 });
  parts.push({ a: add(hip, [2.2, 5.6, 6.5]), b: add(lerpV(hip, U([0, 0, 29]), 0.62), [2.2, 5.2, 0]), r1: 2.6, ramp: SKIN, group: 13 });

  // --- bras ---
  for (const side of [-1, 1]) {
    const hand = add(side < 0 ? P.hL : P.hR, ub);
    const g = side < 0 ? 6 : 7;
    const sh = U([side * 11, -1, 35 + P.breathe * 0.4]);
    const elbow = ik(sh, hand, 11, 10.5, [side * 0.7, -0.7, -0.2]);
    parts.push({ a: sh, r1: 5.7, ramp: SKIN, group: g });
    parts.push({ a: sh, b: elbow, r1: 5, r2: 4.3, ramp: SKIN, group: g });
    parts.push({ a: elbow, b: hand, r1: 4.5, r2: 3.7, ramp: SKIN, group: g });
    parts.push({ a: hand, r1: 4, ramp: SKIN, group: g });
  }

  // --- tête : petite, en avant, cerveau à l'air ---
  const head = add(U([0, 4.5, 38.5 + P.nod * 0.4]), [0, P.lean * 0.35, 0]);
  const H = (p) => add(head, rotZ(p, tw));
  parts.push({ a: head, r1: 4.7, ramp: SKIN, group: 2 });
  parts.push({ a: H([0, 3.3, -0.6]), r1: 3, ramp: SKIN, group: 2 }); // museau / bec
  parts.push({
    a: H([-2.5, 4.1, -2.5 - P.jaw * 0.6]), b: H([2.5, 4.1, -2.5 - P.jaw * 0.6]), r1: 2.2, ramp: TEETH, group: 5,
    tex: (p) => {
      if (p.ey > -0.6 && p.ey < 0.4 + P.jaw * 0.9) return MOUTH;
      return (p.x & 1) && p.shade > 1 ? p.shade - 1 : p.shade;
    },
  });
  for (const side of [-1, 1]) {
    parts.push({
      a: H([side * 3.2, 2.8, 1]), r1: 1.95, ramp: EYE, group: 4,
      tex: (p) => (p.nx * p.fc[0] + p.ny * p.fc[1] + p.nz * p.fc[2] > 0.82 ? PUPIL : p.shade),
    });
  }
  parts.push({
    a: H([0, -0.8, 4.3]), r1: 5.7, ramp: BRAIN, group: 3,
    tex: (p) => {
      const u = p.ex / p.r, v = p.ey / p.r;
      const fold = Math.sin(u * 8.5 + Math.sin(v * 7) * 1.6) * Math.cos(v * 6 - u * 2);
      if (Math.abs(fold) < 0.22) return Math.max(0, p.shade - 1);
      if (Math.abs(u) < 0.09 && v < 0.2) return 0; // scissure centrale
      return p.shade;
    },
  });
  return parts;
}

// 8 directions : k * 45° dans le plan caméra (k = 2 : face caméra).
export function dirFacing(k) {
  const a = k * Math.PI / 4;
  return [Math.cos(a), Math.sin(a)];
}

export function renderNomu(anim, t, dir, extra = {}) {
  return renderModel(nomuParts(poseFor(anim, t)), {
    w: extra.w || SPRITE_W, h: extra.h || SPRITE_H,
    ox: extra.ox ?? ORIGIN_X, oy: extra.oy ?? ORIGIN_Y,
    facing: dirFacing(dir), scale: extra.scale || SCALE,
  });
}
