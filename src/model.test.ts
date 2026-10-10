import { describe, expect, it } from 'vitest';
import { classifyObservation, redactUrl, type Observation } from './model';

const empty = (): Observation => ({ resources: [], images: [], elementErrors: [], fonts: [], warnings: [] });

describe('classifyObservation', () => {
  it('leaves a local image and loaded font clean', () => {
    const observation = empty();
    observation.resources.push({ url: 'http://localhost:6007/clean.svg', initiatorType: 'img', startTime: 1 });
    observation.images.push({ url: 'http://localhost:6007/clean.svg', complete: true, naturalWidth: 200 });
    observation.fonts.push({ family: 'Ready', style: 'normal', weight: '400', atRender: 'loaded', after: 'loaded' });
    expect(classifyObservation(observation, 'http://localhost:6007')).toEqual([]);
  });

  it('labels external fetches for both dependency and mocking review', () => {
    const observation = empty();
    observation.resources.push({ url: 'https://api.example.test/data?token=secret', initiatorType: 'fetch', startTime: 1 });
    expect(classifyObservation(observation, 'http://localhost:6007')).toEqual([
      expect.objectContaining({ labels: ['external', 'mocking'], name: 'https://api.example.test/data?…' }),
    ]);
  });

  it('includes same-origin XHR in mocking review and ignores Storybook index requests', () => {
    const observation = empty();
    observation.resources.push(
      { url: 'http://localhost:6007/api/data', initiatorType: 'xmlhttprequest', startTime: 1 },
      { url: 'http://localhost:6007/index.json', initiatorType: 'fetch', startTime: 2 },
    );
    const findings = classifyObservation(observation, 'http://localhost:6007');
    expect(findings).toHaveLength(1);
    expect(findings[0]?.labels).toEqual(['mocking']);
  });

  it('keeps story requests containing index.json and only filters infrastructure at the preview base', () => {
    const observation = empty();
    observation.resources.push(
      { url: 'http://localhost:6007/catalog/index.json', initiatorType: 'fetch', startTime: 1 },
      { url: 'http://localhost:6007/catalog/fixtures/index.json', initiatorType: 'fetch', startTime: 2 },
      { url: 'http://localhost:6007/index.json', initiatorType: 'fetch', startTime: 3 },
      { url: 'https://api.example.test/index.json', initiatorType: 'fetch', startTime: 4 },
    );
    const findings = classifyObservation(observation, 'http://localhost:6007/catalog/iframe.html?id=story');
    expect(findings.map((finding) => finding.url)).toEqual([
      'http://localhost:6007/catalog/fixtures/index.json',
      'http://localhost:6007/index.json',
      'https://api.example.test/index.json',
    ]);
    expect(findings[2]?.labels).toEqual(['external', 'mocking']);
  });

  it('reports broken images and failed or late fonts without treating an external URL as a failure', () => {
    const observation = empty();
    observation.resources.push({ url: 'https://images.example.test/a.png', initiatorType: 'img', startTime: 1 });
    observation.images.push({ url: 'http://localhost:6007/broken.png', complete: true, naturalWidth: 0 });
    observation.fonts.push(
      { family: 'Late', style: 'normal', weight: '400', atRender: 'loading', after: 'loaded' },
      { family: 'Added', style: 'normal', weight: '400', atRender: 'unavailable', after: 'loaded' },
      { family: 'Broken', style: 'normal', weight: '400', atRender: 'loading', after: 'error' },
    );
    const findings = classifyObservation(observation, 'http://localhost:6007');
    expect(findings.find((item) => item.key === 'url:https://images.example.test/a.png')?.labels).toEqual(['external']);
    expect(findings.find((item) => item.key === 'url:http://localhost:6007/broken.png')?.labels).toEqual(['failure']);
    expect(findings.find((item) => item.key === 'font:Late (400, normal)')?.labels).toEqual(['font-timing']);
    expect(findings.find((item) => item.key === 'font:Added (400, normal)')?.labels).toEqual(['font-timing']);
    expect(findings.find((item) => item.key === 'font:Broken (400, normal)')?.labels).toEqual(['failure', 'font-timing']);
  });

  it('deduplicates a failed image seen in the DOM and as an error event', () => {
    const observation = empty();
    observation.images.push({ url: 'http://localhost:6007/no.png', complete: true, naturalWidth: 0 });
    observation.elementErrors.push({ url: 'http://localhost:6007/no.png', tag: 'IMG' });
    const findings = classifyObservation(observation, 'http://localhost:6007');
    expect(findings).toHaveLength(1);
    expect(findings[0]?.labels).toEqual(['failure']);
  });

  it('flags an external image even when Resource Timing did not record it', () => {
    const observation = empty();
    observation.images.push({ url: 'https://cdn.example.test/photo.png', complete: false, naturalWidth: 0 });
    expect(classifyObservation(observation, 'http://localhost:6007')[0]?.labels).toEqual(['external']);
  });
});

describe('redactUrl', () => {
  it('hides query values in summaries', () => {
    expect(redactUrl('https://example.test/a?key=secret#fragment')).toBe('https://example.test/a?…');
  });
});
