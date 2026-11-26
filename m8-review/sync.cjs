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
  if (!mechanics.size) return `${actions} OR ${enemyHits}`;
  const ids = [...mechanics].join(',');
  return `${actions} OR ${enemyHits} OR (ability.id IN (${ids}) AND type IN ('damage',${auras}))`;
}

function makeFight(fight, actors, abilities, mechanics) {
  const friends = new Set(fight.friendlyPlayers ?? []);
  const enemies = new Set((fight.enemyNPCs ?? []).map(npc => npc.id));
  const nextActorId = Math.max(0, ...actors.keys()) + 1;
  const outputActors = new Map();
  const instanceIds = new Map();
  const events = [];
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

  return {
    add(event) {
      const t = event.timestamp - fight.startTime;
      if (!Number.isFinite(t) || t < 0 || t > duration) return;
      capturePosition(event, t);
      captureEvent(event, t);
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
      };
    },
  };
}

async function captureFight(client, code, fight, actors, abilities, mechanics) {
  const track = makeFight(fight, actors, abilities, mechanics);
  const filter = makeFilter(mechanics);
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

async function main() {
  const code = readInput(process.argv[2]);
  const args = process.argv.slice(3);
  const publicSample = args.includes('--public-sample');
  const requested = args.filter(value => value !== '--public-sample').map(value => Number(value));
  if (requested.some(id => !Number.isSafeInteger(id) || id <= 0)) throw new Error('战斗编号必须是正整数');
  if (publicSample && requested.length !== 1) throw new Error('公开样例需指定一场战斗');
  const settings = await localSettings();
  const serverDir = process.env.WCL_SERVER_DIR || settings.serverDir;
  const owner = Number(process.env.WCL_REPORT_OWNER_ID || settings.reportOwnerId);
  if (!serverDir) throw new Error('请设置 WCL_SERVER_DIR，指向本机的 WCL 授权服务目录');
  if (!publicSample && (!Number.isSafeInteger(owner) || owner <= 0)) {
    throw new Error('请设置 WCL_REPORT_OWNER_ID，指定允许同步的 WCL 上传者编号');
  }
  const server = path.resolve(serverDir);
  const { createPrivateClient } = require(path.join(server, 'private-wcl.js'));
  const client = createPrivateClient({
    getToken: async () => JSON.parse(await fs.readFile(path.join(server, 'oauth-tokens.local.json'), 'utf8')),
  });
  const response = await client.graphql(META_QUERY, { code });
  const report = response.reportData?.report;
  if (report?.zone?.id !== RAID_ZONE || (publicSample ? report.visibility !== 'public' : report.owner?.id !== owner)) {
    throw new Error('仅允许同步指定上传者的当前团本日志');
  }
  const sourceFights = (report.fights ?? [])
    .filter(fight => fight.encounterID === ENCOUNTER && fight.difficulty === MYTHIC);
  const selected = requested.length ? sourceFights.filter(fight => requested.includes(fight.id)) : sourceFights;
  if (!selected.length || requested.some(id => !selected.some(fight => fight.id === id))) {
    throw new Error('所选战斗中没有对应的史诗乌拉特克记录');
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
      const recorded = await captureFight(client, code, fight, actors, abilities, mechanics);
      fights.push(recorded);
      const samples = recorded.actors.reduce((sum, actor) => sum + actor.points.length, 0);
      console.log(`#${fight.id}：${samples} 个位置采样，${recorded.events.length} 条事件`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(3, selected.length) }, worker));
  fights.sort((a, b) => a.id - b.id);
  const localFile = path.join(PRIVATE_DATA, `${code}${requested.length ? '-' + fights.map(f => f.id).join('-') : ''}.json`);
  await writeLocal(localFile, {
    version: 1,
    encounterID: ENCOUNTER,
    code,
    title: report.title,
    startTime: report.startTime,
    visibility: report.visibility,
    ...(publicSample ? { sample: true } : {}),
    fights,
  });
  console.log(`本地导出 ${fights.length} 场，WCL 可见性：${report.visibility || '未知'}。文件：${localFile}`);
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
