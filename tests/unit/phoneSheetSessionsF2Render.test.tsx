// F2 render checks: Adjust pauses playback (so Done's final write cannot add a stray key at a later
// playhead), and the phone project state follows a project close at once instead of after the poll.
import { act, render, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/components/common/toolbar/toolbarProjectStartup', () => ({
  runToolbarProjectBootRestore: vi.fn(async () => 'none'),
}));
vi.mock('../../src/services/projectSync', () => ({
  loadProjectToStores: vi.fn(), setProjectLoadProgress: vi.fn(), setupAutoSync: vi.fn(),
}));
vi.mock('../../src/services/project/projectLifecycle', () => ({ teardownAutoSync: vi.fn() }));

import { PhoneAdjustSheet } from '../../src/components/mobileSkin/effects/PhoneAdjustSheet';
import { notifyPhoneProjectStateChanged } from '../../src/components/mobileSkin/runtime/phoneProjectStateEvents';
import { usePhoneProjectBoot } from '../../src/components/mobileSkin/runtime/usePhoneProjectBoot';
import { projectFileService } from '../../src/services/projectFileService';
import { useTimelineStore } from '../../src/stores/timeline';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Adjust sheet and running playback', () => {
  it('pauses playback when it opens', () => {
    const pause = vi.fn(() => useTimelineStore.setState({ isPlaying: false }));
    useTimelineStore.setState({ isPlaying: true, pause } as never);
    const view = render(<PhoneAdjustSheet />);
    expect(pause).toHaveBeenCalledTimes(1);
    view.unmount();
  });
});

describe('phone project state after closing a project', () => {
  it('drops projectOpen as soon as the close is announced, without waiting for the poll', async () => {
    let open = true;
    vi.spyOn(projectFileService, 'isProjectOpen').mockImplementation(() => open);
    vi.spyOn(projectFileService, 'needsPermission').mockReturnValue(false);
    const { result } = renderHook(() => usePhoneProjectBoot());
    await act(async () => { await Promise.resolve(); });
    expect(result.current.projectOpen).toBe(true);
    open = false;
    act(() => notifyPhoneProjectStateChanged());
    expect(result.current.projectOpen).toBe(false);
  });
});
