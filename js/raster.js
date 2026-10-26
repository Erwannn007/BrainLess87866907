// Mini moteur "3D -> pixel art" : des capsules et des sphères sont projetées en
// isométrique, triées par z-buffer, ombrées en 4 tons tramés puis détourées.
// Ça permet d'animer un squelette et de cuire chaque frame en vrai sprite pixel.

export const SIN_A = 0.5, COS_A = 0.866; // caméra à 30° = projection 2:1
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map(v => v / 16 - 0.5);
const L = norm3(-0.55, -0.7, 0.5);

function norm3(x, y, z) { const l = Math.hypot(x, y, z); return [x / l, y / l, z / l]; }

export function hex(h) {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export const ramp = (...cols) => cols.map(hex);

export function hash(x, y, s = 0) {
  let h = Math.imul(x | 0, 73856093) ^ Math.imul(y | 0, 19349663) ^ Math.imul(s | 0, 83492791);
  h = Math.imul(h ^ (h >>> 15), 2246822507);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

// Rotation autour de l'axe vertical (torsion du buste).
export function rotZ(p, a) {
  const c = Math.cos(a), s = Math.sin(a);
  return [p[0] * c - p[1] * s, p[0] * s + p[1] * c, p[2]];
}

export function add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }

// Cinématique inverse à 2 os : le genou/coude plie dans la direction `bend`.
export function ik(root, end, l1, l2, bend) {
  let dx = end[0] - root[0], dy = end[1] - root[1], dz = end[2] - root[2];
  let d = Math.hypot(dx, dy, dz);
  const max = l1 + l2 - 0.01;
  if (d > max) { const k = max / d; dx *= k; dy *= k; dz *= k; d = max; }
  // bout collé à la racine : sans ça, le genou partirait à l'infini (division par ~0)
  const min = Math.abs(l1 - l2) + 0.05;
  if (d < min) {
    if (d < 1e-6) { dx = 0; dy = 0; dz = -1; d = 1; }
    const k = min / d; dx *= k; dy *= k; dz *= k; d = min;
  }
  const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  const ux = dx / d, uy = dy / d, uz = dz / d;
  // composante de bend perpendiculaire à l'axe
  const dot = bend[0] * ux + bend[1] * uy + bend[2] * uz;
  let px = bend[0] - dot * ux, py = bend[1] - dot * uy, pz = bend[2] - dot * uz;
  const pl = Math.hypot(px, py, pz) || 1;
  px /= pl; py /= pl; pz /= pl;
  return [root[0] + ux * a + px * h, root[1] + uy * a + py * h, root[2] + uz * a + pz * h];
}

/**
 * parts: [{ a:[x,f,z], b?:[x,f,z], r1, r2?, ramp, tex?, group? }]
 *   x = droite du modèle, f = avant, z = haut (unités = pixels avant `scale`)
 * opts: { w, h, ox, oy, facing:[cx, ct], scale }
 *   facing = direction du regard dans le plan caméra (cx = droite écran, ct = vers la caméra)
 */
export function renderModel(parts, opts) {
  const { w, h, ox, oy, scale = 1 } = opts;
  const [fx, ft] = opts.facing || [0, 1];
  const rx = -ft, rt = fx;
  const data = new Uint8ClampedArray(w * h * 4);
  const zbuf = new Float32Array(w * h).fill(-1e9);
  const gbuf = new Int16Array(w * h).fill(-1);
  const fc = norm3(fx, ft * SIN_A, ft * COS_A);

  const project = (p) => {
    const mx = p[0] * scale, mf = p[1] * scale, mz = p[2] * scale;
    const cx = mx * rx + mf * fx;
    const ct = mx * rt + mf * ft;
    return [ox + cx, oy - mz * COS_A + ct * SIN_A, ct * COS_A + mz * SIN_A];
  };

  for (let pi = 0; pi < parts.length; pi++) {
    const part = parts[pi];
    const A = project(part.a), B = part.b ? project(part.b) : A;
    const r1 = part.r1 * scale, r2 = (part.r2 ?? part.r1) * scale;
    const rm = Math.max(r1, r2);
    const x0 = Math.max(0, Math.floor(Math.min(A[0], B[0]) - rm));
    const x1 = Math.min(w - 1, Math.ceil(Math.max(A[0], B[0]) + rm));
    const y0 = Math.max(0, Math.floor(Math.min(A[1], B[1]) - rm));
    const y1 = Math.min(h - 1, Math.ceil(Math.max(A[1], B[1]) + rm));
    const dx = B[0] - A[0], dy = B[1] - A[1], len2 = dx * dx + dy * dy;
    const group = part.group ?? pi;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const px = x + 0.5, py = y + 0.5;
        let t = len2 > 0 ? ((px - A[0]) * dx + (py - A[1]) * dy) / len2 : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const ex = px - (A[0] + dx * t), ey = py - (A[1] + dy * t);
        const r = r1 + (r2 - r1) * t;
        const d2 = ex * ex + ey * ey;
        if (d2 > r * r) continue;
        const bulge = Math.sqrt(r * r - d2);
        const depth = A[2] + (B[2] - A[2]) * t + bulge;
        const idx = y * w + x;
        if (depth <= zbuf[idx]) continue;
        const nx = ex / r, ny = ey / r, nz = bulge / r;
        const s = nx * L[0] + ny * L[1] + nz * L[2] + BAYER[(y & 3) * 4 + (x & 3)] * 0.22;
        let shade = s < -0.15 ? 0 : s < 0.3 ? 1 : s < 0.68 ? 2 : 3;
        let col = null;
        if (part.tex) {
          const res = part.tex({ nx, ny, nz, x, y, ex, ey, t, r, shade, fc });
          if (res === null) continue;
          if (typeof res === 'number') shade = res; else col = res;
        }
        if (!col) col = part.ramp[shade < 0 ? 0 : shade > part.ramp.length - 1 ? part.ramp.length - 1 : shade];
        zbuf[idx] = depth;
        gbuf[idx] = group;
        const o = idx * 4;
        data[o] = col[0]; data[o + 1] = col[1]; data[o + 2] = col[2]; data[o + 3] = 255;
      }
    }
  }

  if (opts.outline !== false) outline(data, zbuf, gbuf, w, h);
  return { w, h, data, ox, oy };
}

// Détourage "sel-out" : contour extérieur sombre teinté + lignes internes
// là où une partie passe nettement devant une autre.
function outline(data, zbuf, gbuf, w, h) {
  const src = new Uint8ClampedArray(data);
  const dark = (o, k) => [src[o] * k, src[o + 1] * k, src[o + 2] * k];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x, o = i * 4;
      if (src[o + 3] === 0) {
        // pixel vide touchant le sprite -> contour
        let n = -1;
        if (x > 0 && src[o - 4 + 3]) n = o - 4;
        else if (x < w - 1 && src[o + 4 + 3]) n = o + 4;
        else if (y > 0 && src[o - w * 4 + 3]) n = o - w * 4;
        else if (y < h - 1 && src[o + w * 4 + 3]) n = o + w * 4;
        if (n >= 0) {
          const c = dark(n, 0.28);
          data[o] = c[0]; data[o + 1] = c[1]; data[o + 2] = c[2]; data[o + 3] = 255;
        }
        continue;
      }
      // ligne interne : un voisin (haut/gauche/droite) est bien plus proche de la caméra
      const z = zbuf[i], g = gbuf[i];
      const check = (j) => gbuf[j] !== g && zbuf[j] > z + 2.5 && src[j * 4 + 3];
      if ((y > 0 && check(i - w)) || (x > 0 && check(i - 1)) || (x < w - 1 && check(i + 1))) {
        const c = dark(o, 0.5);
        data[o] = c[0]; data[o + 1] = c[1]; data[o + 2] = c[2];
      }
    }
  }
}

// Petit utilitaire de dessin pixel par pixel (fleurs, herbes, tuiles…).
export function makeBuffer(w, h) {
  const data = new Uint8ClampedArray(w * h * 4);
  return {
    w, h, data,
    set(x, y, c, a = 255) {
      x |= 0; y |= 0;
      if (x < 0 || y < 0 || x >= w || y >= h || !c) return;
      const o = (y * w + x) * 4;
      data[o] = c[0]; data[o + 1] = c[1]; data[o + 2] = c[2]; data[o + 3] = a;
    },
    get(x, y) {
      if (x < 0 || y < 0 || x >= w || y >= h) return 0;
      return data[(y * w + x) * 4 + 3];
    },
  };
}

// Contour sombre autour d'un buffer dessiné à la main.
export function outlineBuffer(buf, k = 0.3) {
  const { w, h, data } = buf;
  const src = new Uint8ClampedArray(data);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      if (src[o + 3]) continue;
      const ns = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]];
      for (const [nx, ny] of ns) {
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const n = (ny * w + nx) * 4;
        if (src[n + 3] === 255) {
          data[o] = src[n] * k; data[o + 1] = src[n + 1] * k; data[o + 2] = src[n + 2] * k; data[o + 3] = 255;
          break;
        }
      }
    }
  }
  return buf;
}
