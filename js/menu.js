// Écran d'accueil : titre, liste des mondes, création d'un monde (nom, graine, paramètres).
// En HTML par-dessus le jeu (il faut un vrai champ texte pour le clavier de l'iPhone),
// habillé comme le reste : majuscules, ombre portée d'1 px, boutons aux couleurs du jeu.
// Utilisable au doigt, au clavier (flèches, Entrée, Échap) et à la manette (croix, A, B).
import { listWorlds, createWorld, deleteWorld, seedFrom, PARAMS, DEFAULTS } from './saves.js';

let root, onPlay, screen = 'title', selected = null, draft = null, focusIdx = 0;

export function initMenu(opts) {
  onPlay = opts.onPlay;
  root = document.getElementById('menu');
  root.addEventListener('click', onClick);
  root.addEventListener('input', (e) => {
    if (!draft) return;
    if (e.target.name === 'name') draft.name = e.target.value;
    if (e.target.name === 'seed') draft.seed = e.target.value;
  });
  window.addEventListener('keydown', onKey);
}

export const menuVisible = () => root && !root.hidden;

export function showMenu(s = 'title') {
  root.hidden = false;
  go(s);
}
export function hideMenu() { root.hidden = true; }

function ago(t) {
  const d = Math.floor((Date.now() - t) / 86400000);
  return d <= 0 ? "AUJOURD'HUI" : d === 1 ? 'HIER' : 'IL Y A ' + d + ' JOURS';
}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function go(s) {
  screen = s;
  focusIdx = 0;
  const worlds = listWorlds();
  if (s === 'worlds' && !worlds.length) s = screen = 'create';
  if (s === 'worlds' && (!selected || !worlds.find((w) => w.id === selected))) selected = worlds[0].id;
  let html = '';
  if (s === 'title') {
    html = `<div class="m-title"><h1>BRAINLESS</h1><p>LE NOMU EN LIBERTE</p>
      <button class="btn red" data-nav data-act="play">JOUER</button></div>`;
  } else if (s === 'worlds') {
    html = `<div class="m-panel"><h2>MES MONDES</h2><div class="m-list">` +
      worlds.map((w) => `<button class="world${w.id === selected ? ' sel' : ''}" data-nav data-act="pick" data-id="${w.id}">
        <b>${esc(w.name)}</b><small>GRAINE ${w.seed} - ${ago(w.played)}</small></button>`).join('') +
      `</div><div class="m-row">
        <button class="btn red" data-nav data-act="start">JOUER</button>
        <button class="btn green" data-nav data-act="new">CREER UN MONDE</button>
        <button class="btn grey" data-nav data-act="del">SUPPRIMER</button>
        <button class="btn grey" data-nav data-act="back">RETOUR</button></div></div>`;
  } else if (s === 'create') {
    if (!draft) draft = { name: 'MONDE ' + (worlds.length + 1), seed: '', params: { ...DEFAULTS } };
    html = `<div class="m-panel"><h2>NOUVEAU MONDE</h2>
      <p class="m-note">MONDE INFINI, GENERE A PARTIR DE SA GRAINE. MEME GRAINE = MEME MONDE.</p>
      <label class="m-field">NOM<input name="name" maxlength="22" value="${esc(draft.name)}" data-nav autocomplete="off"></label>
      <label class="m-field">GRAINE<input name="seed" maxlength="20" value="${esc(draft.seed)}" placeholder="ALEATOIRE" data-nav autocomplete="off"></label>
      <div class="m-params">` +
      PARAMS.map((p) => `<div class="m-param" data-nav data-param="${p.key}"><span>${p.label}</span><div>` +
        p.opts.map((o, i) => `<button class="opt${draft.params[p.key] === i ? ' sel' : ''}" data-act="opt" data-key="${p.key}" data-i="${i}" tabindex="-1">${o}</button>`).join('') +
        `</div></div>`).join('') +
      `</div><div class="m-row">
        <button class="btn red" data-nav data-act="create">CREER ET JOUER</button>
        <button class="btn grey" data-nav data-act="${worlds.length ? 'worlds' : 'back'}">RETOUR</button></div></div>`;
  } else if (s === 'confirm') {
    const w = worlds.find((x) => x.id === selected);
    html = `<div class="m-panel small"><h2>SUPPRIMER ?</h2><p class="m-note">${esc(w ? w.name : '')} SERA PERDU POUR TOUJOURS.</p>
      <div class="m-row"><button class="btn red" data-nav data-act="delok">SUPPRIMER</button>
      <button class="btn grey" data-nav data-act="worlds">ANNULER</button></div></div>`;
  }
  root.innerHTML = html;
  focus(0);
}

function navs() { return [...root.querySelectorAll('[data-nav]')]; }
function focus(i) {
  const list = navs();
  if (!list.length) return;
  focusIdx = (i + list.length) % list.length;
  list.forEach((el, k) => el.classList.toggle('focus', k === focusIdx));
  const el = list[focusIdx];
  if (el.tagName !== 'INPUT' && document.activeElement && document.activeElement.tagName === 'INPUT') document.activeElement.blur();
  el.scrollIntoView({ block: 'nearest' });
}

function act(a, el) {
  if (a === 'play') go(listWorlds().length ? 'worlds' : 'create');
  else if (a === 'pick') { selected = el.dataset.id; root.querySelectorAll('.world').forEach((w) => w.classList.toggle('sel', w === el)); }
  else if (a === 'start') { const w = listWorlds().find((x) => x.id === selected); if (w) onPlay(w); }
  else if (a === 'new') { draft = null; go('create'); }
  else if (a === 'del') { if (selected) go('confirm'); }
  else if (a === 'delok') { deleteWorld(selected); selected = null; go('worlds'); }
  else if (a === 'worlds') go('worlds');
  else if (a === 'back') go('title');
  else if (a === 'opt') {
    draft.params[el.dataset.key] = +el.dataset.i;
    el.parentNode.querySelectorAll('.opt').forEach((b) => b.classList.toggle('sel', b === el));
  } else if (a === 'create') {
    const w = createWorld(draft.name, seedFrom(draft.seed), draft.params);
    draft = null;
    selected = w.id;
    onPlay(w);
  }
}

function onClick(e) {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  e.preventDefault();
  act(el.dataset.act, el);
}

// Navigation sans souris : haut/bas change d'élément, gauche/droite change une option, A valide.
function move(dx, dy) {
  const list = navs(), el = list[focusIdx];
  if (dx && el && el.dataset.param) {
    const opts = [...el.querySelectorAll('.opt')], cur = opts.findIndex((o) => o.classList.contains('sel'));
    act('opt', opts[Math.max(0, Math.min(opts.length - 1, cur + dx))]);
    return;
  }
  focus(focusIdx + (dy || dx));
}
function press() {
  const el = navs()[focusIdx];
  if (!el) return;
  if (el.tagName === 'INPUT') { el.focus(); return; }
  if (el.dataset.act) act(el.dataset.act, el);
}
function back() {
  if (screen === 'create') act(listWorlds().length ? 'worlds' : 'back');
  else if (screen === 'worlds') go('title');
  else if (screen === 'confirm') go('worlds');
}

function onKey(e) {
  if (!menuVisible()) return;
  const typing = document.activeElement && document.activeElement.tagName === 'INPUT';
  if (typing && e.key !== 'Enter' && e.key !== 'Escape' && e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  const k = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] }[e.key];
  if (k) { e.preventDefault(); move(k[0], k[1]); }
  else if (e.key === 'Enter') { e.preventDefault(); if (typing) { document.activeElement.blur(); move(0, 1); } else press(); }
  else if (e.key === 'Escape') { e.preventDefault(); if (typing) document.activeElement.blur(); else back(); }
}

// Appelé à chaque image avec l'état de la manette (fronts montants).
let repeatT = 0;
export function menuPad(p, dt) {
  if (!menuVisible() || !p.connected) return;
  repeatT -= dt;
  const dx = Math.abs(p.x) > 0.5 ? Math.sign(p.x) : 0, dy = Math.abs(p.y) > 0.5 ? Math.sign(p.y) : 0;
  if ((dx || dy) && repeatT <= 0) { move(dy ? 0 : dx, dy); repeatT = 0.22; }
  if (!dx && !dy) repeatT = 0;
  if (p.pressed[0]) press();
  if (p.pressed[1]) back();
}
