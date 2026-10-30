import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { testProviderCheck } from './test-provider-check.mjs';

const base = process.env.EXTERNALSSS_STORYBOOK_URL ?? 'http://127.0.0.1:6100/';
const fullOnly = process.env.EXTERNALSSS_TEST_MODE === 'full';
const browser = await chromium.launch({ headless: true });
const concurrency = Number(process.env.EXTERNALSSS_TEST_CONCURRENCY ?? 1);
assert([1, 2, 4].includes(concurrency));
const originalNewPage = browser.newPage.bind(browser);
browser.newPage = async (...args) => {
  const page = await originalNewPage(...args);
  // Fulfilled manager HTML needs permission to reach Storybook's loopback WebSocket in Chromium 148.
  await page.context().grantPermissions(['local-network-access'], { origin: new URL(base).origin });
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (!route.request().isNavigationRequest() || (!url.pathname.endsWith('/') && !url.pathname.endsWith('/index.html'))) { await route.continue(); return; }
    const response = await route.fetch();
    const body = (await response.text()).replace(/(<script id="externalsss-scan-options"[^>]*>)[\s\S]*?(<\/script>)/, `$1${JSON.stringify({ scanConcurrency: concurrency })}$2`);
    await route.fulfill({ response, body });
  });
  await page.addInitScript(() => {
    window.__externalsssPeak = 0;
    new MutationObserver(() => {
      window.__externalsssPeak = Math.max(window.__externalsssPeak, document.querySelectorAll('iframe[title^="Externalsss background scan"]').length);
    }).observe(document, { childList: true, subtree: true });
  });
  return page;
};

async function openPanel(page) {
  await page.goto(new URL('?path=/story/externalsss-demo-resources--clean-image', base).href, { waitUntil: 'domcontentloaded' });
  await page.getByRole('tab', { name: 'Externalsss' }).click();
}

async function waitForScan(page, phrase) {
  await page.locator('.externalsss').getByRole('status').filter({ hasText: phrase }).waitFor({ timeout: 90000 });
}

async function fullScan() {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await openPanel(page);
  const initialUrl = page.url();
  const initialCanvas = await page.locator('iframe[title="storybook-preview-iframe"]').getAttribute('src');
  await page.evaluate(() => {
    window.__externalsssLeaks = 0;
    window.addEventListener('message', (event) => {
      const outer = [...document.querySelectorAll('iframe[title^="Externalsss background scan"]')].find((frame) => event.source === frame.contentWindow);
      if (outer && event.data?.namespace !== 'storybook-addon-externalsss') {
        window.__externalsssLeaks += 1;
      }
    });
  });
  await page.locator('.externalsss').getByRole('button', { name: 'Run scan' }).click();
  await waitForScan(page, 'Scan finished with gaps');
  assert.equal(page.url(), initialUrl, 'the manager URL changed during the background scan');
  assert.equal(await page.locator('iframe[title="storybook-preview-iframe"]').getAttribute('src'), initialCanvas, 'the visible Canvas changed');
  assert.equal(await page.evaluate(() => window.__externalsssLeaks), 0, 'hidden Storybook messages leaked into the manager');
  const counts = await page.locator('[aria-label="Finding counts"]').innerText();
  assert.match(counts, /Load failure/);
  assert.match(counts, /External dependency/);
  assert.match(counts, /Font timing/);
  assert.match(counts, /Review for mocking/);
  assert.match(counts, /Incomplete\s*1/);
  const report = await page.locator('[aria-label="Findings"]').innerText();
  assert.match(report, /missing-image\.png/);
  assert.match(report, /Externalsss failure/);
  assert.match(report, /Externalsss late/);
  assert.match(report, /fixture\.json/);
  assert.match(report, /externalsss-api\?…/);
  assert.doesNotMatch(report, /demo-secret/, 'query string appeared in the collapsed report');
  await page.locator('summary').filter({ hasText: 'externalsss-api' }).click();
  assert.match(await page.locator('[aria-label="Findings"]').innerText(), /demo-secret/);
  const incompleteText = await page.locator('[aria-label="Incomplete stories"]').innerText();
  assert.match(incompleteText, /Render Error/);
  assert.match(incompleteText, /Render error/i);
  await page.getByRole('button', { name: /Load failure 3/ }).click();
  assert.equal(await page.locator('[aria-label="Findings"] details').count(), 3);
  await page.getByRole('button', { name: /All 7/ }).click();
  await page.setViewportSize({ width: 820, height: 720 });
  await page.getByRole('combobox', { name: 'Filter findings' }).selectOption('mocking');
  assert.equal(await page.locator('[aria-label="Findings"] details').count(), 2);
  await page.getByRole('combobox', { name: 'Filter findings' }).selectOption('all');
  const fullDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download JSON' }).click();
  const downloaded = await fullDownload;
  assert.match(downloaded.suggestedFilename(), /^externalsss-report-.*\.json$/);
  const exportedText = await readFile(await downloaded.path(), 'utf8');
  const exported = JSON.parse(exportedText);
  assert.equal(exported.schemaVersion, 1);
  assert.equal(exported.scanStatus, 'complete');
  assert.equal(exported.summary.totalStories, 10);
  assert.equal(exported.stories.length, 10);
  assert(exported.findings.some((finding) => finding.resource.includes('externalsss-api?…')));
  assert(exported.findings.some((finding) => finding.affectedStories.length > 0));
  assert.doesNotMatch(exportedText, /demo-secret|"key"\s*:|"url"\s*:/);
  assert.equal(await page.evaluate(() => window.__externalsssPeak), concurrency);
  assert.equal(await page.locator('iframe[title^="Externalsss background scan"]').count(), 0);
  await page.close();
  console.log('PASS full scan, classification, render error, Canvas isolation, redacted JSON export');
}

async function cancelledScan() {
  const page = await browser.newPage();
  await openPanel(page);
  const initialUrl = page.url();
  await page.locator('.externalsss').getByRole('button', { name: 'Run scan' }).click();
  await page.waitForFunction(() => Number(document.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')) >= 1, null, { timeout: 15000 });
  await page.locator('.externalsss').getByRole('button', { name: 'Cancel' }).click();
  await waitForScan(page, 'Scan cancelled');
  assert.equal(await page.locator('iframe[title^="Externalsss background scan"]').count(), 0);
  assert.equal(page.url(), initialUrl);
  assert.match(await page.locator('.externalsss').getByRole('status').innerText(), /[1-9] of 10 stories checked\. Results are partial/);
  assert.match(await page.locator('[aria-label="Incomplete stories"]').innerText(), /stories not scanned/);
  const partialDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download JSON' }).click();
  const partial = JSON.parse(await readFile(await (await partialDownload).path(), 'utf8'));
  assert.equal(partial.scanStatus, 'cancelled');
  assert(partial.stories.some((story) => story.status === 'not-scanned'));
  assert(partial.summary.incompleteStories > 0);
  await page.locator('.externalsss').getByRole('button', { name: 'Retry incomplete' }).click();
  await waitForScan(page, 'Scan finished with gaps');
  const mergedDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download JSON' }).click();
  const merged = JSON.parse(await readFile(await (await mergedDownload).path(), 'utf8'));
  assert.equal(merged.summary.totalStories, 10);
  assert.equal(merged.summary.completeStories, 9);
  assert(!merged.stories.some((story) => story.status === 'not-scanned'));
  assert.deepEqual(merged.stories.filter((story) => partial.stories.some((old) => old.id === story.id && old.status === 'complete')), partial.stories.filter((story) => story.status === 'complete'));
  await page.close();
  console.log('PASS cancellation and partial JSON export');
}

async function delayedStylesheetScan() {
  const page = await browser.newPage();
  let requested = 0;
  await page.route('**/externalsss-delayed.css', async (route) => {
    requested += 1;
    await new Promise((resolve) => setTimeout(resolve, 2500));
    await route.fulfill({ status: 404, contentType: 'text/css', body: '' });
  });
  await page.addInitScript(() => {
    if (new URLSearchParams(location.search).get('externalsssStory') !== 'externalsss-demo-resources--clean-image') return;
    document.addEventListener('DOMContentLoaded', () => {
      const observer = new MutationObserver(() => {
        if (!document.querySelector('#storybook-root h2')) return;
        observer.disconnect();
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = '/externalsss-delayed.css';
        document.head.append(link);
      });
      observer.observe(document.documentElement, { childList: true, subtree: true });
    });
  });
  await openPanel(page);
  await page.locator('.externalsss').getByRole('button', { name: 'Run scan' }).click();
  await waitForScan(page, 'Scan finished with gaps');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download JSON' }).click();
  const report = JSON.parse(await readFile(await (await download).path(), 'utf8'));
  const clean = report.stories.find((story) => story.id === 'externalsss-demo-resources--clean-image');
  const stylesheet = report.findings.find((finding) => finding.resource.includes('externalsss-delayed.css'));
  assert.equal(requested, 1);
  assert.equal(clean.status, 'complete');
  assert(stylesheet?.labels.includes('failure'), 'the delayed stylesheet failure was missed');
  assert(stylesheet.affectedStories.some((story) => story.id === clean.id));
  await page.close();
  console.log('PASS delayed stylesheet is observed before a story completes');
}

async function timedOutScan() {
  const page = await browser.newPage();
  await page.route('**/iframe.html?**', async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('externalsssStory') === 'externalsss-demo-resources--clean-image') {
      await route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>No scan reply</title>' });
    } else {
      await route.continue();
    }
  });
  await openPanel(page);
  await page.locator('.externalsss').getByRole('button', { name: 'Run scan' }).click();
  if (concurrency > 1) {
    await page.waitForFunction(() => Number(document.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')) === 9, null, { timeout: 10000 });
    assert.equal(await page.locator('iframe[title^="Externalsss background scan"]').count(), 1, 'other slots must finish before the slow story deadline');
    assert.match(await page.locator('.externalsss').getByRole('status').innerText(), /9 of 10 completed · 1 active/);
  }
  await waitForScan(page, 'Scan finished with gaps');
  assert.equal(await page.locator('iframe[title^="Externalsss background scan"]').count(), 0);
  const incompleteText = await page.locator('[aria-label="Incomplete stories"]').innerText();
  assert.match(incompleteText, /Clean Image/);
  assert.match(incompleteText, /Timed out/);
  assert.doesNotMatch(await page.locator('body').innerText(), /No findings in the observed scan window/);
  await page.close();
  console.log('PASS timeout remains incomplete');
}

async function malformedResultScan() {
  const page = await browser.newPage();
  await page.route('**/iframe.html?**', async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('externalsssStory') === 'externalsss-demo-resources--clean-image') {
      await route.fulfill({ status: 200, contentType: 'text/html', body: `<!doctype html><script>
        const params = new URLSearchParams(location.search);
        parent.postMessage({
          namespace: 'storybook-addon-externalsss', version: 1, type: 'result',
          runId: params.get('externalsssRun'), storyId: params.get('externalsssStory'),
          status: 'complete', observation: { resources: [{ url: 42 }], images: [], elementErrors: [], fonts: [], warnings: [] }
        }, location.origin);
      </script>` });
    } else {
      await route.continue();
    }
  });
  await openPanel(page);
  await page.locator('.externalsss').getByRole('button', { name: 'Run scan' }).click();
  await waitForScan(page, 'Scan finished with gaps');
  const incompleteText = await page.locator('[aria-label="Incomplete stories"]').innerText();
  assert.match(incompleteText, /Clean Image/);
  assert.match(incompleteText, /Coverage limited/);
  await page.locator('[aria-label="Incomplete stories"] summary').filter({ hasText: 'Clean Image' }).click();
  assert.match(await page.locator('[aria-label="Incomplete stories"]').innerText(), /Invalid scan result received/);
  await page.close();
  console.log('PASS malformed scan result becomes incomplete');
}


async function retryScan() {
  const page = await browser.newPage();
  const requests = [];
  let attempt = 0;
  const first = 'externalsss-demo-resources--clean-image';
  const failing = 'externalsss-demo-resources--render-error';
  await page.route('**/iframe.html?**', async (route) => {
    const url = new URL(route.request().url());
    const id = url.searchParams.get('externalsssStory');
    if (!id) { await route.continue(); return; }
    requests.push(url);
    const status = attempt === 0 && id === first ? 'unsupported'
      : attempt < 3 && id === failing ? 'render-error' : 'complete';
    const observation = { resources: [], images: [], elementErrors: [], fonts: [], warnings: status === 'unsupported' ? ['Resource Timing is unavailable; request coverage is incomplete.'] : [] };
    if (attempt === 0 && id === first) observation.elementErrors.push({ tag: 'IMG', url: `${url.origin}/obsolete-image.png?token=secret` });
    const message = { namespace: 'storybook-addon-externalsss', version: 1, type: 'result',
      runId: url.searchParams.get('externalsssRun'), storyId: id, status, observation,
      ...(status === 'render-error' ? { error: 'Storybook reported a render or play error.' } : {}),
    };
    const stale = attempt === 1 ? { ...message, runId: requests[0].searchParams.get('externalsssRun'), status: 'render-error' } : undefined;
    await route.fulfill({ contentType: 'text/html', body: `<!doctype html><script>
      ${stale ? `parent.postMessage(${JSON.stringify(stale)}, location.origin);` : ''}
      setTimeout(() => parent.postMessage(${JSON.stringify(message)}, location.origin), ${attempt === 2 ? 5000 : 400});
    </script>` });
  });
  await page.goto(new URL('?path=/story/externalsss-demo-resources--clean-image&globals=theme:dark&custom=original', base).href);
  await page.getByRole('tab', { name: 'Externalsss' }).click();
  const canvas = await page.locator('#storybook-preview-iframe').getAttribute('src');
  const download = async () => {
    const event = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download JSON' }).click();
    return JSON.parse(await readFile(await (await event).path(), 'utf8'));
  };
  await page.locator('.externalsss').getByRole('button', { name: 'Run scan' }).click();
  await waitForScan(page, 'Scan finished with gaps');
  await page.locator('.externalsss').evaluate((panel) => { panel.style.width = '320px'; });
  assert(await page.locator('.externalsss').evaluate((panel) => {
    const bounds = panel.getBoundingClientRect();
    return [...panel.querySelectorAll('.ext-actions button')].every((button) => {
      const rect = button.getBoundingClientRect();
      return rect.left >= bounds.left && rect.right <= bounds.right;
    });
  }), 'scan actions overflowed the narrow panel');
  await page.locator('.externalsss').evaluate((panel) => { panel.style.width = ''; });
  const original = await download();
  assert.equal(original.summary.incompleteStories, 2);
  assert.match(JSON.stringify(original), /Resource Timing is unavailable/);
  assert.match(JSON.stringify(original), /Storybook reported a render or play error/);
  assert.doesNotMatch(JSON.stringify(original), /token=secret/);
  const retained = original.stories.filter((story) => story.status === 'complete');

  // Capture after the initial scan lets Storybook normalize its URL first.
  const managerUrl = page.url();

  // A failed retry retains completed observations and remains retryable; active siblings are cancelled.
  await page.evaluate(() => {
    const append = document.body.appendChild;
    document.body.appendChild = function(node) {
      if (node instanceof HTMLIFrameElement && node.title.startsWith('Externalsss background scan')) {
        document.body.appendChild = append;
        throw new Error('Test setup failure');
      }
      return append.call(this, node);
    };
    window.PREVIEW_URL = '/changed-preview.html?custom=changed';
    history.replaceState(null, '', location.href.replace('theme:dark', 'theme:light').replace('custom=original', 'custom=changed'));
  });
  await page.locator('.externalsss').getByRole('button', { name: 'Retry incomplete' }).click();
  await waitForScan(page, 'Scan stopped');
  const failedRetry = await download();
  assert.deepEqual(failedRetry.stories.filter(({ id }) => retained.some((story) => story.id === id)), retained);
  assert.deepEqual(failedRetry.stories.find(({ id }) => id === first), original.stories.find(({ id }) => id === first));
  assert.equal(failedRetry.stories.find(({ id }) => id === failing).status, concurrency === 1 ? 'render-error' : 'cancelled');
  assert.equal(await page.locator('iframe[title^="Externalsss background scan"]').count(), 0);

  attempt = 1;
  let start = requests.length;
  await page.locator('.externalsss').getByRole('button', { name: 'Retry incomplete' }).click();
  await waitForScan(page, 'Retrying: 0 of 2 completed');
  assert.equal(await page.getByRole('progressbar').getAttribute('aria-valuemax'), '2');
  assert.equal(await page.getByRole('progressbar').getAttribute('aria-valuenow'), '0');
  await waitForScan(page, 'Scan finished with gaps');
  assert.deepEqual(requests.slice(start).map((url) => url.searchParams.get('externalsssStory')), [first, failing]);
  for (const url of requests.slice(start)) {
    assert.equal(url.searchParams.get('globals'), requests[0].searchParams.get('globals'));
    assert.equal(url.searchParams.get('custom'), 'original');
    assert.equal(url.pathname, requests[0].pathname);
    assert.notEqual(url.searchParams.get('externalsssRun'), requests[0].searchParams.get('externalsssRun'));
  }
  const partial = await download();
  assert.equal(partial.summary.incompleteStories, 1);
  assert.equal(partial.summary.findings, 0, 'obsolete findings survived replacement');
  assert.deepEqual(partial.stories.filter((story) => retained.some(({ id }) => id === story.id)), retained);

  attempt = 2;
  await page.locator('.externalsss').getByRole('button', { name: 'Retry incomplete' }).click();
  await waitForScan(page, 'Retrying: 0 of 1 completed');
  await page.locator('.externalsss').getByRole('button', { name: 'Cancel' }).click();
  await waitForScan(page, 'Scan cancelled');
  const cancelled = await download();
  assert.equal(cancelled.stories.find(({ id }) => id === failing).status, 'cancelled');
  assert.deepEqual(cancelled.stories.filter(({ id }) => id !== failing), partial.stories.filter(({ id }) => id !== failing));

  attempt = 3;
  start = requests.length;
  await page.locator('.externalsss').getByRole('button', { name: 'Retry incomplete' }).click();
  await waitForScan(page, 'Scan complete');
  assert.deepEqual(requests.slice(start).map((url) => url.searchParams.get('externalsssStory')), [failing]);
  const recovered = await download();
  assert.equal(recovered.summary.completeStories, 10);
  assert.equal(recovered.summary.incompleteStories, 0);
  assert.equal(await page.locator('.externalsss').getByRole('button', { name: 'Retry incomplete' }).count(), 0);
  assert.equal(await page.locator('#storybook-preview-iframe').getAttribute('src'), canvas);
  assert.equal(page.url(), managerUrl.replace('theme:dark', 'theme:light').replace('custom=original', 'custom=changed'));
  await page.close();
  console.log('PASS retry diagnostics, retained results/settings, progress, stale replies, replacement, setup failure, cancellation and recovery');
}

try {
  if (!fullOnly) await testProviderCheck(browser, base, 'externalsss-demo-resources--clean-image');
  await fullScan();
  if (!fullOnly) {
    await cancelledScan();
    await retryScan();
    await delayedStylesheetScan();
    await timedOutScan();
    await malformedResultScan();
  }
} finally {
  await browser.close();
}
