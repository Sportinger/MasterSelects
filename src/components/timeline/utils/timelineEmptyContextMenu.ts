export type TimelineEmptyContextMenuCommandKind =
  | 'erase-gap'
  | 'erase-layer-gaps'
  | 'erase-all-gaps'
  | 'fit-comp-to-window';

export interface TimelineEmptyContextMenuCommand {
  key: string;
  label: string;
  kind: TimelineEmptyContextMenuCommandKind;
  payload?: {
    time: number;
    trackId: string;
  };
}

export interface TimelineEmptyContextMenuModel {
  gapCommands: TimelineEmptyContextMenuCommand[];
  viewCommands: TimelineEmptyContextMenuCommand[];
}

export interface CreateTimelineEmptyContextMenuModelInput {
  time: number;
  trackId: string;
}

export interface ExecuteTimelineEmptyContextMenuCommandInput {
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
        kind: 'erase-gap',
        payload: { time: input.time, trackId: input.trackId },
      },
      {
        key: 'erase-layer-gaps',
        label: 'Erase Space Between All Clips in This Layer',
        kind: 'erase-layer-gaps',
        payload: { time: input.time, trackId: input.trackId },
      },
      {
        key: 'erase-all-gaps',
        label: 'Erase Space Between All Clips',
        kind: 'erase-all-gaps',
      },
    ],
    viewCommands: [
      {
        key: 'fit-comp-to-window',
        label: 'Fit Comp to Window',
        kind: 'fit-comp-to-window',
      },
    ],
  };
}

export function executeTimelineEmptyContextMenuCommand(
  command: TimelineEmptyContextMenuCommand,
  input: ExecuteTimelineEmptyContextMenuCommandInput,
): boolean {
  switch (command.kind) {
    case 'erase-gap':
      if (!command.payload) return false;
      input.onEraseGap(command.payload.time, command.payload.trackId);
      return true;
    case 'erase-layer-gaps':
      if (!command.payload) return false;
      input.onEraseLayerGaps(command.payload.time, command.payload.trackId);
      return true;
    case 'erase-all-gaps':
      input.onEraseAllGaps();
      return true;
    case 'fit-comp-to-window':
      input.onFitCompToWindow();
      return true;
    default:
      return false;
  }
}
