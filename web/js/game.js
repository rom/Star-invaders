/**
 * The Star Invaders simulation and renderer.
 *
 * The campaign (levels, bestiary, balance constants) is supplied by the Go
 * back end; this class turns that declarative script into a playable field
 * and draws it to a canvas. It owns no DOM beyond the canvas - the HUD,
 * overlays and side panels are driven through the `hooks` callbacks.
 */

import { audio } from './audio.js';
import { Entity, Formation, Bunker, rand, randInt, pickOne, clamp, lerp } from './entities.js';
import { drawSprite, spriteFrames, backdropFor, rgba, lighten } from './sprites.js';
import { VIEW, buildSpawnPlan } from './plan.js';

export { VIEW };

const GROUND_Y = VIEW.H - 30;
/** Hard ceiling on incoming fire, so the screen stays readable. */
const MAX_ENEMY_BULLETS = 24;
const PLAYER_Y = VIEW.H - 58;

export const STATES = {
  BOOT: 'boot',
  MENU: 'menu',
  INTRO: 'intro',
  PLAYING: 'playing',
  PAUSED: 'paused',
  LEVEL_CLEAR: 'levelclear',
  GAME_OVER: 'gameover',
  VICTORY: 'victory',
};

export class Game {
  constructor(canvas, campaign, hooks = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.campaign = campaign;
    this.archetypes = campaign.archetypes;
    this.levels = campaign.levels;
    this.rules = campaign.rules;
    this.powerupInfo = new Map(campaign.powerups.map((p) => [p.id, p]));
    this.hooks = hooks;
    this.audio = audio;

    this.W = VIEW.W;
    this.H = VIEW.H;
    this.scale = 1;
    this.raster = 1;

    this.state = STATES.BOOT;
    this.levelNumber = 1;
    this.level = this.levels[0];
    this.best = 0;

    // Difficulty scales the threat, never the player's weapons. Normal is
    // every multiplier at 1, so the campaign plays exactly as balanced.
    this.difficulties = campaign.difficulties || [];
    this.difficulty = this.difficulties.find((d) => d.default) || {
      id: 'normal', name: 'Normal', fireIntervalMul: 1, aimScatterMul: 1,
      projectileSpeedMul: 1, formationStepMul: 1, bossHpMul: 1,
      dropChanceMul: 1, livesBonus: 0, bulletCap: 24, scoreMul: 1,
    };

    this.keys = new Set();
    this.touch = { left: false, right: false, fire: false };
    this.pointerX = null;

    this.entities = [];
    this.playerBullets = [];
    this.enemyBullets = [];
    this.powerups = [];
    this.particles = [];
    this.floaters = [];
    this.beams = [];
    this.bunkers = [];
    this.timers = [];
    this.formation = null;
    this.boss = null;
    this.pending = [];
    this.hazardAcc = [];

    this.shake = 0;
    this.flashWhite = 0;
    this.time = 0;
    this.levelTime = 0;
    this.lastFrame = 0;
    this.running = false;
    this.hudTimer = 0;

    // The hitbox is deliberately smaller than the drawn ship: the sprite is
    // 40px wide but most of that is wing, and players read a shot through the
    // wings as a near miss, not a hit.
    this.player = {
      x: VIEW.W / 2, y: PLAYER_Y, vx: 0, r: 11,
      cooldown: 0, invuln: 0, shield: false, thrust: 0, hitFlash: 0,
    };
    this.active = { rapid: 0, spread: 0, pierce: 0, magnet: 0 };
    this.bombs = 1;

    this.stats = this.freshStats();
    this.stars = this.makeStars();

    this.resize();
    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);
    this._bindInput();
  }

  /** Switches tier. Takes effect from the next run. */
  setDifficulty(id) {
    const found = this.difficulties.find((d) => d.id === id);
    if (found) this.difficulty = found;
    return this.difficulty;
  }

  get scoreMul() { return this.difficulty.scoreMul || 1; }

  /** Every point scored goes through here so the tier scales all of it. */
  addScore(n) {
    const gained = Math.round(n * this.scoreMul);
    this.stats.score += gained;
    return gained;
  }

  freshStats() {
    return {
      score: 0, lives: Math.max(1, this.rules.startingLives + (this.difficulty.livesBonus || 0)), kills: 0, shots: 0, hits: 0,
      combo: 0, comboTimer: 0, bestCombo: 0, startedAt: 0, duration: 0,
      nextExtra: Math.round(this.rules.extraLifeEvery * (this.difficulty.scoreMul || 1)),
      levelDamage: 0, levelsCleared: 0,
      hazardKills: 0,
    };
  }

  /* -------------------------------------------------------------- display */

  makeStars() {
    const layers = [
      { n: 80, speed: 9, size: 1, alpha: 0.35 },
      { n: 46, speed: 22, size: 1.4, alpha: 0.6 },
      { n: 22, speed: 46, size: 2.1, alpha: 0.9 },
    ];
    return layers.map((l) => ({
      ...l,
      pts: Array.from({ length: l.n }, () => ({
        x: Math.random() * VIEW.W,
        y: Math.random() * VIEW.H,
        tw: Math.random() * Math.PI * 2,
      })),
    }));
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const rect = this.canvas.getBoundingClientRect();
    const cssW = rect.width || VIEW.W;
    const px = Math.max(320, Math.round(cssW * dpr));
    const target = Math.round(px);
    if (this.canvas.width !== target) {
      this.canvas.width = target;
      this.canvas.height = Math.round(target * (VIEW.H / VIEW.W));
    }
    this.scale = this.canvas.width / VIEW.W;
    this.raster = clamp(this.scale, 1, 3);
  }

  /* ---------------------------------------------------------------- input */

  /** True when a key event belongs to something the user is typing into. */
  static _isTyping(target) {
    if (!target) return false;
    const tag = target.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
  }

  _bindInput() {
    this._onKeyDown = (e) => {
      // The engine listens on window so the canvas never has to hold focus,
      // which means it also hears typing elsewhere on the page - the level
      // editor's forms, the squadron channel. Those are not flight controls.
      if (Game._isTyping(e.target)) return;
      const k = e.key.toLowerCase();
      if (['arrowleft', 'arrowright', ' ', 'arrowup', 'arrowdown'].includes(k)) e.preventDefault();
      if (e.repeat) return;
      this.keys.add(k);
      if (k === 'p' || k === 'escape') this.togglePause();
      if (k === 'b') this.useBomb();
      if (k === 'enter' && (this.state === STATES.MENU || this.state === STATES.GAME_OVER || this.state === STATES.VICTORY)) {
        this.hooks.onPrimaryAction?.();
      }
    };
    this._onKeyUp = (e) => this.keys.delete(e.key.toLowerCase());
    this._onBlur = () => this.keys.clear();
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('blur', this._onBlur);

    // Pointer steering: drag anywhere on the canvas to fly, which also makes
    // the game playable on a trackpad or a touch screen.
    const toLocal = (ev) => {
      const r = this.canvas.getBoundingClientRect();
      return ((ev.clientX - r.left) / r.width) * VIEW.W;
    };
    this.canvas.addEventListener('pointerdown', (ev) => {
      this.canvas.setPointerCapture?.(ev.pointerId);
      this.pointerX = toLocal(ev);
      this.touch.fire = true;
    });
    this.canvas.addEventListener('pointermove', (ev) => {
      if (this.pointerX !== null) this.pointerX = toLocal(ev);
    });
    const release = () => { this.pointerX = null; this.touch.fire = false; };
    this.canvas.addEventListener('pointerup', release);
    this.canvas.addEventListener('pointercancel', release);
    this.canvas.addEventListener('pointerleave', release);
  }

  setTouch(act, down) {
    if (act === 'bomb') { if (down) this.useBomb(); return; }
    if (act in this.touch) this.touch[act] = down;
  }

  destroy() {
    window.removeEventListener('resize', this._onResize);
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    window.removeEventListener('blur', this._onBlur);
    this.running = false;
    this.hooks = {};
    audio.stopMusic();
  }

  /* ------------------------------------------------------------ lifecycle */

  showMenu() {
    this.state = STATES.MENU;
    this.entities = [];
    this.playerBullets = [];
    this.enemyBullets = [];
    this.powerups = [];
    this.beams = [];
    this.bunkers = [];
    this.formation = null;
    this.boss = null;
    this.pending = [];
    this.level = this.levels[0];
    this.levelNumber = 1;
    audio.playMusic('menu');
    this.start();
  }

  newGame(startLevel = 1) {
    this.stats = this.freshStats();
    this.stats.startedAt = performance.now();
    this.bombs = 1;
    this.active = { rapid: 0, spread: 0, pierce: 0, magnet: 0 };
    this.player.shield = false;
    this.levelNumber = clamp(startLevel, 1, this.levels.length);
    this.beginLevel(this.levelNumber);
    this.hooks.onMilestone?.('start', { level: this.levelNumber, score: 0 });
  }

  beginLevel(n) {
    this.levelNumber = n;
    this.level = this.levels[n - 1];
    const lv = this.level;

    this.entities = [];
    this.playerBullets = [];
    this.enemyBullets = [];
    this.powerups = [];
    this.particles = [];
    this.floaters = [];
    this.beams = [];
    this.timers = [];
    this.boss = null;
    this.levelTime = 0;
    this.stats.levelDamage = 0;
    this.fireMul = lv.globalFireMul || 1;
    // A level fields dozens of shooters. Left to their own timers they would
    // produce a bullet-hell curtain rather than the sparse, readable fire of
    // an invaders game, so the swarm as a whole gets a shot budget and the
    // individual fire rates only decide who gets to use it.
    const d = this.difficulty;
    this.shotInterval = (Math.max(0.18, 0.56 - 0.023 * (n - 1)) / this.fireMul)
      * (d.fireIntervalMul || 1);
    this.shotGate = this.shotInterval;
    this.bulletCap = d.bulletCap || MAX_ENEMY_BULLETS;
    // Perfectly aimed fire from a dozen shooters at once is the least fair
    // thing in the game: there is no read on it, only a dice roll. Aimed
    // shots get a scatter that tightens as the campaign goes on, so later
    // gunnery feels sharper without earlier levels feeling arbitrary.
    this.aimScatter = Math.max(0.035, 0.11 - 0.006 * (n - 1)) * (d.aimScatterMul || 1);

    this.player.x = VIEW.W / 2;
    this.player.vx = 0;
    this.player.invuln = 1.6;

    this.formation = new Formation({
      stepInterval: (lv.formationStep || 0.7) * (d.formationStepMul || 1),
      drop: lv.formationDrop || 18,
      stepSize: 10,
      W: VIEW.W,
    });

    this.bunkers = [];
    const nb = lv.bunkers || 0;
    for (let i = 0; i < nb; i++) {
      const x = ((i + 1) / (nb + 1)) * VIEW.W;
      this.bunkers.push(new Bunker(x, PLAYER_Y - 96, 7));
    }

    this.pending = buildSpawnPlan(lv, this.archetypes);
    this.levelRequiredTotal = this.pending.filter((p) => p.arch.required).length;
    this.hazardAcc = (lv.hazards || []).map(() => 0);
    this.clearCountdown = null;

    this.state = STATES.INTRO;
    this.introTimer = 2.9;
    audio.levelStart();
    if (lv.boss) setTimeout(() => audio.bossWarning(), 700);
    audio.playMusic(lv.music || 'march');
    audio.setIntensity(clamp(n / this.levels.length, 0.15, 1));
    this.hooks.onLevelIntro?.(lv, n);
    this.pushHud(true);
    this.start();
  }

  spawnFromPlan(item) {
    const a = item.arch;
    if (item.boss) {
      const e = new Entity(a, {
        x: VIEW.W / 2, y: -140, anchorY: item.y,
        hpMul: this.difficulty.bossHpMul || 1, ...item.opts,
      });
      e.entering = true;
      e.blinkTimer = 0;
      this.boss = e;
      this.entities.push(e);
      this.hooks.onBoss?.(e);
      return e;
    }
    if (item.formation) {
      const e = new Entity(a, {
        x: item.slotX, y: item.slotY - 40,
        slotX: item.slotX, slotY: item.slotY,
        formation: this.formation, ...item.opts,
      });
      this.formation.add(e);
      this.entities.push(e);
      return e;
    }

    // Free-flying spawn.
    let x = item.x;
    let y = item.y;
    let vx = 0;
    let vy = 0;
    const speed = (a.speed || 80) * (item.opts.speedMul || 1);
    if (x === undefined) {
      let side = item.side || 'top';
      if (side === 'random') side = pickOne(['left', 'right', 'top', 'top']);
      if (side === 'left') { x = -34; y = rand(70, VIEW.H * 0.45); vx = speed; vy = rand(-10, 26); }
      else if (side === 'right') { x = VIEW.W + 34; y = rand(70, VIEW.H * 0.45); vx = -speed; vy = rand(-10, 26); }
      else { x = rand(60, VIEW.W - 60); y = -34; vy = speed; }
    }
    const e = new Entity(a, { x, y, vx, vy, anchorY: y, ...item.opts });
    if (a.behavior === 'dive') { e.state = 'dive'; e.vy = e.speed; }
    if (a.behavior === 'charge') { e.vy = e.speed * 0.5; e.vx = rand(-30, 30); }
    if (a.behavior === 'orbit') { e.anchorX = clamp(x, e.amp + 50, VIEW.W - e.amp - 50); e.anchorY = y; }
    this.entities.push(e);
    return e;
  }

  spawnHazard(h, idx) {
    const a = this.archetypes[h.archetype];
    if (!a) return;
    const speed = (a.speed || 60) * (h.speedMul || 1);
    const fromSide = a.behavior === 'drift' && Math.random() < 0.35;
    let x, y, vx, vy;
    if (fromSide) {
      const left = Math.random() < 0.5;
      x = left ? -30 : VIEW.W + 30;
      y = rand(50, VIEW.H * 0.5);
      vx = (left ? 1 : -1) * speed * 0.8;
      vy = speed * 0.55;
    } else {
      x = rand(40, VIEW.W - 40);
      y = -30;
      vx = rand(-40, 40);
      vy = speed;
    }
    const e = new Entity(a, { x, y, vx, vy, anchorY: y });
    this.entities.push(e);
  }

  /* ------------------------------------------------------------ main loop */

  start() {
    if (this.running) return;
    this.running = true;
    this.lastFrame = performance.now();
    const frame = (now) => {
      if (!this.running) return;
      const dt = Math.min(0.05, (now - this.lastFrame) / 1000);
      this.lastFrame = now;
      this.update(dt);
      this.render(dt);
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  stop() { this.running = false; }

  togglePause() {
    if (this.state === STATES.PLAYING) {
      this.state = STATES.PAUSED;
      audio.uiBack();
      this.hooks.onPause?.(true);
    } else if (this.state === STATES.PAUSED) {
      this.state = STATES.PLAYING;
      audio.uiClick();
      this.hooks.onPause?.(false);
    }
  }

  update(dt) {
    this.time += dt;
    this.updateStars(dt);
    if (this.shake > 0) this.shake = Math.max(0, this.shake - dt * 2.4);
    if (this.flashWhite > 0) this.flashWhite = Math.max(0, this.flashWhite - dt * 3.4);
    this.updateParticles(dt);

    if (this.state === STATES.MENU) {
      this.updateMenuDemo(dt);
      return;
    }
    if (this.state === STATES.INTRO) {
      this.introTimer -= dt;
      if (this.introTimer <= 0) {
        this.state = STATES.PLAYING;
        this.hooks.onLevelBegin?.(this.level, this.levelNumber);
      }
      return;
    }
    if (this.state !== STATES.PLAYING) return;

    this.levelTime += dt;
    this.stats.duration = (performance.now() - this.stats.startedAt) / 1000;
    if (this.shotGate > 0) this.shotGate -= dt;

    // Scheduled one-shot callbacks (boss pattern staggering, respawns, ...).
    for (let i = this.timers.length - 1; i >= 0; i--) {
      this.timers[i].at -= dt;
      if (this.timers[i].at <= 0) {
        const fn = this.timers[i].fn;
        this.timers.splice(i, 1);
        fn();
      }
    }

    while (this.pending.length && this.pending[0].at <= this.levelTime) {
      this.spawnFromPlan(this.pending.shift());
    }

    (this.level.hazards || []).forEach((h, i) => {
      if (this.levelTime < (h.delay || 0)) return;
      this.hazardAcc[i] += (h.rate || 0) * dt;
      while (this.hazardAcc[i] >= 1) {
        this.hazardAcc[i] -= 1;
        const live = this.entities.filter((e) => e.alive && e.arch.id === h.archetype).length;
        if (live < (h.max || 3)) this.spawnHazard(h, i);
      }
    });

    this.formation?.update(dt, this);
    this.updatePlayer(dt);

    for (const e of this.entities) if (e.alive) e.update(dt, this);

    this.updateBullets(dt);
    this.updateBeams(dt);
    this.updatePowerups(dt);
    this.collide();

    if (this.stats.comboTimer > 0) {
      this.stats.comboTimer -= dt;
      if (this.stats.comboTimer <= 0) this.stats.combo = 0;
    }

    // Entities that flew off the field are swept without a score award.
    this.entities = this.entities.filter((e) => e.alive);
    if (this.boss && !this.boss.alive) this.boss = null;

    this.checkInvasion();
    this.checkLevelComplete(dt);

    this.hudTimer -= dt;
    if (this.hudTimer <= 0) { this.hudTimer = 0.1; this.pushHud(); }
  }

  updateStars(dt) {
    const mul = (this.level?.starSpeed || 1) * (this.state === STATES.MENU ? 0.5 : 1);
    for (const layer of this.stars) {
      for (const p of layer.pts) {
        p.y += layer.speed * mul * dt;
        p.tw += dt * 3;
        if (p.y > VIEW.H) { p.y = -2; p.x = Math.random() * VIEW.W; }
      }
    }
  }

  /** A slow drifting attract-mode behind the title screen. */
  updateMenuDemo(dt) {
    this.menuTimer = (this.menuTimer || 0) - dt;
    if (this.menuTimer <= 0) {
      this.menuTimer = rand(0.6, 1.5);
      const ids = ['grunt', 'gunner', 'scout', 'weaver', 'phantom', 'asteroid', 'comet', 'swarmer', 'orbiter'];
      const a = this.archetypes[pickOne(ids)];
      if (a) {
        const e = new Entity(a, {
          x: rand(60, VIEW.W - 60), y: -40,
          vx: rand(-30, 30), vy: rand(40, 90),
        });
        e.arch = { ...a, behavior: 'drift', fireRate: 0 };
        e.fireRate = 0;
        e.spin = rand(-0.4, 0.4) * (a.kind === 'object' ? 1 : 0);
        this.entities.push(e);
      }
    }
    for (const e of this.entities) if (e.alive) e.update(dt, this);
    this.entities = this.entities.filter((e) => e.alive && e.y < VIEW.H + 60);
  }

  /* --------------------------------------------------------------- player */

  updatePlayer(dt) {
    const p = this.player;
    const sp = this.rules.playerSpeed;
    let dir = 0;
    if (this.keys.has('arrowleft') || this.keys.has('a') || this.touch.left) dir -= 1;
    if (this.keys.has('arrowright') || this.keys.has('d') || this.touch.right) dir += 1;

    if (this.pointerX !== null) {
      const dx = this.pointerX - p.x;
      p.vx = clamp(dx * 9, -sp * 1.3, sp * 1.3);
    } else if (dir !== 0) {
      p.vx = lerp(p.vx, dir * sp, 14 * dt);
    } else {
      p.vx = lerp(p.vx, 0, 16 * dt);
    }
    p.x = clamp(p.x + p.vx * dt, 26, VIEW.W - 26);
    p.thrust = Math.abs(p.vx) / sp;

    if (p.invuln > 0) p.invuln -= dt;
    if (p.hitFlash > 0) p.hitFlash -= dt;
    for (const k of Object.keys(this.active)) {
      if (this.active[k] > 0) {
        this.active[k] -= dt;
        if (this.active[k] <= 0) {
          this.active[k] = 0;
          this.hooks.onToast?.(`${this.powerupInfo.get(k)?.name || k} offline`, 'warn');
        }
      }
    }

    p.cooldown -= dt;
    const firing = this.keys.has(' ') || this.keys.has('w') || this.keys.has('arrowup') || this.touch.fire;
    if (firing && p.cooldown <= 0) this.playerFire();
  }

  playerFire() {
    const p = this.player;
    const rapid = this.active.rapid > 0;
    const cap = this.rules.baseBulletCap + (rapid ? 3 : 0) + (this.active.spread > 0 ? 2 : 0);
    if (this.playerBullets.length >= cap) return;

    p.cooldown = this.rules.baseFireCooldown * (rapid ? 0.48 : 1);
    const speed = this.rules.bulletSpeed;
    const pierce = this.active.pierce > 0;
    const mk = (vx, vy) => ({
      x: p.x, y: p.y - 18, vx, vy, r: 4.5, dmg: 1,
      pierce: pierce ? 1 : 0, kind: pierce ? 'lance' : 'bolt', life: 2.4, hits: new Set(),
    });

    if (this.active.spread > 0) {
      this.playerBullets.push(mk(-150, -speed * 0.95), mk(0, -speed), mk(150, -speed * 0.95));
      this.stats.shots += 3;
    } else {
      this.playerBullets.push(mk(0, -speed));
      this.stats.shots += 1;
    }
    audio.shoot(rapid ? 1 : 0);
    this.spark(p.x, p.y - 20, '#aef7c8', 1.2);
  }

  useBomb() {
    if (this.state !== STATES.PLAYING || this.bombs <= 0) return;
    this.bombs--;
    audio.bomb();
    this.flashWhite = 1;
    this.shake = 1.4;
    this.enemyBullets.length = 0;
    this.beams.length = 0;
    for (const e of [...this.entities]) {
      if (!e.alive) continue;
      if (e.arch.kind === 'boss') {
        // The return value matters: without it a bomb could land the killing
        // blow and the boss would simply vanish, unscored and unannounced.
        if (e.damage(Math.max(4, Math.round(e.maxHp * 0.08)), this)) {
          this.killEntity(e, true);
        }
        continue;
      }
      this.burst(e.x, e.y, e.color, 14, 1.1);
      if (e.damage(4, this)) this.killEntity(e, true);
    }
    for (let i = 0; i < 40; i++) {
      this.spark(rand(0, VIEW.W), rand(0, VIEW.H * 0.8), '#ffffff', 2);
    }
    this.hooks.onToast?.('smart bomb detonated', 'warn');
    this.pushHud(true);
  }

  /* -------------------------------------------------------------- bullets */

  /**
   * Asks for permission to fire on behalf of an ordinary attacker. Bosses
   * bypass this - their patterns are authored, not emergent.
   * @returns {boolean} true if the shot may be taken
   */
  requestEnemyShot() {
    if (this.shotGate > 0) return false;
    if (this.enemyBullets.length >= (this.bulletCap || MAX_ENEMY_BULLETS)) return false;
    this.shotGate = this.shotInterval * rand(0.7, 1.35);
    return true;
  }

  enemyFire(e) {
    const base = e.projectileSpeed * (this.difficulty.projectileSpeedMul || 1);
    const scatter = this.aimScatter || 0.08;
    const toPlayer = Math.atan2(this.player.y - e.y, this.player.x - e.x)
      + rand(-scatter, scatter);
    const add = (vx, vy, kind, r = 5, dmg = 1) => {
      this.enemyBullets.push({ x: e.x, y: e.y + e.r * 0.5, vx, vy, r, kind, dmg, life: 6, color: e.color });
    };
    switch (e.projectileKind) {
      case 'plasma':
        add(Math.cos(toPlayer) * base * 0.75, Math.sin(toPlayer) * base * 0.75, 'plasma', 6);
        break;
      case 'spread': {
        for (const a of [-0.38, 0, 0.38]) {
          add(Math.sin(a) * base, Math.cos(a) * base, 'bolt', 5);
        }
        break;
      }
      case 'laser':
        add(Math.cos(toPlayer) * base, Math.sin(toPlayer) * base, 'laser', 3.6);
        break;
      case 'orb':
        add(Math.cos(toPlayer) * base * 0.6, Math.sin(toPlayer) * base * 0.6, 'orb', 10, 1);
        break;
      default:
        add(rand(-24, 24), base, 'bolt', 5);
    }
    audio.enemyShoot();
  }

  bossShot(b, angle, speed, kind = 'orb', r = 8) {
    // Boss patterns bypass the swarm's shot budget on purpose, but not
    // without limit: a late-phase fan every third of a second would
    // otherwise fill the screen faster than it drains.
    if (this.enemyBullets.length >= Math.round((this.bulletCap || MAX_ENEMY_BULLETS) * 1.6)) return;
    this.enemyBullets.push({
      x: b.x, y: b.y + b.r * 0.4,
      vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
      r, kind, dmg: 1, life: 7, color: b.color,
    });
  }

  runBossPattern(b, name, phase) {
    const speed = b.projectileSpeed * (this.difficulty.projectileSpeedMul || 1);
    const aim = Math.atan2(this.player.y - b.y, this.player.x - b.x);
    switch (name) {
      case 'fan': {
        const n = Math.min(13, 5 + phase * 2);
        for (let i = 0; i < n; i++) {
          const a = (Math.PI / 2) + (i - (n - 1) / 2) * (1.6 / n);
          this.bossShot(b, a, speed, 'orb', 8);
        }
        audio.enemyShoot();
        break;
      }
      case 'sweep': {
        for (let i = 0; i < 6; i++) {
          this.timers.push({
            at: i * 0.09,
            fn: () => {
              if (!b.alive) return;
              this.bossShot(b, (Math.PI / 2) - 0.6 + i * 0.24, speed * 1.1, 'plasma', 6);
              audio.enemyShoot();
            },
          });
        }
        break;
      }
      case 'spiral': {
        b.spiral = (b.spiral || 0) + 0.46;
        for (let i = 0; i < 4; i++) {
          this.bossShot(b, b.spiral + (i * Math.PI) / 2, speed * 0.78, 'orb', 7);
        }
        audio.enemyShoot();
        break;
      }
      case 'lance': {
        for (let i = 0; i < 3; i++) {
          this.timers.push({
            at: i * 0.14,
            fn: () => {
              if (!b.alive) return;
              const a = Math.atan2(this.player.y - b.y, this.player.x - b.x);
              // Boss patterns are authored, so they bypass the aim scatter
              // that ordinary gunnery gets. At 1.5x a laser crossed the
              // field faster than the shot could be read; 1.3 still punishes
              // standing still without being a coin toss.
              this.bossShot(b, a, speed * 1.3, 'laser', 4);
              audio.enemyShoot();
            },
          });
        }
        break;
      }
      case 'blink': {
        b.blinkTimer = 0.55;
        this.burst(b.x, b.y, b.color, 18, 1.2);
        audio.shieldBreak();
        this.timers.push({
          at: 0.56,
          fn: () => {
            if (!b.alive) return;
            this.burst(b.x, b.y, b.color, 18, 1.2);
            this.runBossPattern(b, 'fan', phase);
          },
        });
        break;
      }
      case 'beam': {
        // Two at once is a dodge; four is a wall with no gap in it.
        if (this.beams.length >= 2) break;
        this.beams.push({ x: this.player.x, w: 54, warn: 0.85, active: 0.7, t: 0 });
        audio.bossWarning();
        break;
      }
      case 'summon': {
        // Escorts are the boss's doing, not the level's. They are capped so
        // a long fight cannot bury the field, and they do not gate
        // completion: what a level requires is what its waves declared, the
        // same rule that keeps hazards from making a level unwinnable.
        const escorts = this.entities.filter((e) => e.alive && e.summoned).length;
        if (escorts >= 16) break;
        const ids = ['scout', 'swarmer', 'grunt'];
        const n = Math.min(2 + phase, 16 - escorts);
        for (let i = 0; i < n; i++) {
          const a = this.archetypes[pickOne(ids)];
          if (!a) continue;
          const e = new Entity(a, {
            x: clamp(b.x + rand(-90, 90), 40, VIEW.W - 40),
            y: b.y + rand(10, 40),
            vy: (a.speed || 90) * 0.6, anchorY: b.y,
          });
          if (a.behavior === 'dive') { e.state = 'dive'; e.vy = e.speed; }
          e.summoned = true;
          e.required = false;
          this.entities.push(e);
          this.burst(e.x, e.y, a.color, 8, 0.7);
        }
        this.hooks.onToast?.('escorts launched', 'bad');
        break;
      }
      case 'rage':
      default: {
        const choice = pickOne(['fan', 'spiral', 'lance', 'beam', 'sweep']);
        this.runBossPattern(b, choice, phase);
        if (Math.random() < 0.5) {
          this.timers.push({ at: 0.35, fn: () => b.alive && this.runBossPattern(b, 'fan', phase) });
        }
        break;
      }
    }
    void aim;
  }

  onBossPhase(b, phase) {
    if (phase === 0) return;
    this.shake = 1;
    audio.bossWarning();
    this.hooks.onToast?.(`${b.arch.name} - phase ${phase + 1}`, 'bad');
    for (let i = 0; i < 30; i++) this.spark(b.x + rand(-b.r, b.r), b.y + rand(-b.r, b.r), b.color, 2);
  }

  updateBullets(dt) {
    for (const b of this.playerBullets) {
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.life -= dt;
    }
    this.playerBullets = this.playerBullets.filter((b) => b.life > 0 && b.y > -20 && b.x > -20 && b.x < VIEW.W + 20);

    for (const b of this.enemyBullets) {
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.life -= dt;
      if (b.kind === 'orb') b.vy += 26 * dt;
    }
    this.enemyBullets = this.enemyBullets.filter(
      (b) => b.life > 0 && b.y < VIEW.H + 24 && b.y > -60 && b.x > -40 && b.x < VIEW.W + 40,
    );
  }

  updateBeams(dt) {
    for (const bm of this.beams) {
      bm.t += dt;
      if (bm.t > bm.warn && bm.t < bm.warn + bm.active) {
        if (Math.abs(this.player.x - bm.x) < bm.w / 2 + this.player.r * 0.5) {
          this.hurtPlayer();
        }
        if (Math.random() < 0.6) this.spark(bm.x + rand(-bm.w / 2, bm.w / 2), rand(0, VIEW.H), '#ffd166', 1.6);
      }
    }
    this.beams = this.beams.filter((bm) => bm.t < bm.warn + bm.active + 0.25);
  }

  /* ------------------------------------------------------------- pickups */

  maybeDrop(e) {
    const lv = this.level;
    if (!lv.powerups || lv.powerups.length === 0) return;
    if (!e.required && Math.random() > 0.35) return; // hazards drop rarely
    const chance = (lv.dropChance || 0.1) * (this.difficulty.dropChanceMul || 1);
    if (Math.random() > chance) return;
    const id = pickOne(lv.powerups);
    const info = this.powerupInfo.get(id);
    this.powerups.push({
      x: e.x, y: e.y, vy: 72, r: 13, id,
      color: info?.color || '#ffffff', glyph: info?.glyph || '?', t: 0,
    });
  }

  updatePowerups(dt) {
    const p = this.player;
    for (const u of this.powerups) {
      u.t += dt;
      u.y += u.vy * dt;
      if (this.active.magnet > 0) {
        const dx = p.x - u.x;
        const dy = p.y - u.y;
        const d = Math.hypot(dx, dy) || 1;
        if (d < 320) { u.x += (dx / d) * 150 * dt; u.y += (dy / d) * 110 * dt; }
      }
      if (Math.hypot(u.x - p.x, u.y - p.y) < u.r + p.r + 6) {
        u.taken = true;
        this.applyPowerup(u.id);
      }
    }
    this.powerups = this.powerups.filter((u) => !u.taken && u.y < VIEW.H + 20);
  }

  applyPowerup(id) {
    const info = this.powerupInfo.get(id);
    const name = info?.name || id;
    switch (id) {
      case 'life':
        this.stats.lives++;
        audio.extraLife();
        break;
      case 'shield':
        this.player.shield = true;
        audio.powerup();
        break;
      case 'bomb':
        this.bombs = Math.min(3, this.bombs + 1);
        audio.powerup();
        break;
      default:
        this.active[id] = Math.max(this.active[id] || 0, info?.duration || 15);
        audio.powerup();
    }
    this.addFloater(this.player.x, this.player.y - 36, name, info?.color || '#fff');
    this.hooks.onToast?.(name, 'ok');
    this.pushHud(true);
  }

  /* ------------------------------------------------------------ collision */

  collide() {
    const p = this.player;

    // Player shots.
    for (const b of this.playerBullets) {
      if (b.dead) continue;
      for (const bunker of this.bunkers) {
        if (bunker.solidAt(b.x, b.y - b.r)) {
          bunker.hit(b.x, b.y - b.r, 1);
          b.dead = true;
          this.spark(b.x, b.y, '#9ad4ff', 1);
          break;
        }
      }
      if (b.dead) continue;

      for (const e of this.entities) {
        if (!e.alive || !e.targetable) continue;
        if (b.hits.has(e.id)) continue;
        const rr = e.r + b.r;
        if ((e.x - b.x) ** 2 + (e.y - b.y) ** 2 > rr * rr) continue;

        this.stats.hits++;
        b.hits.add(e.id);
        // "From the front" means the shot came up into the plated underside
        // of a bulwark, which is where the armour is.
        const died = e.damage(b.dmg, this, true);
        this.spark(b.x, b.y, e.color, 1.4);
        if (died) this.killEntity(e);
        if (b.pierce > 0 && died) { b.pierce--; } else { b.dead = true; }
        break;
      }
    }
    this.playerBullets = this.playerBullets.filter((b) => !b.dead);

    // Enemy shots.
    for (const b of this.enemyBullets) {
      if (b.dead) continue;
      let blocked = false;
      for (const bunker of this.bunkers) {
        if (bunker.solidAt(b.x, b.y + b.r)) {
          bunker.hit(b.x, b.y + b.r, b.kind === 'orb' ? 2 : 1);
          b.dead = true;
          blocked = true;
          this.spark(b.x, b.y, b.color || '#ff9f9f', 1);
          break;
        }
      }
      if (blocked) continue;
      if (p.invuln > 0) continue;
      const rr = p.r + b.r;
      if ((p.x - b.x) ** 2 + (p.y - b.y) ** 2 <= rr * rr) {
        b.dead = true;
        this.hurtPlayer();
      }
    }
    this.enemyBullets = this.enemyBullets.filter((b) => !b.dead);

    // Bodies.
    for (const e of this.entities) {
      if (!e.alive) continue;

      for (const bunker of this.bunkers) {
        if (e.y + e.r > bunker.y && e.y - e.r < bunker.y + bunker.h
          && e.x + e.r > bunker.x && e.x - e.r < bunker.x + bunker.w) {
          if (bunker.hit(e.x, e.y + e.r * 0.4, 2)) this.spark(e.x, e.y, '#9ad4ff', 1.4);
        }
      }

      if (p.invuln <= 0 && Math.hypot(e.x - p.x, e.y - p.y) < e.r + p.r) {
        const wasBoss = e.arch.kind === 'boss';
        if (!wasBoss) {
          this.burst(e.x, e.y, e.color, 16, 1.2);
          e.alive = false;
          this.awardKill(e, false);
        }
        this.hurtPlayer();
      }
    }
  }

  killEntity(e, silent = false) {
    this.awardKill(e, true);
    const size = e.arch.kind === 'boss' ? 2 : e.r > 20 ? 1.2 : e.r > 14 ? 0.7 : 0.3;
    if (!silent) audio.explode(size);
    this.burst(e.x, e.y, e.color, e.arch.kind === 'boss' ? 90 : 14 + Math.round(e.r), 1 + size * 0.5);
    this.shake = Math.max(this.shake, e.arch.kind === 'boss' ? 1.6 : 0.2 + size * 0.2);

    // Mines and lancers go off when they die.
    if (e.arch.blast) {
      const blast = e.arch.blast;
      for (let i = 0; i < 24; i++) this.spark(e.x, e.y, '#ffd166', 2);
      if (this.player.invuln <= 0 && Math.hypot(e.x - this.player.x, e.y - this.player.y) < blast + this.player.r) {
        this.hurtPlayer();
      }
      for (const other of this.entities) {
        if (other === e || !other.alive || other.arch.kind === 'boss') continue;
        if (Math.hypot(other.x - e.x, other.y - e.y) < blast + other.r) {
          if (other.damage(2, this, false)) this.killEntity(other, true);
        }
      }
      for (const bunker of this.bunkers) bunker.hit(e.x, e.y, 2);
    }

    // Splitters burst into children.
    if (e.arch.splitInto && e.arch.splitCount > 0) {
      const child = this.archetypes[e.arch.splitInto];
      if (child) {
        for (let i = 0; i < e.arch.splitCount; i++) {
          const c = new Entity(child, {
            x: e.x + rand(-16, 16), y: e.y + rand(-8, 8),
            vy: (child.speed || 120) * 0.8, scale: 0.9, anchorY: e.y,
          });
          c.state = 'dive';
          c.vy = c.speed;
          this.entities.push(c);
        }
        this.hooks.onToast?.(`${e.arch.name} split`, 'warn');
      }
    }

    this.maybeDrop(e);

    if (e.arch.kind === 'boss') {
      this.onBossDefeated(e);
    }
  }

  /** A hatching parent (a Brood Hive) putting another child on the field. */
  hatch(parent) {
    const childId = parent.arch.hatchInto;
    const child = this.archetypes[childId];
    if (!child) return;
    const live = this.entities.filter((x) => x.alive && x.arch.id === childId).length;
    if (live >= 26 || this.entities.length > 140) return;   // keep the field readable
    const e = new Entity(child, {
      x: clamp(parent.x + rand(-18, 18), 24, VIEW.W - 24),
      y: parent.y + parent.r * 0.7,
      vy: (child.speed || 120) * 0.5,
      anchorY: parent.y,
    });
    if (child.behavior === 'dive') { e.state = 'dive'; e.vy = e.speed; }
    this.entities.push(e);
    this.burst(e.x, e.y, child.color, 7, 0.6);
  }

  awardKill(e, byShot) {
    const combo = this.stats.combo;
    const mult = 1 + Math.min(this.rules.comboMax - 1, Math.floor(combo / 3));
    const gained = this.addScore(e.score * mult);
    this.stats.kills++;
    if (!e.required) this.stats.hazardKills++;

    this.stats.combo++;
    this.stats.comboTimer = this.rules.comboWindow;
    if (this.stats.combo > this.stats.bestCombo) {
      this.stats.bestCombo = this.stats.combo;
      if (this.stats.combo === 12 || this.stats.combo === 24) {
        this.hooks.onMilestone?.('combo', { level: this.levelNumber, score: this.stats.combo });
      }
    }

    this.addFloater(e.x, e.y, mult > 1 ? `${gained} x${mult}` : `${gained}`,
      mult > 2 ? '#ffd166' : '#d7e3ff');

    const extraStep = Math.max(1, Math.round(this.rules.extraLifeEvery * this.scoreMul));
    while (this.stats.score >= this.stats.nextExtra) {
      this.stats.nextExtra += extraStep;
      this.stats.lives++;
      audio.extraLife();
      this.hooks.onToast?.('extra hull earned', 'ok');
      this.hooks.onMilestone?.('extralife', { level: this.levelNumber, score: this.stats.score });
    }
    void byShot;
  }

  onBossDefeated(b) {
    this.shake = 2.2;
    this.flashWhite = 0.8;
    audio.explode(2);
    for (let i = 0; i < 8; i++) {
      this.timers.push({
        at: i * 0.14,
        fn: () => {
          audio.explode(1.2);
          this.burst(b.x + rand(-b.r, b.r), b.y + rand(-b.r, b.r), pickOne([b.color, '#ffffff', b.accent]), 24, 1.6);
          this.shake = Math.max(this.shake, 1);
        },
      });
    }
    this.hooks.onToast?.(`${b.arch.name} destroyed`, 'ok');
    this.hooks.onMilestone?.('boss', {
      level: this.levelNumber, score: this.stats.score, detail: b.arch.name,
    });
    this.boss = null;
    this.hooks.onBoss?.(null);
  }

  hurtPlayer() {
    const p = this.player;
    if (p.invuln > 0) return;
    if (p.shield) {
      p.shield = false;
      p.invuln = 1.1;
      audio.shieldBreak();
      this.burst(p.x, p.y, '#4cc9f0', 22, 1.2);
      this.hooks.onToast?.('deflector burned out', 'warn');
      this.pushHud(true);
      return;
    }
    this.stats.lives--;
    this.stats.combo = 0;
    this.stats.levelDamage++;
    p.invuln = 2.4;
    p.hitFlash = 0.5;
    this.shake = 1.5;
    audio.playerHit();
    this.burst(p.x, p.y, '#ff6b6b', 40, 1.6);
    // Clear the immediate area so the player does not respawn into a wall.
    this.enemyBullets = this.enemyBullets.filter((b) => Math.hypot(b.x - p.x, b.y - p.y) > 150);
    this.active = { rapid: 0, spread: 0, pierce: 0, magnet: 0 };
    this.pushHud(true);

    if (this.stats.lives <= 0) this.endGame(false);
  }

  checkInvasion() {
    if (!this.formation) return;
    const low = this.formation.lowestY();
    if (low > PLAYER_Y - 18) {
      this.hooks.onToast?.('the line is overrun', 'bad');
      this.stats.lives = 0;
      this.burst(this.player.x, this.player.y, '#ff6b6b', 50, 2);
      audio.playerHit();
      this.endGame(false, 'overrun');
    }
  }

  checkLevelComplete(dt = 0) {
    const done = this.pending.length === 0
      && !(this.boss && this.boss.alive)
      && this.entities.filter((e) => e.alive && e.required).length === 0;

    if (!done) {
      this.clearCountdown = null;
      return;
    }
    // Hold the overlay back for a beat so the last explosion - and a boss's
    // whole death sequence, which is a chain of scheduled blasts - actually
    // plays instead of being cut off by the scorecard.
    if (this.clearCountdown === null) {
      this.clearCountdown = this.timers.length > 0 ? 1.9 : 0.65;
      return;
    }
    this.clearCountdown -= dt;
    if (this.clearCountdown > 0) return;
    this.clearCountdown = null;

    // Level cleared.
    const lvl = this.levelNumber;
    const clearBonus = this.rules.clearBonusPerLevel * lvl;
    const lifeBonus = this.stats.lives * 250;
    const perfect = this.stats.levelDamage === 0 ? this.rules.perfectBonus : 0;
    this.addScore(clearBonus + lifeBonus + perfect);
    this.stats.levelsCleared++;
    this.state = STATES.LEVEL_CLEAR;
    audio.levelClear();
    this.enemyBullets.length = 0;
    this.beams.length = 0;
    this.powerups.length = 0;

    this.hooks.onMilestone?.('level', { level: lvl, score: this.stats.score });
    this.hooks.onLevelClear?.({
      level: lvl,
      levelName: this.level.name,
      clearBonus, lifeBonus, perfect,
      score: this.stats.score,
      isLast: lvl >= this.levels.length,
    });
    this.pushHud(true);
  }

  nextLevel() {
    if (this.levelNumber >= this.levels.length) {
      this.endGame(true);
      return;
    }
    this.beginLevel(this.levelNumber + 1);
  }

  endGame(victory, reason = '') {
    if (this.state === STATES.GAME_OVER || this.state === STATES.VICTORY) return;
    this.state = victory ? STATES.VICTORY : STATES.GAME_OVER;
    this.stats.duration = (performance.now() - this.stats.startedAt) / 1000;
    if (victory) audio.victory(); else audio.gameOver();
    if (this.stats.score > this.best) this.best = this.stats.score;
    this.hooks.onGameEnd?.({
      victory,
      reason,
      score: this.stats.score,
      level: this.levelNumber,
      kills: this.stats.kills,
      shots: this.stats.shots,
      hits: this.stats.hits,
      bestCombo: this.stats.bestCombo,
      duration: this.stats.duration,
      accuracy: this.stats.shots ? (this.stats.hits / this.stats.shots) * 100 : 0,
    });
    this.pushHud(true);
  }

  /* ------------------------------------------------------------ particles */

  spark(x, y, color, scale = 1) {
    if (this.particles.length > 700) return;
    this.particles.push({
      x, y, vx: rand(-40, 40) * scale, vy: rand(-40, 40) * scale,
      life: rand(0.18, 0.5), max: 0.5, color, size: rand(1, 2.4) * scale,
    });
  }

  burst(x, y, color, n = 14, scale = 1) {
    const budget = Math.min(n, Math.max(0, 760 - this.particles.length));
    for (let i = 0; i < budget; i++) {
      const a = rand(0, Math.PI * 2);
      const sp = rand(40, 260) * scale;
      this.particles.push({
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: rand(0.25, 0.8) * scale, max: 0.8 * scale,
        color: Math.random() < 0.25 ? '#ffffff' : color,
        size: rand(1.4, 3.6) * scale,
      });
    }
  }

  addFloater(x, y, text, color) {
    if (this.floaters.length > 40) return;
    this.floaters.push({ x, y, text, color, life: 0.95, max: 0.95 });
  }

  updateParticles(dt) {
    for (const p of this.particles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 1 - 2.2 * dt;
      p.vy = p.vy * (1 - 2.2 * dt) + 60 * dt;
      p.life -= dt;
    }
    if (this.particles.length) this.particles = this.particles.filter((p) => p.life > 0);

    for (const f of this.floaters) {
      f.y -= 34 * dt;
      f.life -= dt;
    }
    if (this.floaters.length) this.floaters = this.floaters.filter((f) => f.life > 0);
  }

  /* ----------------------------------------------------------------- HUD */

  pushHud(force = false) {
    const boss = this.boss && this.boss.alive
      ? { name: this.boss.arch.name, hp: this.boss.hp, maxHp: this.boss.maxHp }
      : null;
    const remaining = this.entities.filter((e) => e.alive && e.required).length
      + this.pending.filter((p) => p.arch.required).length;
    const total = Math.max(this.levelRequiredTotal || 0, remaining);
    this.hooks.onHud?.({
      score: this.stats.score,
      best: Math.max(this.best, this.stats.score),
      lives: this.stats.lives,
      bombs: this.bombs,
      level: this.levelNumber,
      levelName: this.level?.name || '',
      levelCount: this.levels.length,
      remaining,
      total,
      combo: this.stats.combo,
      shield: this.player.shield,
      powerups: Object.entries(this.active)
        .filter(([, v]) => v > 0)
        .map(([k, v]) => {
          const info = this.powerupInfo.get(k);
          return { id: k, name: info?.name || k, color: info?.color || '#fff', glyph: info?.glyph || '?', remain: v, duration: info?.duration || 15 };
        }),
      boss,
      state: this.state,
      force,
    });
  }

  /* -------------------------------------------------------------- render */

  render() {
    const ctx = this.ctx;
    const s = this.scale;
    ctx.setTransform(s, 0, 0, s, 0, 0);

    let ox = 0;
    let oy = 0;
    if (this.shake > 0.01) {
      const m = this.shake * 9;
      ox = rand(-m, m);
      oy = rand(-m, m);
    }

    this.drawBackdrop(ctx);
    ctx.save();
    ctx.translate(ox, oy);

    this.drawBeams(ctx);
    this.drawBunkers(ctx);
    this.drawEntities(ctx);
    this.drawPowerups(ctx);
    this.drawBullets(ctx);
    if (this.state !== STATES.MENU && this.state !== STATES.BOOT) this.drawPlayer(ctx);
    this.drawParticles(ctx);
    this.drawFloaters(ctx);
    ctx.restore();

    this.drawGround(ctx);
    if (this.flashWhite > 0.01) {
      ctx.fillStyle = `rgba(255,255,255,${this.flashWhite * 0.55})`;
      ctx.fillRect(0, 0, VIEW.W, VIEW.H);
    }
  }

  drawBackdrop(ctx) {
    const bd = backdropFor(this.level?.backdrop);
    const g = ctx.createLinearGradient(0, 0, 0, VIEW.H);
    g.addColorStop(0, bd.top);
    g.addColorStop(1, bd.bottom);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, VIEW.W, VIEW.H);

    // Two slow nebula blooms give each level its own colour signature.
    const t = this.time * 0.08;
    for (let i = 0; i < 2; i++) {
      const cx = VIEW.W * (0.3 + 0.4 * i) + Math.sin(t + i * 2) * 90;
      const cy = VIEW.H * (0.25 + 0.35 * i) + Math.cos(t * 0.8 + i) * 60;
      const rad = 230 + i * 110;
      const grd = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
      grd.addColorStop(0, rgba(i ? bd.nebula : bd.glow, 0.16));
      grd.addColorStop(1, rgba(i ? bd.nebula : bd.glow, 0));
      ctx.fillStyle = grd;
      ctx.fillRect(0, 0, VIEW.W, VIEW.H);
    }

    for (const layer of this.stars) {
      for (const p of layer.pts) {
        const a = layer.alpha * (0.6 + 0.4 * Math.sin(p.tw));
        ctx.fillStyle = `rgba(255,255,255,${a.toFixed(3)})`;
        ctx.fillRect(p.x, p.y, layer.size, layer.size);
      }
    }
  }

  drawGround(ctx) {
    const grd = ctx.createLinearGradient(0, GROUND_Y - 10, 0, VIEW.H);
    grd.addColorStop(0, 'rgba(124,243,160,0)');
    grd.addColorStop(1, 'rgba(124,243,160,0.14)');
    ctx.fillStyle = grd;
    ctx.fillRect(0, GROUND_Y - 10, VIEW.W, VIEW.H - GROUND_Y + 10);
    ctx.fillStyle = 'rgba(124,243,160,0.55)';
    ctx.fillRect(0, GROUND_Y, VIEW.W, 2);
  }

  drawBunkers(ctx) {
    for (const b of this.bunkers) {
      const health = b.intact / b.total;
      const col = health > 0.6 ? '#4cc9f0' : health > 0.3 ? '#ffd166' : '#ff6b6b';
      ctx.fillStyle = col;
      for (let r = 0; r < b.rows; r++) {
        for (let c = 0; c < b.cols; c++) {
          if (!b.grid[r * b.cols + c]) continue;
          ctx.fillRect(b.x + c * b.cell, b.y + r * b.cell, b.cell - 0.5, b.cell - 0.5);
        }
      }
    }
  }

  drawEntities(ctx) {
    for (const e of this.entities) {
      if (!e.alive) continue;
      const frames = spriteFrames(e.sprite);
      const frame = frames > 1 ? e.frame % frames : 0;
      const isBoss = e.arch.kind === 'boss';

      if (isBoss || e.sprite === 'comet' || e.sprite === 'mine') {
        const grd = ctx.createRadialGradient(e.x, e.y, 0, e.x, e.y, e.r * 2.2);
        grd.addColorStop(0, rgba(e.color, isBoss ? 0.3 : 0.4));
        grd.addColorStop(1, rgba(e.color, 0));
        ctx.fillStyle = grd;
        ctx.fillRect(e.x - e.r * 2.2, e.y - e.r * 2.2, e.r * 4.4, e.r * 4.4);
      }

      drawSprite(ctx, e.sprite, {
        x: e.x, y: e.y, width: e.width, frame,
        color: e.flash > 0 ? '#ffffff' : e.color,
        accent: e.flash > 0 ? '#ffd7d7' : e.accent,
        alpha: e.alpha,
        rotation: e.rotation,
        glow: isBoss ? 18 : e.kind === 'object' ? 6 : 0,
        raster: this.raster,
      });

      // Damage pips for anything tougher than a two-hit target.
      if (e.maxHp > 2 && !isBoss && e.hp < e.maxHp) {
        const w = e.r * 1.8;
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(e.x - w / 2, e.y - e.r - 9, w, 3);
        ctx.fillStyle = e.hp / e.maxHp > 0.5 ? '#7cf3a0' : '#ffd166';
        ctx.fillRect(e.x - w / 2, e.y - e.r - 9, w * (e.hp / e.maxHp), 3);
      }
    }
  }

  drawBullets(ctx) {
    for (const b of this.playerBullets) {
      ctx.save();
      ctx.shadowColor = b.kind === 'lance' ? '#f72585' : '#aef7c8';
      ctx.shadowBlur = 10;
      ctx.fillStyle = b.kind === 'lance' ? '#ff5fa8' : '#eaffe9';
      const h = b.kind === 'lance' ? 20 : 13;
      ctx.fillRect(b.x - 2, b.y - h / 2, 4, h);
      ctx.restore();
    }
    for (const b of this.enemyBullets) {
      ctx.save();
      const col = b.color || '#ff9f9f';
      ctx.shadowColor = col;
      ctx.shadowBlur = 9;
      ctx.fillStyle = col;
      if (b.kind === 'laser') {
        const a = Math.atan2(b.vy, b.vx);
        ctx.translate(b.x, b.y);
        ctx.rotate(a);
        ctx.fillRect(-11, -1.8, 22, 3.6);
      } else if (b.kind === 'orb') {
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = lighten(col, 0.7);
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.r * 0.45, 0, Math.PI * 2);
        ctx.fill();
      } else if (b.kind === 'plasma') {
        ctx.beginPath();
        ctx.ellipse(b.x, b.y, b.r * 0.7, b.r * 1.25, Math.atan2(b.vy, b.vx) - Math.PI / 2, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillRect(b.x - 2, b.y - 7, 4, 14);
      }
      ctx.restore();
    }
  }

  drawBeams(ctx) {
    for (const bm of this.beams) {
      if (bm.t < bm.warn) {
        const k = bm.t / bm.warn;
        ctx.fillStyle = `rgba(255,209,102,${(0.07 + 0.13 * Math.abs(Math.sin(bm.t * 22))).toFixed(3)})`;
        ctx.fillRect(bm.x - bm.w / 2, 0, bm.w, VIEW.H);
        ctx.strokeStyle = `rgba(255,209,102,${(0.3 + 0.5 * k).toFixed(2)})`;
        ctx.lineWidth = 2;
        ctx.strokeRect(bm.x - bm.w / 2, 0, bm.w, VIEW.H);
      } else if (bm.t < bm.warn + bm.active) {
        const grd = ctx.createLinearGradient(bm.x - bm.w / 2, 0, bm.x + bm.w / 2, 0);
        grd.addColorStop(0, 'rgba(255,209,102,0.1)');
        grd.addColorStop(0.5, 'rgba(255,255,255,0.92)');
        grd.addColorStop(1, 'rgba(255,209,102,0.1)');
        ctx.fillStyle = grd;
        ctx.fillRect(bm.x - bm.w / 2, 0, bm.w, VIEW.H);
      }
    }
  }

  drawPowerups(ctx) {
    for (const u of this.powerups) {
      const bob = Math.sin(u.t * 6) * 2;
      ctx.save();
      ctx.translate(u.x, u.y + bob);
      ctx.rotate(Math.sin(u.t * 2) * 0.22);
      ctx.shadowColor = u.color;
      ctx.shadowBlur = 14;
      ctx.strokeStyle = u.color;
      ctx.lineWidth = 2.4;
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.beginPath();
      ctx.roundRect?.(-u.r, -u.r, u.r * 2, u.r * 2, 4);
      if (!ctx.roundRect) ctx.rect(-u.r, -u.r, u.r * 2, u.r * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();

      ctx.save();
      ctx.fillStyle = u.color;
      ctx.font = 'bold 15px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(u.glyph, u.x, u.y + bob + 1);
      ctx.restore();
    }
  }

  drawPlayer(ctx) {
    const p = this.player;
    const blink = p.invuln > 0 && Math.floor(p.invuln * 12) % 2 === 0;
    if (blink && this.state === STATES.PLAYING) return;

    if (p.shield) {
      ctx.save();
      ctx.strokeStyle = `rgba(76,201,240,${(0.5 + 0.3 * Math.sin(this.time * 7)).toFixed(2)})`;
      ctx.lineWidth = 2;
      ctx.shadowColor = '#4cc9f0';
      ctx.shadowBlur = 14;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r + 11, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    drawSprite(ctx, 'player', {
      x: p.x, y: p.y, width: 40,
      color: p.hitFlash > 0 ? '#ffffff' : '#9ad4ff',
      accent: '#1b4a6a',
      glow: 10,
      raster: this.raster,
    });

    // Thruster plume.
    const len = 8 + p.thrust * 12 + Math.random() * 5;
    const grd = ctx.createLinearGradient(p.x, p.y + 14, p.x, p.y + 14 + len);
    grd.addColorStop(0, 'rgba(255,209,102,0.9)');
    grd.addColorStop(1, 'rgba(247,37,133,0)');
    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.moveTo(p.x - 5, p.y + 14);
    ctx.lineTo(p.x + 5, p.y + 14);
    ctx.lineTo(p.x, p.y + 14 + len);
    ctx.closePath();
    ctx.fill();
  }

  drawParticles(ctx) {
    for (const p of this.particles) {
      const a = Math.max(0, p.life / p.max);
      ctx.globalAlpha = a;
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    ctx.globalAlpha = 1;
  }

  drawFloaters(ctx) {
    ctx.save();
    ctx.font = 'bold 14px ui-monospace, monospace';
    ctx.textAlign = 'center';
    for (const f of this.floaters) {
      ctx.globalAlpha = Math.max(0, f.life / f.max);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x, f.y);
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }
}
