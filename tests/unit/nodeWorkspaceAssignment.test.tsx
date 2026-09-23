import { act, renderHook, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTimelineStore } from '../../src/stores/timeline';
import { createMockClip, createMockTrack } from '../helpers/mockData';
import { useNodeGraphSubject } from '../../src/components/panels/nodes/useNodeGraphSubject';
import { useNodeWorkspaceViewRequests } from '../../src/components/panels/nodes/useNodeWorkspaceViewRequests';
import { requestNodeWorkspaceView, useNodeWorkspaceNavigation } from '../../src/services/nodeGraph/nodeWorkspaceNavigation';
vi.mock('../../src/services/landmarkTracking/usePreciseFaceTrack', () => ({ usePreciseFaceTrack: () => ({ ready: false }) }));
const initial = useTimelineStore.getState();
describe('node panel assignments', () => {
  beforeEach(() => {
    const a = createMockClip({ id: 'a', effects: [] }), b = createMockClip({ id: 'b', effects: [] });
    useTimelineStore.setState({ clips: [a, b], tracks: [createMockTrack({ id: a.trackId })], selectedClipIds: new Set(['a']), primarySelectedClipId: 'a' });
    useNodeWorkspaceNavigation.setState({ request: null, handledNonce: 0 });
  });
  afterEach(() => { cleanup(); useTimelineStore.setState(initial); });
  it('keeps a pinned graph through selection changes and clearing while Active follows selection', () => {
    const pinned = renderHook(() => useNodeGraphSubject('general', 'a'));
    const active = renderHook(() => useNodeGraphSubject('general'));
    expect(pinned.result.current?.id).toBe('a');
    act(() => useTimelineStore.setState({ selectedClipIds: new Set(['b']), primarySelectedClipId: 'b' }));
    expect(active.result.current?.id).toBe('b');
    expect(pinned.result.current?.id).toBe('a');
    act(() => useTimelineStore.setState({ selectedClipIds: new Set(), primarySelectedClipId: null }));
    expect(active.result.current).toBeNull();
    expect(pinned.result.current?.id).toBe('a');
    act(() => useTimelineStore.setState({ clips: useTimelineStore.getState().clips.filter(c => c.id !== 'a'), selectedClipIds: new Set(['b']), primarySelectedClipId: 'b' }));
    expect(pinned.result.current).toBeNull();
    expect(active.result.current?.id).toBe('b');
  });
  it('delivers an agent view request to its exact panel without switching another pinned graph', () => {
    const a = vi.fn(), b = vi.fn();
    renderHook(() => useNodeWorkspaceViewRequests(a, 'panel-a', 'a'));
    renderHook(() => useNodeWorkspaceViewRequests(b, 'panel-b', 'b'));
    act(() => requestNodeWorkspaceView('b', 'general', 'panel-b'));
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledTimes(1);
  });
});
