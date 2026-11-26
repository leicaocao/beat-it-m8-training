(() => {
  const GUARDIAN = 264045;
  const ROOM_ENEMIES = new Set([GUARDIAN, 263535, 261874, 268121, 269200]);
  const SIDES = ['east', 'west'];
  const STEP = 1000;
  const SAMPLE_GAP = 2400;

  function positionTrack(actor) {
    return (actor.points || []).filter(point => Number.isFinite(point?.[0]) &&
      Number.isFinite(point[1]) && Number.isFinite(point[2])).sort((a, b) => a[0] - b[0]);
  }

  function positionAt(points, time) {
    let left = 0;
    let right = points.length;
    while (left < right) {
      const middle = (left + right) >>> 1;
      if (points[middle][0] <= time) left = middle + 1;
      else right = middle;
    }
    const point = points[left - 1];
    return point && time - point[0] <= SAMPLE_GAP ? point : null;
  }

  function roomCenters(guardians, phaseStart, phaseEnd) {
    const arrivals = guardians.map(actor => ({ actorId: actor.id, point: actor.points[0] }))
      .filter(({ point }) => point && point[0] >= phaseStart - 4000 &&
        point[0] < Math.min(phaseEnd, phaseStart + 30000));
    let best = null;
    for (const east of arrivals) {
      for (const west of arrivals) {
        const dx = east.point[1] - west.point[1];
        const dy = Math.abs(east.point[2] - west.point[2]);
        if ((east.point[4] ?? 0) !== (west.point[4] ?? 0) ||
            dx < 6000 || dx <= dy * 2 || dx <= (best?.separation || 0)) continue;
        best = { east, west, separation: dx };
      }
    }
    return best;
  }

  function positionSide(point, geometry) {
    if (!point || (point[4] ?? 0) !== geometry.map) return null;
    const offset = point[1] - geometry.centerX;
    if (offset >= geometry.roomOffset) return 'east';
    if (offset <= -geometry.roomOffset) return 'west';
    return 'center';
  }

  function countsAt(tracks, geometry, time) {
    const counts = { east: 0, west: 0, center: 0 };
    for (const points of tracks.values()) {
      const side = positionSide(positionAt(points, time), geometry);
      if (side) counts[side]++;
    }
    return { time, ...counts };
  }

  function longestSplit(rows, minimumSide, minimumKnown) {
    let start = 0;
    let best = null;
    for (let index = 0; index < rows.length; index++) {
      const { east, west } = rows[index];
      if (east < minimumSide || west < minimumSide || east + west < minimumKnown) {
        start = index + 1;
      } else if (index - start > (best ? best.end - best.start : -1)) {
        best = { start, end: index };
      }
    }
    return best && best.end - best.start >= 7 ? best : null;
  }

  function observedRoom(pointTrack, geometry, start, end) {
    const votes = { east: 0, west: 0, center: 0 };
    let first = Infinity;
    let last = -Infinity;
    for (const point of pointTrack) {
      if (point[0] < start || point[0] > end) continue;
      const side = positionSide(point, geometry);
      if (!side) continue;
      votes[side]++;
      first = Math.min(first, point[0]);
      last = Math.max(last, point[0]);
    }
    if (last - first < 4000) return null;
    const total = votes.east + votes.west + votes.center;
    return SIDES.find(side => votes[side] >= 5 && votes[side] >= total * .8) || null;
  }

  function emptySide() {
    return { center: null, memberIds: [], enemyIds: [], guardianIds: [] };
  }

  function unavailable(reason) {
    return { start: null, end: null, through: null, endReason: null,
      sides: { east: emptySide(), west: emptySide() }, assignments: new Map(),
      confidence: 'unavailable', reason };
  }

  function build(fight) {
    const duration = fight.duration ?? (fight.endTime - fight.startTime);
    const phases = fight.phaseTransitions || [];
    const second = phases.find(phase => phase?.id === 2 && Number.isFinite(phase.t));
    if (!second || !Number.isFinite(duration) || second.t >= duration) return unavailable('no-p2');
    const phaseEnd = phases.reduce((end, phase) => phase?.t > second.t ? Math.min(phase.t, end) : end,
      duration);
    const actors = fight.actors || [];
    const enemies = actors.filter(actor => actor.type === 'NPC' && ROOM_ENEMIES.has(actor.gameID))
      .map(actor => ({ ...actor, points: positionTrack(actor) }));
    const centers = roomCenters(enemies.filter(actor => actor.gameID === GUARDIAN), second.t, phaseEnd);
    if (!centers) return unavailable('missing-anchors');
    // The two guardians enter on the same map, on opposite sides of the arena's center corridor.
    const geometry = {
      map: centers.east.point[4] ?? 0,
      centerX: (centers.east.point[1] + centers.west.point[1]) / 2,
      roomOffset: centers.separation * .25
    };
    const playerTracks = new Map(actors.filter(actor => actor.type === 'Player').map(actor =>
      [actor.id, positionTrack(actor)]));
    const minimumSide = Math.max(2, Math.ceil(playerTracks.size * .2));
    const minimumKnown = Math.max(4, Math.ceil(playerTracks.size * .65));
    const minimumCenter = Math.max(4, Math.ceil(playerTracks.size * .75));
    const rows = [];
    for (let time = Math.max(0, Math.floor((second.t - 4000) / STEP) * STEP);
      time <= phaseEnd; time += STEP) {
      rows.push(countsAt(playerTracks, geometry, time));
    }
    const split = longestSplit(rows, minimumSide, minimumKnown);
    if (!split) return unavailable('insufficient-positions');

    const sides = { east: emptySide(), west: emptySide() };
    for (const side of SIDES) {
      const { actorId, point } = centers[side];
      sides[side].center = { x: point[1], y: point[2], map: geometry.map };
      sides[side].guardianIds.push(actorId);
    }
    const assignments = new Map();
    for (const [id, points] of playerTracks) {
      const side = observedRoom(points, geometry, rows[split.start].time, rows[split.end].time);
      if (!side) continue;
      assignments.set(id, side);
      sides[side].memberIds.push(id);
    }
    if (SIDES.some(side => sides[side].memberIds.length < minimumSide)) {
      return unavailable('uncertain-roster');
    }

    let entry = split.start;
    while (entry > 0 && rows[entry - 1].east + rows[entry - 1].west >= minimumSide) entry--;
    const start = rows[entry].time;
    let end = null;
    let through = rows[split.end].time;
    const exitLimit = Math.min(rows.length - 1, split.end + 8);
    for (let index = split.end + 1; index <= exitLimit; index++) {
      const { time, east, west, center } = rows[index];
      if (east + west >= minimumSide) through = time;
      if (center >= minimumCenter && rows[index + 1]?.center >= minimumCenter) {
        end = time;
        through = time;
        break;
      }
    }
    const enemyTracks = new Map();
    for (const actor of enemies) {
      const found = actor.points[0];
      if (!found || found[0] < start - SAMPLE_GAP || found[0] > through) continue;
      const side = positionSide(found, geometry);
      if (side !== 'east' && side !== 'west') continue;
      sides[side].enemyIds.push(actor.id);
      enemyTracks.set(actor.id, actor.points);
    }
    const unassignedIds = [...playerTracks.keys()].filter(id => !assignments.has(id));
    const confidence = unassignedIds.length ? 'partial' : 'observed';
    const limitReason = phaseEnd < duration ? 'phase-ended' : 'recording-end';
    const endReason = end !== null ? 'returned' :
      (phaseEnd - through <= SAMPLE_GAP ? limitReason : 'coverage-ended');
    return { start, end, through, endReason, sides, assignments, confidence, unassignedIds, geometry,
      reason: confidence === 'observed' ? null : 'partial-roster', playerTracks, enemyTracks };
  }

  function at(split, time) {
    const active = split.start !== null && split.start <= time &&
      (split.end !== null ? time < split.end : time <= split.through);
    const observed = new Map();
    const observedEnemies = new Map();
    if (active) {
      for (const [tracks, locations] of [[split.playerTracks, observed], [split.enemyTracks, observedEnemies]]) {
        for (const [id, points] of tracks) {
          const side = positionSide(positionAt(points, time), split.geometry);
          if (side) locations.set(id, side);
        }
      }
    }
    return { active, sides: split.sides, observed, observedEnemies, confidence: split.confidence };
  }

  globalThis.M8RoomEvidence = { build, at };
})();
