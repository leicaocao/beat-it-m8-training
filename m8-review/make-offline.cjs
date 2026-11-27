const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const dist = path.join(__dirname, 'dist');
const data = path.join(__dirname, 'data');
const output = path.join(data, '本周M8复盘.html');
const trainingUrl = 'http://43.160.215.28/m8/';

const imageTypes = new Map([
  ['.webp', 'image/webp'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.svg', 'image/svg+xml']
]);

// HTML's raw-text parser recognizes an end tag even inside JSON strings.
function scriptJson(value) {
  return JSON.stringify(value).replace(/[<\u2028\u2029]/g, ch =>
    '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0'));
}

function localSource(reference, extension) {
  const file = reference.split(/[?#]/, 1)[0];
  if (!/^[a-z0-9_-]+\.[a-z]+$/i.test(file) || path.extname(file) !== extension) {
    throw new Error('复盘页面包含无法内嵌的本地脚本或样式链接。');
  }
  return fs.readFile(path.join(dist, file), 'utf8');
}

async function replaceAsync(text, pattern, build) {
  const changes = [...text.matchAll(pattern)];
  const replacements = await Promise.all(changes.map(build));
  let result = '';
  let offset = 0;
  for (const [index, match] of changes.entries()) {
    result += text.slice(offset, match.index) + replacements[index];
    offset = match.index + match[0].length;
  }
  return result + text.slice(offset);
}

async function loadReports(inputs) {
  if (!inputs.length) throw new Error('用法：node m8-review/make-offline.cjs <M8 报告编号或 JSON 路径> [...]');
  const reports = await Promise.all(inputs.map(async input => {
    const file = /^[A-Za-z0-9]{16}$/.test(input) ? path.join(data, input + '.json') : path.resolve(input);
    const report = JSON.parse(await fs.readFile(file, 'utf8'));
    if (report.version !== 1 || report.encounterID !== 3492 || !/^[A-Za-z0-9]{16}$/.test(report.code) ||
        !Number.isFinite(report.startTime) || !Array.isArray(report.fights) || !report.fights.length) {
      throw new Error('所选 JSON 不是可导入的 M8 复盘报告。');
    }
    return report;
  }));
  if (new Set(reports.map(report => report.code)).size !== reports.length) {
    throw new Error('每份报告只需提供一个完整的 JSON 文件。');
  }
  return reports;
}

async function loadAssets() {
  const entries = await fs.readdir(path.join(dist, 'assets'), { withFileTypes: true });
  const assets = await Promise.all(entries.filter(entry => entry.isFile()).map(async entry => {
    if (/^original-wave-(body|foam)\.webp$/.test(entry.name)) return null;
    const type = imageTypes.get(path.extname(entry.name).toLowerCase());
    if (!type) throw new Error('复盘页面包含无法内嵌的图片格式。');
    const key = 'assets/' + entry.name;
    const file = await fs.readFile(path.join(dist, key));
    return [key, 'data:' + type + ';base64,' + file.toString('base64')];
  }));
  return Object.fromEntries(assets);
}

async function buildHtml(reports, assets) {
  const original = await fs.readFile(path.join(dist, 'index.html'), 'utf8');
  const findAsset = key => {
    if (!Object.hasOwn(assets, key)) throw new Error('复盘页面引用了缺失的图片。');
    return assets[key];
  };
  let html = await replaceAsync(original, /<link rel="stylesheet" href="([^"]+)">/gi, async ([, reference]) => {
    const css = await localSource(reference, '.css');
    if (/<\/style\b/i.test(css)) throw new Error('无法安全内嵌复盘样式。');
    const inline = css.replace(/url\(\s*(['"]?)(assets\/[^'"\s)]+)\1\s*\)/gi,
      (_, quote, key) => 'url("' + findAsset(key) + '")');
    return '<style>\n' + inline + '\n</style>';
  });
  html = html.replace(/\bsrc="(assets\/[^"]+)"/gi, (_, key) => 'src="' + findAsset(key) + '"');
  const entry = '<script src="mechanics.js" defer></script>';
  if (!html.includes(entry)) throw new Error('复盘页面的启动脚本已变化，请更新离线打包器。');
  html = html.replace(entry, () =>
    '<script type="application/json" id="embedded-weekly">' + scriptJson({ reports }) + '</script>\n' +
    '  <script>globalThis.M8AssetUrls = ' + scriptJson(assets) + ';</script>\n  ' + entry);
  html = await replaceAsync(html, /<script src="([^"]+)" defer><\/script>/gi, async ([, reference]) => {
    const script = await localSource(reference, '.js');
    if (/<\/?script\b|<!--/i.test(script)) throw new Error('无法安全内嵌复盘脚本。');
    return '<script>\n' + script + '\n</script>';
  });

  // This file opens locally. Permit its embedded scripts/styles and images only.
  return html.replace('<head>', '<head>\n  <meta http-equiv="Content-Security-Policy" ' +
      'content="default-src \'none\'; script-src \'unsafe-inline\'; style-src \'unsafe-inline\'; img-src data: blob:; media-src blob:">')
    .replace('href="../m8/"', 'href="' + trainingUrl + '"');
}

async function main(inputs) {
  const [reports, assets] = await Promise.all([loadReports(inputs), loadAssets()]);
  const html = await buildHtml(reports, assets);
  await fs.mkdir(data, { recursive: true });
  const temporary = path.join(data, '.' + randomUUID() + '.html');
  try {
    await fs.writeFile(temporary, html, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    await fs.rename(temporary, output);
  } finally {
    await fs.rm(temporary, { force: true });
  }
  console.log(output);
  console.log(`已内嵌 ${reports.length} 份报告、${reports.reduce((count, report) => count + report.fights.length, 0)} 场战斗。`);
}

main(process.argv.slice(2)).catch(error => {
  console.error(error instanceof SyntaxError ? '无法解析所选报告的 JSON。' : error.message);
  process.exitCode = 1;
});
