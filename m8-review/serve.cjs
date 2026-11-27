const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { captureReport, WclImportError } = require('./sync.cjs');

const root = path.join(__dirname, 'dist');
const localData = path.join(__dirname, 'data');
const maxReportBytes = 100 * 1024 * 1024;
const mime = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml',
};

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': mime['.json'] });
  res.end(JSON.stringify(data));
}

async function loadCachedReport(directory, code, fight) {
  const files = typeof fight === 'number' ? [`${code}-${fight}.json`, `${code}.json`] : [`${code}.json`];
  for (const name of files) {
    try {
      const file = path.join(directory, name);
      if ((await fs.stat(file)).size > maxReportBytes) continue;
      const raw = JSON.parse(await fs.readFile(file, 'utf8'));
      if (raw?.code !== code || raw.version !== 1 || raw.encounterID !== 3492 ||
          !Array.isArray(raw.fights) || !raw.fights.length) continue;
      if (typeof fight === 'number' && !raw.fights.some(item => item.id === fight)) continue;
      return raw;
    } catch (error) {
      if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
    }
  }
  return null;
}

async function requestInput(req) {
  if (Number(req.headers['content-length']) > 2048) throw new WclImportError(413, '导入请求过长。');
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 2048) throw new WclImportError(413, '导入请求过长。');
    chunks.push(chunk);
  }
  let input;
  try {
    input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new WclImportError(400, '无法解析导入请求。');
  }
  const code = input?.code;
  const fight = input?.fight ?? null;
  if (typeof code !== 'string' || !/^[A-Za-z0-9]{16}$/.test(code) ||
      (fight !== null && fight !== 'last' && (!Number.isSafeInteger(fight) || fight <= 0))) {
    throw new WclImportError(400, 'WCL 报告或战斗编号无效。');
  }
  return { code, fight };
}

function createReviewServer({ sync = captureReport, dataDirectory = localData } = {}) {
  let importing = false;
  const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const port = server.address()?.port;
    const host = req.headers.host;
    if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) {
      return sendJson(res, 403, { error: '仅允许本机访问。' });
    }
    const origin = `http://${host}`;
    try {
      const url = new URL(req.url, origin);
      if (url.origin !== origin) return sendJson(res, 403, { error: '仅允许本机访问。' });
      if (url.pathname === '/api/import-wcl') {
        if (req.method !== 'POST') return sendJson(res, 405, { error: '请从复盘界面发起导入。' });
        if (req.headers.origin !== origin) return sendJson(res, 403, { error: '请从本机复盘界面导入。' });
        if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] ?? '')) {
          return sendJson(res, 415, { error: '导入请求格式无效。' });
        }
        const { code, fight } = await requestInput(req);
        const cached = await loadCachedReport(dataDirectory, code, fight);
        if (cached) return sendJson(res, 200, cached);
        if (importing) return sendJson(res, 409, { error: '正在读取另一份报告，请稍后再试。' });
        importing = true;
        try {
          const report = await sync({ code, requested: typeof fight === 'number' ? [fight] : [], last: fight === 'last' });
          const body = JSON.stringify(report);
          if (Buffer.byteLength(body) > maxReportBytes) {
            return sendJson(res, 413, { error: '报告超过 100 MB，请粘贴带战斗编号的链接。' });
          }
          res.writeHead(200, { 'Content-Type': mime['.json'] });
          return res.end(body);
        } finally {
          importing = false;
        }
      }
      const relative = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
      if ((req.method !== 'GET' && req.method !== 'HEAD') ||
          !/^(?:(?:assets|data)\/)?[a-z0-9-]+\.[a-z]+$/i.test(relative) || !mime[path.extname(relative)]) {
        return sendJson(res, 404, { error: '找不到页面。' });
      }
      const file = await fs.realpath(path.join(root, relative));
      const inside = path.relative(await fs.realpath(root), file);
      if (inside.startsWith('..') || path.isAbsolute(inside)) return sendJson(res, 404, { error: '找不到页面。' });
      const data = await fs.readFile(file);
      res.writeHead(200, { 'Content-Type': mime[path.extname(relative)], 'Content-Length': data.length });
      res.end(req.method === 'HEAD' ? undefined : data);
    } catch (error) {
      if (error instanceof WclImportError) return sendJson(res, error.status, { error: error.message });
      if (error.code === 'ENOENT') return sendJson(res, 404, { error: '文件未找到。' });
      sendJson(res, 502, { error: '读取失败。请确认本机 WCL 授权有效，也可以改用 JSON 导入。' });
    }
  });
  return server;
}

module.exports = { createReviewServer };

if (require.main === module) {
  const port = Number(process.argv[2] ?? '4194');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('请输入有效的本机端口。');
  createReviewServer().listen(port, '127.0.0.1', () => {
    console.log(`M8 复盘室：http://127.0.0.1:${port}/`);
  });
}
