const assert = require('node:assert/strict');
const test = require('node:test');
require('./dist/p1-mesh.js');

const entry = (role, pose = {}) => ({
  role, pose: { time: 41450, breath: .22, charge: 0, swing: 0, age: 2.1, ...pose },
  x: 210, y: 190, angle: .4, size: .7,
});

test('P1 models submit real depth, normals and triangles at any checked frame', () => {
  for (const role of ['boss', 'tail', 'tail-echo', 'wave']) {
    const mesh = M8P1Mesh.vertices([entry(role)]);
    assert.ok(mesh.length > 3000 && mesh.length % 33 === 0, role);
    let highest = 0, hasSides = false;
    for (let i = 0; i < mesh.length; i += 11) {
      assert.ok(mesh.subarray(i, i + 11).every(Number.isFinite), role);
      highest = Math.max(highest, mesh[i + 2]);
      hasSides ||= Math.abs(mesh[i + 3]) > .25 && Math.abs(mesh[i + 5]) < .92;
    }
    assert.ok(highest > 12 && hasSides, role);
  }
});

test('poses deform the meshes deterministically without changing the ground anchor', () => {
  const roles = [entry('boss'), entry('tail'), { ...entry('wave'), alpha: .62 }];
  const frame = M8P1Mesh.vertices(roles);
  const advanced = M8P1Mesh.vertices([entry('boss', { breath: -.45 }), entry('tail', { swing: .9 }),
    { ...entry('wave', { age: 2.8 }), alpha: .62 }]);
  assert.equal(frame.length, advanced.length);
  assert.notDeepEqual(frame, advanced);
  assert.deepEqual(frame, M8P1Mesh.vertices(roles));
  const shifted = M8P1Mesh.vertices([{ ...roles[1], x: 250 }]);
  const original = M8P1Mesh.vertices([roles[1]]);
  for (let i = 0; i < original.length; i += 11) {
    assert.ok(Math.abs(shifted[i] - original[i] - 40) < .001);
    assert.equal(shifted[i + 1], original[i + 1]);
    assert.equal(shifted[i + 2], original[i + 2]);
  }
});

test('the guide-based silhouettes keep five crowns, serrated wings and an upright hooked tail', () => {
  const points = role => {
    const mesh = M8P1Mesh.vertices([{ ...entry(role), x: 0, y: 0, size: 1, angle: 0 }]);
    return Array.from({ length: mesh.length / 11 }, (_, i) => mesh.subarray(i * 11, (i + 1) * 11));
  };
  const boss = points('boss');
  const crowns = boss.filter(p => p[6] - p[7] > .15 && p[8] - p[7] > .14);
  assert.ok(crowns.some(([, y, z]) => Math.abs(y) < 18 && z > 88));
  for (const side of [-1, 1]) {
    assert.ok(crowns.some(([, y, z]) => side * y > 22 && z > 57));
    assert.ok(crowns.some(([x, y, z]) => x > 102 && side * y > 5 && z < 56));
    assert.ok(boss.some(p => p[1] * side > 135 && p[7] - p[8] > .25));
  }
  const tail = points('tail');
  assert.ok(tail.some(([, , z]) => z > 100));
  assert.ok(tail.some(([x, , z]) => x > 68 && z > 60));
  assert.ok(tail.some(([x, , z]) => x > 52 && x < 59 && z > 57 && z < 66));
  for (const side of [-1, 1]) assert.ok(tail.some(([, y, z]) => side * y > 21 && z > 41 && z < 88));
});

test('crescent and wake keep a fixed silhouette as bubbles rise and fade', () => {
  const wave = age => M8P1Mesh.vertices([{ ...entry('wave', { age }), x: 0, y: 0, size: 1, angle: 0 }]);
  const frame = wave(2.5);
  const later = wave(3);
  let hasDome = false, hasWake = false, sprayMoves = false, bubblesChange = false;
  let inner = -Infinity, tips = -Infinity;
  for (let i = 0; i < frame.length; i += 11) {
    if (frame[i + 10] === 2) {
      assert.deepEqual(frame.subarray(i, i + 6), later.subarray(i, i + 6));
      hasDome ||= frame[i + 2] > 20;
      if (frame[i + 6] === .5 && frame[i + 7] === 0) inner = Math.max(inner, frame[i]);
      if (frame[i + 6] === 0 || frame[i + 6] === 1) tips = Math.max(tips, frame[i]);
      assert.equal(frame[i + 6], later[i + 6]);
      assert.equal(frame[i + 7], later[i + 7]);
      assert.notEqual(frame[i + 8], later[i + 8]);
    } else if (frame[i + 10] === 3) {
      assert.deepEqual(frame.subarray(i, i + 6), later.subarray(i, i + 6));
      hasWake ||= frame[i] < -35 && frame[i + 2] < 1;
    } else if (frame[i + 10] === 4) {
      sprayMoves ||= frame[i] !== later[i] && frame[i + 1] !== later[i + 1];
    } else if (frame[i + 10] === 5) {
      assert.ok(frame[i + 8] >= 0 && frame[i + 8] <= 1);
      bubblesChange ||= frame[i + 2] !== later[i + 2] && frame[i + 8] !== later[i + 8];
      if (frame[i + 6] === -1 && frame[i + 7] === -1 && frame[i + 17] === 1 && frame[i + 18] === -1) {
        assert.ok(Math.abs((frame[i + 11] - frame[i]) - (later[i + 11] - later[i])) < .001);
      }
    }
  }
  assert.ok(inner > tips + 20);
  assert.ok(hasDome && hasWake && sprayMoves && bubblesChange);
  assert.deepEqual(frame, wave(2.5));
});

test('visual wave span matches the reference scale at different zoom levels', () => {
  for (const pixelsPerUnit of [.045, .08]) {
    const geometry = M8P1Mesh.vertices([{ ...entry('wave'), x: 0, y: 0, angle: 0,
      size: M8P1Mesh.waveScreenScale(pixelsPerUnit) }]);
    let left = Infinity, right = -Infinity;
    for (let i = 0; i < geometry.length; i += 11) {
      if (geometry[i + 10] !== 2) continue;
      left = Math.min(left, geometry[i + 1]);
      right = Math.max(right, geometry[i + 1]);
    }
    assert.ok(Math.abs((right - left) / pixelsPerUnit - 520) < .001);
  }
});
