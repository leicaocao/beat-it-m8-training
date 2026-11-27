const fs = require('node:fs');
const path = require('node:path');

const root = __dirname;
const modules = path.join(root, 'data', 'model-build-tools', 'node_modules');
const esbuild = require(path.join(modules, 'esbuild'));
esbuild.buildSync({
  entryPoints: [path.join(root, 'p1-original.mjs')],
  bundle: true,
  minify: true,
  format: 'iife',
  target: 'es2022',
  legalComments: 'eof',
  nodePaths: [modules],
  outfile: path.join(root, 'dist', 'p1-original.js'),
});

if (!process.argv.includes('--runtime-only')) {
  const files = { boss: 'hexweaver-ulatek.glb', tail: 'hexweaver-gore-rattle.glb' };
  const pack = Object.fromEntries(Object.entries(files).map(([key, name]) => {
    const data = fs.readFileSync(path.join(root, 'data', name));
    if (data.length < 20 || data.toString('ascii', 0, 4) !== 'glTF' || data.readUInt32LE(8) !== data.length) {
      throw new Error('Invalid GLB: ' + name);
    }
    return [key, data.toString('base64')];
  }));
  fs.writeFileSync(path.join(root, 'dist', 'assets', 'original-p1-models.json'), JSON.stringify(pack));
}
