const assert = require('node:assert/strict');
const test = require('node:test');
require('./dist/evidence.js');

const wave = (t, type, target, details = {}) => ({ t, type, target, spellID: 1292403, ...details });
const damage = (t, target, amount = 10) => wave(t, 'damage', target, { amount });
const evidence = events => M8Evidence.build({ duration: 10000, events, actors: [
  { id: 1, type: 'Player' }, { id: 2, type: 'Player' }, { id: 3, type: 'NPC' },
] });

test('a wave contact shows once when hit or stacked, not for aura damage ticks', () => {
  const result = evidence([
    damage(1000, 1), wave(1000, 'applydebuff', 1), damage(1950, 1),
    damage(2150, 1, 0), wave(2150, 'applydebuffstack', 1, { stack: 2 }),
    wave(2170, 'applydebuffstack', 1, { stack: 2 }), damage(3090, 1),
    wave(3560, 'removedebuff', 1), damage(3600, 1),
  ]);
  assert.deepEqual(result.waveContacts, [{ actorId: 1, t: 1000 }, { actorId: 1, t: 2150 }]);
  assert.deepEqual(M8Evidence.waveCallouts(result, 999), []);
  assert.deepEqual(M8Evidence.waveCallouts(result, 1000), [{ actorId: 1, t: 1000, progress: 0 }]);
  assert.deepEqual(M8Evidence.waveCallouts(result, 2200), [{ actorId: 1, t: 2150, progress: .04 }]);
  assert.deepEqual(M8Evidence.waveCallouts(result, 3400), []);
});

test('unpaired wave damage can show a contact for a lethal hit, but not for a cast, NPC or zero damage', () => {
  const result = evidence([
    wave(200, 'cast', 1), damage(300, 3), damage(400, 1, 0),
    damage(1050, 1), damage(1050, 1), damage(1980, 1), damage(3070, 1),
    damage(4150, 2), wave(4151, 'death', 2),
    { t: 4400, spellID: 1298570, type: 'cast', target: 2 },
  ]);
  assert.deepEqual(result.waveContacts, [{ actorId: 1, t: 1050 }, { actorId: 2, t: 4150 }]);
  assert.deepEqual(M8Evidence.waveCallouts(result, 4400), [{ actorId: 2, t: 4150, progress: .2 }]);
});
