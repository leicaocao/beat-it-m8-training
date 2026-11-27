const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const ENCOUNTER = 3492;
const MYTHIC = 5;
const RAID_ZONE = 53;
const PRIVATE_DATA = path.join(__dirname, 'data');
const SAMPLE_MS = 450;
const PAGE_SIZE = 10000;
const MECHANIC_NAMES = /卵|孵化|烈毒之心|蛇母之怒|响尾猛击|沸腾毒液|毒牙|疫鳞|egg|hatch|heart of|mother's fury|rattler|boiling venom|fangs|blightscale/i;
const M8_SPELLS = new Set([1299526, 1298367, 1298369, 1299206, 1301122, 1313757, 1313758, 1315342, 1315343]);
const AURAS = ['applydebuff', 'applydebuffstack', 'removedebuff', 'removedebuffstack', 'refreshdebuff', 'applybuff', 'applybuffstack', 'removebuff', 'removebuffstack', 'refreshbuff'];
const HARDENED_EGG = 265644;
const HARDENING = 1299650;
const WRETCH = 263942;

class WclImportError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const META_QUERY = `
  query($code:String!) {
    reportData {
      report(code:$code) {
        code title startTime visibility owner { id } zone { id }
        masterData { actors { id name type subType gameID } abilities { gameID name } }
        fights(encounterID:3492, difficulty:5) {
          id name encounterID difficulty kill startTime endTime
          phaseTransitions { id startTime }
          maps { id }
          friendlyPlayers enemyNPCs { id }
        }
      }
    }
  }
`;
const EVENTS_QUERY = `
  query($code:String!, $ids:[Int], $start:Float!, $end:Float!, $filter:String!, $limit:Int) {
    reportData {
      report(code:$code) {
        events(
          fightIDs:$ids, startTime:$start, endTime:$end, filterExpression:$filter,
          includeResources:true, limit:$limit
        ) { data nextPageTimestamp }
      }
    }
  }
`;

function readInput(input = '') {
  const code = /^[a-zA-Z0-9]{16}$/.test(input)
    ? input : input.match(/\/reports\/([A-Za-z0-9]{16})(?:[/?#]|$)/)?.[1];
  if (!code) throw new Error('用法：node m8-review/sync.cjs <WCL 报告链接或编号> [战斗编号]');
  return code;
}

function makeFilter(mechanics) {
  const auras = AURAS.map(type => `'${type}'`).join(',');
  const actions = "type IN ('cast','begincast','death','resurrect','interrupt','summon')";
  const enemyHits = `(source.type = 'NPC' AND target.type = 'Player' AND type IN ('damage',${auras}))`;
  const eggShields = `(ability.id = ${HARDENING} AND target.id = ${HARDENED_EGG} AND type IN ('applybuff','refreshbuff','removebuff','absorbed'))`;
  const wretchPositions = `(target.id = ${WRETCH} AND resources.actor.id = ${WRETCH} AND type IN ('damage','miss'))`;
  const clauses = [actions, enemyHits, eggShields, wretchPositions];
  if (mechanics.size) clauses.push(`(ability.id IN (${[...mechanics].join(',')}) AND type IN ('damage',${auras}))`);
  return clauses.join(' OR ');
}

function makeFight(fight, actors, abilities, mechanics) {
  const friends = new Set(fight.friendlyPlayers ?? []);
  const enemies = new Set((fight.enemyNPCs ?? []).map(npc => npc.id));
  const nextActorId = Math.max(0, ...actors.keys()) + 1;
  const outputActors = new Map();
  const instanceIds = new Map();
  const events = [];
  const eggShields = [];
  const activeEggShields = new Map();
  const duration = fight.endTime - fight.startTime;
  const sampleTimes = new Map();

  function ensureActor(rawId, instance) {
    const original = actors.get(rawId);
    if (!original) return null;
    // Repeated enemy spawns share a report actor ID. Keep their paths separate.
    let id = rawId;
    if (enemies.has(rawId) && Number.isInteger(instance) && instance > 1) {
      const key = `${rawId}:${instance}`;
      if (!instanceIds.has(key)) instanceIds.set(key, nextActorId + instanceIds.size);
      id = instanceIds.get(key);
    }
    if (!outputActors.has(id)) {
      outputActors.set(id, {
        id,
        name: original.name,
        type: original.type,
        subType: original.subType,
        gameID: original.gameID ?? null,
        points: [],
      });
    }
    return outputActors.get(id);
  }

  for (const id of friends) ensureActor(id);
  for (const id of enemies) ensureActor(id);

  function capturePosition(event, t) {
    if (!Number.isFinite(event.x) || !Number.isFinite(event.y)) return;
    if (event.resourceActor !== 1 && event.resourceActor !== 2) return;
    const side = event.resourceActor === 1 ? 'source' : 'target';
    const id = event[`${side}ID`];
    if (!friends.has(id) && !enemies.has(id)) return;
    const actor = ensureActor(id, event[`${side}Instance`]);
    if (!actor) return;
    const map = Number.isInteger(event.mapID) ? event.mapID : 0;
    const previous = sampleTimes.get(actor.id);
    if (previous && previous.map === map && t - previous.t < SAMPLE_MS) return;
    const hp = Number.isFinite(event.hitPoints) && event.maxHitPoints > 0
      ? Math.round(1000 * event.hitPoints / event.maxHitPoints) / 10 : null;
    actor.points.push([t, event.x, event.y, hp, map]);
    sampleTimes.set(actor.id, { t, map });
  }

  function captureEvent(event, t) {
    const isEnemy = enemies.has(event.sourceID);
    const isPlayer = friends.has(event.targetID);
    const isMechanic = mechanics.has(event.abilityGameID);
    const type = event.type;
    switch (type) {
      case 'death':
        if (!isPlayer && !enemies.has(event.targetID)) return;
        break;
      case 'resurrect':
        if (!isPlayer) return;
        break;
      case 'interrupt':
        if (!enemies.has(event.targetID) && !isEnemy && !isMechanic) return;
        break;
      case 'summon':
        if (!isEnemy && !enemies.has(event.targetID) && !isMechanic) return;
        break;
      case 'begincast':
      case 'cast':
        if (!isEnemy && !isMechanic) return;
        break;
      case 'damage':
        if (!isPlayer || !isMechanic) return;
        break;
      default:
        if (!AURAS.includes(type) || (!isMechanic && !(isEnemy && isPlayer))) return;
        break;
    }
    const spellId = type === 'death' ? event.killingAbilityGameID || event.abilityGameID
      : type === 'interrupt' ? event.extraAbilityGameID || event.abilityGameID
      : event.abilityGameID;
    events.push({
      t,
      type,
      spell: abilities.get(spellId) || (spellId ? `法术 ${spellId}` : ''),
      spellID: spellId || null,
      source: ensureActor(event.sourceID, event.sourceInstance)?.id ?? null,
      target: ensureActor(event.targetID, event.targetInstance)?.id ?? null,
      stack: Number.isFinite(event.stack) ? event.stack : null,
      amount: Number.isFinite(event.amount) ? event.amount : null,
    });
  }

  function captureEggShield(event, t) {
    if (event.abilityGameID !== HARDENING || actors.get(event.targetID)?.gameID !== HARDENED_EGG) return;
    const instance = event.targetInstance ?? (event.sourceID === event.targetID ? event.sourceInstance : undefined);
    const actorId = ensureActor(event.targetID, instance).id;
    const active = activeEggShields.get(actorId);
    const value = event.absorb;
    if (event.type === 'applybuff' || event.type === 'refreshbuff') {
      if (!Number.isSafeInteger(value) || value <= 0 || active?.start === t) return;
      if (active) active.fadeAt = t;
      const shield = { actorId, start: t, max: value, hits: [] };
      activeEggShields.set(actorId, shield);
      eggShields.push(shield);
    } else if (active && event.type === 'removebuff') {
      active.fadeAt = t;
      if (value === 0) active.brokenAt = t;
      activeEggShields.delete(actorId);
    } else if (active && event.type === 'absorbed' && Number.isSafeInteger(event.amount) && event.amount > 0) {
      active.hits.push([t, event.amount]);
    }
  }

  return {
    add(event) {
      const t = event.timestamp - fight.startTime;
      if (!Number.isFinite(t) || t < 0 || t > duration) return;
      capturePosition(event, t);
      captureEvent(event, t);
      captureEggShield(event, t);
    },
    finish() {
      return {
        id: fight.id,
        startTime: fight.startTime,
        endTime: fight.endTime,
        kill: Boolean(fight.kill),
        phaseTransitions: (fight.phaseTransitions ?? [])
          .map(({ id, startTime }) => ({ id, t: startTime - fight.startTime }))
          .filter(({ t }) => Number.isFinite(t) && t >= 0 && t <= duration)
          .sort((a, b) => a.t - b.t),
        actors: [...outputActors.values()],
        events: events.sort((a, b) => a.t - b.t),
        ...(eggShields.length ? { eggShields } : {}),
      };
    },
  };
}

async function captureFight(client, code, fight, actors, abilities, mechanics, wretchOnly) {
  const track = makeFight(fight, actors, abilities, mechanics);
  const filter = wretchOnly ? `(resources.actor.id = ${WRETCH}) OR (source.id = ${WRETCH} AND type = 'cast')`
    : makeFilter(mechanics);
  let start = fight.startTime;
  for (;;) {
    const response = await client.graphql(EVENTS_QUERY, {
      code, ids: [fight.id], start, end: fight.endTime, filter, limit: PAGE_SIZE,
    });
    const page = response.reportData?.report?.events;
    if (!Array.isArray(page?.data)) throw new Error(`第 ${fight.id} 场未返回事件数据`);
    for (const event of page.data) track.add(event);
    const next = page.nextPageTimestamp;
    if (next == null || next > fight.endTime) break;
    if (!Number.isFinite(next) || next <= start) throw new Error(`第 ${fight.id} 场事件分页未前进`);
    start = next;
  }
  return track.finish();
}

async function writeLocal(file, data) {
  await fs.mkdir(PRIVATE_DATA, { recursive: true });
  const temp = path.join(PRIVATE_DATA, `.${randomUUID()}.json`);
  try {
    await fs.writeFile(temp, JSON.stringify(data), { flag: 'wx', mode: 0o600 });
    await fs.rename(temp, file);
  } finally {
    await fs.rm(temp, { force: true });
  }
}

async function localSettings() {
  try {
    return JSON.parse(await fs.readFile(path.join(PRIVATE_DATA, 'sync-settings.json'), 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return {};
  }
}

async function localClient(publicSample) {
  const settings = await localSettings();
  const serverDir = process.env.WCL_SERVER_DIR || settings.serverDir;
  const owner = Number(process.env.WCL_REPORT_OWNER_ID || settings.reportOwnerId);
  if (!serverDir) throw new WclImportError(503, '这台电脑还未配置 WCL 授权。可以先选择复盘 JSON 文件导入。');
  if (!publicSample && (!Number.isSafeInteger(owner) || owner <= 0)) {
    throw new WclImportError(503, '本机还未配置允许同步的 WCL 上传者。');
  }
  const server = path.resolve(serverDir);
  const { createPrivateClient } = require(path.join(server, 'private-wcl.js'));
  const client = createPrivateClient({
    getToken: async () => JSON.parse(await fs.readFile(path.join(server, 'oauth-tokens.local.json'), 'utf8')),
  });
  return { client, owner };
}

async function captureReport({ code, requested = [], last = false, publicSample = false, publicClient, wretchOnly = false, onFight = () => {} }) {
  if (!/^[A-Za-z0-9]{16}$/.test(code) || requested.some(id => !Number.isSafeInteger(id) || id <= 0)) {
    throw new WclImportError(400, '报告或战斗编号无效。');
  }
  if (publicSample && requested.length !== 1) throw new Error('公开样例需指定一场战斗');
  if (wretchOnly && (!requested.length || last)) throw new WclImportError(400, '补轨迹需要指定战斗范围。');
  const { client, owner } = publicClient ? { client: publicClient } : await localClient(publicSample);
  const response = await client.graphql(META_QUERY, { code });
  const report = response.reportData?.report;
  if (report?.zone?.id !== RAID_ZONE || ((publicSample || publicClient) ? report.visibility !== 'public' : report.owner?.id !== owner)) {
    throw new WclImportError(403, '无法读取这份日志。请确认访问权限和允许同步的上传者。');
  }
  const sourceFights = (report.fights ?? [])
    .filter(fight => fight.encounterID === ENCOUNTER && fight.difficulty === MYTHIC)
    .sort((a, b) => a.id - b.id);
  const selected = last ? sourceFights.slice(-1)
    : requested.length ? sourceFights.filter(fight => requested.includes(fight.id)) : sourceFights;
  if (!selected.length || requested.some(id => !selected.some(fight => fight.id === id))) {
    throw new WclImportError(404, '所选战斗中没有对应的史诗乌拉特克记录。');
  }

  const actors = new Map(report.masterData.actors.map(actor => [actor.id, actor]));
  const abilities = new Map(report.masterData.abilities.map(ability => [ability.gameID, ability.name]));
  const mechanics = new Set(M8_SPELLS);
  require('./dist/mechanics.js');
  for (const [id, name] of abilities) {
    if (id >= 1270000 && (MECHANIC_NAMES.test(name) || M8Mechanics.classify({ spellID: id, spell: name }) !== 'other')) {
      mechanics.add(id);
    }
  }
  const fights = [];
  let cursor = 0;
  async function worker() {
    while (cursor < selected.length) {
      const fight = selected[cursor++];
      const recorded = await captureFight(client, code, fight, actors, abilities, mechanics, wretchOnly);
      fights.push(recorded);
      onFight(recorded);
    }
  }
  await Promise.all(Array.from({ length: Math.min(3, selected.length) }, worker));
  fights.sort((a, b) => a.id - b.id);
  return {
    version: 1,
    encounterID: ENCOUNTER,
    code,
    title: report.title,
    startTime: report.startTime,
    visibility: report.visibility,
    ...(publicSample ? { sample: true } : {}),
    fights,
  };
}

async function savePublicReport(report) {
  if (report.visibility !== 'public' || !/^[A-Za-z0-9]{16}$/.test(report.code) || !report.fights?.length) {
    throw new WclImportError(400, '只允许保存完整的公开报告。');
  }
  await writeLocal(path.join(PRIVATE_DATA, `${report.code}.json`), report);
}

async function main() {
  const code = readInput(process.argv[2]);
  const args = process.argv.slice(3);
  const publicSample = args.includes('--public-sample');
  const requested = args.filter(value => value !== '--public-sample').map(Number);
  const report = await captureReport({ code, requested, publicSample, onFight(fight) {
    const samples = fight.actors.reduce((sum, actor) => sum + actor.points.length, 0);
    console.log(`#${fight.id}：${samples} 个位置采样，${fight.events.length} 条事件`);
  }});
  const localFile = path.join(PRIVATE_DATA, `${code}${requested.length ? '-' + report.fights.map(f => f.id).join('-') : ''}.json`);
  await writeLocal(localFile, report);
  console.log(`本地导出 ${report.fights.length} 场，WCL 可见性：${report.visibility || '未知'}。文件：${localFile}`);
}

module.exports = { captureReport, savePublicReport, WclImportError };

if (require.main === module) {
  main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
