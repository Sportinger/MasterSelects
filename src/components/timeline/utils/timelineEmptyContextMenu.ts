export interface TimelineEmptyContextMenuCommand {
  key: string;
  label: string;
  action: () => void;
}

export interface TimelineEmptyContextMenuModel {
  gapCommands: TimelineEmptyContextMenuCommand[];
  viewCommands: TimelineEmptyContextMenuCommand[];
}

export interface CreateTimelineEmptyContextMenuModelInput {
  time: number;
  trackId: string;
  onEraseGap: (time: number, trackId: string) => void;
  onEraseLayerGaps: (time: number, trackId: string) => void;
  onEraseAllGaps: () => void;
  onFitCompToWindow: () => void;
}

export function createTimelineEmptyContextMenuModel(
  input: CreateTimelineEmptyContextMenuModelInput,
): TimelineEmptyContextMenuModel {
  return {
    gapCommands: [
      {
        key: 'erase-gap',
        label: 'Erase Space Between Clips',
        action: () => input.onEraseGap(input.time, input.trackId),
      },
      {
        key: 'erase-layer-gaps',
        label: 'Erase Space Between All Clips in This Layer',
        action: () => input.onEraseLayerGaps(input.time, input.trackId),
      },
      {
        key: 'erase-all-gaps',
        label: 'Erase Space Between All Clips',
        action: input.onEraseAllGaps,
      },
    ],
    viewCommands: [
      {
        key: 'fit-comp-to-window',
        label: 'Fit Comp to Window',
        action: input.onFitCompToWindow,
      },
    ],
  };
}
