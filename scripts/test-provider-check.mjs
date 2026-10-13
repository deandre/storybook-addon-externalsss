import assert from 'node:assert/strict';
const providerId = 'storybook-addon-externalsss/test-provider';
const statusId = 'storybook-addon-externalsss/resources';

export async function testProviderCheck(browser, base, storyId) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  try {
    await page.goto(new URL(`?path=/story/${storyId}`, base).href);
    await page.getByRole('button', { name: 'Run tests', exact: true }).first().waitFor();
    const canvas = await page.locator('#storybook-preview-iframe').getAttribute('src');
    const url = page.url();
    await page.getByRole('button', { name: 'Run tests', exact: true }).first().click();
    await page.waitForFunction((id) => window.__STORYBOOK_API__.experimental_getTestProviderStore(id).getState() === 'test-provider-state:succeeded', providerId, { timeout: 90000 });
    assert.equal(page.url(), url);
    assert.equal(await page.locator('#storybook-preview-iframe').getAttribute('src'), canvas);
    const statuses = await page.evaluate((id) => window.__STORYBOOK_API__.experimental_getStatusStore(id).getAll(), statusId);
    assert(['status-value:success', 'status-value:warning'].includes(statuses[storyId][statusId].value));
    assert(Object.values(statuses).every((values) => !['status-value:pending', 'status-value:unknown'].includes(values[statusId].value)));
    const expand = page.getByRole('button', { name: 'Expand testing module' });
    if (await expand.count()) await expand.click();
    const provider = page.getByRole('region', { name: 'Externalsss testing' });
    await provider.getByRole('button', { name: 'View results' }).click();
    await page.getByRole('button', { name: 'Download JSON' }).waitFor();
    await page.locator('.externalsss').getByRole('button', { name: /^Incomplete/ }).click();
    const row = page.locator(`[data-item-id="${storyId}"][data-nodetype="story"]`);
    await row.hover();
    await row.getByTestId('context-menu').click();
    await page.getByLabel(`Test status for ${statuses[storyId][statusId].title}: ${statuses[storyId][statusId].value}`, { exact: true }).click();
    await page.getByRole('button', { name: 'Download JSON' }).waitFor();

    await page.locator('.externalsss').getByRole('button', { name: /^All/, pressed: true }).waitFor();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Clear all statuses', exact: true }).click();
    await page.getByRole('button', { name: 'Download JSON' }).waitFor({ state: 'hidden' });
    await provider.getByRole('button', { name: 'Run scan' }).click();
    await page.waitForFunction((id) => Object.values(window.__STORYBOOK_API__.experimental_getStatusStore(id).getAll()).some((values) => values[id].value !== 'status-value:pending'), statusId);
    await provider.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.waitForFunction((id) => window.__STORYBOOK_API__.experimental_getTestProviderStore(id).getState() === 'test-provider-state:pending', providerId);
    await provider.getByRole('button', { name: 'Retry incomplete' }).click();
    await page.waitForFunction((id) => window.__STORYBOOK_API__.experimental_getTestProviderStore(id).getState() === 'test-provider-state:succeeded', providerId, { timeout: 90000 });
    await provider.getByRole('button', { name: 'Scan again' }).click();
    await page.evaluate(({ providerId, storyId }) => {
      const api = window.__STORYBOOK_API__;
      api.experimental_getStatusStore('other-provider').set([{ storyId, typeId: 'other-provider', value: 'status-value:success', title: 'Other result', description: 'Keep this' }]);
      api.addons.getElements('test-provider')[providerId].clear();
    }, { providerId, storyId });
    await page.waitForTimeout(1000);
    assert(await page.evaluate((id) => Object.values(window.__STORYBOOK_API__.experimental_getStatusStore(id).getAll()).every((values) => !values[id]), statusId));
    assert.equal(await page.evaluate((id) => window.__STORYBOOK_API__.experimental_getStatusStore('other-provider').getAll()[id]['other-provider'].value, storyId), 'status-value:success');
    assert.equal(await page.locator('iframe[title^="Externalsss background scan"]').count(), 0);
    console.log('PASS test provider Run All before panel, shared results, cancellation, retry, and isolated clear');
  } finally { await page.close(); }
}
