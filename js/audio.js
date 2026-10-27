// Tous les sons sont synthétisés en direct (Web Audio) : aucun fichier à charger.
const MUTE_KEY = 'brainless-mute';
const MUSIC_KEY = 'brainless-music';
const MUSIC_MODES = ['game', 'mine', 'off'];

let ctx = null, master, sfxBus, ambBus, musicBus, melBus, noiseBuf, verb;
let muted = false;
// Musique : 'game' (la musique du jeu), 'mine' (on écoute la sienne : Spotify, Apple Music… le jeu
// se mélange par-dessus au lieu de la couper), 'off' (bruitages seulement).
let music = 'game';
try { muted = localStorage.getItem(MUTE_KEY) === '1'; } catch (e) { /* stockage indisponible */ }
try { music = MUSIC_MODES.includes(localStorage.getItem(MUSIC_KEY)) ? localStorage.getItem(MUSIC_KEY) : 'game'; } catch (e) { /* stockage indisponible */ }

export function musicMode() { return music; }

// Sur iPhone, la « session audio » décide si le jeu coupe les autres apps :
//  - 'playback' : le jeu prend la main (coupe Spotify) mais sonne même avec le bouton silencieux ;
//  - 'ambient'  : le jeu se mélange à la musique des autres apps (et se tait en mode silencieux).
function applySession() {
  try { if (navigator.audioSession) navigator.audioSession.type = music === 'mine' ? 'ambient' : 'playback'; } catch (e) { /* non supporté */ }
}

export function cycleMusic() {
  music = MUSIC_MODES[(MUSIC_MODES.indexOf(music) + 1) % MUSIC_MODES.length];
  try { localStorage.setItem(MUSIC_KEY, music); } catch (e) { /* stockage indisponible */ }
  applySession();
  // la nouvelle session ne prend effet qu'en réactivant le son
  if (ctx) ctx.suspend().then(() => ctx.resume()).catch(() => {});
  return music;
}
const last = {};

export function isMuted() { return muted; }
export function audioRunning() { return !!ctx && ctx.state === 'running'; }

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
    // Sur iPhone : joue même en mode silencieux (il y a un bouton muet dans le jeu), sauf en mode
    // « ma musique » où le jeu se mélange à Spotify & co au lieu de les couper.
    applySession();
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
    // musique : un bus à part, et un écho pour la mélodie
    musicBus = ctx.createGain(); musicBus.gain.value = 0; musicBus.connect(master);
    melBus = ctx.createGain(); melBus.connect(musicBus);
    const echo = ctx.createDelay(1), fb = ctx.createGain(), eLp = ctx.createBiquadFilter();
    echo.delayTime.value = 0.42; fb.gain.value = 0.38; eLp.type = 'lowpass'; eLp.frequency.value = 1800;
    melBus.connect(echo); echo.connect(eLp).connect(fb).connect(echo); eLp.connect(musicBus);
    const mv = ctx.createGain(); mv.gain.value = 0.5; melBus.connect(mv).connect(verb);
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
  // Griffes et pieds qui raclent le sol pendant un dérapage.
  skid(dur, big) {
    if (!ready() || !gate('skid', 0.15)) return;
    noise({ f: 1100, f2: 380, q: 0.9, gain: big ? 0.45 : 0.32, a: 0.02, dec: dur });
    noise({ type: 'lowpass', f: 600, f2: 150, gain: 0.3, a: 0.01, dec: dur * 0.9 });
    tone({ f: 70, f2: 40, gain: 0.5, dec: 0.2 });
    for (let i = 0; i < 5; i++) tone({ f: rnd(1500, 3000), type: 'square', gain: 0.025, dec: 0.02, delay: Math.random() * dur });
    if (big) tone({ f: 170, f2: 120, type: 'sawtooth', gain: 0.12, a: 0.03, dec: 0.25, lp: 800 }); // grognement
  },
  splash(power = 1) {
    if (!ready() || !gate('splash', 0.08)) return;
    noise({ f: 1400, f2: 500, q: 0.7, gain: 0.25 + power * 0.35, a: 0.005, dec: 0.2 + power * 0.3, rev: power * 0.2 });
    noise({ type: 'highpass', f: 3000, gain: 0.12 + power * 0.1, a: 0.01, dec: 0.3 + power * 0.3 });
    tone({ f: 120, f2: 50, gain: 0.25 * power, dec: 0.15 });
    for (let i = 0; i < 2 + power * 4; i++) tone({ f: rnd(600, 1400), f2: rnd(1500, 2600), gain: 0.04, dec: 0.04, delay: 0.05 + Math.random() * 0.3 }); // gouttes
  },
  stroke() {
    if (!ready() || !gate('stroke', 0.15)) return;
    noise({ type: 'lowpass', f: 1200, f2: 400, gain: 0.25, a: 0.04, dec: 0.25 });
    for (let i = 0; i < 3; i++) tone({ f: rnd(500, 1000), f2: rnd(1200, 2000), gain: 0.03, dec: 0.05, delay: 0.1 + Math.random() * 0.2 }); // bulles
  },
  jab(hook) {
    if (!ready() || !gate('jab', 0.05)) return;
    const f = rnd(700, 1000) * (hook ? 0.75 : 1);
    noise({ f, f2: f * 3, q: 1.6, gain: hook ? 0.3 : 0.22, a: 0.03, dec: hook ? 0.15 : 0.1 });
    tone({ f: hook ? 130 : 160, f2: 110, type: 'sawtooth', gain: 0.05, dec: 0.08, lp: 600 }); // souffle du boxeur
  },
  rush() {
    // rafale : trois souffles très courts qui se chevauchent, un claquement sourd
    if (!ready() || !gate('rush', 0.05)) return;
    for (let i = 0; i < 3; i++) noise({ f: rnd(900, 1400), f2: rnd(2500, 3500), q: 1.4, gain: 0.16, a: 0.01, dec: 0.05, delay: i * 0.06 });
    tone({ f: 120, f2: 70, gain: 0.12, dec: 0.07, delay: 0.04 });
  },
  bigPunch(power) {
    if (!ready()) return;
    noise({ f: 300, f2: 3000, q: 1, gain: 0.5, a: 0.05, dec: 0.15 }); // le bras fend l'air
    tone({ f: 90, f2: 28, gain: 0.9 + power * 0.1, dec: 0.6 + power * 0.6, rev: 0.5, delay: 0.05 });
    noise({ type: 'lowpass', f: 2000, f2: 150, gain: 0.6, dec: 0.5 + power * 0.6, rev: 0.5, delay: 0.05 });
    noise({ type: 'highpass', f: 2500, gain: 0.3, dec: 0.1, delay: 0.05 }); // claquement
    // rafale qui part au loin
    noise({ f: 1600, f2: 300, q: 0.6, gain: 0.3 + power * 0.3, a: 0.05, dec: 0.8 + power * 0.8, delay: 0.08 });
  },
  // --- village
  hitBuilding(mat) {
    if (!ready() || !gate('bhit', 0.05)) return;
    tone({ f: rnd(120, 150), f2: 60, type: 'triangle', gain: 0.5, dec: 0.2 });
    tone({ f: 70, f2: 38, gain: 0.5, dec: 0.2 });
    noise({ type: 'lowpass', f: 900, gain: 0.4, dec: 0.22 });
    if (mat === 'stone' || mat === 'slate') noise({ f: 2200, q: 2.5, gain: 0.3, dec: 0.07 });
    else noise({ type: 'highpass', f: 3500, gain: 0.1, a: 0.02, dec: 0.3, delay: 0.03 }); // paille, tuiles qui glissent
  },
  buildingCrack() {
    if (!ready() || !gate('bcrack', 0.2)) return;
    tone({ f: 95, f2: 50, type: 'sawtooth', gain: 0.22, a: 0.03, dec: 0.45, lp: 500 });
    noise({ type: 'highpass', f: 2500, gain: 0.25, dec: 0.15 });
    for (let i = 0; i < 5; i++) tone({ f: rnd(800, 2400), type: 'square', gain: 0.035, dec: 0.03, delay: 0.05 + i * rnd(0.03, 0.08) });
  },
  collapse() {
    if (!ready() || !gate('collapse', 0.15)) return;
    tone({ f: 55, f2: 22, gain: 1, dec: 1.4, rev: 0.6 });
    noise({ type: 'lowpass', f: 1800, f2: 120, gain: 0.8, dec: 1.6, rev: 0.6 });
    noise({ type: 'highpass', f: 2500, gain: 0.25, a: 0.05, dec: 1.2 });
    for (const d of [0.2, 0.45, 0.7]) tone({ f: rnd(70, 90), f2: 35, gain: 0.5, dec: 0.25, delay: d });
    for (let i = 0; i < 14; i++) tone({ f: rnd(500, 2200), type: 'square', gain: 0.035, dec: 0.03, delay: Math.random() * 1.2 }); // gravats
  },
  propBreak(kind) {
    if (!ready() || !gate('prop', 0.05)) return;
    if (kind === 'lantern') {
      for (let i = 0; i < 7; i++) tone({ f: rnd(3000, 6000), type: 'square', gain: 0.03, dec: 0.03, delay: i * rnd(0.01, 0.04) }); // verre
      noise({ type: 'highpass', f: 5000, gain: 0.2, dec: 0.2 });
    } else if (kind === 'hay') {
      noise({ type: 'highpass', f: 2500, gain: 0.25, a: 0.02, dec: 0.35 });
    } else {
      noise({ type: 'lowpass', f: 2200, f2: 500, gain: 0.45, dec: 0.25 });
      tone({ f: rnd(160, 200), f2: 90, type: 'triangle', gain: 0.35, dec: 0.12 });
      if (kind === 'barrel') noise({ f: 1200, f2: 500, q: 0.7, gain: 0.25, dec: 0.3, delay: 0.04 }); // ça coule
    }
  },
  crunch() {
    if (!ready() || !gate('crunch', 0.06)) return;
    noise({ f: 1600, q: 1.2, gain: 0.3, dec: 0.12 });
    tone({ f: 70, f2: 35, gain: 0.45, dec: 0.2 });
    for (let i = 0; i < 3; i++) tone({ f: rnd(700, 1800), type: 'square', gain: 0.03, dec: 0.025, delay: 0.03 + i * 0.04 });
  },
  // Cri de villageois : voix rauque qui monte puis retombe, avec un vibrato de panique.
  scream(f = 300) {
    if (!ready() || !gate('scream', 0.22)) return;
    const t = ctx.currentTime + rnd(0, 0.08), dur = rnd(0.35, 0.55);
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(f, t);
    o.frequency.exponentialRampToValueAtTime(f * 1.35, t + dur * 0.3);
    o.frequency.exponentialRampToValueAtTime(f * 0.8, t + dur);
    const lfo = ctx.createOscillator(), lg = ctx.createGain();
    lfo.frequency.value = 9; lg.gain.value = f * 0.05;
    lfo.connect(lg).connect(o.frequency);
    const fl = ctx.createBiquadFilter(); fl.type = 'bandpass'; fl.frequency.value = Math.min(2400, f * 3.5); fl.Q.value = 1.5;
    const g = ctx.createGain(); env(g, t, 0.03, 0.13, dur);
    o.connect(fl).connect(g).connect(sfxBus);
    for (const n of [o, lfo]) { n.start(t); n.stop(t + dur + 0.1); }
  },
  hello(f = 300) {
    if (!ready() || !gate('hello', 0.6)) return;
    tone({ f: f * 1.6, f2: f * 2, type: 'triangle', gain: 0.07, dec: 0.08 });
    tone({ f: f * 2, f2: f * 2.4, type: 'triangle', gain: 0.07, dec: 0.1, delay: 0.12 });
  },
  clank() {
    if (!ready() || !gate('clank', 0.04)) return;
    tone({ f: rnd(1700, 2100), type: 'square', gain: 0.05, dec: 0.05 });
    tone({ f: rnd(2400, 2800), gain: 0.08, dec: 0.35 }); // l'armure résonne
    noise({ type: 'highpass', f: 5000, gain: 0.25, dec: 0.08 });
    tone({ f: 110, f2: 60, gain: 0.35, dec: 0.1 });
  },
  // Coup encaissé par un habitant : impact lourd, armure qui sonne, et parfois des os qui craquent.
  bodyHit(armor, crack) {
    if (!ready() || !gate('body', 0.05)) return;
    tone({ f: rnd(70, 85), f2: 30, gain: 0.95, dec: 0.25, rev: 0.2 });
    noise({ type: 'lowpass', f: 650, gain: 0.55, dec: 0.16 });
    tone({ f: 140, f2: 60, type: 'triangle', gain: 0.35, dec: 0.12 });
    if (armor) {
      tone({ f: rnd(2200, 2700), gain: 0.07, dec: 0.3 });
      noise({ type: 'highpass', f: 5000, gain: 0.16, dec: 0.06 });
    }
    if (crack) {
      for (let i = 0; i < 3; i++) noise({ f: rnd(2400, 3400), q: 3, gain: 0.32, dec: 0.035, delay: 0.02 + i * rnd(0.02, 0.035) });
      for (let i = 0; i < 3; i++) tone({ f: rnd(1100, 2400), type: 'square', gain: 0.04, dec: 0.02, delay: 0.03 + i * 0.03 });
    }
  },
  splat() {
    if (!ready() || !gate('splat', 0.08)) return;
    noise({ type: 'lowpass', f: 900, f2: 280, gain: 0.55, dec: 0.28 });
    noise({ f: 420, q: 1.5, gain: 0.3, dec: 0.2, delay: 0.02 });
    tone({ f: 90, f2: 38, gain: 0.6, dec: 0.25 });
  },
  sniff() {
    if (!ready() || !gate('sniff', 0.8)) return;
    for (let i = 0; i < 4; i++) noise({ f: 1500 + i * 150, q: 2.2, gain: 0.16, a: 0.03, dec: 0.08, delay: 0.25 + i * 0.17 });
    noise({ f: 900, q: 1.2, gain: 0.12, a: 0.15, dec: 0.3, delay: 0.95 }); // grande inspiration
  },
  growl() {
    if (!ready() || !gate('growl', 0.8)) return;
    tone({ f: 120, f2: 85, type: 'sawtooth', gain: 0.22, a: 0.08, dec: 0.6, lp: 500 });
    tone({ f: 61, f2: 43, type: 'square', gain: 0.08, a: 0.08, dec: 0.6, lp: 300 });
  },
  swordSwing() {
    if (!ready() || !gate('sword', 0.08)) return;
    noise({ f: 900, f2: 3200, q: 2, gain: 0.2, a: 0.04, dec: 0.12 });
  },
  playerHit() {
    if (!ready() || !gate('phit', 0.08)) return;
    tone({ f: 120, f2: 50, gain: 0.7, dec: 0.2 });
    noise({ f: 1500, q: 1, gain: 0.35, dec: 0.1 });
    tone({ f: 2300, gain: 0.06, dec: 0.25 }); // la lame qui tinte
    tone({ f: 160, f2: 110, type: 'sawtooth', gain: 0.14, a: 0.02, dec: 0.2, lp: 700 }); // grognement
  },
  knightDown() {
    if (!ready() || !gate('kdown', 0.1)) return;
    tone({ f: 90, f2: 40, gain: 0.5, dec: 0.25, delay: 0.25 });
    for (let i = 0; i < 6; i++) tone({ f: rnd(1200, 3000), type: 'square', gain: 0.04, dec: 0.04, delay: 0.2 + i * rnd(0.04, 0.09) });
  },
  // Cloche d'alarme du village quand il devient plus recherché.
  bell() {
    if (!ready() || !gate('bell', 1)) return;
    for (const d of [0, 0.7]) {
      tone({ f: 440, gain: 0.25, dec: 2.2, delay: d, rev: 0.5 });
      tone({ f: 666, gain: 0.1, dec: 1.6, delay: d });
      tone({ f: 1104, gain: 0.05, dec: 1, delay: d });
    }
  },
  down() {
    if (!ready()) return;
    tone({ f: 150, f2: 55, type: 'sawtooth', gain: 0.3, a: 0.05, dec: 1.2, lp: 600 });
    tone({ f: 70, f2: 28, gain: 0.9, dec: 0.5, delay: 0.55, rev: 0.4 });
    noise({ type: 'lowpass', f: 800, gain: 0.4, dec: 0.4, delay: 0.55 });
  },
  // Tonnerre : un craquement sec si c'est tout près, puis un long grondement.
  thunder(power = 1, delay = 0) {
    if (!ready()) return;
    if (delay < 0.25) noise({ type: 'highpass', f: 1800, gain: 0.5 * power, dec: 0.15, delay });
    noise({ type: 'lowpass', f: 420, f2: 70, gain: 0.7 * power, a: 0.08, dec: 2.4, delay, rev: 0.6 });
    tone({ f: 55, f2: 28, gain: 0.6 * power, a: 0.05, dec: 1.6, delay, rev: 0.4 });
  },
  regen() {
    if (!ready() || !gate('regen', 2)) return;
    for (let i = 0; i < 4; i++) tone({ f: 300 + i * 120, f2: 420 + i * 140, type: 'triangle', gain: 0.04, dec: 0.15, delay: i * 0.09 });
  },
  ui() {
    if (!ready()) return;
    tone({ f: 660, f2: 880, type: 'square', gain: 0.06, dec: 0.06 });
  },
  // --- attraper / lancer
  grabReach() {
    if (!ready()) return;
    noise({ f: 600, f2: 1800, q: 1.4, gain: 0.14, a: 0.04, dec: 0.12 });
  },
  // il empoigne : choc sourd (plus grave si c'est lourd) et grognement d'effort
  grab(w = 1) {
    if (!ready() || !gate('grab', 0.1)) return;
    tone({ f: 120 - w * 15, f2: 45, gain: 0.45 + w * 0.12, dec: 0.18 });
    noise({ type: 'lowpass', f: 900, gain: 0.25, dec: 0.12 });
    tone({ f: 150, f2: 110, type: 'sawtooth', gain: 0.1 + w * 0.03, a: 0.03, dec: 0.25 + w * 0.08, lp: 700, delay: 0.05 });
  },
  // un arbre arraché : racines qui cèdent, terre qui se déchire, feuillage secoué
  uproot() {
    if (!ready()) return;
    tone({ f: 85, f2: 50, type: 'sawtooth', gain: 0.2, a: 0.05, dec: 0.5, lp: 450 });
    for (let i = 0; i < 9; i++) noise({ f: rnd(500, 1500), q: 2.5, gain: 0.2, dec: 0.04, delay: i * rnd(0.03, 0.06) });
    noise({ type: 'lowpass', f: 1400, f2: 250, gain: 0.5, dec: 0.5, delay: 0.2, rev: 0.3 });
    tone({ f: 65, f2: 30, gain: 0.7, dec: 0.4, delay: 0.25 });
    noise({ type: 'highpass', f: 3000, gain: 0.2, a: 0.05, dec: 0.8, delay: 0.1 });
    tone({ f: 140, f2: 95, type: 'sawtooth', gain: 0.14, a: 0.04, dec: 0.5, lp: 650, delay: 0.15 });
  },
  // il arme le lancer : souffle et grognement qui monte
  heave() {
    if (!ready() || !gate('heave', 0.2)) return;
    tone({ f: 110, f2: 160, type: 'sawtooth', gain: 0.13, a: 0.06, dec: 0.25, lp: 700 });
    noise({ f: 500, q: 2, gain: 0.08, a: 0.05, dec: 0.2 });
  },
  // la charge part : cri d'effort et gros souffle (plus sourd si c'est lourd)
  throwIt(p, w) {
    if (!ready()) return;
    tone({ f: 170, f2: 100, type: 'sawtooth', gain: 0.16 + p * 0.06, a: 0.02, dec: 0.3, lp: 900 });
    noise({ f: 400 - w * 60, f2: 2400 - w * 300, q: 1, gain: 0.3 + p * 0.2, a: 0.04, dec: 0.25 + w * 0.08 });
    noise({ f: 1800, f2: 500, q: 0.8, gain: 0.12 + p * 0.12, a: 0.05, dec: 0.5 + p * 0.4, delay: 0.1 });
  },
  // --- feu
  // ça prend : un « vouf » sourd qui enfle
  ignite(p = 1) {
    if (!ready() || !gate('ignite', 0.15)) return;
    noise({ type: 'lowpass', f: 300, f2: 1600, gain: 0.25 + p * 0.25, a: 0.12, dec: 0.4 + p * 0.3 });
    tone({ f: 70, f2: 45, gain: 0.3 * p, a: 0.08, dec: 0.4 });
  },
  // un seau sur les flammes : sifflement de vapeur
  extinguish() {
    if (!ready() || !gate('hiss', 0.2)) return;
    noise({ type: 'highpass', f: 2800, gain: 0.22, a: 0.02, dec: 0.6 });
    noise({ f: 1200, f2: 600, q: 0.8, gain: 0.15, a: 0.01, dec: 0.25 }); // l'eau qui s'écrase
  },
  // --- inventaire, mutations, constructions
  pickup() {
    if (!ready() || !gate('pickup', 0.05)) return;
    tone({ f: rnd(880, 960), f2: 1400, type: 'square', gain: 0.04, dec: 0.06 });
  },
  // mutation : grondement de chair qui se tord, puis un scintillement
  mutate() {
    if (!ready() || !gate('mutate', 0.5)) return;
    tone({ f: 60, f2: 120, type: 'sawtooth', gain: 0.18, a: 0.2, dec: 0.8, lp: 500 });
    noise({ type: 'lowpass', f: 300, f2: 900, gain: 0.25, a: 0.3, dec: 0.6 });
    for (let i = 0; i < 6; i++) tone({ f: 600 + i * 180, type: 'triangle', gain: 0.03, dec: 0.25, delay: 0.4 + i * 0.07 });
  },
  place() {
    if (!ready()) return;
    tone({ f: 110, f2: 55, gain: 0.5, dec: 0.18 });
    noise({ type: 'lowpass', f: 900, gain: 0.3, dec: 0.12 });
  },
  craft() {
    if (!ready()) return;
    for (let i = 0; i < 3; i++) { tone({ f: rnd(1600, 2200), type: 'square', gain: 0.04, dec: 0.05, delay: i * 0.12 }); noise({ f: 1800, q: 2, gain: 0.12, dec: 0.05, delay: i * 0.12 }); }
  },
  // la viande grésille sur le feu
  cook() {
    if (!ready()) return;
    noise({ type: 'highpass', f: 3500, gain: 0.18, a: 0.05, dec: 0.9 });
    for (let i = 0; i < 8; i++) tone({ f: rnd(2000, 4000), type: 'square', gain: 0.015, dec: 0.015, delay: Math.random() * 0.8 });
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
  amb = { wind: mk('lowpass', 450, 0.7), water: mk('bandpass', 700, 0.8), rain: mk('highpass', 2200, 0.5),
    fire: mk('bandpass', 900, 0.6), roar: mk('lowpass', 220, 0.8), birdT: 2, cricketT: 1, crackT: 0, t: 0 };
}

// Appelée chaque frame : vent qui souffle, eau qui clapote, oiseaux le jour, grillons la nuit,
// feu qui ronfle et crépite.
export function updateAmbience(dt, { night, water, height, rain = 0, storm = 0, fire = 0 }) {
  if (!ready() || !amb) return;
  const t = ctx.currentTime;
  amb.t += dt;
  amb.fire.g.gain.setTargetAtTime(fire * 0.16, t, 0.3);
  amb.roar.g.gain.setTargetAtTime(fire * fire * 0.3, t, 0.4); // un grand incendie gronde
  if (fire > 0.03) {
    amb.crackT -= dt;
    if (amb.crackT <= 0) {
      // craquements secs du bois qui éclate
      amb.crackT = rnd(0.03, 0.25) / (0.3 + fire);
      tone({ f: rnd(900, 3000), type: 'square', gain: 0.02 + fire * 0.03, dec: 0.012, bus: ambBus });
      if (Math.random() < 0.2) noise({ f: rnd(1500, 3500), q: 3, gain: 0.08 * fire, dec: 0.03, bus: ambBus });
    }
  }
  amb.rain.g.gain.setTargetAtTime(rain * 0.14, t, 0.5); // crépitement de la pluie
  height += storm * 6; // l'orage fait souffler le vent
  const gust = 0.5 + 0.5 * Math.sin(amb.t * 0.37) * Math.sin(amb.t * 0.13 + 1);
  const windGain = 0.04 + gust * 0.06 + height * 0.02;
  amb.wind.g.gain.setTargetAtTime(windGain, t, 0.3);
  amb.wind.fl.frequency.setTargetAtTime(300 + gust * 500 + height * 80, t, 0.3);
  const lap = 0.5 + 0.5 * Math.sin(amb.t * 1.7) * Math.sin(amb.t * 0.9);
  amb.water.g.gain.setTargetAtTime(water * (0.05 + lap * 0.07), t, 0.2);

  if (!night && rain < 0.3) {
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

// ---------------------------------------------------------------- musique
// Musique générée en direct, en ré dorien : nappes lentes et basse tenue sur 4 accords
// (rém, si♭, fa, do), mélodie pentatonique au hasard qui chante dans l'écho. La nuit, elle
// s'assombrit et se raréfie. Quand ça chauffe (chevaliers, héros, cloche), les tambours, une
// basse qui martèle et des charlestons montent, et le tempo accélère.
const ROOT = 146.83; // ré
const semi = (n) => ROOT * Math.pow(2, n / 12);
const PROG = [[0, 3, 7], [-4, 0, 3], [3, 7, 10], [-2, 2, 5]];
const PENTA = [0, 3, 5, 7, 10, 12, 15, 17, 19, 22, 24, 27];
const mus = { t: 0, step: 0, night: 0, danger: 0, mel: 5 };

export function updateMusic(dt, { night = 0, danger = 0, rain = 0 }) {
  if (!ready() || !musicBus) return;
  const now = ctx.currentTime, on = music === 'game';
  musicBus.gain.setTargetAtTime(on ? 0.55 : 0, now, on ? 1.5 : 0.3);
  mus.night += (night - mus.night) * Math.min(1, dt * 0.3);
  mus.danger += (danger - mus.danger) * Math.min(1, dt * (danger > mus.danger ? 1.2 : 0.2)); // monte vite, retombe lentement
  if (!on) { mus.t = 0; return; }
  if (mus.t < now - 0.3) mus.t = now + 0.05; // reprise après une pause
  const step = 60 / (66 + mus.danger * 44) / 4; // double croche
  while (mus.t < now + 0.2) {
    playStep(mus.step, mus.t - now, step, rain);
    mus.t += step;
    mus.step++;
  }
}

function playStep(s, delay, step, rain) {
  const bar = Math.floor(s / 16), pos = s % 16, chord = PROG[Math.floor(bar / 2) % 4], r = chord[0];
  const n = mus.night, d = mus.danger, bus = musicBus;
  if (pos === 0 && bar % 2 === 0) {
    // nappe : les trois notes de l'accord, doublées un peu désaccordées ; basse tenue dessous
    const len = step * 32;
    for (const k of chord) {
      for (const det of [1, 1.006]) tone({ f: semi(k) * det, type: 'triangle', gain: 0.03 * (1 - d * 0.4), a: 1.4, dec: len, lp: 900 - n * 400, delay, bus });
    }
    tone({ f: semi(r - 12), gain: 0.1, a: 0.5, dec: len, delay, bus });
  }
  // mélodie : un « pluck » sur certaines croches, en marche aléatoire dans la gamme
  const phraseEnd = bar % 4 === 3 && pos >= 8;
  const pm = (0.3 - n * 0.14) * (1 - d * 0.5) * (rain > 0.5 ? 0.6 : 1);
  if (pos % 2 === 0 && !phraseEnd && Math.random() < pm) {
    mus.mel = Math.max(1, Math.min(10, mus.mel + Math.round((Math.random() * 2 - 1) * 2)));
    const f = semi(PENTA[mus.mel] + (n > 0.5 ? 0 : 12));
    tone({ f, type: 'triangle', gain: 0.045, a: 0.004, dec: 0.45 + n * 0.6, delay, bus: melBus });
    tone({ f: f * 2, gain: 0.012, a: 0.004, dec: 0.2, delay, bus: melBus });
  }
  if (d < 0.05) return;
  // tension : grosse caisse, toms, charlestons, basse qui martèle
  if (pos === 0 || pos === 8 || (d > 0.6 && pos === 11)) tone({ f: 120, f2: 38, gain: 0.4 * d, dec: 0.28, delay, bus });
  if (pos === 4 || pos === 12) {
    tone({ f: 190, f2: 85, gain: 0.22 * d, dec: 0.2, delay, bus });
    noise({ type: 'lowpass', f: 1100, gain: 0.12 * d, dec: 0.12, delay, bus });
  }
  if (pos % 2 === 1 && d > 0.25) noise({ type: 'highpass', f: 6500, gain: 0.045 * d, dec: 0.035, delay, bus });
  if (pos % 2 === 0) tone({ f: semi(r - 12 + (pos % 8 === 6 ? 7 : 0)), type: 'sawtooth', gain: 0.05 * d, dec: step * 1.6, lp: 380 + d * 520, delay, bus });
  if (pos === 0 && bar % 2 === 0 && d > 0.5) tone({ f: semi(r + 12), f2: semi(r), type: 'square', gain: 0.03 * d, a: 0.01, dec: 0.5, lp: 1200, delay, bus, rev: 0.3 });
}
