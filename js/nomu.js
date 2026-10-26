// BRAINLESS (le Nomu de l'USJ, saison 1) : modèle squelettique + animations.
// Chaque frame est calculée à partir d'une pose puis rendue en pixel art.
// Debout quand il marche, à quatre pattes quand il sprinte.
import { renderModel, ramp, rotZ, add, ik, hash } from './raster.js';

const SKIN = ramp('#08090e', '#161925', '#272c3f', '#3f4864');
const BRAIN = ramp('#6a2140', '#a33c5e', '#d8678a', '#f6a6bd');
const PANTS = ramp('#1d1914', '#352e26', '#4f4535', '#6a5e49');
const TEETH = ramp('#77746a', '#bbb6a4', '#e9e4d2', '#fffdf2');
const EYE = ramp('#7c6a1c', '#c9b44a', '#eee298', '#fffbe0');
const BEAK = ramp('#7a5208', '#c98f12', '#f2c230', '#ffe680');
const BEAK_LOW = ramp('#5e3e06', '#a8760e', '#d9a924', '#f2cf5a');
const CLAW = ramp('#6b6355', '#a39a86', '#d8d0bc', '#f4efe2');
const MOUTH = [22, 6, 12];
const PUPIL = [6, 4, 4];

export const SPRITE_W = 64, SPRITE_H = 68, ORIGIN_X = 32, ORIGIN_Y = 62;
export const SCALE = 0.72;

export const ANIMS = {
  idle: { frames: 6, fps: 6, loop: true },
  walk: { frames: 8, fps: 11, loop: true },
  run: { frames: 10, fps: 17, loop: true }, // galop de bête à quatre pattes
  punch: { frames: 8, fps: 18, loop: false },
  charge: { frames: 8, fps: 10, loop: true }, // accroupi sur les coudes, il gonfle
  slam: { frames: 12, fps: 16, loop: false }, // se relève, bras en l'air, frappe le sol
  jump: { frames: 6, fps: 1, loop: false }, // piloté par la hauteur du saut
};

const smooth = (u) => u * u * (3 - 2 * u);
const lerp = (a, b, u) => a + (b - a) * u;
const lerpV = (a, b, u) => [lerp(a[0], b[0], u), lerp(a[1], b[1], u), lerp(a[2], b[2], u)];

function basePose() {
  return {
    fL: [-4, 0, 0], fR: [4, 0, 0],
    hL: [-11, 2.5, 16], hR: [11, 2.5, 16],
    bob: 0, lean: 0, twist: 0, crouch: 0, lift: 0, breathe: 0, jaw: 0, nod: 0,
    pitch: 0, headUp: 0, handsAbs: 0, elbowDown: 0, swell: 0, curl: 0,
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
    p.lean = 1;
    p.hL = [-11, 2.5 + s * 0.6, 16 + s * 0.5];
    p.hR = [11, 2.5 - s * 0.6, 16 + s * 0.5];
    p.nod = Math.sin(t * TAU + 1) * 0.5;
    return p;
  }
  if (anim === 'walk') {
    const ph = t * TAU, s = Math.sin(ph), c = Math.cos(ph);
    const p = basePose();
    p.fL = [-4, s * 5, Math.max(0, c) * 2.5];
    p.fR = [4, -s * 5, Math.max(0, -c) * 2.5];
    p.hL = [-11, 2.5 - s * 4.5, 16 + Math.max(0, -s) * 2];
    p.hR = [11, 2.5 + s * 4.5, 16 + Math.max(0, s) * 2];
    p.bob = (1 - Math.abs(s)) - 0.6;
    p.twist = s * 0.1;
    p.lean = 1.5;
    p.nod = c * 0.5;
    return p;
  }
  if (anim === 'run') {
    // Galop bondissant : il s'étire (bras projetés loin devant, pattes loin derrière)
    // puis se ramasse (dos voûté, pattes sous le ventre). Rotatif : gauche/droite décalés.
    const ph = t * TAU;
    const p = basePose();
    const reach = Math.sin(ph); // 1 = étiré, -1 = ramassé
    const fwd = Math.cos(ph); // > 0 : les bras partent vers l'avant
    const hand = (o) => [16 + Math.sin(ph + o) * 12, 2.6 + Math.max(0, Math.cos(ph + o)) * 8];
    const foot = (o) => [-6 - Math.sin(ph + o) * 9, Math.max(0, -Math.cos(ph + o)) * 6];
    const [hl, hlz] = hand(0), [hr, hrz] = hand(0.5);
    const [fl, flz] = foot(0.3), [fr, frz] = foot(0.75);
    p.handsAbs = 1;
    p.hL = [-6.5, hl, hlz];
    p.hR = [6.5, hr, hrz];
    p.fL = [-4, fl, flz];
    p.fR = [4, fr, frz];
    p.crouch = 6 + reach * 2;
    p.pitch = 1.18 + reach * 0.2;
    p.lift = Math.max(0, Math.sin(ph - 0.5)) * 3;
    p.bob = -reach * 1.5;
    p.headUp = 3 + fwd * 1.5;
    p.jaw = 1.2;
    p.twist = Math.sin(ph + 0.4) * 0.14;
    p.curl = 1; // griffes en avant
    return p;
  }
  if (anim === 'charge') {
    // Sur les coudes, tête basse, le corps gonfle et dégonfle.
    const s = Math.sin(t * TAU);
    const p = basePose();
    p.handsAbs = 1;
    p.elbowDown = 1;
    p.hL = [-7, 19, 2.4];
    p.hR = [7, 19, 2.4];
    p.fL = [-5, -9, 0];
    p.fR = [5, -9, 0];
    p.crouch = 9;
    p.pitch = 1.32;
    p.headUp = 1 + s * 0.6;
    p.breathe = s * 2;
    p.swell = 0.06 + s * 0.07;
    p.jaw = 0.6 + s * 0.4;
    p.twist = Math.sin(t * TAU * 2) * 0.03;
    return p;
  }
  if (anim === 'jump') {
    // t : 0 décollage, 0.5 sommet, 1 atterrissage
    return keyed([
      { t: 0, p: { crouch: 4, lean: 3, hL: [-10, -4, 12], hR: [10, -4, 12] } },
      { t: 0.25, p: { lean: 2, hL: [-8, 3, 44], hR: [8, 3, 44], fL: [-4, -3, 2], fR: [4, -5, 3], jaw: 1 } },
      { t: 0.55, p: { crouch: 3, lean: 4, hL: [-9, 8, 26], hR: [9, 8, 26], fL: [-4, 4, 7], fR: [4, 2, 6], jaw: 1 } },
      { t: 0.85, p: { lean: 3, hL: [-12, 6, 18], hR: [12, 6, 18], fL: [-4.5, 3, 1], fR: [4.5, -2, 1] } },
      { t: 1, p: { crouch: 4, lean: 3, hL: [-11, 8, 10], hR: [11, 8, 10] } },
    ], t);
  }
  if (anim === 'punch') {
    return keyed([
      { t: 0, p: {} },
      { t: 0.28, p: { hR: [10, -8, 27], hL: [-8, 8, 24], twist: -0.45, lean: 1, crouch: 1.5, jaw: 0.5 } },
      { t: 0.42, p: { hR: [2, 20, 31], hL: [-10, -3, 19], twist: 0.5, lean: 4, fL: [-4, 4, 0], fR: [4, -3, 0], jaw: 1 } },
      { t: 0.62, p: { hR: [2, 19, 30], hL: [-10, -3, 19], twist: 0.45, lean: 4, fL: [-4, 4, 0], fR: [4, -3, 0], jaw: 1 } },
      { t: 1, p: {} },
    ], t);
  }
  if (anim === 'slam') {
    const crouched = { handsAbs: 1, elbowDown: 1, hL: [-7, 19, 2.4], hR: [7, 19, 2.4], fL: [-5, -9, 0], fR: [5, -9, 0], crouch: 9, pitch: 1.32, headUp: 1, swell: 0.1 };
    return keyed([
      { t: 0, p: crouched },
      { t: 0.22, p: { hL: [-7, 2, 54], hR: [7, 2, 54], lift: 5, lean: -2, jaw: 1.4, swell: 0.12, fL: [-5, -1, 0], fR: [5, 1, 0], headUp: 2 } },
      { t: 0.32, p: { hL: [-7, 2, 55], hR: [7, 2, 55], lift: 6, lean: -2, jaw: 1.4, swell: 0.12, fL: [-5, -1, 1], fR: [5, 1, 1], headUp: 2 } },
      { t: 0.44, p: { handsAbs: 1, hL: [-6, 17, 2.5], hR: [6, 17, 2.5], crouch: 7, pitch: 0.9, jaw: 1.4, swell: 0.06, fL: [-6, -2, 0], fR: [6, -2, 0] } },
      { t: 0.75, p: { handsAbs: 1, hL: [-6, 17, 2.5], hR: [6, 17, 2.5], crouch: 7, pitch: 0.9, jaw: 0.8, fL: [-6, -2, 0], fR: [6, -2, 0] } },
      { t: 1, p: {} },
    ], t);
  }
  return basePose();
}

export function nomuParts(P) {
  const tw = P.twist;
  const ub = [0, P.lean * 0.6, P.bob + P.lift - P.crouch * 0.8];
  const hip = [0, P.lean * 0.15, 20 - P.crouch + P.bob + P.lift];
  // Bascule du buste vers l'avant autour du bassin (galop à quatre pattes).
  const cp = Math.cos(P.pitch), sp = Math.sin(P.pitch);
  const pitch = (p) => {
    const rf = p[1] - hip[1], rz = p[2] - hip[2];
    return [p[0], hip[1] + rf * cp + rz * sp, hip[2] - rf * sp + rz * cp];
  };
  const U = (p) => pitch(add(rotZ(p, tw), ub)); // point du haut du corps
  const parts = [];

  // --- jambes ---
  for (const side of [-1, 1]) {
    const f = side < 0 ? P.fL : P.fR;
    const g = side < 0 ? 8 : 9;
    const hipJ = add(hip, [side * 4, 0, 0]);
    const ankle = [f[0], f[1], 3 + f[2] + P.lift];
    const knee = ik(hipJ, ankle, 9.5, 9, [0, 1, 0.15]);
    const mid = lerpV(knee, ankle, 0.5);
    parts.push({ a: hipJ, b: knee, r1: 4, r2: 3.5, ramp: PANTS, group: g });
    parts.push({
      a: knee, b: mid, r1: 3.5, r2: 3.2, ramp: PANTS, group: g,
      tex: (p) => (p.t > 0.65 && hash(p.x, p.y, side) < 0.45 ? null : p.shade), // bas déchiré
    });
    parts.push({ a: mid, b: ankle, r1: 2.7, r2: 2.3, ramp: SKIN, group: g });
    parts.push({ a: ankle, b: add(ankle, [side * 0.5, 3.8, -1.8]), r1: 2.2, r2: 1.9, ramp: SKIN, group: g });
  }
  parts.push({ a: hip, r1: 5.6, ramp: PANTS, group: 10 });

  // --- torse sec et musclé ---
  const br = P.breathe * 0.3;
  parts.push({ a: pitch(add(hip, [0, 1.2, 3])), b: U([0, 0.5, 29]), r1: 5.8, r2: 6.8, ramp: SKIN, group: 1 });
  parts.push({ a: U([-5.5, -0.5, 32.5]), b: U([5.5, -0.5, 32.5]), r1: 5.5, ramp: SKIN, group: 1 });
  parts.push({ a: U([0, -2.5, 35.5 + br]), r1: 6, ramp: SKIN, group: 1 });
  parts.push({ a: U([-3.8, 3.4, 30.5 + br]), r1: 4.3, ramp: SKIN, group: 11 });
  parts.push({ a: U([3.8, 3.4, 30.5 + br]), r1: 4.3, ramp: SKIN, group: 12 });
  // abdos
  for (const x of [-1.8, 1.8]) {
    parts.push({ a: pitch(add(hip, [x, 4.6, 6.5])), b: U([x, 4.3, 25]), r1: 2.1, ramp: SKIN, group: 13 });
  }

  // --- bras longs ---
  for (const side of [-1, 1]) {
    const h = side < 0 ? P.hL : P.hR;
    const hand = P.handsAbs ? h : pitch(add(h, ub));
    const g = side < 0 ? 6 : 7;
    const sh = U([side * 8.6, -1, 34.5 + P.breathe * 0.4]);
    const ed = P.elbowDown;
    const elbow = ik(sh, hand, 11, 10.5, [side * (0.7 - ed * 0.3), -0.7 + ed * 0.5, -0.2 - ed * 1.2]);
    parts.push({ a: sh, r1: 4.6, ramp: SKIN, group: g });
    parts.push({ a: sh, b: elbow, r1: 4, r2: 3.4, ramp: SKIN, group: g });
    parts.push({ a: elbow, b: hand, r1: 3.6, r2: 3, ramp: SKIN, group: g });
    parts.push({ a: hand, r1: 3.2, ramp: SKIN, group: g });
    // doigts griffus : prolongent l'avant-bras, s'écartent et se recourbent
    let dx = hand[0] - elbow[0], dy = hand[1] - elbow[1], dz = hand[2] - elbow[2];
    const dl = Math.hypot(dx, dy, dz) || 1;
    dx /= dl; dy /= dl; dz /= dl;
    for (const k of [-1, 0, 1]) {
      const base = [hand[0] + dx * 2.2 + k * 1.4, hand[1] + dy * 2.2 + 0.6, hand[2] + dz * 2.2];
      const tip = [base[0] + dx * 2.4 + k * 0.7, base[1] + dy * 2.4 + 1.2 + P.curl * 1.2, base[2] + dz * 2.4 - P.curl * 0.6];
      parts.push({
        a: base, b: tip, r1: 1.15, r2: 0.6, ramp: SKIN, group: g,
        tex: (p) => (p.t > 0.55 ? CLAW[Math.min(3, p.shade + 1)] : p.shade),
      });
    }
  }

  // --- tête : cerveau à l'air, gros yeux, bec jaune plein de dents ---
  const head = add(U([0, 4, 38 + P.nod * 0.4]), [0, P.lean * 0.35, P.headUp]);
  const H = (p) => add(head, rotZ(p, tw));
  const jaw = P.jaw;
  parts.push({ a: head, r1: 4.2, ramp: SKIN, group: 2 });
  parts.push({ a: H([0, 2.4, -0.4]), b: H([0, 7.2, -1.4]), r1: 2.6, r2: 0.9, ramp: BEAK, group: 14 });
  parts.push({ a: H([0, 2.2, -2.6 - jaw]), b: H([0, 6, -2.9 - jaw * 1.4]), r1: 1.9, r2: 0.8, ramp: BEAK_LOW, group: 15 });
  parts.push({
    a: H([-1.7, 3.8, -1.9 - jaw * 0.5]), b: H([1.7, 3.8, -1.9 - jaw * 0.5]), r1: 1.25 + jaw * 0.3, ramp: TEETH, group: 5,
    tex: (p) => {
      if (Math.abs(p.ey) < 0.35 + jaw * 0.3) return MOUTH;
      return (p.x & 1) && p.shade > 1 ? p.shade - 1 : p.shade;
    },
  });
  for (const side of [-1, 1]) {
    parts.push({
      a: H([side * 2.9, 2.4, 1]), r1: 1.8, ramp: EYE, group: 4,
      tex: (p) => (p.nx * p.fc[0] + p.ny * p.fc[1] + p.nz * p.fc[2] > 0.82 ? PUPIL : p.shade),
    });
  }
  parts.push({
    a: H([0, -0.8, 4]), r1: 5.1, ramp: BRAIN, group: 3,
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
  const P = poseFor(anim, t);
  return renderModel(nomuParts(P), {
    w: extra.w || SPRITE_W, h: extra.h || SPRITE_H,
    ox: extra.ox ?? ORIGIN_X, oy: extra.oy ?? ORIGIN_Y,
    facing: dirFacing(dir), scale: (extra.scale || SCALE) * (1 + P.swell),
  });
}
