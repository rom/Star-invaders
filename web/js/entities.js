/**
 * Entities, movement behaviours and the marching formation.
 *
 * The level script that arrives from the Go back end names a behaviour per
 * archetype; this module is the simulator for those names. Entities never
 * touch the DOM and never draw themselves - the renderer in game.js reads
 * their state.
 */

export const rand = (a, b) => a + Math.random() * (b - a);
export const randInt = (a, b) => Math.floor(rand(a, b + 1));
export const pickOne = (arr) => arr[Math.floor(Math.random() * arr.length)];
export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;

let nextId = 1;

export class Entity {
  /**
   * @param {object} arch archetype record from /api/levels
   * @param {object} opts spawn options
   */
  constructor(arch, opts = {}) {
    this.id = nextId++;
    this.arch = arch;
    this.kind = arch.kind;
    this.sprite = arch.sprite;
    this.color = arch.color;
    this.accent = arch.accent;

    this.x = opts.x ?? 0;
    this.y = opts.y ?? 0;
    this.vx = opts.vx ?? 0;
    this.vy = opts.vy ?? 0;
    this.r = arch.radius * (opts.scale ?? 1);
    this.scale = opts.scale ?? 1;

    this.maxHp = Math.max(1, Math.round((arch.hp || 1) * (opts.hpMul ?? 1)));
    this.hp = this.maxHp;
    this.required = !!arch.required;
    this.score = arch.score || 0;

    this.speed = (arch.speed || 0) * (opts.speedMul ?? 1);
    this.fireRate = (arch.fireRate || 0) * (opts.fireMul ?? 1);
    this.projectileSpeed = arch.projectileSpeed || 220;
    this.projectileKind = arch.projectileKind || 'bolt';

    // Formation slot (for march/weave/phase/dive behaviours).
    this.formation = opts.formation ?? null;
    this.slotX = opts.slotX ?? this.x;
    this.slotY = opts.slotY ?? this.y;
    this.amp = opts.amp ?? 30;

    this.t = rand(0, 10);
    this.phaseOff = rand(0, Math.PI * 2);
    this.frame = randInt(0, 1);
    this.frameTimer = 0;
    this.fireTimer = rand(0.7, 3.2) / Math.max(0.05, this.fireRate || 0.2);
    this.flash = 0;
    this.alive = true;
    this.escaped = false;
    this.alpha = 1;
    this.targetable = true;
    this.rotation = 0;
    this.spin = 0;
    this.state = 'idle';
    this.stateTimer = rand(4, 14);
    this.bossPhase = 0;
    this.patternStep = 0;
    this.entering = false;
    this.anchorY = opts.anchorY ?? this.y;
    this.trail = 0;

    if (arch.behavior === 'drift') {
      this.spin = rand(-0.8, 0.8);
    }
    if (arch.behavior === 'orbit') {
      this.anchorX = opts.x ?? 0;
      this.anchorVX = rand(-1, 1) < 0 ? -42 : 42;
      this.orbitAngle = rand(0, Math.PI * 2);
    }
  }

  get width() { return this.r * 2.25; }

  damage(n, g, fromFront = false) {
    if (!this.alive) return false;
    let dmg = n;
    if (this.arch.frontArmor && fromFront) dmg = Math.max(1, Math.floor(n / 2));
    this.hp -= dmg;
    this.flash = 0.1;
    if (this.hp <= 0) {
      this.alive = false;
      return true;
    }
    if (this.arch.frontArmor && fromFront) g.audio.armour();
    else g.audio.hit();
    return false;
  }

  /* ----------------------------------------------------------- behaviour */

  update(dt, g) {
    this.t += dt;
    this.frameTimer += dt;
    if (this.spin) this.rotation += this.spin * dt;

    if (this.flash > 0) this.flash -= dt;

    switch (this.arch.behavior) {
      case 'march': this._march(dt, g); break;
      case 'weave': this._weave(dt, g); break;
      case 'phase': this._phase(dt, g); break;
      case 'dive': this._dive(dt, g); break;
      case 'orbit': this._orbit(dt, g); break;
      case 'charge': this._charge(dt, g); break;
      case 'swarm': this._swarm(dt, g); break;
      case 'strafe': this._strafe(dt, g); break;
      case 'drift': this._drift(dt, g); break;
      case 'float': this._float(dt, g); break;
      case 'boss': this._boss(dt, g); break;
      default: this._drift(dt, g); break;
    }

    if (this.arch.hatchInto && this.alive && this.targetable) {
      this.hatchTimer = (this.hatchTimer ?? rand(1, this.arch.hatchEvery || 5)) - dt;
      if (this.hatchTimer <= 0) {
        this.hatchTimer = (this.arch.hatchEvery || 5) * rand(0.8, 1.25);
        g.hatch(this);
      }
    }

    if (this.fireRate > 0 && this.alive && this.arch.behavior !== 'boss') {
      this.fireTimer -= dt;
      if (this.fireTimer <= 0) {
        const base = 1 / Math.max(0.02, this.fireRate * g.fireMul);
        this.fireTimer = base * rand(0.6, 1.6);
        // The entity's own rate decides how often it *wants* to shoot; the
        // game's shot budget decides whether it actually gets to.
        if (this.targetable && this.y > 0 && this.y < g.H - 120 && g.requestEnemyShot()) {
          g.enemyFire(this);
        }
      }
    }
  }

  _followSlot() {
    const f = this.formation;
    if (!f) return;
    this.x = f.x + this.slotX;
    this.y = f.y + this.slotY;
  }

  _march() {
    this._followSlot();
  }

  _weave() {
    this._followSlot();
    this.x += Math.sin(this.t * 1.9 + this.phaseOff) * this.amp;
    this.y += Math.sin(this.t * 1.2 + this.phaseOff) * 7;
  }

  _phase() {
    this._followSlot();
    // 2.4s cycle: solid, fading, gone, returning.
    const cycle = (this.t + this.phaseOff) % 2.4;
    if (cycle < 1.2) {
      this.alpha = 1;
      this.targetable = true;
    } else {
      const k = (cycle - 1.2) / 1.2;             // 0..1
      const fade = Math.sin(k * Math.PI);         // 0 -> 1 -> 0
      this.alpha = clamp(1 - fade * 1.1, 0.07, 1);
      this.targetable = this.alpha > 0.45;
    }
  }

  _dive(dt, g) {
    if (this.state === 'idle' || this.state === 'slot') {
      this._followSlot();
      this.stateTimer -= dt;
      if (this.stateTimer <= 0) {
        this.state = 'dive';
        this.diveX = this.x;
        this.vy = this.speed;
        // One aiming solution, taken now and lived with.
        this.vx = clamp((g.player.x - this.x) * 0.5, -130, 130);
      }
      return;
    }
    if (this.state === 'dive') {
      // The diver aims once, as it commits, and then holds its line. Homing
      // all the way down made them impossible to sidestep: you could not
      // read where the attack was going, only that it was going to land.
      this.vy = Math.min(this.speed * 1.45, this.vy + 95 * dt);
      this.x += this.vx * dt + Math.sin(this.t * 4.5) * 34 * dt;
      this.y += this.vy * dt;
      if (this.y > g.H + 40) {
        if (this.formation) {
          this.state = 'return';
          this.y = -40;
          this.x = clamp(this.formation.x + this.slotX, 40, g.W - 40);
        } else {
          // A diver with no formation to rejoin loops around for another pass.
          this.y = -40;
          this.x = rand(60, g.W - 60);
          this.vy = this.speed;
          this.vx = 0;
        }
      }
      return;
    }
    // return: slide back into the formation slot.
    const tx = this.formation ? this.formation.x + this.slotX : this.x;
    const ty = this.formation ? this.formation.y + this.slotY : 90;
    if (!this.formation) { this.state = 'dive'; this.vy = this.speed; return; }
    this.x = lerp(this.x, tx, 3 * dt);
    this.y = lerp(this.y, ty, 3 * dt);
    if (Math.abs(this.y - ty) < 6 && Math.abs(this.x - tx) < 10) {
      this.state = 'slot';
      this.stateTimer = rand(5, 15);
    }
  }

  _orbit(dt, g) {
    this.anchorX += this.anchorVX * dt;
    const margin = this.amp + 40;
    if (this.anchorX < margin) { this.anchorX = margin; this.anchorVX *= -1; }
    if (this.anchorX > g.W - margin) { this.anchorX = g.W - margin; this.anchorVX *= -1; }
    this.orbitAngle += (this.speed / Math.max(20, this.amp)) * dt;
    this.x = this.anchorX + Math.cos(this.orbitAngle) * this.amp;
    this.y = this.anchorY + Math.sin(this.orbitAngle) * this.amp * 0.62;
  }

  _charge(dt, g) {
    this.vy = Math.min(this.speed * 2.1, this.vy + 170 * dt);
    this.y += this.vy * dt;
    this.x += this.vx * dt;
    this.rotation = 0;
    this.trail += dt;
    if (this.trail > 0.045) {
      this.trail = 0;
      g.spark(this.x, this.y - this.r * 0.6, this.color, 1);
    }
    if (this.y > g.H + 50) { this.alive = false; this.escaped = true; }
  }

  _swarm(dt, g) {
    const p = g.player;
    const spreadX = Math.sin(this.t * 1.1 + this.phaseOff) * 190;
    const tx = clamp(p.x + spreadX, 30, g.W - 30);
    const bob = Math.sin(this.t * 1.7 + this.phaseOff);
    const ty = clamp(g.H * 0.33 + bob * 150, 70, g.H - 160);
    const dx = tx - this.x;
    const dy = ty - this.y;
    const d = Math.hypot(dx, dy) || 1;
    const accel = this.speed * 2.4;
    this.vx = lerp(this.vx, (dx / d) * this.speed, clamp(accel * dt / this.speed, 0, 1));
    this.vy = lerp(this.vy, (dy / d) * this.speed, clamp(accel * dt / this.speed, 0, 1));
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.x = clamp(this.x, 16, g.W - 16);
  }

  /** Crosses the field broadside, reversing at the walls and creeping down. */
  _strafe(dt, g) {
    if (!this.strafeDir) this.strafeDir = this.vx < 0 ? -1 : 1;
    this.x += this.strafeDir * this.speed * dt;
    this.y += 7 * dt;
    const margin = this.r + 12;
    if (this.x < margin) { this.x = margin; this.strafeDir = 1; }
    if (this.x > g.W - margin) { this.x = g.W - margin; this.strafeDir = -1; }
    if (this.y > g.H - 150) this.y = g.H - 150;
  }

  _drift(dt, g) {
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    if (this.sprite === 'comet') {
      this.trail += dt;
      if (this.trail > 0.03) {
        this.trail = 0;
        g.spark(this.x, this.y, this.color, 1.3);
      }
    }
    if (this.y > g.H + 60 || this.x < -80 || this.x > g.W + 80) {
      this.alive = false;
      this.escaped = true;
    }
  }

  _float(dt, g) {
    this.y += this.speed * dt;
    this.x += Math.sin(this.t * 0.9 + this.phaseOff) * 22 * dt;
    if (this.y > g.H + 40) { this.alive = false; this.escaped = true; }
  }

  /* ---------------------------------------------------------- boss logic */

  _boss(dt, g) {
    // Phase thresholds are authored against the archetype's own hull, so
    // they have to be read proportionally: difficulty scales a boss's max
    // HP, and an absolute threshold would start a weakened boss in a late
    // phase and hold a reinforced one in its opening one.
    const thresholds = this.arch.phaseHP || [];
    const hullScale = this.maxHp / Math.max(1, this.arch.hp || 1);
    let phase = 0;
    for (const th of thresholds) if (this.hp <= th * hullScale) phase++;
    if (phase !== this.bossPhase) {
      this.bossPhase = phase;
      g.onBossPhase(this, phase);
      this.patternStep = 0;
      this.fireTimer = 0.9;
    }

    if (this.entering) {
      this.y = lerp(this.y, this.anchorY, 2.2 * dt);
      if (Math.abs(this.y - this.anchorY) < 3) {
        this.y = this.anchorY;
        this.entering = false;
      }
      return;
    }

    // Side-to-side patrol that widens with each phase.
    const sway = 0.5 + phase * 0.14;
    const span = (g.W * 0.5 - this.r - 24);
    this.x = g.W / 2 + Math.sin(this.t * sway) * span;
    this.y = this.anchorY + Math.sin(this.t * 0.8) * 16;

    if (this.blinkTimer > 0) {
      this.blinkTimer -= dt;
      this.alpha = 0.25 + Math.abs(Math.sin(this.t * 30)) * 0.5;
      this.targetable = false;
      return;
    }
    this.alpha = 1;
    this.targetable = true;

    const patterns = this.arch.patterns && this.arch.patterns.length
      ? this.arch.patterns : ['fan'];
    this.fireTimer -= dt;
    if (this.fireTimer <= 0) {
      const name = patterns[Math.min(phase, patterns.length - 1)];
      // Phases compound, and the late bosses have five of them: at 0.18 a
      // phase the last one ran a full pattern every third of a second,
      // which is not a fight, it is a wall.
      const cadence = 1 / Math.max(0.2, (this.arch.fireRate || 1) * (1 + phase * 0.1));
      this.fireTimer = cadence * rand(0.8, 1.25);
      g.runBossPattern(this, name, phase);
    }
  }
}

/* ---------------------------------------------------------------- formation */

/**
 * The classic marching block. Every formation-pattern entity in a level joins
 * the same formation, so the whole wall steps sideways and drops together.
 */
export class Formation {
  constructor({ stepInterval = 0.7, drop = 18, stepSize = 10, W = 900 }) {
    this.x = 0;
    this.y = 0;
    this.dir = 1;
    this.baseInterval = stepInterval;
    this.drop = drop;
    this.stepSize = stepSize;
    this.timer = stepInterval;
    this.W = W;
    this.members = new Set();
    this.initialCount = 0;
    this.stepsTaken = 0;
  }

  add(e) {
    this.members.add(e);
    this.initialCount = Math.max(this.initialCount, this.members.size);
  }

  prune() {
    for (const e of this.members) if (!e.alive) this.members.delete(e);
  }

  get aliveRatio() {
    if (this.initialCount === 0) return 1;
    return this.members.size / this.initialCount;
  }

  /** Current step cadence - the wall accelerates as it thins out. */
  get interval() {
    return Math.max(0.085, this.baseInterval * (0.18 + 0.82 * this.aliveRatio));
  }

  update(dt, g) {
    this.prune();
    if (this.members.size === 0) return;
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = this.interval;
    this.stepsTaken++;

    let minX = Infinity;
    let maxX = -Infinity;
    for (const e of this.members) {
      if (e.state === 'dive' || e.state === 'return') continue;
      minX = Math.min(minX, e.slotX - e.r);
      maxX = Math.max(maxX, e.slotX + e.r);
    }
    if (minX === Infinity) { minX = 0; maxX = 0; }

    // The legal travel window for the whole block, recomputed every step
    // because waves join on a delay and the dead stop counting.
    const margin = 18;
    const lo = margin - minX;
    const hi = this.W - margin - maxX;

    if (lo > hi) {
      // The block is wider than the field - which a late wave joining a
      // full-width formation can cause. Centre it and march in place rather
      // than treating every step as an edge hit.
      this.x = (lo + hi) / 2;
    } else {
      const nextX = this.x + this.dir * this.stepSize;
      if (nextX < lo || nextX > hi) {
        this.dir *= -1;
        this.y += this.drop;
        // Clamping matters: if a newly joined wave widened the block, x can
        // already be outside the window, and merely flipping the direction
        // would leave it outside forever - every step would then count as an
        // edge hit and the formation would descend in a straight line.
        this.x = Math.min(hi, Math.max(lo, this.x));
      } else {
        this.x = nextX;
      }
    }

    for (const e of this.members) e.frame++;
    g.audio.marchStep(1 - this.aliveRatio);
  }

  /**
   * How far down the marching block itself has advanced, used for the
   * "they landed" loss. This reads slot positions, not live positions: a
   * diver is momentarily at the bottom of the screen but the wall it came
   * from has not moved, and counting it would end the game instantly.
   */
  lowestY() {
    let low = -Infinity;
    for (const e of this.members) {
      if (!e.alive) continue;
      low = Math.max(low, this.y + e.slotY + e.r);
    }
    return low;
  }
}

/* ------------------------------------------------------------------ bunkers */

/**
 * Destructible cover. A bunker is a small bitmap of cells; bullets erode it
 * one cell (plus neighbours) at a time, just like the arcade original.
 */
export class Bunker {
  constructor(x, y, cell = 7) {
    this.cell = cell;
    this.cols = 11;
    this.rows = 8;
    this.w = this.cols * cell;
    this.h = this.rows * cell;
    this.x = x - this.w / 2;
    this.y = y;
    this.grid = new Uint8Array(this.cols * this.rows);
    const shape = [
      '..#######..',
      '.#########.',
      '###########',
      '###########',
      '###########',
      '####...####',
      '###.....###',
      '##.......##',
    ];
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        this.grid[r * this.cols + c] = shape[r][c] === '#' ? 1 : 0;
      }
    }
    this.intact = this.grid.reduce((a, b) => a + b, 0);
    this.total = this.intact;
  }

  cellAt(px, py) {
    const c = Math.floor((px - this.x) / this.cell);
    const r = Math.floor((py - this.y) / this.cell);
    if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) return -1;
    return r * this.cols + c;
  }

  /** Erodes a blast radius around a point. Returns true if anything was hit. */
  hit(px, py, radius = 1) {
    const i = this.cellAt(px, py);
    if (i < 0 || this.grid[i] === 0) {
      // Allow a near miss to still chip the edge, as the arcade game does.
      if (radius < 1) return false;
    }
    let removed = 0;
    const c0 = Math.floor((px - this.x) / this.cell);
    const r0 = Math.floor((py - this.y) / this.cell);
    for (let dr = -radius; dr <= radius; dr++) {
      for (let dc = -radius; dc <= radius; dc++) {
        const c = c0 + dc;
        const r = r0 + dr;
        if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) continue;
        if (Math.abs(dc) + Math.abs(dr) > radius + 1) continue;
        const idx = r * this.cols + c;
        if (this.grid[idx]) { this.grid[idx] = 0; removed++; }
      }
    }
    this.intact -= removed;
    return removed > 0;
  }

  /** True if the point is inside a surviving cell. */
  solidAt(px, py) {
    if (px < this.x || px > this.x + this.w || py < this.y || py > this.y + this.h) return false;
    const i = this.cellAt(px, py);
    return i >= 0 && this.grid[i] === 1;
  }
}
