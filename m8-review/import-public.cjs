const http = require('node:http');
const { captureReport, savePublicReport, WclImportError } = require('./sync.cjs');
const { readPublicCache, remainingFightIds, saveWretchPositions, saveWretchBatch } = require('./enrich-wretch.cjs');

const HOST = '127.0.0.1';
const PORT = 4197;
const ORIGIN = `http://${HOST}:${PORT}`;
const TOKEN_URL = 'https://cn.warcraftlogs.com/oauth/token';
const GRAPHQL_URL = 'https://www.warcraftlogs.com/api/v2/client';

async function requestWcl(url, options, stage) {
  const response = await fetch(url, {
    ...options, method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30000),
  }).catch(() => { throw new WclImportError(502, `没能连接到 WCL ${stage}接口。`); });
  if (!response.ok) throw new WclImportError(502, `WCL ${stage}接口返回 HTTP ${response.status}。`);
  return response.json().catch(() => { throw new WclImportError(502, `WCL ${stage}没有返回有效数据。`); });
}

async function createPublicClient(id, secret) {
  if (!/^[-\w.]{1,128}$/.test(id || '') || !/^[!-~]{1,256}$/.test(secret || '')) {
    throw new WclImportError(400, 'WCL 客户端编号或密钥格式无效。');
  }
  const { access_token: token } = await requestWcl(TOKEN_URL, {
    headers: { authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}` },
    body: new URLSearchParams({ grant_type: 'client_credentials' }),
  }, '授权');
  if (typeof token !== 'string' || !token) throw new WclImportError(502, 'WCL 没有签发读取令牌。');
  return {
    async graphql(query, variables) {
      const payload = await requestWcl(GRAPHQL_URL, {
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ query, variables }),
      }, '查询');
      if (payload.errors?.length || !payload.data) {
        throw new WclImportError(502, 'WCL 未能执行战斗数据查询。');
      }
      return payload.data;
    },
  };
}

async function readForm(req) {
  if (!/^application\/x-www-form-urlencoded(?:;|$)/.test(req.headers['content-type'] || '')) {
    throw new WclImportError(415, '请选择本机导入表单。');
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > 2048) throw new WclImportError(413, '表单太长。');
    chunks.push(chunk);
  }
  return new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
}

function send(res, status, body, type = 'text/plain') {
  res.writeHead(status, {
    'Content-Type': `${type}; charset=utf-8`,
    'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'none'; form-action 'self'; frame-ancestors 'none'",
    'Referrer-Policy': 'same-origin',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(body);
}

const code = process.argv[2];
const args = process.argv.slice(3);
const wretchMode = args.length === 2 && ['--wretch-fight', '--wretch-except'].includes(args[0]) ? args[0] : null;
const wretchId = wretchMode ? Number(args[1]) : null;
if (!/^[A-Za-z0-9]{16}$/.test(code || '') ||
    (args.length && (!Number.isSafeInteger(wretchId) || wretchId <= 0))) {
  console.error('用法：node import-public.cjs <公开 WCL 报告编号> [--wretch-fight <编号> 或 --wretch-except <已补齐编号>]');
  process.exit(1);
}
const wretchScope = wretchMode === '--wretch-except' ? `，只补 #${wretchId} 以外战斗的畸体坐标` :
  wretchMode === '--wretch-fight' ? `，只补 #${wretchId} 的疫鳞畸体坐标` : '';

let busy = false;
const server = http.createServer(async (req, res) => {
  if (req.headers.host !== `${HOST}:${PORT}`) return send(res, 403, '仅限本机访问。');
  if (req.method === 'GET' && req.url === '/') {
    return send(res, 200, `<!doctype html><html lang="zh-CN"><meta charset="utf-8">
      <title>M8 公开战报导入</title><h1>M8 公开战报导入</h1>
      <p>战报：${code}${wretchScope}。凭据只用于本次导入，不保存。</p>
      <form method="post" action="/import" autocomplete="off">
        <p><label>Client ID <input name="clientId" maxlength="128" required></label></p>
        <p><label>Client Secret <input name="clientSecret" type="password" maxlength="256" required></label></p>
        <button>导入公开战报</button>
      </form>`, 'text/html');
  }
  if (req.method !== 'POST' || req.url !== '/import') return send(res, 404, '页面不存在。');
  if (req.headers.origin !== ORIGIN) return send(res, 403, '仅接受本机页面提交。');
  if (busy) return send(res, 409, '已经在导入，请稍等。');
  busy = true;
  try {
    const requested = wretchMode === '--wretch-except' ? remainingFightIds(await readPublicCache(code), wretchId) :
      wretchMode === '--wretch-fight' ? [wretchId] : [];
    const form = await readForm(req);
    const publicClient = await createPublicClient(form.get('clientId'), form.get('clientSecret'));
    form.delete('clientId');
    form.delete('clientSecret');
    const report = await captureReport({ code, publicClient, requested,
      wretchOnly: Boolean(wretchMode), onFight: fight => console.log(`已读取 WCL #${fight.id}`) });
    let result;
    if (wretchMode === '--wretch-except') {
      const { updated, skipped } = await saveWretchBatch(report, requested);
      const info = updated.flatMap(item => item.info);
      const count = info.reduce((sum, item) => sum + item.added, 0);
      const open = info.flatMap(item => item.oldGaps).filter(gap => gap.maxGapMs > 3000).length;
      console.log(JSON.stringify({ updated, skipped }));
      result = `已补 ${updated.length}/${requested.length} 把、${info.length} 只畸体，共 ${count} 条坐标；${open} 段原断档仍缺采样。${skipped.length ? ` 未改动：${skipped.map(item => `#${item.fightId}`).join('、')}。` : ''}`;
    } else if (wretchMode === '--wretch-fight') {
      const info = await saveWretchPositions(report, wretchId);
      console.log(JSON.stringify(info));
      result = `WCL #${wretchId} 已补 ${info.reduce((count, item) => count + item.added, 0)} 条畸体坐标。`;
    } else {
      await savePublicReport(report);
      result = `成功导入 ${report.fights.length} 把，最后一把是 WCL #${report.fights.at(-1).id}。`;
    }
    console.log(result);
    send(res, 200, result);
    server.close();
  } catch (error) {
    const known = error instanceof WclImportError;
    const message = known ? error.message : '导入失败，本机报告未更新。';
    console.error(message);
    if (!res.destroyed) send(res, known ? error.status : 500, message);
  } finally {
    busy = false;
  }
});

server.listen(PORT, HOST, () => console.log(`本机一次性导入：${ORIGIN}/`));
