import { describe, expect, it, vi } from 'vitest';
import { createTimelineEmptyContextMenuModel } from '../../src/components/timeline/utils/timelineEmptyContextMenu';

describe('timeline empty context menu model', () => {
  it('builds gap and view commands with injected timeline coordinates', () => {
    const onEraseGap = vi.fn();
    const onEraseLayerGaps = vi.fn();
    const onEraseAllGaps = vi.fn();
    const onFitCompToWindow = vi.fn();

    const model = createTimelineEmptyContextMenuModel({
      time: 12.5,
      trackId: 'track-a',
      onEraseGap,
      onEraseLayerGaps,
      onEraseAllGaps,
      onFitCompToWindow,
    });

    expect(model.gapCommands.map(command => command.key)).toEqual([
      'erase-gap',
      'erase-layer-gaps',
      'erase-all-gaps',
    ]);
    expect(model.viewCommands.map(command => command.key)).toEqual(['fit-comp-to-window']);

    model.gapCommands[0].action();
    model.gapCommands[1].action();
    model.gapCommands[2].action();
    model.viewCommands[0].action();

    expect(onEraseGap).toHaveBeenCalledWith(12.5, 'track-a');
    expect(onEraseLayerGaps).toHaveBeenCalledWith(12.5, 'track-a');
    expect(onEraseAllGaps).toHaveBeenCalledTimes(1);
    expect(onFitCompToWindow).toHaveBeenCalledTimes(1);
  });
});
