import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { chromium } from 'playwright';
import { managerHead } from '../dist/preset.js';

const hostDirectory = resolve(process.env.EXTERNALSSS_COMPOSITION_HOST_DIR ?? 'storybook-static');
const sourceDirectory = resolve(process.env.EXTERNALSSS_COMPOSITION_SOURCE_DIR ?? 'storybook-static');
const hostStory = process.env.EXTERNALSSS_COMPOSITION_HOST_STORY ?? 'externalsss-demo-resources--clean-image';
const hostOrigin = 'http://127.0.0.1:6150';
const namespace = 'storybook-addon-externalsss/bridge';
async function serve(port, remote = false) {
  const directory = remote ? sourceDirectory : hostDirectory;
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://localhost');
      if (url.pathname === '/probe.html') { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><title>Bridge probe</title>'); return; }
      const pathname = url.pathname.replace(/^\/deny\//, '/');
      const file = resolve(directory, `.${pathname.endsWith('/') ? `${pathname}index.html` : pathname}`);
      assert(file.startsWith(`${directory}/`));
      let content = await readFile(file);
      if (remote && file.endsWith('/index.html')) {
        const policy = managerHead('', { trustedManagerOrigins: url.pathname.startsWith('/deny/') ? [] : [hostOrigin] }).split('</script>')[0] + '</script>';
        content = Buffer.from(content.toString().replace(/<script id="externalsss-trusted-origins"[^>]*>[\s\S]*?<\/script>/, policy));
      }
      response.setHeader('Access-Control-Allow-Origin', '*');
      response.setHeader('Content-Type', ({ html: 'text/html', js: 'text/javascript', json: 'application/json', css: 'text/css', svg: 'image/svg+xml' })[file.split('.').at(-1)] ?? 'application/octet-stream');
      response.end(content);
    } catch { response.writeHead(404); response.end(); }
  });
  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  return { server, origin: `http://127.0.0.1:${server.address().port}` };
}
const host = await serve(6150);
const source = await serve(0, true);
const foreign = await serve(0);
const browser = await chromium.launch();
const header = (bridgeId, requestId, type, extra = {}) => ({ namespace, version: 1, bridgeId, requestId, type, ...extra });
async function probe(parent, denied = false) {
  const page = await browser.newPage();
  await page.goto(`${parent}/probe.html`);
  const bridgeId = crypto.randomUUID();
  await page.evaluate(({ source, bridgeId, namespace }) => {
    window.replies = [];
    window.addEventListener('message', (event) => { if (event.data?.namespace === namespace) window.replies.push(event.data); });
    const frame = document.createElement('iframe'); frame.id = 'probe';
    frame.src = `${source}?path=/externalsss/bridge&externalsssBridge=${bridgeId}&addonPanel=storybook-addon-externalsss/panel&trustedManagerOrigins=${encodeURIComponent(location.origin)}`;
    document.body.append(frame);
  }, { source: `${source.origin}/${denied ? 'deny/' : ''}`, bridgeId, namespace });
  await page.frameLocator('#probe').locator('[data-externalsss-bridge]').waitFor({ state: 'attached' });
  const send = async (message) => page.evaluate(({ message, origin }) => document.querySelector('#probe').contentWindow.postMessage(message, origin), { message, origin: source.origin });
  if (parent === hostOrigin && !denied) {
    await page.evaluate(({ message, origin }) => { window.probeTimer = setInterval(() => document.querySelector('#probe').contentWindow.postMessage(message, origin), 200); }, { message: { ...header(bridgeId, '', 'hello'), version: 999 }, origin: source.origin });
    try { await page.waitForFunction(() => window.replies.some((reply) => reply.type === 'error'), null, { timeout: 5000 }); }
    catch(error) { const frame = page.frames().find((frame) => frame.url().includes('externalsssBridge=')); console.error('PROBE URL', frame?.url()); console.error('POLICY', await frame?.locator('#externalsss-trusted-origins').textContent()); console.error('PROBE BODY', await frame?.locator('body').innerText()); throw error; }
    await page.evaluate(() => clearInterval(window.probeTimer));
    assert.match(await page.evaluate(() => window.replies[0].error), /Incompatible/);
    await page.evaluate(() => { window.replies = []; });
    await send(header(bridgeId, '', 'hello'));
    await page.waitForFunction(() => window.replies.some((reply) => reply.type === 'ready'));
    await page.evaluate(({ message, origin }) => {
      const sibling = document.createElement('iframe'); sibling.id = 'sibling';
      sibling.srcdoc = `<script>parent.document.querySelector('#probe').contentWindow.postMessage(${JSON.stringify(message)}, ${JSON.stringify(origin)});parent.forgedSent=true;</script>`;
      document.body.append(sibling);
    }, { message: header(bridgeId, 'forged', 'start'), origin: source.origin });
    await page.waitForFunction(() => window.forgedSent === true);
  } else {
    await send(header(bridgeId, '', 'hello'));
    await send(header(bridgeId, 'forged', 'start'));
  }
  await page.waitForTimeout(1200);
  assert.equal(await page.frameLocator('#probe').locator('iframe[title^="Externalsss background scan"]').count(), 0);
  if (parent !== hostOrigin || denied) assert.deepEqual(await page.evaluate(() => window.replies), []);
  else assert(!(await page.evaluate(() => window.replies)).some((reply) => reply.type === 'session'));
  await page.close();
}
async function openHost(mode = 'real') {
  const page = await browser.newPage();
  await page.addInitScript(({ host, source, mode }) => {
    if (location.origin !== host) return;
    Object.defineProperty(window, 'REFS', { configurable: true, get: () => ({ remote: { id: 'remote', title: 'Remote', url: source, type: 'server-checked' } }), set() {} });
    const original = window.setTimeout.bind(window);
    window.setTimeout = (callback, delay, ...args) => original(callback, mode !== 'real' && (delay === 30000 || delay === 20000) ? 1200 : delay, ...args);
  }, { host: hostOrigin, source: source.origin, mode });
  await page.route('**/iframe.html?**', async (route) => {
    const url = new URL(route.request().url());
    if (!url.searchParams.has('externalsssStory')) { await route.continue(); return; }
    const observation = { resources: [{ url: `${url.origin}/${url.origin === hostOrigin ? 'local' : 'remote'}.json?token=private`, initiatorType: 'fetch', startTime: 0 }], images: [], elementErrors: [], fonts: [], warnings: [] };
    await route.fulfill({ contentType: 'text/html', body: `<script>setTimeout(()=>parent.postMessage(${JSON.stringify({ namespace: 'storybook-addon-externalsss', version: 1, type: 'result', runId: url.searchParams.get('externalsssRun'), storyId: url.searchParams.get('externalsssStory'), status: 'complete', observation })}, location.origin),100);</script>` });
  });
  if (mode !== 'real') await page.route(`${source.origin}/?**`, async (route) => {
    const url = new URL(route.request().url());
    if (!url.searchParams.has('externalsssBridge')) { await route.continue(); return; }
    const bridgeId = url.searchParams.get('externalsssBridge');
    const targets = ['first', 'second'].map((id) => ({ id, name: id, managerHref: `${source.origin}/?path=/story/${id}`, previewHref: `${source.origin}/iframe.html?id=${id}` }));
    const results = [{ storyId: 'first', status: 'complete', warnings: [], findings: [] }];
    const session = { phase: 'running', targets, results, retrying: false, progress: { completed: 1, total: 2, current: 'second' } };
    await route.fulfill({ contentType: 'text/html', body: `<script>
      addEventListener('message', event => {
        const data=event.data;
        if(event.source!==parent || event.origin!==${JSON.stringify(hostOrigin)} || data?.bridgeId!==${JSON.stringify(bridgeId)}) return;
        if(${JSON.stringify(mode)}==='missing') return;
        const reply=(type,payload={})=>parent.postMessage({...data,type,...payload},event.origin);
        if(data.type==='hello') reply('ready',${mode === 'version' ? '{version:999}' : '{}'});
        if(data.type==='start') {
          if(${JSON.stringify(mode)}==='malformed') reply('session',{session:{phase:'finished',targets:42}});
          else {
            reply('session',{session:${JSON.stringify(session)}});
            if(${JSON.stringify(mode)}==='stale') {
              parent.postMessage({...data,requestId:'old',version:999,type:'error',error:'stale error'},event.origin);
              setTimeout(()=>parent.postMessage({...data,type:'error',version:999,error:'late completed request'},event.origin),400);
              setTimeout(()=>reply('session',{session:{...${JSON.stringify(session)},phase:'finished',outcome:'complete',results:[...${JSON.stringify(results)},{storyId:'second',status:'complete',warnings:[],findings:[]}]}}),200);
            }
          }
        }
      });
    </script>` });
  });
  await page.goto(`${hostOrigin}/?path=/story/${hostStory}`);
  await page.getByRole('tab', { name: 'Externalsss' }).click();
  await page.waitForFunction(() => { const option = document.querySelector('select[aria-label="Catalog"] option[value="remote"]'); return option && !option.disabled; });
  return page;
}
async function download(page) {
  const event = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download JSON' }).click();
  return JSON.parse(await readFile(await (await event).path(), 'utf8'));
}
try {
  await probe(hostOrigin);
  await probe(foreign.origin);
  await probe(hostOrigin, true);
  console.log('PASS trusted origin, deny-by-default, query authorization rejection, wrong sender and incompatible command version');
  const page = await openHost();
  await page.getByRole('button', { name: 'Run scan' }).click();
  await page.getByRole('status').filter({ hasText: 'Scan complete' }).waitFor();
  const local = await download(page);
  await page.getByRole('combobox', { name: 'Catalog' }).selectOption('remote');
  await page.getByRole('button', { name: 'Run scan' }).click();
  await page.getByRole('status').filter({ hasText: 'Scan complete' }).waitFor();
  const remote = await download(page);
  const index = JSON.parse(await readFile(join(sourceDirectory, 'index.json'), 'utf8'));
  assert.deepEqual(remote.stories.map(({ id }) => id), Object.values(index.entries).filter((entry) => entry.type === 'story').map(({ id }) => id));
  assert(remote.findings.every((finding) => finding.resource.includes('/remote.json')));
  assert.equal(remote.catalog.refId, 'remote');
  await page.getByRole('combobox', { name: 'Catalog' }).selectOption('');
  const restored = await download(page);
  assert.deepEqual(restored, { ...local, generatedAt: restored.generatedAt });
  await page.close();
  console.log('PASS duplicate story IDs and independent local/remote reports');
  for (const mode of ['missing', 'version', 'malformed', 'inactive', 'stale']) {
    const page = await openHost(mode);
    await page.getByRole('combobox', { name: 'Catalog' }).selectOption('remote');
    await page.getByRole('button', { name: 'Run scan' }).click();
    await page.getByRole('status').filter({ hasText: mode === 'stale' ? 'Scan complete' : 'Scan stopped' }).waitFor();
    if (mode === 'stale') { await page.waitForTimeout(500); assert.match(await page.getByRole('status').innerText(), /Scan complete/); }
    if (mode !== 'stale') {
      assert.equal(await page.locator('iframe[title^="Externalsss remote scan"]').count(), 0);
      assert.equal(await page.getByRole('button', { name: 'Retry incomplete' }).count(), 0);
    }
    if (mode === 'inactive') {
      const report = await download(page);
      assert.equal(report.scanStatus, 'error'); assert.equal(report.summary.completeStories, 1);
      assert.equal(report.stories[1].status, 'not-scanned');
    }
    if (mode === 'missing') assert.match(await page.locator('[role="alert"]').innerText(), /Could not connect/);
    if (mode === 'version') assert.match(await page.locator('[role="alert"]').innerText(), /Incompatible/);
    if (mode === 'malformed') assert.match(await page.locator('[role="alert"]').innerText(), /Invalid remote/);
    await page.close();
  }
  console.log('PASS missing addon, incompatible response, malformed results, inactivity with partial export, stale replies');
} finally {
  await browser.close();
  for (const { server } of [host, source, foreign]) { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
}
