import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { testProviderCheck } from './test-provider-check.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const work = await mkdtemp(join(tmpdir(), 'externalsss-compat-'));
const cases = [
  { name: '9.0-react18-vite', version: '9.0.0', framework: 'react-vite', react: '18.3.1' },
  { name: '9.latest-vue-vite', version: '9.1.20', framework: 'vue3-vite' },
  { name: '10.0-react19-webpack', version: '10.0.0', framework: 'react-webpack5', react: '19.2.0' },
  { name: '10.6.0-react19-vite', version: '10.6.0', framework: 'react-vite', react: '19.2.0' },
  { name: '10.latest-vue-vite', version: '10.6.1', framework: 'vue3-vite' },
  { name: '10.latest-react18-webpack', version: '10.6.1', framework: 'react-webpack5', react: '18.3.1' },
];
const selected = process.env.EXTERNALSSS_COMPAT_CASE;
assert(!selected || cases.some(({ name }) => name === selected), `Unknown compatibility case: ${selected}`);
const run = (command, args, cwd = root) => execFileSync(command, args, {
  cwd, stdio: 'inherit', env: { ...process.env, CI: 'true', STORYBOOK_DISABLE_TELEMETRY: '1' },
});

run('pnpm', ['exec', 'tsup']);
run('pnpm', ['build-storybook']);
const packed = JSON.parse(execFileSync('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', work], { cwd: root, encoding: 'utf8' }));
const tarball = join(work, packed[0].filename);
const manager = execFileSync('tar', ['-xOf', tarball, 'package/dist/manager.js'], { encoding: 'utf8' });
assert.doesNotMatch(manager, /react\/jsx(?:-dev)?-runtime|react\.production|react\.development/);
assert.match(manager, /import React.*from "react"/);
assert.match(manager, /React\.createElement/);
const metadata = JSON.parse(execFileSync('tar', ['-xOf', tarball, 'package/package.json'], { encoding: 'utf8' }));
assert.equal(metadata.peerDependencies.react, undefined);
assert.equal(metadata.peerDependencies.storybook, '^9.0.0 || ^10.0.0');
assert.equal(metadata.engines.node, '>=26.13.0 <27');
console.log('PASS packed manager uses external React without JSX runtime or React peer');

async function listen(server, port = 0) {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  return `http://127.0.0.1:${server.address().port}`;
}

async function waitForServer(url, child) {
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    assert.equal(child.exitCode, null, 'Storybook dev exited before becoming ready');
    try { if ((await fetch(url)).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Storybook did not become ready: ${url}`);
}

async function staticServer(directory, port = 0, composedDirectory) {
  const server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname).replace(/^\/(catalog|preview)\//, '/');
      const base = composedDirectory && pathname.startsWith('/remote/') ? composedDirectory : directory;
      const servedPath = base === composedDirectory ? pathname.replace(/^\/remote/, '') : pathname;
      const path = resolve(base, `.${servedPath.endsWith('/') ? `${servedPath}index.html` : servedPath}`);
      assert(path.startsWith(`${base}/`));
      const extension = path.split('.').at(-1);
      response.setHeader('Access-Control-Allow-Origin', '*');
      response.setHeader('Content-Type', ({ html: 'text/html', js: 'text/javascript', css: 'text/css', json: 'application/json', svg: 'image/svg+xml' })[extension] ?? 'application/octet-stream');
      response.end(await readFile(path));
    } catch { response.writeHead(404); response.end(); }
  });
  return { server, origin: await listen(server, port) };
}

async function smoke(browser, base, customPreview, reactHost) {
  const page = await browser.newPage();
  const errors = [];
  const scanUrls = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.searchParams.has('externalsssRun')) scanUrls.push(url);
  });
  await page.route('**/fixture.json*', (route) => route.fulfill({ json: { ok: true } }));
  try {
    await page.goto(`${base}?path=/story/compatibility--first&globals=theme:dark&args=label:Changed&custom=a-b`);
    await page.getByRole('tab', { name: 'Externalsss' }).click();
    await page.frameLocator('#storybook-preview-iframe').getByText('Changed dark').waitFor();
    const initialUrl = page.url();
    const initialCanvas = await page.locator('#storybook-preview-iframe').getAttribute('src');
    if (customPreview) await page.evaluate((url) => { window.PREVIEW_URL = url; }, customPreview);
    await page.locator('.externalsss').getByRole('button', { name: 'Run scan' }).click();
    await page.waitForSelector('iframe[title^="Externalsss background scan"]');
    await page.locator('.externalsss').getByRole('button', { name: 'Cancel' }).click();
    await page.locator('.externalsss').getByRole('status').filter({ hasText: 'Scan cancelled' }).waitFor();
    let download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download JSON' }).click();
    const partial = JSON.parse(await readFile(await (await download).path(), 'utf8'));
    assert.equal(partial.scanStatus, 'cancelled');
    assert(partial.stories.some((story) => story.status === 'not-scanned'));
    assert.equal(page.url(), initialUrl);
    assert.equal(await page.locator('#storybook-preview-iframe').getAttribute('src'), initialCanvas);

    await page.locator('button[title="theme"], button[aria-label="theme dark"]').click();
    await page.getByText('light', { exact: true }).click();
    await page.waitForFunction(() => new URLSearchParams(location.search).get('globals') !== 'theme:dark');
    if (reactHost) await page.frameLocator('#storybook-preview-iframe').getByText('Changed light').waitFor();
    const canvasText = await page.frameLocator('#storybook-preview-iframe').getByText(/^Changed /).innerText();
    const retryUrl = page.url();
    const retryCanvas = await page.locator('#storybook-preview-iframe').getAttribute('src');
    await page.evaluate(() => { window.PREVIEW_URL = '/unused-preview.html?custom=changed'; });
    scanUrls.length = 0;
    await page.locator('.externalsss').getByRole('button', { name: 'Retry incomplete' }).click();
    await page.locator('.externalsss').getByRole('status').filter({ hasText: 'Scan complete' }).waitFor({ timeout: 60000 });
    download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download JSON' }).click();
    const report = JSON.parse(await readFile(await (await download).path(), 'utf8'));
    assert.equal(report.scanStatus, 'complete');
    assert.equal(report.summary.totalStories, 3);
    assert(report.stories.every((story) => story.status === 'complete'));
    assert(report.findings.some((finding) => finding.labels.includes('mocking')));
    assert.equal(scanUrls.length, 3);
    for (const url of scanUrls) {
      assert.equal(url.searchParams.get('globals'), 'theme:dark');
      assert.equal(url.searchParams.get('custom'), 'a-b');
      assert.equal(url.searchParams.has('args'), false);
      if (customPreview) {
        assert.equal(url.origin, new URL(customPreview).origin);
        assert.equal(url.searchParams.get('token'), 'a&b');
      }
    }
    assert.equal(page.url(), retryUrl);
    assert.equal(await page.locator('#storybook-preview-iframe').getAttribute('src'), retryCanvas);
    await page.frameLocator('#storybook-preview-iframe').getByText(canvasText, { exact: true }).waitFor();
    assert.deepEqual(errors, []);
  } catch (error) {
    console.error('Browser errors:', errors, 'Scan URLs:', scanUrls.map(String));
    console.error(await page.locator('body').innerText());
    throw error;
  } finally { await page.close(); }
}

async function reportOriginCheck(browser, base) {
  const preview = new URL('iframe.html', base);
  preview.search = new URLSearchParams({
    id: 'compatibility--first', externalsssRun: 'origin-check', externalsssStory: 'compatibility--first', instrument: 'false',
  }).toString();
  const markup = `<!doctype html><script>
    window.reports = [];
    addEventListener('message', (event) => {
      if (event.data?.namespace === 'storybook-addon-externalsss') window.reports.push(event.data);
    });
  </script><iframe src="${preview.href.replaceAll('&', '&amp;')}"></iframe>`;
  const foreign = createServer((_request, response) => {
    response.setHeader('Content-Type', 'text/html');
    response.end(markup);
  });
  const foreignOrigin = await listen(foreign);
  const page = await browser.newPage();
  await page.route('**/fixture.json*', (route) => route.fulfill({ json: { ok: true } }));
  await page.route('**/embed-test.html', (route) => route.fulfill({ contentType: 'text/html', body: markup }));
  try {
    // Positive control: instrumentation must run and report successfully.
    await page.goto(new URL('embed-test.html', base).href);
    await page.waitForFunction(() => window.reports.length > 0);
    assert.equal(await page.evaluate(() => window.reports[0].status), 'complete');
    await page.waitForTimeout(200);
    assert.equal(await page.evaluate(() => window.reports.length), 1, 'preview instrumentation loaded more than once');
    assert(await page.evaluate(() => window.reports[0].observation.resources.some(({ url }) => url.includes('fixture.json'))));

    // A foreign parent can set scan IDs and disable Storybook's instrumenter,
    // but must not receive the raw observations after the story finishes.
    await page.goto(foreignOrigin);
    await page.frameLocator('iframe').getByText('Default light').waitFor();
    await page.waitForTimeout(2000);
    assert.equal(await page.evaluate(() => window.reports.length), 0, 'raw scan observations reached a foreign parent');
  } finally {
    await page.close();
    foreign.closeAllConnections();
    await new Promise((resolve) => foreign.close(resolve));
  }
}


async function composedScan(browser, source, composedDirectory) {
  const host = await staticServer(join(root, 'storybook-static'), 6150, composedDirectory);
  if (composedDirectory) source = `${host.origin}/remote/`;
  const page = await browser.newPage();
  const errors = [];
  const scanUrls = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.searchParams.has('externalsssRun')) scanUrls.push(url);
  });
  await page.route('**/fixture.json*', (route) => route.fulfill({ json: { ok: true } }));
  await page.addInitScript(({ host, source }) => {
    if (location.origin !== host || new URLSearchParams(location.search).has('externalsssBridge')) return;
    // Supply refs before Storybook's manager starts; the actual index loading,
    // composition state, selector and bridge all run normally.
    Object.defineProperty(window, 'REFS', { configurable: true, get: () => ({
      remote: { id: 'remote', title: 'Remote catalog', url: source.replace(/\/$/, ''), type: 'server-checked' },
      missing: { id: 'missing', title: 'Unavailable catalog', url: `${host}/missing-catalog`, type: 'unknown' },
    }), set() {} });
  }, { host: host.origin, source });
  const download = async () => {
    const event = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download JSON' }).click();
    return JSON.parse(await readFile(await (await event).path(), 'utf8'));
  };
  try {
    await page.goto(`${host.origin}/?path=/story/externalsss-demo-resources--clean-image&globals=theme:dark`);
    await page.getByRole('tab', { name: 'Externalsss' }).click();
    await page.waitForFunction(() => {
      const option = document.querySelector('select[aria-label="Catalog"] option[value="remote"]');
      return option && !option.disabled;
    });
    await page.waitForFunction(() => document.querySelector('select[aria-label="Catalog"] option[value="missing"]')?.disabled);
    await page.getByRole('combobox', { name: 'Catalog' }).selectOption('remote');
    const canvas = await page.locator('#storybook-preview-iframe').getAttribute('src');
    const managerUrl = page.url();
    await page.locator('.externalsss').getByRole('button', { name: 'Run scan' }).click();
    await page.waitForSelector('iframe[title^="Externalsss remote scan"]');
    await page.locator('.externalsss').getByRole('button', { name: 'Cancel' }).click();
    await page.locator('.externalsss').getByRole('status').filter({ hasText: 'Scan cancelled' }).waitFor({ timeout: 35000 });
    // Cancellation during connection tears down the bridge. Starting again
    // must establish a fresh connection, then retain it for later retries.
    await page.locator('.externalsss').getByRole('button', { name: 'Scan again' }).click();
    await page.locator('.externalsss').getByRole('status').filter({ hasText: 'Scanning: 0 of 3 completed' }).waitFor({ timeout: 35000 });
    assert(await page.getByRole('combobox', { name: 'Catalog' }).isDisabled());
    await page.locator('.externalsss').getByRole('button', { name: 'Cancel' }).click();
    await page.locator('.externalsss').getByRole('status').filter({ hasText: 'Scan cancelled' }).waitFor();
    const partial = await download();
    assert.equal(partial.summary.totalStories, 3);
    assert.equal(partial.catalog.refId, 'remote');
    const configured = new URL(source.replace(/\/$/, ''));
    assert.equal(partial.catalog.url, configured.origin + configured.pathname);
    assert(partial.stories.some((story) => story.status !== 'complete'));
    scanUrls.length = 0;
    await page.locator('.externalsss').getByRole('button', { name: 'Retry incomplete' }).click();
    await page.locator('.externalsss').getByRole('status').filter({ hasText: 'Scan complete' }).waitFor({ timeout: 35000 });
    const report = await download();
    assert.equal(report.summary.completeStories, 3);
    assert(report.stories.every((story) => story.id.startsWith('compatibility--')));
    assert(scanUrls.length > 0);
    assert(scanUrls.every((url) => !url.searchParams.has('globals') || url.searchParams.get('globals') !== 'theme:dark'));
    assert.equal(page.url(), managerUrl);
    assert.equal(await page.locator('#storybook-preview-iframe').getAttribute('src'), canvas);
    assert(await page.locator('iframe[title^="Externalsss remote scan"]').count() === 1);
    await page.getByRole('combobox', { name: 'Catalog' }).selectOption('');
    await page.waitForSelector('iframe[title^="Externalsss remote scan"]', { state: 'detached' });
    assert.deepEqual(errors, []);
    console.log('PASS composed remote: handshake, nested-ref exclusion, remote defaults, cancellation, retry, provenance, Canvas isolation');
  } catch (error) {
    console.error('Composition browser errors:', errors);
    console.error('Scan URLs:', scanUrls.map(String));
    for (const frame of page.frames()) {
      console.error('Frame:', frame.url());
      try { console.error((await frame.locator('body').innerText({ timeout: 1000 })).slice(0, 800)); } catch {}
    }
    console.error('Refs:', await page.evaluate(() => window.REFS));
    console.error(await page.locator('body').innerText());
    throw error;
  } finally {
    await page.close();
    host.server.closeAllConnections();
    await new Promise((resolve) => host.server.close(resolve));
  }
}

const browser = await chromium.launch({ headless: true });
try {
  for (const fixture of cases.filter(({ name }) => !selected || name === selected)) {
    console.log(`Testing ${fixture.name}`);
    const directory = join(work, fixture.name);
    await mkdir(join(directory, '.storybook'), { recursive: true });
    const dependencies = { storybook: fixture.version, [`@storybook/${fixture.framework}`]: fixture.version, 'storybook-addon-externalsss': `file:${tarball}` };
    if (fixture.react) Object.assign(dependencies, { react: fixture.react, 'react-dom': fixture.react });
    else dependencies.vue = '3.5.24';
    if (fixture.framework.endsWith('vite')) dependencies.vite = '6.3.6';
    await writeFile(join(directory, 'package.json'), JSON.stringify({ private: true, type: 'module', dependencies }));
    await writeFile(join(directory, '.storybook/main.js'), `export default { stories: ['../*.stories.js'], addons: [{ name: 'storybook-addon-externalsss', options: { trustedManagerOrigins: ['http://127.0.0.1:6150'] } }], framework: '@storybook/${fixture.framework}', refs: { nested: { title: 'Nested', url: 'http://127.0.0.1:6150' } } };`);
    await writeFile(join(directory, '.storybook/preview.js'), `export default { initialGlobals: { theme: 'light' }, globalTypes: { theme: { toolbar: { items: ['light', 'dark'] } } } };`);
    const render = fixture.react
      ? `import React from 'react';\nconst render = (args, { globals }) => React.createElement('div', null, args.label + ' ' + globals.theme);`
      : `const render = (args, { globals }) => ({ setup: () => ({ text: args.label + ' ' + globals.theme }), template: '<div>{{ text }}</div>' });`;
    await writeFile(join(directory, 'Compatibility.stories.js'), `${render}
export default { title: 'Compatibility', args: { label: 'Default' }, render, loaders: [async () => {
  await new Promise(resolve => setTimeout(resolve, 1000));
  await fetch('./fixture.json');
  return {};
}] };
export const First = {};
export const Second = {};
export const Third = {};
`);
    // Storybook's own internal peers can auto-install React even in a Vue app.
    // Ignore peer installation while retaining explicitly requested Storybook packages.
    run('npm', ['install', '--no-audit', '--no-fund', ...(!fixture.react ? ['--legacy-peer-deps'] : [])], directory);
    if (!fixture.react) {
      try { await stat(join(directory, 'node_modules/react')); assert.fail('Vue fixture unexpectedly installed app React'); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    const storybookPackage = JSON.parse(await readFile(join(directory, 'node_modules/storybook/package.json'), 'utf8'));
    const storybookBin = join(directory, 'node_modules/storybook', typeof storybookPackage.bin === 'string' ? storybookPackage.bin : storybookPackage.bin.storybook);
    const reservation = createServer();
    const origin = await listen(reservation);
    await new Promise((resolve) => reservation.close(resolve));
    const child = spawn(process.execPath, [storybookBin, 'dev', '-p', new URL(origin).port, '--ci', '--no-open'], {
      cwd: directory, stdio: 'inherit', env: { ...process.env, STORYBOOK_DISABLE_TELEMETRY: '1' },
    });
    try { await waitForServer(origin, child); await testProviderCheck(browser, `${origin}/`, 'compatibility--first'); await smoke(browser, `${origin}/`, undefined, Boolean(fixture.react)); await composedScan(browser, `${origin}/`); }
    finally {
      child.kill('SIGTERM');
      if (child.exitCode === null) await new Promise((resolve) => child.once('exit', resolve));
    }
    run(process.execPath, [storybookBin, 'build', '--quiet'], directory);
    const hosted = await staticServer(join(directory, 'storybook-static'));
    try {
      await smoke(browser, `${hosted.origin}/catalog/`, `${hosted.origin}/preview/iframe.html?token=a%26b`, Boolean(fixture.react));
      await reportOriginCheck(browser, `${hosted.origin}/catalog/`);
      await composedScan(browser, `${hosted.origin}/catalog/`);
      await composedScan(browser, '', join(directory, 'storybook-static'));
      if (fixture.version.startsWith('9.')) execFileSync(process.execPath, [join(root, 'scripts/composition-security-test.mjs')], { cwd: root, stdio: 'inherit', env: { ...process.env,
        EXTERNALSSS_COMPOSITION_HOST_DIR: join(directory, 'storybook-static'), EXTERNALSSS_COMPOSITION_HOST_STORY: 'compatibility--first' } });
    }
    finally { hosted.server.closeAllConnections(); await new Promise((resolve) => hosted.server.close(resolve)); }
    console.log(`PASS ${fixture.name}: dev + static subpath/custom preview, scan, cancel, globals, Canvas isolation, JSON, no browser errors, report origin isolation`);
  }
} finally { await browser.close(); }
console.log(`Compatibility fixtures retained at ${work}`);
