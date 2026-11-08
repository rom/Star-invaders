/**
 * Unit tests for the parts of the simulation that are pure logic: the
 * marching formation and the destructible bunkers. Run with:
 *
 *   node --test test/js/*.test.mjs
 *
 * These need no DOM and no browser, which is why entities.js deliberately
 * imports nothing.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { Formation, Bunker, Entity } from '../../web/js/entities.js';

/** Minimal stand-in for the Game object the simulation is handed. */
function fakeGame() {
  return {
    W: 900,
    H: 660,
    audio: { marchStep() {}, hit() {}, armour() {} },
    player: { x: 450, y: 602, r: 15 },
    enemyBullets: [],
    spark() {},
    burst() {},
    fireMul: 1,
    difficulty: { projectileSpeedMul: 1 },
    requestEnemyShot: () => false,
    onBossPhase() {},
    runBossPattern() {},
    hatch() {},
  };
}

function slotMember(slotX, slotY, r = 15) {
  return { alive: true, slotX, slotY, r, state: 'slot', frame: 0, x: slotX, y: slotY };
}

/** Steps a formation n times, returning how far it descended. */
function march(f, g, steps) {
  const startY = f.y;
  for (let i = 0; i < steps; i++) {
    f.timer = 0;
    f.update(0.001, g);
  }
  return f.y - startY;
}

test('formation marches sideways without descending in open space', () => {
  const g = fakeGame();
  const f = new Formation({ stepInterval: 0.5, drop: 18, stepSize: 10, W: 900 });
  f.add(slotMember(430, 100));
  f.add(slotMember(470, 100));

  const dropped = march(f, g, 5);
  assert.equal(dropped, 0, 'a formation in open space must not drop');
  assert.equal(f.x, 50, 'five 10px steps should move it 50px');
});

test('formation reverses and drops exactly once at an edge', () => {
  const g = fakeGame();
  const f = new Formation({ stepInterval: 0.5, drop: 18, stepSize: 10, W: 900 });
  // One member near the right wall: maxX = 835, so x may reach
  // 900 - 18 - 835 = 47, which is four 10px steps of headroom.
  f.add(slotMember(820, 100, 15));
  march(f, g, 4);
  assert.equal(f.x, 40, 'four steps fit inside the window');
  assert.equal(f.y, 0, 'and none of them is an edge hit');

  const before = f.dir;
  march(f, g, 1);
  assert.equal(f.y, 18, 'the fifth step hits the wall and drops once');
  assert.equal(f.dir, -before, 'and reverses');

  march(f, g, 1);
  assert.equal(f.y, 18, 'the step after a reversal must not drop again');
  assert.equal(f.x, 30, 'it marches back the other way');
});

// Regression: a wave joining on a delay widens the block. If x is left
// outside the new legal window, every subsequent step reads as an edge hit
// and the formation sinks in a straight line instead of marching.
test('a late wave that widens the block does not cause a runaway descent', () => {
  const g = fakeGame();
  const f = new Formation({ stepInterval: 0.5, drop: 21, stepSize: 10, W: 900 });
  f.add(slotMember(430, 100));
  f.add(slotMember(470, 100));

  march(f, g, 12);                  // drift well to the right: x = 120
  assert.equal(f.x, 120);
  assert.equal(f.y, 0);

  // A full width arc arrives, shrinking the legal window to roughly +/-58.
  f.add(slotMember(95, 290, 19));
  f.add(slotMember(805, 290, 19));

  const dropped = march(f, g, 20);
  assert.ok(
    dropped <= 42,
    `20 steps should drop at most twice, dropped ${dropped}px`,
  );
  assert.ok(f.x >= -58 && f.x <= 58, `x should be back inside the window, got ${f.x}`);
});

test('a block wider than the field marches in place rather than sinking', () => {
  const g = fakeGame();
  const f = new Formation({ stepInterval: 0.5, drop: 20, stepSize: 10, W: 900 });
  f.add(slotMember(10, 100, 60));   // minX = -50
  f.add(slotMember(890, 100, 60));  // maxX = 950
  const dropped = march(f, g, 15);
  assert.equal(dropped, 0, 'an over-wide block must not drop every step');
});

test('formation speeds up as it is thinned out', () => {
  const g = fakeGame();
  const f = new Formation({ stepInterval: 0.8, drop: 18, stepSize: 10, W: 900 });
  const members = [];
  for (let i = 0; i < 10; i++) {
    const m = slotMember(300 + i * 20, 100);
    members.push(m);
    f.add(m);
  }
  const full = f.interval;
  for (let i = 0; i < 8; i++) members[i].alive = false;
  f.prune();
  assert.ok(f.interval < full, 'a thinned formation should step faster');
  assert.ok(f.interval >= 0.085, 'but never faster than the floor');
});

// Regression: a diver is still a formation member but is momentarily at the
// bottom of the screen. Counting its live position as "the wall has landed"
// ended the game seconds after a level started.
test('lowestY measures the marching block, not a diver mid-attack', () => {
  const g = fakeGame();
  const f = new Formation({ stepInterval: 0.5, drop: 18, stepSize: 10, W: 900 });
  const steady = slotMember(430, 120);
  const diver = slotMember(470, 120);
  f.add(steady);
  f.add(diver);

  diver.state = 'dive';
  diver.y = 640;                        // almost at the player's line
  assert.equal(f.lowestY(), 135, 'the block has not moved, so neither has lowestY');

  f.y = 100;
  assert.equal(f.lowestY(), 235);
  void g;
});

test('bunkers erode where they are hit and report solidity', () => {
  const b = new Bunker(100, 400, 7);
  assert.ok(b.intact > 0 && b.intact === b.total);

  const cx = b.x + b.w / 2;
  const cy = b.y + b.cell * 3;
  assert.equal(b.solidAt(cx, cy), true, 'the middle of a fresh bunker is solid');

  const before = b.intact;
  assert.equal(b.hit(cx, cy, 1), true);
  assert.ok(b.intact < before, 'a hit removes cells');
  assert.equal(b.solidAt(cx, cy), false, 'the hit cell is gone');

  assert.equal(b.solidAt(b.x - 50, cy), false, 'outside the bunker is not solid');
  assert.equal(b.cellAt(b.x - 50, cy), -1);
  assert.equal(b.hit(b.x - 500, cy, 1), false, 'a hit far outside removes nothing');
});

test('bunkers have a hollow doorway, as the arcade original does', () => {
  const b = new Bunker(100, 400, 7);
  const underCentre = b.y + b.cell * 7 + 1;
  assert.equal(b.solidAt(b.x + b.w / 2, underCentre), false);
});

test('front armour halves damage taken head on', () => {
  const g = fakeGame();
  const plated = new Entity(
    { id: 'bulwark', kind: 'alien', hp: 8, radius: 22, behavior: 'march', frontArmor: true, score: 1 },
    { x: 100, y: 100 },
  );
  plated.damage(4, g, true);
  assert.equal(plated.hp, 6, 'a head-on hit for 4 should land 2');
  plated.damage(4, g, false);
  assert.equal(plated.hp, 2, 'a flanking hit lands in full');

  const soft = new Entity(
    { id: 'grunt', kind: 'alien', hp: 1, radius: 15, behavior: 'march', score: 1 },
    { x: 0, y: 0 },
  );
  assert.equal(soft.damage(1, g, true), true, 'damage() reports the kill');
  assert.equal(soft.alive, false);
});

test('entities carry their archetype score and required flag', () => {
  const e = new Entity(
    { id: 'asteroid', kind: 'object', hp: 4, radius: 23, behavior: 'drift', score: 75 },
    { x: 10, y: 10 },
  );
  assert.equal(e.required, false, 'hazards must not gate level completion');
  assert.equal(e.score, 75);
});

// Regression: difficulty scales a boss's max HP, but its phase thresholds
// are written against the archetype's own hull. Read absolutely, a weakened
// boss starts in a late phase and a reinforced one never leaves its first.
test('boss phases are proportional to the hull it actually has', () => {
  const g = fakeGame();
  const archetype = {
    id: 'warden', kind: 'boss', hp: 100, radius: 60, behavior: 'boss', score: 1,
    phaseHP: [75, 40], patterns: ['fan', 'sweep', 'summon'], fireRate: 1,
  };

  const phaseOf = (hpMul, hpFraction) => {
    const e = new Entity(archetype, { x: 450, y: 150, anchorY: 150, hpMul });
    e.entering = false;
    e.hp = Math.round(e.maxHp * hpFraction);
    e.update(0.016, g);
    return e.bossPhase;
  };

  // At full hull every boss is in its opening phase, however much hull that is.
  assert.equal(phaseOf(1, 1), 0, 'normal, full hull');
  assert.equal(phaseOf(0.55, 1), 0, 'weakened boss must still open on phase 0');
  assert.equal(phaseOf(1.85, 1), 0, 'reinforced boss opens on phase 0 too');

  // And the phases land at the same fractions of hull on every tier.
  for (const mul of [0.55, 1, 1.85]) {
    assert.equal(phaseOf(mul, 0.6), 1, `hpMul ${mul} at 60% hull`);
    assert.equal(phaseOf(mul, 0.2), 2, `hpMul ${mul} at 20% hull`);
  }
});

test('an entity takes its hp multiplier from the spawn options', () => {
  const g = fakeGame();
  const base = { id: 'warden', kind: 'boss', hp: 100, radius: 60, behavior: 'boss', score: 1 };
  assert.equal(new Entity(base, {}).maxHp, 100);
  assert.equal(new Entity(base, { hpMul: 1.85 }).maxHp, 185);
  assert.equal(new Entity(base, { hpMul: 0.55 }).maxHp, 55);
  assert.ok(new Entity(base, { hpMul: 0.001 }).maxHp >= 1, 'never scales to zero hull');
  void g;
});
