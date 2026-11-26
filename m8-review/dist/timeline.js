(() => {
  const settingsByNode = new WeakMap();
  const layerKeys = new Set(['egg', 'fang', 'wave', 'room', 'bite', 'death']);
  const extraLanes = [
    { key: 'slam', label: '猛击与痛击', short: '猛击', color: '#f5aa92' },
    { key: 'hatch', label: '孵化与孕育', short: '孵化', color: '#ead88c' },
    { key: 'add', label: '小怪技能', short: '小怪', color: '#ccd49d' },
    { key: 'bite', label: '毒蛇之咬与清除', short: '咬击', color: '#eca2ab' }
  ];
  const laneById = new Map([
    ...[1296301, 1298369].map(id => [id, 'slam']),
    ...[1290990, 1299759, 1302950, 1306862, 1313754].map(id => [id, 'hatch']),
    ...[1303620, 1305709, 1310763, 1310764, 1313758].map(id => [id, 'add']),
    ...[1288879, 1295905, 1306119, 1302842, 1312967, 1313529, 1316356].map(id => [id, 'bite'])
  ]);
  const tickIntervals = [
    1000, 2000, 5000, 10000, 15000, 20000, 30000, 60000, 90000, 120000,
    180000, 300000, 600000, 900000
  ];

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  const clamp = (value, limit) => Math.min(limit, Math.max(0, value));

  function clock(ms) {
    const seconds = Math.floor(ms / 1000);
    return Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
  }

  function appendRow(target, label, track) {
    const row = element('div', 'm8-timeline-row');
    row.append(label, track);
    target.append(row);
  }

  function addSeek(track, label, duration, jump) {
    track.setAttribute('aria-label', label);
    track.addEventListener('click', event => {
      if (event.target.closest('button')) return;
      const bounds = track.getBoundingClientRect();
      if (!bounds.width) return;
      const position = clamp(event.clientX - bounds.left, bounds.width) / bounds.width;
      jump(Math.round(position * duration));
    });
  }

  function phaseBands(target, phases, duration, actions) {
    const label = element('span', 'm8-timeline-label m8-timeline-muted', '阶段');
    const track = element('div', 'm8-phase-track');
    const sorted = phases.filter(phase => Number.isFinite(phase.t)).slice().sort((a, b) => a.t - b.t);
    sorted.forEach((phase, index) => {
      const start = clamp(phase.t, duration);
      const end = clamp(sorted[index + 1]?.t ?? duration, duration);
      if (end <= start) return;
      const text = actions.phaseLabel(phase);
      const button = element('button', 'm8-phase-band', end - start >= duration * .05 ? text : '');
      button.type = 'button';
      button.dataset.tone = String(index % 4);
      button.title = text + ' · ' + clock(start) + '–' + clock(end);
      button.setAttribute('aria-label', button.title);
      button.style.left = (start / duration * 100) + '%';
      button.style.width = ((end - start) / duration * 100) + '%';
      button.addEventListener('click', () => actions.jump(start));
      track.append(button);
    });
    addSeek(track, '阶段分布，点击空白处定位', duration, actions.jump);
    appendRow(target, label, track);
  }

  function timeRuler(target, duration, actions) {
    const label = element('span', 'm8-timeline-label m8-timeline-muted', '时间');
    const track = element('div', 'm8-time-ruler');
    const interval = tickIntervals.find(step => step >= duration / 6) || Math.ceil(duration / 360000) * 60000;
    const ticks = [0];
    for (let time = interval; time <= duration - interval * .55; time += interval) ticks.push(time);
    ticks.push(duration);
    ticks.forEach((time, index) => {
      const edge = index === 0 ? ' is-start' : index === ticks.length - 1 ? ' is-end' : '';
      const tick = element('span', 'm8-time-tick' + edge + (!edge && index % 2 ? ' is-secondary' : ''), clock(time));
      tick.style.left = (time / duration * 100) + '%';
      track.append(tick);
    });
    addSeek(track, '时间刻度，点击定位', duration, actions.jump);
    appendRow(target, label, track);
  }

  function lane(target, definition, entries, duration, actions, settings, bucketCount) {
    const label = element('span', 'm8-timeline-label');
    const dot = element('span', 'm8-lane-dot');
    dot.setAttribute('aria-hidden', 'true');
    label.append(dot, element('span', '', definition.short || definition.label));
    const track = element('div', 'm8-event-track');
    track.style.setProperty('--lane-color', definition.color);
    label.style.setProperty('--lane-color', definition.color);
    addSeek(track, definition.label + '，点击空白处定位', duration, actions.jump);

    if (layerKeys.has(definition.key)) {
      const toggle = element('button', 'm8-lane-toggle', '图层');
      toggle.type = 'button';
      toggle.title = definition.label + '地图图层';
      toggle.setAttribute('aria-label', toggle.title);
      toggle.setAttribute('aria-pressed', String(settings.get(definition.key)));
      toggle.addEventListener('click', () => {
        const visible = !settings.get(definition.key);
        settings.set(definition.key, visible);
        toggle.setAttribute('aria-pressed', String(visible));
        actions.toggleLayer?.(definition.key, visible);
      });
      label.append(toggle);
    }

    const bins = new Map();
    for (const event of entries) {
      const slot = Math.min(bucketCount - 1, Math.floor(event.t / duration * bucketCount));
      const bin = bins.get(slot);
      if (!bin) bins.set(slot, { event, count: 1 });
      else {
        bin.count++;
        if (['damage', 'death'].includes(event.type) && !['damage', 'death'].includes(bin.event.type)) bin.event = event;
      }
    }
    for (const { event, count } of bins.values()) {
      const mark = event.type === 'death' ? ' is-death' : event.type === 'damage' ? ' is-impact' :
        event.type === 'cast' || event.type === 'begincast' ? ' is-cast' : '';
      const marker = element('button', 'm8-lane-mark' + mark + (count > 1 ? ' is-group' : ''),
        mark === ' is-death' ? '×' : '');
      marker.type = 'button';
      marker.style.left = (clamp(event.t, duration) / duration * 100) + '%';
      marker.title = clock(event.t) + ' · ' + actions.eventName(event) +
        (count > 1 ? ' · 同一时间区间 ' + count + ' 条' : '');
      marker.setAttribute('aria-label', marker.title);
      marker.addEventListener('click', () => actions.goEvent(event));
      track.append(marker);
    }
    appendRow(target, label, track);
  }

  function heartPeriods(target, hearts, duration, actions) {
    if (!hearts.length) return;
    const track = element('div', 'm8-event-track m8-heart-track');
    for (const heart of hearts) {
      const start = clamp(heart.start, duration);
      const end = clamp(heart.end, duration);
      if (end <= start) continue;
      const bar = element('button', 'm8-heart-period' + (heart.endReason === 'removed' ? '' : ' is-open'));
      bar.type = 'button';
      bar.style.left = start / duration * 100 + '%';
      bar.style.width = (end - start) / duration * 100 + '%';
      bar.title = '烈毒之心 · ' + clock(start) + '–' + clock(end) +
        (heart.endReason === 'removed' ? '' : ' · 结束未记录');
      bar.setAttribute('aria-label', bar.title);
      bar.addEventListener('click', () => actions.jump(start));
      track.append(bar);
    }
    addSeek(track, '烈毒之心易伤时段', duration, actions.jump);
    appendRow(target, element('span', 'm8-timeline-label', '心脏易伤'), track);
  }

  function roomPeriod(target, rooms, duration, actions, settings) {
    if (rooms?.start == null) return;
    const track = element('div', 'm8-event-track m8-room-track');
    const label = element('span', 'm8-timeline-label', '分房');
    const toggle = element('button', 'm8-lane-toggle', '图层');
    toggle.type = 'button';
    toggle.setAttribute('aria-label', 'P2 房间地图图层');
    toggle.setAttribute('aria-pressed', String(settings.get('room')));
    toggle.addEventListener('click', () => {
      const visible = !settings.get('room');
      settings.set('room', visible);
      toggle.setAttribute('aria-pressed', String(visible));
      actions.toggleLayer?.('room', visible);
    });
    label.append(toggle);
    const bar = element('button', 'm8-room-period');
    bar.type = 'button';
    const end = Math.min(duration, rooms.end ?? rooms.through);
    bar.title = 'P2 分房 · ' + clock(rooms.start) + '–' + clock(end);
    bar.setAttribute('aria-label', bar.title);
    bar.style.left = rooms.start / duration * 100 + '%';
    bar.style.width = (end - rooms.start) / duration * 100 + '%';
    bar.addEventListener('click', () => actions.jump(rooms.start));
    track.append(bar);
    addSeek(track, 'P2 分房时段', duration, actions.jump);
    appendRow(target, label, track);
  }

  function carriedEggs(target, eggs, duration, actions) {
    if (!eggs.length) return;
    const track = element('div', 'm8-event-track m8-egg-profile');
    const changes = new Map([[0, 0], [duration, 0]]);
    for (const egg of eggs) {
      const start = clamp(egg.start, duration);
      const end = clamp(egg.end, duration);
      if (end <= start) continue;
      changes.set(start, (changes.get(start) || 0) + 1);
      changes.set(end, (changes.get(end) || 0) - 1);
    }
    const ordered = [...changes].sort((a, b) => a[0] - b[0]);
    let count = 0;
    const values = ordered.map(([time, change], index) => ({ time, count: count += change, end: ordered[index + 1]?.[0] }));
    const maximum = Math.max(1, ...values.map(value => value.count));
    for (const value of values) {
      if (value.count <= 0 || value.end <= value.time || value.end == null) continue;
      const mark = element('span', 'm8-egg-volume');
      mark.style.left = value.time / duration * 100 + '%';
      mark.style.width = (value.end - value.time) / duration * 100 + '%';
      mark.style.height = Math.max(10, value.count / maximum * 100) + '%';
      mark.title = clock(value.time) + ' · ' + value.count + ' 个携蛋记录';
      track.append(mark);
    }
    addSeek(track, '日志中的携蛋数量，点击定位', duration, actions.jump);
    appendRow(target, element('span', 'm8-timeline-label', '携蛋数量'), track);
  }

  function render(node, fight, definitions, actions) {
    const duration = fight?.duration;
    if (!Number.isFinite(duration) || duration <= 0) {
      node.replaceChildren(element('p', 'empty', '加载战斗后显示阶段和机制事件。'));
      return;
    }
    let settings = settingsByNode.get(node);
    if (!settings) {
      settings = new Map([...layerKeys].map(key => [key, true]));
      settingsByNode.set(node, settings);
    }
    const entriesByKind = new Map();
    for (const event of fight.displayEvents || []) {
      if (!Number.isFinite(event.t) || event.t < 0 || event.t > duration) continue;
      if (event.spellID === 1 && event.type !== 'death') continue;
      const key = event.kind === 'death' || event.kind === 'interrupt' ? event.kind : laneById.get(event.spellID) || event.kind;
      if (key === 'bite' && fight.p3?.length) continue;
      if (!entriesByKind.has(key)) entriesByKind.set(key, []);
      entriesByKind.get(key).push(event);
    }
    if (fight.p3?.length) entriesByKind.set('bite', fight.p3.filter(item =>
      item.key.includes('bite') || item.key.startsWith('purge') || item.key.startsWith('calcified')).map(item => ({
      ...item.event, t: item.t, spell: item.label, recipientIds: item.actors
    })));

    const fragment = document.createDocumentFragment();
    phaseBands(fragment, fight.phaseTransitions || [], duration, actions);
    roomPeriod(fragment, fight.rooms, duration, actions, settings);
    heartPeriods(fragment, fight.evidence?.hearts || [], duration, actions);
    carriedEggs(fragment, fight.evidence?.eggs || [], duration, actions);
    const availableWidth = (node.clientWidth || 700) - 115;
    const bucketCount = Math.max(22, Math.min(120, Math.floor(availableWidth / 9)));
    for (const definition of [...definitions.slice(0, 1), ...extraLanes, ...definitions.slice(1)]) {
      if (definition.key === 'other') continue;
      const group = entriesByKind.get(definition.key);
      if (group?.length) lane(fragment, definition, group, duration, actions, settings, bucketCount);
    }
    timeRuler(fragment, duration, actions);
    fragment.append(element('p', 'm8-track-key', '空心是施法 · 实心是效果记录 · × 是死亡 · 柱高是携蛋数'));
    node.classList.add('m8-timeline');
    node.replaceChildren(fragment);
  }

  globalThis.M8Timeline = { render };
})();
