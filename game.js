'use strict';
/* =====================================================================
   TIMELINE — jeu de cartes chronologique pour ChadGangGames
   Multijoueur en ligne (2-8) via le SDK du hub, ou « même écran » en secours.
   Modèle : un état complet versionné (keep:true) ; le joueur dont c'est
   le tour calcule son coup et diffuse le nouvel état.
   ===================================================================== */

/* ---------- utilitaires ---------- */
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clone = o => JSON.parse(JSON.stringify(o));
const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
let fast = false; // clic sur l'animation = on accélère
const wait = ms => new Promise(r => setTimeout(r, fast ? Math.min(ms, 40) : ms));
const CAT = {
  his: { n: 'Histoire', c: '#ff6b6b' }, sci: { n: 'Sciences', c: '#2dd4bf' }, inv: { n: 'Inventions', c: '#38bdf8' },
  cul: { n: 'Culture', c: '#c084fc' }, spo: { n: 'Sport', c: '#fb923c' }
};
const REACTS = ['😂', '😱', '👏', '🔥', '🤔', '😭'];
const fmtYear = y => (y < 0 ? `${-y} av. J.-C.` : String(y));
const colorOf = id => { let h = 0; for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) % 360; return `hsl(${h} 65% 45%)`; };
const initial = n => (String(n).trim()[0] || '?').toUpperCase();
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } },
  del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } }
};

/* ---------- sons (WebAudio, aucun fichier) ---------- */
const Snd = {
  ctx: null, on: true,
  init() { this.on = store.get('tl_mute') !== '1'; this.paint(); },
  paint() { $('#btn-mute').textContent = this.on ? '🔊' : '🔇'; },
  toggle() { this.on = !this.on; store.set('tl_mute', this.on ? '0' : '1'); this.paint(); if (this.on) this.pick(); },
  ac() {
    if (!this.ctx) { try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return null; } }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  },
  tone(f, d = .12, type = 'sine', v = .15, at = 0, slide = 0) {
    if (!this.on) return; const a = this.ac(); if (!a) return;
    const t = a.currentTime + at, o = a.createOscillator(), g = a.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, f + slide), t + d);
    g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(.0001, t + d);
    o.connect(g); g.connect(a.destination); o.start(t); o.stop(t + d + .03);
  },
  noise(d = .2, v = .1, at = 0) {
    if (!this.on) return; const a = this.ac(); if (!a) return;
    const n = Math.floor(a.sampleRate * d), buf = a.createBuffer(1, n, a.sampleRate), data = buf.getChannelData(0);
    for (let i = 0; i < n; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const s = a.createBufferSource(), g = a.createGain(); s.buffer = buf; g.gain.value = v;
    s.connect(g); g.connect(a.destination); s.start(a.currentTime + at);
  },
  pick() { this.tone(660, .07, 'square', .05); },
  place() { this.tone(200, .18, 'triangle', .25, 0, -110); this.noise(.08, .08); },
  roll() { for (let i = 0; i < 9; i++) this.tone(260 + i * 45, .06, 'square', .05, i * .1); },
  flip() { this.noise(.25, .12); this.tone(900, .12, 'sine', .08, 0, 700); },
  ok() { [523, 659, 784, 1047, 1319].forEach((f, i) => this.tone(f, .22, 'triangle', .18, i * .07)); },
  ko() { this.tone(240, .55, 'sawtooth', .16, 0, -170); this.tone(170, .55, 'square', .08, .12, -100); },
  turn() { this.tone(880, .12, 'sine', .16); this.tone(1320, .22, 'sine', .16, .11); },
  pop() { this.tone(520, .1, 'sine', .12, 0, 500); },
  win() { [523, 523, 523, 659, 784, 659, 784, 1047].forEach((f, i) => this.tone(f, i > 4 ? .5 : .16, 'triangle', .2, i * .16)); }
};

/* ---------- effets visuels : confettis, feux d'artifice ---------- */
const FX = {
  parts: [], raf: 0, fw: 0,
  init() { this.cv = $('#fx'); this.c = this.cv.getContext('2d'); this.size(); addEventListener('resize', () => this.size()); },
  size() { const d = Math.min(devicePixelRatio || 1, 2); this.cv.width = innerWidth * d; this.cv.height = innerHeight * d; this.c.setTransform(d, 0, 0, d, 0, 0); },
  burst(x, y, n = 70, p = 1) {
    const cols = ['#ffd426', '#ff4757', '#2dd4bf', '#ffffff', '#c084fc', '#38bdf8', '#fb923c'];
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, v = (4 + Math.random() * 9) * p;
      this.parts.push({ k: 'c', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 5 * p, w: 6 + Math.random() * 7, h: 4 + Math.random() * 6,
        r: Math.random() * 6, vr: (Math.random() - .5) * .5, life: 0, max: 70 + Math.random() * 50, col: cols[i % cols.length] });
    }
    this.go();
  },
  rain(n = 80) {
    const cols = ['#ffd426', '#ff4757', '#2dd4bf', '#ffffff', '#c084fc', '#38bdf8'];
    for (let i = 0; i < n; i++) this.parts.push({ k: 'c', x: Math.random() * innerWidth, y: -20 - Math.random() * 250, vx: (Math.random() - .5) * 2, vy: 2 + Math.random() * 3,
      w: 6 + Math.random() * 6, h: 4 + Math.random() * 5, r: Math.random() * 6, vr: (Math.random() - .5) * .3, life: 0, max: 220, col: cols[i % cols.length], g: .04 });
    this.go();
  },
  spark(x, y, col, n = 46) {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2, v = 3 + Math.random() * 4.5;
      this.parts.push({ k: 's', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0, max: 55 + Math.random() * 25, col });
    }
    this.go();
  },
  fireworks(ms = 6000) {
    this.stop(); const cols = ['#ffd426', '#ff4757', '#2dd4bf', '#ffffff', '#c084fc', '#38bdf8'];
    const shoot = () => { this.spark(innerWidth * (.12 + Math.random() * .76), innerHeight * (.12 + Math.random() * .4), cols[Math.floor(Math.random() * cols.length)]); };
    shoot(); this.rain(70);
    this.fw = setInterval(() => { shoot(); if (Math.random() < .4) this.rain(25); }, 420);
    this.fwEnd = setTimeout(() => this.stop(), ms);
  },
  stop() { clearInterval(this.fw); clearTimeout(this.fwEnd); this.fw = 0; },
  go() { if (!this.raf) this.raf = requestAnimationFrame(() => this.tick()); },
  tick() {
    const c = this.c; c.clearRect(0, 0, innerWidth, innerHeight);
    this.parts = this.parts.filter(p => p.life < p.max && p.y < innerHeight + 40);
    for (const p of this.parts) {
      p.life++; p.x += p.vx; p.y += p.vy;
      if (p.k === 'c') {
        p.vy += p.g || .25; p.vx *= .99; p.r += p.vr;
        c.save(); c.globalAlpha = Math.min(1, (p.max - p.life) / 20); c.translate(p.x, p.y); c.rotate(p.r); c.fillStyle = p.col;
        c.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); c.restore();
      } else {
        p.vy += .08; p.vx *= .97; p.vy *= .97;
        c.globalAlpha = Math.max(0, 1 - p.life / p.max); c.fillStyle = p.col; c.beginPath(); c.arc(p.x, p.y, 2.6 * (1 - p.life / p.max) + 1, 0, 7); c.fill();
      }
    }
    c.globalAlpha = 1;
    this.raf = this.parts.length ? requestAnimationFrame(() => this.tick()) : 0;
  }
};
function shake() { const a = $('#app'); a.classList.remove('shake'); void a.offsetWidth; a.classList.add('shake'); }
function flash(kind) { const f = $('#flash'); f.className = ''; void f.offsetWidth; f.className = kind; }
let toastT = 0;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2600); }
function vib(p) { try { navigator.vibrate && navigator.vibrate(p); } catch (e) { /* ignore */ } }

/* ---------- état global ---------- */
const Net = { online: false, local: false, room: null, me: null, players: [], conn: null, profile: null };
let S = null;          // dernier état connu (autoritaire)
let V = null;          // état affiché (retardé pendant les animations)
let sel = null;        // carte sélectionnée dans la main
let pend = null;       // emplacement choisi (en attente de validation)
let fresh = null;      // carte qui vient d'être posée (animation)
let dinged = 0, overShown = null, reported = null, hideOver = false;
let localNames = ['Joueur 1', 'Joueur 2'];

const isSpectator = () => Net.online && !(V && V.order.includes(Net.me));
const curId = () => (V && V.phase === 'play' ? V.order[V.cur] : null);
const myId = () => (Net.online ? Net.me : curId());
const isMyTurn = () => !!V && V === S && V.phase === 'play' && !isSpectator() && curId() === myId();
const myHand = () => { const id = myId(); return V && id && V.hands[id] ? V.hands[id] : []; };

/* ---------- logique du jeu ---------- */
function newGame(list) {
  const deck = shuffle(CARDS.map(c => c.id));
  const n = list.length, size = n <= 3 ? 6 : n <= 5 ? 5 : 4; // règle officielle
  const tl = [deck.pop()];
  const hands = {}, stats = {}, names = {};
  list.forEach(p => { hands[p.id] = deck.splice(0, size); stats[p.id] = { ok: 0, ko: 0, streak: 0, best: 0 }; names[p.id] = p.name; });
  return { ver: 0, phase: 'play', gid: `${Net.room || 'LOCAL'}-${Date.now().toString(36)}`, names, order: shuffle(list.map(p => p.id)),
    cur: 0, round: 1, tl, hands, deck, stats, last: null, win: null, note: null };
}

function advance(s) {
  s.cur++;
  if (s.cur >= s.order.length) { // fin de manche : tout le monde a joué autant
    s.cur = 0;
    const winners = s.order.filter(id => s.hands[id].length === 0);
    if (winners.length) { s.phase = 'over'; s.win = winners; return; }
    s.round++;
  }
}

function doMove(cid, slot) {
  if (!isMyTurn()) return;
  const s = clone(S), pid = s.order[s.cur], card = CARDS[cid];
  if (!s.hands[pid].includes(cid)) return;
  const left = slot > 0 ? CARDS[s.tl[slot - 1]].y : -Infinity;
  const right = slot < s.tl.length ? CARDS[s.tl[slot]].y : Infinity;
  const ok = left <= card.y && card.y <= right;
  const L = { n: (S.last ? S.last.n : 0) + 1, p: pid, c: cid, l: slot > 0 ? s.tl[slot - 1] : null, r: slot < s.tl.length ? s.tl[slot] : null, ok, draw: null };
  s.hands[pid] = s.hands[pid].filter(x => x !== cid);
  const st = s.stats[pid];
  if (ok) { s.tl.splice(slot, 0, cid); st.ok++; st.streak++; st.best = Math.max(st.best, st.streak); }
  else { st.ko++; st.streak = 0; if (s.deck.length) { L.draw = s.deck.pop(); s.hands[pid].push(L.draw); } }
  s.last = L;
  advance(s);
  commit(s);
}

function commit(s, note) {
  s.ver = (S ? S.ver : 0) + 1;
  s.note = note ? { v: s.ver, t: note } : null;
  if (Net.online && Net.conn) {
    const msg = { t: 'state', s };
    if (JSON.stringify(msg).length > 11500) { s.deck = s.deck.slice(0, 40); } // sécurité taille (12 Ko max)
    Net.conn.send(msg, { keep: true });
  }
  receive(s);
}

/* L'hôte (premier de la liste) fait passer le tour d'un joueur parti. */
let skipTimer = 0;
function checkAbsent() {
  clearTimeout(skipTimer);
  if (!Net.online || !S || S.phase !== 'play' || !Net.players.length || Net.players[0].id !== Net.me) return;
  const pid = S.order[S.cur];
  if (Net.players.some(p => p.id === pid)) return;
  skipTimer = setTimeout(() => {
    if (!S || S.phase !== 'play' || S.order[S.cur] !== pid || Net.players.some(p => p.id === pid) || Net.players[0].id !== Net.me) return;
    const s = clone(S); advance(s);
    commit(s, `${S.names[pid]} est parti : on passe son tour`);
  }, 5000);
}

/* ---------- réception d'un état + file d'animation ---------- */
function receive(s) {
  if (!s || typeof s.ver !== 'number') return;
  if (S && s.ver <= S.ver) return;
  S = s; pump();
}

let pumping = false;
async function pump() {
  if (pumping) return; pumping = true;
  try {
    while (V !== S) {
      const T = S;
      const needs = V && V.phase === 'play' && T.phase !== 'lobby' && T.gid === V.gid && T.last && (!V.last || T.last.n > V.last.n);
      if (needs) await playReveal(T.last, T);
      V = T; sel = null; pend = null; hideOver = false;
      fresh = T.last && T.last.ok && needs ? T.last.c : null;
      if (fresh !== null) setTimeout(() => { fresh = null; }, 1600);
      render(); after();
    }
  } finally { pumping = false; }
}

function after() {
  if (V.phase === 'play') {
    if (isMyTurn() && dinged !== V.ver) { dinged = V.ver; Snd.turn(); vib(80); }
    if (V.note && V.note.v === V.ver) toast(V.note.t);
    checkAbsent();
  }
  if (V.phase === 'over' && overShown !== V.gid) {
    overShown = V.gid; Snd.win(); FX.fireworks(7000); vib([80, 60, 160]);
    report();
  }
}

/* Classement du hub : un appel par joueur et par partie terminée */
function report() {
  if (!Net.online || !window.ChadGang || !ChadGang.finPartie || !V || !V.order.includes(Net.me) || reported === V.gid) return;
  reported = V.gid;
  try {
    ChadGang.finPartie({ gagne: V.win.includes(Net.me), partie: V.gid, score: V.stats[Net.me].ok })
      .then(r => { if (r && r.record) toast('🏆 Nouveau record du hub !'); }).catch(() => {});
  } catch (e) { /* ignore */ }
}

/* ---------- rendu ---------- */
function avatar(id, name) {
  const mine = Net.online && id === Net.me && Net.profile && Net.profile.avatar;
  if (mine) return `<img class="av" data-chadgang-id="${esc(id)}" src="${esc(Net.profile.avatar)}" alt="">`;
  return `<span class="av" data-chadgang-id="${esc(id)}" style="background:${colorOf(id)}">${esc(initial(name))}</span>`;
}

function cardHtml(cid, o = {}) {
  const c = CARDS[cid], cat = CAT[c.c], y = o.hide ? '????' : fmtYear(c.y);
  return `<div class="card ${o.cls || ''}" data-id="${cid}" style="--cat:${cat.c}"><div class="yr${y.length > 6 ? ' long' : ''}">${y}</div>` +
    `<div class="em">${c.e}</div><div class="tt">${esc(c.t)}</div><div class="ct">${cat.n}</div></div>`;
}

const VIEWS = ['home', 'local', 'lobby', 'game'];
function showView(name) { VIEWS.forEach(v => { $('#v-' + v).hidden = v !== name; }); }

function render() {
  const inGame = V && V.phase !== 'lobby';
  const name = inGame ? 'game' : Net.online ? 'lobby' : Net.local ? 'local' : 'home';
  showView(name);
  $('#roomchip').hidden = !Net.online; $('#roomchip').textContent = Net.online ? `🔑 ${Net.room}` : '';
  $('#btn-react').hidden = !(Net.online && inGame);
  $('#btn-quit').hidden = !(Net.online || Net.local);
  if (!inGame) $('#reactbar').hidden = true;
  if (name === 'home') renderHome();
  else if (name === 'local') renderLocal();
  else if (name === 'lobby') renderLobby();
  else renderGame();
}

function renderHome() {
  const el = $('#v-home'), hub = !!window.ChadGang, prev = store.get('tl_room');
  el.className = 'view scroll';
  el.innerHTML = `<div class="panel">
    <div class="hero">⏳</div><h1>TIMELINE</h1>
    <p>Place tes cartes dans le bon ordre chronologique.<br>Le premier à vider sa main gagne !</p>
    ${hub ? `<p style="color:var(--ink)">Salut <b>${esc(Net.profile ? Net.profile.name : 'toi')}</b> 👋</p>
      <button class="btn" data-act="create">🎲 Créer une salle</button>
      <div class="row-in"><input id="code" maxlength="12" placeholder="CODE" autocomplete="off"><button class="btn blue" data-act="join">Rejoindre</button></div>
      ${prev ? `<button class="btn alt" data-act="resume">↩️ Reprendre la salle ${esc(prev)}</button>` : ''}`
      : `<p class="err">Hors du hub : pas de partie en ligne.</p>`}
    <button class="btn alt" data-act="local">🛋️ Même écran (sans classement)</button>
    <div class="err" id="err"></div>
    <details><summary>Comment jouer ?</summary><ul>
      <li>Une carte est déjà sur la frise, <b>date visible</b>.</li>
      <li>À ton tour, choisis une carte de ta main (sa date est cachée) et place-la <b>au bon endroit</b> dans la frise.</li>
      <li>On révèle la date : bien placée, elle reste ; sinon elle est défaussée et tu <b>pioches une carte</b>.</li>
      <li>Dès qu’un joueur n’a plus de cartes à la fin d’une manche, il gagne (égalité possible).</li>
    </ul></details></div>`;
}

function renderLocal() {
  const el = $('#v-local');
  el.className = 'view scroll';
  el.innerHTML = `<div class="panel"><h2>🛋️ Même écran</h2><p>On se passe l’appareil. Pas de classement du hub.</p>
    <div class="plist">${localNames.map((n, i) => `<div class="pitem"><span class="av" style="background:${colorOf('L' + i)}">${esc(initial(n))}</span>
      <input data-i="${i}" maxlength="14" value="${esc(n)}" aria-label="Pseudo">${localNames.length > 1 ? `<button class="x" data-act="rm" data-i="${i}">✖</button>` : ''}</div>`).join('')}</div>
    ${localNames.length < 6 ? '<button class="btn alt" data-act="add">➕ Ajouter un joueur</button>' : ''}
    <button class="btn" data-act="start-local">🚀 Lancer la partie</button></div>`;
}

function renderLobby() {
  const el = $('#v-lobby'), host = Net.players[0] && Net.players[0].id === Net.me, n = Net.players.length;
  el.className = 'view scroll';
  el.innerHTML = `<div class="panel"><h2>Salle d’attente</h2>
    <div class="code-big">${esc(Net.room)}</div>
    <p>Invite tes potes avec le bouton <b>Inviter</b> du hub, ou donne-leur ce code.</p>
    <div class="plist">${Net.players.map((p, i) => `<div class="pitem">${avatar(p.id, p.name)}<b>${esc(p.name)}</b>${i === 0 ? '<small>👑 hôte</small>' : ''}${p.id === Net.me ? '<small>toi</small>' : ''}</div>`).join('')}</div>
    <p>${n} joueur${n > 1 ? 's' : ''} · ${n >= 2 ? `${n <= 3 ? 6 : n <= 5 ? 5 : 4} cartes chacun` : 'il faut au moins 2 joueurs'}</p>
    ${host ? `<button class="btn" data-act="start" ${n < 2 ? 'disabled' : ''}>🚀 Lancer la partie</button>` : '<p>⏳ L’hôte lance la partie…</p>'}
    <details><summary>Comment jouer ?</summary><ul>
      <li>Choisis une carte, puis touche l’endroit de la frise où elle va.</li>
      <li>Touche une seconde fois (ou ✔ VALIDER) pour confirmer.</li>
      <li>Raté = carte perdue + pénalité. Main vide = victoire !</li></ul></details></div>`;
}

function renderGame() {
  renderPlayers(); renderTurn(); renderTimeline(); renderHand(); renderOver();
}

function renderPlayers() {
  $('#players').innerHTML = V.order.map((id, i) => {
    const n = V.names[id], cnt = V.hands[id].length, st = V.stats[id];
    const act = V.phase === 'play' && i === V.cur, gone = Net.online && !Net.players.some(p => p.id === id);
    return `<div class="pl${act ? ' act' : ''}${gone ? ' gone' : ''}${id === Net.me ? ' me' : ''}${cnt === 1 ? ' last1' : ''}${cnt === 0 ? ' zero' : ''}">` +
      `${avatar(id, n)}<div class="pn"><b>${esc(n)}</b><small>${st.streak >= 2 ? '🔥×' + st.streak : gone ? 'absent' : cnt === 1 ? '⚠️ 1 carte !' : ''}</small></div>` +
      `<span class="cnt">${cnt === 0 ? '🏁' : cnt}</span></div>`;
  }).join('');
}

function renderTurn() {
  const el = $('#turnbar');
  if (V.phase !== 'play') { el.innerHTML = '<div class="tb">🏁 Partie terminée</div>'; return; }
  const who = V.names[curId()];
  if (isMyTurn()) {
    const lead = Net.online ? 'À TOI !' : `${esc(who)}, à toi !`;
    if (sel === null) el.innerHTML = `<div class="tb mine">🎯 <b>${lead}</b> Choisis une carte de ta main</div>`;
    else if (pend === null) el.innerHTML = '<div class="tb mine">👆 Touche l’endroit où la placer dans la frise</div>';
    else el.innerHTML = '<button class="tb go" data-act="go">✔ VALIDER</button>';
  } else {
    el.innerHTML = isSpectator() ? `<div class="tb">👀 Tu regardes · tour de <b>${esc(who)}</b></div>` : `<div class="tb">⏳ Tour de <b>${esc(who)}</b>…</div>`;
  }
}

function renderTimeline() {
  const on = isMyTurn() && sel !== null;
  const slot = i => `<button class="slot${on ? ' on' : ''}${pend === i ? ' pick' : ''}" data-i="${i}" aria-label="Placer ici" ${on ? '' : 'tabindex="-1"'}><span>${pend === i ? '✔' : '+'}</span></button>`;
  let h = '';
  V.tl.forEach((cid, i) => { h += slot(i) + cardHtml(cid, { cls: cid === fresh ? 'drop' : '' }); });
  $('#timeline').innerHTML = h + slot(V.tl.length);
  if (fresh !== null) { const el = $(`#timeline .card[data-id="${fresh}"]`); if (el) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
}

function renderHand() {
  const h = myHand(), mine = isMyTurn();
  $('#hand').innerHTML = h.length ? h.map(cid => cardHtml(cid, { hide: true, cls: 'hand' + (sel === cid ? ' sel' : '') })).join('')
    : `<div class="nohand">${isSpectator() ? '👀 Tu regardes la partie, tu joueras à la prochaine !' : V.phase === 'play' ? '🏁 Plus de cartes !' : ''}</div>`;
  $('#handwrap').classList.toggle('dim', !mine);
}

function renderOver() {
  const box = $('#over'), btn = $('#btn-results');
  if (V.phase !== 'over') { box.hidden = true; btn.hidden = true; return; }
  box.hidden = hideOver; btn.hidden = !hideOver;
  const win = V.win, me = myId(), iWon = Net.online && win.includes(me);
  const host = !Net.online || (Net.players[0] && Net.players[0].id === Net.me);
  const rank = V.order.slice().sort((a, b) => V.hands[a].length - V.hands[b].length || V.stats[b].ok - V.stats[a].ok);
  box.innerHTML = `<div class="panel"><div class="trophy">🏆</div>
    <h1>${win.length > 1 ? 'ÉGALITÉ !' : 'VICTOIRE !'}</h1>
    <div class="winners">${win.map(id => `<div class="wn">${avatar(id, V.names[id])}${esc(V.names[id])}</div>`).join('')}</div>
    <p>${iWon ? 'C’est toi le boss de la chronologie 🔥' : 'Une revanche, pour la gloire ?'}</p>
    <table class="rank">${rank.map((id, i) => `<tr><td>${i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1 + '.'}</td><td>${esc(V.names[id])}</td>
      <td>${V.hands[id].length} carte${V.hands[id].length > 1 ? 's' : ''} · ${V.stats[id].ok} ✔ · série ${V.stats[id].best}</td></tr>`).join('')}</table>
    ${host ? '<button class="btn" data-act="again">🔁 Rejouer</button>' : '<p>⏳ L’hôte peut relancer une partie…</p>'}
    <button class="btn alt" data-act="hide-over">👀 Voir la frise</button></div>`;
}

/* ---------- révélation épique ---------- */
async function playReveal(L, T) {
  const ov = $('#overlay'), c = CARDS[L.c], who = T.names[L.p] || '?';
  const nb = (id, side) => id == null ? `<div class="nbph">${side < 0 ? '⏪<br>avant<br>tout' : 'après<br>tout<br>⏩'}</div>` : cardHtml(id, { cls: 'nb' });
  fast = false; ov.className = '';
  ov.innerHTML = `<div class="stage"><div class="who"><b>${esc(who)}</b> place<br>« ${esc(c.t)} »</div>
    <div class="rrow">${nb(L.l, -1)}
      <div class="flipper"><div class="fi">
        <div class="face fr">${cardHtml(L.c, { hide: true })}</div>
        <div class="face bk">${cardHtml(L.c, { cls: L.ok ? 'good' : 'bad' })}</div>
      </div></div>${nb(L.r, 1)}</div>
    <div class="verdict" id="verdict"></div><div class="skip">touche pour accélérer</div></div>`;
  ov.hidden = false;
  ov.onclick = () => { fast = true; };
  Snd.place(); await wait(650);
  ov.classList.add('roll'); Snd.roll(); await wait(950);
  ov.classList.remove('roll'); ov.classList.add('rev'); Snd.flip(); await wait(750);
  const st = T.stats[L.p], left = T.hands[L.p].length, v = $('#verdict', ov);
  const r = $('.flipper', ov).getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
  if (L.ok) {
    const bits = [];
    if (st.streak >= 2) bits.push(`🔥 Combo ×${st.streak} !`);
    if (left === 0) bits.push('🏁 Main vidée !'); else if (left === 1) bits.push('⚠️ Plus qu’une carte !');
    v.innerHTML = `<div class="stamp ok">✔ BIEN JOUÉ !</div><div class="sub">${bits.join(' ')}</div>`;
    Snd.ok(); flash('ok'); vib(40);
    FX.burst(x, y, 60 + Math.min(st.streak, 5) * 25, 1 + Math.min(st.streak, 5) * .12);
    if (left === 0) setTimeout(() => FX.burst(innerWidth / 2, innerHeight / 3, 140, 1.5), 300);
  } else {
    v.innerHTML = `<div class="stamp ko">✘ RATÉ !</div><div class="sub">C’était en <b>${fmtYear(c.y)}</b>${L.draw != null ? '<br>+1 carte de pénalité 😬' : ''}</div>`;
    Snd.ko(); flash('ko'); shake(); vib([120, 50, 120]);
  }
  await wait(L.ok ? 1700 : 2200);
  ov.hidden = true; ov.innerHTML = ''; ov.onclick = null;
}

/* ---------- réactions ---------- */
let lastReact = 0;
function floatReact(e, name) {
  if (!REACTS.includes(e)) return;
  const el = document.createElement('div'); el.className = 'react'; el.style.left = (6 + Math.random() * 78) + '%';
  el.innerHTML = `<span>${e}</span><small>${esc(name || '')}</small>`;
  $('#reacts').appendChild(el); setTimeout(() => el.remove(), 2500); Snd.pop();
}
function sendReact(e) {
  if (Date.now() - lastReact < 400 || !Net.conn) return; lastReact = Date.now();
  Net.conn.send({ t: 'react', e }); // éphémère : pas de keep
}

/* ---------- réseau ---------- */
function extractState(x) {
  if (!x || typeof x !== 'object') return null;
  if (x.s && typeof x.s.ver === 'number') return x.s;
  if (typeof x.ver === 'number' && x.order) return x;
  return x.data ? extractState(x.data) : null;
}

function connect(code, create) {
  code = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
  if (code.length < 4) { setErr('Le code fait 4 à 12 lettres ou chiffres.'); return; }
  leaveRoom(true);
  Net.online = true; Net.room = code; Net.me = null; Net.players = [];
  let r;
  try { r = ChadGang.join(code, { create }); } catch (e) { Net.online = false; setErr('Impossible de rejoindre la salle.'); return; }
  Net.conn = r;
  r.on('ready', info => {
    Net.me = info.me; Net.players = info.players || Net.players;
    store.set('tl_room', code);
    const st = extractState(info.last);
    if (st && (!S || st.ver > S.ver)) { if (!S) { S = st; V = null; } else receive(st); pump(); }
    render();
  });
  r.on('players', list => { Net.players = list || []; if (V || S) { render(); checkAbsent(); } else render(); });
  r.on('message', (d, from) => {
    if (!d) return;
    if (d.t === 'state') receive(d.s);
    else if (d.t === 'react' && from && from.id !== Net.me) floatReact(d.e, from.name);
  });
  r.on('error', msg => {
    const m = String(msg || 'Erreur de salle');
    leaveRoom(true); store.del('tl_room'); render(); setErr(/introuvable|exist|found/i.test(m) ? 'Salle introuvable : vérifie le code.' : m);
  });
  render();
}

function leaveRoom(silent) {
  try { if (Net.conn) Net.conn.leave(); } catch (e) { /* ignore */ }
  Net.conn = null; Net.online = false; Net.local = false; Net.room = null; Net.players = [];
  S = null; V = null; sel = pend = fresh = null; hideOver = false; FX.stop(); clearTimeout(skipTimer);
  $('#overlay').hidden = true; $('#over').hidden = true;
  if (!silent) render();
}

function setErr(m) { const e = $('#err'); if (e) e.textContent = m; else toast(m); }
const randCode = () => { const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; let c = ''; for (let i = 0; i < 4; i++) c += a[Math.floor(Math.random() * a.length)]; return c; };

/* ---------- interactions ---------- */
function onClick(e) {
  const t = e.target;
  const act = t.closest('[data-act]');
  if (act) return action(act.dataset.act, act);
  const card = t.closest('.card.hand');
  if (card) { if (!isMyTurn()) return; const id = +card.dataset.id; sel = sel === id ? null : id; pend = null; Snd.pick(); renderTurn(); renderTimeline(); renderHand(); return; }
  const slot = t.closest('.slot');
  if (slot && isMyTurn() && sel !== null) {
    const i = +slot.dataset.i;
    if (pend === i) return doMove(sel, i);
    pend = i; Snd.pick(); renderTurn(); renderTimeline();
  }
}

function action(a, el) {
  if (a === 'create') connect(randCode(), true);
  else if (a === 'join') connect($('#code').value, false);
  else if (a === 'resume') connect(store.get('tl_room'), true);
  else if (a === 'local') { Net.local = true; render(); }
  else if (a === 'add') { syncLocalNames(); localNames.push('Joueur ' + (localNames.length + 1)); renderLocal(); }
  else if (a === 'rm') { syncLocalNames(); localNames.splice(+el.dataset.i, 1); renderLocal(); }
  else if (a === 'start-local') {
    syncLocalNames();
    const list = localNames.map((n, i) => ({ id: 'L' + i, name: n.trim() || 'Joueur ' + (i + 1) }));
    S = null; V = null; commit(newGame(list));
  } else if (a === 'start') {
    if (Net.players.length >= 2 && Net.players[0].id === Net.me) commit(newGame(Net.players.map(p => ({ id: p.id, name: p.name }))));
  } else if (a === 'go') { if (sel !== null && pend !== null) doMove(sel, pend); }
  else if (a === 'again') {
    FX.stop(); overShown = null;
    commit({ phase: 'lobby', order: [], gid: null });
    if (!Net.online) { S = null; V = null; render(); }
  } else if (a === 'hide-over') { hideOver = true; renderOver(); }
}

function syncLocalNames() { document.querySelectorAll('#v-local input[data-i]').forEach(i => { localNames[+i.dataset.i] = i.value; }); }

/* ---------- démarrage ---------- */
async function boot() {
  Snd.init(); FX.init();
  document.addEventListener('click', onClick);
  $('#btn-mute').onclick = () => Snd.toggle();
  $('#btn-results').onclick = () => { hideOver = false; renderOver(); };
  let quitArm = 0; // double appui pour quitter (pas de popup dans l'iframe)
  $('#btn-quit').onclick = () => {
    const b = $('#btn-quit');
    if (!quitArm) { quitArm = setTimeout(() => { quitArm = 0; b.textContent = '🚪'; }, 3000); b.textContent = '❓'; toast('Touche encore 🚪 pour quitter'); return; }
    clearTimeout(quitArm); quitArm = 0; b.textContent = '🚪'; leaveRoom(true); store.del('tl_room'); render();
  };
  $('#roomchip').onclick = () => { try { navigator.clipboard.writeText(Net.room); toast('Code copié : ' + Net.room); } catch (e) { toast('Code : ' + Net.room); } };
  $('#btn-react').onclick = () => { const b = $('#reactbar'); b.hidden = !b.hidden; };
  $('#reactbar').innerHTML = REACTS.map(r => `<button data-r="${r}">${r}</button>`).join('');
  $('#reactbar').onclick = e => { const b = e.target.closest('button'); if (b) { sendReact(b.dataset.r); floatReact(b.dataset.r, 'toi'); } };
  document.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.id === 'code') action('join'); });
  if (window.ChadGang) {
    try { Net.profile = await ChadGang.me(); } catch (e) { /* mode secours */ }
    if (Net.profile && Net.profile.name) localNames[0] = Net.profile.name;
    let inv = null; try { inv = ChadGang.room && ChadGang.room(); } catch (e) { /* ignore */ }
    if (inv) { connect(inv, true); return; }
  }
  render();
}
boot();
