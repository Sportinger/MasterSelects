import { afterEach, describe, expect, it, vi } from 'vitest';
import { collapseNodeStreamBlocks, createStreamingTextThrottle } from '../../src/components/panels/flashboard/nodeStreamDisplay';

const record = (seq: number) => `{"op":"tool","seq":${seq},"ref":"r${seq}","tool":"editOperatorGraph","args":{}}`;

describe('node stream chat display', () => {
  afterEach(() => vi.useRealTimers());

  it('replaces complete and still-open stream blocks with a step summary', () => {
    const block = ['```ms-nodegraph-v1', '{"op":"begin","schemaVersion":1,"clipId":"c"}', record(1), record(2), '{"op":"end","lastSeq":2}', '```'].join('\n');
    expect(collapseNodeStreamBlocks(`Building now.\n\n${block}\nDone.`)).toBe('Building now.\n\n[Node-Stream: 2 Schritte]\nDone.');
    expect(collapseNodeStreamBlocks(`Start\n\`\`\`ms-nodegraph-v1\n${record(1)}\n{"op":"to`)).toBe('Start\n[Node-Stream läuft: 1 Schritte …]');
    expect(collapseNodeStreamBlocks('plain ```js\ncode\n``` text')).toBe('plain ```js\ncode\n``` text');
  });

  it('applies the first delta at once and coalesces the rest per interval', () => {
    vi.useFakeTimers();
    const apply = vi.fn();
    const throttle = createStreamingTextThrottle(apply, 100);
    throttle.schedule();
    for (let i = 0; i < 50; i++) throttle.schedule();
    expect(apply).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(100);
    expect(apply).toHaveBeenCalledTimes(2);
    throttle.schedule(); throttle.cancel();
    vi.advanceTimersByTime(200);
    expect(apply).toHaveBeenCalledTimes(2);
  });
});
