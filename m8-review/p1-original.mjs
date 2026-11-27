import {
  AmbientLight, AnimationMixer, DirectionalLight, Group, HemisphereLight, OrthographicCamera,
  Scene, Vector3, WebGLRenderer,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';

const pitch = .25;
const ground = Math.cos(pitch);

function decode(base64) {
  if (typeof base64 !== 'string' || base64.length > 16_000_000) throw new Error('Invalid local model');
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  if (bytes.length < 12 || binary.slice(0, 4) !== 'glTF') throw new Error('Invalid GLB header');
  return bytes.buffer;
}

async function loadModels(path) {
  const response = await fetch(path);
  if (!response.ok) return null;
  const pack = await response.json();
  const loader = new GLTFLoader();
  const [boss, tail] = await Promise.all(['boss', 'tail'].map(key => loader.parseAsync(decode(pack[key]), '')));
  return { boss, tail };
}

function makeRenderer(models) {
  const canvas = document.createElement('canvas');
  const renderer = new WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setClearColor(0x000000, 0);
  const scene = new Scene();
  scene.add(new AmbientLight(0xffffff, .62), new HemisphereLight(0xf2f1fd, 0x394333, .85));
  const key = new DirectionalLight(0xfff6d9, 2.25);
  key.position.set(-300, 840, -420);
  scene.add(key);
  const fill = new DirectionalLight(0xa7bef3, .54);
  fill.position.set(200, 240, 310);
  scene.add(fill);
  const camera = new OrthographicCamera(0, 1, 1, 0, .1, 5600);
  camera.position.set(0, 1800 * ground, 1800 * Math.sin(pitch));
  camera.up.set(0, 0, -1);
  camera.lookAt(new Vector3());
  const instances = new Map();
  let w = 0, h = 0, resolution = 0;

  function instance(entry) {
    const ghost = entry.role === 'tail-echo';
    const source = models[entry.role === 'boss' ? 'boss' : 'tail'];
    const container = new Group();
    const model = clone(source.scene);
    const owned = new Map();
    const materials = new Set();
    function material(base) {
      if (owned.has(base)) return owned.get(base);
      const copy = base.clone();
      if (ghost) {
        copy.color.setRGB(.53, 1, .93);
        copy.emissive?.setRGB(.08, .45, .42);
        copy.emissiveIntensity = .55;
        copy.transparent = true;
        copy.depthWrite = false;
      }
      owned.set(base, copy);
      materials.add(copy);
      return copy;
    }
    model.traverse(node => {
      if (!node.isMesh) return;
      // Rest-pose bounds can be too small for the fanned wings and sweep clips.
      node.frustumCulled = false;
      if (ghost) node.material = Array.isArray(node.material) ? node.material.map(material) : material(node.material);
    });
    container.add(model);
    scene.add(container);
    const mixer = new AnimationMixer(model);
    return { container, model, mixer, clips: new Map(source.animations.map(clip => [clip.name, clip])),
      action: null, active: null, materials, opacity: null };
  }

  function pose(unit, cue) {
    const clip = unit.clips.get(cue.name) || unit.clips.get('a0');
    if (!clip || !clip.duration) return;
    if (unit.active !== clip.name) {
      if (unit.action) unit.action.stop();
      unit.action = unit.mixer.clipAction(clip).reset().play();
      unit.active = clip.name;
    }
    unit.action.time = cue.loop ? cue.seconds % clip.duration : Math.min(cue.seconds, clip.duration - 1e-5);
    unit.mixer.update(0);
  }

  function clear() {
    for (const unit of instances.values()) {
      scene.remove(unit.container);
      unit.mixer.stopAllAction();
      unit.mixer.uncacheRoot(unit.model);
      for (const material of unit.materials) material.dispose();
    }
    instances.clear();
  }

  return {
    canvas,
    draw(entries, width, height, dpi, unitsToScreen) {
      if (renderer.getContext().isContextLost()) return false;
      if (width !== w || height !== h || dpi !== resolution) {
        w = width; h = height; resolution = dpi;
        renderer.setPixelRatio(dpi);
        renderer.setSize(w, h, false);
        camera.right = w;
        camera.bottom = -h;
        camera.top = 0;
        camera.updateProjectionMatrix();
      }
      const present = new Set();
      for (const entry of entries) {
        const id = entry.actor.id;
        if (!instances.has(id)) instances.set(id, instance(entry));
        const unit = instances.get(id);
        present.add(id);
        unit.container.visible = true;
        unit.container.position.set(entry.x, 0, entry.y / ground);
        unit.container.rotation.y = -Math.atan2(Math.sin(entry.angle) / ground, Math.cos(entry.angle));
        unit.container.scale.setScalar(unitsToScreen * 100);
        if (unit.opacity !== entry.alpha) {
          unit.opacity = entry.alpha;
          for (const copy of unit.materials) copy.opacity = entry.alpha;
        }
        pose(unit, entry.cue);
      }
      for (const [id, unit] of instances) if (!present.has(id)) unit.container.visible = false;
      renderer.render(scene, camera);
      return true;
    },
    clear,
  };
}

globalThis.M8P1Original = {
  async load(path) {
    const models = await loadModels(path);
    return models && makeRenderer(models);
  },
};
