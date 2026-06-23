import { useCallback } from 'react';

import { useMediaStore } from '../../../stores/mediaStore';
import type { FileImportResult } from '../../../stores/mediaStore/types';
import type {
  TimelineExternalDropFilePlacementActions,
  TimelineExternalDropArrangement,
} from '../../../services/timeline/timelineExternalDropFilePlacement';
import { placeTimelineExternalDropFiles } from '../../../services/timeline/timelineExternalDropFilePlacement';
import { collectDroppedMediaFiles, importDroppedMediaFiles } from '../../panels/media/dropImport';

type DropActions = TimelineExternalDropFilePlacementActions & {
  addTrack: NonNullable<TimelineExternalDropFilePlacementActions['addTrack']>;
};

function chooseTimelineExternalDropArrangement(fileCount: number): TimelineExternalDropArrangement | null {
  if (fileCount <= 1) return 'side-by-side';

  const answer = window.prompt(
    `Drop ${fileCount} files on the timeline.\nType "stack" for layers or "side" for side by side.`,
    'side',
  );
  if (answer === null) return null;

  const normalized = answer.trim().toLowerCase();
  return normalized.startsWith('stack') || normalized.startsWith('layer') || normalized.startsWith('ueber')
    ? 'stack'
    : 'side-by-side';
}

export function useDroppedTimelineMediaFiles(actions: DropActions) {
  const folders = useMediaStore((state) => state.folders);
  const createFolder = useMediaStore((state) => state.createFolder);
  const importFiles = useMediaStore((state) => state.importFiles);
  const importFilesWithHandles = useMediaStore((state) => state.importFilesWithHandles);

  return useCallback(async (params: {
    dataTransfer: DataTransfer;
    trackId: string;
    trackIsVideo: boolean;
    baseStartTime: number;
    fallbackDuration?: number;
    filePath?: string;
    resolveStartTime?: (desiredStartTime: number, duration?: number) => number;
  }): Promise<boolean> => {
    const { dataTransfer, trackId, trackIsVideo, baseStartTime, fallbackDuration, filePath, resolveStartTime } = params;
    const records = await collectDroppedMediaFiles(dataTransfer);
    const arrangement = chooseTimelineExternalDropArrangement(records.length);
    if (!arrangement) return false;

    const recordsWithPath = filePath
      ? records.map((record) => ({ ...record, absolutePath: record.absolutePath ?? filePath }))
      : records;
    const importResults = await importDroppedMediaFiles<FileImportResult>(recordsWithPath, null, {
      createFolder,
      existingFolders: folders,
      importFiles,
      importFilesWithHandles,
    });

    return placeTimelineExternalDropFiles({
      actions,
      arrangement,
      records: recordsWithPath,
      importResults,
      trackId,
      trackIsVideo,
      baseStartTime,
      fallbackDuration,
      filePath,
      resolveStartTime,
    });
  }, [actions, createFolder, folders, importFiles, importFilesWithHandles]);
}
