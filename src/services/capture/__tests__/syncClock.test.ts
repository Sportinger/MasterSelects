import { describe, expect, it } from 'vitest';
import { CaptureSyncClock } from '../recording/syncClock';

describe('CaptureSyncClock', () => {
  it('rebases pause time and enforces monotonic timestamps', () => {
    const clock = new CaptureSyncClock();
    expect(clock.timestamp('video', 1_000_000)).toBe(0);
    expect(clock.timestamp('video', 2_000_000)).toBe(1_000_000);
    clock.pause(2_000_000);
    clock.resume(7_000_000);
    expect(clock.timestamp('video', 8_000_000)).toBe(2_000_000);
    expect(clock.timestamp('video', 8_000_000)).toBe(2_000_001);
  });

  it('keeps audio and video on the same zero point across pause and video drops', () => {
    const clock = new CaptureSyncClock();
    clock.start(10_000_000);
    expect(clock.timestamp('video', 10_000_000)).toBe(0);
    expect(clock.timestamp('audio', 10_000_000)).toBe(0);
    expect(clock.timestamp('video', 10_500_000)).toBe(500_000);
    expect(clock.timestamp('audio', 10_500_000)).toBe(500_000);
    clock.pause(11_000_000);
    clock.resume(16_000_000);
    expect(clock.timestamp('audio', 17_000_000)).toBe(2_000_000);
    expect(clock.timestamp('video', 18_000_000)).toBe(3_000_000);
  });

  it('rebases a source that drifts more than 100 ms from its wall observation', () => {
    const clock = new CaptureSyncClock();
    clock.start(1_000_000);
    expect(clock.timestamp('audio', 1_250_000, 1_000_000)).toBe(0);
    expect(clock.timestamp('video', 1_050_000, 1_050_000)).toBe(50_000);
  });
});
