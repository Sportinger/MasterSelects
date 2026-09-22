import { describe, expect, it } from 'vitest';
import { awaitTemporalPreparations, collectTemporalPreparations, recordTemporalPreparation } from '../../src/effects/time/temporalResourcePreparation';

describe('temporal resource render barrier', () => {
  it('collects each resource once and waits until every decoder finishes', async () => {
    let finishFirst!: () => void, finishSecond!: () => void;
    const first = new Promise<void>(resolve => { finishFirst = resolve; });
    const second = new Promise<void>(resolve => { finishSecond = resolve; });
    const finish = collectTemporalPreparations();
    recordTemporalPreparation(first);
    recordTemporalPreparation(first);
    recordTemporalPreparation(second);
    const pending = finish();
    expect(pending).toEqual([first, second]);
    let ready = false;
    const waiting = awaitTemporalPreparations(pending, new AbortController().signal).then(() => { ready = true; });
    finishFirst();
    await Promise.resolve();
    expect(ready).toBe(false);
    finishSecond();
    await waiting;
    expect(ready).toBe(true);
    const finishNext = collectTemporalPreparations();
    expect(finishNext()).toEqual([]);
  });

  it('propagates decode failures and allows cancellation while a decoder is pending', async () => {
    const signal = new AbortController();
    await expect(awaitTemporalPreparations([Promise.reject(new Error('decode failed'))], signal.signal)).rejects.toThrow('decode failed');
    const waiting = awaitTemporalPreparations([new Promise(() => {})], signal.signal);
    signal.abort(new Error('export cancelled'));
    await expect(waiting).rejects.toThrow('export cancelled');
    await expect(awaitTemporalPreparations([], signal.signal)).rejects.toThrow('export cancelled');
  });

  it('rejects overlapping render collectors without discarding the active collector', () => {
    const finish = collectTemporalPreparations();
    try {
      expect(() => collectTemporalPreparations()).toThrow(/nest/);
      const resource = Promise.resolve();
      recordTemporalPreparation(resource);
      expect(finish()).toEqual([resource]);
    } finally { finish(); }
  });
});
