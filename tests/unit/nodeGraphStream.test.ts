import { describe, expect, it, vi } from 'vitest';
import { NodeGraphStreamParser, resolveNodeGraphStreamReferences, type NodeGraphStreamRecord } from '../../src/services/nodeGraph/nodeGraphStream';
import { FlashBoardNodeGraphStream } from '../../src/services/flashboard/FlashBoardNodeGraphStream';

const timeline = vi.hoisted(() => ({ clips: [{ id: 'clip-a', trackId: 'video', effects: [] }], tracks: [{ id: 'video', locked: false }], isExporting: false }));
vi.mock('../../src/stores/timeline', () => ({ useTimelineStore: { getState: () => timeline } }));

const begin = '{"op":"begin","schemaVersion":1,"clipId":"clip-a"}\n';
const operation = '{"op":"tool","seq":1,"ref":"blur","tool":"addEffect","args":{"effectType":"gaussian-blur","params":{"radius":8}}}\n';
const header = '```ms-nodegraph-v1\n';

describe('node graph text stream', () => {
  it('recognizes split markers and only emits complete records before the response ends', () => {
    const received: NodeGraphStreamRecord[] = [];
    const parser = new NodeGraphStreamParser(record => received.push(record));
    for (const char of 'Some prose\n' + header + begin + operation.slice(0, -1)) parser.push(char);
    expect(received.map(r => r.op)).toEqual(['begin']);
    parser.push('\n');
    expect(received.map(r => r.op)).toEqual(['begin', 'tool']);
    parser.push('{"op":"end","lastSeq":1}\n```'); parser.finish();
    expect(received.map(r => r.op)).toEqual(['begin', 'tool', 'end']);
  });
  it('ignores prose, generic code blocks and embedded stream examples', () => {
    const receive = vi.fn(); const parser = new NodeGraphStreamParser(receive);
    parser.push('Example only:\n```text\n' + header + begin + '```\n'); parser.finish();
    expect(receive).not.toHaveBeenCalled();
  });
  it('rejects owner switching, unknown tools, duplicate sequence, aliases and incomplete streams', () => {
    for (const bad of [
      operation.replace('"addEffect"', '"deleteClips"'),
      operation.replace('"effectType"', '"clipId":"other","effectType"'),
      operation.replace('"seq":1', '"seq":2'),
    ]) {
      const parser = new NodeGraphStreamParser(() => undefined); parser.push(header + begin);
      expect(() => parser.push(bad)).toThrow();
    }
    const parser = new NodeGraphStreamParser(() => undefined); parser.push(header + begin + operation);
    expect(() => parser.push(operation)).toThrow();
    expect(() => parser.finish()).toThrow('incomplete');
    const duplicate = new NodeGraphStreamParser(() => undefined); duplicate.push(header + begin + operation);
    expect(() => duplicate.push(operation.replace('"seq":1', '"seq":2'))).toThrow();
  });
  it('resolves only earlier scalar result fields and rejects missing or unsafe references', () => {
    const results = new Map([['blur', { effectId: 'effect-1' }]]);
    expect(resolveNodeGraphStreamReferences({ effectId: { $ref: 'blur', field: 'effectId' } }, results)).toEqual({ effectId: 'effect-1' });
    expect(() => resolveNodeGraphStreamReferences({ $ref: 'future', field: 'nodeId' }, results)).toThrow();
    expect(() => resolveNodeGraphStreamReferences({ $ref: 'blur', field: '__proto__' }, results)).toThrow();
  });
  it('focuses the pinned clip before executing each complete operation and stops after cancellation', async () => {
    const execute = vi.fn().mockResolvedValue({ success: true, data: { effectId: 'effect-1' } });
    const controller = new FlashBoardNodeGraphStream(execute);
    await controller.accept({ op: 'begin', schemaVersion: 1, clipId: 'clip-a' });
    await controller.accept(JSON.parse(operation));
    expect(execute.mock.calls.map(c => c[0])).toEqual(['focusNodeGraph', 'addEffect']);
    expect(execute.mock.calls[1][1]).toEqual({ clipId: 'clip-a', effectType: 'gaussian-blur', params: { radius: 8 } });
    controller.stop();
    await expect(controller.accept(JSON.parse(operation))).rejects.toThrow('stopped');
    expect(execute).toHaveBeenCalledTimes(2);
  });
  it('rejects invalid effect contracts and does not continue after a failed tool', async () => {
    const execute = vi.fn().mockResolvedValue({ success: true, data: {} });
    const controller = new FlashBoardNodeGraphStream(execute);
    await controller.accept({ op: 'begin', schemaVersion: 1, clipId: 'clip-a' });
    await expect(controller.accept(JSON.parse(operation.replace('"radius":8', '"radius":-9')))).rejects.toThrow('Invalid effect parameter');
    expect(execute).toHaveBeenCalledTimes(1);
    const failure = new FlashBoardNodeGraphStream(vi.fn().mockResolvedValue({ success: false, error: 'denied' }));
    await expect(failure.accept({ op: 'begin', schemaVersion: 1, clipId: 'clip-a' })).rejects.toThrow('denied');
    await expect(failure.accept(JSON.parse(operation))).rejects.toThrow('stopped');
  });
});
