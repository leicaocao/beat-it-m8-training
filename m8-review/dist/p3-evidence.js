(() => {
  const phaseId = 4;
  const sameMoment = 80;
  const biteTargetWindow = 1250;
  // Spell IDs follow BigWigs' Ula'tek module. The public WCL sample also
  // records the P3 wave and platform casts under 1292211 and 1315341.
  const rules = [
    [[1295905], 'cast', 'serpents-bite', '毒蛇之咬', 'soak'],
    [[1293046], 'aura', 'bite-warning', '毒蛇之咬 · 预点名', 'soak'],
    [[1288879], 'aura', 'bite-target', '毒蛇之咬 · 点名减益', 'soak'],
    [[1287036], 'aura', 'poisonous-bite', '疫鳞幼体 · 剧毒撕咬', 'fang'],
    [[1312967], 'aura', 'purge-mark', '易爆清除 · 待爆减益', 'soak'],
    [[1316356], 'aura', 'purge-dot', '易爆清除 · 持续减益', 'soak'],
    [[1306119], 'aura', 'calcified-corpse', '钙化尸骸', 'soak'],
    [[1306119], 'death', 'calcified-death', '钙化尸骸 · 致死记录', 'soak'],
    [[1298367, 1311037], 'cast', 'mothers-wrath', '蛇母之怒', 'tank'],
    [[1292188, 1292211], 'cast', 'caustic-waves', '腐蚀浪潮', 'movement'],
    [[1301510, 1315341], 'cast', 'circling-prey', '盘绕猎物', 'movement'],
    [[1300751], 'cast', 'call-of-the-serpent', '毒蛇呼唤', 'egg'],
    [[1310764], 'interrupt', 'vicious-echoes', '险恶回音 · 打断', 'kick'],
    [[1299526], 'cast', 'venomous-heart', '烈毒之心', 'boss'],
    [[1286860], 'cast', 'rage-of-the-shackled', '被缚之怒', 'boss'],
    [[1286905], 'cast', 'fury-unleashed', '无羁之怒', 'boss'],
  ];
  const byEvent = new Map(rules.flatMap(([spells, type, key, label, icon]) => spells.map(spell => [
    type + ':' + spell, { type, key, label, icon },
  ])));
  const evidenceNames = { cast: '施法', aura: '减益施加', interrupt: '成功打断', death: '致死事件' };

  function addMoment(groups, latest, rule, event, actor) {
    let row = latest.get(rule.key);
    if (!row || event.t - row.t > sameMoment) {
      const { key, label, icon, type } = rule;
      row = { key, label, icon, t: event.t, actors: new Set(), confidence: 'recorded',
        evidence: evidenceNames[type], event, occurrences: 0 };
      groups.push(row);
      latest.set(key, row);
    }
    if (actor != null) row.actors.add(actor);
    row.occurrences += 1;
  }

  function build(fight) {
    const phases = (fight?.phaseTransitions || []).filter(phase => Number.isFinite(phase?.t))
      .sort((a, b) => a.t - b.t);
    const index = phases.findIndex(phase => Number(phase.id) === phaseId);
    if (index === -1) return [];
    const start = phases[index].t;
    const end = phases[index + 1]?.t ?? Infinity;
    const players = new Set((fight.actors || []).filter(actor => actor.type === 'Player').map(actor => actor.id));
    const groups = [];
    const latest = new Map();
    const events = (fight.events || []).filter(event => Number.isFinite(event?.t) && event.t >= start && event.t < end)
      .sort((a, b) => a.t - b.t);
    for (const event of events) {
      const type = event.type === 'applydebuff' ? 'aura' : event.type;
      const rule = byEvent.get(type + ':' + event.spellID);
      if (!rule) continue;
      const candidate = type === 'interrupt' ? event.source : event.target;
      const actor = players.has(candidate) ? candidate : null;
      if (actor == null && type !== 'cast') continue;
      addMoment(groups, latest, rule, event, actor);
    }

    // In this WCL export the point-in-time target aura has no source actor.
    // Match only the immediate aura group following a recorded Bite cast.
    let bite = null;
    for (const row of groups) {
      if (row.key === 'serpents-bite') bite = row;
      if (row.key !== 'bite-target' || !bite || row.t - bite.t > biteTargetWindow) continue;
      for (const actor of row.actors) bite.actors.add(actor);
      bite.actorTime ??= row.t;
      bite.confidence = 'correlated';
      bite.evidence = '施法及紧随的点名减益';
      row.linked = true;
    }
    return groups.filter(row => !row.linked)
      .map(row => ({ ...row, count: row.actors.size, actors: [...row.actors] }));
  }

  globalThis.M8P3Evidence = { build };
})();
