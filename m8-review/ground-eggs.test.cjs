const assert = require('node:assert/strict');
const test = require('node:test');
require('./dist/evidence.js');

function makeEvidence(points, { gameID = 265644, spellID = 1299650, end, shield } = {}) {
  return M8Evidence.build({
    duration: 10000,
    actors: [{ id: 1, name: 'Egg', type: 'NPC', gameID, points }],
    eggShields: shield ? [{ actorId: 1, start: 1000, max: 100, ...shield }] : [],
    events: [
      { t: 1000, type: 'cast', source: 1, spellID },
      ...(end === undefined ? [] : [{ t: end, type: 'death', target: 1 }]),
    ],
  });
}

const markerAt = (evidence, time, map = 0) => M8Evidence.groundEggMarkers(evidence, time, map)[0];

test('ground egg shields decrease on exact instance hits and flash only after reaching zero', () => {
  const evidence = makeEvidence([[1000, 7, 16, 100]], {
    shield: { hits: [[2300, 36], [3700, 46], [4000, 18]], fadeAt: 4004, brokenAt: 4004 },
  });
  assert.equal(markerAt(evidence, 999), undefined);
  assert.equal(markerAt(evidence, 2299).shieldPct, 100);
  assert.equal(markerAt(evidence, 2300).shieldPct, 64);
  assert.equal(markerAt(evidence, 3999).shieldPct, 18);
  assert.equal(markerAt(evidence, 4000).shieldPct, null);
  assert.equal(markerAt(evidence, 4000).brokenAt, 4000);
  assert.equal(markerAt(evidence, 6399).brokenAt, 4000);
  assert.equal(markerAt(evidence, 6400), undefined);
  assert.equal(markerAt(evidence, 2300, 1), undefined);
});

test('NPC health, including zero health, is never used as a shield proxy', () => {
  const evidence = makeEvidence([[1000, 7, 16, 100], [1300, 7, 16, 0]]);
  assert.equal(markerAt(evidence, 1000).shieldPct, null);
  assert.equal(markerAt(evidence, 1300).brokenAt, null);
});

test('an over-counted absorb stream never displays a fabricated shield', () => {
  const evidence = makeEvidence([[1000, 7, 16, 100]], { shield: { hits: [[1100, 101]] } });
  assert.equal(markerAt(evidence, 1100).shieldPct, null);
  assert.equal(markerAt(evidence, 1100).brokenAt, null);
});

test('egg marker disappears at a logged death even during the short anchor flash', () => {
  const evidence = makeEvidence([[1000, 7, 16, 100]], {
    end: 1500, shield: { hits: [[1300, 100]], fadeAt: 1300, brokenAt: 1300 },
  });
  assert.equal(markerAt(evidence, 1400).brokenAt, 1300);
  assert.equal(markerAt(evidence, 1500), undefined);
});
