import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { Blob as NodeBlob } from 'node:buffer';
import { describe, expect, it, vi } from 'vitest';

const script = readFileSync('android/app/src/main/assets/android-bridge.js', 'utf8');

function bridge(rejectBegin = false, androidApi = 37) {
  const calls: Array<Record<string, unknown>> = [];
  class Anchor { href = ''; download = ''; click() {} }
  const native = {
    onmessage: (_event: { data: string }) => {},
    postMessage(json: string) {
      const call = JSON.parse(json);
      calls.push(call);
      queueMicrotask(() => native.onmessage({ data: JSON.stringify({ id: call.id, error: rejectBegin && call.op === 'begin' ? 'Save cancelled' : null }) }));
    },
  };
  const window = { MasterSelectsNative: native, alert: vi.fn(), top: null as unknown, __masterselectsAndroid: undefined as unknown,
    showDirectoryPicker: vi.fn(), showSaveFilePicker: vi.fn(), showOpenFilePicker: vi.fn() };
  window.top = window;
  const fakeUrl = { createObjectURL: (_blob?: NodeBlob) => 'blob:test', revokeObjectURL: vi.fn() };
  const context = {
    window, URL: fakeUrl, HTMLAnchorElement: Anchor, Blob: NodeBlob, document: { addEventListener: vi.fn() },
    crypto: { randomUUID: () => 'test-transfer' }, fetch: vi.fn(), setTimeout, clearTimeout, Uint8Array,
    btoa: (value: string) => Buffer.from(value, 'binary').toString('base64'),
  };
  runInNewContext(script.replace('__MASTERSELECTS_ANDROID_SDK__', String(androidApi)), context);
  return { calls, window, Anchor, fakeUrl, app: window.__masterselectsAndroid as { download: (blob: NodeBlob, name: string) => Promise<void> } };
}

describe('packaged Android export transport', () => {
  it('lets older Android devices fall back to OPFS instead of exposing unusable pickers', () => {
    const { window } = bridge(false, 36);
    expect(window.showDirectoryPicker).toBeUndefined();
    expect(window.showSaveFilePicker).toBeUndefined();
    expect(window.showOpenFilePicker).toBeUndefined();
  });
  it('preserves the system pickers on Android 17', () => {
    const { window } = bridge(false, 37);
    expect(typeof window.showDirectoryPicker).toBe('function');
    expect(typeof window.showSaveFilePicker).toBe('function');
  });
  it('sends an exact binary file as acknowledged chunks followed by finalization', async () => {
    const { app, calls } = bridge();
    const bytes = Uint8Array.from({ length: 600000 }, (_, index) => index % 256);
    await app.download(new NodeBlob([bytes], { type: 'video/mp4' }), 'my export.mp4');
    expect(calls.map(call => call.op)).toEqual(['begin', 'chunk', 'chunk', 'chunk', 'finish']);
    expect(calls[0]).toMatchObject({ name: 'my export.mp4', mime: 'video/mp4', size: 600000 });
    const chunks = calls.filter(call => call.op === 'chunk');
    expect(chunks.map(call => call.sequence)).toEqual([0, 1, 2]);
    expect(Buffer.concat(chunks.map(call => Buffer.from(call.data as string, 'base64')))).toEqual(Buffer.from(bytes));
  });
  it('does not send data after destination selection is cancelled', async () => {
    const { app, calls } = bridge(true);
    await expect(app.download(new NodeBlob(['private media']), 'export.mp4')).rejects.toThrow('Save cancelled');
    expect(calls.some(call => call.op === 'chunk')).toBe(false);
  });
  it('retains a detached anchor blob while the caller immediately revokes its URL', async () => {
    const { Anchor, fakeUrl, calls } = bridge();
    const anchor = new Anchor();
    anchor.href = fakeUrl.createObjectURL(new NodeBlob(['video']));
    anchor.download = 'clip.mp4';
    anchor.click();
    fakeUrl.revokeObjectURL(anchor.href);
    await vi.waitFor(() => expect(calls.at(-1)?.op).toBe('finish'));
    expect(calls[0]).toMatchObject({ size: 5, name: 'clip.mp4' });
  });
});
