import { afterEach, describe, expect, it } from 'vitest';
import { getRecentRuntimeDiagnosticEntries, installRuntimeDiagnostics } from '../../src/services/runtimeDiagnostics';

// Production 3.4.3: every ad-blocked Cloudflare beacon and every false modulepreload alarm of Firefox
// 153/154 was reported as an application error ("Failed to load script/link"), 117 sessions in a week.
const added: Element[] = [];
afterEach(() => { added.splice(0).forEach(element => element.remove()); });

function failResource<K extends 'script' | 'link' | 'video'>(tag: K, setup: (element: HTMLElementTagNameMap[K]) => void) {
  const element = document.createElement(tag);
  setup(element);
  document.head.append(element);
  added.push(element);
  element.dispatchEvent(new Event('error'));
  return getRecentRuntimeDiagnosticEntries(1)[0];
}

describe('resource load failures', () => {
  installRuntimeDiagnostics();

  it('reports our own script and stylesheet as errors', () => {
    expect(failResource('script', e => { e.src = '/assets/App-abc.js'; })).toMatchObject({ source: 'resource-error', level: 'ERROR' });
    expect(failResource('link', e => { e.rel = 'stylesheet'; e.href = '/assets/App-abc.css'; })).toMatchObject({ level: 'ERROR' });
  });

  it('keeps a failed preload hint as a warning', () => {
    expect(failResource('link', e => { e.rel = 'modulepreload'; e.href = '/assets/editor-abc.js'; }))
      .toMatchObject({ source: 'resource-error', level: 'WARN', message: expect.stringContaining('editor-abc.js') });
  });

  it('keeps a blocked third-party script as a warning', () => {
    expect(failResource('script', e => { e.src = 'https://static.cloudflareinsights.com/beacon.min.js'; }))
      .toMatchObject({ source: 'resource-error', level: 'WARN' });
  });

  it('keeps broken media as a warning', () => {
    expect(failResource('video', e => { e.src = '/media/clip.mp4'; })).toMatchObject({ level: 'WARN' });
  });
});
