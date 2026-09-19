import { afterEach, describe, expect, it, vi } from 'vitest';
import { installAudioGestureUnlock } from '../../src/services/audio/audioGestureUnlock';

afterEach(() => vi.unstubAllGlobals());

describe('initial audio gesture unlock', () => {
  it('unlocks synchronously once and removes all capture listeners', () => {
    vi.stubGlobal('AudioContext', class {});
    const target = document.createElement('div');
    const unlock = vi.fn();
    installAudioGestureUnlock(unlock, target);
    target.dispatchEvent(new Event('mousedown'));
    expect(unlock).toHaveBeenCalledTimes(1);
    for (const gesture of ['mousedown', 'keydown', 'touchstart']) target.dispatchEvent(new Event(gesture));
    expect(unlock).toHaveBeenCalledTimes(1);
  });

  it('does not invoke audio creation on browsers without AudioContext', () => {
    vi.stubGlobal('AudioContext', undefined);
    const target = document.createElement('div');
    const unlock = vi.fn();
    installAudioGestureUnlock(unlock, target);
    target.dispatchEvent(new Event('touchstart'));
    expect(unlock).not.toHaveBeenCalled();
  });

  it('contains a synchronous browser failure and does not repeat it on later gestures', () => {
    vi.stubGlobal('AudioContext', class {});
    const target = document.createElement('div');
    const unlock = vi.fn(() => { throw new DOMException('Audio unavailable', 'NotSupportedError'); });
    installAudioGestureUnlock(unlock, target);
    for (const gesture of ['keydown', 'mousedown', 'touchstart']) target.dispatchEvent(new Event(gesture));
    expect(unlock).toHaveBeenCalledTimes(1);
  });

  it('can dispose registration before the first gesture during HMR', () => {
    vi.stubGlobal('AudioContext', class {});
    const target = document.createElement('div');
    const unlock = vi.fn();
    installAudioGestureUnlock(unlock, target)();
    target.dispatchEvent(new Event('mousedown'));
    expect(unlock).not.toHaveBeenCalled();
  });
});
