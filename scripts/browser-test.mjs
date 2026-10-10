import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const base = process.env.EXTERNALSSS_STORYBOOK_URL ?? 'http://127.0.0.1:6100/';
const fullOnly = process.env.EXTERNALSSS_TEST_MODE === 'full';
const browser = await chromium.launch({ headless: true });

async function openPanel(page) {
  await page.goto(new URL('?path=/story/externalsss-demo-resources--clean-image', base).href, { waitUntil: 'domcontentloaded' });
  await page.getByRole('tab', { name: 'Externalsss' }).click();
}

async function waitForScan(page, phrase) {
  await page.getByRole('status').filter({ hasText: phrase }).waitFor({ timeout: 90000 });
}

async function fullScan() {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await openPanel(page);
  const initialUrl = page.url();
  const initialCanvas = await page.locator('iframe[title="storybook-preview-iframe"]').getAttribute('src');
  await page.evaluate(() => {
    window.__externalsssLeaks = 0;
    window.addEventListener('message', (event) => {
      const outer = document.querySelector('iframe[title^="Externalsss background scan"]');
      if (outer && event.source === outer.contentWindow && event.data?.namespace !== 'storybook-addon-externalsss') {
        window.__externalsssLeaks += 1;
      }
    });
  });
  await page.getByRole('button', { name: 'Run scan' }).click();
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
  await page.close();
  console.log('PASS full scan, classification, render error, Canvas isolation, redacted JSON export');
}

async function cancelledScan() {
  const page = await browser.newPage();
  await openPanel(page);
  const initialUrl = page.url();
  await page.getByRole('button', { name: 'Run scan' }).click();
  await page.waitForFunction(() => Number(document.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')) >= 1, null, { timeout: 15000 });
  await page.getByRole('button', { name: 'Cancel' }).click();
  await waitForScan(page, 'Scan cancelled');
  assert.equal(page.url(), initialUrl);
  assert.match(await page.getByRole('status').innerText(), /[1-9] of 10 stories checked\. Results are partial/);
  assert.match(await page.locator('[aria-label="Incomplete stories"]').innerText(), /stories not scanned/);
  const partialDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download JSON' }).click();
  const partial = JSON.parse(await readFile(await (await partialDownload).path(), 'utf8'));
  assert.equal(partial.scanStatus, 'cancelled');
  assert(partial.stories.some((story) => story.status === 'not-scanned'));
  assert(partial.summary.incompleteStories > 0);
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
  await page.getByRole('button', { name: 'Run scan' }).click();
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
  await page.getByRole('button', { name: 'Run scan' }).click();
  await waitForScan(page, 'Scan finished with gaps');
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
  await page.getByRole('button', { name: 'Run scan' }).click();
  await waitForScan(page, 'Scan finished with gaps');
  const incompleteText = await page.locator('[aria-label="Incomplete stories"]').innerText();
  assert.match(incompleteText, /Clean Image/);
  assert.match(incompleteText, /Coverage limited/);
  await page.locator('[aria-label="Incomplete stories"] summary').filter({ hasText: 'Clean Image' }).click();
  assert.match(await page.locator('[aria-label="Incomplete stories"]').innerText(), /Invalid scan result received/);
  await page.close();
  console.log('PASS malformed scan result becomes incomplete');
}

try {
  await fullScan();
  if (!fullOnly) {
    await cancelledScan();
    await delayedStylesheetScan();
    await timedOutScan();
    await malformedResultScan();
  }
} finally {
  await browser.close();
}
