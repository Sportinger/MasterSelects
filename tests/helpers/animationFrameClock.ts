import { act } from '@testing-library/react';
import { vi } from 'vitest';

export function animationFrameClock() {
  let sequence = 0;
  const pending = new Map<number, FrameRequestCallback>();
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
    const id = ++sequence; pending.set(id, callback); return id;
  });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => { pending.delete(id); });
  return { flush: () => act(() => {
    const callbacks = [...pending.values()]; pending.clear();
    callbacks.forEach(callback => callback(performance.now()));
  }), count: () => pending.size };
}
