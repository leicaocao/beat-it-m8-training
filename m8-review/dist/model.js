(() => {
  const trackGap = 3000;
  const at = (values, time, getter = value => value[0]) => {
    let left = 0;
    let right = values.length;
    while (left < right) {
      const middle = (left + right) >>> 1;
      if (getter(values[middle]) <= time) left = middle + 1;
      else right = middle;
    }
    return left - 1;
  };

  function normalize(report) {
    if (report?.version !== 1 || Number(report.encounterID) !== 3492 || !Array.isArray(report.fights)) {
      throw new Error('请选择 M8 复盘 JSON（乌拉特克，首领编号 3492）。');
    }
    const fights = report.fights.map(fight => {
      const duration = fight.endTime - fight.startTime;
      if (!Number.isFinite(duration) || duration <= 0 || !Number.isInteger(fight.id)) {
        throw new Error('复盘文件包含无效的战斗时间。');
      }
      const inFight = time => Number.isFinite(time) && time >= 0 && time <= duration;
      const actors = (fight.actors || []).filter(actor => Number.isInteger(actor.id)).map(actor => ({
        ...actor,
        points: (actor.points || []).filter(point => Array.isArray(point) && inFight(point[0]) &&
          Number.isFinite(point[1]) && Number.isFinite(point[2])).sort((a, b) => a[0] - b[0])
      }));
      const events = (fight.events || []).filter(event => event && inFight(event.t))
        .sort((a, b) => a.t - b.t);
      const phaseTransitions = (fight.phaseTransitions || []).filter(phase => phase && inFight(phase.t))
        .sort((a, b) => a.t - b.t);
      if (phaseTransitions[0]?.t !== 0) phaseTransitions.unshift({ id: 1, t: 0 });
      const actorById = new Map(actors.map(actor => [actor.id, actor]));
      const players = actors.filter(actor => actor.type === 'Player');
      const deaths = events.filter(event => event.type === 'death' && actorById.get(event.target)?.type === 'Player');
      const deathsByActor = new Map();
      const shellChanges = new Map();
      for (const event of events) {
        if (event.spellID === 1307612 && actorById.get(event.target)?.type === 'Player' &&
            ['applybuff', 'applydebuff', 'removebuff', 'removedebuff'].includes(event.type)) {
          if (!shellChanges.has(event.target)) shellChanges.set(event.target, []);
          shellChanges.get(event.target).push(event);
        }
        if (!['death', 'resurrect'].includes(event.type)) continue;
        if (!deathsByActor.has(event.target)) deathsByActor.set(event.target, []);
        deathsByActor.get(event.target).push(event);
      }
      return {
        ...fight, duration, actors, actorById, players, deaths, deathsByActor, shellChanges,
        events, phaseTransitions, bounds: mapBounds(players)
      };
    }).sort((a, b) => a.startTime - b.startTime);
    if (!fights.length) throw new Error('这份数据里没有 M8 战斗。');
    return { ...report, fights };
  }

  function sample(points, time) {
    const index = at(points, time);
    const current = points[index];
    const next = points[index + 1];
    if (!current || time - current[0] > trackGap) return null;
    const [, x, y, hp, map = 0] = current;
    if (!next || (next[4] ?? 0) !== map || next[0] - current[0] > trackGap ||
        next[0] === current[0]) return { x, y, hp, map, sampled: time === current[0] };
    const alpha = (time - current[0]) / (next[0] - current[0]);
    return { x: x + (next[1] - x) * alpha, y: y + (next[2] - y) * alpha, hp, map, sampled: alpha === 0 };
  }

  function mapBounds(players) {
    const positions = new Map();
    for (const actor of players) {
      for (const point of actor.points) {
        const map = point[4] ?? 0;
        if (!positions.has(map)) positions.set(map, { x: [], y: [] });
        positions.get(map).x.push(point[1]);
        positions.get(map).y.push(point[2]);
      }
    }
    return new Map([...positions].map(([map, values]) => {
      const extent = array => {
        array.sort((a, b) => a - b);
        const trim = array.length >= 500 ? Math.floor(array.length * .002) : 0;
        const min = array[trim];
        const max = array[array.length - 1 - trim];
        return [(min + max) / 2, Math.max(1, max - min)];
      };
      const [cx, spanX] = extent(values.x);
      const [cy, spanY] = extent(values.y);
      return [map, { cx, cy, spanX, spanY }];
    }));
  }

  function phaseAt(fight, time) {
    return fight.phaseTransitions[at(fight.phaseTransitions, time, phase => phase.t)];
  }

  function isDead(fight, actor, time) {
    const changes = fight.deathsByActor.get(actor.id) || [];
    const last = changes[at(changes, time, event => event.t)];
    if (last?.type !== 'death') return false;
    const point = actor.points[at(actor.points, time)];
    return !point || point[0] <= last.t || !(point[3] > 0);
  }

  function firstFrame(fight) {
    const samples = fight.players.map(actor => actor.points[0]?.[0]).filter(Number.isFinite).sort((a, b) => a - b);
    const index = Math.max(0, Math.ceil(samples.length * .65) - 1);
    return Math.min(fight.duration, 1500, samples[index] ?? 0);
  }

  function hasShell(fight, id, time) {
    const changes = fight.shellChanges.get(id) || [];
    const last = changes[at(changes, time, event => event.t)];
    if (!last || !last.type.startsWith('apply')) return false;
    const deaths = fight.deathsByActor.get(id) || [];
    return !deaths.some(event => event.type === 'death' && event.t >= last.t && event.t <= time);
  }

  const timeLabel = ms => {
    const seconds = Math.floor(ms / 1000);
    return Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
  };
  globalThis.M8Model = { at, normalize, sample, phaseAt, isDead, hasShell, firstFrame, timeLabel };
})();
