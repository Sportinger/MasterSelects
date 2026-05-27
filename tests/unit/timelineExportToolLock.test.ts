import { describe, expect, it, vi } from 'vitest';

import { lockTimelineEditActions } from '../../src/stores/timeline/exportEditLock';

describe('timeline export edit lock tool behavior', () => {
  it('allows tool selection while export is active but blocks timeline mutations', () => {
    const actions = {
      setToolMode: vi.fn(),
      toggleCutTool: vi.fn(),
      setActiveTimelineTool: vi.fn(),
      splitClip: vi.fn(),
    };

    const wrapped = lockTimelineEditActions(actions, () => ({ isExporting: true }));

    wrapped.setToolMode('cut');
    wrapped.toggleCutTool();
    wrapped.setActiveTimelineTool('blade');
    wrapped.splitClip('clip-1', 1);

    expect(actions.setToolMode).toHaveBeenCalledWith('cut');
    expect(actions.toggleCutTool).toHaveBeenCalledTimes(1);
    expect(actions.setActiveTimelineTool).toHaveBeenCalledWith('blade');
    expect(actions.splitClip).not.toHaveBeenCalled();
  });
});
