import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  appendStreamHealthSample,
  getStreamHealthHistory,
  resetStreamHealthHistory,
  subscribeStreamHealthHistory,
} from '../streamHealthHistory';
import type { StreamHealthSample } from '../streamTypes';

function sample(atMs: number): StreamHealthSample {
  return {
    atMs,
    bitrateKbps: atMs,
    droppedFrames: atMs,
    queuedBytes: atMs,
    encodeQueueSize: atMs,
    audioProgram: 0.5,
    audioMicrophone: 0.25,
  };
}

describe('streamHealthHistory', () => {
  beforeEach(() => resetStreamHealthHistory());

  it('appends samples chronologically and keeps snapshot identity stable until data changes', () => {
    const emptySnapshot = getStreamHealthHistory();
    expect(getStreamHealthHistory()).toBe(emptySnapshot);

    appendStreamHealthSample(sample(1));
    const firstSnapshot = getStreamHealthHistory();
    expect(firstSnapshot).toEqual([sample(1)]);
    expect(firstSnapshot).not.toBe(emptySnapshot);
    expect(getStreamHealthHistory()).toBe(firstSnapshot);

    appendStreamHealthSample(sample(2));
    expect(getStreamHealthHistory()).toEqual([sample(1), sample(2)]);
    expect(getStreamHealthHistory()).not.toBe(firstSnapshot);
  });

  it('rolls over at the 1,800-sample capacity', () => {
    for (let index = 0; index <= 1_800; index += 1) appendStreamHealthSample(sample(index));

    const history = getStreamHealthHistory();
    expect(history).toHaveLength(1_800);
    expect(history[0].atMs).toBe(1);
    expect(history.at(-1)?.atMs).toBe(1_800);
  });

  it('resets history and notifies subscribers only when data changes', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeStreamHealthHistory(listener);

    appendStreamHealthSample(sample(1));
    expect(listener).toHaveBeenCalledTimes(1);
    resetStreamHealthHistory();
    expect(listener).toHaveBeenCalledTimes(2);
    expect(getStreamHealthHistory()).toEqual([]);

    resetStreamHealthHistory();
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    appendStreamHealthSample(sample(2));
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
