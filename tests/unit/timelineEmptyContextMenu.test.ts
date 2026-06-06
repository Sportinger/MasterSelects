import { describe, expect, it, vi } from 'vitest';
import {
  createTimelineEmptyContextMenuModel,
  executeTimelineEmptyContextMenuCommand,
} from '../../src/components/timeline/utils/timelineEmptyContextMenu';

describe('timeline empty context menu model', () => {
  it('builds gap and view command descriptors with timeline coordinates', () => {
    const model = createTimelineEmptyContextMenuModel({
      time: 12.5,
      trackId: 'track-a',
    });

    expect(model.gapCommands).toEqual([
      {
        key: 'erase-gap',
        label: 'Erase Space Between Clips',
        kind: 'erase-gap',
        payload: { time: 12.5, trackId: 'track-a' },
      },
      {
        key: 'erase-layer-gaps',
        label: 'Erase Space Between All Clips in This Layer',
        kind: 'erase-layer-gaps',
        payload: { time: 12.5, trackId: 'track-a' },
      },
      {
        key: 'erase-all-gaps',
        label: 'Erase Space Between All Clips',
        kind: 'erase-all-gaps',
      },
    ]);
    expect(model.viewCommands).toEqual([{
      key: 'fit-comp-to-window',
      label: 'Fit Comp to Window',
      kind: 'fit-comp-to-window',
    }]);
  });

  it('executes empty-menu descriptors through explicit handlers', () => {
    const onEraseGap = vi.fn();
    const onEraseLayerGaps = vi.fn();
    const onEraseAllGaps = vi.fn();
    const onFitCompToWindow = vi.fn();
    const model = createTimelineEmptyContextMenuModel({
      time: 12.5,
      trackId: 'track-a',
    });
    const handlers = {
      onEraseGap,
      onEraseLayerGaps,
      onEraseAllGaps,
      onFitCompToWindow,
    };

    expect(executeTimelineEmptyContextMenuCommand(model.gapCommands[0], handlers)).toBe(true);
    expect(executeTimelineEmptyContextMenuCommand(model.gapCommands[1], handlers)).toBe(true);
    expect(executeTimelineEmptyContextMenuCommand(model.gapCommands[2], handlers)).toBe(true);
    expect(executeTimelineEmptyContextMenuCommand(model.viewCommands[0], handlers)).toBe(true);

    expect(onEraseGap).toHaveBeenCalledWith(12.5, 'track-a');
    expect(onEraseLayerGaps).toHaveBeenCalledWith(12.5, 'track-a');
    expect(onEraseAllGaps).toHaveBeenCalledTimes(1);
    expect(onFitCompToWindow).toHaveBeenCalledTimes(1);
  });
});
