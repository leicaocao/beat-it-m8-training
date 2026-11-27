const assert = require('node:assert/strict');
const test = require('node:test');
const { mergeWretchPositions, mergeWretchBatch, remainingFightIds } = require('./enrich-wretch.cjs');

function fixture() {
  const base = { code: 'ExampleReport001', version: 1, encounterID: 3492, visibility: 'public' };
  const actor = (id, points) => ({ id, gameID: 263942, points });
  const spawn = source => ({ t: 100, type: 'cast', spellID: 1303620, source });
  const point = (time, x = 10, map = 2610) => [time, x, 50, 90, map];
  const cached = { ...base, fights: [{ id: 13 }, {
    id: 41, startTime: 100000, endTime: 140000, eggShields: [{ max: 100 }],
    actors: [actor(189, [point(100), point(3000, 35)]), { id: 2, type: 'Player', points: [] }],
    events: [spawn(189)],
  }] };
  const fetched = { ...base, fights: [{
    id: 41, startTime: 100000, endTime: 140000,
    actors: [actor(250, [point(100, 900), point(1200, 18), point(1800, 610, 21)])], events: [spawn(250)],
  }] };
  return { cached, fetched, point };
}

test('coordinates are matched by spawn, not remapped actor IDs; other replay data stays intact', () => {
  const { cached, fetched, point } = fixture();
  const { report, info } = mergeWretchPositions(cached, fetched, 41);
  const old = cached.fights[1];
  const merged = report.fights[1];
  assert.equal(report.fights[0], cached.fights[0]);
  assert.equal(merged.events, old.events);
  assert.equal(merged.eggShields, old.eggShields);
  assert.equal(merged.actors[1], old.actors[1]);
  assert.equal(merged.actors[0].id, 189);
  assert.deepEqual(merged.actors[0].points, [point(100), point(1200, 18), point(3000, 35)]);
  assert.equal(info[0].added, 1);
  assert.equal(old.actors[0].points.length, 2);
});

test('different fights or unmatched spawns cannot change cached coordinates', () => {
  const { cached, fetched } = fixture();
  fetched.fights[0].events[0].t++;
  assert.throws(() => mergeWretchPositions(cached, fetched, 41), { status: 409 });
  fetched.fights[0].startTime++;
  assert.throws(() => mergeWretchPositions(cached, fetched, 41), { status: 409 });
});

test('the batch excludes the completed fight and safely skips an unmatched fight', () => {
  const { cached, fetched } = fixture();
  cached.fights.push({ id: 42 });
  assert.deepEqual(remainingFightIds(cached, 42), [13, 41]);
  assert.throws(() => remainingFightIds(cached, 43), { status: 409 });
  const { report, updated, skipped } = mergeWretchBatch(cached, fetched, [13, 41]);
  assert.deepEqual(updated.map(item => item.fightId), [41]);
  assert.deepEqual(skipped.map(item => item.fightId), [13]);
  assert.equal(report.fights[0], cached.fights[0]);
  assert.equal(report.fights[2], cached.fights[2]);
});

test('the audit measures the largest remaining interval inside each previous gap', () => {
  const { cached, fetched, point } = fixture();
  cached.fights[1].actors[0].points = [point(100), point(8000, 35)];
  fetched.fights[0].actors[0].points = [point(100), point(1200, 18), point(3200, 21), point(6000, 30)];
  const { info } = mergeWretchPositions(cached, fetched, 41);
  assert.deepEqual(info[0].oldGaps, [{ start: 100, end: 8000, maxGapMs: 2800 }]);
});
