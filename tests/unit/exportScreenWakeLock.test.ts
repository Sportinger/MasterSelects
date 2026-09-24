import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { holdExportScreenAwake } from '../../src/services/export/exportScreenWakeLock';

function sentinel() {
  return Object.assign(new EventTarget(), { release: vi.fn().mockResolvedValue(undefined) });
}

describe('export foreground screen wake lock', () => {
  const cleanups: Array<() => void> = [];
  const request = vi.fn();
  const visibility = (value: DocumentVisibilityState) => {
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue(value);
    document.dispatchEvent(new Event('visibilitychange'));
  };
  const hold = () => {
    const cleanup = holdExportScreenAwake();
    cleanups.push(cleanup);
    return cleanup;
  };
  beforeEach(() => {
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request } });
    request.mockReset();
  });
  afterEach(() => {
    cleanups.splice(0).forEach(cleanup => cleanup());
    Reflect.deleteProperty(navigator, 'wakeLock');
    Reflect.deleteProperty(window, '__masterselectsAndroid');
    vi.restoreAllMocks();
  });

  it('releases the lock after export completion or cancellation', async () => {
    const lock = sentinel();
    request.mockResolvedValue(lock);
    const cleanup = hold();
    await vi.waitFor(() => expect(request).toHaveBeenCalledWith('screen'));
    cleanup();
    expect(lock.release).toHaveBeenCalledOnce();
  });

  it('releases a late acquisition when the export has already ended', async () => {
    const lock = sentinel();
    let resolve!: (value: unknown) => void;
    request.mockReturnValue(new Promise(done => { resolve = done; }));
    hold()();
    resolve(lock);
    await vi.waitFor(() => expect(lock.release).toHaveBeenCalledOnce());
  });

  it('reacquires on return to foreground, without spinning on OS revocation', async () => {
    const first = sentinel();
    const second = sentinel();
    request.mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    hold();
    await Promise.resolve();
    first.dispatchEvent(new Event('release'));
    await Promise.resolve();
    expect(request).toHaveBeenCalledTimes(1);
    visibility('hidden');
    visibility('visible');
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    visibility('hidden');
    expect(second.release).toHaveBeenCalledOnce();
  });

  it('handles hide/show during pending acquisition without leaking the old lock', async () => {
    const stale = sentinel();
    const current = sentinel();
    let resolve!: (value: unknown) => void;
    request.mockReturnValueOnce(new Promise(done => { resolve = done; })).mockResolvedValue(current);
    hold();
    visibility('hidden');
    visibility('visible');
    resolve(stale);
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    expect(stale.release).toHaveBeenCalledOnce();
    expect(current.release).not.toHaveBeenCalled();
  });

  it('does not request while hidden and tolerates rejection', async () => {
    visibility('hidden');
    request.mockRejectedValue(new Error('Denied by battery saver'));
    hold();
    expect(request).not.toHaveBeenCalled();
    visibility('visible');
    await Promise.resolve();
    await Promise.resolve();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('is a no-op in browsers without the API', () => {
    Reflect.deleteProperty(navigator, 'wakeLock');
    expect(() => hold()()).not.toThrow();
  });

  it('uses a native lease in the packaged Android editor', async () => {
    const setScreenAwake = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window, '__masterselectsAndroid', { configurable: true, value: { setScreenAwake } });
    const cleanup = hold();
    expect(request).not.toHaveBeenCalled();
    expect(setScreenAwake).toHaveBeenCalledWith(expect.any(String), true);
    const lease = setScreenAwake.mock.calls[0][0];
    cleanup();
    expect(setScreenAwake).toHaveBeenLastCalledWith(lease, false);
  });
});
