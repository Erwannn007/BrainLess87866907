// Faune sauvage : lapins, cerfs, sangliers, loups. Quadrupèdes en capsules (comme Brainless),
// cuits en frames x 8 directions. Brainless peut les chasser et les dévorer.
import { renderModel, ramp, ik, add, hash, makeBuffer } from './raster.js';
import { dirFacing } from './nomu.js';

const BLOOD = ramp('#3e060c', '#6e0e18', '#a01824', '#d02c36');
const WHITE = ramp('#9a948a', '#cfc8bc', '#ece6dc', '#ffffff');
const DARK = [20, 14, 12];

// Gameplay de chaque espèce. `flee` : distance à laquelle il détale (le double si Brainless sprinte).
export const BEASTS = {
  rabbit: {
    hp: 1, speed: 4.6, flee: 4.5, food: 10, evo: 0.3, biome: ['grass', 'meadow'],
    body: ramp('#4a3a2e', '#7a6250', '#a8907a', '#cdb8a0'), L: 4.6, H: 3.2, br: 2.2, rr: 2.6, head: [0, 3.2, 5.2], hr: 1.7,
    leg: 0.6, legLen: 3, ears: 'long', tail: 'puff', scale: 1.1,
  },
  deer: {
    hp: 2, speed: 5.4, flee: 6.5, food: 35, evo: 1, biome: ['grass', 'meadow', 'forest'],
    body: ramp('#5e3a1e', '#8f5a2e', '#b8804a', '#dca56a'), L: 9, H: 10, br: 3, rr: 3.2, head: [0, 7, 17], hr: 1.8,
    leg: 0.7, legLen: 9.5, ears: 'deer', tail: 'puff', antlers: true, neck: true, snout: 1.6, scale: 1,
  },
  boar: {
    hp: 4, speed: 4.3, flee: 0, food: 30, evo: 1, aggro: 2.6, dmg: 8, biome: ['forest'],
    body: ramp('#2a1c14', '#4a3222', '#6b4a32', '#8e6a4a'), L: 8, H: 5.6, br: 3.6, rr: 3.3, head: [0, 6, 5], hr: 2.4,
    leg: 1, legLen: 5, ears: 'small', tail: 'thin', tusks: true, snout: 2, bristles: true, scale: 1,
  },
  wolf: {
    hp: 3, speed: 4.6, flee: 0, food: 20, evo: 1, hunt: 12, dmg: 6, night: true, pack: true, biome: ['forest', 'snow', 'stone'],
    body: ramp('#34343c', '#5e5e68', '#8a8a94', '#b8b8c2'), L: 8, H: 7, br: 2.5, rr: 2.4, head: [0, 6.2, 10], hr: 1.9,
    leg: 0.75, legLen: 7, ears: 'pointy', tail: 'bushy', snout: 2.2, neck: true, scale: 1,
  },
};
export const BEAST_MEAL = Object.fromEntries(Object.entries(BEASTS).map(([k, b]) => [k, { food: b.food, evo: b.evo }]));

export const BEAST_ANIMS = {
  idle: { frames: 4, fps: 3 }, walk: { frames: 4, fps: 7 }, run: { frames: 6, fps: 12 },
  attack: { frames: 4, fps: 10 }, dead: { frames: 1, fps: 1 }, crushed: { frames: 1, fps: 1 },
};
export const BEAST_W = 56, BEAST_H = 56, BEAST_OX = 28, BEAST_OY = 44;

// Pose : position des 4 pattes (décalage avant/arrière et levée), tête, corps.
function pose(type, anim, t) {
  const ph = t * Math.PI * 2, s = Math.sin(ph), c = Math.cos(ph);
  const p = { legs: [[0, 0], [0, 0], [0, 0], [0, 0]], headDown: 0, bob: 0, lunge: 0, dead: anim === 'dead' || anim === 'crushed' };
  // ordre des pattes : avant gauche, avant droite, arrière gauche, arrière droite
  if (anim === 'idle') { p.headDown = type === 'wolf' ? 0 : 0.6 + 0.4 * Math.max(0, s); p.bob = s * 0.15; } // le loup ne broute pas
  else if (anim === 'walk') {
    const leg = (o) => [Math.sin(ph + o) * 1.6, Math.max(0, Math.cos(ph + o)) * 1];
    p.legs = [leg(0), leg(Math.PI), leg(Math.PI), leg(0)];
    p.bob = Math.abs(s) * 0.3;
  } else if (anim === 'run') {
    // galop bondissant : les pattes avant ensemble, puis les arrière
    const leg = (o) => [Math.sin(ph + o) * 3, Math.max(0, Math.cos(ph + o)) * 2.2];
    p.legs = [leg(0), leg(0.3), leg(Math.PI), leg(Math.PI + 0.3)];
    p.bob = Math.max(0, s) * 1.4;
  } else if (anim === 'attack') {
    p.lunge = Math.sin(t * Math.PI) * 3; p.headDown = 0.8 - Math.sin(t * Math.PI) * 1.2;
    p.legs = [[1.5, 0.5], [1.5, 0.5], [-1.5, 0], [-1.5, 0]];
  }
  return p;
}

export function beastParts(type, P) {
  const B = BEASTS[type], R = B.body;
  const parts = [];
  const H = B.H + P.bob, L = B.L, f0 = P.lunge;
  const rear = [0, -L / 2 + f0, H], front = [0, L / 2 + f0, H + (B.neck ? 0.5 : 0)];
  const ridge = B.bristles ? (p) => (p.ny < -0.5 && hash(p.x, p.y, 3) < 0.6 ? Math.max(0, p.shade - 1) : p.shade) : undefined;
  const belly = (p) => (p.ny > 0.55 && type !== 'boar' && type !== 'rabbit' ? WHITE[Math.min(3, p.shade + 1)] : ridge ? ridge(p) : p.shade);
  parts.push({ a: rear, b: front, r1: B.rr, r2: B.br, ramp: R, group: 1, tex: belly });
  // pattes : épaule/hanche -> pied, genou en cinématique inverse
  const joints = [[-B.br * 0.55, L / 2 - 0.6], [B.br * 0.55, L / 2 - 0.6], [-B.rr * 0.55, -L / 2 + 0.6], [B.rr * 0.55, -L / 2 + 0.6]];
  joints.forEach(([x, f], i) => {
    const [df, lift] = P.legs[i];
    const top = [x, f + f0, H - 1];
    const foot = [x, f + f0 + df, lift];
    const knee = ik(top, foot, B.legLen * 0.52 + 0.3, B.legLen * 0.52, [0, i < 2 ? -1 : 1, 0]);
    parts.push({ a: top, b: knee, r1: B.leg * 1.5, r2: B.leg, ramp: R, group: 2 + i });
    parts.push({ a: knee, b: foot, r1: B.leg, r2: B.leg * 0.8, ramp: R, group: 2 + i, tex: (p) => (p.t > 0.8 ? DARK : p.shade) });
  });
  // cou et tête
  const hd = P.headDown;
  const head = add(B.head, [0, f0 + hd * 1.2, -hd * (B.head[2] - 1.5) * 0.7]);
  if (B.neck) parts.push({ a: front, b: head, r1: B.br * 0.6, r2: B.hr * 0.75, ramp: R, group: 1 });
  parts.push({ a: head, r1: B.hr, ramp: R, group: 6, tex: (p) => (p.nz > 0.7 && Math.abs(p.ex) > p.r * 0.35 && Math.abs(p.ex) < p.r * 0.65 && p.ey < 0 ? DARK : p.shade) });
  if (B.snout) {
    const tip = add(head, [0, B.snout + B.hr * 0.6, -0.8]);
    parts.push({ a: head, b: tip, r1: B.hr * 0.7, r2: B.hr * 0.45, ramp: R, group: 6, tex: (p) => (p.t > 0.85 ? DARK : p.shade) });
    if (B.tusks) for (const sd of [-1, 1]) parts.push({ a: add(tip, [sd * 0.9, -0.5, -0.4]), b: add(tip, [sd * 1.4, 0, 0.9]), r1: 0.45, r2: 0.3, ramp: WHITE, group: 7 });
  }
  // oreilles
  for (const sd of [-1, 1]) {
    const base = add(head, [sd * B.hr * 0.5, -0.3, B.hr * 0.7]);
    if (B.ears === 'long') parts.push({ a: base, b: add(base, [sd * 0.3, -1, 2.4]), r1: 0.85, r2: 0.65, ramp: R, group: 8 });
    else if (B.ears === 'pointy') parts.push({ a: base, b: add(base, [sd * 0.3, -0.2, 1.8]), r1: 0.7, r2: 0.2, ramp: R, group: 8 });
    else if (B.ears === 'deer') parts.push({ a: base, b: add(base, [sd * 1.6, -0.5, 0.6]), r1: 0.55, r2: 0.35, ramp: R, group: 8 });
    else parts.push({ a: base, r1: 0.7, ramp: R, group: 8 });
  }
  if (B.antlers) {
    const A = ramp('#4a3420', '#7a5a38', '#a8865a', '#cdb080');
    for (const sd of [-1, 1]) {
      const b0 = add(head, [sd * 0.8, -0.4, B.hr * 0.8]), b1 = add(b0, [sd * 1.6, -0.6, 3.2]), b2 = add(b1, [sd * 0.6, -0.8, 2.2]);
      parts.push({ a: b0, b: b1, r1: 0.4, ramp: A, group: 9 });
      parts.push({ a: b1, b: b2, r1: 0.35, ramp: A, group: 9 });
      parts.push({ a: b1, b: add(b1, [sd * -0.6, 1, 1.6]), r1: 0.3, ramp: A, group: 9 });
    }
  }
  // queue
  const tb = add(rear, [0, -B.rr * 0.8, 0.6]);
  if (B.tail === 'puff') parts.push({ a: tb, r1: type === 'rabbit' ? 0.9 : 0.8, ramp: WHITE, group: 10 });
  else if (B.tail === 'thin') parts.push({ a: tb, b: add(tb, [0, -1.2, -1.4]), r1: 0.35, ramp: R, group: 10 });
  else parts.push({ a: tb, b: add(tb, [0, -2.8, -2.2]), r1: 1, r2: 0.6, ramp: R, group: 10, tex: (p) => (p.t > 0.75 ? WHITE[p.shade] : p.shade) });

  // un petit animal : pas de lignes internes entre ses parties (à cette taille, ça fait des traits parasites)
  if (B.scale && B.L < 6) for (const part of parts) part.group = 1;
  if (P.dead) {
    // couché sur le flanc, taché de sang
    for (const part of parts) {
      const t0 = part.tex;
      part.tex = (p) => { const r = t0 ? t0(p) : p.shade; return hash(p.x >> 1, p.y, 41) < 0.3 ? BLOOD[Math.min(3, Math.max(1, p.shade))] : r; };
    }
    const roll = (p) => [p[2] - H * 0.5, p[1], -p[0] + B.br];
    for (const part of parts) { part.a = roll(part.a); if (part.b) part.b = roll(part.b); }
  }
  return parts;
}

export function renderBeast(type, anim, t, dir) {
  const buf = renderModel(beastParts(type, pose(type, anim, t)), {
    w: BEAST_W, h: BEAST_H, ox: BEAST_OX, oy: BEAST_OY, facing: dirFacing(dir), scale: BEASTS[type].scale,
  });
  if (anim !== 'crushed') return buf;
  // écrasé : aplati et éclaboussé
  const out = makeBuffer(buf.w, buf.h);
  for (let y = 0; y < buf.h; y++) for (let x = 0; x < buf.w; x++) {
    const sx = Math.round(BEAST_OX + (x - BEAST_OX) / 1.2), sy = Math.round(BEAST_OY + (y - BEAST_OY) / 0.45);
    if (sx < 0 || sy < 0 || sx >= buf.w || sy >= buf.h) continue;
    const o = (sy * buf.w + sx) * 4;
    if (buf.data[o + 3]) out.set(x, y, [buf.data[o], buf.data[o + 1], buf.data[o + 2]]);
  }
  for (let i = 0; i < 18; i++) {
    const a = hash(i, dir, 3) * Math.PI * 2, r = 5 + hash(i, dir, 4) * 8;
    const x = Math.round(BEAST_OX + Math.cos(a) * r), y = Math.round(BEAST_OY + Math.sin(a) * r * 0.45);
    if (!out.get(x, y)) out.set(x, y, BLOOD[1 + (i % 3)]);
  }
  return Object.assign(out, { ox: BEAST_OX, oy: BEAST_OY });
}
