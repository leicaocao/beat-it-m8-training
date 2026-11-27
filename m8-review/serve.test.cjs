const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { once } = require('node:events');
const { createReviewServer } = require('./serve.cjs');
const { WclImportError } = require('./sync.cjs');

const code = 'AbCdEfGh12345678';
const sample = { version: 1, encounterID: 3492, code, fights: [{ id: 7 }, { id: 9 }] };

async function preview(t, sync) {
  const dataDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'm8-review-test-'));
  const server = createReviewServer({ sync, dataDirectory });
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    await fs.rm(path.join(dataDirectory, code + '.json'), { force: true });
    await fs.rmdir(dataDirectory);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = 'http://127.0.0.1:' + server.address().port;
  return {
    origin, dataDirectory,
    importReport(input, source = origin) {
      return fetch(origin + '/api/import-wcl', {
        method: 'POST',
        headers: { Origin: source, 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
    },
  };
}

test('the local page is served and WCL report links can request one fight or the last fight', async t => {
  const calls = [];
  const app = await preview(t, options => {
    calls.push(options);
    return sample;
  });
  const page = await fetch(app.origin);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /id="wcl-import-form"/);
  for (const fight of [7, 'last', null]) {
    const response = await app.importReport({ code, fight });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), sample);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
  assert.deepEqual(calls, [
    { code, requested: [7], last: false },
    { code, requested: [], last: true },
    { code, requested: [], last: false },
  ]);
});

test('use an existing report file without contacting WCL, but do not serve private data as static files', async t => {
  const app = await preview(t, () => assert.fail('should use local data'));
  await fs.writeFile(path.join(app.dataDirectory, code + '.json'), JSON.stringify(sample));
  assert.deepEqual(await (await app.importReport({ code, fight: 9 })).json(), sample);
  assert.equal((await fetch(app.origin + '/data/' + code + '.json')).status, 404);
});

test('cross-origin and invalid import requests are refused before contacting WCL', async t => {
  const app = await preview(t, () => assert.fail('invalid request reached WCL'));
  assert.equal((await app.importReport({ code }, 'https://example.org')).status, 403);
  assert.equal((await app.importReport({ code: '../sync-settings' })).status, 400);
  assert.equal((await app.importReport({ code, fight: { id: 7 } })).status, 400);
});

test('an unconfigured WCL authorization has a readable import error', async t => {
  const app = await preview(t, () => { throw new WclImportError(503, '本机还未配置 WCL 授权。'); });
  const response = await app.importReport({ code });
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /未配置 WCL 授权/);
});
