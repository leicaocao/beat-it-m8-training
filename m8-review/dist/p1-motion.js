(() => {
  const mainBoss = 257758;
  const physicalTail = 259555;
  const spectralTail = 267418;
  const coil = 267679;
  const platform = 2610;
  const waveCast = 1298570;
  // Calibrated against a Hexweaver projectile overlay at 38-42s.
  // WCL positions use 100 units per yard. This is a visual path, not a hit test.
  const echoWave = { count: 7, step: Math.PI / 10, initialRadius: 1250, speed: 1.12, duration: 10000 };
  // Center-lane directions measured again on #41. Other origins still aim inward.
  const echoWaveHeading = new Map([['5483:155329', 178 * Math.PI / 180], ['3960:159316', -130 * Math.PI / 180]]);
  const supported = new Set([mainBoss, physicalTail, spectralTail]);
  const releases = new Set([1304012, 1298367, 1296301, 1299010, 1308927, waveCast, 1311807, 1319282]);
  const clamp = (n, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, n));
  const ease = n => { const t = clamp(n); return t * t * (3 - 2 * t); };
  const idOf = actor => Number(actor?.gameID);

  function build(fight) {
    const actors = new Map();
    const waves = [];
    const used = new Set();
    const releasesSeen = new Set();
    const pending = new Map();
    for (const e of fight.events) {
      if (!releases.has(e.spellID) || !['cast', 'begincast'].includes(e.type) ||
          Number(M8Model.phaseAt(fight, e.t)?.id) !== 1) continue;
      const actor = fight.actorById.get(e.source);
      const id = idOf(actor);
      const key = e.source + ':' + e.spellID;
      if (e.type === 'begincast') { pending.set(key, e.t); continue; }
      const mark = key + ':' + e.t;
      if (releasesSeen.has(mark)) continue;
      releasesSeen.add(mark);
      const began = pending.get(key);
      pending.delete(key);
      const release = { at: e.t, start: began != null && e.t - began < 10000 ? began : e.t, spellID: e.spellID };
      const physical = id === coil ? fight.mapUnits.find(({ actor: a, role }) => role === 'tail' &&
        M8Model.sampleMapUnit(a, role, e.t)?.map === platform)?.actor : actor;
      if (supported.has(idOf(physical))) {
        if (!actors.has(physical.id)) actors.set(physical.id, []);
        actors.get(physical.id).push(release);
      }
      if (id !== spectralTail || e.spellID !== waveCast) continue;
      const point = actor.points.find(([t, , , , map]) => Math.abs(t - e.t) < 750 && map === platform);
      if (!point) continue;
      const launch = [e.t, point[1], point[2]].join(':');
      if (used.has(launch)) continue;
      used.add(launch);
      waves.push({ ...release, x: point[1], y: point[2], map: platform, hp: point[3], actor: actor.id });
    }
    return { actors, waves };
  }

  function unitPoint(motion, actor, role, time) {
    if (!supported.has(idOf(actor))) return null;
    const sampled = M8Model.sampleMapUnit(actor, role, time);
    if (sampled?.map === platform) return sampled;
    const points = actor.points;
    const i = M8Model.at(points, time);
    const before = points[i];
    const after = points[i + 1];
    if (idOf(actor) === mainBoss) {
      const opening = i < 0 && time >= 0 && after?.[0] <= 6000 &&
        Math.hypot(after[1] - 123, after[2] - 159981) < 60;
      const a = opening ? after : before;
      const b = opening ? points[1] : after;
      if (a?.[4] === platform && b?.[4] === platform && a[1] === b[1] && a[2] === b[2]) {
        return { x: a[1], y: a[2], hp: a[3], map: a[4], held: true };
      }
    } else if (idOf(actor) === spectralTail) {
      const cue = motion.waves.find(item => item.actor === actor.id && item.start <= time && time < item.at);
      if (cue) return { ...cue, opacity: .22 + .34 * ease((time - cue.start) / 450) };
    }
    return null;
  }

  function pose(motion, id, time) {
    let charge = 0;
    let swing = 0;
    for (const { start, at } of motion.actors.get(id) || []) {
      if (start <= time && time < at) charge = Math.max(charge, ease((time - start) / Math.max(1, at - start)));
      const dt = (time - at) / 760;
      if (dt >= 0 && dt < 1) swing = Math.max(swing, Math.sin(Math.PI * Math.pow(dt, .6)) * (1 - .32 * dt));
    }
    return { charge, swing, breath: Math.sin(time / 335 + id * .71), time };
  }

  function originalPose(motion, id, role, time) {
    const action = (name, start, loop = false) => ({ name, seconds: Math.max(0, time - start) / 1000, loop });
    const events = motion.actors.get(id) || [];
    for (let i = events.length - 1; i >= 0; i--) {
      const { start, at, spellID } = events[i];
      if (time < start) continue;
      if (role !== 'boss') {
        const tailSlam = spellID === 1296301;
        const wave = spellID === waveCast || spellID === 1311807;
        if (!tailSlam && !wave) continue;
        const strike = Math.max(start, at - (tailSlam ? 1370 : 810));
        if (time < strike) return action('a25', start, true);
        if (time < at + (tailSlam ? 480 : 920)) return action(tailSlam ? 'a213' : 'a16', strike);
      } else if (spellID === 1304012 && time < Math.max(at, start + 4000)) {
        return action('a218', start);
      } else if (spellID === 1298367 && time < at) {
        return time < start + 1600 ? action('a53', start) : action('a51', start + 1600, true);
      } else if (spellID === 1319282 && time < at + 1700) {
        if (time < start + 2250) return action('a55', start);
        return time < at ? action('a213', start + 2250, true) : action('a213', at);
      }
    }
    return action(role === 'boss' ? 'a25' : 'a0', 0, true);
  }

  function wavelets(motion, time, bounds) {
    if (!bounds) return [];
    const crests = [];
    for (const cue of motion.waves) {
      const age = time - cue.at;
      if (age < 0 || age > echoWave.duration) continue;
      const axis = echoWaveHeading.get(cue.x + ':' + cue.y) ?? Math.atan2(bounds.cy - cue.y, bounds.cx - cue.x);
      const radius = echoWave.initialRadius + age * echoWave.speed;
      const alpha = ease(age / 320) * ease((echoWave.duration - age) / 1200);
      const side = (echoWave.count - 1) / 2;
      for (let lane = -side; lane <= side; lane++) {
        const angle = axis + lane * echoWave.step;
        crests.push({ x: cue.x + Math.cos(angle) * radius, y: cue.y + Math.sin(angle) * radius,
          angle: -angle, alpha, age: age / 1000 });
      }
    }
    return crests;
  }

  globalThis.M8P1Motion = { build, unitPoint, pose, originalPose, wavelets };
})();
