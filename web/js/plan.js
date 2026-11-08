/**
 * Turning a declarative level script into a time-ordered spawn queue.
 *
 * This lives apart from the game so the level editor's preview runs the same
 * code the game does. A preview that computed slot positions its own way
 * would eventually disagree with the thing it is previewing, and the author
 * would only find out by playing.
 */

/** Logical play field. Everything in a level script is relative to this. */
export const VIEW = { W: 900, H: 660 };

/**
 * @param {object} level a level script (as served by /api/levels)
 * @param {object} archetypes the bestiary, keyed by id
 * @param {object} [opts]
 * @param {function(): number} [opts.random] injectable randomness, so a
 *   preview can be stable frame to frame while the game stays varied
 * @param {function(string): void} [opts.onUnknown] called with an archetype
 *   id the bestiary does not have
 * @returns {Array<object>} spawn entries sorted by their spawn time
 */
export function buildSpawnPlan(level, archetypes, opts = {}) {
  const random = opts.random || Math.random;
  const rand = (a, b) => a + random() * (b - a);
  const plan = [];

  for (const wave of level.waves || []) {
    const arch = archetypes[wave.archetype];
    if (!arch) {
      if (opts.onUnknown) opts.onUnknown(wave.archetype);
      else console.warn('unknown archetype in level script:', wave.archetype);
      continue;
    }
    const baseY = (wave.y || 0.13) * VIEW.H;
    const count = Math.max(1, wave.count || 1);
    const waveOpts = {
      speedMul: wave.speedMul || 1,
      fireMul: wave.fireMul || 1,
      amp: wave.amp || 32,
    };

    switch (wave.pattern) {
      case 'grid': {
        const cols = wave.cols || Math.ceil(Math.sqrt(count));
        const rows = wave.rows || Math.ceil(count / cols);
        const spacingX = Math.min(78, (VIEW.W - 170) / Math.max(1, cols - 1 || 1));
        const spacingY = Math.max(44, arch.radius * 2.6);
        const startX = (VIEW.W - (cols - 1) * spacingX) / 2;
        let made = 0;
        for (let r = 0; r < rows && made < count; r++) {
          for (let c = 0; c < cols && made < count; c++, made++) {
            plan.push({
              at: wave.delay || 0, arch, formation: true,
              slotX: startX + c * spacingX, slotY: baseY + r * spacingY, opts: waveOpts,
            });
          }
        }
        break;
      }
      case 'arc': {
        const span = VIEW.W - 190;
        for (let i = 0; i < count; i++) {
          const t = count === 1 ? 0.5 : i / (count - 1);
          plan.push({
            at: wave.delay || 0, arch, formation: true,
            slotX: 95 + t * span,
            slotY: baseY - Math.sin(t * Math.PI) * 42,
            opts: waveOpts,
          });
        }
        break;
      }
      case 'vee': {
        const span = VIEW.W - 220;
        const mid = (count - 1) / 2;
        for (let i = 0; i < count; i++) {
          const t = count === 1 ? 0.5 : i / (count - 1);
          plan.push({
            at: wave.delay || 0, arch, formation: true,
            slotX: 110 + t * span,
            slotY: baseY + Math.abs(i - mid) * 26,
            opts: waveOpts,
          });
        }
        break;
      }
      case 'random': {
        for (let i = 0; i < count; i++) {
          plan.push({
            at: (wave.delay || 0) + i * 0.18, arch, formation: false,
            x: rand(90, VIEW.W - 90), y: baseY + rand(-50, 70), opts: waveOpts,
          });
        }
        break;
      }
      case 'boss': {
        plan.push({ at: wave.delay || 0, arch, boss: true, y: baseY, opts: waveOpts });
        break;
      }
      case 'stream':
      default: {
        const iv = wave.interval || 1.2;
        for (let i = 0; i < count; i++) {
          plan.push({
            at: (wave.delay || 0) + i * iv, arch, formation: false,
            side: wave.side || 'top', opts: waveOpts,
          });
        }
        break;
      }
    }
  }

  plan.sort((a, b) => a.at - b.at);
  return plan;
}

/**
 * A deterministic pseudo-random source, so the editor preview holds still
 * instead of shuffling its scattered spawns on every keystroke.
 */
export function seededRandom(seed = 1) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

/** Summarises a plan for the editor: counts by archetype and totals. */
export function summarisePlan(plan) {
  const byArchetype = new Map();
  let required = 0;
  let last = 0;
  for (const item of plan) {
    const id = item.arch.id;
    byArchetype.set(id, (byArchetype.get(id) || 0) + 1);
    if (item.arch.required) required++;
    last = Math.max(last, item.at);
  }
  return {
    total: plan.length,
    required,
    lastSpawnAt: last,
    byArchetype: Array.from(byArchetype, ([id, n]) => ({ id, n })).sort((a, b) => b.n - a.n),
  };
}
