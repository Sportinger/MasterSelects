import { act, renderHook } from '@testing-library/react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { describe, expect, it, vi } from 'vitest';

const apply = vi.fn();
vi.mock('../../src/stores/timeline', () => ({ useTimelineStore: { getState: () => ({ applyTimelineEditOperation: apply }) } }));

import { useTimelineTrackSelectTool } from '../../src/components/timeline/hooks/useTimelineTrackSelectTool';

const row = { getBoundingClientRect: () => ({ left: 100 }) };
const press = (clientX: number) => ({ button: 0, clientX, currentTarget: row, preventDefault: vi.fn(), stopPropagation: vi.fn() }) as unknown as ReactMouseEvent<HTMLDivElement>;

describe('track-select tools on a track row', () => {
  it('select from the pressed time anywhere on the row, ahead of trim handles', () => {
    const { result } = renderHook(() => useTimelineTrackSelectTool({ activeTimelineToolId: 'track-select-forward-all', trackId: 'v1', pixelToTime: px => px / 10 }));
    const event = press(350);
    act(() => result.current.onMouseDownCapture(event));
    expect(apply).toHaveBeenCalledWith(expect.objectContaining({ type: 'select-clips-from-time', time: 25, direction: 'forward', trackIds: undefined }), expect.anything());
    expect(event.stopPropagation).toHaveBeenCalledOnce();
  });

  it('leaves the press alone with other tools', () => {
    apply.mockClear();
    const { result } = renderHook(() => useTimelineTrackSelectTool({ activeTimelineToolId: 'select', trackId: 'v1', pixelToTime: px => px }));
    const event = press(350);
    act(() => result.current.onMouseDownCapture(event));
    expect(apply).not.toHaveBeenCalled();
    expect(event.stopPropagation).not.toHaveBeenCalled();
  });
});
