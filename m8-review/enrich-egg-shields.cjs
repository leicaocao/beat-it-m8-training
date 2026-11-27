const fs = require('node:fs/promises');
const path = require('node:path');
const { savePublicReport } = require('./sync.cjs');

function mergeEggShields(report, source) {
  if (report.visibility !== 'public' || source.code !== report.code || source.actorGameId !== 265644 ||
      source.spellId !== 1299650 || !Array.isArray(source.eggs) || !source.eggs.length) {
    throw new Error('The shield export does not match the cached public report.');
  }
  const fight = report.fights.find(f => f.id === source.fightId);
  if (!fight) throw new Error('The selected fight is not in the cached report.');
  const eggIDs = new Set(fight.actors.filter(a => a.gameID === source.actorGameId && a.points.length).map(a => a.id));
  const usedIDs = new Set();
  const duration = fight.endTime - fight.startTime;
  const tracks = source.eggs.map(egg => {
    const matches = fight.events.filter(e => e.type === 'cast' && e.spellID === source.spellId &&
      e.t === egg.start && eggIDs.has(e.source));
    if (matches.length !== 1 || usedIDs.has(matches[0].source) || !Number.isSafeInteger(egg.max) || egg.max <= 0 ||
        !Number.isSafeInteger(egg.brokenAt) || egg.brokenAt <= egg.start || egg.brokenAt > duration) {
      throw new Error(`No unique, valid shield anchor for egg ${egg.instance}.`);
    }
    let previous = egg.start;
    let total = 0;
    for (const [t, amount] of egg.hits) {
      if (!Number.isSafeInteger(t) || t < previous || t > egg.brokenAt || !Number.isSafeInteger(amount) || amount <= 0) {
        throw new Error(`Invalid shield drain event for egg ${egg.instance}.`);
      }
      total += amount;
      previous = t;
    }
    if (total !== egg.max) throw new Error(`The shield drain total does not match egg ${egg.instance}.`);
    const actorId = matches[0].source;
    usedIDs.add(actorId);
    return { actorId, start: egg.start, max: egg.max, hits: egg.hits, fadeAt: egg.brokenAt, brokenAt: egg.brokenAt };
  });
  const untouched = (fight.eggShields ?? []).filter(shield => !usedIDs.has(shield.actorId));
  fight.eggShields = [...untouched, ...tracks];
  return tracks.length;
}

async function main() {
  const file = process.argv[2];
  if (!file) throw new Error('Usage: node enrich-egg-shields.cjs <shield export.json>');
  const source = JSON.parse(await fs.readFile(file, 'utf8'));
  if (!/^[A-Za-z0-9]{16}$/.test(source.code)) throw new Error('Invalid report code.');
  const report = JSON.parse(await fs.readFile(path.join(__dirname, 'data', `${source.code}.json`), 'utf8'));
  const count = mergeEggShields(report, source);
  await savePublicReport(report);
  console.log(`Fight #${source.fightId}: matched ${count} verified egg shields.`);
}

module.exports = { mergeEggShields };

if (require.main === module) main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
