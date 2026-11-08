/**
 * Boot sequence: fetch the campaign from the Go back end, wire the engine to
 * the DOM, join the live defence net, and run the menu -> level -> score
 * submission loop.
 */

import { audio } from './audio.js';
import { net } from './net.js';
import { Game, STATES } from './game.js';
import { UI, esc, fmt } from './ui.js';

const STORE = {
  name: 'starinvaders.name',
  best: 'starinvaders.best',
  muted: 'starinvaders.muted',
  unlocked: 'starinvaders.unlocked',
};

function load(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v;
  } catch { return fallback; }
}
function save(key, value) {
  try { localStorage.setItem(key, String(value)); } catch { /* private mode */ }
}

const state = {
  name: (load(STORE.name, '') || '').toUpperCase(),
  best: parseInt(load(STORE.best, '0'), 10) || 0,
  muted: load(STORE.muted, '0') === '1',
  unlocked: Math.max(1, parseInt(load(STORE.unlocked, '1'), 10) || 1),
  players: [],
  feed: [],
  chat: [],
  selfId: null,
  campaign: null,
  clearTimer: null,
  submitting: false,
};

const ui = new UI();
let game = null;

/* ------------------------------------------------------------------ helpers */

function randomHandle() {
  const a = ['NOVA', 'ORION', 'VEGA', 'KITE', 'ZERO', 'ECHO', 'RAVEN', 'ATLAS', 'HALO', 'DELTA'];
  return `${a[Math.floor(Math.random() * a.length)]}-${Math.floor(Math.random() * 90 + 10)}`;
}

function threatsFor(level) {
  const counts = new Map();
  for (const w of level.waves) {
    const a = state.campaign.archetypes[w.archetype];
    if (!a) continue;
    const prev = counts.get(a.id) || { name: a.name, color: a.color, count: 0 };
    prev.count += w.count || 1;
    counts.set(a.id, prev);
  }
  for (const h of level.hazards || []) {
    const a = state.campaign.archetypes[h.archetype];
    if (!a || counts.has(a.id)) continue;
    counts.set(a.id, { name: a.name, color: a.color, count: 0 });
  }
  return Array.from(counts.values());
}

function currentName() {
  const el = document.getElementById('pilotName');
  const raw = (el?.value ?? state.name ?? '').trim().toUpperCase();
  const name = raw || randomHandle();
  if (name !== state.name) {
    state.name = name;
    save(STORE.name, name);
  }
  return name;
}

async function refreshLeaderboard(highlightId = null) {
  const data = await net.loadScores(20);
  ui.renderLeaderboard(data.scores, {
    myId: highlightId,
    total: data.total,
    offline: !!data.offline,
  });
  return data.scores || [];
}

/* -------------------------------------------------------------- menu flow */

function showMenu() {
  if (state.clearTimer) { clearInterval(state.clearTimer); state.clearTimer = null; }
  ui.setHudVisible(false);
  game.showMenu();
  net.loadScores(3).then((d) => {
    ui.menu({
      name: state.name || randomHandle(),
      best: state.best,
      online: net.online,
      top: d.scores || [],
      levelCount: state.campaign.levels.length,
      canResume: state.unlocked > 1,
    });
    wireMenuButtons();
  });
  ui.renderLevels(state.campaign.levels, 0);
}

function wireMenuButtons() {
  // Capture the handle as it is typed. Reading it only when Launch is
  // pressed loses it the moment the panel is replaced - going via Level
  // select used to file the run under the previous pilot's name.
  const nameInput = document.getElementById('pilotName');
  nameInput?.addEventListener('input', () => {
    const typed = nameInput.value.trim().toUpperCase();
    if (!typed) return;
    state.name = typed;
    save(STORE.name, typed);
    net.presence({ name: typed, level: 0, score: 0, lives: 0, status: 'lobby' });
  });

  document.getElementById('btnStart')?.addEventListener('click', () => startGame(1));
  document.getElementById('btnPractice')?.addEventListener('click', async () => {
    currentName();              // commit whatever is in the field first
    await audio.unlock();
    audio.uiClick();
    ui.levelSelect({ levels: state.campaign.levels, unlocked: state.unlocked });
    document.getElementById('btnBackMenu')?.addEventListener('click', () => { audio.uiBack(); showMenu(); });
    document.querySelectorAll('[data-level]').forEach((b) => {
      b.addEventListener('click', () => startGame(parseInt(b.dataset.level, 10) || 1));
    });
  });
}

async function startGame(level) {
  const name = currentName();
  await audio.unlock();
  audio.setMuted(state.muted);
  audio.uiClick();
  ui.hideOverlay();
  ui.setHudVisible(true);
  await net.startRun(name, level);
  net.presence({ name, level, score: 0, lives: game.rules.startingLives, status: 'playing' });
  game.best = state.best;
  game.newGame(level);
}

/* ------------------------------------------------------------------- hooks */

const hooks = {
  onHud(d) {
    ui.renderHud(d);
    if (d.force || Math.random() < 0.08) {
      net.presence({
        name: state.name, level: d.level, score: d.score, lives: d.lives,
        status: d.state === STATES.PLAYING || d.state === STATES.INTRO ? 'playing'
          : d.state === STATES.VICTORY ? 'victory'
            : d.state === STATES.GAME_OVER ? 'dead' : 'lobby',
      });
    }
  },

  onToast(text, kind) { ui.toast(text, kind); },

  onLevelIntro(level, number) {
    ui.intro({
      level, number,
      levelCount: state.campaign.levels.length,
      threats: threatsFor(level),
      lives: game.stats.lives,
      score: game.stats.score,
    });
    ui.renderLevels(state.campaign.levels, number);
  },

  onLevelBegin() { ui.hideOverlay(); },

  onLevelClear(info) {
    ui.markCleared(info.level);
    if (info.level + 1 > state.unlocked) {
      state.unlocked = Math.min(state.campaign.levels.length, info.level + 1);
      save(STORE.unlocked, state.unlocked);
    }
    ui.renderLevels(state.campaign.levels, info.level);

    let countdown = 5;
    const draw = () => ui.levelClear({ ...info, countdown });
    draw();
    const advance = () => {
      if (state.clearTimer) { clearInterval(state.clearTimer); state.clearTimer = null; }
      ui.hideOverlay();
      game.nextLevel();
    };
    document.getElementById('btnNext')?.addEventListener('click', advance);
    state.clearTimer = setInterval(() => {
      countdown -= 1;
      if (countdown <= 0) { advance(); return; }
      const btn = document.getElementById('btnNext');
      if (btn && !info.isLast) btn.textContent = `Next level (${countdown})`;
    }, 1000);
  },

  onPause(paused) {
    if (paused) {
      ui.paused();
      document.getElementById('btnResume')?.addEventListener('click', () => game.togglePause());
      document.getElementById('btnAbandon')?.addEventListener('click', () => {
        game.state = STATES.PLAYING;   // let endGame transition cleanly
        game.endGame(false, 'abandoned');
      });
    } else {
      ui.hideOverlay();
    }
  },

  onMilestone(kind, data) { net.milestone(kind, data); },

  async onGameEnd(result) {
    if (state.clearTimer) { clearInterval(state.clearTimer); state.clearTimer = null; }
    if (result.score > state.best) {
      state.best = result.score;
      save(STORE.best, state.best);
    }
    const levelName = state.campaign.levels[result.level - 1]?.name || '';
    ui.gameEnd({ ...result, levelName, submitState: 'pending' });
    wireEndButtons();

    net.presence({
      name: state.name, level: result.level, score: result.score, lives: 0,
      status: result.victory ? 'victory' : 'dead',
    });

    const submission = await net.submitScore({ ...result, name: state.name });
    if (submission && submission.entry) {
      ui.gameEnd({ ...result, levelName, submitState: 'ok', rank: submission.rank });
      wireEndButtons();
      ui.renderLeaderboard(submission.leaderboard, { myId: submission.entry.id, total: submission.stats?.gamesPlayed });
      ui.renderStats(submission.stats, net.connected ? net.online : null);
      await refreshLeaderboard(submission.entry.id);
    } else {
      ui.gameEnd({ ...result, levelName, submitState: submission?.error || 'score not submitted' });
      wireEndButtons();
    }
  },

  onPrimaryAction() {
    const s = game.state;
    if (s === STATES.MENU) document.getElementById('btnStart')?.click();
    else if (s === STATES.GAME_OVER || s === STATES.VICTORY) document.getElementById('btnRetry')?.click();
  },
};

function wireEndButtons() {
  document.getElementById('btnRetry')?.addEventListener('click', () => startGame(1));
  document.getElementById('btnMenu')?.addEventListener('click', () => { audio.uiBack(); showMenu(); });
}

/* ------------------------------------------------------------- live net UI */

function wireNet() {
  net.on('hello', (d) => {
    state.selfId = d.you?.id || null;
    state.players = d.players || [];
    state.feed = d.feed || [];
    state.chat = d.chat || [];
    ui.renderRoster(state.players, state.selfId);
    ui.renderFeed(state.feed);
    ui.renderChat(state.chat);
    if (d.stats) ui.renderStats(d.stats, d.online);
  });

  net.on('roster', (d) => {
    state.players = d.players || [];
    ui.renderRoster(state.players, state.selfId);
    ui.el.statOnline.textContent = fmt(d.online ?? state.players.length);
  });

  net.on('feed', (item) => {
    state.feed.push(item);
    if (state.feed.length > 60) state.feed.shift();
    ui.renderFeed(state.feed);
  });

  net.on('chat', (item) => {
    state.chat.push(item);
    if (state.chat.length > 40) state.chat.shift();
    ui.renderChat(state.chat);
    if (item.name !== state.name) audio.netPing();
  });

  net.on('highscore', (d) => {
    if (!d?.entry) return;
    ui.toast(`${d.entry.name} hit #${d.rank} with ${fmt(d.entry.score)}`, 'warn');
    refreshLeaderboard();
  });

  net.on('stats', (s) => ui.renderStats(s, net.connected ? net.online : null));
  net.on('ping', (d) => { if (d?.online !== undefined) ui.el.statOnline.textContent = fmt(d.online); });

  const form = document.getElementById('chatForm');
  const input = document.getElementById('chatInput');
  form?.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    try {
      await net.say(text);
    } catch (err) {
      ui.toast(err.message || 'message not sent', 'bad');
    }
  });
  // Typing in the channel must not steer the ship.
  input?.addEventListener('keydown', (ev) => ev.stopPropagation());

  document.querySelectorAll('[data-say]').forEach((b) => {
    b.addEventListener('click', async () => {
      try { await net.say(b.dataset.say); } catch (err) { ui.toast(err.message, 'bad'); }
    });
  });
}

/* ----------------------------------------------------------------- chrome */

function wireChrome() {
  ui.setMuted(state.muted);
  ui.el.btnMute.addEventListener('click', async () => {
    await audio.unlock();
    state.muted = audio.toggleMute();
    save(STORE.muted, state.muted ? '1' : '0');
    ui.setMuted(state.muted);
    if (!state.muted) audio.uiClick();
  });

  ui.el.btnFull.addEventListener('click', () => {
    // The column, not the play field: see the :fullscreen rules in the CSS.
    const col = document.getElementById('screenCol');
    if (document.fullscreenElement) document.exitFullscreen?.();
    else col.requestFullscreen?.().catch(() => ui.toast('fullscreen refused', 'warn'));
  });

  window.addEventListener('keydown', (ev) => {
    const k = ev.key.toLowerCase();
    if (ev.target instanceof HTMLInputElement) return;
    if (k === 'm') ui.el.btnMute.click();
    if (k === 'f') ui.el.btnFull.click();
  });

  // Touch pad buttons.
  const coarse = window.matchMedia('(hover: none) and (pointer: coarse)').matches;
  ui.showTouch(coarse);
  document.querySelectorAll('.tpad').forEach((b) => {
    const act = b.dataset.act;
    const down = (ev) => { ev.preventDefault(); game?.setTouch(act, true); };
    const up = (ev) => { ev.preventDefault(); game?.setTouch(act, false); };
    b.addEventListener('pointerdown', down);
    b.addEventListener('pointerup', up);
    b.addEventListener('pointerleave', up);
    b.addEventListener('pointercancel', up);
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && game?.state === STATES.PLAYING) game.togglePause();
  });

  window.addEventListener('beforeunload', () => net.disconnect());
}

/* -------------------------------------------------------------------- boot */

function bootError(err) {
  const overlay = document.getElementById('overlay');
  overlay.classList.add('show');
  overlay.innerHTML = `<div class="panel">
    <h2 class="bad">Back end unreachable</h2>
    <p>The campaign is served by the Go back end at <code>/api/levels</code> and it did not answer.</p>
    <p class="hint">${esc(err?.message || err)}</p>
    <div class="actions"><button class="btn primary" onclick="location.reload()" type="button">Retry</button></div>
  </div>`;
}

async function boot() {
  wireChrome();
  try {
    state.campaign = await net.loadCampaign();
  } catch (err) {
    console.error(err);
    bootError(err);
    return;
  }

  if (!state.name) state.name = randomHandle();
  state.unlocked = Math.min(state.unlocked, state.campaign.levels.length);

  const canvas = document.getElementById('game');
  game = new Game(canvas, state.campaign, hooks);
  game.best = state.best;
  window.__starInvaders = game; // handy for debugging from the console

  ui.renderCodex(state.campaign);
  ui.renderLevels(state.campaign.levels, 0);
  ui.setHudVisible(false);

  wireNet();
  net.connect(state.name, state.best);
  net.loadStats().then((s) => s && ui.renderStats(s, net.connected ? net.online : null));
  await refreshLeaderboard();

  showMenu();
}

boot();
