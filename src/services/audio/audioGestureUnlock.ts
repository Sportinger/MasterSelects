import { Logger } from '../logger';

const log = Logger.create('AudioGestureUnlock');
const gestures = ['mousedown', 'keydown', 'touchstart'] as const;

/** One best-effort initial unlock. Explicit playback can retry a failed context. */
export function installAudioGestureUnlock(unlock: () => void, target: EventTarget = document): () => void {
  const dispose = () => {
    for (const gesture of gestures) target.removeEventListener(gesture, onGesture, true);
  };
  const onGesture = () => {
    // Remove capture listeners before calling browser APIs, including on failure.
    dispose();
    if (typeof globalThis.AudioContext !== 'function') return;
    try {
      unlock();
    } catch (error) {
      log.warn('Initial audio unlock unavailable', error);
    }
  };
  for (const gesture of gestures) target.addEventListener(gesture, onGesture, true);
  return dispose;
}
