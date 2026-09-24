import { describe, expect, it } from 'vitest';
import { assembleRotoMemory, channelsToTokens, rotoPointerDiffs, type RotoMemoryFrame } from '../../src/services/roto/rotoMemory';
import { orderedRotoMasks } from '../../src/services/roto/rotoMaskVideo';
import { RotoSession } from '../../src/services/roto/RotoSession';
const block = 4096 * 64;
const frame = (index: number): RotoMemoryFrame => ({ index, tokens: new Float32Array(block).fill(index),
  positions: new Float32Array(block).fill(10), pointer: new Float32Array(256).fill(index + 100) });
describe('SAM 2.1 video memory', () => {
  it('keeps the conditioning frame and adds the correct ages to six ordered recent memories', () => {
    const seed = frame(0), recent = Array.from({ length: 6 }, (_, i) => frame(i + 1));
    const temporal = Array.from({ length: 7 }, (_, i) => Array(64).fill(i));
    const bank = assembleRotoMemory(seed, recent, 7, temporal, new Float32Array(16 * 64).fill(50));
    expect(bank.memory.length).toBe(28736 * 64);
    expect(Array.from({ length: 7 }, (_, i) => bank.memory[i * block])).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(Array.from({ length: 7 }, (_, i) => bank.positions[i * block])).toEqual([16, 15, 14, 13, 12, 11, 10]);
    expect(bank.memory[7 * block]).toBe(100);
    expect(bank.memory[7 * block + 256]).toBe(106);
    expect(bank.positions.at(-1)).toBe(50);
  });
  it('initializes the early bank from the selected seed without empty or NaN memory', () => {
    const seed = frame(3), temporal = Array.from({ length: 7 }, () => Array(64).fill(0));
    const bank = assembleRotoMemory(seed, [], 4, temporal, new Float32Array(1024));
    expect(bank.memory[6 * block]).toBe(3);
    expect(bank.memory.at(-1)).toBe(103);
    expect([...rotoPointerDiffs(seed, [], 4, 2)]).toEqual(Array(16).fill(1));
  });
  it('transposes channels into spatial tokens without mixing pixel positions', () => {
    expect([...channelsToTokens(Float32Array.of(1, 2, 3, 4, 5, 6), 2, 3)]).toEqual([1, 4, 2, 5, 3, 6]);
  });
});
describe('Roto source timestamps', () => {
  const mask = (time: number, duration: number) => ({ time, duration, width: 1, height: 1, data: Uint8Array.of(255) });
  it('orders a backward pass and retains variable source durations', () => {
    const input = [mask(2.1, .06), mask(2, .1)];
    expect(orderedRotoMasks(input).map(f => [f.time, f.duration])).toEqual([[2, .1], [2.1, .06]]);
    expect(input[0].time).toBe(2.1);
  });
  it('rejects missing coverage instead of stretching the preceding mask across a gap', () => {
    expect(() => orderedRotoMasks([mask(2, .04), mask(2.12, .04)])).toThrow('gap');
  });
  it('removes the mask from export coverage when the final selection point is undone', () => {
    const session = new RotoSession('', undefined, 0, 3);
    session.current = { time: 2, duration: .04, pixels: { width: 1, height: 1 } as ImageData };
    session.anchors.set(2, [{ x: .5, y: .5, label: 1 }]);
    session.masks.set(2, mask(2, .04));
    session.masks.set(2.04, mask(2.04, .04));
    session.clearCurrentPoints();
    expect(session.anchors.has(2)).toBe(false);
    expect([...session.masks.keys()]).toEqual([2.04]);
  });
});
