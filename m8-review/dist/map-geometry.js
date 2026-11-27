(() => {
  const anchorMap = 2610;
  const anchorNpc = 267418;
  const physicalTail = 259555;
  const wretch = 263942;
  const artEdgeRatio = .44;
  const tailWaterRatio = .474;
  const p1Center = [-1, 155370];
  const p1SideTails = [[-4082, 155360], [3986, 155329]];
  // Hexweaver pull #17: paired WCL player samples with map pixels, then
  // measured the platform rim. The DreamForge art's rim is 1064 px wide.
  const p1UnitsPerPixel = 3780 / 532;
  const p1CropPixels = 1064 * 469 / 415;
  // Eight stationary Rattler spawn coordinates observed in the guild report
  // and the public sample. Each pair faces across the same P1 arena.
  const anchorPairs = [
    [[-5585, 155360], [5483, 155329]],
    [[-9, 160976], [-7, 149757]],
    [[-3972, 151380], [3960, 159316]],
    [[3850, 151439], [-3954, 159287]],
  ];
  // P3 uses a separately observed set of fixed Rattler anchors.
  const finalPairs = [
    [[5074, 157440], [-5163, 153236]],
    [[2137, 160540], [-2147, 150174]],
    [[-2161, 160555], [2133, 150194]],
    [[-5162, 157483], [5053, 153222]],
  ];
  const arenaPairs = new Map([['1', anchorPairs], ['4', finalPairs]]);
  const arenaPoints = new Map([...arenaPairs].map(([phase, pairs]) => [phase, pairs.flat()]));
  const recurringCoil = 267679;
  const mapKey = value => Number.isSafeInteger(Number(value)) ? Number(value) : 0;
  const phaseKey = value => String(value ?? 1);
  const median = numbers => {
    const sorted = numbers.slice().sort((a, b) => a - b);
    const middle = sorted.length >>> 1;
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  };

  function collect(table, key, actor, x, y) {
    if (!table.has(key)) table.set(key, { players: [[], []], npcs: [[], []] });
    const sides = table.get(key)[actor.type === 'Player' ? 'players' : 'npcs'];
    sides[0].push(x);
    sides[1].push(y);
  }

  function measuredBounds(bucket, source) {
    const hasPlayers = bucket.players[0].length > 0;
    const [x, y] = hasPlayers ? bucket.players : bucket.npcs;
    const extent = values => {
      values.sort((a, b) => a - b);
      // Trim a small number of anomalous samples in large sets. Small
      // encounters retain every recorded position.
      const trim = values.length >= 500 ? Math.floor(values.length * .005) : 0;
      const low = values[trim];
      const high = values[values.length - trim - 1];
      return [(low + high) / 2, Math.max(1, high - low)];
    };
    const [cx, spanX] = extent(x);
    const [cy, spanY] = extent(y);
    return { cx, cy, spanX, spanY, source: hasPlayers ? source : source + '-npc' };
  }

  function fitArt(base, art, source) {
    const { cx, cy, span } = art;
    return {
      cx, cy,
      spanX: Math.max(span, 2 * Math.abs(base.cx - cx) + base.spanX),
      spanY: Math.max(span, 2 * Math.abs(base.cy - cy) + base.spanY),
      art, source,
    };
  }

  function mapOffset(bounds, x, y) {
    return [x - bounds.cx, bounds.cy - y];
  }

  function fitP1Platform(base) {
    const [cx, cy] = p1Center;
    const art = { cx, cy, span: p1CropPixels * p1UnitsPerPixel,
      nativeSize: [2123 * p1UnitsPerPixel, 1188 * p1UnitsPerPixel] };
    return { ...fitArt(base, art, 'p1-reference-platform'), raw: base };
  }

  function p1SoakRing(bounds, anchor) {
    if (bounds?.source !== 'p1-reference-platform' || anchor?.map !== anchorMap) return null;
    const dx = anchor.x - bounds.cx;
    const dy = anchor.y - bounds.cy;
    const distance = Math.hypot(dx, dy);
    if (!Number.isFinite(distance) || distance < 4200 || distance > 6100) return null;
    // The soak is inward of the logged coil actor. Fit from the two visible
    // rings in the reference replay, not a replacement for the WCL position.
    const shift = 2000 / distance;
    return { x: anchor.x - dx * shift, y: anchor.y - dy * shift, radius: 1050 };
  }

  function calibratedArena(base, observed, pairs, phase) {
    if (observed.size < 6) return base;
    const confirmedPairs = pairs.filter(pair => pair.every(point => observed.has(point)));
    if (!confirmedPairs.includes(pairs[0]) || confirmedPairs.length < 2) return base;

    const centers = confirmedPairs.map(([a, b]) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
    const cx = median(centers.map(center => center[0]));
    const cy = median(centers.map(center => center[1]));
    const radius = median([...observed].map(([x, y]) => Math.hypot(x - cx, y - cy)));
    return fitArt(base, { cx, cy, span: radius / artEdgeRatio }, 'p' + (phase === '4' ? '3' : '1') + '-npc-anchors');
  }

  function prepare(report) {
    const phases = new Map();
    const maps = new Map();
    const observed = new Map([['1', new Set()], ['4', new Set()]]);
    const coils = new Map([['1', new Set()], ['3', new Set()]]);
    let p1TailObserved = false;
    let p1CenterObserved = false;
    const mayUseArt = Number(report?.encounterID) === 3492;
    for (const fight of report?.fights || []) {
      const transitions = (fight.phaseTransitions || []).filter(phase => Number.isFinite(phase?.t))
        .sort((a, b) => a.t - b.t);
      for (const actor of fight.actors || []) {
        if (actor.type !== 'Player' && actor.type !== 'NPC') continue;
        for (const point of actor.points || []) {
          if (!Array.isArray(point)) continue;
          const [time, x, y, , rawMap] = point;
          if (![time, x, y].every(Number.isFinite) || time < 0) continue;
          const map = mapKey(rawMap);
          const phase = phaseKey(transitions.findLast(transition => transition.t <= time)?.id);
          collect(phases, phase + ':' + map, actor, x, y);
          collect(maps, map, actor, x, y);
          if (!mayUseArt || map !== anchorMap) continue;
          if (phase === '1') {
            const matches = ([ax, ay]) => Math.hypot(x - ax, y - ay) <= 60;
            if (!p1TailObserved && Number(actor.gameID) === physicalTail && p1SideTails.some(matches)) p1TailObserved = true;
            if (!p1CenterObserved && Number(actor.gameID) === wretch && matches(p1Center)) p1CenterObserved = true;
          }
          if (Number(actor.gameID) === anchorNpc) {
            const anchor = arenaPoints.get(phase)?.find(([ax, ay]) => Math.hypot(x - ax, y - ay) <= 60);
            if (anchor) observed.get(phase).add(anchor);
          }
          if (Number(actor.gameID) === recurringCoil) coils.get(phase)?.add(x + ':' + y);
        }
      }
    }
    const phaseBounds = new Map([...phases].map(([key, bucket]) => [key, measuredBounds(bucket, 'wcl-grid')]));
    const p1Key = '1:' + anchorMap;
    const p1Raw = phaseBounds.get(p1Key);
    for (const [phase, pairs] of arenaPairs) {
      const key = phase + ':' + anchorMap;
      const base = phaseBounds.get(key);
      if (base) phaseBounds.set(key, calibratedArena(base, observed.get(phase), pairs, phase));
    }
    const opener = phaseBounds.get(p1Key);
    const transitionKey = '3:' + anchorMap;
    const transition = phaseBounds.get(transitionKey);
    const shared = [...coils.get('3')].filter(point => coils.get('1').has(point));
    if (opener?.art && transition && shared.length >= 3) {
      phaseBounds.set(transitionKey, fitArt(transition, opener.art, 'transition-coil-anchors'));
    }
    if (p1Raw && p1TailObserved && p1CenterObserved) phaseBounds.set(p1Key, fitP1Platform(p1Raw));
    return {
      phaseBounds,
      mapBounds: new Map([...maps].map(([map, bucket]) => [map, measuredBounds(bucket, 'wcl-map-fallback')])),
    };
  }

  function view(geometry, phaseId, mapId) {
    const map = mapKey(mapId);
    return geometry?.phaseBounds?.get(phaseKey(phaseId) + ':' + map) ||
      geometry?.mapBounds?.get(map) || null;
  }

  function tailWaterMarker(art, point) {
    if (!art || art.nativeSize) return point;
    const dx = point.x - art.cx;
    const dy = point.y - art.cy;
    const octagonDistance = Math.max(Math.abs(dx), Math.abs(dy), (Math.abs(dx) + Math.abs(dy)) * Math.SQRT1_2);
    if (!octagonDistance || octagonDistance >= art.span * tailWaterRatio) return point;
    const scale = art.span * tailWaterRatio / octagonDistance;
    return { ...point, x: art.cx + dx * scale, y: art.cy + dy * scale };
  }

  globalThis.M8MapGeometry = { prepare, view, mapOffset, tailWaterMarker, p1SoakRing };
})();
