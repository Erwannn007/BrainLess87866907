// BRAINLESS (le Nomu de l'USJ, saison 1) : modèle squelettique + animations.
// Chaque frame est calculée à partir d'une pose puis rendue en pixel art.
// Debout quand il marche, à quatre pattes quand il sprinte.
import { renderModel, ramp, rotZ, add, ik, hash } from './raster.js';

const SKIN = ramp('#090a20', '#151848', '#22276b', '#343b8e');
const BRAIN = ramp('#5e2716', '#9a4a2c', '#c97249', '#e9a173');
const PANTS = ramp('#6e5124', '#a9853f', '#d4b062', '#efd08a');
const STRIPE = ramp('#4e0c18', '#9c1628', '#d22838', '#ff5a5e');
const BONE = ramp('#55575e', '#8d9097', '#c4c6cb', '#eceef0');
const GOLD = ramp('#6b4a10', '#b0851e', '#e0b23a', '#ffe07a');
const MOUTH_IN = [10, 8, 26];
const TEETH = ramp('#77746a', '#bbb6a4', '#e9e4d2', '#fffdf2');
const EYE = ramp('#7c6a1c', '#c9b44a', '#eee298', '#fffbe0');
const BEAK = ramp('#7a5208', '#c98f12', '#f2c230', '#ffe680');
const BEAK_LOW = ramp('#5e3e06', '#a8760e', '#d9a924', '#f2cf5a');
const CLAW = ramp('#3a3f78', '#585ea0', '#8086c4', '#aab0e0');
const MOUTH = [22, 6, 12];
const PUPIL = [6, 4, 4];

export const SPRITE_W = 64, SPRITE_H = 76, ORIGIN_X = 32, ORIGIN_Y = 62;
export const SCALE = 0.75;

export const ANIMS = {
  idle: { frames: 6, fps: 6, loop: true },
  walk: { frames: 8, fps: 11, loop: true },
  run: { frames: 10, fps: 17, loop: true }, // galop de bête à quatre pattes
  punch: { frames: 8, fps: 18, loop: false },
  charge: { frames: 8, fps: 10, loop: true }, // accroupi sur les coudes, il gonfle
  slam: { frames: 12, fps: 16, loop: false }, // se relève, bras en l'air, frappe le sol
  jump: { frames: 6, fps: 1, loop: false }, // piloté par la hauteur du saut
  skid: { frames: 4, fps: 20, loop: true }, // demi-tour en dérapage
  brake: { frames: 4, fps: 20, loop: true }, // freinage en fin de sprint
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
  if (anim === 'skid') {
    // Demi-tour violent : déjà tourné vers la nouvelle direction, il glisse à reculons,
    // ventre au ras du sol, mains écartées plantées, pattes en appui, ça tremble.
    const j = Math.sin(t * TAU), k = Math.cos(t * TAU * 2);
    const p = basePose();
    p.handsAbs = 1;
    p.hL = [-11, 11 + j * 0.8, 2.5];
    p.hR = [10, 14 - j * 0.8, 2.5];
    p.fL = [-7, -3, 0];
    p.fR = [7, -6, 0];
    p.crouch = 8 + k * 0.5;
    p.pitch = 1 + j * 0.05;
    p.headUp = 2;
    p.jaw = 1.3;
    p.twist = 0.25 + j * 0.05;
    p.curl = 1;
    p.bob = k * 0.5;
    return p;
  }
  if (anim === 'brake') {
    // Freinage : il se cabre en arrière, talons plantés devant, une main traîne au sol.
    const j = Math.sin(t * TAU), k = Math.cos(t * TAU * 2);
    const p = basePose();
    p.fL = [-5, 7 + j * 0.5, 0];
    p.fR = [5, 4 - j * 0.5, 0];
    p.crouch = 6 + k * 0.4;
    p.pitch = -0.32;
    p.lean = -1;
    p.handsAbs = 1;
    p.hL = [-11, -4, 2.6]; // traîne au sol
    p.hR = [12, 3, 13];
    p.headUp = 1;
    p.jaw = 1;
    p.bob = k * 0.4;
    p.twist = -0.12 + j * 0.04;
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

// Rayures rouges en travers d'un membre (positions le long de l'os).
const stripes = (...ts) => (p) => {
  for (const c of ts) if (Math.abs(p.t - c) < 0.09 && p.shade > 0 && p.nx > -0.6) return STRIPE[Math.min(3, p.shade)];
  return p.shade;
};
// Rayure en diagonale sur une boule (épaules, dos).
const slash = (off) => (p) => {
  const d = (p.ex * 0.6 + p.ey * 0.8) / p.r - off;
  if (Math.abs(d) < 0.16 && p.shade > 0) return STRIPE[Math.min(3, p.shade)];
  return p.shade;
};

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

  // --- jambes : pantalon beige aux genoux, bandes-crânes grises sur les tibias, grands pieds ---
  for (const side of [-1, 1]) {
    const f = side < 0 ? P.fL : P.fR;
    const g = side < 0 ? 8 : 9;
    const hipJ = add(hip, [side * 4.2, 0, 0]);
    const ankle = [f[0], f[1], 3 + f[2] + P.lift];
    const knee = ik(hipJ, ankle, 9.5, 9, [0, 1, 0.15]);
    parts.push({ a: hipJ, b: knee, r1: 4.5, r2: 4, ramp: PANTS, group: g,
      tex: (p) => (Math.abs(p.ex) < 0.5 && p.t < 0.5 && p.shade > 0 ? p.shade - 1 : p.shade) }); // couture
    parts.push({ a: knee, r1: 4, ramp: PANTS, group: g,
      tex: (p) => (p.ey > p.r * 0.45 && hash(p.x, p.y, side) < 0.5 ? null : p.shade) }); // revers déchiré
    parts.push({ a: knee, b: ankle, r1: 3.1, r2: 2.6, ramp: SKIN, group: g });
    const b0 = lerpV(knee, ankle, 0.22 + (side > 0 ? 0.18 : 0)), b1 = lerpV(knee, ankle, 0.45 + (side > 0 ? 0.18 : 0));
    parts.push({
      a: b0, b: b1, r1: 3.6, ramp: BONE, group: 16 + side,
      tex: (p) => {
        // petite tête de mort : deux orbites et un nez
        const u = p.ex / p.r, v = p.ey / p.r;
        if (p.nz > 0.45 && Math.abs(Math.abs(u) - 0.32) < 0.17 && Math.abs(v + 0.05) < 0.22) return [20, 20, 26];
        if (p.nz > 0.6 && Math.abs(u) < 0.08 && v > 0.25 && v < 0.5) return [40, 40, 48];
        return p.shade;
      },
    });
    const toe = add(ankle, [side * 0.6, 4.6, -2]);
    parts.push({ a: ankle, b: toe, r1: 2.9, r2: 2.5, ramp: SKIN, group: g });
    for (const k of [-1, 0, 1]) {
      parts.push({ a: add(toe, [k * 1.5, 0, 0]), b: add(toe, [k * 1.9, 2.4, -0.6]), r1: 1.05, r2: 0.8, ramp: SKIN, group: g });
    }
  }
  parts.push({ a: hip, r1: 5.9, ramp: PANTS, group: 10,
    tex: (p) => (p.ey < -p.r * 0.55 && p.shade > 0 ? p.shade - 1 : p.shade) }); // ceinture

  // --- torse : taille fine, épaules et trapèzes énormes, rayures rouges ---
  const br = P.breathe * 0.3;
  parts.push({ a: pitch(add(hip, [0, 1.2, 3])), b: U([0, 0.5, 29]), r1: 5.6, r2: 7.2, ramp: SKIN, group: 1 });
  parts.push({ a: U([-5.6, -0.5, 32.5]), b: U([5.6, -0.5, 32.5]), r1: 5.3, ramp: SKIN, group: 1 });
  parts.push({ a: U([0, -5, 32.5 + br]), r1: 5.6, ramp: SKIN, group: 1, tex: slash(0.35) }); // dos voûté, derrière le cerveau
  parts.push({ a: U([-4, 3.4, 30 + br]), r1: 4.6, ramp: SKIN, group: 11 });
  parts.push({ a: U([4, 3.4, 30 + br]), r1: 4.6, ramp: SKIN, group: 12 });
  for (const x of [-1.8, 1.8]) {
    parts.push({ a: pitch(add(hip, [x, 4.6, 6.5])), b: U([x, 4.3, 25]), r1: 2.1, ramp: SKIN, group: 13 });
  }

  // --- bras très longs, grandes mains à doigts griffus ---
  for (const side of [-1, 1]) {
    const h = side < 0 ? P.hL : P.hR;
    const hand = P.handsAbs ? h : pitch(add(h, ub));
    const g = side < 0 ? 6 : 7;
    const sh = U([side * 8.2, -1, 34.5 + P.breathe * 0.4]);
    const ed = P.elbowDown;
    const elbow = ik(sh, hand, 11, 10.5, [side * (0.7 - ed * 0.3), -0.7 + ed * 0.5, -0.2 - ed * 1.2]);
    parts.push({ a: U([side * 8.2, -1.2, 35]), r1: 4.6, ramp: SKIN, group: g, tex: side > 0 ? slash(0.3) : slash(-0.2) });
    parts.push({ a: sh, b: elbow, r1: 4.4, r2: 3.6, ramp: SKIN, group: g, tex: side < 0 ? stripes(0.6) : undefined });
    parts.push({ a: elbow, b: hand, r1: 3.9, r2: 3.2, ramp: SKIN, group: g, tex: stripes(side < 0 ? 0.35 : 0.25) });
    parts.push({ a: hand, r1: 3.7, ramp: SKIN, group: g });
    // longs doigts recourbés
    let dx = hand[0] - elbow[0], dy = hand[1] - elbow[1], dz = hand[2] - elbow[2];
    const dl = Math.hypot(dx, dy, dz) || 1;
    dx /= dl; dy /= dl; dz /= dl;
    for (const k of [-1.5, -0.5, 0.5, 1.5]) {
      const base = [hand[0] + dx * 2.4 + k * 1.1, hand[1] + dy * 2.4 + 0.8, hand[2] + dz * 2.4];
      const mid = [base[0] + dx * 2.2 + k * 0.4, base[1] + dy * 2.2 + 0.8, base[2] + dz * 2.2];
      const tip = [mid[0] + dx * 1.2, mid[1] + dy * 1.2 + 1 + P.curl * 1.2, mid[2] + dz * 1.2 - 1 - P.curl * 0.4];
      parts.push({ a: base, b: mid, r1: 1.2, r2: 1, ramp: SKIN, group: g });
      parts.push({ a: mid, b: tip, r1: 1, r2: 0.55, ramp: SKIN, group: g,
        tex: (p) => (p.t > 0.6 ? CLAW[Math.min(3, p.shade + 1)] : p.shade) });
    }
  }

  // --- tête enfoncée entre les épaules : gros cerveau, petits yeux, bec doré en V ---
  // à quatre pattes, la tête sort devant les épaules au lieu de rester enfoncée
  const head = add(U([0, 4 + P.pitch * 6, 38.5 + P.nod * 0.4]), [0, P.lean * 0.35, P.headUp + P.pitch * 3]);
  const H = (p) => add(head, rotZ(p, tw));
  const jaw = P.jaw;
  parts.push({ a: head, r1: 3.9, ramp: SKIN, group: 2 });
  // intérieur sombre du bec, qui s'ouvre avec la mâchoire
  parts.push({ a: H([0, 3, -0.8]), b: H([0, 4.4, -4.6 - jaw]), r1: 2 + jaw * 0.4, r2: 0.8, ramp: [MOUTH_IN, MOUTH_IN, MOUTH_IN, MOUTH_IN], group: 5,
    tex: (p) => (p.t > 0.15 && p.t < 0.6 && Math.abs(p.ex) > p.r * 0.55 && (p.y & 1) ? [230, 225, 210] : MOUTH_IN) });
  for (const side of [-1, 1]) {
    parts.push({ a: H([side * 2.9, 2.5, -0.2]), b: H([0, 4.9, -5.4 - jaw]), r1: 0.95, r2: 0.7, ramp: GOLD, group: 14 });
    parts.push({ a: H([side * 2.6, 2.3, 1.2]), r1: 1.25, ramp: EYE, group: 4,
      tex: (p) => (p.nx * p.fc[0] + p.ny * p.fc[1] + p.nz * p.fc[2] > 0.85 ? PUPIL : p.shade) });
  }
  parts.push({
    a: H([0, 0.4, 3.6]), r1: 5.2, ramp: BRAIN, group: 3,
    tex: (p) => {
      const u = p.ex / p.r, v = p.ey / p.r;
      const fold = Math.sin(u * 9 + Math.sin(v * 7) * 1.6) * Math.cos(v * 6.5 - u * 2);
      if (Math.abs(fold) < 0.24) return Math.max(0, p.shade - 1);
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
