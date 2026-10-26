// Tous les sons sont synthétisés en direct (Web Audio) : aucun fichier à charger.
const MUTE_KEY = 'brainless-mute';

let ctx = null, master, sfxBus, ambBus, noiseBuf, verb;
let muted = false;
try { muted = localStorage.getItem(MUTE_KEY) === '1'; } catch (e) { /* stockage indisponible */ }
const last = {};

export function isMuted() { return muted; }

export function toggleMute() {
  muted = !muted;
  try { localStorage.setItem(MUTE_KEY, muted ? '1' : '0'); } catch (e) { /* stockage indisponible */ }
  if (master) master.gain.setTargetAtTime(muted ? 0 : 0.9, ctx.currentTime, 0.05);
}

// À appeler sur un geste utilisateur (iOS n'autorise le son qu'après un toucher).
export function unlockAudio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    // Sur iPhone, joue le son même si le bouton silencieux est activé (il y a un bouton muet dans le jeu).
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) { /* non supporté */ }
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.9;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 5;
    master.connect(comp).connect(ctx.destination);
    sfxBus = ctx.createGain(); sfxBus.connect(master);
    ambBus = ctx.createGain(); ambBus.gain.value = 0.7; ambBus.connect(master);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    // petite réverbération "plein air" pour les gros impacts
    verb = ctx.createConvolver();
    const len = ctx.sampleRate * 1.6, ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const ch = ir.getChannelData(c);
      for (let i = 0; i < len; i++) ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    }
    verb.buffer = ir;
    const vg = ctx.createGain(); vg.gain.value = 0.35;
    verb.connect(vg).connect(master);
    startAmbience();
  }
  if (ctx.state !== 'running') ctx.resume();
  // buffer muet pour finir de débloquer iOS
  const b = ctx.createBufferSource();
  b.buffer = ctx.createBuffer(1, 1, 22050);
  b.connect(ctx.destination);
  b.start(0);
}

const ready = () => ctx && ctx.state === 'running';
const rnd = (a, b) => a + Math.random() * (b - a);

// Évite qu'un même son se déclenche 15 fois dans la même frame (gros smash).
function gate(name, gap = 0.035) {
  const t = ctx.currentTime;
  if (last[name] && t - last[name] < gap) return false;
  last[name] = t;
  return true;
}

function env(g, t, a, peak, dec) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + a + dec);
}

// Bruit filtré : base de presque tous les bruitages (pas, feuilles, vent, impacts).
function noise({ type = 'bandpass', f = 1000, f2 = null, q = 1, gain = 0.3, a = 0.005, dec = 0.15, delay = 0, rev = 0, bus = sfxBus }) {
  const t = ctx.currentTime + delay;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  src.playbackRate.value = rnd(0.9, 1.1);
  const fl = ctx.createBiquadFilter();
  fl.type = type; fl.Q.value = q;
  fl.frequency.setValueAtTime(f, t);
  if (f2) fl.frequency.exponentialRampToValueAtTime(f2, t + a + dec);
  const g = ctx.createGain();
  env(g, t, a, gain, dec);
  src.connect(fl).connect(g).connect(bus);
  if (rev) { const r = ctx.createGain(); r.gain.value = rev; g.connect(r).connect(verb); }
  src.start(t, Math.random() * 1.5);
  src.stop(t + a + dec + 0.05);
}

// Oscillateur avec glissement de fréquence : coups sourds, grognements, chants d'oiseaux.
function tone({ f = 200, f2 = null, type = 'sine', gain = 0.3, a = 0.005, dec = 0.2, delay = 0, lp = 0, rev = 0, bus = sfxBus }) {
  const t = ctx.currentTime + delay;
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f, t);
  if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + a + dec);
  const g = ctx.createGain();
  env(g, t, a, gain, dec);
  let node = o;
  if (lp) { const fl = ctx.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = lp; node = o.connect(fl); }
  node.connect(g).connect(bus);
  if (rev) { const r = ctx.createGain(); r.gain.value = rev; g.connect(r).connect(verb); }
  o.start(t);
  o.stop(t + a + dec + 0.05);
}

// ---------------------------------------------------------------- bruitages
export const sfx = {
  step(surface, heavy = 1) {
    if (!ready() || !gate('step', 0.06)) return;
    const s = {
      grass: { f: 1600, q: 0.8, dec: 0.09 },
      sand: { f: 2600, q: 0.6, dec: 0.11 },
      snow: { f: 2200, q: 1.2, dec: 0.16 },
      stone: { f: 900, q: 2, dec: 0.05 },
    }[surface] || { f: 1600, q: 0.8, dec: 0.09 };
    noise({ f: s.f * rnd(0.85, 1.15), q: s.q, gain: 0.16 * heavy, dec: s.dec });
    tone({ f: rnd(80, 100), f2: 45, gain: 0.35 * heavy, dec: 0.09 });
  },
  gallop(front, surface) {
    if (!ready() || !gate('gallop', 0.08)) return;
    tone({ f: front ? 95 : 75, f2: 35, gain: front ? 0.7 : 0.45, dec: 0.16 });
    noise({ type: 'lowpass', f: 500, gain: front ? 0.35 : 0.2, dec: 0.12 });
    noise({ f: surface === 'snow' ? 2200 : surface === 'sand' ? 2800 : 1500, q: 0.7, gain: 0.18, dec: 0.12 });
  },
  breath() {
    if (!ready() || !gate('breath', 0.3)) return;
    noise({ f: rnd(500, 700), q: 3, gain: 0.08, a: 0.04, dec: 0.18 });
  },
  whoosh() {
    if (!ready() || !gate('whoosh')) return;
    noise({ f: 500, f2: 2600, q: 1.5, gain: 0.25, a: 0.06, dec: 0.16 });
  },
  punchAir() {
    if (!ready()) return;
    noise({ f: 1800, f2: 600, q: 2, gain: 0.12, dec: 0.1 });
  },
  hitWood() {
    if (!ready() || !gate('wood')) return;
    tone({ f: rnd(170, 210), f2: 110, type: 'triangle', gain: 0.5, dec: 0.14 });
    noise({ f: 900, q: 1.5, gain: 0.35, dec: 0.1 });
    tone({ f: 70, f2: 40, gain: 0.4, dec: 0.15 });
    noise({ type: 'highpass', f: 4000, gain: 0.08, a: 0.02, dec: 0.4, delay: 0.03 }); // feuilles
  },
  hitRock() {
    if (!ready() || !gate('rock')) return;
    noise({ f: 2200, q: 2.5, gain: 0.35, dec: 0.06 });
    tone({ f: rnd(700, 900), f2: 500, type: 'square', gain: 0.06, dec: 0.05 });
    tone({ f: 90, f2: 45, gain: 0.45, dec: 0.12 });
  },
  treeCreak() {
    if (!ready() || !gate('creak', 0.2)) return;
    tone({ f: 95, f2: 55, type: 'sawtooth', gain: 0.18, a: 0.08, dec: 0.6, lp: 500 });
    noise({ type: 'highpass', f: 3500, gain: 0.12, a: 0.2, dec: 0.6 });
  },
  treeCrash() {
    if (!ready() || !gate('crash', 0.1)) return;
    tone({ f: 70, f2: 30, gain: 0.8, dec: 0.5, rev: 0.4 });
    noise({ type: 'lowpass', f: 1200, f2: 200, gain: 0.5, dec: 0.7, rev: 0.4 });
    noise({ type: 'highpass', f: 3000, gain: 0.18, a: 0.03, dec: 0.9 });
  },
  rockBreak() {
    if (!ready() || !gate('rbreak', 0.06)) return;
    noise({ type: 'lowpass', f: 2500, f2: 400, gain: 0.55, dec: 0.35, rev: 0.3 });
    tone({ f: 60, f2: 30, gain: 0.6, dec: 0.3 });
    for (let i = 0; i < 6; i++) tone({ f: rnd(900, 2600), type: 'square', gain: 0.04, dec: 0.03, delay: 0.05 + i * rnd(0.03, 0.07) });
  },
  rustle() {
    if (!ready() || !gate('rustle', 0.05)) return;
    noise({ type: 'highpass', f: 2500, gain: 0.2, a: 0.02, dec: 0.3 });
  },
  pluck() {
    if (!ready() || !gate('pluck', 0.04)) return;
    noise({ f: 3200, q: 1, gain: 0.1, dec: 0.08 });
  },
  jump() {
    if (!ready()) return;
    noise({ f: 400, f2: 1600, q: 1.2, gain: 0.2, a: 0.05, dec: 0.2 });
    tone({ f: 150, f2: 105, type: 'sawtooth', gain: 0.12, a: 0.02, dec: 0.18, lp: 700 }); // grognement
  },
  land(hard) {
    if (!ready()) return;
    tone({ f: hard ? 80 : 95, f2: 32, gain: hard ? 0.9 : 0.6, dec: 0.25, rev: 0.2 });
    noise({ type: 'lowpass', f: 700, gain: 0.35, dec: 0.2 });
  },
  // Cri du Nomu : rauque, avec un vibrato saccadé.
  roar(power = 1) {
    if (!ready() || !gate('roar', 0.5)) return;
    const t = ctx.currentTime, dur = 0.55 + power * 0.4;
    const o = ctx.createOscillator(), o2 = ctx.createOscillator();
    o.type = 'sawtooth'; o2.type = 'square';
    o.frequency.setValueAtTime(260, t); o.frequency.exponentialRampToValueAtTime(140, t + dur);
    o2.frequency.setValueAtTime(131, t); o2.frequency.exponentialRampToValueAtTime(70, t + dur);
    const lfo = ctx.createOscillator(), lg = ctx.createGain();
    lfo.frequency.value = 28; lg.gain.value = 30;
    lfo.connect(lg); lg.connect(o.frequency); lg.connect(o2.frequency);
    const fl = ctx.createBiquadFilter(); fl.type = 'bandpass'; fl.frequency.value = 900; fl.Q.value = 1.2;
    const g = ctx.createGain(); env(g, t, 0.05, 0.28 + power * 0.12, dur);
    o.connect(fl); o2.connect(fl); fl.connect(g).connect(sfxBus);
    const r = ctx.createGain(); r.gain.value = 0.3; g.connect(r).connect(verb);
    for (const n of [o, o2, lfo]) { n.start(t); n.stop(t + dur + 0.1); }
    noise({ f: 1200, q: 0.8, gain: 0.12 + power * 0.08, a: 0.05, dec: dur });
  },
  slam(power) {
    if (!ready()) return;
    tone({ f: 70, f2: 24, gain: 1, dec: 0.9 + power * 0.8, rev: 0.6 });
    tone({ f: 140, f2: 40, type: 'triangle', gain: 0.5, dec: 0.3 });
    noise({ type: 'lowpass', f: 1500, f2: 120, gain: 0.8, dec: 0.9 + power * 0.9, rev: 0.6 });
    noise({ type: 'highpass', f: 2500, gain: 0.35, dec: 0.12 }); // craquement du sol
    // bourrasque qui monte puis retombe
    noise({ f: 300, f2: 1400, q: 0.7, gain: 0.25 + power * 0.25, a: 0.2, dec: 0.4, delay: 0.05 });
    noise({ f: 1400, f2: 250, q: 0.7, gain: 0.2 + power * 0.2, a: 0.05, dec: 0.9 + power, delay: 0.5 });
    for (let i = 0; i < 4 + power * 6; i++) tone({ f: rnd(500, 1800), type: 'square', gain: 0.035, dec: 0.03, delay: 0.1 + Math.random() * 0.6 });
  },
  ui() {
    if (!ready()) return;
    tone({ f: 660, f2: 880, type: 'square', gain: 0.06, dec: 0.06 });
  },
  tired() {
    if (!ready() || !gate('tired', 1)) return;
    for (let i = 0; i < 3; i++) noise({ f: 600, q: 3, gain: 0.12, a: 0.05, dec: 0.2, delay: i * 0.35 });
  },
};

// ---------------------------------------------------------------- charge (son continu)
let charge = null;

export function chargeStart() {
  if (!ready() || charge) return;
  const t = ctx.currentTime;
  const o1 = ctx.createOscillator(), o2 = ctx.createOscillator(), sub = ctx.createOscillator();
  o1.type = 'sawtooth'; o2.type = 'sawtooth'; sub.type = 'sine';
  o1.frequency.value = 55; o2.frequency.value = 55.8; sub.frequency.value = 40;
  const fl = ctx.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = 200; fl.Q.value = 6;
  const trem = ctx.createGain(); trem.gain.value = 0.6;
  const lfo = ctx.createOscillator(), lfoG = ctx.createGain();
  lfo.frequency.value = 4; lfoG.gain.value = 0.4;
  lfo.connect(lfoG).connect(trem.gain);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.35, t + 0.2);
  // grondement d'énergie + souffle
  const ns = ctx.createBufferSource(); ns.buffer = noiseBuf; ns.loop = true;
  const nf = ctx.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = 400; nf.Q.value = 2;
  const ng = ctx.createGain(); ng.gain.value = 0.15;
  ns.connect(nf).connect(ng).connect(trem);
  o1.connect(fl); o2.connect(fl); sub.connect(fl);
  fl.connect(trem).connect(g).connect(sfxBus);
  for (const n of [o1, o2, sub, lfo, ns]) n.start(t);
  charge = { o1, o2, sub, fl, lfo, nf, g, nodes: [o1, o2, sub, lfo, ns], full: false };
}

export function chargeUpdate(c) {
  if (!charge) return;
  const t = ctx.currentTime;
  charge.fl.frequency.setTargetAtTime(200 + c * c * 2400, t, 0.05);
  charge.lfo.frequency.setTargetAtTime(4 + c * 14, t, 0.05);
  charge.o1.frequency.setTargetAtTime(55 + c * 55, t, 0.05);
  charge.o2.frequency.setTargetAtTime(55.8 + c * 57, t, 0.05);
  charge.nf.frequency.setTargetAtTime(400 + c * 1800, t, 0.05);
  if (c >= 1 && !charge.full) {
    charge.full = true;
    tone({ f: 1800, f2: 2400, type: 'square', gain: 0.05, dec: 0.12 });
    tone({ f: 2400, type: 'square', gain: 0.05, dec: 0.12, delay: 0.12 });
  }
}

export function chargeStop() {
  if (!charge) return;
  const t = ctx.currentTime;
  charge.g.gain.cancelScheduledValues(t);
  charge.g.gain.setTargetAtTime(0.0001, t, 0.03);
  for (const n of charge.nodes) n.stop(t + 0.2);
  charge = null;
}

// ---------------------------------------------------------------- ambiance
let amb = null;

function startAmbience() {
  const mk = (type, f, q) => {
    const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
    const fl = ctx.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q;
    const g = ctx.createGain(); g.gain.value = 0;
    src.connect(fl).connect(g).connect(ambBus);
    src.start();
    return { fl, g };
  };
  amb = { wind: mk('lowpass', 450, 0.7), water: mk('bandpass', 700, 0.8), birdT: 2, cricketT: 1, t: 0 };
}

// Appelée chaque frame : vent qui souffle, eau qui clapote, oiseaux le jour, grillons la nuit.
export function updateAmbience(dt, { night, water, height }) {
  if (!ready() || !amb) return;
  const t = ctx.currentTime;
  amb.t += dt;
  const gust = 0.5 + 0.5 * Math.sin(amb.t * 0.37) * Math.sin(amb.t * 0.13 + 1);
  const windGain = 0.04 + gust * 0.06 + height * 0.02;
  amb.wind.g.gain.setTargetAtTime(windGain, t, 0.3);
  amb.wind.fl.frequency.setTargetAtTime(300 + gust * 500 + height * 80, t, 0.3);
  const lap = 0.5 + 0.5 * Math.sin(amb.t * 1.7) * Math.sin(amb.t * 0.9);
  amb.water.g.gain.setTargetAtTime(water * (0.05 + lap * 0.07), t, 0.2);

  if (!night) {
    amb.birdT -= dt;
    if (amb.birdT <= 0) {
      amb.birdT = rnd(1.5, 5);
      const base = rnd(2200, 4200), n = 1 + ((Math.random() * 4) | 0);
      for (let i = 0; i < n; i++) {
        const d = i * rnd(0.08, 0.16);
        tone({ f: base * rnd(0.9, 1.15), f2: base * rnd(1.1, 1.5), gain: 0.035, a: 0.01, dec: rnd(0.05, 0.1), delay: d, bus: ambBus });
      }
    }
  } else {
    amb.cricketT -= dt;
    if (amb.cricketT <= 0) {
      amb.cricketT = rnd(0.4, 1.2);
      const f = rnd(4200, 5200);
      for (let i = 0; i < 3; i++) tone({ f, type: 'square', gain: 0.012, dec: 0.025, delay: i * 0.05, lp: 6000, bus: ambBus });
    }
  }
}
