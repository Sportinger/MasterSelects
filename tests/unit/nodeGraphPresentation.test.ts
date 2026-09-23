import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useTimelineStore } from '../../src/stores/timeline';
import { createMockClip } from '../helpers/mockData';
import { FlashBoardNodeGraphPresentation } from '../../src/services/flashboard/FlashBoardNodeGraphPresentation';
import type { FlashBoardExecutedToolCall } from '../../src/services/flashboard/FlashBoardChatTypes';

const initial = useTimelineStore.getState();
let effectId: string;
const call = (success = true): FlashBoardExecutedToolCall => ({ modelContent: '', result: { success },
  toolCall: { name: 'editOperatorGraph', id: 'test-call', arguments: JSON.stringify({ clipId: 'working', effectId, action: 'set', nodeId: 'test' }) } });
const groups = () => useTimelineStore.getState().clips.find(clip => clip.id === 'working')!.nodeGraph!.groups!;

beforeEach(() => {
  useTimelineStore.setState({ clips: [createMockClip({ id: 'working', effects: [] }), createMockClip({ id: 'other', effects: [] })], isExporting: false });
  effectId = useTimelineStore.getState().addClipEffect('working', 'fisheye')!;
});
afterEach(() => useTimelineStore.setState(initial));
describe('agent node group presentation', () => {
  it('opens all descendants while working and collapses them only after completion', () => {
    const presentation = new FlashBoardNodeGraphPresentation();
    const other = useTimelineStore.getState().clips.find(clip => clip.id === 'other');
    presentation.observe([call()]);
    expect(groups()[`effect:${effectId}`].collapsed).toBe(false);
    const descendants = Object.entries(groups()).filter(([id]) => id.startsWith(`effect:${effectId}/`));
    expect(descendants.length).toBeGreaterThan(0);
    expect(descendants.every(([, group]) => group.collapsed === false)).toBe(true);
    presentation.complete();
    expect(Object.values(groups()).every(group => group.collapsed === true)).toBe(true);
    expect(useTimelineStore.getState().clips.find(clip => clip.id === 'other')).toBe(other);
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
