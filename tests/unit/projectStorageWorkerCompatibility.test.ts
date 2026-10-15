import { afterEach, expect, it, vi } from 'vitest';

const original = Object.getOwnPropertyDescriptor(Array.prototype, 'toSorted')!;
afterEach(() => {
  Object.defineProperty(Array.prototype, 'toSorted', original);
  vi.unstubAllGlobals();
  vi.resetModules();
});

it('boots the storage worker without main-window polyfills and serializes recovery records', async () => {
  vi.resetModules();
  vi.stubGlobal('self', { onmessage: null, postMessage: vi.fn() });
  Reflect.deleteProperty(Array.prototype, 'toSorted');
  // Only the worker entry is loaded; main.tsx never runs in a worker realm.
  await import('../../src/workers/projectStorage.worker');
  const { canonicalJson } = await import('../../src/services/project/repository/segments/canonical');
  const record = Object.freeze({ z: Object.freeze({ b: 2, a: 1 }), a: [3, 1, 2] });
  expect(canonicalJson(record)).toBe('{"a":[3,1,2],"z":{"a":1,"b":2}}');
  expect(record.a).toEqual([3, 1, 2]);
  expect(self.onmessage).toBeTypeOf('function');
});
