import { afterEach, describe, expect, it } from 'vitest';
import { useTimelineStore } from '../../src/stores/timeline';
import { createMockClip, createMockTrack } from '../helpers/mockData';
import { NodeStreamFeedback, nodeStreamUserNotice } from '../../src/services/flashboard/FlashBoardNodeStreamFeedback';
import type { NodeStreamFailure } from '../../src/services/flashboard/FlashBoardNodeGraphStream';

const initial = useTimelineStore.getState();
const failure = (seq: number, args: Record<string, unknown>): NodeStreamFailure => ({
  seq, ref: `r${seq}`, tool: 'editOperatorGraph', args, error: 'Connection endpoint node does not exist.', executed: true,
});

describe('node stream feedback', () => {
  afterEach(() => useTimelineStore.setState(initial));

  it('hands each failure to the model exactly once', () => {
    const failures: NodeStreamFailure[] = [failure(3, { action: 'connect', fromNodeId: 'a', fromPortId: 'x', toNodeId: 'b', toPortId: 'y' })];
    const feedback = new NodeStreamFeedback(failures);
    const [item] = feedback.takeModelContentItems();
    expect(item.text).toContain('#3 editOperatorGraph connect a.x -> b.y');
    expect(item.text).toContain('getOperatorGraph');
    expect(feedback.takeModelContentItems()).toEqual([]);
    failures.push(failure(4, { action: 'add', nodeId: 'n', operatorId: 'field.noise2d' }));
    expect(feedback.takeModelContentItems()[0].text).toContain('#4 editOperatorGraph add field.noise2d n');
  });

  it('warns the user about graphs the turn left incomplete', () => {
    const clip = createMockClip({ id: 'c', effects: [{ id: 'fx', type: 'invert', name: 'Color Key', enabled: true, params: {},
      operatorGraph: { version: 1, domain: 'image', nodes: [], edges: [], layout: {}, incomplete: 'Compare: connect A.' } }] });
    useTimelineStore.setState({ clips: [clip], tracks: [createMockTrack({ id: clip.trackId })] });
    const failures = [failure(5, { action: 'connect', effectId: 'fx' })];
    const feedback = new NodeStreamFeedback(failures);
    feedback.takeModelContentItems();
    const calls = [{ modelContent: '', result: { success: false, error: 'x' },
      toolCall: { id: '1', name: 'editOperatorGraph', arguments: JSON.stringify({ effectId: 'fx' }) } }];
    expect(nodeStreamUserNotice(failures, feedback, calls)).toContain('„Color Key“ ist unvollständig');
    expect(nodeStreamUserNotice([], feedback, calls)).toBeUndefined();
  });
});
