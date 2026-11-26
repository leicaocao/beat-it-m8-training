const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = __dirname;
const defaultOffline = path.join(root, 'data', '本周M8复盘.html');
const defaultPublicSample = path.join(root, 'data', 'LbHw4cjQX9AK7DZ1-4.json');

// Exercise the built artifact and its real client scripts without opening a desktop
// browser. The canvas witness records drawing calls; it does not validate pixels.
class Element {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.handlers = new Map();
    this.attributes = new Map();
    this.dataset = {};
    this.value = '';
    this.className = '';
    this.textContent = '';
    this.scrollTop = 0;
    this.scrollLeft = 0;
    this.clientWidth = 640;
    this.offsetLeft = 0;
    if (this.tagName === 'VIDEO') {
      this.paused = true;
      this.currentTime = 0;
      this.playbackRate = 1;
      this.duration = 75;
      this.readyState = 1;
      this.play = async () => { this.paused = false; };
      this.pause = () => { this.paused = true; };
      this.load = () => { this.currentTime = 0; };
    }
    this.style = {
      setProperty(key, value) { this[key] = String(value); },
      getPropertyValue(key) { return this[key] || ''; }
    };
    this.classList = {
      contains: name => this.className.split(/\s+/).includes(name),
      add: (...names) => {
        this.className = [...new Set([...this.className.split(/\s+/).filter(Boolean), ...names])].join(' ');
      },
      remove: (...names) => {
        this.className = this.className.split(/\s+/).filter(name => !names.includes(name)).join(' ');
      },
      toggle: (name, force = !this.classList.contains(name)) => {
        this.classList[force ? 'add' : 'remove'](name);
        return force;
      }
    };
  }

  get firstElementChild() { return this.children[0] || null; }
  get lastElementChild() { return this.children.at(-1) || null; }
  get childElementCount() { return this.children.length; }
  get parentNode() { return this.parentElement || null; }

  append(...items) { this.insert(false, items); }
  prepend(...items) { this.insert(true, items); }
  replaceChildren(...items) {
    for (const child of this.children) child.parentElement = null;
    this.children = [];
    this.append(...items);
  }
  add(item) { this.append(item); }
  insert(before, items) {
    const children = items.flatMap(item => item.tagName === '#FRAGMENT' ? [...item.children] : [item]);
    for (const child of children) {
      child.remove();
      child.parentElement = this;
    }
    this.children[before ? 'unshift' : 'push'](...children);
  }
  remove() {
    if (!this.parentElement) return;
    const siblings = this.parentElement.children;
    siblings.splice(siblings.indexOf(this), 1);
    this.parentElement = null;
  }

  setAttribute(key, value) {
    const text = String(value);
    this.attributes.set(key, text);
    if (key === 'class') this.className = text;
    if (['id', 'src', 'value', 'href', 'title', 'type'].includes(key)) this[key] = text;
    if (key.startsWith('data-')) {
      const property = key.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      this.dataset[property] = text;
    }
    if (['hidden', 'disabled', 'checked', 'open'].includes(key)) this[key] = true;
    if (['width', 'height'].includes(key)) this[key] = Number(text);
  }
  getAttribute(key) { return this.attributes.get(key) ?? null; }
  removeAttribute(key) {
    this.attributes.delete(key);
    if (['hidden', 'disabled', 'checked', 'open'].includes(key)) this[key] = false;
    else if (['src', 'href', 'title'].includes(key)) delete this[key];
  }
  matches(selector) {
    return selector.split(',').some(part => {
      const query = part.trim();
      if (query.startsWith('.')) return this.classList.contains(query.slice(1));
      if (query.startsWith('#')) return this.id === query.slice(1);
      const attribute = query.match(/^([a-z]*)\[([^=\]]+)(?:="([^"]*)")?\]$/i);
      if (attribute) {
        const [, tag, key, value] = attribute;
        const actual = this.getAttribute(key);
        return (!tag || this.tagName === tag.toUpperCase()) && actual != null &&
          (value === undefined || value === actual);
      }
      return this.tagName === query.toUpperCase();
    });
  }
  closest(selector) {
    for (let node = this; node; node = node.parentElement) {
      if (node.matches(selector)) return node;
    }
    return null;
  }
  querySelectorAll(selector) {
    return this.children.flatMap(child => [
      ...(child.matches(selector) ? [child] : []),
      ...child.querySelectorAll(selector)
    ]);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }

  addEventListener(type, listener) {
    if (!this.handlers.has(type)) this.handlers.set(type, []);
    this.handlers.get(type).push(listener);
  }
  removeEventListener(type, listener) {
    this.handlers.set(type, (this.handlers.get(type) || []).filter(callback => callback !== listener));
  }
  dispatchEvent(event) {
    event.target ||= this;
    event.preventDefault ||= function () { this.defaultPrevented = true; };
    event.stopPropagation ||= function () { this.stopped = true; };
    const results = [];
    for (let node = this; node; node = event.bubbles && !event.stopped ? node.parentElement : null) {
      event.currentTarget = node;
      for (const callback of node.handlers.get(event.type) || []) results.push(callback.call(node, event));
    }
    return Promise.all(results);
  }
  emit(type, fields = {}) { return this.dispatchEvent({ type, ...fields }); }
  click() { return this.emit('click', { bubbles: true }); }
  focus() {}
  select() { this.selectedText = true; }
  setPointerCapture() {}
  releasePointerCapture() {}
  hasPointerCapture() { return false; }
  scrollIntoView() {}
  getBoundingClientRect() { return { left: 0, top: 0, right: 640, bottom: 420, width: 640, height: 420 }; }
}

function parseMarkedDom(html) {
  const document = new Element('#document');
  const stack = [document];
  const voidTags = new Set(['meta', 'link', 'img', 'input', 'hr', 'br', 'source']);
  const markup = html.slice(0, html.indexOf('<script'));
  for (const match of markup.matchAll(/<\/?([a-z][a-z\d-]*)([^<>]*?)>/gi)) {
    const [source, tag, attributes] = match;
    const name = tag.toLowerCase();
    if (source.startsWith('</')) {
      if (stack.at(-1)?.tagName === name.toUpperCase()) stack.pop();
      continue;
    }
    const node = new Element(name);
    for (const entry of attributes.matchAll(/([^\s=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s]+)))?/g)) {
      node.setAttribute(entry[1], entry[2] ?? entry[3] ?? entry[4] ?? '');
    }
    if (name === 'option' && node.getAttribute('selected') != null && stack.at(-1).tagName === 'SELECT') {
      stack.at(-1).value = node.value;
    }
    stack.at(-1).append(node);
    if (!voidTags.has(name) && !source.endsWith('/>')) stack.push(node);
  }
  document.getElementById = id => document.querySelector('#' + id);
  document.createElement = tag => new Element(tag);
  document.createDocumentFragment = () => new Element('#fragment');
  document.body = document.querySelector('body');
  document.documentElement = document.querySelector('html');
  return document;
}

function canvasWitness() {
  const drawing = { images: new Set(), painted: 0, labels: new Set() };
  const functions = {
    drawImage(image) { if (image.src) drawing.images.add(image.src); },
    arc(x, y, radius) {
      assert([x, y, radius].every(Number.isFinite), 'non-finite canvas marker');
      drawing.painted++;
    },
    fillText(text, x, y) {
      assert([x, y].every(Number.isFinite), 'non-finite canvas label');
      drawing.labels.add(String(text));
    },
    createRadialGradient() { return { addColorStop() {} }; },
    createLinearGradient() { return { addColorStop() {} }; },
    measureText(text) { return { width: String(text).length * 7 }; }
  };
  drawing.context = new Proxy(functions, {
    get(target, key) { return Reflect.has(target, key) ? Reflect.get(target, key) : () => {}; }
  });
  return drawing;
}

function launch(html, search = '', { publicMode = false, supportMedia = true, supportClipboard = true } = {}) {
  const document = parseMarkedDom(html);
  const drawing = canvasWitness();
  const frames = new Map();
  let elapsed = 0;
  let frameId = 0;
  let fetches = 0;
  const media = { downloads: [], stoppedTracks: 0, clipboard: '' };
  const get = id => {
    const node = document.getElementById(id);
    assert(node, 'missing document element #' + id);
    return node;
  };
  document.createElement = tag => {
    const node = new Element(tag);
    if (tag === 'canvas') node.getContext = () => drawing.context;
    if (tag === 'a') node.addEventListener('click', () => {
      if (node.download) media.downloads.push(node.download);
    });
    return node;
  };
  get('map').getContext = () => drawing.context;
  const stage = document.querySelector('.replay');
  if (supportMedia) {
    get('map').captureStream = () => ({ getTracks: () => [{ stop() { media.stoppedTracks++; } }] });
    if (stage) stage.requestFullscreen = async () => { document.fullscreenElement = stage; };
    document.exitFullscreen = async () => { document.fullscreenElement = null; };
  }
  class MediaRecorder extends Element {
    static isTypeSupported(mime) { return mime === 'video/webm;codecs=vp8'; }
    constructor(stream, options) {
      super('media-recorder');
      this.mimeType = options?.mimeType || 'video/webm';
      this.state = 'inactive';
    }
    start() { this.state = 'recording'; }
    stop() {
      this.state = 'inactive';
      this.emit('dataavailable', { data: new Blob(['recording'], { type: this.mimeType }) });
      this.emit('stop');
    }
  }
  const sandbox = {
    document,
    Image: class {
      constructor() { this.complete = true; this.naturalWidth = this.naturalHeight = 32; }
    },
    Option: class extends Element {
      constructor(label, value) { super('option'); this.textContent = label; this.value = String(value); }
    },
    URL, URLSearchParams, Intl, TextEncoder, TextDecoder, Blob,
    MediaRecorder: supportMedia ? MediaRecorder : undefined,
    setTimeout: callback => { callback(); return 1; },
    clearTimeout() {},
    location: { search, href: 'file:///m8-review.html' + search, protocol: 'file:' },
    history: { replaceState() {} },
    navigator: { clipboard: supportClipboard ? { writeText: async value => { media.clipboard = value; } } : undefined },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    performance: { now: () => elapsed },
    requestAnimationFrame(callback) { frames.set(++frameId, callback); return frameId; },
    cancelAnimationFrame: id => frames.delete(id),
    addEventListener: (...args) => document.addEventListener(...args),
    fetch: async () => {
      fetches++;
      if (publicMode) return { ok: true, json: async () => [] };
      throw new Error('An offline replay attempted a network request');
    },
    console
  };
  sandbox.window = sandbox;
  const context = vm.createContext(sandbox);
  for (const match of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const [, attributes, source] = match;
    const external = attributes.match(/\bsrc="([^"]+)"/);
    if (external) {
      assert(publicMode, 'offline package references an external script');
      const name = external[1].split('?')[0];
      vm.runInContext(fs.readFileSync(path.join(root, 'dist', name), 'utf8'), context, { filename: name });
    } else if (/type="application\/json"/i.test(attributes)) {
      const id = attributes.match(/\bid="([^"]+)"/)?.[1];
      const element = document.createElement('script');
      element.setAttribute('id', id);
      element.textContent = source;
      document.body.append(element);
    } else vm.runInContext(source, context);
  }
  return {
    document, context, drawing, media, get,
    get fetches() { return fetches; },
    advance(ms) {
      elapsed += ms;
      const current = [...frames.values()];
      frames.clear();
      for (const callback of current) callback(elapsed);
    }
  };
}

const change = (control, value, type = 'change') => {
  control.value = String(value);
  return control.emit(type);
};
const read = filename => fs.readFileSync(filename, 'utf8');

function verifyBuildFreshness(html) {
  const index = read(path.join(root, 'dist', 'index.html'));
  const emittedScripts = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/gi)]
    .filter(match => !match[1]).map(match => match[2].trim());
  const emittedStyles = [...html.matchAll(/<style>([\s\S]*?)<\/style>/gi)].map(match => match[1].trim());
  for (const script of index.matchAll(/<script src="([^"]+)"/gi)) {
    const file = script[1].split(/[?#]/, 1)[0];
    assert(emittedScripts.includes(read(path.join(root, 'dist', file)).trim()), 'stale or missing embedded script ' + file);
  }
  for (const sheet of index.matchAll(/<link rel="stylesheet" href="([^"]+)"/gi)) {
    const file = sheet[1].split(/[?#]/, 1)[0];
    const source = read(path.join(root, 'dist', file)).trim();
    // The offline builder rewrites local CSS image URLs into data URIs.
    const withoutUrls = value => value.replace(/url\(\s*(['"]?)(?:assets\/|data:)[^)"']+\1\s*\)/gi, 'url(asset)');
    assert(emittedStyles.some(sheet => withoutUrls(sheet) === withoutUrls(source)), 'stale or missing embedded stylesheet ' + file);
  }
}

function verifyModel(model, report) {
  const normalized = model.normalize(report);
  assert.equal(normalized.fights.length, report.fights.length);
  assert(normalized.fights.every(fight => fight.duration > 0 && model.phaseAt(fight, 0)));
  assert.throws(() => model.normalize({ ...report, encounterID: 0 }), /M8/);
  assert.equal(model.sample([[1000, 4, 9, 80, 1]], 999), null);
  assert.equal(model.sample([[1000, 4, 9, 80, 1]], 4001), null);
  assert.equal(model.sample([[1000, 4, 9, 80, 1], [3000, 18, 25, 90, 1]], 2000).x, 11);
  assert.equal(model.sample([[1000, 4, 9, 80, 1], [3000, 18, 25, 90, 2]], 2000).x, 4);
  assert.equal(model.sample([[1000, 4, 9, 80, 1], [9000, 18, 25, 90, 1]], 6000), null);
  // The weekly attempts do not cover every stage. This synthetic boundary
  // checks time indexing only and never contributes to the user's artifact.
  const transitions = [{ id: 1, t: 0 }, { id: 2, t: 15000 }, { id: 3, t: 24000 }, { id: 4, t: 29000 }];
  assert.equal(model.phaseAt({ phaseTransitions: transitions }, 14999).id, 1);
  assert.equal(model.phaseAt({ phaseTransitions: transitions }, 15000).id, 2);
  assert.equal(model.phaseAt({ phaseTransitions: transitions }, 28888).id, 3);
  assert.equal(model.phaseAt({ phaseTransitions: transitions }, 29000).id, 4);
  for (const fight of normalized.fights) {
    assert(fight.players.length > 0);
    if (model.firstFrame) {
      const initial = model.firstFrame(fight);
      assert(initial >= 0 && initial <= Math.min(1500, fight.duration));
      assert(fight.players.some(actor => model.sample(actor.points, initial)),
        'first playable map has no player markers');
    }
    for (const actor of fight.actors) {
      assert(actor.points.every((point, index, points) =>
        point.slice(0, 3).every(Number.isFinite) && (!index || points[index - 1][0] <= point[0])));
    }
  }
  return normalized;
}

async function verifyReplayTools(app, fresh) {
  const { document, get, media } = app;
  const record = document.getElementById('record-replay');
  if (!record || !app.context.M8ReplayTools) return;
  const select = document.getElementById('local-video');
  if (fresh) assert(!record.disabled, 'recording button did not enable for the loaded fight');
  if (record.disabled) return;
  const videoBar = get('video-bar');
  const video = videoBar.querySelector('video');
  const stage = document.querySelector('.replay');
  const movie = new Blob(['fixture'], { type: 'video/mp4' });
  Object.defineProperty(movie, 'name', { value: 'qa-fixture.mp4' });
  select.files = [movie];
  await change(get('seek'), 9000, 'input');
  await select.emit('change');
  assert(!videoBar.hidden, 'valid local video did not attach');
  assert.match(video.src, /^blob:/);
  assert.equal(video.currentTime, 9);
  await change(get('video-offset'), 1.25, 'input');
  assert.equal(video.currentTime, 10.25);
  await get('play').click();
  app.advance(50);
  assert(!video.paused, 'attached video did not start with replay');
  await get('play').click();
  assert(video.paused, 'attached video did not pause with replay');
  await get('close-video').click();
  assert(videoBar.hidden);
  assert(!video.src);

  const unsupported = new Blob(['not a movie'], { type: 'text/plain' });
  select.files = [unsupported];
  await select.emit('change');
  assert(videoBar.hidden);
  assert.match(get('message').textContent, /视频文件/);

  await record.click();
  assert.equal(record.getAttribute('aria-pressed'), 'true');
  await record.click();
  assert.equal(record.getAttribute('aria-pressed'), 'false');
  assert.equal(media.stoppedTracks, 1);
  assert.equal(media.downloads.length, 1);
  assert.match(media.downloads[0], /\.webm$/);

  const fullscreen = get('replay-fullscreen');
  await fullscreen.click();
  assert.equal(document.fullscreenElement, stage);
  assert.equal(fullscreen.getAttribute('aria-pressed'), 'true');
  await fullscreen.click();
  assert.equal(document.fullscreenElement, null);
  assert.equal(fullscreen.getAttribute('aria-pressed'), 'false');
  console.log('PASS replay tools: local video seek/offset/play/pause, recording lifetime and fullscreen.');
}

async function verifyCapabilityFallback(html) {
  const app = launch(html, '', { supportMedia: false, supportClipboard: false });
  if (!app.context.M8ReplayTools) return;
  const { get } = app;
  assert(get('record-replay').disabled);
  assert(get('replay-fullscreen').disabled);
  assert(!get('play').disabled, 'replay should still work without recording or fullscreen');
  await get('copy-moment').click();
  assert(get('report-url').closest('details').open);
  assert(get('report-url').selectedText);
  assert.match(get('report-url').value, /^https:\/\/cn\.warcraftlogs\.com\/reports\//);
  console.log('PASS capability fallback: normal replay without recording and fullscreen, selectable link without Clipboard API.');
}

async function verifyReportCatalog(html, report, publicReport) {
  const app = launch(html);
  const { get, context } = app;
  assert.equal(get('catalog').value, report.code, 'offline viewer should open this week’s report by default');
  const weeklyFight = context.M8Model.normalize(report).fights.find(fight => fight.id === Number(get('fight').value));
  assert(weeklyFight);
  assert.equal(Number(get('seek').value), context.M8Model.firstFrame(weeklyFight));

  assert.equal(get('catalog').children.length, 3, 'both reports should be selectable');
  await change(get('catalog'), publicReport.code);
  assert.equal(get('catalog').value, publicReport.code);
  assert.match(get('report-title').textContent, /公开击杀样例/);
  assert.equal(get('fight').children.length, 1);
  const sample = verifyModel(context.M8Model, publicReport).fights[0];
  assert(sample.kill);
  assert.equal(get('fight').value, String(sample.id));
  assert.equal(Number(get('seek').value), context.M8Model.firstFrame(sample));
  const bands = get('timeline').querySelectorAll('.m8-phase-band');
  assert.equal(bands.length, 4, 'the sample kill should show all four phase bands');
  assert.match(bands.at(-1).title, /P3/);
  const room = context.M8RoomEvidence.build(sample);
  assert.equal(room.sides.west.memberIds.length, 10);
  assert.equal(room.sides.east.memberIds.length, 10);
  assert.equal(room.endReason, 'returned');
  await get('timeline').querySelector('.m8-room-period').click();
  assert.equal(get('map-hud-phase').textContent, 'P2');
  assert.match(get('map-note').textContent, /WCL 坐标/);
  assert(!get('room-status').hidden);
  await bands[2].click();
  assert.equal(get('map-hud-phase').textContent, '过场');
  assert.match(get('map-note').textContent, /场地锚点/);
  assert(get('room-status').hidden);
  await bands.at(-1).click();
  assert.equal(Number(get('seek').value), sample.phaseTransitions.at(-1).t);
  assert.equal(get('map-hud-phase').textContent, 'P3');
  assert.match(get('map-note').textContent, /场地锚点/);
  const bites = context.M8P3Evidence.build(sample).filter(item => item.key === 'serpents-bite');
  assert.equal(bites.length, 3);
  assert(bites.every(item => item.count === 3 && item.confidence === 'correlated'));
  await change(get('seek'), bites[0].actorTime, 'input');
  assert(get('rows').querySelectorAll('.event-copy').some(copy =>
    /毒蛇之咬/.test(copy.querySelector('strong')?.textContent || '')));
  const sampleEvidence = context.M8Evidence.build(sample);
  const lateHeart = sampleEvidence.hearts.find(heart => heart.start >= sample.phaseTransitions.at(-1).t);
  assert(lateHeart && lateHeart.end < sample.duration, 'public sample should include the terminal P3 Heart window');
  const lateTime = lateHeart.start + 1000;
  await change(get('seek'), lateTime, 'input');
  assert(!get('heart-live').hidden);
  assert.equal(get('heart-live').textContent, '易伤 · ' + Math.ceil((lateHeart.end - lateTime) / 1000) + ' 秒');
  await change(get('seek'), lateHeart.end, 'input');
  assert(get('heart-live').hidden, 'Heart indicator did not clear on the logged remove event');
  const p3Deaths = sample.deaths.filter(event => event.t >= sample.phaseTransitions.at(-1).t);
  assert.equal(sampleEvidence.phases.at(-1).counts.deaths, p3Deaths.length);
  assert(p3Deaths.length > 0);
  const deathIndex = sample.deaths.indexOf(p3Deaths.at(-1));
  await get('death-list').querySelectorAll('.death-row')[deathIndex].click();
  assert.equal(get('focus').value, String(p3Deaths.at(-1).target));
  assert.equal(get('map-hud-phase').textContent, 'P3');

  await verifyAnalysisDeck(app, publicReport, sample.id);
  await change(get('catalog'), report.code);
  assert.equal(get('fight').children.length, report.fights.length);
  assert.equal(app.fetches, 0, 'both reports and all replay controls should remain offline');
  console.log('PASS offline catalog: weekly report default, public kill #4, all four phases, P3 Heart timing and death focus.');
}

async function verifyWorkspace(app, report, fight) {
  const { get, drawing, context } = app;
  const seek = time => change(get('seek'), time, 'input');
  const submit = value => {
    get('report-url').value = value;
    return get('location-form').emit('submit');
  };
  const duration = fight.endTime - fight.startTime;
  const date = new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', timeZone: 'Asia/Shanghai' }).format(report.startTime);
  assert(get('report-title').textContent.includes(date));
  assert.equal(get('fight').children.length, report.fights.length);
  assert.equal(get('fight').value, String(fight.id));
  assert(!get('play').disabled);
  assert(get('source').href.endsWith('?fight=' + fight.id));
  if (context.M8Model.firstFrame) {
    const normalized = context.M8Model.normalize(report).fights.find(item => item.id === fight.id);
    assert.equal(Number(get('seek').value), context.M8Model.firstFrame(normalized), 'initial frame should show available positions');
  }

  const nearStart = Math.min(duration, 15000);
  await seek(nearStart);
  assert.equal(Number(get('seek').value), nearStart);
  assert(drawing.painted > 0, 'real position samples did not reach the canvas');
  const circle = drawing.painted;
  await get('zoom-in').click();
  await get('zoom-reset').click();
  assert(drawing.painted > circle, 'zoom controls did not redraw the map');

  const fighter = fight.actors.find(actor => actor.type === 'Player' && actor.points.length);
  assert(fighter);
  await change(get('focus'), fighter.id);
  assert.equal(get('focus').value, String(fighter.id));

  await change(get('speed'), 2);
  await get('play').click();
  assert.equal(get('play').getAttribute('aria-pressed'), 'true');
  app.advance(50);
  assert.equal(Number(get('seek').value), Math.min(duration, nearStart + 100));
  await get('play').click();
  const paused = Number(get('seek').value);
  app.advance(50);
  assert.equal(Number(get('seek').value), paused);
  await seek(0);
  await get('back').click();
  assert.equal(Number(get('seek').value), 0);
  await get('forward').click();
  assert.equal(Number(get('seek').value), Math.min(duration, 5000));

  const companion = report.fights[report.fights.findIndex(item => item.id === fight.id) + 1];
  if (companion) {
    await get('fight-next').click();
    assert.equal(get('fight').value, String(companion.id));
    await get('fight-prev').click();
    assert.equal(get('fight').value, String(fight.id));
  }

  const time = Math.min(duration, 24000);
  await submit('https://cn.warcraftlogs.com/reports/' + report.code + '?fight=' + fight.id + '&position=' + time);
  assert.equal(Number(get('seek').value), time);
  await submit('https://example.org/reports/' + report.code + '?fight=' + fight.id);
  assert(!get('message').hidden && get('message').textContent.length > 0);
  assert.equal(Number(get('seek').value), time);
  await submit('https://www.warcraftlogs.com/reports/' + report.code + '#fight=' + fight.id + '&position=' + time);
  assert.equal(Number(get('seek').value), time);
  const copy = get('copy-moment');
  if (!copy.disabled && copy.handlers.has('click')) {
    await copy.click();
    const link = new URL(app.media.clipboard);
    assert.equal(link.pathname, '/reports/' + report.code);
    assert.equal(link.searchParams.get('fight'), String(fight.id));
    assert.equal(link.searchParams.get('position'), String(time));
  }

  const phaseBand = get('timeline').querySelector('.m8-phase-band');
  if (phaseBand) {
    await phaseBand.click();
    assert.equal(Number(get('seek').value), 0);
  } else assert(get('timeline').childElementCount > 0);
  for (const button of get('timeline').querySelectorAll('.m8-lane-toggle')) {
    const before = button.getAttribute('aria-pressed');
    await button.click();
    assert.notEqual(button.getAttribute('aria-pressed'), before);
    await button.click();
    assert.equal(button.getAttribute('aria-pressed'), before);
  }

  if (get('follow').getAttribute('aria-pressed') === 'false') await get('follow').click();
  const feed = get('rows');
  const oldRows = feed.children;
  await feed.emit('wheel');
  await seek(Math.min(duration, 90000));
  assert.equal(get('follow').getAttribute('aria-pressed'), 'false');
  assert.equal(feed.children, oldRows, 'manual event reading should stay on its current window');
  await get('follow').click();
  assert.equal(get('follow').getAttribute('aria-pressed'), 'true');
  assert.notEqual(feed.children, oldRows);

  const firstDeath = context.M8Model.normalize(report).fights.find(item => item.id === fight.id).deaths[0];
  const firstRow = get('death-list').querySelector('.death-row');
  if (firstDeath && firstRow) {
    await firstRow.click();
    assert.equal(get('focus').value, String(firstDeath.target));
    assert(Number(get('seek').value) <= firstDeath.t, 'death click seeks to the event or its lead-in');
  }

  const imported = get('import-file');
  const oldFight = get('fight').value;
  imported.files = [{ size: 3, text: async () => '{a:' }];
  await imported.emit('change');
  assert(!get('message').hidden, 'invalid import needs visible feedback');
  assert.equal(get('fight').value, oldFight, 'invalid import should preserve the current log');
}

async function verifyAnalysisDeck(app, rawReport, fightId) {
  const { context, document } = app;
  const normalized = context.M8Model.normalize(rawReport);
  const fight = normalized.fights.find(item => item.id === fightId);
  for (const name of ['evidence', 'analysis']) {
    const source = path.join(root, 'dist', name + '.js');
    const key = name === 'evidence' ? 'M8Evidence' : 'M8Analysis';
    if (!context[key] && fs.existsSync(source)) vm.runInContext(read(source), context, { filename: source });
  }
  if (!context.M8Evidence || !context.M8Analysis) return;
  const evidence = context.M8Evidence.build(fight);
  const deck = document.getElementById('analysis') || document.createElement('section');
  const integrated = Boolean(deck.querySelector('[data-analysis-view]'));
  const selected = { actor: null, time: null, event: null };
  if (!integrated) context.M8Analysis.render(deck, fight, evidence, {
    eventName: event => event.spell || '未注明技能',
    actorName: id => fight.actorById.get(id)?.name || '',
    phaseLabel: phase => 'P' + phase?.id,
    timeLabel: context.M8Model.timeLabel,
    image: () => document.createElement('img'),
    portrait: () => document.createElement('img'),
    jump: time => { selected.time = time; },
    goEvent: event => { selected.event = event; },
    focusMember: actor => { selected.actor = actor; }
  });
  const tabs = deck.querySelectorAll('[data-analysis-view]');
  assert.equal(tabs.length, 4);
  const view = key => deck.querySelector('[data-analysis-view="' + key + '"]').click();
  await view('recap');
  const stats = deck.querySelectorAll('.m8-analysis-stat');
  assert.equal(stats.length, 4);
  assert.equal(Number(stats[2].lastElementChild.textContent),
    evidence.recap.eggPickups.small + evidence.recap.eggPickups.large);
  assert.equal(Number(stats[3].lastElementChild.textContent), evidence.deaths.length);

  await view('players');
  const result = deck.querySelector('tbody');
  assert.equal(result.childElementCount, fight.players.length);
  const search = deck.querySelector('input');
  const member = fight.players[0];
  await change(search, member.name, 'input');
  assert(result.childElementCount > 0 && result.childElementCount < fight.players.length);
  await result.querySelector('.m8-analysis-player').click();
  if (integrated) assert.equal(app.get('focus').value, String(member.id));
  else assert.equal(selected.actor, member.id);
  await change(search, '__missing_member__', 'input');
  assert.equal(result.childElementCount, 0);
  await change(search, '', 'input');

  await view('mechanics');
  const allCards = deck.querySelectorAll('.m8-analysis-card');
  const completeSample = integrated && rawReport.sample && fight.phaseTransitions.some(phase => phase.id === 4);
  assert.equal(allCards.length, completeSample ? 6 : 4);
  if (completeSample) {
    const [rooms, final] = allCards;
    assert.equal(rooms.querySelectorAll('.m8-analysis-player').length, 20);
    assert(final.querySelectorAll('.m8-analysis-item').length > 20);
    await rooms.querySelector('.m8-analysis-player').click();
    assert.equal(app.get('map-hud-phase').textContent, 'P2');
  }
  const cards = allCards.slice(-4);
  assert.equal(cards[0].querySelectorAll('.m8-analysis-item').length, evidence.eggs.length);
  assert.equal(cards[1].querySelectorAll('.m8-analysis-item').length, evidence.hearts.length);
  assert.equal(cards[2].querySelectorAll('.m8-analysis-item').length, evidence.soaks.length);
  if (evidence.eggs.length) {
    await cards[0].querySelector('.m8-analysis-item').click();
    if (integrated) assert.equal(Number(app.get('seek').value), evidence.eggs[0].start);
    else assert.equal(selected.time, evidence.eggs[0].start);
  }
  await view('deaths');
  const deaths = deck.querySelector('.m8-analysis-card').querySelectorAll('.m8-analysis-item');
  assert.equal(deaths.length, evidence.deaths.length);
  if (deaths.length) {
    await deaths[0].click();
    if (integrated) assert.equal(app.get('focus').value, String(evidence.deaths[0].target));
    else assert.equal(selected.event, evidence.deaths[0]);
  }
  console.log('PASS analysis deck: recap counts, member search/focus, mechanic events and death replay.');
}

async function main() {
  const args = process.argv.slice(2);
  const fresh = args.includes('--fresh');
  const [offline = defaultOffline, reportPath, publicPath = defaultPublicSample] = args.filter(arg => arg !== '--fresh');
  const html = read(offline);
  if (fresh) verifyBuildFreshness(html);
  assert(/Content-Security-Policy/i.test(html) && /default-src 'none'/.test(html), 'missing restrictive offline policy');
  assert(!/<script[^>]+\bsrc=|<link[^>]+rel="stylesheet"/i.test(html), 'offline build must embed scripts and styles');
  const reports = JSON.parse(html.match(/<script type="application\/json" id="embedded-weekly">([\s\S]*?)<\/script>/i)[1]).reports;
  const report = reportPath ? JSON.parse(read(reportPath)) : reports[0];
  const sample = report.fights.reduce((last, item) => item.endTime - item.startTime > last.endTime - last.startTime ? item : last);
  assert.deepEqual(reports.find(item => item.code === report.code), report, 'embedded report differs from source JSON');
  const app = launch(html, '?r=' + report.code + '&f=' + sample.id);
  verifyModel(app.context.M8Model, report);
  const classes = new Set(report.fights.flatMap(fight => fight.actors.filter(actor => actor.type === 'Player').map(actor => actor.subType)));
  for (const type of classes) {
    const prefix = 'assets/class-' + type.toLowerCase() + '.';
    const image = Object.entries(app.context.M8AssetUrls).find(([name]) => name.startsWith(prefix))?.[1];
    assert.match(image || '', /^data:image\/(?:jpeg|webp|png);base64,/, 'missing embedded icon for ' + type);
  }
  await verifyWorkspace(app, report, sample);
  await verifyAnalysisDeck(app, report, sample.id);
  if (fresh && app.context.M8ReplayTools) assert(/media-src blob:/.test(html), 'offline policy must allow local video playback');
  await verifyReplayTools(app, fresh);
  if (fresh) await verifyCapabilityFallback(html);
  assert.equal(app.fetches, 0, 'the local replay must not fetch');

  if (fs.existsSync(publicPath)) {
    const publicReport = JSON.parse(read(publicPath));
    const embeddedSample = reports.find(item => item.code === publicReport.code);
    if (fresh || embeddedSample) {
      assert.deepEqual(embeddedSample, publicReport, 'embedded public kill differs from source JSON');
      await verifyReportCatalog(html, report, publicReport);
    }
  }

  const online = launch(read(path.join(root, 'dist', 'index.html')), '', { publicMode: true });
  assert(online.get('play').disabled, 'public viewer should wait for import when its catalog is empty');
  const picker = online.get('import-file');
  const imported = JSON.stringify(report);
  picker.files = [{ size: Buffer.byteLength(imported), text: async () => imported }];
  await picker.emit('change');
  assert(online.get('message').hidden, 'public JSON import failed: ' + online.get('message').textContent);
  assert.equal(online.get('fight').children.length, report.fights.length);
  assert(!online.get('play').disabled);
  assert.equal(picker.value, '');
  console.log(`PASS ${report.fights.length} real fights: model and offline package; map, transport, timeline, filtering, location and private JSON import.`);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
