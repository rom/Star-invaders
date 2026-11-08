/**
 * The level editor.
 *
 * A level is a small declarative script - waves, hazards and a handful of
 * knobs - that the Go back end defines, serves and validates. This page
 * builds one of those scripts in a form, previews where everything starts,
 * runs the real game engine over it, and publishes it back to the server.
 *
 * The preview deliberately reuses the game's own spawn-plan builder
 * (plan.js) rather than working out slot positions itself, so what you see
 * here cannot drift away from what you get when you press Playtest.
 */

import { buildSpawnPlan, seededRandom, summarisePlan, VIEW } from './plan.js';
import { drawSprite, backdropFor, rgba } from './sprites.js';
import { Game } from './game.js';
import { audio } from './audio.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const STORE = {
  draft: 'starinvaders.editor.draft',
  keys: 'starinvaders.editor.keys',
  name: 'starinvaders.name',
};

function load(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : JSON.parse(v);
  } catch { return fallback; }
}
function save(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode */ }
}

/* ------------------------------------------------------------------ state */

const state = {
  campaign: null,
  draft: null,
  /** id -> edit key, for levels published from this browser. */
  keys: load(STORE.keys, {}) || {},
  /** The published level this draft is bound to, if any. */
  boundId: null,
  problems: [],
  playable: false,
  game: null,
  validateTimer: null,
};

const PLAYER_Y = VIEW.H - 58;

function blankLevel() {
  return {
    name: '',
    tagline: '',
    music: 'march',
    backdrop: 'deepblue',
    starSpeed: 1,
    formationStep: 0.65,
    formationDrop: 18,
    globalFireMul: 1,
    bunkers: 3,
    dropChance: 0.1,
    powerups: ['rapid', 'shield'],
    waves: [{ archetype: 'grunt', pattern: 'grid', rows: 3, cols: 7, count: 21, y: 0.14, delay: 0 }],
    hazards: [],
  };
}

function blankWave() {
  return { archetype: 'grunt', pattern: 'grid', rows: 2, cols: 5, count: 10, y: 0.2, delay: 0 };
}
function blankHazard() {
  return { archetype: 'asteroid', rate: 0.2, max: 3, delay: 5 };
}

const archetypeList = (filter) => Object.values(state.campaign.archetypes)
  .filter(filter || (() => true))
  .sort((a, b) => a.kind.localeCompare(b.kind) || a.score - b.score);

const arch = (id) => state.campaign.archetypes[id];

/* ------------------------------------------------------------------ toast */

function toast(text, kind = 'ok') {
  const node = document.createElement('div');
  node.className = `toast${kind === 'ok' ? '' : ` ${kind}`}`;
  node.textContent = text;
  $('toasts').appendChild(node);
  setTimeout(() => node.remove(), 3200);
  while ($('toasts').children.length > 4) $('toasts').firstChild.remove();
}

/* ------------------------------------------------------------------- form */

function fillSelect(sel, values, current) {
  sel.innerHTML = values.map((v) => `<option value="${esc(v)}"${v === current ? ' selected' : ''}>${esc(v)}</option>`).join('');
}

function renderMeta() {
  const d = state.draft;
  $('fName').value = d.name;
  $('fTagline').value = d.tagline;
  fillSelect($('fMusic'), state.campaign.musicTracks, d.music);
  fillSelect($('fBackdrop'), state.campaign.backdrops, d.backdrop);
  $('fStarSpeed').value = d.starSpeed;
  $('fBunkers').value = d.bunkers;
  $('fStep').value = d.formationStep;
  $('fDrop').value = d.formationDrop;
  $('fFireMul').value = d.globalFireMul;
  $('fDropChance').value = d.dropChance;

  $('fPowerups').innerHTML = state.campaign.powerups.map((p) => {
    const on = d.powerups.includes(p.id);
    return `<label class="ed-chip${on ? ' on' : ''}" title="${esc(p.blurb)}">
      <input type="checkbox" data-powerup="${esc(p.id)}"${on ? ' checked' : ''}>
      <span style="color:${esc(p.color)}">${esc(p.glyph)}</span> ${esc(p.name)}
    </label>`;
  }).join('');
}

const PATTERN_FIELDS = {
  grid: ['count', 'rows', 'cols', 'y', 'delay', 'speedMul', 'fireMul', 'amp'],
  arc: ['count', 'y', 'delay', 'speedMul', 'fireMul', 'amp'],
  vee: ['count', 'y', 'delay', 'speedMul', 'fireMul', 'amp'],
  stream: ['count', 'interval', 'side', 'delay', 'speedMul', 'fireMul'],
  random: ['count', 'y', 'delay', 'speedMul', 'fireMul', 'amp'],
  boss: ['y', 'delay'],
};

const NUM_FIELD = {
  count: { step: 1, min: 1, max: 120, label: 'count' },
  rows: { step: 1, min: 1, max: 20, label: 'rows' },
  cols: { step: 1, min: 1, max: 20, label: 'cols' },
  y: { step: 0.01, min: 0, max: 0.85, label: 'y', hint: 'of field height' },
  delay: { step: 0.5, min: 0, max: 600, label: 'delay', hint: 'seconds' },
  interval: { step: 0.1, min: 0.05, max: 60, label: 'every', hint: 'seconds' },
  speedMul: { step: 0.05, min: 0, max: 5, label: 'speed x' },
  fireMul: { step: 0.05, min: 0, max: 5, label: 'fire x' },
  amp: { step: 1, min: 0, max: 200, label: 'amplitude', hint: 'px' },
  rate: { step: 0.02, min: 0, max: 5, label: 'per second' },
  max: { step: 1, min: 1, max: 12, label: 'max at once' },
};

function numField(obj, key, idx, kind) {
  const f = NUM_FIELD[key];
  const v = obj[key] ?? '';
  return `<label class="ed-field">
    <span>${esc(f.label)}${f.hint ? ` <em>${esc(f.hint)}</em>` : ''}</span>
    <input type="number" step="${f.step}" min="${f.min}" max="${f.max}" value="${v}"
           data-${kind}="${idx}" data-key="${esc(key)}">
  </label>`;
}

function renderWaves() {
  const rows = state.draft.waves.map((w, i) => {
    const a = arch(w.archetype);
    const fields = (PATTERN_FIELDS[w.pattern] || PATTERN_FIELDS.grid)
      .filter((k) => k !== 'side')
      .map((k) => numField(w, k, i, 'wave')).join('');
    const side = (PATTERN_FIELDS[w.pattern] || []).includes('side')
      ? `<label class="ed-field"><span>from</span>
           <select data-wave="${i}" data-key="side">
             ${state.campaign.sides.map((s) => `<option value="${esc(s)}"${s === (w.side || 'top') ? ' selected' : ''}>${esc(s)}</option>`).join('')}
           </select></label>`
      : '';
    return `<div class="ed-row${a ? '' : ' invalid'}">
      <div class="ed-row-head">
        <i class="sw" style="background:${esc(a ? a.color : '#ff6b6b')}"></i>
        <b>${esc(a ? a.name : `unknown: ${w.archetype}`)}</b>
        <span>wave ${i + 1}</span>
        <span class="ed-row-tools">
          <button type="button" data-move="${i}" data-dir="-1" title="Move up">&#9650;</button>
          <button type="button" data-move="${i}" data-dir="1" title="Move down">&#9660;</button>
          <button type="button" data-dup="${i}" title="Duplicate">&#10697;</button>
          <button type="button" class="danger" data-del-wave="${i}" title="Remove">&times;</button>
        </span>
      </div>
      <label class="ed-field ed-span2"><span>attacker</span>
        <select data-wave="${i}" data-key="archetype">
          ${archetypeList((x) => x.kind !== 'object').map((x) => `<option value="${esc(x.id)}"${x.id === w.archetype ? ' selected' : ''}>${esc(x.name)}${x.kind === 'boss' ? ' (boss)' : ''}</option>`).join('')}
          ${archetypeList((x) => x.kind === 'object').map((x) => `<option value="${esc(x.id)}"${x.id === w.archetype ? ' selected' : ''}>${esc(x.name)} (object)</option>`).join('')}
        </select></label>
      <label class="ed-field"><span>pattern</span>
        <select data-wave="${i}" data-key="pattern">
          ${state.campaign.patterns.map((p) => `<option value="${esc(p)}"${p === w.pattern ? ' selected' : ''}>${esc(p)}</option>`).join('')}
        </select></label>
      ${side}${fields}
    </div>`;
  });
  $('waveRows').innerHTML = rows.join('') || '<p class="ed-note">No waves yet. A level needs at least one.</p>';
  $('waveCount').textContent = String(state.draft.waves.length);
}

function renderHazards() {
  const rows = state.draft.hazards.map((h, i) => {
    const a = arch(h.archetype);
    return `<div class="ed-row${a ? '' : ' invalid'}">
      <div class="ed-row-head">
        <i class="sw" style="background:${esc(a ? a.color : '#ff6b6b')}"></i>
        <b>${esc(a ? a.name : `unknown: ${h.archetype}`)}</b>
        <span class="ed-row-tools">
          <button type="button" class="danger" data-del-hazard="${i}" title="Remove">&times;</button>
        </span>
      </div>
      <label class="ed-field ed-span2"><span>object</span>
        <select data-hazard="${i}" data-key="archetype">
          ${archetypeList((x) => x.kind === 'object').map((x) => `<option value="${esc(x.id)}"${x.id === h.archetype ? ' selected' : ''}>${esc(x.name)}</option>`).join('')}
        </select></label>
      ${numField(h, 'rate', i, 'hazard')}
      ${numField(h, 'max', i, 'hazard')}
      ${numField(h, 'delay', i, 'hazard')}
    </div>`;
  });
  $('hazardRows').innerHTML = rows.join('') || '<p class="ed-note">No hazards. The field will hold only what the waves put there.</p>';
  $('hazardCount').textContent = String(state.draft.hazards.length);
}

/* ---------------------------------------------------------------- preview */

function drawPreview() {
  const canvas = $('preview');
  const ctx = canvas.getContext('2d');
  const d = state.draft;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const cssW = canvas.getBoundingClientRect().width || VIEW.W;
  const want = Math.round(cssW * dpr);
  if (canvas.width !== want) {
    canvas.width = want;
    canvas.height = Math.round(want * (VIEW.H / VIEW.W));
  }
  const scale = canvas.width / VIEW.W;
  ctx.setTransform(scale, 0, 0, scale, 0, 0);

  // Backdrop, so the colour choice is visible while picking it.
  const bd = backdropFor(d.backdrop);
  const g = ctx.createLinearGradient(0, 0, 0, VIEW.H);
  g.addColorStop(0, bd.top);
  g.addColorStop(1, bd.bottom);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, VIEW.W, VIEW.H);
  const grd = ctx.createRadialGradient(VIEW.W * 0.5, VIEW.H * 0.35, 0, VIEW.W * 0.5, VIEW.H * 0.35, 380);
  grd.addColorStop(0, rgba(bd.nebula, 0.14));
  grd.addColorStop(1, rgba(bd.nebula, 0));
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, VIEW.W, VIEW.H);

  const unknown = [];
  const plan = buildSpawnPlan(d, state.campaign.archetypes, {
    random: seededRandom(1337),
    onUnknown: (id) => unknown.push(id),
  });

  // Bunkers, drawn where entities.js puts them, with the shape they have.
  const nb = Math.max(0, Math.min(4, d.bunkers | 0));
  for (let i = 0; i < nb; i++) {
    const cx = ((i + 1) / (nb + 1)) * VIEW.W;
    drawSprite(ctx, 'bunker', {
      x: cx, y: PLAYER_Y - 96 + 28, width: 77,
      color: '#4cc9f0', accent: '#4cc9f0', alpha: 0.85, raster: scale,
    });
  }

  // The player's line.
  ctx.strokeStyle = 'rgba(124,243,160,0.45)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(0, VIEW.H - 30);
  ctx.lineTo(VIEW.W, VIEW.H - 30);
  ctx.stroke();
  drawSprite(ctx, 'player', { x: VIEW.W / 2, y: PLAYER_Y, width: 40, color: '#9ad4ff', accent: '#1b4a6a', raster: scale });

  ctx.font = '13px ui-monospace, monospace';
  ctx.textBaseline = 'middle';

  const edgeLabels = [];
  for (const item of plan) {
    const a = item.arch;
    const delayed = item.at > 0.01;
    const alpha = delayed ? 0.4 : 1;

    if (item.formation) {
      drawSprite(ctx, a.sprite, {
        x: item.slotX, y: item.slotY, width: a.radius * 2.25,
        color: a.color, accent: a.accent, alpha, raster: scale,
      });
    } else if (item.boss) {
      drawSprite(ctx, a.sprite, {
        x: VIEW.W / 2, y: item.y, width: a.radius * 2.25,
        color: a.color, accent: a.accent, alpha, glow: 16, raster: scale,
      });
    } else if (item.x !== undefined) {
      drawSprite(ctx, a.sprite, {
        x: item.x, y: item.y, width: a.radius * 2.25,
        color: a.color, accent: a.accent, alpha: alpha * 0.85, raster: scale,
      });
    } else {
      edgeLabels.push(item);
    }
  }

  // Streams do not have a position until they arrive, so they are shown as
  // an arrival note on the edge they come from.
  const bySide = new Map();
  for (const item of edgeLabels) {
    const key = `${item.side}|${item.arch.id}`;
    const prev = bySide.get(key) || { side: item.side, arch: item.arch, n: 0, first: item.at };
    prev.n++;
    prev.first = Math.min(prev.first, item.at);
    bySide.set(key, prev);
  }
  let slot = 0;
  for (const s of bySide.values()) {
    const y = 26 + slot * 30;
    const x = s.side === 'left' ? 30 : s.side === 'right' ? VIEW.W - 30 : VIEW.W / 2;
    drawSprite(ctx, s.arch.sprite, {
      x, y, width: s.arch.radius * 1.9, color: s.arch.color, accent: s.arch.accent,
      alpha: 0.75, raster: scale,
    });
    ctx.fillStyle = 'rgba(215,227,255,0.85)';
    ctx.textAlign = s.side === 'right' ? 'right' : 'left';
    const tx = s.side === 'right' ? x - 26 : x + 26;
    ctx.fillText(`x${s.n} from ${s.side} @ ${s.first.toFixed(0)}s`, tx, y);
    slot++;
  }

  // Hazards get a corner tally, since they arrive forever.
  if (d.hazards.length) {
    ctx.textAlign = 'right';
    d.hazards.forEach((h, i) => {
      const a = arch(h.archetype);
      if (!a) return;
      const y = VIEW.H - 120 + i * 26;
      drawSprite(ctx, a.sprite, { x: VIEW.W - 34, y, width: a.radius * 1.6, color: a.color, accent: a.accent, alpha: 0.8, raster: scale });
      ctx.fillStyle = 'rgba(215,227,255,0.8)';
      ctx.fillText(`${h.rate}/s, max ${h.max}`, VIEW.W - 60, y);
    });
  }

  ctx.textAlign = 'left';
  const s = summarisePlan(plan);
  $('previewNote').textContent = unknown.length
    ? `Unknown archetype: ${[...new Set(unknown)].join(', ')}`
    : `${s.total} attackers, ${s.required} of them required. Faded sprites arrive later; the last spawns at ${s.lastSpawnAt.toFixed(0)}s.`;

  renderSummary(s);
}

function renderSummary(s) {
  $('summary').innerHTML = s.byArchetype.map(({ id, n }) => {
    const a = arch(id);
    if (!a) return '';
    return `<li><i class="sw" style="background:${esc(a.color)}"></i>
      <span>${esc(a.name)}</span>
      <span class="n">${n}</span></li>`;
  }).join('') || '<li class="muted">nothing yet</li>';
}

/* ------------------------------------------------------------- validation */

function renderProblems() {
  const list = $('problems');
  if (!state.problems.length) {
    list.innerHTML = state.playable
      ? '<li class="ok">Playable. Nothing to fix.</li>'
      : '<li class="muted">checking&hellip;</li>';
    return;
  }
  const items = state.problems.map((p) => `<li class="${p.fatal ? 'fatal' : 'warn'}">
      <code>${esc(p.field)}</code> ${esc(p.message)}</li>`);
  if (state.playable) items.unshift('<li class="ok">Playable. The notes below are advice.</li>');
  list.innerHTML = items.join('');
}

async function validate() {
  try {
    const res = await fetch('/api/userlevels/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ level: state.draft }),
    });
    const data = await res.json();
    state.problems = data.problems || [];
    state.playable = !!data.playable;
  } catch {
    state.problems = [{ field: 'server', message: 'the validator is unreachable; publishing will not work', fatal: false }];
    state.playable = false;
  }
  renderProblems();
  $('btnPublish').disabled = !state.playable;
  $('btnUpdate').disabled = !state.playable;
}

function scheduleValidate() {
  clearTimeout(state.validateTimer);
  state.validateTimer = setTimeout(validate, 350);
}

/** Everything that has to happen after the draft changes. */
function touched() {
  save(STORE.draft, state.draft);
  drawPreview();
  scheduleValidate();
}

/* ---------------------------------------------------------------- binding */

function bindMeta() {
  const num = (el, key) => el.addEventListener('input', () => {
    const v = parseFloat(el.value);
    state.draft[key] = Number.isFinite(v) ? v : 0;
    touched();
  });
  $('fName').addEventListener('input', () => { state.draft.name = $('fName').value; touched(); });
  $('fTagline').addEventListener('input', () => { state.draft.tagline = $('fTagline').value; touched(); });
  $('fMusic').addEventListener('change', () => { state.draft.music = $('fMusic').value; touched(); });
  $('fBackdrop').addEventListener('change', () => { state.draft.backdrop = $('fBackdrop').value; touched(); });
  num($('fStarSpeed'), 'starSpeed');
  num($('fBunkers'), 'bunkers');
  num($('fStep'), 'formationStep');
  num($('fDrop'), 'formationDrop');
  num($('fFireMul'), 'globalFireMul');
  num($('fDropChance'), 'dropChance');

  $('fPowerups').addEventListener('change', (ev) => {
    const id = ev.target.dataset.powerup;
    if (!id) return;
    const set = new Set(state.draft.powerups);
    if (ev.target.checked) set.add(id); else set.delete(id);
    state.draft.powerups = state.campaign.powerups.map((p) => p.id).filter((p) => set.has(p));
    renderMeta();
    touched();
  });

  $('fAuthor').value = load(STORE.name, '') || '';
  $('fAuthor').addEventListener('input', () => save(STORE.name, $('fAuthor').value.toUpperCase()));
}

function bindRows() {
  const onChange = (ev) => {
    const t = ev.target;
    const key = t.dataset.key;
    if (!key) return;
    const waveIdx = t.dataset.wave;
    const hazardIdx = t.dataset.hazard;
    const target = waveIdx !== undefined ? state.draft.waves[+waveIdx]
      : hazardIdx !== undefined ? state.draft.hazards[+hazardIdx] : null;
    if (!target) return;

    if (t.type === 'number') {
      // Clearing a field means "leave it at the default", not "set it to
      // zero" - a speed multiplier of zero would pin the wave in place.
      if (t.value.trim() === '') delete target[key];
      else {
        const v = parseFloat(t.value);
        if (Number.isFinite(v)) target[key] = v;
      }
      touched();
      return;
    }
    target[key] = t.value;
    if (key === 'pattern' || key === 'archetype') {
      // A boss only ever spawns one, and switching to a boss archetype
      // switches the pattern with it rather than leaving a broken wave.
      if (key === 'archetype' && arch(t.value)?.kind === 'boss') {
        target.pattern = 'boss';
        target.count = 1;
      }
      if (key === 'pattern' && t.value === 'boss') {
        target.count = 1;
        if (arch(target.archetype)?.kind !== 'boss') {
          target.archetype = archetypeList((x) => x.kind === 'boss')[0].id;
        }
      }
      if (key === 'pattern' && t.value === 'stream' && !target.interval) target.interval = 1.2;
      renderWaves();
    }
    touched();
  };
  $('waveRows').addEventListener('change', onChange);
  $('waveRows').addEventListener('input', onChange);
  $('hazardRows').addEventListener('change', onChange);
  $('hazardRows').addEventListener('input', onChange);

  $('waveRows').addEventListener('click', (ev) => {
    const b = ev.target.closest('button');
    if (!b) return;
    const waves = state.draft.waves;
    if (b.dataset.delWave !== undefined) {
      waves.splice(+b.dataset.delWave, 1);
    } else if (b.dataset.dup !== undefined) {
      const i = +b.dataset.dup;
      waves.splice(i + 1, 0, structuredClone(waves[i]));
    } else if (b.dataset.move !== undefined) {
      const i = +b.dataset.move;
      const j = i + (+b.dataset.dir);
      if (j < 0 || j >= waves.length) return;
      [waves[i], waves[j]] = [waves[j], waves[i]];
    } else { return; }
    renderWaves();
    touched();
  });

  $('hazardRows').addEventListener('click', (ev) => {
    const b = ev.target.closest('button');
    if (!b || b.dataset.delHazard === undefined) return;
    state.draft.hazards.splice(+b.dataset.delHazard, 1);
    renderHazards();
    touched();
  });

  $('btnAddWave').addEventListener('click', () => {
    state.draft.waves.push(blankWave());
    renderWaves();
    touched();
  });
  $('btnAddHazard').addEventListener('click', () => {
    state.draft.hazards.push(blankHazard());
    renderHazards();
    touched();
  });
}

/* --------------------------------------------------------------- playtest */

function stopPlaytest() {
  if (state.game) {
    state.game.destroy();
    state.game = null;
  }
  $('playtest').hidden = true;
  $('playtestOverlay').classList.remove('show');
  $('playtestOverlay').innerHTML = '';
}

function playtestResult(title, detail, cls = '') {
  const o = $('playtestOverlay');
  o.innerHTML = `<div class="panel">
      <h2 class="${cls}">${esc(title)}</h2>
      <p>${esc(detail)}</p>
      <div class="actions">
        <button class="btn primary" id="btnPlayAgain" type="button">Run it again</button>
        <button class="btn ghost" id="btnBackToEditor" type="button">Back to the editor</button>
      </div>
    </div>`;
  o.classList.add('show');
  $('btnPlayAgain').addEventListener('click', () => { stopPlaytest(); startPlaytest(); });
  $('btnBackToEditor').addEventListener('click', stopPlaytest);
}

async function startPlaytest() {
  if (!state.playable) {
    toast('fix the fatal problems first', 'bad');
    return;
  }
  $('playtest').hidden = false;
  $('playtestTitle').textContent = state.draft.name || 'Untitled level';
  $('playtestReadout').textContent = '';
  await audio.unlock();

  // A one-level campaign over the draft, run by the real engine.
  const campaign = { ...state.campaign, levels: [structuredClone(state.draft)], levelCount: 1 };
  const canvas = $('playtestCanvas');
  const game = new Game(canvas, campaign, {
    onHud(d) {
      $('playtestReadout').textContent =
        `score ${d.score.toLocaleString('en-US')} · hulls ${d.lives} · ${d.remaining} left`;
    },
    onToast: (text) => toast(text, 'warn'),
    onLevelClear(info) {
      const secs = Math.round(game.stats.duration);
      playtestResult('Level cleared', `${info.clearBonus + info.lifeBonus + info.perfect} bonus, ${secs}s, ${game.stats.lives} hulls left.`, 'win');
    },
    onGameEnd(result) {
      if (result.victory) return;
      playtestResult('Shot down', `Level reached ${result.level}, ${result.kills} kills, ${result.accuracy.toFixed(0)}% accuracy.`, 'bad');
    },
  });
  state.game = game;
  game.newGame(1);
}

/* -------------------------------------------------------- publish / share */

function bindDraftToEntry(entry, secret) {
  state.boundId = entry.id;
  if (secret) {
    state.keys[entry.id] = secret;
    save(STORE.keys, state.keys);
  }
  $('draftState').textContent = `editing “${entry.level.name}”`;
  $('btnUpdate').hidden = !state.keys[entry.id];
  $('btnDelete').hidden = !state.keys[entry.id];
  $('btnPublish').textContent = state.keys[entry.id] ? 'Publish a copy' : 'Publish';
}

function unbindDraft() {
  state.boundId = null;
  $('draftState').textContent = 'new level';
  $('btnUpdate').hidden = true;
  $('btnDelete').hidden = true;
  $('btnPublish').textContent = 'Publish';
}

async function publish() {
  const author = ($('fAuthor').value || '').trim().toUpperCase() || 'ANON';
  save(STORE.name, author);
  try {
    const res = await fetch('/api/userlevels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ author, level: state.draft }),
    });
    const data = await res.json();
    if (!res.ok) {
      toast(data.error || 'the server refused the level', 'bad');
      if (data.problems) { state.problems = data.problems; renderProblems(); }
      return;
    }
    bindDraftToEntry(data.entry, data.secret);
    toast(`published “${data.entry.level.name}”`);
    await refreshPublished();
  } catch (err) {
    toast(err.message || 'could not reach the server', 'bad');
  }
}

async function updatePublished() {
  const id = state.boundId;
  const secret = state.keys[id];
  if (!id || !secret) return;
  try {
    const res = await fetch(`/api/userlevels/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret, level: state.draft }),
    });
    const data = await res.json();
    if (!res.ok) {
      toast(data.error || 'the update was refused', 'bad');
      return;
    }
    toast('changes saved');
    await refreshPublished();
  } catch (err) {
    toast(err.message || 'could not reach the server', 'bad');
  }
}

async function unpublish() {
  const id = state.boundId;
  const secret = state.keys[id];
  if (!id || !secret) return;
  if (!window.confirm('Remove this level from the server? This cannot be undone.')) return;
  try {
    const res = await fetch(`/api/userlevels/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret }),
    });
    if (!res.ok && res.status !== 204) {
      toast('the server refused to remove it', 'bad');
      return;
    }
    delete state.keys[id];
    save(STORE.keys, state.keys);
    unbindDraft();
    toast('level removed');
    await refreshPublished();
  } catch (err) {
    toast(err.message || 'could not reach the server', 'bad');
  }
}

async function refreshPublished() {
  let data;
  try {
    data = await (await fetch('/api/userlevels?limit=60')).json();
  } catch {
    $('published').innerHTML = '<li class="muted">the server is unreachable</li>';
    return;
  }
  const levels = data.levels || [];
  $('publishedCount').textContent = String(data.total ?? levels.length);
  if (!levels.length) {
    $('published').innerHTML = '<li class="muted">nothing published yet</li>';
    return;
  }
  $('published').innerHTML = levels.map((e) => {
    const mine = !!state.keys[e.id];
    return `<li class="${mine ? 'mine' : ''}">
      <span>
        <b>${esc(e.level.name)}</b>
        <small>${esc(e.author)} · ${e.level.waves.length} wave${e.level.waves.length === 1 ? '' : 's'}
          · ${e.plays} play${e.plays === 1 ? '' : 's'}${mine ? ' · yours' : ''}</small>
      </span>
      <span class="tools">
        <button type="button" data-open="${esc(e.id)}">open</button>
        <button type="button" data-play="${esc(e.id)}">play</button>
      </span>
    </li>`;
  }).join('');
}

async function openPublished(id) {
  try {
    const data = await (await fetch(`/api/userlevels/${encodeURIComponent(id)}`)).json();
    if (!data.entry) { toast('that level is gone', 'bad'); return; }
    state.draft = data.entry.level;
    bindDraftToEntry(data.entry, null);
    renderAll();
    toast(state.keys[id] ? 'opened your level' : 'opened a copy; publishing makes it yours');
  } catch {
    toast('could not open that level', 'bad');
  }
}

/* ------------------------------------------------------- import / export */

function exportJSON() {
  const name = (state.draft.name || 'level').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const blob = new Blob([JSON.stringify(state.draft, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${name || 'level'}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function importJSON() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/json,.json';
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      const level = parsed.level || parsed;
      if (!level || !Array.isArray(level.waves)) throw new Error('that file has no waves');
      state.draft = { ...blankLevel(), ...level };
      unbindDraft();
      renderAll();
      toast(`imported “${state.draft.name || 'untitled'}”`);
    } catch (err) {
      toast(err.message || 'that file is not a level', 'bad');
    }
  });
  input.click();
}

/** Renders the draft as a Go literal, to paste into internal/game/levels.go. */
function asGoSource() {
  const d = state.draft;
  const f = (n) => (Number.isInteger(n) ? String(n) : String(n));
  const q = (s) => JSON.stringify(s ?? '');
  const waves = d.waves.map((w) => {
    const parts = [`Archetype: ${q(w.archetype)}`, `Pattern: Pattern${w.pattern[0].toUpperCase()}${w.pattern.slice(1)}`];
    if (w.count) parts.push(`Count: ${w.count}`);
    if (w.rows) parts.push(`Rows: ${w.rows}`);
    if (w.cols) parts.push(`Cols: ${w.cols}`);
    if (w.delay) parts.push(`Delay: ${f(w.delay)}`);
    if (w.interval) parts.push(`Interval: ${f(w.interval)}`);
    if (w.speedMul) parts.push(`SpeedMul: ${f(w.speedMul)}`);
    if (w.fireMul) parts.push(`FireMul: ${f(w.fireMul)}`);
    if (w.side) parts.push(`Side: ${q(w.side)}`);
    if (w.y) parts.push(`Y: ${f(w.y)}`);
    if (w.amp) parts.push(`Amp: ${f(w.amp)}`);
    return `\t\t\t{${parts.join(', ')}},`;
  }).join('\n');
  const hazards = d.hazards.map((h) => {
    const parts = [`Archetype: ${q(h.archetype)}`, `Rate: ${f(h.rate)}`, `Max: ${h.max}`];
    if (h.delay) parts.push(`Delay: ${f(h.delay)}`);
    if (h.speedMul) parts.push(`SpeedMul: ${f(h.speedMul)}`);
    return `\t\t\t{${parts.join(', ')}},`;
  }).join('\n');

  return `\t{
\t\tNumber: 0, Name: ${q(d.name)}, Tagline: ${q(d.tagline)},
\t\tMusic: ${q(d.music)}, Backdrop: ${q(d.backdrop)}, StarSpeed: ${f(d.starSpeed)},
\t\tFormationStep: ${f(d.formationStep)}, FormationDrop: ${f(d.formationDrop)}, GlobalFireMul: ${f(d.globalFireMul)}, Bunkers: ${d.bunkers},
\t\tWaves: []Wave{
${waves}
\t\t},${hazards ? `\n\t\tHazards: []Hazard{\n${hazards}\n\t\t},` : ''}
\t\tDropChance: ${f(d.dropChance)}, Powerups: []string{${d.powerups.map(q).join(', ')}},
\t},`;
}

async function copyGo() {
  const text = asGoSource();
  try {
    await navigator.clipboard.writeText(text);
    toast('Go literal copied; paste it into internal/game/levels.go');
  } catch {
    // Clipboard access is often blocked; fall back to a selectable field.
    window.prompt('Copy this into internal/game/levels.go', text);
  }
}

/* ------------------------------------------------------------------- boot */

function renderAll() {
  renderMeta();
  renderWaves();
  renderHazards();
  drawPreview();
  scheduleValidate();
}

function bindActions() {
  $('btnPlaytest').addEventListener('click', startPlaytest);
  $('btnStopPlaytest').addEventListener('click', stopPlaytest);
  $('btnPublish').addEventListener('click', publish);
  $('btnUpdate').addEventListener('click', updatePublished);
  $('btnDelete').addEventListener('click', unpublish);
  $('btnExport').addEventListener('click', exportJSON);
  $('btnImport').addEventListener('click', importJSON);
  $('btnGo').addEventListener('click', copyGo);
  $('btnReset').addEventListener('click', () => {
    if (!window.confirm('Throw this draft away and start from a blank level?')) return;
    state.draft = blankLevel();
    unbindDraft();
    renderAll();
  });

  $('fCampaignPick').addEventListener('change', (ev) => {
    const n = parseInt(ev.target.value, 10);
    if (!n) return;
    const lv = state.campaign.levels[n - 1];
    state.draft = structuredClone(lv);
    state.draft.name = `${lv.name} (copy)`;
    unbindDraft();
    renderAll();
    ev.target.value = '';
    toast(`loaded level ${n} as a starting point`);
  });

  $('published').addEventListener('click', (ev) => {
    const b = ev.target.closest('button');
    if (!b) return;
    if (b.dataset.open) openPublished(b.dataset.open);
    if (b.dataset.play) window.open(`/?level=${encodeURIComponent(b.dataset.play)}`, '_blank', 'noopener');
  });

  window.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && !$('playtest').hidden) stopPlaytest();
  });
  window.addEventListener('resize', () => drawPreview());
}

async function boot() {
  try {
    state.campaign = await (await fetch('/api/levels')).json();
  } catch (err) {
    document.body.innerHTML = `<div class="panel" style="padding:3rem;text-align:center">
      <h2 class="bad">Back end unreachable</h2>
      <p>The editor needs the campaign definition from <code>/api/levels</code>.</p></div>`;
    console.error(err);
    return;
  }

  state.draft = { ...blankLevel(), ...(load(STORE.draft, null) || {}) };
  $('fCampaignPick').innerHTML = '<option value="">pick one&hellip;</option>'
    + state.campaign.levels.map((lv) => `<option value="${lv.number}">${String(lv.number).padStart(2, '0')} ${esc(lv.name)}</option>`).join('');

  bindMeta();
  bindRows();
  bindActions();
  renderAll();
  await refreshPublished();

  window.__editor = state; // handy from the console
}

boot();
