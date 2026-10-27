// Manette (API Gamepad, disposition "standard") : contrôles intégrés de l'AYN Thor,
// manettes Xbox / PlayStation / Switch branchées sur PC ou Android.
//
//   stick gauche          : bouger         A (bas)    : sauter
//   croix                 : barre d'objets (gauche/droite), utiliser (haut), sac (bas) ; menus
//   X (gauche)            : coup (maintenir = coup chargé)
//   Y (haut)              : frappe au sol (maintenir pour charger)
//   B (droite), R2, L3    : sprint (maintenir)
//   R1                    : prendre / lancer (maintenir = viser)
//   L1                    : flairer
//   Select                : couper le son
//   Start                 : retour à l'accueil
const DEAD = 0.2;
const prev = [];

export const pad = {
  connected: false, x: 0, y: 0, sx: 0, sy: 0,
  sprint: false, charge: false, punch: false, grab: false,
  jumpPressed: false, punchPressed: false, mutePressed: false, sniffPressed: false, grabPressed: false, any: false,
};

let active = null; // la manette utilisée en dernier

const down = (gp, i) => !!(gp.buttons[i] && (gp.buttons[i].pressed || gp.buttons[i].value > 0.5));

export function pollPad() {
  pad.jumpPressed = pad.punchPressed = pad.mutePressed = pad.sniffPressed = pad.startPressed = pad.grabPressed = pad.any = false;
  pad.pressed = [];
  const list = navigator.getGamepads ? navigator.getGamepads() : [];
  let gp = null;
  for (const g of list) {
    if (!g || !g.connected) continue;
    // on prend celle sur laquelle on appuie, sinon la première
    if (!gp) gp = g;
    if (g.buttons.some((b) => b.pressed) || Math.hypot(g.axes[0] || 0, g.axes[1] || 0) > DEAD) { gp = g; break; }
  }
  pad.connected = !!gp;
  if (!gp) { pad.x = pad.y = pad.sx = pad.sy = 0; pad.sprint = pad.charge = pad.punch = pad.grab = false; return pad; }
  active = gp;

  // stick avec zone morte radiale, croix en secours
  let x = gp.axes[0] || 0, y = gp.axes[1] || 0;
  const m = Math.hypot(x, y);
  if (m < DEAD) { x = 0; y = 0; } else { const k = Math.min(1, (m - DEAD) / (1 - DEAD)) / m; x *= k; y *= k; }
  pad.sx = x; pad.sy = y; // le stick seul (en jeu, la croix sert à la barre d'objets)
  if (down(gp, 14)) x = -1;
  if (down(gp, 15)) x = 1;
  if (down(gp, 12)) y = -1;
  if (down(gp, 13)) y = 1;
  if ((down(gp, 12) || down(gp, 13)) && (down(gp, 14) || down(gp, 15))) { x *= Math.SQRT1_2; y *= Math.SQRT1_2; }
  pad.x = x; pad.y = y;

  const was = prev[gp.index] || [];
  const now = gp.buttons.map((_, i) => down(gp, i));
  const pressed = (i) => now[i] && !was[i];
  pad.sprint = now[1] || now[7] || now[10];
  pad.grab = now[5];
  pad.grabPressed = pressed(5);
  pad.charge = now[3] || now[6];
  pad.punch = now[2];
  pad.a = now[0]; // A maintenu (mode BÂTIR : creuser en promenant le viseur)
  pad.jumpPressed = pressed(0);
  pad.punchPressed = pressed(2);
  pad.mutePressed = pressed(8);
  pad.sniffPressed = pressed(4);
  pad.startPressed = pressed(9);
  pad.pressed = now.map((_, i) => pressed(i)); // fronts montants de tous les boutons (menus)
  pad.any = now.some(Boolean) || m > DEAD;
  prev[gp.index] = now;
  return pad;
}

// Vibration (Chrome Android / PC). Silencieux si la manette ne sait pas vibrer.
let lastRumble = 0;
export function rumble(strength, ms) {
  if (!active || !active.vibrationActuator) return;
  const now = performance.now();
  if (now - lastRumble < 40) return;
  lastRumble = now;
  try {
    active.vibrationActuator.playEffect('dual-rumble', {
      duration: ms, strongMagnitude: Math.min(1, strength), weakMagnitude: Math.min(1, strength * 0.7),
    }).catch(() => {});
  } catch (e) { /* non supporté */ }
}
