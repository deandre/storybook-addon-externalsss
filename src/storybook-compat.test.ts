import { describe, expect, it, vi } from 'vitest';
import type { API } from 'storybook/manager-api';
import { getStoryTargets } from './storybook-compat';

const index: NonNullable<ReturnType<API['getIndex']>> = {
  v: 5,
  entries: {
    'button--primary': { id: 'button--primary', type: 'story', subtype: 'story', title: 'Button', name: 'Primary', importPath: './Button.stories.ts', tags: [] },
    'button--docs': { id: 'button--docs', type: 'docs', storiesImports: [], title: 'Button', name: 'Docs', importPath: './Button.stories.ts', tags: [] },
    'remote--primary': { id: 'remote--primary', type: 'story', subtype: 'story', title: 'Remote', name: 'Primary', importPath: './Remote.stories.ts', tags: [], ...{ refId: 'remote' } },
  },
};
const locationHref = 'https://example.test/catalog/index.html?path=/story/old&args=size:large#old';
const getUrlState = () => ({ path: '/story/old', hash: '', url: '', queryParams: {
  globals: 'theme:dark;locale:en', args: 'size:large', custom: 'a & b', missing: undefined,
  id: 'old', viewMode: 'docs', refId: 'remote', embed: 'true', freeze: 'finished',
} });

describe('Storybook catalog compatibility', () => {
  it('prefers native APIs and requests globals without current args', () => {
    const getStoryHrefs = vi.fn(() => ({ previewHref: './iframe.html?id=button--primary', managerHref: '?path=/story/button--primary' }));
    const getIndex = vi.fn(() => index);
    const targets = getStoryTargets({ getIndex, getStoryHrefs, getUrlState }, 'run', { locationHref });
    expect(getIndex).toHaveBeenCalledOnce();
    expect(getStoryHrefs).toHaveBeenCalledExactlyOnceWith('button--primary', {
      inheritArgs: false, inheritGlobals: true, queryParams: { externalsssRun: 'run', externalsssStory: 'button--primary' },
    });
    expect(targets).toEqual([{ id: 'button--primary', name: 'Button / Primary',
      previewHref: 'https://example.test/catalog/iframe.html?id=button--primary&custom=a+%26+b', managerHref: 'https://example.test/catalog/index.html?path=%2Fstory%2Fbutton--primary&custom=a+%26+b' }]);
  });

  it('builds local story URLs from the manager state on older versions', () => {
    const [target] = getStoryTargets({ getUrlState }, 'run & 1', { index, locationHref });
    const preview = new URL(target!.previewHref);
    const manager = new URL(target!.managerHref);
    expect(preview.pathname).toBe('/catalog/iframe.html');
    expect(manager.pathname).toBe('/catalog/index.html');
    expect(manager.searchParams.get('path')).toBe('/story/button--primary');
    expect(preview.searchParams.get('id')).toBe('button--primary');
    expect(preview.searchParams.get('viewMode')).toBe('story');
    for (const url of [manager, preview]) {
      expect(url.searchParams.get('globals')).toBe('theme:dark;locale:en');
      expect(url.searchParams.get('custom')).toBe('a & b');
      expect(url.searchParams.get('externalsssRun')).toBe('run & 1');
      expect(url.searchParams.get('externalsssStory')).toBe('button--primary');
      for (const key of ['args', 'refId', 'embed', 'freeze', 'missing']) expect(url.searchParams.has(key)).toBe(false);
      expect(url.hash).toBe('');
    }
  });

  it.each(['https://example.test/', 'https://example.test/catalog/', 'https://example.test/catalog'])('handles directory hosting at %s', (locationHref) => {
    const [target] = getStoryTargets({ getUrlState }, 'run', { index, locationHref });
    expect(new URL(target!.previewHref).pathname).toBe(locationHref.endsWith('test/') ? '/iframe.html' : '/catalog/iframe.html');
  });

  it.each(['https://preview.test/custom.html?token=a%26b&args=old#hash', './custom.html?token=a%26b&args=old#hash'])('preserves custom preview URLs: %s', (previewUrl) => {
    const [target] = getStoryTargets({ getUrlState }, 'run', { index, locationHref, previewUrl });
    const preview = new URL(target!.previewHref);
    expect(preview.origin).toBe(previewUrl.startsWith('https:') ? 'https://preview.test' : 'https://example.test');
    expect(preview.pathname).toBe(previewUrl.startsWith('https:') ? '/custom.html' : '/catalog/custom.html');
    expect(preview.searchParams.get('token')).toBe('a&b');
    expect(preview.searchParams.get('globals')).toBe('theme:dark;locale:en');
    expect(preview.searchParams.has('args')).toBe(false);
    expect(preview.hash).toBe('#hash');
  });

  it('supports versions with only one of the newer APIs', () => {
    expect(getStoryTargets({ getIndex: () => index, getUrlState }, 'run', { locationHref })).toHaveLength(1);
    const getStoryHrefs = vi.fn(() => ({ previewHref: '/iframe.html', managerHref: '/' }));
    expect(getStoryTargets({ getStoryHrefs, getUrlState }, 'run', { index, locationHref })).toHaveLength(1);
    expect(getStoryHrefs).toHaveBeenCalledOnce();
  });

  it('uses the URL builder when a custom preview URL already has a query', () => {
    const getStoryHrefs = vi.fn();
    const [target] = getStoryTargets({ getIndex: () => index, getStoryHrefs, getUrlState }, 'run', {
      locationHref, previewUrl: 'https://preview.test/iframe.html?token=secret',
    });
    expect(getStoryHrefs).not.toHaveBeenCalled();
    const preview = new URL(target!.previewHref);
    expect(preview.searchParams.get('token')).toBe('secret');
    expect(preview.searchParams.get('id')).toBe('button--primary');
  });

  it('reports a loading catalog instead of silently scanning an empty or stale index', () => {
    expect(() => getStoryTargets({ getUrlState }, 'run', { locationHref })).toThrow('still loading');
    expect(() => getStoryTargets({ getIndex: () => undefined, getUrlState }, 'run', { index, locationHref })).toThrow('still loading');
  });
});
