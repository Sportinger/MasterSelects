import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTimelineStore } from '../../src/stores/timeline';
import { createMockClip } from '../helpers/mockData';
import { FlashBoardNodeGraphPresentation } from '../../src/services/flashboard/FlashBoardNodeGraphPresentation';
import type { FlashBoardExecutedToolCall } from '../../src/services/flashboard/FlashBoardChatTypes';
import { buildClipNodeGraphDocument } from '../../src/services/nodeGraph';
import { buildUnifiedClipGraph } from '../../src/services/nodeGraph/unifiedClipGraph';

const focusNodeGraph = vi.hoisted(() => vi.fn(async () => ({ success: true })));
vi.mock('../../src/services/aiTools/handlers/focusNodeGraph', () => ({ handleFocusNodeGraph: focusNodeGraph }));

const initial = useTimelineStore.getState();
let effectId: string;
const call = (success = true): FlashBoardExecutedToolCall => ({ modelContent: '', result: { success },
  toolCall: { name: 'editOperatorGraph', id: 'test-call', arguments: JSON.stringify({ clipId: 'working', effectId, action: 'set', nodeId: 'test' }) } });
const groups = () => useTimelineStore.getState().clips.find(clip => clip.id === 'working')!.nodeGraph!.groups!;

beforeEach(() => {
  focusNodeGraph.mockClear();
  useTimelineStore.setState({ clips: [createMockClip({ id: 'working', effects: [] }), createMockClip({ id: 'other', effects: [] })], isExporting: false });
  effectId = useTimelineStore.getState().addClipEffect('working', 'fisheye')!;
});
afterEach(() => useTimelineStore.setState(initial));
describe('agent node group presentation', () => {
  it('opens only the edited graph and the nested groups worked inside, collapsing after completion', () => {
    const presentation = new FlashBoardNodeGraphPresentation();
    const other = useTimelineStore.getState().clips.find(clip => clip.id === 'other');
    presentation.observe([call()]);
    expect(focusNodeGraph).toHaveBeenCalledWith({ clipId: 'working' });
    presentation.observe([call()]);
    expect(focusNodeGraph).toHaveBeenCalledTimes(2);
    expect(groups()[`effect:${effectId}`].collapsed).toBe(false);
    const clip = useTimelineStore.getState().clips.find(item => item.id === 'working')!;
    const nested = buildUnifiedClipGraph(buildClipNodeGraphDocument(clip), clip, [clip], [], undefined, true).groups!
      .filter(group => group.id.startsWith(`effect:${effectId}/`));
    expect(nested.length).toBeGreaterThan(1);
    // Used building blocks stay folded while the agent edits elsewhere.
    expect(nested.every(group => groups()[group.id]?.collapsed !== false)).toBe(true);
    const target = nested.find(group => !group.parentId?.includes('/'))!, inner = target.nodeIds[0].split('/').at(-1)!;
    presentation.observe([{ ...call(), toolCall: { name: 'editOperatorGraph', id: 'inner',
      arguments: JSON.stringify({ clipId: 'working', effectId, action: 'set', nodeId: inner }) } }]);
    expect(groups()[target.id].collapsed).toBe(false);
    expect(nested.filter(group => !target.nodeIds.some(id => group.nodeIds.includes(id)))
      .every(group => groups()[group.id]?.collapsed !== false)).toBe(true);
    presentation.complete();
    expect(Object.values(groups()).every(group => group.collapsed === true)).toBe(true);
    expect(useTimelineStore.getState().clips.find(clip => clip.id === 'other')).toBe(other);
  });
  it('reactivates Nodes for every graph tool, including graph reads', () => {
    const presentation = new FlashBoardNodeGraphPresentation();
    presentation.observe([call()]);
    presentation.observe([{ ...call(), toolCall: {
      name: 'getOperatorGraph', id: 'read', arguments: JSON.stringify({ clipId: 'working' }),
    } }]);
    expect(focusNodeGraph).toHaveBeenCalledTimes(2);
    expect(focusNodeGraph).toHaveBeenLastCalledWith({ clipId: 'working' });
  });
  it('leaves failed work open and never changes a planning turn', () => {
    const presentation = new FlashBoardNodeGraphPresentation();
    presentation.observe([call(), call(false)]);
    presentation.complete();
    expect(groups()[`effect:${effectId}`].collapsed).toBe(false);
    const before = groups();
    const plan = new FlashBoardNodeGraphPresentation(false);
    plan.observe([call()]); plan.complete();
    expect(groups()).toBe(before);
  });
  it('does not change a locked graph', () => {
    const clip = useTimelineStore.getState().clips.find(clip => clip.id === 'working')!;
    useTimelineStore.setState({ tracks: [{ id: clip.trackId, locked: true } as (typeof initial.tracks)[number]] });
    const presentation = new FlashBoardNodeGraphPresentation();
    presentation.observe([call()]); presentation.complete();
    expect(useTimelineStore.getState().clips.find(item => item.id === clip.id)).toBe(clip);
  });
});
