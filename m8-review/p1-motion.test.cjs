const assert = require('node:assert/strict');
const test = require('node:test');
require('./dist/model.js');
require('./dist/p1-motion.js');

function fixture() {
  const platform = 2610;
  const actors = [
    { id: 177, type: 'NPC', gameID: 257758, subType: 'Boss', points: [
      [4996, 123, 159981, 99.7, platform], [7222, 123, 159981, 99.6, platform],
      [27060, 123, 159981, 98.2, platform], [55991, 123, 159981, 97.6, platform],
      [62000, -4554, 155283, 95, platform]
    ] },
    { id: 204, type: 'NPC', gameID: 259555, points: [
      [23872, -4082, 155360, 98.3, platform], [48995, -4082, 155360, 96, platform]
    ] },
    { id: 206, type: 'NPC', gameID: 267418, points: [[38119, 5483, 155329, 100, platform]] },
    { id: 237, type: 'NPC', gameID: 267418, points: [[38119, 3960, 159316, 100, platform]] },
    { id: 300, type: 'NPC', gameID: 267418, points: [] },
    { id: 301, type: 'NPC', gameID: 267418, points: [[61000, 100, 200, 90, platform]] },
  ];
  const fight = { duration: 65000, phaseTransitions: [{ t: 0, id: 1 }, { t: 60000, id: 2 }],
    actorById: new Map(actors.map(a => [a.id, a])), mapUnits: actors.map(actor => ({ actor, role: M8Model.mapRole(actor) })),
    events: [
      [22023, 'begincast', 1298367, 177], [27060, 'cast', 1298367, 177],
      [35650, 'begincast', 1298570, 206], [35650, 'begincast', 1298570, 237],
      [38119, 'cast', 1298570, 206], [38119, 'cast', 1298570, 206], [38119, 'cast', 1298570, 237],
      [38119, 'cast', 1298570, 300], [41043, 'damage', 1292403, 177],
      [44993, 'begincast', 1296301, 204], [48995, 'cast', 1296301, 204],
      [61000, 'cast', 1298570, 301],
    ].map(([t, type, spellID, source]) => ({ t, type, spellID, source })) };
  return { actors, motion: M8P1Motion.build(fight) };
}

test('waves use actual P1 release times and distinct logged origins, not damage ticks', () => {
  const { motion } = fixture();
  assert.deepEqual(motion.waves.map(({ at, x, y }) => [at, x, y]), [
    [38119, 5483, 155329], [38119, 3960, 159316]
  ]);
  const bounds = { cx: -1, cy: 155370 };
  assert.deepEqual(M8P1Motion.wavelets(motion, 38118, bounds), []);
  const a = M8P1Motion.wavelets(motion, 41000, bounds);
  const b = M8P1Motion.wavelets(motion, 41500, bounds);
  assert.equal(a.length, 14);
  assert.ok(a[3].x < 5483 && b[3].x < a[3].x);
  assert.deepEqual(M8P1Motion.wavelets(motion, 41000, bounds), a);
  assert.deepEqual(M8P1Motion.wavelets(motion, 49200, bounds), []);
});

test('each echo releases a symmetric fan from one origin with gaps that widen', () => {
  const { motion } = fixture();
  const bounds = { cx: -1, cy: 155370 };
  const start = M8P1Motion.wavelets(motion, 38119, bounds);
  const later = M8P1Motion.wavelets(motion, 42119, bounds);
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  assert.equal(start.length, 14);
  for (let i = 0; i < 2; i++) {
    const origin = motion.waves[i];
    const fan = later.slice(7 * i, 7 * i + 7);
    for (const crest of fan) {
      assert.ok(Math.abs(distance(origin, crest) - 5730) < 1e-6);
      assert.ok(Math.abs(crest.x - origin.x - 5730 * Math.cos(crest.angle)) < 1e-6);
      assert.ok(Math.abs(crest.y - origin.y + 5730 * Math.sin(crest.angle)) < 1e-6);
    }
    assert.ok(Math.abs(fan[2].angle - fan[3].angle - Math.PI / 10) < 1e-6);
    assert.ok(Math.abs(fan[3].angle - fan[4].angle - Math.PI / 10) < 1e-6);
    assert.ok(distance(fan[3], fan[4]) > 4 * distance(start[7 * i + 3], start[7 * i + 4]));
  }
});

test('east fan middle wave tracks the reference frames in map coordinates', () => {
  const { motion } = fixture();
  const bounds = { cx: -1, cy: 155370 };
  // In the 403px-wide reference arena, the center is at x=359.5.
  for (const [t, x] of [[38200, 580], [39240, 520], [40150, 467], [42410, 330]]) {
    const middle = M8P1Motion.wavelets(motion, t, bounds)[3];
    const projectedX = 359.5 + (middle.x - bounds.cx) * 403 / 7560;
    assert.ok(Math.abs(projectedX - x) < 7, `${t}: ${projectedX} vs ${x}`);
  }
});

test('both main rays line up with the two #41 reference frames after rescaling the arena', () => {
  const { motion } = fixture();
  const bounds = { cx: -1, cy: 155370 };
  const waves = motion.waves.map(wave => ({ ...wave, at: 37695 }));
  // Hexweaver's 2D projectile overlay, centered at [359, 492.5] with a 613px-wide platform.
  for (const [t, east, northeast] of [[41017, [403, 483], [421, 480]], [43682, [159, 474], [266, 665]]]) {
    const crests = M8P1Motion.wavelets({ waves }, t, bounds);
    for (const [crest, [x, y]] of [[crests[3], east], [crests[10], northeast]]) {
      const px = 359 + (crest.x - bounds.cx) * 613 / 7560;
      const py = 492.5 - (crest.y - bounds.cy) * 613 / 7560;
      assert.ok(Math.hypot(px - x, py - y) < 6);
    }
  }
});

test('boss and tail pose is reproducible after seeking and reacts to a recorded release', () => {
  const { motion } = fixture();
  assert.equal(M8P1Motion.pose(motion, 204, 44800).charge, 0);
  assert.ok(M8P1Motion.pose(motion, 204, 48000).charge > .75);
  assert.ok(M8P1Motion.pose(motion, 204, 49195).swing > .6);
  assert.equal(M8P1Motion.pose(motion, 204, 49900).swing, 0);
  assert.ok(M8P1Motion.pose(motion, 177, 26000).charge > 0);
  const frame = M8P1Motion.pose(motion, 177, 41450);
  assert.notEqual(M8P1Motion.pose(motion, 177, 41550).breath, frame.breath);
  assert.deepEqual(M8P1Motion.pose(motion, 177, 41450), frame);
});

test('original clips seek from logged casts rather than from wall clock or playback history', () => {
  const { motion } = fixture();
  const clip = (id, role, t) => M8P1Motion.originalPose(motion, id, role, t);
  assert.deepEqual(clip(177, 'boss', 25000), { name: 'a51', seconds: 1.377, loop: true });
  assert.deepEqual(clip(204, 'tail', 45000), { name: 'a25', seconds: .007, loop: true });
  assert.deepEqual(clip(204, 'tail', 48995), { name: 'a213', seconds: 1.37, loop: false });
  assert.deepEqual(clip(206, 'tail-echo', 38119), { name: 'a16', seconds: .81, loop: false });
  assert.deepEqual(clip(204, 'tail', 50000), { name: 'a0', seconds: 50, loop: true });
  assert.deepEqual(clip(204, 'tail', 48995), { name: 'a213', seconds: 1.37, loop: false });
});

test('animated units keep logged anchors; the boss does not cross a missing movement segment', () => {
  const { actors: [boss, tail, echo], motion } = fixture();
  assert.equal(M8P1Motion.unitPoint(motion, boss, 'boss', 0).x, 123);
  assert.equal(M8P1Motion.unitPoint(motion, boss, 'boss', 41450).x, 123);
  assert.equal(M8P1Motion.unitPoint(motion, boss, 'boss', 61200), null);
  assert.equal(M8P1Motion.unitPoint(motion, tail, 'tail', 41450).x, -4082);
  assert.equal(M8P1Motion.unitPoint(motion, echo, 'tail-echo', 35000), null);
  assert.equal(M8P1Motion.unitPoint(motion, echo, 'tail-echo', 37100).x, 5483);
  assert.equal(M8P1Motion.unitPoint(motion, echo, 'tail-echo', 41450), null);
});
