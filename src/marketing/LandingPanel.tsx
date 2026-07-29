import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react';

import {
  FACTORY_VIDEO_EDIT_LAYOUT_ID,
  START_CHAT_EXIT_DURATION_MS,
  START_EDITOR_REVEAL_DURATION_MS,
  useDockStore,
} from '../stores/dockStore';
import { useMediaStore } from '../stores/mediaStore';
import {
  collectDroppedMediaFiles,
  importDroppedMediaFiles,
} from '../components/panels/media/dropImport';
import { LandingPage, type LandingProjectMediaItem } from './LandingPage';
import {
  LANDING_FINAL_OUTPUT_PREFIX,
  type LandingBackgroundStatusReporter,
} from './runLandingBackgroundCreation';
import {
  getLandingBackgroundJobSnapshot,
  resumeLandingBackgroundJob,
  startLandingBackgroundJob,
  subscribeLandingBackgroundJob,
} from './landingBackgroundJob';

export function LandingPanel() {
  const loadSavedLayout = useDockStore((state) => state.loadSavedLayout);
  const storedFiles = useMediaStore((state) => state.files);
  const storedTextItems = useMediaStore((state) => state.textItems);
  const isMediaLoading = useMediaStore((state) => state.isLoading);
  const backgroundJob = useSyncExternalStore(
    subscribeLandingBackgroundJob,
    getLandingBackgroundJobSnapshot,
    getLandingBackgroundJobSnapshot,
  );
  const files = Array.isArray(storedFiles) ? storedFiles : [];
  const textItems = Array.isArray(storedTextItems) ? storedTextItems : [];
  const [isOpeningEditor, setIsOpeningEditor] = useState(false);

  const projectMedia = useMemo<LandingProjectMediaItem[]>(() => [
    ...files
      .filter((file) => file.type === 'video' || file.type === 'image' || file.type === 'audio')
      .sort((left, right) => {
        const leftIsFinal = left.name.startsWith(LANDING_FINAL_OUTPUT_PREFIX);
        const rightIsFinal = right.name.startsWith(LANDING_FINAL_OUTPUT_PREFIX);
        if (leftIsFinal !== rightIsFinal) return Number(rightIsFinal) - Number(leftIsFinal);
        return leftIsFinal ? right.createdAt - left.createdAt : 0;
      })
      .map((file) => ({
        duration: file.duration,
        id: file.id,
        isFinalOutput: file.name.startsWith(LANDING_FINAL_OUTPUT_PREFIX),
        mediaUrl: file.type === 'video' ? file.url : undefined,
        name: file.name,
        previewUrl: file.thumbnailUrl ?? (file.type === 'image' ? file.url : undefined),
        type: file.type as LandingProjectMediaItem['type'],
      })),
    ...textItems.map((item) => ({
      duration: item.duration,
      id: item.id,
      name: item.name,
      textPreview: item.text,
      type: 'text' as const,
    })),
  ], [files, textItems]);

  const openEditor = useCallback(() => {
    setIsOpeningEditor(true);
  }, []);

  const runBackgroundChat = useCallback(async (
    prompt?: string,
    onStatus?: LandingBackgroundStatusReporter,
  ) => {
    if (!prompt?.trim()) return;
    await startLandingBackgroundJob(prompt, onStatus);
  }, []);

  useEffect(() => {
    if (isMediaLoading) return;
    const resumed = resumeLandingBackgroundJob();
    void resumed?.catch(() => undefined);
  }, [files, isMediaLoading]);

  const importProjectMedia = useCallback(async (dataTransfer: DataTransfer) => {
    const droppedFiles = await collectDroppedMediaFiles(dataTransfer);
    if (droppedFiles.length === 0) return 0;

    const mediaStore = useMediaStore.getState();
    await importDroppedMediaFiles(droppedFiles, null, {
      createFolder: mediaStore.createFolder,
      existingFolders: mediaStore.folders,
      importFiles: mediaStore.importFiles,
      importFilesWithHandles: mediaStore.importFilesWithHandles,
    });
    return droppedFiles.length;
  }, []);

  useEffect(() => {
    if (!isOpeningEditor) return;

    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const timeoutId = window.setTimeout(() => {
      if (window.location.pathname === '/landing') {
        window.history.replaceState(window.history.state, '', '/');
      }

      loadSavedLayout(FACTORY_VIDEO_EDIT_LAYOUT_ID, {
        transitionDurationMs: reduceMotion ? 0 : START_EDITOR_REVEAL_DURATION_MS,
        transitionStaggerMode: 'sequence',
      });
    }, reduceMotion ? 0 : START_CHAT_EXIT_DURATION_MS);

    return () => window.clearTimeout(timeoutId);
  }, [isOpeningEditor, loadSavedLayout]);

  return (
    <LandingPage
      backgroundActivityStatus={
        backgroundJob?.state === 'queued' || backgroundJob?.state === 'running'
          ? backgroundJob.status
          : null
      }
      backgroundJobRunning={
        backgroundJob?.state === 'queued' || backgroundJob?.state === 'running'
      }
      isOpeningEditor={isOpeningEditor}
      onOpenChat={runBackgroundChat}
      onDropProjectMedia={importProjectMedia}
      onOpenEditor={openEditor}
      projectMedia={projectMedia}
    />
  );
}
