(() => {
  const byId = id => document.getElementById(id);
  const assetUrl = path => globalThis.M8AssetUrls?.[path] || path;
  const { at, normalize, sample, mapRole, sampleMapUnit, phaseAt, isDead, firstFrame, timeLabel } = globalThis.M8Model;
  const p1Motion = globalThis.M8P1Motion;
  const { definitions, classify } = globalThis.M8Mechanics;
  const category = new Map(definitions.map(item => [item.key, item]));
  const fallback = { label: '其他事件', color: '#889d86' };
  const phaseLabels = new Map([[1, 'P1'], [2, 'P2'], [3, '过场'], [4, 'P3']]);
  const phaseLabel = phase => phaseLabels.get(Number(phase?.id)) || '阶段 ' + (phase?.id ?? '未知');
  const headlineBosses = [257758, 267460];
  const actorLabels = new Map([[257758, '乌拉特克'], [268029, '乌拉特克'],
    [259555, '实体尾巴'], [267418, '虚影尾巴'], [263942, '疫鳞畸体']]);
  const npcColors = { boss: '#ffe090', tail: '#efc67f', 'tail-echo': '#bba8ef', 'large-add': '#ff9f7b' };
  const roomSides = [['west', '西侧'], ['east', '东侧']];
  const priorityReadings = new Set([1290779, 1301117, 1302950, 1305650, 1305775, 1310764]);
  const p3Markers = new Set([1288879, 1312967, 1316356]);
  const rows = byId('rows');
  const timeline = byId('timeline');
  const canvas = byId('map');
  const ctx = canvas.getContext('2d');
  let mapWidth = canvas.width;
  let mapHeight = canvas.height;
  let p1Renderer;
  let p1Original;
  let p1OriginalStarted = false;
  function loadStageArt(path) {
    const image = new Image();
    image.onload = () => paint();
    image.src = assetUrl(path);
    return image;
  }
  const stageArt = loadStageArt('assets/arena.webp');
  const fullStageArt = loadStageArt('assets/p1-platform.jpg');
  const colors = {
    DeathKnight: '#f17486', DemonHunter: '#d690ee', Druid: '#f6a85d', Evoker: '#65d6bc',
    Hunter: '#bce188', Mage: '#7bdcef', Monk: '#80e9b7', Paladin: '#f4a4cc',
    Priest: '#f0f0ee', Rogue: '#f1dd87', Shaman: '#7bbaff', Warlock: '#bca6f5', Warrior: '#dbb68f'
  };
  const images = {
    eggs: 'egg', egg: 'egg', carry: 'egg', fangs: 'fang', fang: 'fang',
    interrupt: 'kick', adds: 'kick', soak: 'soak', wave: 'movement', movement: 'movement'
  };
  const webpClasses = new Set(['demonhunter', 'druid', 'hunter', 'mage', 'rogue', 'warlock']);
  const classIcons = new Map(Object.keys(colors).map(subType => {
    const key = subType.toLowerCase();
    return [key, 'assets/class-' + key + (webpClasses.has(key) ? '.webp' : '.jpg')];
  }));
  const mapIcons = new Map();
  for (const [key, path] of [...classIcons, ['boss', 'assets/boss.webp'], ['egg', 'assets/egg.webp'],
    ['tail', 'assets/encounter-tail.webp'], ['tail-echo', 'assets/encounter-tail.webp'],
    ['large-add', 'assets/encounter-add.webp']]) {
    const marker = new Image();
    marker.onload = () => paint();
    marker.src = assetUrl(path);
    mapIcons.set(key, marker);
  }
  const state = {
    report: null, fight: null, time: 0, playing: false, view: 'digest', limit: 90,
    zoom: 1, panX: 0, panY: 0, follow: true, feedTime: 0,
    layers: { egg: true, fang: true, wave: true, room: true, bite: true, death: true }
  };
  let catalog = [];
  let highlighted = null;
  let eventButtons = [];
  let lastHighlight = -1;
  let animation = 0;
  let visibleActors = [];
  let request = 0;
  let nowAt = -1;
  let feedAt = -1;
  let castKey = null;
  let countdown = null;
  let carrierKey = null;
  let fangKey = null;
  let roomKey = null;
  let roomFrame = null;
  let requestedLocation = null;
  let lastMapKey = null;
  let mapDrag = null;
  let suppressMapClickUntil = 0;
  let tools = null;
  let activeDeath = null;
  let debuffKey = null;
  const embeddedReports = new Map();

  function element(tag, className, content) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (content != null) node.textContent = content;
    return node;
  }

  function image(key, path = 'assets/' + key + '.webp') {
    const icon = element('img');
    icon.src = assetUrl(path);
    icon.alt = '';
    icon.width = icon.height = 32;
    return icon;
  }

  function portrait(actor) {
    const key = String(actor?.subType || '').toLowerCase();
    return image('melee', classIcons.get(key));
  }

  function message(text = '') {
    byId('message').textContent = text;
    byId('message').hidden = !text;
  }

  function actorName(id) {
    const actor = state.fight?.actorById.get(id);
    if (actor?.type === 'NPC' && Number(actor.gameID) === 0) return '';
    return actor?.type === 'NPC' && actorLabels.has(Number(actor.gameID)) ?
      actorLabels.get(Number(actor.gameID)) : actor?.name || '';
  }

  function eventName(event) {
    if (event.spell === 'Melee') return '近战攻击';
    return event.spell || category.get(event.kind)?.label || fallback.label;
  }

  function describe(event) {
    if (event.detail) return event.detail;
    const source = actorName(event.source);
    const target = actorName(event.target);
    if (event.type === 'death') return target || '未知成员';
    if (event.type === 'interrupt') return [source, target].filter(Boolean).join(' · 打断 ');
    if (event.recipientIds?.length > 1) {
      const names = event.recipientIds.map(actorName).filter(Boolean);
      return '同刻记录 · ' + event.recipientIds.length + ' 人 · ' + names.slice(0, 3).join('、') +
        (names.length > 3 ? ' …' : '');
    }
    const action = {
      begincast: '开始施法', cast: '施放', damage: '受到伤害', applybuff: '获得增益',
      removebuff: '移除增益', applydebuff: '获得减益', removedebuff: '移除减益',
      applybuffstack: '增益叠层', removebuffstack: '增益降层',
      applydebuffstack: '减益叠层', removedebuffstack: '减益降层',
      resurrect: '复活', summon: '召唤'
    }[event.type];
    return [
      source && target && source !== target ? source + ' → ' + target : (target || source),
      action,
      Number.isFinite(event.stack) && event.stack > 0 ? event.stack + ' 层' : '',
      Number.isFinite(event.amount) && event.amount > 0 ? event.amount.toLocaleString('zh-CN') : ''
    ].filter(Boolean).join(' · ');
  }

  function focusMember(id) {
    if (state.fight?.actorById.get(id)?.type !== 'Player') return;
    byId('focus').value = String(id);
    nowAt = -1;
    updateNow();
    paint();
  }

  function goEvent(event) {
    if (!event.recipientIds || event.recipientIds.length < 2) focusMember(event.type === 'interrupt' ? event.source : event.target);
    jump(event.t - (event.type === 'death' ? 10000 : 3000));
    if (event.type === 'death') {
      activeDeath = event;
      updateDeathNav();
    }
  }

  function groupEvents(entries) {
    const result = [];
    const recent = new Map();
    for (const event of entries) {
      if (!['damage', 'applydebuff'].includes(event.type) || event.kind === 'egg' ||
          !event.spellID || state.fight.actorById.get(event.target)?.type !== 'Player') {
        result.push(event);
        continue;
      }
      const key = [event.type, event.spellID, event.source].join(':');
      const group = recent.get(key);
      if (group && event.t - group.t <= 100 && !group.recipientIds.includes(event.target)) {
        group.recipientIds.push(event.target);
      } else {
        const next = { ...event, recipientIds: [event.target] };
        recent.set(key, next);
        result.push(next);
      }
    }
    return result;
  }

  function renderRows(reset = true) {
    if (reset) rows.scrollTop = 0;
    const scroll = rows.scrollTop;
    const { fight, view } = state;
    const query = byId('search').value.trim().toLocaleLowerCase();
    const match = text => text.toLocaleLowerCase().includes(query);
    eventButtons = [];
    highlighted = null;
    lastHighlight = -1;
    byId('kind-label').hidden = view === 'players';
    byId('feed-controls').hidden = view === 'players';
    byId('group-label').hidden = view !== 'events';

    let all = [];
    if (fight) {
      if (view === 'players') all = fight.players.filter(actor => match(actor.name || ''));
      else {
        const kind = byId('kind').value;
        const center = state.follow ? state.time : state.feedTime;
        const windowed = byId('nearby').checked;
        const source = view === 'digest' ? fight.digest : fight.displayEvents;
        const low = windowed ? at(source, center - 20000, event => event.t) + 1 : 0;
        const high = windowed ? at(source, center + 20000, event => event.t) + 1 : source.length;
        all = source.slice(low, high).filter(event => (!kind || event.kind === kind) &&
          match([eventName(event), actorName(event.source), actorName(event.target), event.detail].join(' ')));
      }
    }
    const fragment = document.createDocumentFragment();
    const total = all.length;
    if (view === 'events' && byId('group-events').checked) all = groupEvents(all);
    const current = view !== 'players' && state.follow ? at(all, state.time, item => item.t) : 0;
    const offset = current >= state.limit ? Math.max(0, current - Math.floor(state.limit / 2)) : 0;
    for (const item of all.slice(offset, offset + state.limit)) {
      const player = view === 'players';
      const row = element('button', 'event-row' + (player ? ' player-row' : ''));
      row.type = 'button';
      const copy = element('span', 'event-copy');
      if (player) {
        row.append(portrait(item));
        copy.append(element('strong', '', item.name), element('small', '',
          (fight.deathsByActor.get(item.id) || []).filter(entry => entry.type === 'death').length +
          ' 次死亡 · ' + item.points.length + ' 个位置采样'));
        row.addEventListener('click', () => focusMember(item.id));
      } else {
        const kind = category.get(item.kind) || fallback;
        const actor = item.type === 'death' && fight.actorById.get(item.target);
        row.append(element('time', '', timeLabel(item.t)), actor ? portrait(actor) : image(item.icon || images[item.kind] || 'boss'));
        const title = element('strong', '', eventName(item));
        title.style.color = kind.color;
        copy.append(title, element('small', '', describe(item)));
        row.addEventListener('click', () => goEvent(item));
        eventButtons.push({ row, t: item.t });
      }
      row.append(copy);
      fragment.append(row);
    }
    if (!all.length) fragment.append(element('p', 'empty', !fight ?
      '导入 M8 复盘 JSON，即可查看事件和成员。' : '当前范围没有匹配记录。'));
    rows.replaceChildren(fragment);
    rows.scrollTop = scroll;
    byId('row-count').textContent = view === 'players' ? all.length + ' 人' :
      (all.length === total ? total + ' 条' : all.length + ' 组 / ' + total + ' 条');
    byId('more').hidden = all.length <= state.limit;
  }

  function renderDeaths() {
    const fragment = document.createDocumentFragment();
    for (const event of state.fight.deaths) {
      const actor = state.fight.actorById.get(event.target);
      const button = element('button', 'event-row death-row');
      const copy = element('span', 'event-copy');
      button.type = 'button';
      button.title = '回看死亡前 10 秒';
      copy.append(element('strong', '', actor?.name || '未知成员'),
        element('small', '', event.spell || '未注明致死技能'));
      button.append(element('time', '', timeLabel(event.t)), portrait(actor), copy);
      button.addEventListener('click', () => goEvent(event));
      fragment.append(button);
    }
    if (!state.fight.deaths.length) fragment.append(element('p', 'empty', '本把无成员死亡记录。'));
    byId('death-list').replaceChildren(fragment);
    byId('death-count').textContent = state.fight.deaths.length + ' 次';
  }

  function setFollow(on) {
    state.follow = on;
    state.feedTime = state.time;
    byId('follow').setAttribute('aria-pressed', String(on));
    byId('follow').textContent = on ? '跟随回放' : '恢复跟随';
    if (on) {
      feedAt = -1;
      lastHighlight = -1;
      refresh();
    }
  }

  function updateNow() {
    const { fight, time } = state;
    const stamp = Math.floor(time / 150);
    if (stamp === nowAt) return;
    nowAt = stamp;
    const timeText = timeLabel(time);
    byId('now-time').textContent = timeText;
    byId('map-hud-time').textContent = timeText;
    byId('map-hud-phase').textContent = phaseLabel(phaseAt(fight, time));
    const alive = fight.players.filter(actor => !isDead(fight, actor, time));
    byId('alive-count').textContent = alive.length + ' / ' + fight.players.length;
    const frame = globalThis.M8Evidence.at(fight.evidence, time);
    byId('interrupt-count').textContent = at(fight.evidence.interrupts, time, event => event.t) + 1;
    const carrying = [...frame.eggs.small, ...frame.eggs.large];
    byId('hold-count').textContent = carrying.length;
    byId('egg-status').hidden = false;
    byId('small-eggs').textContent = frame.eggs.small.length;
    byId('large-eggs').textContent = frame.eggs.large.length;
    const anchors = frame.fieldEggs.length;
    const ground = byId('ground-eggs');
    ground.textContent = anchors || '—';
    updateFangs(frame.activeFangs, time);
    updateRooms(fight.rooms, time);
    const nextCarrierKey = carrying.map(item => [item.actorId, item.kind, item.endReason,
      item.endReason === 'removed' ? Math.ceil((item.end - time) / 1000) : null].join(':')).join(',');
    if (nextCarrierKey !== carrierKey) {
      carrierKey = nextCarrierKey;
      const list = byId('carrier-list');
      list.hidden = !carrying.length;
      list.replaceChildren(...carrying.map(item => {
        const label = item.kind === 'large' ? '大蛋' : '小蛋';
        const chip = element('button', item.kind === 'large' ? 'large-egg' : '', actorName(item.actorId));
        chip.type = 'button';
        chip.title = label + (item.endReason === 'removed' ? ' · 日志移除剩 ' + Math.ceil((item.end - time) / 1000) + ' 秒' : '');
        chip.prepend(image('egg'));
        chip.addEventListener('click', () => focusMember(item.actorId));
        return chip;
      }));
    }
    const carriers = byId('carriers');
    carriers.hidden = !carrying.length;
    if (carrying.length) {
      carriers.textContent = carrying.length + ' 个携蛋记录';
      carriers.title = carrying.map(item => actorName(item.actorId)).join('、');
    }
    const heart = byId('heart-live');
    heart.hidden = !frame.heart;
    if (frame.heart) heart.textContent = frame.heart.endReason === 'removed' ?
      '易伤 · ' + Math.ceil((frame.heart.end - time) / 1000) + ' 秒' : '易伤 · 结束未记录';
    updateDebuffs(frame);
    const next = fight.bossCasts[at(fight.bossCasts, time, event => event.t) + 1];
    if (next !== castKey) {
      castKey = next;
      const cue = byId('next-cast');
      if (!next) {
        cue.replaceChildren(element('p', '', '本把没有后续首领施法记录'));
        countdown = null;
      } else {
        const button = element('button');
        button.type = 'button';
        const label = element('span', 'cast-label');
        label.append(element('small', '', (next.type === 'begincast' ? '下一次读条' : '下一次施放') + ' · ' + actorName(next.source)),
          element('strong', '', eventName(next)));
        countdown = element('strong', 'cast-countdown');
        button.append(image(images[next.kind] || 'boss'), label, countdown);
        button.addEventListener('click', () => goEvent(next));
        cue.replaceChildren(button);
      }
    }
    if (countdown && next) countdown.textContent = Math.ceil((next.t - time) / 1000) + ' 秒';
    const reading = fight.castWindows.findLast(window => window.start <= time && time < window.end);
    const mapCast = byId('map-cast');
    mapCast.hidden = !reading;
    if (reading) {
      byId('map-cast-name').textContent = eventName(reading.event);
      const remaining = reading.end - time;
      byId('map-cast-time').textContent = (remaining / 1000).toFixed(1) + ' 秒';
      byId('map-cast-fill').style.width = (remaining / (reading.end - reading.start) * 100) + '%';
    }
    const bossRows = [];
    for (const id of byId('npc-hp').checked ? headlineBosses : []) {
      const actor = fight.hudBosses.get(id);
      const position = actor && sample(actor.points, time);
      if (!actor || id === 267460 && !position && !frame.heart) continue;
      const row = element('div', 'boss-hp');
      const hp = Number.isFinite(position?.hp) ? Math.max(0, Math.min(100, position.hp)) : null;
      const track = element('div', 'hp-track');
      const fill = element('i');
      fill.style.width = (hp || 0) + '%';
      track.append(fill);
      row.append(element('span', '', actorName(actor.id)), element('span', '', hp == null ? '—' : Math.round(hp) + '%'), track);
      bossRows.push(row);
    }
    byId('map-bosses').replaceChildren(...bossRows);
  }

  function updateFangs(fangs, time) {
    const active = fangs.map(fang => ({ fang,
      left: fang.endReason === 'removed' ? Math.ceil((fang.end - time) / 1000) : null }));
    const key = active.map(({ fang, left }) => fang.actorId + ':' + fang.start + ':' + left).join(',');
    if (key === fangKey) return;
    fangKey = key;
    const list = byId('fang-status');
    list.hidden = !active.length;
    const chips = active.map(({ fang, left }) => {
      const button = element('button', '', actorName(fang.actorId));
      button.type = 'button';
      button.title = fang.spell || '攫取毒牙';
      if (left != null) button.append(element('small', '', left + ' 秒'));
      button.addEventListener('click', () => focusMember(fang.actorId));
      return button;
    });
    list.replaceChildren(element('strong', '', '毒牙目标'), ...chips);
  }

  function updateRooms(rooms, time) {
    const current = globalThis.M8RoomEvidence.at(rooms, time);
    roomFrame = current;
    const panel = byId('room-status');
    byId('map-stage').dataset.rooms = String(current.active);
    panel.hidden = !current.active;
    if (!current.active) return;
    const counts = roomSides.map(([side]) => [...current.observed.values()].filter(where => where === side).length);
    const key = counts.join(':');
    if (key === roomKey) return;
    roomKey = key;
    panel.replaceChildren(...roomSides.map(([side, label], index) => {
      const group = current.sides[side];
      const tile = element('div', 'room-status-side');
      tile.dataset.side = side;
      tile.title = group.memberIds.map(actorName).join('、');
      tile.append(element('strong', '', label + '房间'), element('b', '', counts[index] + ' / ' + group.memberIds.length),
        element('small', '', '当前位置 / 分房成员'));
      return tile;
    }));
  }

  function updateDebuffs(frame) {
    const panel = byId('map-debuffs');
    panel.hidden = !byId('show-debuffs').checked;
    if (panel.hidden) return;
    const focus = Number(byId('focus').value);
    const active = (frame.debuffs || frame.activeFangs || [])
      .filter(item => !focus || item.actorId === focus);
    const items = active.slice(0, 4);
    const key = items.map(item => [item.spellID, item.actorId, item.start].join(':')).join(',') + active.length;
    if (key === debuffKey) return;
    debuffKey = key;
    const title = element('strong', '', '机制减益 · ' + active.length);
    const lines = items.map(item => element('span', '', actorName(item.actorId) + ' · ' + (item.spell || '机制减益')));
    panel.replaceChildren(title, ...lines);
  }

  function renderTimeline() {
    globalThis.M8Timeline.render(timeline, state.fight, definitions, {
      jump, goEvent, eventName, phaseLabel,
      toggleLayer(key, visible) {
        state.layers[key] = visible;
        paint();
      }
    });
  }

  function castWindows(events, bosses) {
    const pending = new Map();
    const windows = [];
    for (const event of events) {
      if (event.type === 'interrupt') {
        pending.delete(event.target);
        continue;
      }
      if (!bosses.has(event.source) || event.spellID <= 1) continue;
      if (event.type === 'begincast') {
        pending.set(event.source, event);
      } else if (event.type === 'cast') {
        const start = pending.get(event.source);
        if (start?.spellID !== event.spellID) continue;
        pending.delete(event.source);
        if (event.t > start.t && event.t - start.t <= 15000) windows.push({ start: start.t, end: event.t, event });
      }
    }
    return windows.sort((a, b) => a.start - b.start);
  }

  function fightDigest(fight) {
    const { eggs, hearts, soaks, interrupts, fangs } = fight.evidence;
    const moments = [...fight.deaths, ...interrupts.filter(event => event.spellID !== 1310764 ||
      Number(phaseAt(fight, event.t)?.id) !== 4).map(event => ({ ...event, kind: 'interrupt' }))];
    for (const phase of fight.phaseTransitions.slice(1)) {
      moments.push({ t: phase.t, kind: 'phase', spell: '进入' + phaseLabel(phase), detail: 'WCL 阶段切换' });
    }
    for (const egg of eggs) {
      const detail = [actorName(egg.actorId), '持有 ' + ((egg.end - egg.start) / 1000).toFixed(1) + ' 秒'];
      if (egg.endReason === 'death') detail.push('死亡');
      if (egg.endReason === 'fight-end') detail.push('结束未记录');
      moments.push({ t: egg.start, target: egg.actorId, kind: 'egg',
        spell: egg.kind === 'large' ? '开始搬大蛋' : '开始搬小蛋', detail: detail.join(' · ') });
    }
    for (const window of hearts) {
      moments.push({ t: window.start, kind: 'phase', spell: '烈毒之心 · 易伤',
        detail: window.endReason === 'removed' ? '易伤 ' + ((window.end - window.start) / 1000).toFixed(1) + ' 秒' : '结束未记录' });
    }
    for (const soak of soaks) {
      const names = soak.participants.map(actorName).filter(Boolean);
      moments.push({ ...soak.event, kind: 'soak', spell: '幽魂盘卷 · 分摊',
        detail: names.length ? names.length + ' 人有参与记录 · ' + names.join('、') : '已记录施放' });
    }
    for (const group of groupEvents(fangs.map(fang => ({ ...fang.startEvent, kind: 'fang' })))) {
      moments.push({ ...group, spell: '攫取毒牙 · 点名',
        detail: (group.recipientIds || [group.target]).map(actorName).filter(Boolean).join('、') });
    }
    for (const event of fight.displayEvents) {
      if (event.type === 'cast' && Number(phaseAt(fight, event.t)?.id) !== 4 &&
          [1304012, 1315541, 1300751, 1298367, 1296301, 1298369].includes(event.spellID)) {
        moments.push(event);
      } else if (event.kind === 'wave' && event.type === 'damage' && fight.actorById.get(event.target)?.type === 'Player') {
        moments.push({ ...event, spell: '腐蚀浪潮 · 命中',
          detail: [actorName(event.target), event.amount > 0 ? event.amount.toLocaleString('zh-CN') + ' 伤害' : '命中记录'].join(' · ') });
      }
    }
    if (fight.rooms.start != null) {
      const sizes = roomSides.map(([side, label]) => label + ' ' + fight.rooms.sides[side].memberIds.length + ' 人').join(' · ');
      moments.push({ t: fight.rooms.start, kind: 'phase', spell: 'P2 分房', detail: sizes + ' · 站位判定' });
      if (fight.rooms.end != null) moments.push({ t: fight.rooms.end, kind: 'phase', spell: '队伍返回平台', detail: '站位判定' });
    }
    for (const { t, label, actors, evidence, icon, key } of fight.p3) {
      if (key === 'venomous-heart') continue;
      const kind = icon === 'movement' ? 'wave' : icon === 'kick' ? 'interrupt' : icon === 'tank' ? 'boss' : icon;
      moments.push({ t, kind, icon, spell: label, target: actors.length === 1 ? actors[0] : null, recipientIds: actors,
        detail: [evidence, actors.map(actorName).filter(Boolean).join('、')].filter(Boolean).join(' · ') });
    }
    return moments.sort((a, b) => a.t - b.t);
  }

  function loadFight(id, seek = null) {
    const fight = state.report?.fights.find(item => item.id === Number(id));
    if (!fight) return;
    const changed = state.fight !== fight;
    stop();
    if (changed) {
      tools?.reset();
      p1Original?.clear();
    }
    state.fight = fight;
    state.limit = 90;
    state.zoom = 1;
    state.panX = state.panY = 0;
    lastMapKey = null;
    activeDeath = null;
    debuffKey = null;
    state.feedTime = 0;
    nowAt = feedAt = -1;
    castKey = carrierKey = fangKey = roomKey = roomFrame = null;
    fight.bosses = fight.actors.filter(actor => actor.subType === 'Boss');
    fight.mapUnits ||= fight.actors.map(actor => ({ actor, role: mapRole(actor) })).filter(item => item.role);
    fight.p1Motion ||= p1Motion.build(fight);
    fight.hudBosses = new Map(headlineBosses.map(id => [id, fight.bosses.filter(actor => Number(actor.gameID) === id)
      .sort((a, b) => b.points.length - a.points.length)[0]]));
    const bosses = new Set(fight.bosses.map(actor => actor.id));
    const bossSpells = new Set(fight.events.filter(event => bosses.has(event.source) && event.type === 'cast')
      .map(event => event.spellID).filter(Number.isFinite));
    const tagged = fight.events.map(event => ({ ...event, kind: classify(event, bossSpells) || 'other' }));
    const playerDeaths = new Map(tagged.filter(event => event.type === 'death' &&
      fight.actorById.get(event.target)?.type === 'Player').map(event => [event.t + ':' + event.target, event]));
    fight.deaths = [...playerDeaths.values()];
    fight.displayEvents = tagged.filter(event => {
      if (event.type === 'death') return playerDeaths.get(event.t + ':' + event.target) === event;
      return event.kind !== 'other' || ['cast', 'begincast'].includes(event.type) && bosses.has(event.source);
    });
    fight.evidence ||= globalThis.M8Evidence.build(fight);
    fight.targetCasts = tagged.filter(event => ['cast', 'begincast'].includes(event.type) &&
      fight.actorById.get(event.source)?.type === 'NPC' && fight.actorById.get(event.target)?.type === 'Player');
    fight.bossCasts = tagged.filter(event =>
      (event.type === 'cast' && bosses.has(event.source) && event.spellID > 1 && event.spell !== 'Melee') ||
      (event.type === 'begincast' && priorityReadings.has(event.spellID) &&
        fight.actorById.get(event.source)?.type === 'NPC'));
    fight.castWindows = castWindows(tagged, bosses);
    fight.rooms ||= globalThis.M8RoomEvidence.build(fight);
    fight.p3 ||= globalThis.M8P3Evidence.build(fight);
    fight.digest = fightDigest(fight);
    byId('fight').value = String(fight.id);
    const index = state.report.fights.indexOf(fight);
    byId('fight-prev').disabled = index <= 0;
    byId('fight-next').disabled = index >= state.report.fights.length - 1;
    byId('map-hud').hidden = false;
    byId('focus').replaceChildren(new Option('全部成员', ''), ...fight.players.map(actor => new Option(actor.name, actor.id)));
    byId('seek').max = fight.duration;
    for (const control of ['play', 'back', 'forward', 'seek', 'speed', 'focus', 'zoom-in', 'zoom-out', 'zoom-reset', 'copy-moment']) byId(control).disabled = false;
    const source = byId('source');
    source.hidden = !/^[A-Za-z0-9]{16}$/.test(state.report.code || '');
    if (!source.hidden) source.href = 'https://cn.warcraftlogs.com/reports/' + state.report.code + '?fight=' + fight.id;
    renderFightStrip(index);
    state.time = seek == null ? firstFrame(fight) : Math.min(fight.duration, Math.max(0, Number(seek) || 0));
    state.feedTime = state.time;
    renderRows();
    renderDeaths();
    renderTimeline();
    globalThis.M8Analysis.render(byId('analysis'), fight, fight.evidence, {
      jump, goEvent, focusMember, actorName, eventName, timeLabel, portrait, image, phaseLabel
    });
    jump(state.time);
  }

  function renderFightStrip(index) {
    const strip = byId('fight-strip');
    strip.hidden = state.report.fights.length < 2;
    if (strip.hidden) return;
    const buttons = state.report.fights.map((fight, position) => {
      const b = element('button', fight.kill ? 'kill' : '', position + 1);
      b.type = 'button';
      b.title = '第 ' + (position + 1) + ' 把 · #' + fight.id + ' · ' + timeLabel(fight.duration) +
        ' · ' + phaseLabel(fight.phaseTransitions.at(-1));
      b.setAttribute('aria-label', b.title);
      if (position === index) b.setAttribute('aria-current', 'true');
      b.addEventListener('click', () => loadFight(fight.id));
      return b;
    });
    strip.replaceChildren(...buttons);
    const selected = buttons[index];
    strip.scrollLeft = Math.max(0, selected.offsetLeft - strip.offsetLeft - Math.max(0, strip.clientWidth - 52));
  }

  function loadReport(raw, selected, seek) {
    const report = normalize(raw);
    report.geometry = globalThis.M8MapGeometry.prepare(report);
    state.report = report;
    state.limit = 90;
    const date = Number.isFinite(report.startTime)
      ? new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', timeZone: 'Asia/Shanghai' }).format(report.startTime)
      : '';
    byId('report-title').textContent = [date, report.sample ? '公开击杀样例' : report.title || '乌拉特克',
      report.fights.length + ' 把'].filter(Boolean).join(' · ');
    byId('fight').replaceChildren(...report.fights.map((fight, index) =>
      new Option('第 ' + (index + 1) + ' 把 · #' + fight.id + ' · ' + timeLabel(fight.duration) +
        (fight.kill ? ' · 击杀' : ''), fight.id)));
    byId('fight').disabled = false;
    const preferred = selected === 'last' ? report.fights.reduce((last, fight) => fight.id > last.id ? fight : last)
      : report.fights.find(fight => fight.id === Number(selected)) || report.fights.findLast(fight => fight.kill) ||
      report.fights.reduce((longest, fight) => fight.duration > longest.duration ? fight : longest);
    loadFight(preferred.id, seek);
  }

  function requireRequestedFight(raw, fight) {
    const id = Number(fight);
    if (Number.isSafeInteger(id) && id > 0 && !raw?.fights?.some(entry => entry.id === id)) {
      throw new Error('这份复盘数据不包含该战斗编号。');
    }
  }

  function parseReportLocation(value) {
    const link = new URL(value);
    const code = link.pathname.match(/^\/reports\/([A-Za-z0-9]{16})\/?$/)?.[1];
    if (!code || !/^https?:$/.test(link.protocol) ||
        !/^(?:(?:cn|tw|www)\.)?warcraftlogs\.com$/i.test(link.hostname)) {
      throw Error('请填写有效的 Warcraft Logs 报告链接。');
    }
    const oldParams = new URLSearchParams(link.hash.slice(1));
    const param = key => link.searchParams.get(key) ?? oldParams.get(key);
    const fightParam = param('fight');
    const fight = Number(fightParam);
    const time = Number(param('position'));
    return { code, fight: fightParam === 'last' ? 'last' : Number.isSafeInteger(fight) && fight > 0 ? fight : null,
      time: Number.isFinite(time) && time > 0 ? time : 0 };
  }

  function openReportLocation(location) {
    if (location.fight == null) {
      jump(location.time);
      return;
    }
    const id = location.fight === 'last' ? Math.max(...state.report.fights.map(fight => fight.id)) : location.fight;
    if (!state.report.fights.some(fight => fight.id === id)) {
      message('这份复盘数据不包含该战斗编号。');
      return;
    }
    loadFight(id, location.time);
  }

  function paint() {
    const { fight, time } = state;
    const width = mapWidth;
    const height = mapHeight;
    const focus = Number(byId('focus').value);
    const phase = fight ? phaseAt(fight, time) : null;
    const tracked = fight ? fight.mapUnits.map(({ actor, role }) => ({ actor, role,
      point: sampleMapUnit(actor, role, time) })) : [];
    const current = tracked.filter(item => item.point);
    const maps = new Map();
    for (const { actor, point } of current) if (actor.type === 'Player') maps.set(point.map, (maps.get(point.map) || 0) + 1);
    const focused = current.find(item => item.actor.id === focus);
    const map = focused?.point.map ?? [...maps].sort((a, b) => b[1] - a[1])[0]?.[0];
    const artEnabled = byId('art').checked;
    const geometry = fight && (globalThis.M8MapGeometry.view(state.report.geometry, phase?.id, map) || fight.bounds.get(map));
    const bounds = !artEnabled && geometry?.raw ? geometry.raw : geometry;
    const showArt = !fight || (artEnabled && (!bounds || bounds.art));
    const show3D = showArt && bounds?.source === 'p1-reference-platform' && byId('show-motion').checked;
    if (show3D && p1Renderer === undefined) {
      const waveImages = ['127.0.0.1', '[::1]', 'localhost'].includes(location.hostname) ? {
        body: assetUrl('assets/original-wave-body.webp'), foam: assetUrl('assets/original-wave-foam.webp'), loaded: paint,
      } : undefined;
      try { p1Renderer = globalThis.M8P1Mesh.createRenderer(document.createElement('canvas'), waveImages); }
      catch (error) { console.warn('P1 3D could not start:', error); p1Renderer = null; }
    }
    if (show3D && !p1OriginalStarted && /^https?:$/.test(location.protocol)) {
      p1OriginalStarted = true;
      globalThis.M8P1Original?.load(assetUrl('assets/original-p1-models.json')).then(renderer => {
        p1Original = renderer;
        if (renderer) paint();
      }).catch(error => console.warn('P1 original model could not load:', error));
    }
    const motion = show3D && p1Renderer;
    const mapKey = bounds ? [phase?.id, map].join(':') : null;
    if (mapKey && lastMapKey && mapKey !== lastMapKey) state.panX = state.panY = 0;
    if (mapKey) lastMapKey = mapKey;
    const padding = bounds?.art && artEnabled ? 8 : 30;
    const extraHeight = motion ? p1Original ? 2050 : 800 : 0;
    const sceneY = motion ? height * (p1Original ? .053 : .027) : 0;
    const scale = bounds ? Math.min((width - padding) / bounds.spanX, (height - padding) / (bounds.spanY + extraHeight)) * state.zoom : 1;
    const project = (x, y) => {
      const [dx, dy] = globalThis.M8MapGeometry.mapOffset(bounds, x, y);
      return [width / 2 + state.panX + dx * scale, height / 2 + sceneY + state.panY + dy * scale];
    };
    ctx.fillStyle = showArt ? '#101b17' : '#0c1421';
    ctx.fillRect(0, 0, width, height);
    const art = showArt ? bounds?.art : null;
    const stageImage = art?.nativeSize ? fullStageArt : stageArt;
    if (showArt && stageImage.complete && stageImage.naturalWidth) {
      const [artWidth, artHeight] = art?.nativeSize?.map(size => size * scale) ??
        Array(2).fill(art ? art.span * scale : Math.max(width, height));
      const [artX, artY] = art ? project(art.cx, art.cy) : [width / 2, height / 2];
      ctx.globalAlpha = fight ? .83 : .7;
      if (motion) ctx.drawImage(stageImage, 135, 105, 370, 920, 0, 0, width, height);
      ctx.drawImage(stageImage, artX - artWidth / 2, artY - artHeight / 2, artWidth, artHeight);
      ctx.globalAlpha = 1;
      const shade = ctx.createRadialGradient(width * .5, height * .45, height * .12,
        width * .5, height * .47, height * .7);
      shade.addColorStop(0, '#10172500');
      shade.addColorStop(1, '#0a101669');
      ctx.fillStyle = shade;
      ctx.fillRect(0, 0, width, height);
    }
    if (!fight) return;
    if (!showArt) {
      ctx.strokeStyle = '#7589ac2e';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = 0; x <= width; x += 32) { ctx.moveTo(x, 0); ctx.lineTo(x, height); }
      for (let y = 0; y <= height; y += 32) { ctx.moveTo(0, y); ctx.lineTo(width, y); }
      ctx.stroke();
    }

    visibleActors = [];
    const addGap = tracked.some(({ actor, role, point }) => role === 'large-add' && !point &&
      actor.points[0]?.[0] < time && time <= actor.points.at(-1)?.[0] && !isDead(fight, actor, time));
    const mapNote = !bounds ? '此刻没有可用的站位采样' : !showArt ? 'WCL 原始坐标' :
      bounds.source === 'p1-reference-platform' ? 'P1 场地比例参照 Hexweaver · WCL 坐标未改' :
        '场地锚点配准 · 尾巴虚线连到 WCL 落点';
    if (!bounds) { byId('map-note').textContent = mapNote; return; }
    const renderedMotion = motion ? paintP1Motion(fight, time, bounds, scale, project) : null;
    const animatedActors = renderedMotion?.actors;
    byId('map-note').textContent = mapNote + (renderedMotion?.original ? ' · 原模型' :
      animatedActors ? ' · 3D' : show3D ? ' · 图标模式' : '') +
      (addGap ? ' · 畸体坐标缺采样' : '');
    const frame = globalThis.M8Evidence.at(fight.evidence, time);
    if (state.layers.room && roomFrame?.active) paintRoomAnchors(roomFrame, map, project);
    if (showArt && byId('show-soaks').checked && bounds.source === 'p1-reference-platform') {
      paintP1Soaks(fight, time, bounds, scale, project);
    }
    const carrying = new Map([...frame.eggs.small, ...frame.eggs.large].map(egg => [egg.actorId, egg]));
    const eggBars = state.layers.egg ? paintEggEvidence(fight.evidence, time, map, project) : [];
    const fangs = state.layers.fang ? frame.activeFangs : [];
    const fangTargets = new Set(fangs.map(item => item.actorId));
    const waves = new Set(state.layers.wave ? frame.activeWaves.map(wave => wave.actorId) : []);
    const p3Targets = Number(phase?.id) === 4 && state.layers.bite ?
      new Set(frame.debuffs.filter(item => p3Markers.has(item.spellID)).map(item => item.actorId)) : new Set();
    if (fangs.length || byId('show-targets').checked) paintTargetLines(fight, fangs, time, map, project);
    if (state.layers.death) paintRecentDeaths(fight, current, time, map, project);
    if (focused) paintTrail(focused.actor, time, map, project);
    const ordered = current.filter(item => item.point.map === map).sort((a, b) =>
      Number(a.actor.id === focus) - Number(b.actor.id === focus));
    for (const { actor, role, point } of ordered) {
      if (animatedActors?.has(actor.id)) continue;
      const npc = role !== 'player';
      const marker = role === 'tail' && showArt ? globalThis.M8MapGeometry.tailWaterMarker(bounds.art, point) : point;
      const [x, y] = project(marker.x, marker.y);
      if (x < 9 || x > width - 9 || y < 9 || y > height - 9) continue;
      const dead = isDead(fight, actor, time);
      if (dead && (npc || !state.layers.death)) continue;
      const selected = actor.id === focus;
      const color = npc ? npcColors[role] : colors[actor.subType] || '#d3eab8';
      ctx.globalAlpha = point.opacity ?? (focus && !selected && !npc ? .34 : 1);
      const radius = (role === 'tail-echo' ? 11 : npc ? 15 : selected ? 12 : 9) * (width < 440 ? .85 : 1);
      if (marker !== point) paintTailAnchor(x, y, project(point.x, point.y));
      ctx.beginPath();
      ctx.arc(x, y, radius + 2, 0, Math.PI * 2);
      ctx.fillStyle = '#090f1be8';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fillStyle = dead ? '#5e343a' : npc ? '#392c22' : '#152438';
      ctx.fill();
      ctx.lineWidth = selected ? 3 : 2;
      ctx.strokeStyle = dead ? '#f59595' : color;
      if (role === 'tail-echo') ctx.setLineDash([3, 2]);
      ctx.stroke();
      ctx.setLineDash([]);
      if (dead) {
        ctx.beginPath();
        ctx.moveTo(x - 4, y - 4); ctx.lineTo(x + 4, y + 4);
        ctx.moveTo(x + 4, y - 4); ctx.lineTo(x - 4, y + 4);
        ctx.stroke();
      } else if (actor.type === 'Player') {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(x, y, selected ? 4 : 3, 0, Math.PI * 2);
        ctx.fill();
      }
      const icon = mapIcons.get(npc ? role : String(actor.subType || '').toLowerCase());
      if (!dead && icon?.complete && icon.naturalWidth) {
        const iconRadius = radius - 2;
        ctx.save();
        ctx.beginPath();
        ctx.arc(x, y, iconRadius, 0, Math.PI * 2);
        ctx.clip();
        ctx.drawImage(icon, x - iconRadius, y - iconRadius, iconRadius * 2, iconRadius * 2);
        ctx.restore();
      }
      const eggHeld = carrying.get(actor.id);
      if (state.layers.egg && !dead && eggHeld) {
        ctx.globalAlpha = 1;
        ctx.beginPath();
        ctx.arc(x, y, Math.max(15, radius + 4), 0, Math.PI * 2);
        ctx.strokeStyle = eggHeld.kind === 'large' ? '#c3a3ff' : '#ffc56f';
        ctx.lineWidth = 3;
        ctx.stroke();
        const egg = mapIcons.get('egg');
        if (egg.complete && egg.naturalWidth) ctx.drawImage(egg, x - 10, y - 37, 20, 20);
      }
      if (!dead && waves.has(actor.id)) {
        ctx.beginPath();
        ctx.arc(x, y, radius + 5, .15, Math.PI * .88);
        ctx.strokeStyle = '#72e6c3';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      if (!dead && fangTargets.has(actor.id)) {
        ctx.save();
        ctx.setLineDash([3, 2]);
        ctx.beginPath();
        ctx.arc(x, y, radius + 4, 0, Math.PI * 2);
        ctx.strokeStyle = '#f5a3d2';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.restore();
      }
      if (!dead && p3Targets.has(actor.id)) {
        ctx.beginPath();
        ctx.arc(x, y, radius + 5, 0, Math.PI * 2);
        ctx.strokeStyle = '#f5a3ae';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      if (byId('player-hp').checked && actor.type === 'Player' && !dead && Number.isFinite(point.hp)) {
        ctx.fillStyle = '#131c2b';
        ctx.fillRect(x - 10, y + radius + 4, 20, 3);
        ctx.fillStyle = point.hp < 35 ? '#f1a4a8' : '#96ddba';
        ctx.fillRect(x - 10, y + radius + 4, Math.max(0, Math.min(20, point.hp / 5)), 3);
      }
      if (npc || selected || byId('names').checked) {
        const left = x > width - 80;
        const label = npc ? actorName(actor.id) : actor.name;
        ctx.font = 'bold 14px "Microsoft YaHei", sans-serif';
        ctx.textAlign = left ? 'right' : 'left';
        ctx.strokeStyle = '#101a2b';
        ctx.lineWidth = 4;
        ctx.strokeText(label, x + (left ? -13 : 13), y - 9);
        ctx.fillStyle = color;
        ctx.fillText(label, x + (left ? -13 : 13), y - 9);
        ctx.textAlign = 'left';
      }
      ctx.globalAlpha = 1;
      if (actor.type === 'Player') visibleActors.push({ x, y, id: actor.id });
    }
    paintEggShields(eggBars);
    if (state.layers.wave && byId('show-wave-callouts').checked) paintWaveCallouts(fight, time, map, project);
  }

  function paintWaveCallouts(fight, time, map, project) {
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    for (const { actorId, t, progress } of globalThis.M8Evidence.waveCallouts(fight.evidence, time)) {
      const actor = fight.actorById.get(actorId);
      if (!actor) continue;
      const track = actor.points;
      const live = !isDead(fight, actor, time) && sample(track, time);
      const point = live || sample(track, t);
      if (!point || point.map !== map) continue;
      const [x, y] = project(point.x, point.y);
      if (x < 12 || x > mapWidth - 12 || y < 4 || y > mapHeight - 4) continue;
      const rise = reduced ? 0 : 8 * (1 - (1 - progress) ** 2);
      const baseline = Math.max(28, y - 14 - rise);
      ctx.save();
      ctx.globalAlpha = (progress < .08 ? .7 + progress * 3.75 : 1) * Math.min(1, (1 - progress) * 3.35);
      ctx.font = `900 ${mapWidth < 440 ? 28 : 34}px KaiTi, STKaiti, "Microsoft YaHei", serif`;
      ctx.textAlign = 'center';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = '#2b0809';
      ctx.lineWidth = 4;
      ctx.shadowColor = '#710509';
      ctx.shadowBlur = 8;
      ctx.strokeText('菜', x, baseline);
      ctx.shadowBlur = 0;
      const ink = ctx.createLinearGradient(x, baseline - 25, x, baseline + 2);
      ink.addColorStop(0, '#ff7462');
      ink.addColorStop(.45, '#ff302a');
      ink.addColorStop(1, '#be1519');
      ctx.fillStyle = ink;
      ctx.fillText('菜', x, baseline);
      ctx.restore();
    }
  }

  function paintP1Motion(fight, time, bounds, scale, project) {
    const motion = fight.p1Motion;
    const scene = [];
    const units = [];
    const waveSize = globalThis.M8P1Mesh.waveScreenScale(scale);
    if (state.layers.wave) {
      for (const crest of p1Motion.wavelets(motion, time, bounds)) {
        const [x, y] = project(crest.x, crest.y);
        const margin = 65 * waveSize;
        if (x >= -margin && x <= mapWidth + margin && y >= -margin && y <= mapHeight + margin) {
          scene.push({ role: 'wave', pose: crest, x, y, angle: crest.angle, size: waveSize, alpha: crest.alpha });
        }
      }
    }
    for (const { actor, role } of fight.mapUnits) {
      if (role !== 'boss' && role !== 'tail' && role !== 'tail-echo' || isDead(fight, actor, time)) continue;
      const point = p1Motion.unitPoint(motion, actor, role, time);
      if (!point) continue;
      const size = scale * (role === 'boss' ? 18 : 16.5);
      const [x, y] = project(point.x, point.y);
      const angle = Math.atan2(point.y - bounds.cy, bounds.cx - point.x);
      if (x < -150 * size || x > mapWidth + 150 * size || y < -150 * size || y > mapHeight + 150 * size) continue;
      const pose = p1Motion.pose(motion, actor.id, time);
      const cue = p1Original ? p1Motion.originalPose(motion, actor.id, role, time) : null;
      const entry = { actor, role, pose, cue, x, y, angle, size, alpha: (point.opacity ?? 1) * (role === 'tail-echo' ? .63 : 1) };
      scene.push(entry);
      units.push(entry);
    }
    const dpi = Math.min(1.5, canvas.width / mapWidth);
    const original = p1Original?.draw(units, mapWidth, mapHeight, dpi, scale);
    if (!p1Renderer.draw(original ? scene.filter(entry => entry.role === 'wave') : scene, mapWidth, mapHeight, dpi)) return null;
    canvas.dataset.waveMaterial = p1Renderer.hasWaveTextures() ? 'original-textures' : 'procedural';
    for (const { role, x, y, angle, size, alpha } of units) {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(angle);
      ctx.scale(size, size);
      ctx.translate(role === 'boss' ? 41 : 12, 0);
      ctx.scale(1, role === 'boss' ? .78 : .4);
      const shadow = ctx.createRadialGradient(0, 0, 4, 0, 0, role === 'boss' ? 75 : 47);
      shadow.addColorStop(0, '#030d1572');
      shadow.addColorStop(1, '#030d1500');
      ctx.fillStyle = shadow;
      ctx.globalAlpha = alpha;
      ctx.fillRect(-76, -76, 152, 152);
      ctx.restore();
    }
    ctx.drawImage(p1Renderer.canvas, 0, 0, mapWidth, mapHeight);
    if (original) ctx.drawImage(p1Original.canvas, 0, 0, mapWidth, mapHeight);
    for (const { actor, role, x, y, angle, size } of units) {
      if (role === 'tail-echo') continue;
      const color = npcColors[role];
      if (x >= 4 && x <= mapWidth - 4 && y >= 4 && y <= mapHeight - 4) {
        ctx.beginPath();
        ctx.arc(x, y, 3, 0, 2 * Math.PI);
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#161b23';
        ctx.stroke();
        ctx.fillStyle = color;
        ctx.fill();
      }
      const name = actorName(actor.id);
      const body = (role === 'boss' ? 51 : 24) * size;
      const labelX = x + Math.cos(angle) * body;
      const labelY = role === 'tail' ? y + 16 * size : y + Math.sin(angle) * body - 36 * size;
      if (labelX < 26 || labelX > mapWidth - 26 || labelY < 11 || labelY > mapHeight - 10) continue;
      ctx.save();
      ctx.font = 'bold 12px "Microsoft YaHei", sans-serif';
      ctx.textAlign = 'center';
      ctx.strokeStyle = '#0d1522';
      ctx.lineWidth = 3;
      ctx.strokeText(name, labelX, labelY);
      ctx.fillStyle = color;
      ctx.fillText(name, labelX, labelY);
      ctx.restore();
    }
    return { actors: new Set(units.map(entry => entry.actor.id)), original };
  }

  function paintTailAnchor(x, y, [anchorX, anchorY]) {
    ctx.save();
    ctx.strokeStyle = '#efc67fb3';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(anchorX, anchorY);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(anchorX, anchorY, 3, 0, Math.PI * 2);
    ctx.fillStyle = '#efc67f';
    ctx.fill();
    ctx.restore();
  }

  function paintP1Soaks(fight, time, bounds, scale, project) {
    ctx.save();
    ctx.font = '600 12px "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'center';
    for (const soak of fight.evidence.soaks) {
      const until = soak.t - time;
      if (until > 5000 || until < -900 || Number(fight.actorById.get(soak.source)?.gameID) !== 267679 ||
          Number(phaseAt(fight, soak.t)?.id) !== 1) continue;
      const ring = globalThis.M8MapGeometry.p1SoakRing(bounds, soak.anchor);
      if (!ring) continue;
      const [x, y] = project(ring.x, ring.y);
      const radius = ring.radius * scale;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fillStyle = until <= 2000 ? '#a185ef40' : '#a185ef24';
      ctx.fill();
      ctx.setLineDash(until > 2000 ? [5, 4] : []);
      ctx.strokeStyle = '#c2a9f2e6';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.setLineDash([]);
      const label = until > 0 ? '分摊 ' + (until / 1000).toFixed(1) + ' 秒' : '分摊落地';
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#171229';
      ctx.strokeText(label, x, y - radius - 6);
      ctx.fillStyle = '#e4d7fd';
      ctx.fillText(label, x, y - radius - 6);
    }
    ctx.restore();
  }

  function paintRoomAnchors(room, map, project) {
    ctx.save();
    ctx.font = '600 12px "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'center';
    for (const [side, label] of roomSides) {
      const point = room.sides[side].center;
      if (point?.map !== map) continue;
      const [x, y] = project(point.x, point.y);
      const color = side === 'west' ? '#bba8ef' : '#8edacf';
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(x, y, 10, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = '#131b2ae8';
      ctx.fillRect(x - 22, y - 31, 44, 16);
      ctx.fillStyle = color;
      ctx.fillText(label, x, y - 19);
    }
    ctx.restore();
  }

  function paintTrail(actor, time, map, project) {
    const from = at(actor.points, time - 5000) + 1;
    let previous = null;
    ctx.save();
    ctx.strokeStyle = '#cce9ff8c';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let index = from; index < actor.points.length && actor.points[index][0] <= time; index++) {
      const point = actor.points[index];
      if ((point[4] ?? 0) !== map) { previous = null; continue; }
      const [x, y] = project(point[1], point[2]);
      if (previous != null && point[0] - previous <= 3000) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
      previous = point[0];
    }
    ctx.stroke();
    ctx.restore();
  }

  function paintTargetLines(fight, fangs, time, map, project) {
    const entries = byId('show-targets').checked ? fight.targetCasts : [];
    const end = at(entries, time, event => event.t);
    const seen = new Set();
    ctx.save();
    ctx.setLineDash([5, 4]);
    ctx.lineWidth = 2;
    const link = (source, target, color) => {
      const key = source + ':' + target;
      if (seen.has(key)) return;
      const from = sample(fight.actorById.get(source)?.points || [], time);
      const to = sample(fight.actorById.get(target)?.points || [], time);
      if (from?.map !== map || to?.map !== map) return;
      seen.add(key);
      ctx.strokeStyle = color;
      ctx.beginPath();
      ctx.moveTo(...project(from.x, from.y));
      ctx.lineTo(...project(to.x, to.y));
      ctx.stroke();
    };
    for (const tether of fangs || []) link(tether.source, tether.actorId, '#e8a8d7df');
    for (let i = end; i >= 0 && entries[i].t >= time - 2000 && seen.size < 8; i--) {
      const cast = entries[i];
      link(cast.source, cast.target, '#afc5ff99');
    }
    ctx.restore();
  }

  function paintEggEvidence(evidence, time, map, project) {
    const egg = mapIcons.get('egg');
    const bars = [];
    const reducedMotion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    for (const { anchor, kind, shieldPct, brokenAt } of globalThis.M8Evidence.groundEggMarkers(evidence, time, map)) {
      const [x, y] = project(anchor.x, anchor.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      ctx.save();
      if (brokenAt !== null) {
        ctx.globalAlpha = reducedMotion ? 1 : .55 + .45 * (.5 + .5 * Math.cos((time - brokenAt) * Math.PI * 2 / 800));
        ctx.beginPath();
        ctx.arc(x, y, 14, 0, Math.PI * 2);
        ctx.fillStyle = '#ffdc7366';
        ctx.fill();
      }
      ctx.beginPath();
      ctx.arc(x, y, 11, 0, Math.PI * 2);
      ctx.fillStyle = '#171a1f';
      ctx.fill();
      ctx.strokeStyle = brokenAt !== null ? '#fff1a6' : kind === 'clutch' ? '#c8a5f0' : '#ffe2a0';
      ctx.lineWidth = brokenAt !== null ? 2 : 1.5;
      ctx.stroke();
      if (egg?.complete && egg.naturalWidth) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(x, y, 9.5, 0, Math.PI * 2);
        ctx.clip();
        ctx.drawImage(egg, x - 9, y - 9, 18, 18);
        ctx.restore();
      } else {
        ctx.beginPath();
        ctx.ellipse(x, y, 5, 7, .3, 0, Math.PI * 2);
        ctx.fillStyle = '#ffe2a0';
        ctx.fill();
      }
      if (shieldPct !== null) bars.push({ x, y: y - 25, shieldPct });
      ctx.restore();
    }
    return bars;
  }

  function paintEggShields(bars) {
    if (!bars.length) return;
    ctx.save();
    ctx.font = 'bold 9px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const { x, y, shieldPct } of bars) {
      ctx.fillStyle = '#151820';
      ctx.fillRect(x - 17, y, 34, 12);
      ctx.fillStyle = '#377cc4';
      ctx.fillRect(x - 16, y + 1, 32 * shieldPct / 100, 10);
      ctx.fillStyle = '#fff7df';
      ctx.fillText(Math.max(1, Math.round(shieldPct)) + '%', x, y + 6);
    }
    ctx.restore();
  }

  function paintRecentDeaths(fight, current, time, map, project) {
    const shown = new Set(current.map(item => item.actor.id));
    const deaths = fight.deaths;
    for (let index = at(deaths, time, event => event.t); index >= 0 && deaths[index].t >= time - 6500; index--) {
      const death = deaths[index];
      if (shown.has(death.target)) continue;
      const points = fight.actorById.get(death.target)?.points || [];
      const point = points[at(points, death.t)];
      if (!point || death.t - point[0] > 3000 || (point[4] ?? 0) !== map) continue;
      const [x, y] = project(point[1], point[2]);
      ctx.save();
      ctx.globalAlpha = .65;
      ctx.fillStyle = '#2d1825';
      ctx.strokeStyle = '#f396a6';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x - 4, y - 4); ctx.lineTo(x + 4, y + 4);
      ctx.moveTo(x - 4, y + 4); ctx.lineTo(x + 4, y - 4);
      ctx.stroke();
      ctx.restore();
    }
  }

  function refresh() {
    const { fight, time } = state;
    if (!fight) return;
    byId('clock').textContent = timeLabel(time) + ' / ' + timeLabel(fight.duration);
    byId('phase').textContent = phaseLabel(phaseAt(fight, time));
    updateNow();
    updateDeathNav();
    byId('seek').value = time;
    timeline.style.setProperty('--cursor', time / fight.duration * 100 + '%');
    const feedSecond = Math.floor(time / 1000);
    if (state.follow && state.view !== 'players' && feedAt !== feedSecond) {
      const last = eventButtons.at(-1);
      if (byId('nearby').checked || last && time > last.t + 3000 && !byId('more').hidden) renderRows(false);
      feedAt = feedSecond;
    }
    if (Math.floor(time / 100) !== lastHighlight) {
      lastHighlight = Math.floor(time / 100);
      const current = eventButtons[at(eventButtons, time, item => item.t)];
      const next = current && time - current.t <= 3000 ? current.row : null;
      if (next !== highlighted) {
        highlighted?.classList.remove('current');
        next?.classList.add('current');
        highlighted = next;
        if (next && state.follow) {
          const viewport = rows.getBoundingClientRect();
          const item = next.getBoundingClientRect();
          if (item.top < viewport.top || item.bottom > viewport.bottom - 12) {
            rows.scrollTop += item.top - viewport.top - 35;
          }
        }
      }
    }
    paint();
    tools?.update();
  }

  function jump(time, manual = true) {
    if (!state.fight) return;
    state.time = Math.max(0, Math.min(state.fight.duration, Number(time) || 0));
    if (manual) {
      nowAt = feedAt = lastHighlight = -1;
      activeDeath = null;
    }
    refresh();
  }

  function stop() {
    state.playing = false;
    cancelAnimationFrame(animation);
    byId('play').textContent = '▶';
    byId('play').setAttribute('aria-label', '播放');
    byId('play').setAttribute('aria-pressed', 'false');
    tools?.update();
  }

  function togglePlay() {
    if (!state.fight) return;
    if (state.playing) { stop(); return; }
    if (state.time >= state.fight.duration) jump(0);
    state.playing = true;
    byId('play').textContent = 'Ⅱ';
    byId('play').setAttribute('aria-label', '暂停');
    byId('play').setAttribute('aria-pressed', 'true');
    tools?.update();
    let previous = performance.now();
    const frame = now => {
      if (!state.playing) return;
      const elapsed = Math.min(100, now - previous);
      previous = now;
      jump(state.time + elapsed * Number(byId('speed').value), false);
      if (state.time < state.fight.duration) animation = requestAnimationFrame(frame);
      else stop();
    };
    animation = requestAnimationFrame(frame);
  }

  function deathIndex(direction) {
    if (!state.fight) return -1;
    const deaths = state.fight.deaths;
    const selected = activeDeath ? deaths.findIndex(event => event.t === activeDeath.t && event.target === activeDeath.target) : -1;
    if (selected >= 0) return selected + direction;
    return direction < 0 ? at(deaths, state.time - .01, event => event.t) :
      at(deaths, state.time, event => event.t) + 1;
  }

  function updateDeathNav() {
    const deaths = state.fight.deaths;
    const selected = activeDeath ? deaths.findIndex(event => event.t === activeDeath.t && event.target === activeDeath.target) : -1;
    const count = selected >= 0 ? selected + 1 : at(deaths, state.time, event => event.t) + 1;
    byId('death-position').textContent = count + ' / ' + deaths.length;
    byId('death-prev').disabled = deathIndex(-1) < 0;
    byId('death-next').disabled = deathIndex(1) >= deaths.length;
  }

  function canvasPoint(event) {
    const rect = canvas.getBoundingClientRect();
    return { x: (event.clientX - rect.left) * mapWidth / rect.width,
      y: (event.clientY - rect.top) * mapHeight / rect.height };
  }

  function zoomMap(factor, point) {
    if (!state.fight) return;
    if (!factor) {
      state.zoom = 1;
      state.panX = state.panY = 0;
    } else {
      const target = Math.max(.65, Math.min(3.8, state.zoom * factor));
      const ratio = target / state.zoom;
      const x = (point?.x ?? mapWidth / 2) - mapWidth / 2;
      const y = (point?.y ?? mapHeight / 2) - mapHeight / 2;
      state.panX = x - (x - state.panX) * ratio;
      state.panY = y - (y - state.panY) * ratio;
      state.zoom = target;
    }
    paint();
  }

  async function copyMoment() {
    if (!state.fight || !/^[A-Za-z0-9]{16}$/.test(state.report.code || '')) return;
    const link = new URL('https://cn.warcraftlogs.com/reports/' + state.report.code);
    link.searchParams.set('fight', state.fight.id);
    link.searchParams.set('view', 'replay');
    link.searchParams.set('position', Math.round(state.time));
    try {
      await globalThis.navigator.clipboard.writeText(link.href);
      message('已复制当前 WCL 回放定位链接。');
    } catch {
      byId('report-url').value = link.href;
      byId('report-url').closest('details').open = true;
      byId('report-url').select();
      message('定位链接已选中，可复制。');
    }
  }

  byId('import-file').addEventListener('change', async event => {
    const [file] = event.target.files;
    if (!file) return;
    const current = ++request;
    try {
      if (file.size > 100 * 1024 * 1024) throw new Error('复盘文件超过 100 MB，请分战斗导出。');
      message('正在读取复盘数据…');
      const raw = JSON.parse(await file.text());
      if (current !== request) return;
      loadReport(raw);
      byId('import-log').open = false;
      byId('catalog').value = '';
      if (requestedLocation && requestedLocation.code === raw.code) {
        const pending = requestedLocation;
        requestedLocation = null;
        message();
        openReportLocation(pending);
      } else if (requestedLocation) message('已载入这份报告。要定位粘贴的战斗，请选择对应报告。');
      else message();
    } catch (error) {
      if (current === request) message(error instanceof SyntaxError ? '文件不是有效 JSON。' : error.message);
    } finally {
      event.target.value = '';
    }
  });
  byId('fight').addEventListener('change', event => loadFight(event.target.value));
  for (const [id, step] of [['fight-prev', -1], ['fight-next', 1]]) {
    byId(id).addEventListener('click', () => {
      if (!state.fight) return;
      const index = state.report.fights.indexOf(state.fight) + step;
      const fight = state.report.fights[index];
      if (fight) loadFight(fight.id);
    });
  }
  byId('play').addEventListener('click', togglePlay);
  byId('back').addEventListener('click', () => jump(state.time - 5000));
  byId('forward').addEventListener('click', () => jump(state.time + 5000));
  byId('seek').addEventListener('input', event => jump(event.target.value));
  for (const [id, step] of [['zoom-in', 1.25], ['zoom-out', .8], ['zoom-reset', 0]]) {
    byId(id).addEventListener('click', () => zoomMap(step));
  }
  for (const [id, step] of [['death-prev', -1], ['death-next', 1]]) byId(id).addEventListener('click', () => {
    const target = state.fight?.deaths[deathIndex(step)];
    if (target) goEvent(target);
  });
  byId('copy-moment').addEventListener('click', copyMoment);
  byId('speed').addEventListener('change', () => tools?.update());
  canvas.addEventListener('wheel', event => {
    if (!state.fight || !event.deltaY) return;
    event.preventDefault();
    zoomMap(event.deltaY < 0 ? 1.13 : 1 / 1.13, canvasPoint(event));
  }, { passive: false });
  canvas.addEventListener('pointerdown', event => {
    if (!state.fight || event.button !== 0) return;
    mapDrag = { ...canvasPoint(event), id: event.pointerId, panX: state.panX, panY: state.panY, moved: false };
    canvas.setPointerCapture?.(event.pointerId);
  });
  canvas.addEventListener('pointermove', event => {
    if (!mapDrag || mapDrag.id !== event.pointerId) return;
    const point = canvasPoint(event);
    const dx = point.x - mapDrag.x;
    const dy = point.y - mapDrag.y;
    if (!mapDrag.moved && Math.hypot(dx, dy) < 5) return;
    mapDrag.moved = true;
    canvas.classList.add('panning');
    state.panX = Math.max(-mapWidth, Math.min(mapWidth, mapDrag.panX + dx));
    state.panY = Math.max(-mapHeight, Math.min(mapHeight, mapDrag.panY + dy));
    paint();
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) canvas.addEventListener(type, event => {
    if (!mapDrag || mapDrag.id !== event.pointerId) return;
    if (mapDrag.moved) suppressMapClickUntil = performance.now() + 250;
    mapDrag = null;
    canvas.classList.remove('panning');
  });
  byId('nearby').addEventListener('change', () => {
    state.feedTime = state.time;
    state.limit = 90;
    renderRows();
    refresh();
  });
  byId('group-events').addEventListener('change', () => { renderRows(); refresh(); });
  byId('follow').addEventListener('click', () => setFollow(!state.follow));
  for (const event of ['wheel', 'touchmove']) {
    rows.addEventListener(event, () => {
      if (state.follow) setFollow(false);
    }, { passive: true });
  }
  rows.addEventListener('keydown', event => {
    if (state.follow && ['PageUp', 'PageDown', 'Home', 'End', 'ArrowUp', 'ArrowDown'].includes(event.key)) setFollow(false);
  });
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) byId('show-motion').checked = false;
  for (const control of ['focus', 'names', 'art', 'player-hp', 'npc-hp', 'show-targets', 'show-debuffs', 'show-soaks',
    'show-motion', 'show-wave-callouts']) {
    byId(control).addEventListener('change', () => { nowAt = -1; refresh(); });
  }
  for (const control of ['search', 'kind']) byId(control).addEventListener('input', () => {
    state.limit = 90;
    renderRows();
    refresh();
  });
  document.querySelector('.tabs').addEventListener('click', event => {
    const view = event.target.closest('button')?.dataset.view;
    if (!view) return;
    state.view = view;
    state.limit = 90;
    for (const tab of document.querySelectorAll('[data-view]')) tab.setAttribute('aria-pressed', String(tab.dataset.view === view));
    renderRows();
    refresh();
  });
  byId('more').addEventListener('click', () => {
    state.limit += 90;
    renderRows(false);
    refresh();
  });
  canvas.addEventListener('click', event => {
    if (performance.now() < suppressMapClickUntil) return;
    const { x, y } = canvasPoint(event);
    const hit = visibleActors.findLast(actor => Math.hypot(actor.x - x, actor.y - y) < 14);
    if (hit) focusMember(hit.id);
  });
  document.addEventListener('keydown', event => {
    if (!state.fight || event.altKey || event.ctrlKey || event.metaKey || event.target.closest('input,select,button,a,label,[tabindex]')) return;
    if (![' ', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    if (event.key === ' ') togglePlay();
    else jump(state.time + (event.key === 'ArrowLeft' ? -5000 : 5000));
  });

  for (const item of definitions) if (item.key !== 'other') byId('kind').add(new Option(item.label, item.key));
  async function loadCatalog(code, fight, time) {
    const item = catalog.find(report => report.code === code);
    if (!item) return;
    const current = ++request;
    try {
      message('正在载入报告…');
      let raw = embeddedReports.get(item.code);
      if (!raw) {
        const response = await fetch('data/' + item.code + '.json');
        if (!response.ok) throw Error('报告暂时无法加载，请稍后重试。');
        raw = await response.json();
      }
      if (current !== request) return;
      requireRequestedFight(raw, fight);
      loadReport(raw, fight, time);
      byId('catalog').value = item.code;
      message();
      return true;
    } catch (error) {
      if (current === request) message(error.message);
    }
  }
  byId('wcl-import-form').addEventListener('submit', async event => {
    event.preventDefault();
    let target;
    try {
      target = parseReportLocation(byId('wcl-import-url').value.trim());
    } catch {
      message('请粘贴有效的 Warcraft Logs 报告链接。');
      return;
    }
    if (state.report?.code === target.code && target.fight !== 'last' &&
        (target.fight == null || state.report.fights.some(fight => fight.id === target.fight))) {
      openReportLocation(target);
      message();
      byId('import-log').open = false;
      return;
    }
    if (catalog.some(item => item.code === target.code)) {
      if (await loadCatalog(target.code, target.fight, target.time)) byId('import-log').open = false;
      return;
    }
    if (location.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(location.hostname)) {
      message('此页面不能在线拉取，请在本机复盘服务中打开链接，或选择 JSON 文件。');
      return;
    }
    const current = ++request;
    const submit = byId('wcl-import-submit');
    submit.disabled = true;
    message('正在读取 WCL 日志，请稍等…');
    try {
      const response = await fetch('/api/import-wcl', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: target.code, fight: target.fight }),
      });
      const raw = await response.json().catch(() => null);
      if (current !== request) return;
      if (!response.ok || !raw) throw new Error(raw?.error || '链接导入服务未运行，可以先选择 JSON 文件。');
      requireRequestedFight(raw, target.fight);
      loadReport(raw, target.fight, target.time);
      byId('catalog').value = '';
      requestedLocation = null;
      byId('import-log').open = false;
      message();
    } catch (error) {
      if (current === request) message(error.message || '无法读取 WCL 日志，请稍后再试。');
    } finally {
      submit.disabled = false;
    }
  });
  byId('catalog').addEventListener('change', event => loadCatalog(event.target.value));
  byId('location-form').addEventListener('submit', event => {
    event.preventDefault();
    try {
      const target = parseReportLocation(byId('report-url').value);
      message();
      if (state.report?.code === target.code) {
        requestedLocation = null;
        openReportLocation(target);
      } else if (catalog.some(item => item.code === target.code)) {
        requestedLocation = null;
        loadCatalog(target.code, target.fight, target.time);
      } else {
        requestedLocation = target;
        message('已记下链接。导入这份报告的复盘 JSON 后会跳到指定战斗和时间。');
      }
    } catch {
      message('请填写有效的 Warcraft Logs 报告链接。');
    }
  });
  function openCatalog(data) {
    if (!Array.isArray(data)) return;
    catalog = data.filter(item => /^[A-Za-z0-9]{16}$/.test(item?.code || ''));
    if (!catalog.length) return;
    byId('catalog').replaceChildren(new Option('请选择报告', ''), ...catalog.map(item => new Option(item.title || item.code, item.code)));
    byId('catalog-label').hidden = false;
    if (request) return;
    const params = new URLSearchParams(location.search);
    const code = catalog.find(item => item.code === params.get('r'))?.code || catalog[0].code;
    loadCatalog(code, params.get('f'), params.has('t') ? (Number(params.get('t')) || 0) * 1000 : null);
  }
  tools = globalThis.M8ReplayTools.mount({
    canvas, stage: document.querySelector('.replay'),
    videoInput: byId('local-video'), recordButton: byId('record-replay'), videoBar: byId('video-bar'),
    offsetInput: byId('video-offset'), closeVideo: byId('close-video'), ctaFullscreen: byId('replay-fullscreen'),
    time: () => state.time, playing: () => state.playing, speed: () => Number(byId('speed').value),
    message, activeFightId: () => state.fight?.id
  });
  if (typeof ResizeObserver === 'function') new ResizeObserver(([entry]) => {
    const { width, height } = entry.contentRect;
    const ratio = Math.min(2, globalThis.devicePixelRatio || 1);
    const pixelWidth = Math.max(1, Math.round(width * ratio));
    const pixelHeight = Math.max(1, Math.round(height * ratio));
    if (!width || !height || canvas.width === pixelWidth && canvas.height === pixelHeight &&
        mapWidth === width && mapHeight === height) return;
    mapWidth = width;
    mapHeight = height;
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
    ctx.setTransform(pixelWidth / width, 0, 0, pixelHeight / height, 0, 0);
    paint();
  }).observe(canvas);
  byId('next-cast').replaceChildren(element('p', '', '导入战斗后查看首领施法和成员状态'));
  renderRows();
  paint();
  const embedded = byId('embedded-weekly');
  if (embedded) {
    try {
      const { reports } = JSON.parse(embedded.textContent);
      for (const report of reports) embeddedReports.set(report.code, report);
      openCatalog(reports.map(report => ({
        code: report.code,
        title: report.sample ? '公开击杀样例' : new Intl.DateTimeFormat('zh-CN', {
          month: 'numeric', day: 'numeric', timeZone: 'Asia/Shanghai'
        }).format(report.startTime) + ' · ' + report.fights.length + ' 把'
      })));
    } catch {
      message('本周复盘数据暂时无法读取。');
    }
  } else {
    fetch('data/catalog.json').then(response => response.ok ? response.json() : []).then(openCatalog).catch(() => {});
  }
})();
