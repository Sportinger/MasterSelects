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
    for (const char of 'Some prose\n' + header + begin + operation.slice(0, -2)) parser.push(char);
    expect(received.map(r => r.op)).toEqual(['begin']);
    parser.push('}');
    expect(received.map(r => r.op)).toEqual(['begin', 'tool']);
    parser.push('\n{"op":"end","lastSeq":1}\n```'); parser.finish();
    expect(received.map(r => r.op)).toEqual(['begin', 'tool', 'end']);
  });
  it('handles pretty JSON and escaped braces split across deltas without executing partial arguments', () => {
    const receive = vi.fn(), parser = new NodeGraphStreamParser(receive);
    const record = { op: 'tool', seq: 1, ref: 'node', tool: 'editOperatorGraph',
      args: { action: 'slider', nodeId: 'value', label: 'Brace } and quote " and slash \\', min: 0, max: 1 } };
    parser.push(header + begin);
    const json = JSON.stringify(record, null, 2);
    for (const char of json.slice(0, -1)) parser.push(char);
    expect(receive).toHaveBeenCalledTimes(1);
    parser.push('}');
    expect(receive).toHaveBeenLastCalledWith(record);
    expect(receive).toHaveBeenCalledTimes(2);
    parser.push('\n{"op":"end","lastSeq":1}\r\n```\r\n');
    parser.finish();
  });
  it('applies nodes, cables and rewiring before later records or the block terminator arrive', async () => {
    const execute = vi.fn().mockResolvedValue({ success: true, data: { effectId: 'effect-1' } });
    const controller = new FlashBoardNodeGraphStream(execute);
    let queue = Promise.resolve();
    const parser = new NodeGraphStreamParser(record => { queue = queue.then(() => controller.accept(record)); });
    parser.push(header + begin);
    const edits = [
      { action: 'add', nodeId: 'node1', operatorId: 'values.number' },
      { action: 'add', nodeId: 'node2', operatorId: 'math.add.scalar' },
      { action: 'connect', fromNodeId: 'node1', fromPortId: 'value', toNodeId: 'node2', toPortId: 'a' },
      { action: 'disconnect', edgeId: 'cable1' },
      { action: 'move', nodeId: 'node2', position: { x: 400, y: 300 } },
      { action: 'remove', nodeId: 'node1' },
    ];
    for (const [index, args] of edits.entries()) {
      const json = JSON.stringify({ op: 'tool', seq: index + 1, ref: `step${index}`, tool: 'editOperatorGraph', args });
      parser.push(json.slice(0, -1));
      await queue;
      expect(execute).toHaveBeenCalledTimes(index + 1); // begin plus prior edits only
      parser.push('}');
      await queue;
      expect(execute).toHaveBeenLastCalledWith('editOperatorGraph', { ...args, clipId: 'clip-a' }, `node-stream:${index + 1}`);
      expect(controller.completedOperations).toBe(index + 1);
    }
    parser.push('{"op":"end","lastSeq":6}\n```');
    parser.finish(); await queue;
    expect(execute).toHaveBeenCalledTimes(7);
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
  it('records invalid effect contracts as failed steps and stops only when the owner focus fails', async () => {
    const execute = vi.fn().mockResolvedValue({ success: true, data: {} });
    const controller = new FlashBoardNodeGraphStream(execute);
    await controller.accept({ op: 'begin', schemaVersion: 1, clipId: 'clip-a' });
    await expect(controller.accept(JSON.parse(operation.replace('"radius":8', '"radius":-9'))))
      .resolves.toMatchObject({ seq: 1, executed: false, error: expect.stringContaining('Invalid effect parameter') });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(controller.failures).toHaveLength(1);
    const failure = new FlashBoardNodeGraphStream(vi.fn().mockResolvedValue({ success: false, error: 'denied' }));
    await expect(failure.accept({ op: 'begin', schemaVersion: 1, clipId: 'clip-a' })).rejects.toThrow('denied');
    await expect(failure.accept(JSON.parse(operation))).rejects.toThrow('stopped');
  });

  it('skips and reports malformed records when a rejection handler is supplied', () => {
    const received: NodeGraphStreamRecord[] = [], rejected: unknown[] = [];
    const parser = new NodeGraphStreamParser(record => received.push(record), rejection => rejected.push(rejection));
    const noRef = '{"op":"tool","seq":1,"tool":"addEffect","args":{"effectType":"gaussian-blur"}}\n';
    const badTool = '{"op":"tool","seq":"2","ref":"x","tool":"deleteClips","args":{}}\n';
    const third = '{"op":"tool","seq":3,"ref":"c","tool":"addEffect","args":{"effectType":"gaussian-blur"}}\n';
    parser.push(`${header}${begin}${noRef}${badTool}{not json}\n${third}{"op":"end","lastSeq":"3"}\n\`\`\`\n`);
    expect(received.map(record => record.op === 'tool' ? `${record.seq}:${record.ref}` : record.op)).toEqual(['begin', '1:s1', '3:c', 'end']);
    expect(rejected).toEqual([
      expect.objectContaining({ seq: 2, tool: 'deleteClips', reason: 'Tool is not allowed in a node stream.' }),
      expect.objectContaining({ reason: 'Invalid JSON record; it was skipped.' }),
    ]);
    expect(() => parser.finish()).not.toThrow();
  });

  it('skips a stray closing brace after a record and keeps executing the following records', () => {
    const received: NodeGraphStreamRecord[] = [], rejected: unknown[] = [];
    const parser = new NodeGraphStreamParser(record => received.push(record), rejection => rejected.push(rejection));
    const first = '{"op":"tool","seq":1,"ref":"a","tool":"addEffect","args":{"effectType":"gaussian-blur"}}}\n';
    const second = '{"op":"tool","seq":2,"ref":"b","tool":"addEffect","args":{"effectType":"gaussian-blur"}}\n';
    parser.push(`${header}${begin}${first}${second}{"op":"end","lastSeq":2}\n\`\`\`\n`);
    expect(() => parser.finish()).not.toThrow();
    expect(received.map(record => record.op === 'tool' ? record.ref : record.op)).toEqual(['begin', 'a', 'b', 'end']);
    expect(rejected).toEqual([expect.objectContaining({ reason: expect.stringContaining('Stray "}"') })]);
    // Without a rejection handler the strict contract is unchanged.
    const strict = new NodeGraphStreamParser(() => undefined);
    strict.push(header + begin);
    expect(() => strict.push(first)).toThrow('Expected a node stream object');
  });

  it('lets operator-graph records omit effectId after a block created or named its graph', async () => {
    const execute = vi.fn(async (tool: string) => ({ success: true, data: tool === 'createImageNodeGraph' ? { effectId: 'fx-1' } : {} }));
    const controller = new FlashBoardNodeGraphStream(execute);
    await controller.accept({ op: 'begin', schemaVersion: 1, clipId: 'clip-a' });
    await controller.accept({ op: 'tool', seq: 1, ref: 'g', tool: 'createImageNodeGraph', args: { name: 'Key' } });
    await controller.accept({ op: 'tool', seq: 2, ref: 'n', tool: 'editOperatorGraph', args: { action: 'add', nodeId: 'a', operatorId: 'values.number' } });
    await controller.accept({ op: 'tool', seq: 3, ref: 'm', tool: 'editOperatorGraph', args: { effectId: 'fx-2', action: 'add', nodeId: 'b', operatorId: 'values.number' } });
    await controller.accept({ op: 'tool', seq: 4, ref: 'o', tool: 'editOperatorGraph', args: { action: 'remove', nodeId: 'b' } });
    const effectIds = execute.mock.calls.filter(([tool]) => tool === 'editOperatorGraph').map(([, args]) => (args as { effectId?: string }).effectId);
    expect(effectIds).toEqual(['fx-1', 'fx-2', 'fx-2']);
  });
});
