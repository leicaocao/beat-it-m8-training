(() => {
  const preferences = new WeakMap();
  const views = [
    ['recap', '概览'],
    ['players', '按成员'],
    ['mechanics', '机制记录'],
    ['deaths', '死亡']
  ];
  const endReason = new Map([
    ['removed', '移除'],
    ['death', '死亡时截断'],
    ['fight-end', '战斗结束时截断'],
    ['reapplied', '再次施加时截断']
  ]);

  function node(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function card(title, note = '') {
    const element = node('article', 'm8-analysis-card');
    const header = node('header');
    header.append(node('h3', '', title));
    if (note) header.append(node('span', 'm8-analysis-subtitle', note));
    const list = node('div', 'm8-analysis-list');
    element.append(header, list);
    return { element, list };
  }

  function stat(label, value) {
    const tile = node('div', 'm8-analysis-stat');
    tile.append(node('span', '', label), node('b', '', value));
    return tile;
  }

  function empty(list, message) {
    list.append(node('p', 'm8-analysis-empty', message));
  }

  function row(actions, { time, title, detail, icon = 'boss', portrait, onSelect }) {
    const button = node('button', 'm8-analysis-item');
    button.type = 'button';
    const text = node('span', 'm8-analysis-item-copy');
    text.append(node('b', '', title));
    if (detail) text.append(node('small', '', detail));
    button.append(node('time', '', actions.timeLabel(time)),
      portrait ? actions.portrait(portrait) : actions.image(icon), text);
    button.setAttribute('aria-label', title + ' · 跳到 ' + actions.timeLabel(time));
    button.addEventListener('click', onSelect || (() => actions.jump(time)));
    return button;
  }

  const count = value => Number(value) || 0;
  const eggTotal = summary => count(summary?.eggPickups?.small) + count(summary?.eggPickups?.large);
  const join = (...parts) => parts.filter(Boolean).join(' · ');

  function renderRecap(panel, fight, evidence, actions) {
    const { recap = {}, eggs = [], hearts = [], phases = [], deaths = fight.deaths || [] } = evidence;
    const stats = node('div', 'm8-analysis-metrics');
    const last = phases.at(-1) || fight.phaseTransitions?.at(-1);
    stats.append(
      stat('战斗时长', actions.timeLabel(fight.duration)),
      stat('到达阶段', actions.phaseLabel(last)),
      stat('持卵开始', eggTotal(recap)),
      stat('死亡记录', deaths.length)
    );
    const columns = node('div', 'm8-analysis-columns');
    const phaseCard = card('阶段进程', 'WCL 阶段');
    const points = card('关键节点');
    const stages = phases.length ? phases : (fight.phaseTransitions || []).map((phase, index, all) => ({
      id: phase.id, start: phase.t, end: all[index + 1]?.t ?? fight.duration
    }));
    for (const phase of stages) {
      const counts = phase.counts;
      phaseCard.list.append(row(actions, {
        time: phase.start,
        title: actions.phaseLabel(phase),
        detail: join('结束 ' + actions.timeLabel(phase.end),
          counts && '持卵 ' + eggTotal(counts) + ' 次',
          counts && '死亡 ' + count(counts.deaths) + ' 次')
      }));
    }
    if (!stages.length) empty(phaseCard.list, '该把没有阶段切换记录。');
    const tags = [];
    const firstEgg = eggs[0];
    const firstHeart = hearts[0];
    const firstDeath = deaths[0];
    if (firstEgg) tags.push({
      time: firstEgg.start, title: '首次记录到持卵', icon: 'egg',
      detail: actions.actorName(firstEgg.actorId),
      onSelect: () => { actions.focusMember(firstEgg.actorId); actions.jump(firstEgg.start); }
    });
    if (firstHeart) tags.push({
      time: firstHeart.start, title: '首次心脏暴露',
      detail: '持续 ' + actions.timeLabel(firstHeart.end - firstHeart.start)
    });
    if (firstDeath) tags.push({
      time: firstDeath.t, title: '首次死亡',
      detail: join(actions.actorName(firstDeath.target), firstDeath.spell),
      portrait: fight.actorById.get(firstDeath.target),
      onSelect: () => actions.goEvent(firstDeath)
    });
    for (const entry of tags.sort((a, b) => a.time - b.time)) points.list.append(row(actions, entry));
    if (!tags.length) empty(points.list, '该把未记录这些机制节点。');
    columns.append(phaseCard.element, points.element);
    panel.append(stats, columns);
  }

  function renderPlayers(panel, fight, evidence, actions, state) {
    const actors = evidence.byActor || new Map();
    const tools = node('div', 'm8-analysis-tools');
    const search = node('input');
    search.type = 'search';
    search.setAttribute('aria-label', '查找成员');
    search.placeholder = '查找成员';
    search.value = state.search;
    const sort = node('select');
    sort.setAttribute('aria-label', '成员排序');
    sort.append(new Option('按死亡排序', 'deaths'), new Option('按持卵排序', 'eggs'),
      new Option('按分摊减益排序', 'coils'), new Option('按名字排序', 'name'));
    sort.value = state.sort;
    tools.append(search, sort);

    const wrap = node('div', 'm8-analysis-table-wrap');
    const table = node('table', 'm8-analysis-table');
    const header = node('thead');
    const labels = node('tr');
    for (const label of ['成员', '小蛋', '大蛋', '持卵时长', '分摊减益', '打断', '死亡']) {
      const cell = node('th', '', label);
      cell.scope = 'col';
      labels.append(cell);
    }
    header.append(labels);
    const results = node('tbody');
    const noPlayers = node('p', 'm8-analysis-empty', '没有匹配的成员。');
    table.append(header, results);
    wrap.append(table, noPlayers);
    panel.append(tools, wrap, node('p', 'm8-analysis-note', '分摊减益按日志记录计数。'));

    const sortable = {
      deaths: value => count(value.deaths),
      eggs: eggTotal,
      coils: value => count(value.coilAuras),
      name: () => 0
    };
    function fill() {
      const query = state.search.trim().toLocaleLowerCase();
      const value = sortable[state.sort] || sortable.deaths;
      const filtered = fight.players.map(actor => ({ actor, recorded: actors.get(actor.id) || {} }))
        .filter(({ actor }) => String(actor.name || '').toLocaleLowerCase().includes(query))
        .sort((a, b) => value(b.recorded) - value(a.recorded) ||
          String(a.actor.name || '').localeCompare(String(b.actor.name || ''), 'zh-CN'));
      const fragment = document.createDocumentFragment();
      for (const { actor, recorded } of filtered) {
        const line = node('tr');
        const who = node('td');
        const button = node('button', 'm8-analysis-player');
        button.type = 'button';
        button.append(actions.portrait(actor), node('span', '', actor.name));
        button.addEventListener('click', () => actions.focusMember(actor.id));
        who.append(button);
        line.append(who);
        for (const item of [count(recorded.eggPickups?.small), count(recorded.eggPickups?.large),
          actions.timeLabel(count(recorded.eggCarryMs)), count(recorded.coilAuras),
          count(recorded.interrupts), count(recorded.deaths)]) line.append(node('td', '', item));
        fragment.append(line);
      }
      noPlayers.hidden = filtered.length > 0;
      results.replaceChildren(fragment);
    }
    search.addEventListener('input', () => { state.search = search.value; fill(); });
    sort.addEventListener('change', () => { state.sort = sort.value; fill(); });
    fill();
  }

  function renderMechanics(panel, fight, evidence, actions) {
    const { eggs = [], hearts = [], soaks = [], casts = [], interrupts = [] } = evidence;
    const columns = node('div', 'm8-analysis-columns');
    const carry = card('持卵过程', eggs.length + ' 段');
    const heart = card('心脏暴露', hearts.length + ' 次');
    const soak = card('分摊施放', soaks.length + ' 次');
    const orderedCasts = [...casts, ...interrupts].sort((a, b) => a.t - b.t);
    const spells = card('关键施法与打断', orderedCasts.length + ' 条');
    if (fight.rooms?.start != null) {
      const { start, end, sides, unassignedIds } = fight.rooms;
      const rooms = card('P2 分房', actions.timeLabel(start) + (end == null ? ' 起' : '–' + actions.timeLabel(end)));
      const grid = node('div', 'm8-analysis-rooms');
      for (const [side, label] of [['west', '西侧'], ['east', '东侧']]) {
        const room = node('section');
        room.dataset.side = side;
        const members = sides[side].memberIds;
        room.append(node('h4', '', label + ' · ' + members.length + ' 人'));
        for (const id of members) {
          const actor = fight.actorById.get(id);
          const button = node('button', 'm8-analysis-player');
          button.type = 'button';
          button.append(actions.portrait(actor), node('span', '', actions.actorName(id)));
          button.addEventListener('click', () => {
            actions.jump(Math.min(end ?? fight.rooms.through, start + 7000));
            actions.focusMember(id);
          });
          room.append(button);
        }
        grid.append(room);
      }
      rooms.list.append(grid);
      if (unassignedIds.length) rooms.list.append(node('p', 'm8-analysis-note', '坐标不足 · ' +
        unassignedIds.map(actions.actorName).join('、')));
      columns.append(rooms.element);
    }
    if (fight.p3?.length) {
      const final = card('P3 机制节点', fight.p3.length + ' 条');
      for (const item of fight.p3) {
        final.list.append(row(actions, {
          time: item.t, title: item.label, icon: item.icon,
          detail: join(item.evidence, item.actors.map(actions.actorName).join('、')),
          onSelect: () => {
            actions.jump(item.actorTime ?? item.t);
            if (item.actors.length === 1) actions.focusMember(item.actors[0]);
          }
        }));
      }
      columns.append(final.element);
    }
    for (const item of eggs) {
      carry.list.append(row(actions, {
        time: item.start, title: join(item.kind === 'large' ? '大蛋' : '小蛋', actions.actorName(item.actorId)),
        detail: join('结束 ' + actions.timeLabel(item.end), endReason.get(item.endReason)),
        icon: 'egg',
        onSelect: () => { actions.focusMember(item.actorId); actions.jump(item.start); }
      }));
    }
    for (const item of hearts) {
      heart.list.append(row(actions, {
        time: item.start, title: '心脏暴露',
        detail: join('结束 ' + actions.timeLabel(item.end), endReason.get(item.endReason))
      }));
    }
    for (const item of soaks) {
      const recorded = item.participantEvidence === 'soul-constrictor';
      soak.list.append(row(actions, {
        time: item.t, title: actions.eventName(item.event),
        detail: recorded ? join(item.participants.length + ' 人记录到相关减益',
          item.participants.map(id => actions.actorName(id)).filter(Boolean).join('、')) : '未记录参与成员',
        icon: 'soak',
        onSelect: () => actions.goEvent(item.event)
      }));
    }
    for (const event of orderedCasts) {
      spells.list.append(row(actions, {
        time: event.t, title: actions.eventName(event),
        detail: join(actions.actorName(event.source), event.type === 'interrupt' ? '成功打断' : ''),
        icon: event.type === 'interrupt' ? 'kick' : 'boss',
        onSelect: () => actions.goEvent(event)
      }));
    }
    if (!eggs.length) empty(carry.list, '该把未记录持卵。');
    if (!hearts.length) empty(heart.list, '该把未记录心脏暴露。');
    if (!soaks.length) empty(soak.list, '该把未记录分摊施放。');
    if (!orderedCasts.length) empty(spells.list, '该把未记录施法或打断。');
    columns.append(carry.element, heart.element, soak.element, spells.element);
    panel.append(columns, node('p', 'm8-analysis-note', '时段取自日志。缺失的结束事件按可见终点截断。'));
  }

  function renderDeaths(panel, fight, evidence, actions) {
    const deaths = evidence.deaths || fight.deaths || [];
    const columns = node('div', 'm8-analysis-columns');
    const sequence = card('死亡顺序', deaths.length + ' 条');
    const group = card('致死技能');
    const bySpell = new Map();
    for (const event of deaths) {
      const actor = fight.actorById.get(event.target);
      const cause = event.spell || '未注明致死技能';
      sequence.list.append(row(actions, {
        time: event.t, title: actor?.name || '未知成员', detail: cause,
        portrait: actor, onSelect: () => actions.goEvent(event)
      }));
      if (!bySpell.has(cause)) bySpell.set(cause, []);
      bySpell.get(cause).push(event);
    }
    for (const [cause, events] of [...bySpell].sort((a, b) => b[1].length - a[1].length)) {
      const first = events[0];
      group.list.append(row(actions, {
        time: first.t, title: cause, detail: events.length + ' 条死亡记录 · 点击定位首条',
        onSelect: () => actions.goEvent(first)
      }));
    }
    if (!deaths.length) {
      empty(sequence.list, '该把没有成员死亡记录。');
      empty(group.list, '无致死技能。');
    }
    columns.append(sequence.element, group.element);
    panel.append(columns);
  }

  function render(root, fight, evidence, actions) {
    root.classList.add('m8-analysis');
    const header = node('header', 'm8-analysis-head');
    const heading = node('div');
    heading.append(node('h2', '', '战斗复盘'));
    if (fight) heading.append(node('small', 'm8-analysis-subtitle',
      'WCL #' + fight.id + ' · ' + actions.timeLabel(fight.duration) + (fight.kill ? ' · 击杀' : '')));
    header.append(heading);
    const panel = node('div', 'm8-analysis-content');
    root.replaceChildren(header, panel);
    if (!fight || !evidence) {
      empty(panel, '载入战斗后查看概览、成员和机制记录。');
      return;
    }

    const state = preferences.get(root) || { view: 'recap', search: '', sort: 'deaths' };
    preferences.set(root, state);
    const tabs = node('nav', 'm8-analysis-tabs');
    tabs.setAttribute('aria-label', '复盘视图');
    header.append(tabs);
    const buttons = new Map();

    function switchTo(view) {
      state.view = view;
      for (const [key, button] of buttons) button.setAttribute('aria-pressed', String(key === view));
      panel.replaceChildren();
      if (view === 'players') renderPlayers(panel, fight, evidence, actions, state);
      else if (view === 'mechanics') renderMechanics(panel, fight, evidence, actions);
      else if (view === 'deaths') renderDeaths(panel, fight, evidence, actions);
      else renderRecap(panel, fight, evidence, actions);
    }

    for (const [key, label] of views) {
      const button = node('button', '', label);
      button.type = 'button';
      button.setAttribute('data-analysis-view', key);
      button.addEventListener('click', () => switchTo(key));
      buttons.set(key, button);
      tabs.append(button);
    }
    switchTo(state.view);
  }

  globalThis.M8Analysis = { render };
})();
