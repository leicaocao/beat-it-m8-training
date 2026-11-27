const fs = require('node:fs/promises');
const path = require('node:path');
const { savePublicReport, WclImportError } = require('./sync.cjs');

const WRETCH = 263942;
const TOXIC_WOMB = 1303620;
const MAX_CONTINUOUS_GAP_MS = 3000;

function spawnAnchors(fight) {
  const adds = new Map(fight.actors.filter(actor => actor.gameID === WRETCH && actor.points.length)
    .map(actor => [actor.id, actor]));
  const byTime = new Map();
  for (const event of fight.events) {
    if (event.type !== 'cast' || event.spellID !== TOXIC_WOMB || !adds.has(event.source)) continue;
    if (byTime.has(event.t) && byTime.get(event.t).id !== event.source) {
      throw new WclImportError(409, '同一时刻有多个畸体，不能安全地匹配坐标。');
    }
    byTime.set(event.t, adds.get(event.source));
  }
  return byTime;
}

function measureOldGaps(previous, points) {
  return previous.slice(1).flatMap(([end], index) => {
    const start = previous[index][0];
    if (end - start <= MAX_CONTINUOUS_GAP_MS) return [];
    const times = points.filter(([t]) => t >= start && t <= end).map(([t]) => t);
    return [{ start, end, maxGapMs: Math.max(...times.slice(1).map((time, i) => time - times[i])) }];
  });
}

function mergeWretchPositions(cached, fetched, fightId) {
  const original = cached.fights.find(fight => fight.id === fightId);
  const latest = fetched.fights.find(fight => fight.id === fightId);
  if (cached.code !== fetched.code || cached.visibility !== 'public' || fetched.visibility !== 'public' ||
      cached.version !== 1 || cached.encounterID !== 3492 || fetched.encounterID !== 3492 ||
      !original || !latest || original.startTime !== latest.startTime || original.endTime !== latest.endTime) {
    throw new WclImportError(409, '新旧报告不是同一场战斗，未修改本机数据。');
  }
  const oldAnchors = spawnAnchors(original);
  const newAnchors = spawnAnchors(latest);
  if (!oldAnchors.size || [...oldAnchors.keys()].some(time => !newAnchors.has(time))) {
    throw new WclImportError(409, '未能逐只匹配畸体的起点，未修改本机数据。');
  }
  const replacements = new Map();
  const info = [];
  const duration = original.endTime - original.startTime;
  for (const [spawnAt, actor] of oldAnchors) {
    const known = new Set(actor.points.map(point => point[0]));
    const maps = new Set(actor.points.map(point => point[4] ?? 0));
    const extra = newAnchors.get(spawnAt).points.filter(([t, x, y, , map]) => {
      if (known.has(t) || !maps.has(map ?? 0) || ![t, x, y].every(Number.isFinite) || t < spawnAt || t > duration) return false;
      known.add(t);
      return true;
    });
    const points = [...actor.points, ...extra].sort((a, b) => a[0] - b[0]);
    replacements.set(actor.id, { ...actor, points });
    info.push({ spawnAt, before: actor.points.length, after: points.length, added: extra.length,
      oldGaps: measureOldGaps(actor.points, points) });
  }
  if (!info.some(item => item.added)) throw new WclImportError(404, 'WCL 没有返回新的畸体坐标。');
  const fight = { ...original, actors: original.actors.map(actor => replacements.get(actor.id) || actor) };
  return { report: { ...cached, fights: cached.fights.map(item => item === original ? fight : item) }, info };
}

async function readPublicCache(code) {
  if (!/^[A-Za-z0-9]{16}$/.test(code || '')) throw new WclImportError(400, '无效的战报编号。');
  const file = path.join(__dirname, 'data', `${code}.json`);
  const original = await fs.readFile(file, 'utf8').catch(error => {
    if (error.code === 'ENOENT') throw new WclImportError(404, '本机没有已导入的完整战报，无法追加轨迹。');
    throw error;
  });
  const cached = JSON.parse(original);
  if (cached.code !== code || cached.visibility !== 'public' || cached.version !== 1 ||
      cached.encounterID !== 3492 || !Array.isArray(cached.fights)) {
    throw new WclImportError(409, '本机缓存不是对应的公开 M8 战报。');
  }
  return cached;
}

function remainingFightIds(cached, excluded) {
  const ids = cached.fights.map(fight => fight.id);
  if (!ids.includes(excluded) || new Set(ids).size !== ids.length ||
      ids.some(id => !Number.isSafeInteger(id) || id <= 0) || ids.length < 2) {
    throw new WclImportError(409, '本机战报没有预期的战斗范围。');
  }
  return ids.filter(id => id !== excluded);
}

function mergeWretchBatch(cached, fetched, requested) {
  let report = cached;
  const updated = [];
  const skipped = [];
  for (const fightId of requested) {
    try {
      const result = mergeWretchPositions(report, fetched, fightId);
      report = result.report;
      updated.push({ fightId, info: result.info });
    } catch (error) {
      if (!(error instanceof WclImportError)) throw error;
      skipped.push({ fightId, status: error.status, reason: error.message });
    }
  }
  return { report, updated, skipped };
}

async function saveWretchPositions(fetched, fightId) {
  const { report, info } = mergeWretchPositions(await readPublicCache(fetched?.code), fetched, fightId);
  await savePublicReport(report);
  return info;
}

async function saveWretchBatch(fetched, requested) {
  const { report, updated, skipped } = mergeWretchBatch(await readPublicCache(fetched?.code), fetched, requested);
  if (updated.length) await savePublicReport(report);
  return { updated, skipped };
}

module.exports = { mergeWretchPositions, mergeWretchBatch, readPublicCache, remainingFightIds, saveWretchPositions, saveWretchBatch };
