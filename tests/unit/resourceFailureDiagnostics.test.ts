import { afterEach, describe, expect, it } from 'vitest';
import { getRecentRuntimeDiagnosticEntries, installRuntimeDiagnostics, isForeignScriptFailure } from '../../src/services/runtimeDiagnostics';

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

// Production: in-app browsers, iOS browsers and wallet extensions run their own code at the page URL.
describe('errors from scripts we do not ship', () => {
  it.each([
    ['Script error.', undefined],
    ["TypeError: undefined is not an object (evaluating 'window._META.IABInnerFrame')", '@https://www.masterselects.com/m:1:51\nglobal code@https://www.masterselects.com/m:1:136'],
    ["TypeError: undefined is not an object (evaluating 'window.ethereum.selectedAddress = undefined')", 'global code@https://www.masterselects.com/editor:1:16'],
    ['Uncaught Error: Error invoking postMessage: Java object is gone', 'Error: Error invoking postMessage: Java object is gone\n    at sendDataToNative (iabjs://navigation_performance_logger_android:1:11722)'],
  ])('does not count %s as ours', (message, stack) => {
    expect(isForeignScriptFailure(message, stack)).toBe(true);
  });

  it.each([
    ['TypeError: clip is undefined', 'at useClipDrag (https://www.masterselects.com/assets/editor-abc.js:1:2)'],
    ['TypeError: clip is undefined', 'at inject (chrome-extension://abc/inject.js:1:1)\n    at useClipDrag (https://www.masterselects.com/assets/editor-abc.js:1:2)'],
    // Safari can strip every URL; without evidence it stays an error.
    ['RangeError: Maximum call stack size exceeded.', '@\nGk@\nEk@'],
    ['Something failed', undefined],
  ])('keeps %s as ours', (message, stack) => {
    expect(isForeignScriptFailure(message, stack)).toBe(false);
  });
});

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
