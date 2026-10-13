import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, writeFile, symlink } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { build } from 'tsup';
import { managerHead } from '../dist/preset.js';

const root = resolve('.');
const cache = join(root, 'node_modules/.cache');
await mkdir(cache, { recursive: true });
const work = await mkdtemp(join(cache, 'externalsss-benchmark-'));
const count = Number(process.env.EXTERNALSSS_BENCH_STORIES ?? 500);
const repetitions = Number(process.env.EXTERNALSSS_BENCH_REPETITIONS ?? 3);
assert(Number.isInteger(count) && count >= 10 && Number.isInteger(repetitions) && repetitions >= 1);
const output = resolve(process.env.EXTERNALSSS_BENCH_OUTPUT ?? join(work, 'results.json'));
console.log(`Benchmark workspace: ${work}`);
const fixture = `import React from 'react';\nimport { BenchmarkCard } from ${JSON.stringify(join(root, 'scripts/fixtures/BenchmarkCard'))};\nexport default { title: 'Benchmark/Catalog' };\n` +
  Array.from({ length: count }, (_, i) => `export const Story${String(i).padStart(4, '0')} = { render: () => <BenchmarkCard kind={${i % 10}} /> };`).join('\n');
await writeFile(join(work, 'Catalog.stories.tsx'), fixture);
await writeFile(join(work, 'preview.ts'), `export default { initialGlobals: { theme: 'light' } };`);
await mkdir(join(work, 'node_modules'), { recursive: true });
await symlink(root, join(work, 'node_modules/storybook-addon-externalsss'), 'dir');
await writeFile(join(work, 'main.ts'), `export default { stories: [${JSON.stringify(join(work, 'Catalog.stories.tsx'))}], addons: ['storybook-addon-externalsss'], framework: '@storybook/react-vite', staticDirs: [${JSON.stringify(join(root, 'public'))}] };`);
execFileSync('pnpm', ['exec', 'storybook', 'build', '-c', work, '-o', join(work, 'static'), '--disable-telemetry'], { stdio: 'inherit' });
await build({ entry: { profile: join(root, 'src/report.ts'), model: join(root, 'src/model.ts') }, outDir: work, format: ['esm'], platform: 'node', splitting: false, dts: false, config: false, silent: true });
const { orderedStoryResults, summarizeScan } = await import(pathToFileURL(join(work, 'profile.js')).href);
let concurrency = 1;
const origins = ['http://127.0.0.1:6160', 'http://127.0.0.1:6161'];
const servers = [];
async function serve(port) {
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://localhost');
      if (url.pathname === '/benchmark-delayed.css' || url.pathname === '/benchmark-delayed.svg')
        await new Promise((resolve) => setTimeout(resolve, 200));
      const pathname = url.pathname === '/benchmark-delayed.svg' ? '/clean.svg' : url.pathname;
      const file = resolve(work, 'static', `.${pathname.endsWith('/') ? `${pathname}index.html` : pathname}`);
      assert(file.startsWith(`${join(work, 'static')}/`));
      let content = url.pathname === '/benchmark-delayed.css' ? Buffer.from('body { color: #222; }') : await readFile(url.pathname === '/benchmark-model.js' ? join(work, 'model.js') : file);
      if (file.endsWith('/index.html')) {
        content = Buffer.from(content.toString()
          .replace(/<script id="externalsss-trusted-origins"[^>]*>[\s\S]*?<\/script>/, '')
          .replace(/<script id="externalsss-scan-options"[^>]*>[\s\S]*?<\/script>/, '')
          .replace('</head>', `${managerHead('', { scanConcurrency: concurrency, trustedManagerOrigins: [origins[0]] })}</head>`));
      }
      response.setHeader('Access-Control-Allow-Origin', '*');
      response.setHeader('Cache-Control', file.endsWith('/index.html') ? 'no-store' : 'public, max-age=3600');
      response.setHeader('Content-Type', ({ html: 'text/html', js: 'text/javascript', json: 'application/json', css: 'text/css', svg: 'image/svg+xml', woff2: 'font/woff2' })[url.pathname.split('.').at(-1)] ?? (file.endsWith('/index.html') ? 'text/html' : 'application/octet-stream'));
      response.end(content);
    } catch { response.writeHead(404); response.end(); }
  });
  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  servers.push(server);
}
await serve(6160); await serve(6161); await serve(6162);
const browser = await chromium.launch({ headless: true });
const runs = [];
let isolationPassed = true;
async function instrument(context) {
  await context.addInitScript(({ origins }) => {
    if (!origins.includes(location.origin) || !['/', '/index.html'].includes(location.pathname)) return;
    const model = import(`${location.origin}/benchmark-model.js`);
    if (location.origin === origins[0]) Object.defineProperty(window, 'REFS', {
      configurable: true, get: () => ({ remote: { id: 'remote', title: 'Remote', url: origins[1], type: 'server-checked' } }), set() {},
    });
    window.__benchmark = { peak: 0, messages: 0, bytes: 0, leaks: 0, results: [] };
    const selector = 'iframe[title^="Externalsss background scan"]';
    const observer = new MutationObserver(() => {
      window.__benchmark.peak = Math.max(window.__benchmark.peak, document.querySelectorAll(selector).length);
    });
    observer.observe(document, { childList: true, subtree: true });
    addEventListener('message', (event) => {
      if (event.data?.namespace === 'storybook-addon-externalsss/bridge') {
        window.__benchmark.messages++; window.__benchmark.bytes += new TextEncoder().encode(JSON.stringify(event.data)).length;
        if (event.data.event?.type === 'result') window.__benchmark.results.push(event.data.event.result);
      }
      const activeSource = [...document.querySelectorAll(selector)].some((frame) => frame.contentWindow === event.source);
      if (activeSource && event.data?.namespace !== 'storybook-addon-externalsss') window.__benchmark.leaks++;
      if (activeSource && event.data?.type === 'result' && event.data?.namespace === 'storybook-addon-externalsss') {
        const data = event.data;
        void model.then(({ classifyObservation }) => window.__benchmark.results.push({ storyId: data.storyId, status: data.status, warnings: data.observation.warnings, error: data.error, findings: classifyObservation(data.observation, `${location.origin}/iframe.html`) }));
      }
    });
  }, { origins });
}
async function open(context, mode) {
  const page = await context.newPage();
  await page.goto(`${origins[0]}/?path=/story/benchmark-catalog--story-0000&globals=theme:dark`);
  await page.getByRole('tab', { name: 'Externalsss' }).click();
  await page.locator('#storybook-preview-iframe').contentFrame().locator('h2').waitFor();
  if (mode === 'composed') await page.getByRole('combobox', { name: 'Catalog' }).selectOption('remote');
  return page;
}
async function download(page) {
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download JSON' }).click();
  return JSON.parse(await readFile(await (await downloading).path(), 'utf8'));
}
function normalized(results) {
  return results.map(({ storyId, status, warnings, error, findings }) => ({ id: storyId, status, warnings: [...warnings].sort(), error,
    findings: findings.map(({ key, labels, notes }) => ({ key, labels: [...labels].sort(), notes: [...notes].sort() })).sort((a, b) => a.key.localeCompare(b.key)),
  })).sort((a, b) => a.id.localeCompare(b.id));
}
async function snapshot(page) {
  return { url: page.url(), canvas: await page.locator('#storybook-preview-iframe').getAttribute('src'),
    globals: await page.locator('#storybook-preview-iframe').contentFrame().locator('body').evaluate(() => window.__STORYBOOK_PREVIEW__?.storyStore?.userGlobals?.get()) };
}
async function assertIsolation(page, initial, limit) {
  assert.deepEqual(await snapshot(page), initial, 'Visible Canvas, selection, or globals changed');
  let peak = 0;
  for (const frame of page.frames()) {
    const stats = await frame.evaluate(() => window.__benchmark).catch(() => undefined);
    if (!stats) continue;
    peak = Math.max(peak, stats.peak); assert(stats.peak <= limit); assert.equal(stats.leaks, 0);
    assert.equal(await frame.locator('iframe[title^="Externalsss background scan"]').count(), 0);
  }
  return peak;
}
async function scan(page, mode, cacheState, repetition) {
  const initial = await snapshot(page);
  const before = await page.evaluate(() => { window.__benchmark.results = []; window.__benchmark.peak = 0; return { ...window.__benchmark }; });
  const started = performance.now();
  await page.locator('.externalsss').getByRole('button', { name: /^(Run scan|Scan again)$/ }).click();
  const heartbeat = setInterval(() => {
    void page.locator('.externalsss').getByRole('status').innerText().then((text) => console.log(`${mode} ${cacheState} c=${concurrency} #${repetition}: ${text.replaceAll('\n', ' ')}`)).catch(() => {});
  }, 45000);
  try {
    await page.getByRole('button', { name: 'Download JSON' }).waitFor({ timeout: Math.max(120000, count * 16000) });
  } finally { clearInterval(heartbeat); }
  const durationMs = performance.now() - started;
  const report = await download(page); assert.equal(report.stories.length, count); assert.equal(report.scanStatus, 'complete');
  const peakActive = await assertIsolation(page, initial, concurrency);
  const after = await page.evaluate(() => window.__benchmark);
  assert.equal(after.results.length, count, 'Every story must have individually classified findings');
  const run = { mode, cacheState, repetition, concurrency, durationMs, peakActive, bridgeMessages: after.messages - before.messages, bridgeBytes: after.bytes - before.bytes,
    incomplete: report.stories.filter(({ status }) => status !== 'complete').map(({ id, status }) => ({ id, status })), classifications: normalized(after.results) };
  runs.push(run);
  await writeFile(output, JSON.stringify({ count, repetitions, isolationPassed, runs }, null, 2));
  console.log(`${mode} ${cacheState} c=${concurrency} #${repetition}: ${(durationMs / 1000).toFixed(1)}s, ${run.incomplete.length} incomplete, ${peakActive} peak, ${run.bridgeBytes} bridge bytes`);
}
async function cancellation(mode) {
  const context = await browser.newContext(); await instrument(context); const page = await open(context, mode);
  const initial = await snapshot(page);
  await page.getByRole('button', { name: 'Run scan' }).click();
  await page.waitForFunction(() => Number(document.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')) >= 1, null, { timeout: 30000 });
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.locator('.externalsss').getByRole('status').filter({ hasText: 'Scan cancelled' }).waitFor();
  const report = await download(page);
  assert(report.stories.some(({ status }) => status === 'complete'));
  assert(report.stories.some(({ status }) => status === 'not-scanned'));
  assert(report.stories.some(({ status }) => status === 'cancelled'));
  await assertIsolation(page, initial, concurrency); await context.close();
  console.log(`PASS ${mode} cancellation/Canvas at c=${concurrency}`);
}
function median(values) { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.floor(sorted.length / 2)]; }
function decision() {
  const cohorts = [];
  for (const mode of ['local', 'composed']) for (const cacheState of ['fresh', 'warm']) {
    const cohort = runs.filter((run) => run.mode === mode && run.cacheState === cacheState);
    const sequential = cohort.filter((run) => run.concurrency === 1);
    const parallel = cohort.filter((run) => run.concurrency === 2);
    const consistent = sequential.every((run) => JSON.stringify(run.classifications) === JSON.stringify(sequential[0].classifications));
    const identical = parallel.every((run) => JSON.stringify(run.classifications) === JSON.stringify(sequential[0].classifications));
    const speedup = 1 - median(parallel.map((run) => run.durationMs)) / median(sequential.map((run) => run.durationMs));
    const baseline = new Map(sequential[0].classifications.map((story) => [story.id, JSON.stringify(story)]));
    const classificationDifferences = cohort.map((run) => ({ concurrency: run.concurrency, repetition: run.repetition, storyIds: run.classifications.filter((story) => baseline.get(story.id) !== JSON.stringify(story)).map((story) => story.id) }));
    cohorts.push({ mode, cacheState, sequentialConsistent: consistent, parallelIdentical: identical, speedup, classificationDifferences, mediansMs: Object.fromEntries([1, 2, 4].map((limit) => [limit, median(cohort.filter((run) => run.concurrency === limit).map((run) => run.durationMs))])) });
  }
  return { recommendedDefault: count === 500 && repetitions === 3 && isolationPassed && cohorts.every((c) => c.sequentialConsistent && c.parallelIdentical && c.speedup >= 0.2) ? 2 : 1, cohorts };
}
function profile() {
  const targets = Array.from({ length: count }, (_, i) => ({ id: String(i), name: String(i) }));
  const results = targets.map(({ id }) => ({ storyId: id, status: 'complete', warnings: [], findings: [{ key: `resource:${Number(id) % 10}`, name: 'Fixture', labels: ['mocking'], notes: ['Observed request'] }] }));
  const durations = [];
  for (let repetition = 0; repetition < 3; repetition++) {
    let collected = []; let resultCopyMs = 0; let aggregationMs = 0;
    for (const result of results) {
      let start = performance.now(); collected = orderedStoryResults(targets, collected, result); resultCopyMs += performance.now() - start;
      start = performance.now(); summarizeScan(targets, collected, false); aggregationMs += performance.now() - start;
    }
    durations.push({ resultCopyMs, aggregationMs });
  }
  return { kind: 'synthetic result-copying and aggregation, outside observation time', count, repetitions: durations, medianResultCopyMs: median(durations.map((d) => d.resultCopyMs)), medianAggregationMs: median(durations.map((d) => d.aggregationMs)) };
}
try {
  for (const limit of [1, 2, 4]) {
    concurrency = limit;
    for (const mode of ['local', 'composed']) await cancellation(mode);
    for (const mode of ['local', 'composed']) for (let repetition = 1; repetition <= repetitions; repetition++) {
      const context = await browser.newContext(); await instrument(context); const page = await open(context, mode);
      await scan(page, mode, 'fresh', repetition); await scan(page, mode, 'warm', repetition); await context.close();
    }
  }
  const result = { count, repetitions, isolationPassed, decision: decision(), profile: profile(), runs };
  await writeFile(output, JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ output, decision: result.decision, profile: result.profile }, null, 2));
} finally {
  await browser.close(); await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))));
}
