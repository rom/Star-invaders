/**
 * DOM presentation layer: HUD, overlays and the side rail (leaderboard,
 * defence net, codex). The game engine never touches these nodes directly -
 * it calls into this class through its hooks.
 */

const $ = (id) => document.getElementById(id);

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

export const fmt = (n) => (n ?? 0).toLocaleString('en-US');

function timeAgo(iso) {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '';
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 10) return 'now';
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

function duration(sec) {
  const s = Math.max(0, Math.round(sec || 0));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

export class UI {
  constructor() {
    this.el = {
      hud: $('hud'),
      score: $('hudScore'),
      best: $('hudBest'),
      level: $('hudLevel'),
      levelName: $('hudLevelName'),
      waveFill: $('waveFill'),
      lives: $('hudLives'),
      powerups: $('hudPowerups'),
      combo: $('hudCombo'),
      bossBar: $('bossBar'),
      bossName: $('bossName'),
      bossFill: $('bossFill'),
      overlay: $('overlay'),
      toasts: $('toastStack'),
      board: $('board'),
      boardNote: $('boardNote'),
      roster: $('roster'),
      rosterCount: $('rosterCount'),
      feed: $('feed'),
      chat: $('chat'),
      levelList: $('levelList'),
      codex: $('codex'),
      codexPowerups: $('codexPowerups'),
      statOnline: $('statOnline'),
      statGames: $('statGames'),
      statKills: $('statKills'),
      statBest: $('statBest'),
      statWins: $('statWins'),
      touch: $('touch'),
      btnMute: $('btnMute'),
      btnFull: $('btnFull'),
    };
    this.lastHud = {};
    this.cleared = new Set();
    this._bindTabs();
  }

  _bindTabs() {
    const tabs = Array.from(document.querySelectorAll('.tab'));
    tabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        tabs.forEach((t) => {
          const on = t === tab;
          t.classList.toggle('is-active', on);
          t.setAttribute('aria-selected', String(on));
        });
        document.querySelectorAll('.tab-panel').forEach((p) => {
          p.classList.toggle('is-active', p.id === `panel-${tab.dataset.tab}`);
        });
      });
    });
  }

  /* ------------------------------------------------------------------ HUD */

  renderHud(d) {
    const e = this.el;
    if (d.score !== this.lastHud.score) e.score.textContent = fmt(d.score);
    if (d.best !== this.lastHud.best) e.best.textContent = fmt(d.best);
    if (d.level !== this.lastHud.level || d.levelCount !== this.lastHud.levelCount) {
      e.level.textContent = `level ${d.level} / ${d.levelCount}`;
    }
    if (d.levelName !== this.lastHud.levelName) e.levelName.textContent = d.levelName || 'standby';

    const pct = d.total > 0 ? Math.max(0, Math.min(100, (d.remaining / d.total) * 100)) : 0;
    e.waveFill.style.width = `${pct}%`;

    if (d.lives !== this.lastHud.lives || d.bombs !== this.lastHud.bombs || d.shield !== this.lastHud.shield) {
      const icons = [];
      for (let i = 0; i < Math.max(0, Math.min(9, d.lives)); i++) icons.push('<span class="life-icon"></span>');
      if (d.lives > 9) icons.push(`<span class="hud-k">x${d.lives}</span>`);
      let extra = '';
      if (d.bombs > 0) extra += `<span class="pw" style="color:#b5179e">B x${d.bombs}</span>`;
      if (d.shield) extra += '<span class="pw" style="color:#4cc9f0">shield</span>';
      e.lives.innerHTML = icons.join('') + extra;
    }

    const key = d.powerups.map((p) => `${p.id}:${Math.ceil(p.remain)}`).join(',');
    if (key !== this.lastHud.pwKey) {
      e.powerups.innerHTML = d.powerups.map((p) => {
        const w = Math.max(0, Math.min(100, (p.remain / (p.duration || 15)) * 100));
        return `<span class="pw" style="color:${esc(p.color)}">${esc(p.glyph)}<span class="pw-bar"><i style="width:${w}%"></i></span></span>`;
      }).join('');
      this.lastHud.pwKey = key;
    }

    const mult = 1 + Math.min(7, Math.floor(d.combo / 3));
    e.combo.textContent = d.combo > 2 ? `${d.combo} chain x${mult}` : '';

    if (d.boss) {
      e.bossBar.hidden = false;
      e.bossName.textContent = d.boss.name;
      e.bossFill.style.width = `${Math.max(0, (d.boss.hp / d.boss.maxHp) * 100)}%`;
    } else if (!e.bossBar.hidden) {
      e.bossBar.hidden = true;
    }

    this.lastHud = { ...this.lastHud, ...d };
  }

  toast(text, kind = 'ok') {
    const node = document.createElement('div');
    node.className = `toast${kind === 'ok' ? '' : ` ${kind}`}`;
    node.textContent = text;
    this.el.toasts.appendChild(node);
    setTimeout(() => node.remove(), 2400);
    while (this.el.toasts.children.length > 4) this.el.toasts.firstChild.remove();
  }

  /* -------------------------------------------------------------- overlay */

  hideOverlay() {
    this.el.overlay.classList.remove('show');
    this.el.overlay.innerHTML = '';
  }

  showOverlay(html) {
    this.el.overlay.innerHTML = `<div class="panel">${html}</div>`;
    this.el.overlay.classList.add('show');
    this.el.overlay.scrollTop = 0;
  }

  menu({ name, best, online, top, levelCount, canResume }) {
    const leaders = top.slice(0, 3).map((s, i) => `<span>#${i + 1} ${esc(s.name)} ${fmt(s.score)}</span>`).join('');
    this.showOverlay(`
      <h2>Star Invaders</h2>
      <p class="tagline">${levelCount} levels of aliens, armour and unidentified rocks.</p>
      <p>Hold the line at the bottom of the screen. Every attacker in a level must be destroyed
         before the next one unlocks. Bosses wait on levels 5, 9 and 12.</p>
      <div class="name-row">
        <label for="pilotName">pilot</label>
        <input id="pilotName" maxlength="14" value="${esc(name)}" autocomplete="off" spellcheck="false">
      </div>
      <div class="actions">
        <button class="btn primary" id="btnStart" type="button">${canResume ? 'New sortie' : 'Launch'}</button>
        <button class="btn ghost" id="btnPractice" type="button">Level select</button>
        <button class="btn ghost" id="btnCommunity" type="button">Community levels</button>
      </div>
      <p class="hint"><kbd>&larr;</kbd><kbd>&rarr;</kbd> move &middot; <kbd>Space</kbd> fire &middot; <kbd>B</kbd> bomb &middot; <kbd>P</kbd> pause &middot; drag the screen to fly</p>
      ${best ? `<p class="hint">your best: ${fmt(best)}</p>` : ''}
      ${leaders ? `<div class="roster-mini">${leaders}</div>` : ''}
      <p class="hint">${online} pilot${online === 1 ? '' : 's'} on the defence net</p>
    `);
    const input = $('pilotName');
    if (input) {
      input.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') { ev.preventDefault(); $('btnStart')?.click(); }
      });
    }
  }

  levelSelect({ levels, unlocked }) {
    const items = levels.map((lv) => {
      const locked = lv.number > unlocked;
      return `<button class="btn ${locked ? 'ghost' : ''}" data-level="${lv.number}" ${locked ? 'disabled' : ''}
        type="button" style="justify-content:flex-start;text-align:left">
        ${String(lv.number).padStart(2, '0')} ${esc(lv.name)}${lv.boss ? ' *' : ''}
      </button>`;
    }).join('');
    this.showOverlay(`
      <h2>Level select</h2>
      <p>Levels unlock as you clear them. Scores from a mid-campaign start still count.</p>
      <div class="actions" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));width:100%">${items}</div>
      <div class="actions"><button class="btn ghost" id="btnBackMenu" type="button">Back</button></div>
    `);
  }

  community({ levels, total }) {
    const items = levels.length
      ? levels.map((e) => `<button class="btn" data-community="${esc(e.id)}" type="button"
          style="justify-content:flex-start;text-align:left">
          ${esc(e.level.name)}
          <small style="color:var(--ink-dim);display:block;font-size:0.72em">
            ${esc(e.author)} &middot; ${e.level.waves.length} wave${e.level.waves.length === 1 ? '' : 's'} &middot; ${e.plays} play${e.plays === 1 ? '' : 's'}
          </small>
        </button>`).join('')
      : '';
    this.showOverlay(`
      <h2>Community levels</h2>
      <p>${total ? `${fmt(total)} level${total === 1 ? '' : 's'} built in the editor.` : 'Nobody has published a level yet.'}
         Scores from these are not ranked, because the leaderboard is scored against the campaign.</p>
      ${items ? `<div class="actions" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));width:100%">${items}</div>` : ''}
      <div class="actions">
        <a class="btn primary" href="/editor.html">Build one</a>
        <button class="btn ghost" id="btnBackMenu" type="button">Back</button>
      </div>
    `);
  }

  customResult({ victory, levelName, author, score, kills, accuracy, duration: dur }) {
    this.showOverlay(`
      <h2 class="${victory ? 'win' : 'bad'}">${victory ? 'Level cleared' : 'Shot down'}</h2>
      <p class="tagline">${esc(levelName)}${author ? ` &middot; built by ${esc(author)}` : ''}</p>
      <dl class="scorecard">
        <div><dt>score</dt><dd>${fmt(score)}</dd></div>
        <div><dt>kills</dt><dd>${fmt(kills)}</dd></div>
        <div><dt>accuracy</dt><dd>${accuracy.toFixed(0)}%</dd></div>
        <div><dt>time</dt><dd>${duration(dur)}</dd></div>
      </dl>
      <p class="hint">community levels are not ranked on the leaderboard</p>
      <div class="actions">
        <button class="btn primary" id="btnRetry" type="button">Run it again</button>
        <button class="btn ghost" id="btnMenu" type="button">Main screen</button>
      </div>
    `);
  }

  intro({ level, number, levelCount, threats, lives, score }) {
    const list = threats.map((t) => `
      <span class="threat"><i style="background:${esc(t.color)}"></i>
      <b>${esc(t.name)}</b><em>${t.count ? `x${t.count}` : 'hazard'}</em></span>`).join('');
    this.showOverlay(`
      <span class="level-badge">level ${number} of ${levelCount}</span>
      <h2>${esc(level.name)}</h2>
      <p class="tagline">${esc(level.tagline)}</p>
      <div class="threat-list">${list}</div>
      <p class="hint">hulls ${lives} &middot; score ${fmt(score)} &middot; stand by</p>
    `);
  }

  levelClear({ level, levelName, clearBonus, lifeBonus, perfect, score, isLast, countdown }) {
    this.showOverlay(`
      <span class="level-badge">level ${level} cleared</span>
      <h2>${esc(levelName)}</h2>
      <dl class="scorecard">
        <div><dt>clear bonus</dt><dd>${fmt(clearBonus)}</dd></div>
        <div><dt>hull bonus</dt><dd>${fmt(lifeBonus)}</dd></div>
        ${perfect ? `<div><dt>flawless</dt><dd>${fmt(perfect)}</dd></div>` : ''}
        <div><dt>score</dt><dd>${fmt(score)}</dd></div>
      </dl>
      <div class="actions">
        <button class="btn primary" id="btnNext" type="button">${isLast ? 'Final assault' : `Next level (${countdown})`}</button>
      </div>
    `);
  }

  paused() {
    this.showOverlay(`
      <h2>Paused</h2>
      <p>The invasion is politely waiting.</p>
      <div class="actions">
        <button class="btn primary" id="btnResume" type="button">Resume</button>
        <button class="btn ghost" id="btnAbandon" type="button">Abandon sortie</button>
      </div>
      <p class="hint">press <kbd>P</kbd> to resume</p>
    `);
  }

  gameEnd({ victory, reason, score, level, kills, accuracy, bestCombo, duration: dur, rank, submitState, levelName }) {
    const rankLine = submitState === 'pending'
      ? '<p class="hint">reporting to the defence net&hellip;</p>'
      : submitState === 'ok'
        ? `<p class="tagline">global rank #${rank}</p>`
        : `<p class="hint">${esc(submitState || 'score not submitted')}</p>`;
    this.showOverlay(`
      <h2 class="${victory ? 'win' : 'bad'}">${victory ? 'Campaign complete' : 'Game over'}</h2>
      <p class="tagline">${victory
        ? 'Twelve levels, one gunship. The void is quiet again.'
        : reason === 'overrun'
          ? `The line was overrun on level ${level} - ${esc(levelName)}.`
          : `Hull lost on level ${level} - ${esc(levelName)}.`}</p>
      <dl class="scorecard">
        <div><dt>score</dt><dd>${fmt(score)}</dd></div>
        <div><dt>level</dt><dd>${level}</dd></div>
        <div><dt>kills</dt><dd>${fmt(kills)}</dd></div>
        <div><dt>accuracy</dt><dd>${accuracy.toFixed(0)}%</dd></div>
        <div><dt>best chain</dt><dd>${bestCombo}</dd></div>
        <div><dt>time</dt><dd>${duration(dur)}</dd></div>
      </dl>
      ${rankLine}
      <div class="actions">
        <button class="btn primary" id="btnRetry" type="button">Fly again</button>
        <button class="btn ghost" id="btnMenu" type="button">Main screen</button>
      </div>
      <p class="hint">press <kbd>Enter</kbd> to fly again</p>
    `);
  }

  /* ----------------------------------------------------------------- rail */

  /**
   * @param {object} s stats payload
   * @param {number|null} liveOnline authoritative count from the open stream;
   *   a REST stats snapshot can race the SSE handshake and report 0.
   */
  renderStats(s, liveOnline = null) {
    if (!s) return;
    this.el.statOnline.textContent = fmt(liveOnline ?? s.online);
    this.el.statGames.textContent = fmt(s.gamesPlayed);
    this.el.statKills.textContent = fmt(s.totalKills);
    this.el.statBest.textContent = s.bestScore ? `${fmt(s.bestScore)}` : '0';
    this.el.statWins.textContent = fmt(s.victories);
    if (s.bestName) this.el.statBest.title = `held by ${s.bestName}`;
  }

  renderLeaderboard(scores, { myId = null, total = 0, offline = false } = {}) {
    if (!scores || scores.length === 0) {
      this.el.board.innerHTML = `<li class="board-empty">${offline
        ? 'leaderboard unreachable - playing offline'
        : 'no runs recorded yet. be the first.'}</li>`;
      this.el.boardNote.textContent = '';
      return;
    }
    this.el.board.innerHTML = scores.map((s, i) => `
      <li class="${s.id === myId ? 'me' : ''}">
        <span class="rk">${String(i + 1).padStart(2, '0')}</span>
        <span class="nm">${esc(s.name)}${s.victory ? ' <span class="won">*</span>' : ''}
          <small>lv ${s.level} &middot; ${fmt(s.kills)} kills &middot; ${s.accuracy.toFixed(0)}% &middot; ${timeAgo(s.createdAt)}</small>
        </span>
        <span class="sc">${fmt(s.score)}</span>
      </li>`).join('');
    this.el.boardNote.textContent =
      `${fmt(total)} run${total === 1 ? '' : 's'} recorded. * = campaign completed.`;
  }

  renderRoster(players, selfId) {
    this.el.rosterCount.textContent = String(players.length);
    if (players.length === 0) {
      this.el.roster.innerHTML = '<li class="muted">nobody else is flying right now</li>';
      return;
    }
    this.el.roster.innerHTML = players.slice(0, 40).map((p) => `
      <li class="${p.id === selfId ? 'self' : ''}">
        <span class="dot ${esc(p.status)}"></span>
        <span class="nm">${esc(p.name)}${p.id === selfId ? ' (you)' : ''}</span>
        ${p.level ? `<span class="lv">lv${p.level}</span>` : ''}
        <span class="sc">${fmt(p.score)}</span>
      </li>`).join('');
  }

  renderFeed(items) {
    if (!items || items.length === 0) {
      this.el.feed.innerHTML = '<li class="muted">no traffic yet</li>';
      return;
    }
    const recent = items.slice(-16).reverse();
    this.el.feed.innerHTML = recent.map((f) => `
      <li class="kind-${esc(f.kind)}">
        <span class="who">${esc(f.name)}</span> ${esc(f.text)}
        <span class="t">${timeAgo(f.at)}</span>
      </li>`).join('');
  }

  renderChat(items) {
    const recent = (items || []).slice(-30);
    if (recent.length === 0) {
      this.el.chat.innerHTML = '<li class="muted">channel is quiet</li>';
      return;
    }
    this.el.chat.innerHTML = recent.map((c) => `
      <li><span class="who">${esc(c.name)}:</span> ${esc(c.text)} <span class="t">${timeAgo(c.at)}</span></li>
    `).join('');
    this.el.chat.scrollTop = this.el.chat.scrollHeight;
  }

  renderLevels(levels, currentLevel = 0) {
    this.el.levelList.innerHTML = levels.map((lv) => `
      <li class="${lv.boss ? 'boss' : ''} ${this.cleared.has(lv.number) ? 'cleared' : ''} ${lv.number === currentLevel ? 'current' : ''}">
        <span class="n">${String(lv.number).padStart(2, '0')}</span>
        <span><b>${esc(lv.name)}</b><em>${esc(lv.tagline)}</em></span>
      </li>`).join('');
  }

  markCleared(n) {
    this.cleared.add(n);
  }

  renderCodex(campaign) {
    const order = ['alien', 'boss', 'object'];
    const list = Object.values(campaign.archetypes).sort((a, b) => {
      const d = order.indexOf(a.kind) - order.indexOf(b.kind);
      return d !== 0 ? d : a.score - b.score;
    });
    this.el.codex.innerHTML = list.map((a) => `
      <li>
        <i style="background:${esc(a.color)}"></i>
        <span><b>${esc(a.name)} <span class="hp">${a.hp} hp &middot; ${fmt(a.score)} pts${a.kind === 'object' ? ' &middot; hazard' : ''}${a.kind === 'boss' ? ' &middot; boss' : ''}</span></b>
        <em>${esc(a.codex)}</em></span>
      </li>`).join('');
    this.el.codexPowerups.innerHTML = campaign.powerups.map((p) => `
      <li>
        <i style="background:${esc(p.color)}"></i>
        <span><b>${esc(p.name)} <span class="hp">${p.duration ? `${p.duration}s` : 'instant'}</span></b>
        <em>${esc(p.blurb)}</em></span>
      </li>`).join('');
  }

  setHudVisible(show) {
    this.el.hud.classList.toggle('is-idle', !show);
    this.el.hud.setAttribute('aria-hidden', show ? 'false' : 'true');
  }

  setMuted(muted) {
    const b = this.el.btnMute;
    b.setAttribute('aria-pressed', String(muted));
    b.querySelector('.lbl').textContent = muted ? 'muted' : 'sound on';
    b.querySelector('.ico').innerHTML = muted ? '&#128263;' : '&#9834;';
  }

  showTouch(show) {
    this.el.touch.hidden = !show;
  }
}
