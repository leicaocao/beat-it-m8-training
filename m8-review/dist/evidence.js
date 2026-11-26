(() => {
  const shellKinds = new Map([[1307612, 'small'], [1300312, 'large']]);
  const fangs = new Set([1301117, 1301118, 1311611]);
  const waveAura = 1292403;
  const heartAura = 1299526;
  const heartCreature = 267460;
  const coilImpact = 1299010;
  const coilParticipant = 1300685;
  const splashAura = 1307635;
  const yolkAura = 1312150;
  const hardening = 1299650;
  const trackedDebuffs = new Map([
    [splashAura, 'splash'], [yolkAura, 'yolk'], [coilParticipant, 'coil'],
    [1301268, 'membrane'], [1298417, 'stone-venom'], [1287036, 'bite'],
    [1301800, 'acid'], [1305650, 'anguished-cry'], [1305775, 'dread-roar'],
    [1311609, 'blight-vein'], [1300938, 'hobbled'], [1303414, 'petrified'],
    [1295995, 'poison-cloud'], [1310763, 'burst'], [1302842, 'toxic-burn'],
    [1288879, 'bite-target'], [1312967, 'purge-mark'], [1316356, 'purge-dot']
  ]);
  const clutchCreatures = new Map([[263535, 1290990], [271194, 1313754]]);
  const applyTypes = new Set(['applybuff', 'applydebuff']);
  const removeTypes = new Set(['removebuff', 'removedebuff']);
  const stackTypes = new Set(['applybuffstack', 'removebuffstack', 'applydebuffstack', 'removedebuffstack']);

  const mapRoles = new Map([
    [257758, 'boss'], [268029, 'boss-image'], [259555, 'tail'], [267418, 'tail'],
    [263942, 'add'], [265644, 'add'], [261915, 'add'], [261874, 'add'],
    [267460, 'heart'], [267679, 'coil'], [265946, 'poison'],
    [264045, 'add'], [273577, 'add'], [269200, 'add'], [268121, 'add']
  ]);

  function lowerOrEqual(items, time, getTime) {
    let left = 0;
    let right = items.length;
    while (left < right) {
      const middle = (left + right) >>> 1;
      if (getTime(items[middle]) <= time) left = middle + 1;
      else right = middle;
    }
    return left - 1;
  }

  function sampleAnchor(actor, time) {
    const points = actor?.points || [];
    const index = lowerOrEqual(points, time, point => point[0]);
    const before = points[index];
    const after = points[index + 1];
    const closest = !before ? after :
      after && Math.abs(after[0] - time) < Math.abs(before[0] - time) ? after : before;
    if (!closest || Math.abs(closest[0] - time) > 750 || !Number.isFinite(closest[1]) ||
        !Number.isFinite(closest[2])) return null;
    return { t: closest[0], x: closest[1], y: closest[2], map: closest[4] ?? 0 };
  }

  function intervalSet() {
    return { active: new Map(), all: [] };
  }

  function finishInterval(track, actorId, time, endReason, endEvent = null) {
    const interval = track.active.get(actorId);
    if (!interval) return;
    interval.end = Math.max(time, interval.start);
    interval.endReason = endReason;
    interval.endEvent = endEvent;
    track.active.delete(actorId);
  }

  function trackAura(track, event, duration, kind) {
    const actorId = event.target;
    const existing = track.active.get(actorId);
    if (applyTypes.has(event.type)) {
      if (existing?.start === event.t && existing.spellID === event.spellID) return;
      finishInterval(track, actorId, event.t, 'reapplied', event);
      const interval = {
        actorId, kind, spellID: event.spellID, spell: event.spell, source: event.source,
        start: event.t, end: duration, endReason: 'fight-end',
        startEvent: event, endEvent: null, stacks: [{ t: event.t, stack: event.stack || 1 }]
      };
      track.active.set(actorId, interval);
      track.all.push(interval);
    } else if (removeTypes.has(event.type) && existing?.spellID === event.spellID) {
      finishInterval(track, actorId, event.t, 'removed', event);
    } else if (stackTypes.has(event.type) && existing?.spellID === event.spellID &&
        Number.isFinite(event.stack)) {
      existing.stacks.push({ t: event.t, stack: event.stack });
    }
  }

  function collectIntervals(events, actors, duration) {
    const small = intervalSet();
    const large = intervalSet();
    const heart = intervalSet();
    const fang = intervalSet();
    const wave = intervalSet();
    const extra = new Map([...trackedDebuffs.keys()].map(spell => [spell, intervalSet()]));
    const tracks = [small, large, heart, fang, wave, ...extra.values()];
    for (const event of events) {
      const target = actors.get(event.target);
      if (event.type === 'death') {
        for (const track of tracks) finishInterval(track, event.target, event.t, 'death', event);
        continue;
      }
      if (event.spellID === heartAura) {
        if (target?.gameID === heartCreature && (applyTypes.has(event.type) || removeTypes.has(event.type))) {
          trackAura(heart, event, duration, 'heart');
        }
        continue;
      }
      if (target?.type !== 'Player') continue;
      const egg = shellKinds.get(event.spellID);
      if (egg) trackAura(egg === 'small' ? small : large, event, duration, egg);
      else if (fangs.has(event.spellID)) trackAura(fang, event, duration, 'fang');
      else if (event.spellID === waveAura) trackAura(wave, event, duration, 'wave');
      else if (extra.has(event.spellID)) trackAura(extra.get(event.spellID), event, duration, trackedDebuffs.get(event.spellID));
    }
    // Some earlier imports may contain a Heart cast but omit the paired buff.
    // It identifies the start of the window without a confirmed end.
    for (const event of events) {
      if (event.spellID !== heartAura || event.type !== 'cast' ||
          actors.get(event.source)?.gameID !== heartCreature ||
          heart.all.some(window => window.actorId === event.source && Math.abs(window.start - event.t) <= 500)) continue;
      const endEvent = events.find(candidate => candidate.t > event.t && candidate.target === event.source &&
        (candidate.type === 'death' || candidate.spellID === heartAura && removeTypes.has(candidate.type)));
      heart.all.push({
        kind: 'heart', actorId: event.source, source: event.source, spellID: heartAura, spell: event.spell,
        start: event.t, end: endEvent?.t ?? duration,
        endReason: endEvent ? endEvent.type === 'death' ? 'death' : 'removed' : 'fight-end',
        startEvent: event, endEvent: endEvent || null, stacks: []
      });
    }
    const eggs = [...small.all, ...large.all].sort((a, b) => a.start - b.start);
    const splash = incidents(events, actors, splashAura);
    const yolk = incidents(events, actors, yolkAura);
    for (const egg of eggs) {
      egg.splash = egg.kind === 'small' && splash.some(event => event.target === egg.actorId &&
        event.t >= egg.start && event.t <= egg.end + 300);
    }
    const debuffs = [...eggs, ...fang.all, ...wave.all, ...[...extra.values()].flatMap(track => track.all)]
      .sort((a, b) => a.start - b.start);
    return { eggs, hearts: heart.all.sort((a, b) => a.start - b.start), fangs: fang.all,
      waves: wave.all, debuffs, splash, yolk };
  }

  function incidents(events, actors, spellID) {
    return events.filter(event => event.spellID === spellID && applyTypes.has(event.type) &&
      actors.get(event.target)?.type === 'Player');
  }

  function collectCoils(events, actors) {
    const soaks = [];
    const bySource = new Map();
    for (const event of events) {
      if (event.spellID !== coilImpact || event.type !== 'cast') continue;
      const impact = {
        t: event.t, source: event.source, event,
        participants: [], participantEvidence: 'soul-constrictor',
        anchor: sampleAnchor(actors.get(event.source), event.t)
      };
      soaks.push(impact);
      if (!bySource.has(event.source)) bySource.set(event.source, []);
      bySource.get(event.source).push(impact);
    }
    for (const event of incidents(events, actors, coilParticipant)) {
      const impacts = bySource.get(event.source) || [];
      const i = lowerOrEqual(impacts, event.t, impact => impact.t);
      const impact = impacts[i];
      if (!impact || event.t - impact.t > 500 || impact.participants.includes(event.target)) continue;
      impact.participants.push(event.target);
    }
    for (const impact of soaks) {
      if (!impact.participants.length) impact.participantEvidence = 'unavailable';
    }
    return soaks;
  }

  function collectGroundAnchors(events, actors, duration) {
    const starts = new Map();
    const endings = new Map();
    for (const event of events) {
      const actor = actors.get(event.source);
      const clutch = clutchCreatures.get(actor?.gameID);
      const startsGestation = clutch != null && event.spellID === clutch;
      const hardens = actor?.gameID === 265644 && event.spellID === hardening;
      if ((hardens || startsGestation) && event.type === 'cast' && !starts.has(actor.id)) {
        const anchor = sampleAnchor(actor, event.t);
        if (anchor) starts.set(actor.id, {
          actorId: actor.id, kind: hardens ? 'hardened-spawn' : 'clutch',
          label: actor.name, start: event.t, anchor, startEvent: event
        });
      }
      if ((hardens || startsGestation) && removeTypes.has(event.type)) {
        if (!endings.has(actor.id)) endings.set(actor.id, []);
        endings.get(actor.id).push(event);
      }
      if (event.type === 'death') {
        if (!endings.has(event.target)) endings.set(event.target, []);
        endings.get(event.target).push(event);
      }
    }
    const fieldEggs = [];
    const spawnAnchors = [];
    for (const position of starts.values()) {
      const samples = actors.get(position.actorId).points;
      const lastSample = samples.at(-1)[0];
      const endEvent = (endings.get(position.actorId) || []).find(event => event.t > position.start);
      // With no end event, we know only the observed interval. A single sample
      // is an instantaneous anchor, not proof that the egg stayed there.
      position.end = Math.min(duration, Math.max(position.start, endEvent?.t ?? lastSample));
      position.endReason = endEvent ? endEvent.type === 'death' ? 'death' : 'aura-removed' : 'observation-ended';
      position.endEvent = endEvent || null;
      (position.kind === 'clutch' ? fieldEggs : spawnAnchors).push(position);
    }
    return { fieldEggs, spawnAnchors };
  }

  function countEvents(all, start, end, endInclusive = false) {
    const includes = time => time >= start && (time < end || endInclusive && time === end);
    const eggPickups = { small: 0, large: 0 };
    for (const egg of all.eggs) if (includes(egg.start)) eggPickups[egg.kind]++;
    return {
      eggPickups,
      eggSplash: all.splash.filter(event => includes(event.t)).length,
      yolkApplications: all.yolk.filter(event => includes(event.t)).length,
      fangApplications: all.fangs.filter(interval => includes(interval.start)).length,
      fangRemovals: all.fangs.filter(interval => interval.endReason === 'removed' && includes(interval.end)).length,
      waveApplications: all.waves.filter(interval => includes(interval.start)).length,
      interrupts: all.interrupts.filter(event => includes(event.t)).length,
      soakCasts: all.soaks.filter(impact => includes(impact.t)).length,
      heartExposures: all.hearts.filter(window => includes(window.start)).length,
      deaths: all.deaths.filter(event => includes(event.t)).length
    };
  }

  function actorCounters(actors, all) {
    const counters = new Map();
    for (const actor of actors.values()) {
      if (actor.type !== 'Player') continue;
      counters.set(actor.id, {
        actorId: actor.id, name: actor.name, subType: actor.subType,
        eggPickups: { small: 0, large: 0 }, eggSplash: 0, eggCarryMs: 0,
        yolkApplications: 0, fangApplications: 0, waveApplications: 0,
        interrupts: 0, deaths: 0, coilAuras: 0
      });
    }
    for (const egg of all.eggs) {
      const counter = counters.get(egg.actorId);
      counter.eggPickups[egg.kind]++;
      counter.eggCarryMs += egg.end - egg.start;
    }
    for (const [records, key, actorField] of [
      [all.splash, 'eggSplash', 'target'], [all.yolk, 'yolkApplications', 'target'],
      [all.fangs, 'fangApplications', 'actorId'], [all.waves, 'waveApplications', 'actorId'],
      [all.interrupts, 'interrupts', 'source'], [all.deaths, 'deaths', 'target']
    ]) {
      for (const record of records) {
        const counter = counters.get(record[actorField]);
        if (counter) counter[key]++;
      }
    }
    for (const impact of all.soaks) {
      for (const id of impact.participants) counters.get(id).coilAuras++;
    }
    return counters;
  }

  function build(fight) {
    const length = fight.duration ?? (fight.endTime - fight.startTime);
    const duration = Number.isFinite(length) ? Math.max(0, length) : 0;
    const actors = new Map((fight.actors || []).map(actor => [actor.id, actor]));
    const events = (fight.events || []).filter(event => Number.isFinite(event?.t) && event.t >= 0 &&
      event.t <= duration).slice().sort((a, b) => a.t - b.t);
    const phases = (fight.phaseTransitions || []).filter(phase => Number.isFinite(phase?.t) &&
      phase.t >= 0 && phase.t <= duration).slice().sort((a, b) => a.t - b.t);
    if (phases[0]?.t !== 0) phases.unshift({ id: 1, t: 0 });
    const deathKeys = new Set();
    const deaths = events.filter(event => {
      if (event.type !== 'death' || actors.get(event.target)?.type !== 'Player') return false;
      const key = event.t + ':' + event.target;
      if (deathKeys.has(key)) return false;
      deathKeys.add(key);
      return true;
    });
    const casts = events.filter(event => event.type === 'cast' && event.spellID >= 1270000 &&
      actors.get(event.source)?.type === 'NPC' && actors.get(event.source)?.gameID > 0);
    const interrupts = events.filter(event => event.type === 'interrupt' &&
      actors.get(event.source)?.type === 'Player' && actors.get(event.target)?.type === 'NPC');
    const hostileIDs = new Set(casts.map(event => event.spellID));
    const all = {
      duration,
      ...collectIntervals(events, actors, duration),
      soaks: collectCoils(events, actors), casts, interrupts, deaths,
      events: events.map(event => ({
        ...event,
        kind: globalThis.M8Mechanics?.classify(event, hostileIDs) || 'other',
        phaseId: phases[lowerOrEqual(phases, event.t, phase => phase.t)]?.id ?? 1
      })),
      ...collectGroundAnchors(events, actors, duration),
      fieldEggsKnown: false,
      mapActors: [...actors.values()].filter(actor => actor.points?.length && mapRoles.has(actor.gameID))
        .map(actor => ({ actorId: actor.id, role: mapRoles.get(actor.gameID), gameID: actor.gameID }))
    };
    all.phases = phases.map((phase, index) => {
      const end = phases[index + 1]?.t ?? duration;
      return { id: phase.id, start: phase.t, end,
        counts: countEvents(all, phase.t, end, index === phases.length - 1) };
    });
    all.recap = countEvents(all, 0, duration, true);
    all.byActor = actorCounters(actors, all);
    return all;
  }

  function at(evidence, time) {
    const active = intervals => intervals.filter(interval => interval.start <= time && time < interval.end);
    const eggs = active(evidence.eggs);
    const nextCast = evidence.casts[lowerOrEqual(evidence.casts, time, event => event.t) + 1] || null;
    return {
      eggs: { small: eggs.filter(egg => egg.kind === 'small'),
        large: eggs.filter(egg => egg.kind === 'large') },
      heart: active(evidence.hearts)[0] || null,
      nextCast, activeFangs: active(evidence.fangs), activeWaves: active(evidence.waves),
      debuffs: active(evidence.debuffs), fieldEggs: active(evidence.fieldEggs),
      spawnAnchors: active(evidence.spawnAnchors)
    };
  }

  globalThis.M8Evidence = { build, at };
})();
