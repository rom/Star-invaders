/**
 * The spawn-plan builder is shared by the game and the level editor's
 * preview, so it gets its own tests: a preview that disagrees with the
 * simulator is worse than no preview.
 *
 *   node --test test/js/*.test.mjs
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSpawnPlan, seededRandom, summarisePlan, VIEW } from '../../web/js/plan.js';

const ARCHETYPES = {
  grunt: { id: 'grunt', kind: 'alien', radius: 15, required: true, speed: 0 },
  scout: { id: 'scout', kind: 'alien', radius: 13, required: true, speed: 190 },
  asteroid: { id: 'asteroid', kind: 'object', radius: 23, required: false, speed: 62 },
  warden: { id: 'warden', kind: 'boss', radius: 62, required: true, speed: 68 },
};

const level = (...waves) => ({ waves });

test('a grid lays out rows and columns centred on the field', () => {
  const plan = buildSpawnPlan(
    level({ archetype: 'grunt', pattern: 'grid', rows: 2, cols: 5, count: 10, y: 0.15 }),
    ARCHETYPES,
  );
  assert.equal(plan.length, 10);
  assert.ok(plan.every((p) => p.formation === true));

  const xs = plan.map((p) => p.slotX);
  const rows = new Set(plan.map((p) => Math.round(p.slotY)));
  assert.equal(rows.size, 2, 'two distinct rows');

  const left = Math.min(...xs);
  const right = Math.max(...xs);
  assert.ok(Math.abs((left + right) / 2 - VIEW.W / 2) < 0.001, 'the block is centred');
  assert.ok(left > 0 && right < VIEW.W, 'the block fits on the field');
});

test('a grid never spawns more than its count', () => {
  const plan = buildSpawnPlan(
    level({ archetype: 'grunt', pattern: 'grid', rows: 4, cols: 4, count: 6 }),
    ARCHETYPES,
  );
  assert.equal(plan.length, 6);
});

test('a single-column grid does not divide by zero', () => {
  const plan = buildSpawnPlan(
    level({ archetype: 'grunt', pattern: 'grid', rows: 3, cols: 1, count: 3 }),
    ARCHETYPES,
  );
  assert.equal(plan.length, 3);
  assert.ok(plan.every((p) => Number.isFinite(p.slotX)), 'every slot has a real x');
});

test('an arc bulges upward and spans the field', () => {
  const plan = buildSpawnPlan(
    level({ archetype: 'grunt', pattern: 'arc', count: 7, y: 0.3 }),
    ARCHETYPES,
  );
  assert.equal(plan.length, 7);
  const baseY = 0.3 * VIEW.H;
  const middle = plan[3];
  const edge = plan[0];
  assert.ok(middle.slotY < edge.slotY, 'the middle of the arc sits higher than its ends');
  assert.ok(Math.abs(edge.slotY - baseY) < 0.001, 'the ends sit on the anchor line');
});

test('a vee widens downward from its centre', () => {
  const plan = buildSpawnPlan(
    level({ archetype: 'grunt', pattern: 'vee', count: 5, y: 0.2 }),
    ARCHETYPES,
  );
  const ys = plan.map((p) => p.slotY);
  assert.ok(ys[2] < ys[0] && ys[2] < ys[4], 'the point of the vee is highest');
  assert.ok(Math.abs(ys[0] - ys[4]) < 0.001, 'the vee is symmetric');
});

test('a stream spaces its spawns by the interval and never joins a formation', () => {
  const plan = buildSpawnPlan(
    level({ archetype: 'scout', pattern: 'stream', count: 4, delay: 8, interval: 2.5, side: 'left' }),
    ARCHETYPES,
  );
  assert.deepEqual(plan.map((p) => p.at), [8, 10.5, 13, 15.5]);
  assert.ok(plan.every((p) => p.formation === false && p.side === 'left'));
});

test('a stream without an interval still spaces its spawns out', () => {
  const plan = buildSpawnPlan(
    level({ archetype: 'scout', pattern: 'stream', count: 3 }),
    ARCHETYPES,
  );
  const times = plan.map((p) => p.at);
  assert.ok(times[1] > times[0] && times[2] > times[1], 'spawns are staggered');
});

test('a boss wave produces exactly one boss entry', () => {
  const plan = buildSpawnPlan(
    level({ archetype: 'warden', pattern: 'boss', count: 1, y: 0.22 }),
    ARCHETYPES,
  );
  assert.equal(plan.length, 1);
  assert.equal(plan[0].boss, true);
  assert.equal(plan[0].y, 0.22 * VIEW.H);
});

test('the plan is ordered by spawn time across waves', () => {
  const plan = buildSpawnPlan(
    level(
      { archetype: 'scout', pattern: 'stream', count: 3, delay: 20, interval: 1 },
      { archetype: 'grunt', pattern: 'grid', rows: 1, cols: 3, count: 3, delay: 0 },
      { archetype: 'scout', pattern: 'stream', count: 2, delay: 5, interval: 1 },
    ),
    ARCHETYPES,
  );
  const times = plan.map((p) => p.at);
  assert.deepEqual(times, [...times].sort((a, b) => a - b), 'spawn times increase');
  assert.equal(plan[0].at, 0);
});

test('an unknown archetype is reported rather than silently dropped', () => {
  const unknown = [];
  const plan = buildSpawnPlan(
    level(
      { archetype: 'space-goose', pattern: 'grid', count: 4 },
      { archetype: 'grunt', pattern: 'grid', rows: 1, cols: 2, count: 2 },
    ),
    ARCHETYPES,
    { onUnknown: (id) => unknown.push(id) },
  );
  assert.deepEqual(unknown, ['space-goose']);
  assert.equal(plan.length, 2, 'the known wave still builds');
});

// The editor previews on every keystroke; scattered spawns must not jitter.
test('a seeded source makes scattered spawns repeatable', () => {
  const script = level({ archetype: 'asteroid', pattern: 'random', count: 6, y: 0.2 });
  const a = buildSpawnPlan(script, ARCHETYPES, { random: seededRandom(42) });
  const b = buildSpawnPlan(script, ARCHETYPES, { random: seededRandom(42) });
  assert.deepEqual(a.map((p) => [p.x, p.y]), b.map((p) => [p.x, p.y]));

  const c = buildSpawnPlan(script, ARCHETYPES, { random: seededRandom(7) });
  assert.notDeepEqual(a.map((p) => p.x), c.map((p) => p.x), 'a different seed moves them');
});

test('seededRandom stays inside the unit interval', () => {
  const r = seededRandom(123);
  for (let i = 0; i < 1000; i++) {
    const v = r();
    assert.ok(v >= 0 && v < 1, `value out of range: ${v}`);
  }
});

test('summarise counts what a level actually fields', () => {
  const plan = buildSpawnPlan(
    level(
      { archetype: 'grunt', pattern: 'grid', rows: 2, cols: 3, count: 6 },
      { archetype: 'asteroid', pattern: 'random', count: 2 },
      { archetype: 'scout', pattern: 'stream', count: 3, delay: 10, interval: 2 },
    ),
    ARCHETYPES,
    { random: seededRandom(1) },
  );
  const s = summarisePlan(plan);
  assert.equal(s.total, 11);
  assert.equal(s.required, 9, 'asteroids do not gate completion');
  assert.equal(s.lastSpawnAt, 14);
  assert.deepEqual(s.byArchetype[0], { id: 'grunt', n: 6 });
});

test('an empty level yields an empty plan rather than throwing', () => {
  assert.deepEqual(buildSpawnPlan({}, ARCHETYPES), []);
  assert.deepEqual(buildSpawnPlan({ waves: [] }, ARCHETYPES), []);
});
