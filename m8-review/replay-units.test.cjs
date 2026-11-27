const assert = require('node:assert/strict');
const test = require('node:test');
require('./dist/model.js');
require('./dist/map-geometry.js');

const npc = (gameID, points = [], subType = 'NPC') => ({ type: 'NPC', gameID, points, subType });

test('the map distinguishes the Wretch, both Rattlers, and the main boss', () => {
  assert.equal(M8Model.mapRole(npc(263942)), 'large-add');
  assert.equal(M8Model.mapRole(npc(259555, [], 'Boss')), 'tail');
  assert.equal(M8Model.mapRole(npc(267418)), 'tail-echo');
  assert.equal(M8Model.mapRole(npc(257758, [], 'Boss')), 'boss');
  assert.equal(M8Model.mapRole(npc(265644)), null);
});

test('a Wretch fades out before a sample gap and fades in only at the next observed location', () => {
  const actor = npc(263942, [[100, 10, 20, 65, 2610], [8000, 50, 90, 15, 2610]]);
  assert.equal(M8Model.sampleMapUnit(actor, 'large-add', 99), null);
  assert.deepEqual(M8Model.sampleMapUnit(actor, 'large-add', 2775), {
    x: 10, y: 20, hp: 65, map: 2610, sampled: false, opacity: .5,
  });
  for (const t of [3100, 4500, 7999, 8000, 11000]) {
    assert.equal(M8Model.sampleMapUnit(actor, 'large-add', t), null);
  }
  assert.deepEqual(M8Model.sampleMapUnit(actor, 'large-add', 8325), {
    x: 50, y: 90, hp: 15, map: 2610, sampled: false, opacity: .5,
  });
});

test('the Wretch uses short same-map interpolations without restarting the fade at each sample', () => {
  const actor = npc(263942, [[100, 10, 20, 65, 2610], [8000, 50, 90, 15, 2610],
    [8250, 60, 100, 14, 2610], [8750, 70, 110, 13, 2610]]);
  const point = M8Model.sampleMapUnit(actor, 'large-add', 8325);
  assert.equal(point.opacity, .5);
  assert.equal(point.x, 61.5);
  assert.equal(M8Model.sampleMapUnit(actor, 'large-add', 8650).opacity, 1);

  const acrossMaps = npc(263942, [[100, 10, 20, 65, 2610], [1500, 50, 90, 15, 2611]]);
  assert.equal(M8Model.sampleMapUnit(acrossMaps, 'large-add', 1499).map, 2610);
  assert.equal(M8Model.sampleMapUnit(acrossMaps, 'large-add', 1500), null);
  assert.equal(M8Model.sampleMapUnit(acrossMaps, 'large-add', 1825).map, 2611);
});

test('a fixed Rattler stays visible between matching positions, but not after the observation window', () => {
  const actor = npc(259555, [[100, -4082, 155360, 97, 2610], [7500, -4082, 155360, 90, 2610]]);
  assert.equal(M8Model.sampleMapUnit(actor, 'tail', 5200).x, -4082);
  assert.equal(M8Model.sampleMapUnit(actor, 'tail', 10501), null);
  actor.points[1][1] = 3986;
  assert.equal(M8Model.sampleMapUnit(actor, 'tail', 5200), null);
});

test('the decorative tail marker is outside the arena without changing or replacing the real anchor', () => {
  const art = { cx: -29.5, cy: 155355.5, span: 12675 };
  for (const [x, y] of [[-4082, 155360], [3986, 155329], [-7, 151261], [2800, 158400]]) {
    const recorded = Object.freeze({ x, y, map: 2610 });
    const marker = M8MapGeometry.tailWaterMarker(art, recorded);
    const dx = marker.x - art.cx;
    const dy = marker.y - art.cy;
    const edge = Math.max(Math.abs(dx), Math.abs(dy), (Math.abs(dx) + Math.abs(dy)) * Math.SQRT1_2);
    assert.ok(edge > art.span * .44 && edge < art.span * .5);
    assert.ok(Math.abs(dx * (y - art.cy) - dy * (x - art.cx)) < 1e-6);
    assert.deepEqual(recorded, { x, y, map: 2610 });
    assert.equal(M8MapGeometry.tailWaterMarker(null, recorded), recorded);
  }
});

test('P1 uses the native landscape art and a single unrotated scale', () => {
  const west = [-4082, 155360];
  const east = [3986, 155329];
  const south = [-7, 151261];
  const center = [-1, 155370];
  const report = { encounterID: 3492, fights: [{ actors: [
    { type: 'Player', points: [[0, 10, 155340, 100, 2610]] },
    npc(259555, [[700, ...west, 100, 2610], [900, ...east, 100, 2610], [1500, ...south, 100, 2610]], 'Boss'),
    npc(263942, [[300, ...center, 100, 2610]]),
  ] }] };
  const geometry = M8MapGeometry.view(M8MapGeometry.prepare(report), 1, 2610);
  assert.equal(geometry.source, 'p1-reference-platform');
  assert.deepEqual(M8MapGeometry.mapOffset(geometry, ...center), [0, 0]);
  const [w, h] = geometry.art.nativeSize;
  assert.ok(Math.abs(w / h - 2123 / 1188) < 1e-10);
  assert.deepEqual(M8MapGeometry.mapOffset(geometry, ...west), [-4081, 10]);
  assert.deepEqual(M8MapGeometry.mapOffset(geometry, ...east), [3987, 41]);
  assert.deepEqual(M8MapGeometry.mapOffset(geometry, ...south), [-6, 4109]);
  const rim = w * 532 / 2123;
  assert.ok(Math.abs(rim - 3780) < .01);
  assert.ok(west[0] - center[0] < -rim && east[0] - center[0] > rim);
  assert.ok(center[1] - south[1] > rim);
  // Independent frame: WCL actor positions at the first soak minus 2 seconds.
  const pxPerUnit = 306 / rim;
  for (const [point, target] of [
    [[148, 158458], [370, 242]], [[-2940, 155660], [121, 469]],
    [[-1910, 154454], [204, 567]], [[832, 155705], [426, 466]],
  ]) {
    const [dx, dy] = M8MapGeometry.mapOffset(geometry, ...point);
    assert.ok(Math.hypot(358 + dx * pxPerUnit - target[0], 492 + dy * pxPerUnit - target[1]) < 4);
  }
  for (const [x, y] of [west, east, south]) {
    const tail = Object.freeze({ x, y, map: 2610 });
    assert.equal(M8MapGeometry.tailWaterMarker(geometry.art, tail), tail);
  }
  assert.deepEqual(M8MapGeometry.mapOffset(geometry.raw, ...west), [west[0] - geometry.raw.cx, geometry.raw.cy - west[1]]);
  assert.deepEqual(report.fights[0].actors[1].points[0], [700, ...west, 100, 2610]);
});

test('P1 soak overlays align with the two reference rings without moving the logged coils', () => {
  const bounds = M8MapGeometry.view(M8MapGeometry.prepare({ encounterID: 3492, fights: [{ actors: [
    npc(263942, [[300, -1, 155370, 100, 2610]]),
    npc(259555, [[700, -4082, 155360, 100, 2610]], 'Boss'),
  ] }] }), 1, 2610);
  for (const [anchor, expected] of [
    [Object.freeze({ x: -4534, y: 157245, map: 2610 }), [142, 402]],
    [Object.freeze({ x: -4166, y: 153405, map: 2610 }), [163, 581]],
  ]) {
    const ring = M8MapGeometry.p1SoakRing(bounds, anchor);
    assert.equal(ring.radius, 1050);
    assert.ok(Math.abs(Math.hypot(ring.x - anchor.x, ring.y - anchor.y) - 2000) < 1e-8);
    const [dx, dy] = M8MapGeometry.mapOffset(bounds, ring.x, ring.y);
    assert.ok(Math.hypot(358 + dx * .081 - expected[0], 492 + dy * .081 - expected[1]) < 6);
    assert.equal(M8MapGeometry.p1SoakRing(bounds.raw, anchor), null);
    assert.equal(M8MapGeometry.p1SoakRing(bounds, { ...anchor, map: 2611 }), null);
  }
  assert.equal(M8MapGeometry.p1SoakRing(bounds, { x: 0, y: 155370, map: 2610 }), null);
});

test('the native reference requires both P1 anchors on the main platform map', () => {
  const geometry = M8MapGeometry.prepare({ encounterID: 3492, fights: [{
    phaseTransitions: [{ id: 1, t: 0 }, { id: 4, t: 1000 }],
    actors: [npc(259555, [[600, -4082, 155360, 100, 2611], [1400, -4082, 155360, 100, 2610]]),
      npc(263942, [[100, -1, 155370, 100, 2610]])],
  }] });
  assert.equal(M8MapGeometry.view(geometry, 1, 2610).art, undefined);
  assert.equal(M8MapGeometry.view(geometry, 1, 2611).art, undefined);
  assert.equal(M8MapGeometry.view(geometry, 4, 2610).art, undefined);
});
