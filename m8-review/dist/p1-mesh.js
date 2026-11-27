(() => {
  const PI = Math.PI;
  const waveHalfSpan = 31;
  const waveScreenScale = pixelsPerUnit => pixelsPerUnit * 520 / (2 * waveHalfSpan);
  const mix = (a, b, t) => a + (b - a) * t;
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const unit = a => { const n = Math.hypot(...a) || 1; return a.map(v => v / n); };
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const limit = n => Math.max(0, Math.min(1, n));
  const pigment = (a, b, t) => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];
  const palette = new Map();
  function ink(hex) {
    if (!palette.has(hex)) palette.set(hex, [16, 8, 0].map(shift => ((hex >> shift) & 255) / 255));
    return palette.get(hex);
  }

  function spline(nodes, steps) {
    return Array.from({ length: steps + 1 }, (_, i) => {
      const x = i / steps * (nodes.length - 1);
      const k = Math.min(Math.floor(x), nodes.length - 2), t = x - k;
      const a = nodes[Math.max(0, k - 1)], b = nodes[k], c = nodes[k + 1], d = nodes[Math.min(k + 2, nodes.length - 1)];
      return b.map((v, j) => {
        const value = v + .5 * t * (c[j] - a[j] + t * (2 * a[j] - 5 * v + 4 * c[j] - d[j] +
          t * (3 * v - a[j] - 3 * c[j] + d[j])));
        return j > 2 ? Math.max(.11, value) : value;
      });
    });
  }

  class Mesh {
    constructor() {
      this.data = new Float32Array(65536);
      this.length = 0;
    }

    place({ x, y, angle, size, alpha = 1 }) {
      this.x = x; this.y = y; this.s = size; this.a = alpha;
      this.c = Math.cos(angle); this.d = Math.sin(angle);
    }

    triangle(a, b, c, shine) {
      if (this.length + 33 > this.data.length) {
        const next = new Float32Array(this.data.length * 2);
        next.set(this.data);
        this.data = next;
      }
      for (const [p, n, color] of [a, b, c]) {
        let i = this.length;
        this.data[i++] = this.x + this.s * (p[0] * this.c - p[1] * this.d);
        this.data[i++] = this.y + this.s * (p[0] * this.d + p[1] * this.c);
        this.data[i++] = this.s * p[2];
        this.data[i++] = n[0] * this.c - n[1] * this.d;
        this.data[i++] = n[0] * this.d + n[1] * this.c;
        this.data[i++] = n[2];
        this.data[i++] = color[0]; this.data[i++] = color[1]; this.data[i++] = color[2];
        this.data[i++] = this.a;
        this.data[i++] = shine;
        this.length = i;
      }
    }

    knit(rows, shine = .1) {
      for (let i = 1; i < rows.length; i++) for (let j = 1; j < rows[i].length; j++) {
        const a = rows[i - 1][j - 1], b = rows[i][j - 1], c = rows[i - 1][j], d = rows[i][j];
        this.triangle(a, b, c, shine);
        this.triangle(b, d, c, shine);
      }
    }

    tube(nodes, swatch, sides = 10, shine = .18, axis) {
      const rows = nodes.map((p, i) => {
        const tangent = unit(sub(nodes[Math.min(nodes.length - 1, i + 1)], nodes[Math.max(0, i - 1)]));
        const alignment = axis ? dot(tangent, axis) : 1;
        const right = unit(Math.abs(alignment) < .985 ? axis.map((v, k) => v - tangent[k] * alignment) :
          Math.abs(tangent[2]) > .985 ? cross([0, 1, 0], tangent) : cross([0, 0, 1], tangent));
        const lift = cross(tangent, right);
        return Array.from({ length: sides + 1 }, (_, j) => {
          const c = Math.cos(j / sides * 2 * PI), s = Math.sin(j / sides * 2 * PI);
          const pos = right.map((r, k) => p[k] + r * p[3] * c + lift[k] * p[4] * s);
          const normal = unit(right.map((r, k) => r * c / Math.max(.2, p[3]) + lift[k] * s / Math.max(.2, p[4])));
          return [pos, normal, swatch(i / (nodes.length - 1), s, i, j % sides)];
        });
      });
      this.knit(rows, shine);
    }

    bulb(p, r, color, shine = .18, sides = 10) {
      const nodes = Array.from({ length: 8 }, (_, i) => {
        const a = i / 7 * PI;
        const s = Math.max(.025, Math.sin(a));
        return [p[0] - r[0] * Math.cos(a), p[1], p[2], r[1] * s, r[2] * s];
      });
      this.tube(nodes, (_, s) => pigment(color, ink(0x151e21), Math.max(0, -s) * .4), sides, shine);
    }

    skin(fn, color, n, m, finish = .11) {
      const rows = [];
      for (let i = 0; i <= n; i++) {
        const row = [];
        for (let j = 0; j <= m; j++) {
          const t = i / n, s = j / m;
          const p = fn(t, s);
          const a = sub(fn(t + .002, s), fn(t - .002, s));
          const b = sub(fn(t, s + .002), fn(t, s - .002));
          const normal = unit(cross(a, b));
          if (normal[2] < 0) for (let k = 0; k < 3; k++) normal[k] = -normal[k];
          row.push([p, normal, color(t, s)]);
        }
        rows.push(row);
      }
      this.knit(rows, finish);
    }
  }

  function tail(mesh, pose, ghost) {
    const xBend = pose.swing * 43 - pose.charge * 19;
    const yBend = Math.sin(pose.time / 460) * 7 + pose.swing * 26;
    const zBend = 8 * pose.charge - 24 * pose.swing;
    const across = [0, 1, 0];
    const root = ink(ghost ? 0x4b8391 : 0x413e32);
    const ivory = ink(ghost ? 0xb4f8e8 : 0xc1b477);
    const olive = ink(ghost ? 0x25545e : 0x293516);
    const toxin = ink(ghost ? 0x83d7df : 0x99bd19);
    const flash = ink(ghost ? 0xcbfff3 : 0xe1f654);
    const spine = spline([
      [-4, 0, -6, 8, 7], [-4, 0, 11, 12, 11], [-3, 1, 29, 10.2, 9.3],
      [2 + xBend * .13, 2 + yBend * .18, 49 + zBend * .27, 13, 10],
      [11 + xBend * .51, yBend * .58, 69 + zBend * .63, 12.5, 8.6],
      [24 + xBend, yBend, 81 + zBend, 7, 6],
    ], 35);
    mesh.tube(spine, (t, h, i, j) => {
      const chevron = .72 + .24 * Math.sin(i * 2.18 - 2.1 * Math.abs(Math.cos(j / 14 * PI * 2)));
      const base = pigment(root, ivory, limit(chevron + Math.max(0, -h) * .16));
      return pigment(base, pigment(olive, toxin, .42 + .18 * Math.sin(i * 2.18)), limit((t - .34) * 2.9));
    }, 14, .3, across);

    for (let row = 0; row < 6; row++) {
      const [x, y, z] = spine[14 + row * 3];
      const spread = 1 + .27 * Math.sin(row / 6 * PI);
      for (const side of [-1, 1]) {
        const plate = spline([
          [x + 6, y + side * 4, z - 5, 2.8, 3.5],
          [x + 4, y + side * 13 * spread, z - .8, 6, 4.4],
          [x + 1, y + side * 20 * spread, z + 6, 4.9, 2.8],
          [x + 6 + row * .95, y + side * (25 * spread - row * .7), z + 15, .15, .13],
        ], 7);
        mesh.tube(plate, (t, h, i, j) => pigment(olive, pigment(toxin, flash, t * .46),
          limit(.47 + .34 * t + .17 * h + .09 * Math.cos(i * 1.65 + j * 2.1))), 8, .37);
      }
    }

    const [x, y, z] = spine.at(-1);
    const sickle = spline([
      [x - 8, y, z - 5, 5.1, 6.0], [x - 6, y - 1, z + 9, 8.9, 10],
      [x + 8, y - 2, z + 16, 11.3, 9.4], [x + 25, y - 3, z + 12, 8.4, 7.5],
      [x + 41, y - 5, z + 3, 5.3, 4.6], [x + 51, y - 6, z - 15, .19, .16],
    ], 16);
    mesh.tube(sickle, (t, h, i, j) => pigment(olive, pigment(toxin, flash, .22 + t * .72),
      limit(.61 + .24 * Math.max(0, -h) + .18 * Math.sin(t * PI) + .065 * Math.sin(i * 17 + j * 4))), 12, .53, across);
    mesh.tube(spline([[x + 3, y + 2, z - 12, 4.4, 5], [x + 14, y + 4, z - 8, 4.3, 2.9],
      [x + 26, y + 2, z - 13, 2.1, 1.8], [x + 32, y - 1, z - 21, .14, .13]], 8),
    (t, h) => pigment(olive, flash, limit(.44 + t * .52 - h * .12)), 8, .43, across);
  }

  function wings(mesh, p) {
    const membrane = ink(0x131c39), fringe = ink(0x3c3261), bone = ink(0x806fa0);
    const scaleDark = ink(0x14251d), scaleGreen = ink(0x78951f), scaleEdge = ink(0xc3dd48);
    for (const side of [-1, 1]) {
      const flap = (p.breath * .66 + Math.sin(p.time / 510 + side * .38) * .34) * 12 + p.charge * 16 - p.swing * 22;
      const fin = (q, s) => {
        const t = Math.max(0, Math.min(1.002, q));
        const span = t * (156 - Math.abs(flap) * .26);
        const ridge = 42 - Math.sin(t * PI) * 25 + 43 * t * t;
        const scallop = 1 - (.10 + t * .32) * Math.pow(Math.sin(t * PI * 5.5), 2);
        const chord = (15 + 26 * Math.sin(t * PI) + 8 * t) * (1 - Math.pow(t, 7)) * scallop;
        return [ridge + chord * s, side * (8 + span - s * 6 * Math.sin(t * PI)),
          36 + flap * t + 15 * Math.sin(t * PI) - 10 * s + 4 * Math.sin(s * PI) - 21 * t * t];
      };
      mesh.skin(fin, (t, s) => pigment(membrane, fringe,
        .12 + .30 * Math.pow(s, 2) + (.08 + .21 * t) * (.5 + .5 * Math.cos(t * 13 * PI - s * 3))), 16, 7);
      const edge = Array.from({ length: 16 }, (_, i) => {
        const t = i / 15;
        const r = mix(2.9, .26, t);
        return [...fin(t, .03), r, r * .7];
      });
      mesh.tube(edge, (t, s) => pigment(bone, fringe, t * .58 + .1 * s), 8, .24);
      const vein = Array.from({ length: 11 }, (_, i) => {
        const t = .27 + i / 10 * .68;
        const point = fin(t, .27 + .18 * Math.sin(t * PI));
        return [point[0], point[1], point[2] + .5, .62, .24];
      });
      mesh.tube(vein, t => pigment(membrane, bone, t * .5 + .22), 5, .35);
      for (const t of [.17, .34, .52, .72, .89]) {
        const rib = Array.from({ length: 6 }, (_, i) => {
          const s = i / 5;
          const point = fin(t + s * .012, s);
          return [point[0], point[1], point[2] + .44, mix(1.1, .14, s), mix(.66, .12, s)];
        });
        mesh.tube(rib, (_, s) => pigment(bone, membrane, .62 - s * .24), 6, .18);
      }

      // Narrow overlapping scutes run along the outer half of each swept wing.
      for (let i = 0; i < 10; i++) {
        const t = .28 + i * .059;
        const root = fin(t, .13);
        const shoulder = fin(t + .05, .26);
        const middle = fin(t + .093, .47);
        const tip = fin(t + .12, .72);
        const curl = 6 * Math.sin(i * 1.73);
        const plate = spline([
          [root[0] - 7, root[1], root[2] + 5, 1.4, .9],
          [shoulder[0] - 2, shoulder[1] + side * 2, shoulder[2] + 7, 4.3, 2.6],
          [middle[0] + 8, middle[1] + side * 7, middle[2] + 4, 2.8, 1.7],
          [tip[0] + 13 + curl, tip[1] + side * 11, tip[2] + 1, .2, .13],
        ], 7);
        mesh.tube(plate, (u, h, k, j) => pigment(scaleDark, pigment(scaleGreen, scaleEdge, limit(u * .7 + h * .12)),
          limit(.26 + .52 * Math.max(0, h) + .22 * u + .11 * Math.sin(k * 3.2 + j))), 8, .54);
        if (i % 2 === 0) {
          const dark = plate.map(([x, y, z, a, b], k) => [x + 7 + k * 1.1, y - side * 3, z - 3, a * .68, b * .7]);
          mesh.tube(dark, (u, h) => pigment(fringe, scaleDark, limit(.53 + h * .24 + .16 * u)), 6, .25);
        }
      }
    }
  }

  const hydraBack = ink(0x293659), hydraScales = ink(0x758ab6), hydraBelly = ink(0xd6ca65);
  const crownDark = ink(0x583761), crownLight = ink(0xb27eaa);
  const necks = [
    { size: 1.17, points: [[34, 0, 42, 10, 9], [41, -2, 65, 8, 7], [52, -5, 87, 6.4, 6.5],
      [71, -3, 91, 6.8, 6], [92, -2, 83, 5.8, 5.8]] },
    { size: .94, points: [[32, -7, 41, 8, 8], [39, -15, 60, 6.7, 6.4], [57, -26, 69, 5.6, 5.8],
      [73, -34, 62, 5.6, 5.2], [91, -35, 54, 5.2, 5]] },
    { size: .98, points: [[34, 8, 41, 8, 8], [44, 17, 58, 7, 6.7], [59, 26, 65, 6, 5.9],
      [73, 33, 57, 5.8, 5.7], [96, 36, 53, 5.3, 5.3]] },
    { size: .89, points: [[36, -8, 39, 7.8, 7.5], [49, -17, 40, 7, 6.6], [67, -27, 46, 5.8, 5.4],
      [88, -32, 39, 5.9, 5.6], [116, -18, 32, 5, 4.9]] },
    { size: .92, points: [[36, 8, 39, 7.6, 7.3], [51, 17, 39, 6.8, 6.6], [66, 26, 43, 5.7, 5.4],
      [91, 31, 37, 5.5, 5.6], [110, 18, 29, 5.2, 4.9]] },
  ];

  function serpentHead(mesh, tip, direction, size, attack) {
    const [x, y, z] = tip;
    const [fx, fy] = direction;
    const axis = [-fy, fx, 0];
    const local = (f, s, h, a, b) => [x + size * (f * fx + s * axis[0]),
      y + size * (f * fy + s * axis[1]), z + size * h, a * size, b * size];
    const skin = (t, h, i, j) => pigment(hydraBack, hydraScales, .27 + .37 * Math.max(0, h) + .10 * Math.sin(i * 4.8 + j));
    mesh.tube(spline([
      local(-8, 0, .4, 4.8, 4.5), local(-2, 0, 2.7, 8.2, 6.5), local(5, 0, 1.9, 7.1, 5.6),
      local(10, 0, .7, 5.6, 3.7), local(17, 0, -.5, 4.8, 2.2), local(20, 0, -1.7, 1, .65),
    ], 11), skin, 12, .36, axis);
    const jaw = 1.3 * attack;
    mesh.tube(spline([local(0, 0, -3, 6.2, 2.6), local(7, 0, -4.5 - jaw, 5.5, 2.7),
      local(15, 0, -4.2 - jaw, 4.3, 1.85), local(18, 0, -3.7 - jaw, .32, .3)], 8),
    (_, h) => pigment(ink(0x262a21), hydraBelly, .69 - h * .24), 10, .21, axis);

    for (const side of [-1, 1]) {
      mesh.tube([local(11, side * 5.1, 2.4, 1.1, .78), local(7, side * 6.4, 3.6, 1.6, 1.06),
        local(3, side * 6.2, 4.5, .22, .18)], (_, h) => pigment(hydraScales, hydraBack, .3 - h * .18), 6, .24, axis);
      mesh.tube([local(7.5, side * 7.1, 2.5, .17, .2), local(8.8, side * 6.8, 2.37, .82, .72),
        local(10.3, side * 5.96, 1.75, .17, .22)], () => ink(0xeafa85), 7, .92, axis);
      mesh.tube([local(12.8, side * 4.8, -2.5, .66, .61),
        local(14.3, side * 4.5, -5.35 - jaw * .6, .11, .12)], () => ink(0xe7dda4), 5, .23, axis);
    }
    for (let j = -2; j <= 2; j++) {
      const h = 17 - Math.abs(j) * 2.8, s = j * 2.9;
      mesh.tube(spline([local(1, s, 5.4, 1.5, 1.25), local(-2 - Math.abs(j), s * 1.45, h * .7, 1.9, 1.45),
        local(-8 - Math.abs(j) * 1.5, s * 1.72, h, .15, .13)], 5),
      (t, h) => pigment(crownDark, crownLight, limit(.12 + .67 * t + h * .16)), 5, .32, axis);
    }
  }

  function boss(mesh, p) {
    wings(mesh, p);
    const trunk = spline([[-6, 0, -11, 8, 6], [4, 0, 1, 13, 9], [10, 1, 16, 11, 10],
      [22, 0, 31, 12.7, 10.3], [35, 0, 39, 14, 11], [47, 0, 41, 8.4, 7]], 23);
    mesh.tube(trunk, (t, h, i, j) => pigment(pigment(hydraBack, hydraScales, .17 + .30 * Math.max(0, h)),
      hydraBelly, limit(.31 - .59 * h + .1 * Math.cos(i * 2.1 + Math.abs(j - 6) * .45))), 14, .33, [0, 1, 0]);

    for (const [i, neck] of necks.entries()) {
      const motion = p.time / 390 + i * 1.42;
      const thrust = p.swing * (i === 0 ? 17 : 12) - p.charge * 9;
      const nodes = neck.points.map(([x, y, z, a, b], j) => {
        const t = j / 4, bend = t * t;
        return [x + (thrust + 2.6 * Math.sin(motion + t)) * bend,
          y + 5.2 * Math.sin(motion - t * 2) * bend,
          z + (4.6 * Math.cos(motion + t * .7) + 6 * p.charge - 6 * p.swing) * bend, a, b];
      });
      mesh.tube(spline(nodes, 19), (_, h, k, j) => {
        const yellow = limit((.55 - h) * 1.17);
        const band = .06 * Math.sin(k * 2.12 + j * .7);
        return pigment(pigment(hydraBack, hydraScales, .29 + .22 * Math.max(0, h) + band),
          pigment(ink(0x89873d), hydraBelly, .78 + .21 * Math.cos(k * 2.31)), yellow);
      }, 11, .28, [0, 1, 0]);
      const tip = nodes.at(-1);
      const [dx, dy] = sub(tip, nodes.at(-2));
      serpentHead(mesh, tip, unit([dx, dy, 0]), neck.size, p.swing);
    }
  }

  function wave(mesh, crest) {
    const { age = 0 } = crest;
    const flow = (age * .49 + 1) % 8;
    const uv = (t, s) => [t, s, flow];
    const crescent = (t, s) => {
      const q = 2 * t - 1;
      const bow = Math.max(0, 1 - q * q) ** .7;
      const roll = Math.max(0, Math.sin(PI * s));
      // Both edges meet at the tips, leaving the back of the crest open.
      const hollow = -17 + 29 * bow;
      return [hollow + bow * s * 24, q * waveHalfSpan, .55 + bow * roll ** .91 * 22];
    };
    // Wave vertices carry UV and texture time in the material channels.
    mesh.skin((t, s) => [-50 + 66 * s - 14 * (2 * t - 1) ** 2, (2 * t - 1) * (23 + 5 * s), .34],
      uv, 12, 6, 3);
    mesh.skin(crescent, uv, 20, 12, 2);

    const normal = [0, 0, 1];
    for (let i = 0; i < 11; i++) {
      const flight = (age * (.72 + i % 4 * .081) + i * .618) % 1;
      const spread = ((i * .754877) % 1) * 2 - 1;
      const x = 4 - 45 * flight - 13 * spread * spread;
      const y = spread * (22 + flight * 18) + Math.sin(i * 1.93 + age * 3) * 3;
      const z = .55 + 7.5 * Math.sin(flight * PI) * (1 - Math.abs(spread) * .44);
      const r = .62 + (i % 4) * .19;
      const tint = [.8, 1, (1 - flight) * (.32 + (i % 5) * .15)];
      const a = [[x - r * 1.4, y, z], normal, tint];
      const b = [[x, y + r, z], normal, tint];
      const c = [[x + r * 1.3, y, z], normal, tint];
      const d = [[x, y - r, z], normal, tint];
      mesh.triangle(a, b, c, 4);
      mesh.triangle(a, c, d, 4);
    }

    for (let i = 0; i < 6; i++) {
      const life = (age * (1.04 + i % 3 * .17) + i * .393) % 1;
      const rise = life ** .72;
      const t = .13 + .15 * i + .015 * Math.sin(age * 4.1 + i * 2.6);
      const origin = crescent(t, .18 + (i % 3) * .14);
      const x = origin[0] - 16 * rise, y = origin[1] + (t - .5) * 9 * rise;
      const z = origin[2] + 4 + 14 * rise;
      const r = 2.45 * (.9 + i % 3 * .15);
      const fade = Math.min(1, life * 10, (1 - life) * 5.6) * (.78 + i % 2 * .12);
      const corner = (u, v) => [[x + u * r, y + v * r, z], normal, [u, v, fade]];
      const a = corner(-1, -1), b = corner(1, -1), c = corner(1, 1), d = corner(-1, 1);
      mesh.triangle(a, b, c, 5);
      mesh.triangle(a, c, d, 5);
    }
  }

  function fill(mesh, scene) {
    mesh.length = 0;
    for (const entry of scene) {
      mesh.place(entry);
      if (entry.role === 'boss') boss(mesh, entry.pose);
      else if (entry.role === 'wave') wave(mesh, entry.pose);
      else tail(mesh, entry.pose, entry.role === 'tail-echo');
    }
    return mesh.data.subarray(0, mesh.length);
  }

  function createRenderer(canvas, waveImages) {
    const gl = canvas.getContext('webgl', { alpha: true, antialias: true, depth: true, stencil: true, premultipliedAlpha: true });
    if (!gl) return null;
    function compile(type, source) {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
      return shader;
    }
    const program = gl.createProgram();
    const vertex = compile(gl.VERTEX_SHADER, `
      attribute vec3 point;
      attribute vec3 normal;
      attribute vec4 color;
      attribute float shine;
      uniform vec2 resolution;
      uniform bool shadowPass;
      varying vec3 n;
      varying vec4 tint;
      varying float gloss;
      void main() {
        vec2 lift = shine > 1.5 ? vec2(0.07, -0.29) : vec2(0.12, -0.57);
        vec2 pixel = point.xy + point.z * (shadowPass ? vec2(0.81, 0.50) : lift);
        vec2 clip = vec2(2.0, -2.0) * (pixel / resolution) + vec2(-1.0, 1.0);
        gl_Position = vec4(clip, -0.00022 * (point.z + point.y * 0.46), 1.0);
        n = normal;
        tint = color;
        gloss = shine;
      }
    `);
    const fragment = compile(gl.FRAGMENT_SHADER, `
      precision mediump float;
      uniform bool shadowPass;
      uniform sampler2D venomMap;
      uniform sampler2D foamMap;
      uniform float waveTextures;
      varying vec3 n;
      varying vec4 tint;
      varying float gloss;

      float hash(vec2 v) {
        return fract(sin(dot(v, vec2(129.5, 71.7))) * 3179.3);
      }

      float noise(vec2 p) {
        vec2 cell = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(cell), hash(cell + vec2(1, 0)), f.x),
          mix(hash(cell + vec2(0, 1)), hash(cell + vec2(1, 1)), f.x), f.y);
      }

      vec4 venom(vec3 N, vec3 light) {
        float u = tint.x, v = tint.y, t = tint.z;
        float side = abs(u * 2.0 - 1.0);
        vec2 p = vec2(u * 1.92 + t * 0.11, v * 0.91 - t * 0.75);
        vec3 veins = texture2D(venomMap, p).rgb;
        float foam = texture2D(foamMap, vec2(u * 2.3 - t * 0.17, v * 1.83 - t * 0.48)).r;
        float grains = noise(p * 30.0 + vec2(t * 3.2, 0.0));
        float seam = smoothstep(.48, .81, noise(p * 14.0) * .69 + grains * .31);
        if (waveTextures < .5) {
          veins = vec3(.12, .19, .023) + seam * vec3(.44, .56, .046);
          foam = noise(p * 8.3);
        }
        float sides = 1.0 - smoothstep(.88, 1.0, side);
        if (gloss > 2.5) {
          float taper = sides * smoothstep(.10, .72, v) * (1.0 - smoothstep(.84, 1.0, v));
          return vec4(vec3(.23, .39, .018) + veins * .22, tint.a * taper * (.12 + foam * .17));
        }
        float edge = smoothstep(.69, .90, v) * (1.0 - smoothstep(.94, 1.0, v));
        float broken = smoothstep(.38, .75, foam * .56 + grains * .31 + veins.g * .37);
        float sparks = smoothstep(.38, .68, veins.g) * (.45 + grains * .55);
        float lime = clamp(edge * (.13 + broken * .90) + sparks * .45, 0.0, 1.0);
        vec3 color = vec3(.028, .057, .012) + veins * (.31 + max(0.0, dot(N, light)) * .34);
        color += lime * vec3(.72, .96, .075);
        color += edge * broken * max(0.0, (grains - .67)) * vec3(.48, .55, .13);
        float presence = smoothstep(0.0, .085, v) * (1.0 - smoothstep(.92, 1.0, v));
        return vec4(color, tint.a * presence * sides * .83);
      }

      void main() {
        if (shadowPass) {
          if (gloss > 2.5 || (gloss > 1.5 && (tint.y < .14 || abs(2.0 * tint.x - 1.0) > .94))) discard;
          gl_FragColor = vec4(0.028, 0.058, 0.053, tint.a * (gloss > 1.5 ? .15 : .30));
          return;
        }
        vec3 N = normalize(n);
        vec3 key = normalize(vec3(-0.56, -0.38, 0.76));
        if (gloss > 4.5) {
          vec2 p = tint.xy;
          float r = length(p);
          if (r >= 1.0) discard;
          float rim = smoothstep(.54, .78, r) * (1.0 - smoothstep(.86, 1.0, r));
          float shine = 1.0 - smoothstep(.08, .47, length(p + vec2(.31, .36)));
          vec3 color = mix(vec3(.22, .40, .04), vec3(.78, 1.0, .31), max(rim, shine));
          gl_FragColor = vec4(color, tint.a * tint.z * (.11 + rim * .57 + shine * .32));
          return;
        }
        if (gloss > 3.5) {
          gl_FragColor = vec4(.76, .98, .13, tint.a * tint.b);
          return;
        }
        if (gloss > 1.5) {
          vec4 poison = venom(N, key);
          if (poison.a <= 0.0) discard;
          gl_FragColor = poison;
          return;
        }
        vec3 view = normalize(vec3(-0.12, 0.57, 1.0));
        float lit = max(0.0, dot(key, N));
        float highlight = pow(max(0.0, dot(N, normalize(key + view))), mix(13.0, 34.0, gloss));
        float rim = pow(1.0 - max(0.0, dot(N, view)), 2.0);
        vec3 surface = tint.rgb * (0.43 + 0.65 * lit) + vec3(0.30, 0.40, 0.22) * highlight * gloss
          + tint.rgb * rim * (0.10 + 0.18 * gloss);
        gl_FragColor = vec4(surface, tint.a);
      }
    `);
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
    const buffer = gl.createBuffer();
    const resolution = gl.getUniformLocation(program, 'resolution');
    const shadowPass = gl.getUniformLocation(program, 'shadowPass');
    const useWaveTextures = gl.getUniformLocation(program, 'waveTextures');
    let readyTextures = 0;
    function texture(unit, name, src) {
      const texture = gl.createTexture();
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.useProgram(program);
      gl.uniform1i(gl.getUniformLocation(program, name), unit);
      if (!src) return;
      const image = new Image();
      image.onload = () => {
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
        gl.generateMipmap(gl.TEXTURE_2D);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        readyTextures++;
        waveImages?.loaded?.();
      };
      image.src = src;
    }
    texture(0, 'venomMap', waveImages?.body);
    texture(1, 'foamMap', waveImages?.foam);
    const attributes = [['point', 3, 0], ['normal', 3, 3], ['color', 4, 6], ['shine', 1, 10]].map(([name, size, offset]) =>
      [gl.getAttribLocation(program, name), size, offset * 4]);
    const mesh = new Mesh();
    return {
      canvas,
      draw(scene, width, height, dpi) {
        if (gl.isContextLost()) return false;
        const pixelsX = Math.max(1, Math.round(width * dpi)), pixelsY = Math.max(1, Math.round(height * dpi));
        if (canvas.width !== pixelsX) canvas.width = pixelsX;
        if (canvas.height !== pixelsY) canvas.height = pixelsY;
        gl.viewport(0, 0, pixelsX, pixelsY);
        gl.clearColor(0, 0, 0, 0);
        gl.clearStencil(0);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
        gl.enable(gl.BLEND);
        gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.useProgram(program);
        gl.uniform2f(resolution, width, height);
        gl.uniform1f(useWaveTextures, readyTextures === 2 ? 1 : 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        const data = fill(mesh, scene);
        gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
        for (const [location, size, offset] of attributes) {
          gl.enableVertexAttribArray(location);
          gl.vertexAttribPointer(location, size, gl.FLOAT, false, 44, offset);
        }
        if (gl.getContextAttributes()?.stencil) {
          gl.disable(gl.DEPTH_TEST);
          gl.enable(gl.STENCIL_TEST);
          gl.stencilFunc(gl.NOTEQUAL, 1, 0xff);
          gl.stencilOp(gl.KEEP, gl.KEEP, gl.REPLACE);
          gl.uniform1i(shadowPass, 1);
          gl.drawArrays(gl.TRIANGLES, 0, data.length / 11);
          gl.disable(gl.STENCIL_TEST);
        }
        gl.enable(gl.DEPTH_TEST);
        gl.uniform1i(shadowPass, 0);
        gl.drawArrays(gl.TRIANGLES, 0, data.length / 11);
        return true;
      },
      hasWaveTextures: () => readyTextures === 2,
    };
  }

  globalThis.M8P1Mesh = { createRenderer, waveScreenScale, vertices: scene => fill(new Mesh(), scene) };
})();
