import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
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
import { isUserVisibleComposition } from '../stores/mediaStore/compositionVisibility';
import { useFlashBoardStore } from '../stores/flashboardStore';
import { useSeedancePreproductionStore } from '../stores/seedancePreproductionStore';
import { useDocumentsStore } from '../stores/documentsStore';
import { importProjectDocument } from '../services/documents/importDocument';
import {
  RECENT_PROJECTS_CHANGED_EVENT,
  projectFileService,
  type RecentProjectEntry,
} from '../services/projectFileService';
import {
  createBlankProject,
  closeCurrentProject,
  loadProjectToStores,
  openExistingProject,
  setProjectLoadProgress,
} from '../services/projectSync';
import { validateProjectName } from '../components/common/projectNameValidation';
import {
  collectDroppedMediaFiles,
  importDroppedMediaFiles,
  type DroppedMediaFileRecord,
} from '../components/panels/media/dropImport';
import {
  extractPlanningDocument,
  isPlanningDocumentFile,
} from '../services/seedancePreproduction/documentImport';
import { LandingPage, type LandingProjectMediaItem } from './LandingPage';
import type { LandingSequenceSummary } from './LandingPageProps';
import {
  LANDING_FINAL_OUTPUT_PREFIX,
  type LandingBackgroundStatusReporter,
} from './runLandingBackgroundCreation';
import { Logger } from '../services/logger';
import { runFlashBoardBridgeChatTurn } from '../services/flashboard/FlashBoardChatBridgeRunner';
import {
  cancelFlashBoardDirectChatRun,
  finishFlashBoardDirectChatRun,
  getFlashBoardDirectChatRunSnapshot,
  startFlashBoardDirectChatRun,
  subscribeFlashBoardDirectChatRun,
} from '../services/flashboard/FlashBoardDirectChatRun';
import {
  getLandingBackgroundJobSnapshot,
  continueLandingBackgroundJob,
  type LandingBackgroundJobStartOptions,
  renderLandingBackgroundJob,
  resumeLandingBackgroundJob,
  selectLandingBackgroundJobVariant,
  startLandingBackgroundJob,
  stopLandingBackgroundJob,
  subscribeLandingBackgroundJob,
} from './landingBackgroundJob';

const log = Logger.create('LandingPanel');

function resolveOpenProjectSelectionId(recentProjects: RecentProjectEntry[]): string | null {
  if (!projectFileService.isProjectOpen()) return null;
  const activePath = projectFileService.getProjectPath()?.replace(/\\/g, '/').replace(/\/+$/, '');
  return recentProjects.find((project) => (
    project.backend === 'native'
    && project.path?.replace(/\\/g, '/').replace(/\/+$/, '') === activePath
  ))?.id ?? recentProjects[0]?.id ?? 'open';
}

export function LandingPanel() {
  const loadSavedLayout = useDockStore((state) => state.loadSavedLayout);
  const pendingDocumentRef = useRef<string | null>(null);
  const storedFiles = useMediaStore((state) => state.files);
  const storedTextItems = useMediaStore((state) => state.textItems);
  const activeCompositionId = useMediaStore((state) => state.activeCompositionId);
  const chatMessages = useFlashBoardStore((state) => state.chatMessages);
  const directConversationRef = useFlashBoardStore((state) => (
    state.aiWorkspaces.find((workspace) => workspace.id === state.activeAIWorkspaceId)
      ?.chatConversationRef ?? null
  ));
  const storedCompositions = useMediaStore((state) => state.compositions);
  const currentProjectName = useMediaStore((state) => state.currentProjectName);
  const openCompositionTab = useMediaStore((state) => state.openCompositionTab);
  const planningDocuments = useSeedancePreproductionStore((state) => state.documents);
  const projectDocuments = useDocumentsStore((state) => state.documents);
  const putPlanningDocument = useSeedancePreproductionStore((state) => state.putDocument);
  const removePlanningDocument = useSeedancePreproductionStore((state) => state.removeDocument);
  const isMediaLoading = useMediaStore((state) => state.isLoading);
  const backgroundJob = useSyncExternalStore(
    subscribeLandingBackgroundJob,
    getLandingBackgroundJobSnapshot,
    getLandingBackgroundJobSnapshot,
  );
  const files = useMemo(() => Array.isArray(storedFiles) ? storedFiles : [], [storedFiles]);
  const compositions = useMemo(
    () => Array.isArray(storedCompositions) ? storedCompositions : [],
    [storedCompositions],
  );
  const textItems = useMemo(
    () => Array.isArray(storedTextItems) ? storedTextItems : [],
    [storedTextItems],
  );
  const [isOpeningEditor, setIsOpeningEditor] = useState(false);
  const [openingProjectId, setOpeningProjectId] = useState<string | null>(null);
  const [isNamingNewProject, setIsNamingNewProject] = useState(false);
  const [recentProjects, setRecentProjects] = useState<RecentProjectEntry[]>(() => (
    projectFileService.getRecentProjects()
  ));
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(() => {
    const projects = projectFileService.getRecentProjects();
    return resolveOpenProjectSelectionId(projects)
      ?? (Array.isArray(storedFiles) && storedFiles.length > 0 ? 'new' : null);
  });
  const lastSelectedProjectIdRef = useRef<string | null>(selectedProjectId);
  const directChatRunning = useSyncExternalStore(
    subscribeFlashBoardDirectChatRun,
    getFlashBoardDirectChatRunSnapshot,
    getFlashBoardDirectChatRunSnapshot,
  );
  const [selectedSequenceId, setSelectedSequenceId] = useState<string | null>(
    activeCompositionId,
  );

  useEffect(() => {
    if (selectedProjectId !== null) lastSelectedProjectIdRef.current = selectedProjectId;
  }, [selectedProjectId]);

  const reviewCompositionId = backgroundJob?.reviewCompositionId;
  const reviewComposition = reviewCompositionId
    ? compositions.find((composition) => composition.id === reviewCompositionId)
    : undefined;
  const reviewTargetReady = Boolean(
    reviewCompositionId
    && reviewComposition
    && activeCompositionId === reviewCompositionId
  );
  const sequences = useMemo<LandingSequenceSummary[]>(() => compositions
    .filter((composition) => (
      isUserVisibleComposition(composition)
      && (composition.timelineData?.clips.length ?? 0) > 0
    ))
    .map((composition) => {
      const clips = composition.timelineData?.clips ?? [];
      const clipEnd = Math.max(
        ...clips.map((clip) => clip.startTime + clip.duration),
        0,
      );
      return {
        clipCount: clips.length,
        duration: clipEnd || composition.timelineData?.duration || composition.duration,
        hasTranscript: clips.some((clip) => (
          Boolean(clip.transcript?.length)
          || files.some((file) => file.id === clip.mediaFileId && Boolean(file.transcript?.length))
        )),
        id: composition.id,
        name: composition.name,
      };
    }), [compositions, files]);
  const selectedSequence = sequences.find(({ id }) => id === selectedSequenceId);
  const selectedSequenceReady = Boolean(
    selectedSequence && activeCompositionId === selectedSequence.id,
  );
  const activeReviewVariant = backgroundJob?.editSession?.variants.find(
    variant => variant.id === backgroundJob.editSession?.activeVariantId,
  );
  const reviewMessages = useMemo(() => {
    if (!activeReviewVariant) return [];
    const messagesById = new Map(chatMessages.map(message => [message.id, message]));
    return activeReviewVariant.historyMessageIds
      .map(id => messagesById.get(id))
      .filter(message => message !== undefined);
  }, [activeReviewVariant, chatMessages]);
  const directMessages = useMemo(() => (
    directConversationRef === null
      ? []
      : chatMessages.filter((message) => message.conversationRef === directConversationRef)
  ), [chatMessages, directConversationRef]);

  useEffect(() => {
    if (
      !reviewCompositionId
      || reviewTargetReady
      || !reviewComposition
      || (selectedSequenceId !== null && selectedSequenceId !== reviewCompositionId)
    ) return;
    void openCompositionTab(reviewCompositionId, { skipAnimation: true });
  }, [
    openCompositionTab,
    reviewComposition,
    reviewCompositionId,
    reviewTargetReady,
    selectedSequenceId,
  ]);

  useEffect(() => {
    if (selectedSequenceId && sequences.some(({ id }) => id === selectedSequenceId)) return;
    const activeSequence = sequences.find(({ id }) => id === activeCompositionId);
    setSelectedSequenceId(activeSequence?.id ?? null);
  }, [activeCompositionId, selectedSequenceId, sequences]);

  const selectSequence = useCallback(async (sequenceId: string) => {
    if (!compositions.some(({ id }) => id === sequenceId)) return;
    setSelectedSequenceId(sequenceId);
    if (activeCompositionId !== sequenceId) {
      await openCompositionTab(sequenceId, { skipAnimation: true });
    }
  }, [activeCompositionId, compositions, openCompositionTab]);

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
    ...projectDocuments.map((document) => ({
      id: document.id,
      name: document.title.trim() || document.blocks.map(block => block.text.trim())
        .find(Boolean)?.slice(0, 60) || 'Untitled note',
      textPreview: document.blocks.map(block => block.text).join('\n'),
      type: 'document' as const,
    })),
  ], [files, projectDocuments, textItems]);

  const openEditor = useCallback(() => {
    if (selectedProjectId === null) {
      if (
        projectFileService.hasUnsavedChanges()
        && !window.confirm('You have unsaved changes. Open a new empty project?')
      ) return;
      closeCurrentProject();
      setSelectedProjectId('new');
    }
    setIsOpeningEditor(true);
  }, [selectedProjectId]);

  const openProjectFile = useCallback((item: LandingProjectMediaItem) => {
    if (item.type !== 'document') return;
    useDocumentsStore.getState().selectDocument(item.id);
    pendingDocumentRef.current = item.id;
    openEditor();
  }, [openEditor]);

  const runBackgroundChat = useCallback(async (
    prompt?: string,
    onStatus?: LandingBackgroundStatusReporter,
    options?: LandingBackgroundJobStartOptions,
  ) => {
    if (!prompt?.trim() || selectedProjectId === null) return;
    if (options?.targetCompositionId && activeCompositionId !== options.targetCompositionId) {
      await openCompositionTab(options.targetCompositionId, { skipAnimation: true });
    }
    if (
      options?.reviewMode
      && backgroundJob?.reviewBeforeRender === true
      && backgroundJob.editSession
      && backgroundJob.reviewCompositionId
    ) {
      await continueLandingBackgroundJob(prompt, options.reviewMode, onStatus);
      return;
    }
    await startLandingBackgroundJob(prompt, onStatus, {
      ...options,
      reviewBeforeRender: options?.preproductionRunId === undefined,
    });
  }, [activeCompositionId, backgroundJob, openCompositionTab, selectedProjectId]);

  const runDirectChat = useCallback(async (
    prompt?: string,
    onStatus?: LandingBackgroundStatusReporter,
  ) => {
    if (!prompt?.trim() || selectedProjectId === null || directConversationRef === null) return;
    const abortController = startFlashBoardDirectChatRun(directConversationRef);
    if (abortController === null) throw new Error('A Direct task is already running.');
    try {
      await runFlashBoardBridgeChatTurn({
        agentPath: 'direct-codex',
        conversationRef: directConversationRef,
        includeHistory: false,
        onKernelProgress: (progress) => onStatus?.({
          detail: progress.detail,
          label: progress.label,
          stage: progress.stage,
        }),
        onPhase: (phase) => onStatus?.({
          label: phase === 'kernel' ? 'Connecting to Codex…' : 'Codex is working…',
        }),
        persistToChat: true,
        prompt,
        runSource: 'ui',
        signal: abortController.signal,
        toolExecutionMode: 'normal',
      });
    } finally {
      finishFlashBoardDirectChatRun(abortController);
    }
  }, [directConversationRef, selectedProjectId]);

  const stopLandingChat = useCallback(() => {
    if (cancelFlashBoardDirectChatRun()) return true;
    return stopLandingBackgroundJob();
  }, []);

  const renderReviewedVideo = useCallback(async () => {
    const render = renderLandingBackgroundJob();
    if (!render) throw new Error('The reviewed edit is not ready to render.');
    await render;
  }, []);

  useEffect(() => {
    const refreshRecentProjects = () => {
      const projects = projectFileService.getRecentProjects();
      setRecentProjects(projects);
      setSelectedProjectId((current) => {
        if (current !== null || lastSelectedProjectIdRef.current !== null) return current;
        return resolveOpenProjectSelectionId(projects);
      });
    };
    refreshRecentProjects();
    window.addEventListener(RECENT_PROJECTS_CHANGED_EVENT, refreshRecentProjects);
    window.addEventListener('storage', refreshRecentProjects);
    return () => {
      window.removeEventListener(RECENT_PROJECTS_CHANGED_EVENT, refreshRecentProjects);
      window.removeEventListener('storage', refreshRecentProjects);
    };
  }, []);

  const confirmProjectSwitch = useCallback(() => (
    !projectFileService.hasUnsavedChanges()
    || window.confirm('You have unsaved changes. Switch projects?')
  ), []);

  const chooseNewProject = useCallback(() => {
    setIsNamingNewProject(true);
  }, []);

  const toggleProjectPicker = useCallback(() => {
    setIsNamingNewProject(false);
    setSelectedProjectId((current) => {
      if (current !== null) {
        lastSelectedProjectIdRef.current = current;
        return null;
      }
      return lastSelectedProjectIdRef.current;
    });
  }, []);

  const createNamedProject = useCallback(async (name: string): Promise<string | null> => {
    const validationError = validateProjectName(name);
    if (validationError) return validationError;

    try {
      const result = await createBlankProject(name);
      if (result === 'not-created') {
        return 'No project folder was selected, or the folder could not be created.';
      }
      if (result === 'save-failed') {
        return 'The project folder was created, but the .msproj package could not be saved.';
      }

      setSelectedProjectId('new');
      setIsNamingNewProject(false);
      setRecentProjects(projectFileService.getRecentProjects());
      return null;
    } catch {
      return 'The project could not be created. Please check the selected folder and try again.';
    }
  }, []);

  const openRecentProject = useCallback(async (projectId: string) => {
    if (openingProjectId !== null || !confirmProjectSwitch()) return;
    setOpeningProjectId(projectId);
    setProjectLoadProgress({
      blocking: true,
      message: 'Opening recent project',
      percent: 3,
      phase: 'opening',
    });
    try {
      const opened = await projectFileService.openRecentProject(projectId);
      if (!opened) {
        setProjectLoadProgress(null);
        window.alert('Could not open that recent project. It may have moved or require permission.');
        return;
      }
      await loadProjectToStores();
      setSelectedProjectId(projectId);
    } catch {
      setProjectLoadProgress(null);
      window.alert('Could not open that recent project.');
    } finally {
      setRecentProjects(projectFileService.getRecentProjects());
      setOpeningProjectId(null);
    }
  }, [confirmProjectSwitch, openingProjectId]);

  const openProject = useCallback(async () => {
    if (openingProjectId !== null || !confirmProjectSwitch()) return;
    setOpeningProjectId('open');
    setProjectLoadProgress({
      blocking: true,
      message: 'Opening project',
      percent: 3,
      phase: 'opening',
    });
    try {
      const opened = await openExistingProject();
      if (!opened) {
        setProjectLoadProgress(null);
        return;
      }
      const projects = projectFileService.getRecentProjects();
      setRecentProjects(projects);
      setSelectedProjectId(resolveOpenProjectSelectionId(projects) ?? 'open');
    } catch {
      setProjectLoadProgress(null);
      window.alert('Could not open that project.');
    } finally {
      setOpeningProjectId(null);
    }
  }, [confirmProjectSwitch, openingProjectId]);

  useEffect(() => {
    if (isMediaLoading || selectedProjectId === null) return;
    const resumed = resumeLandingBackgroundJob();
    void resumed?.catch(() => undefined);
  }, [files, isMediaLoading, selectedProjectId]);

  const importProjectRecords = useCallback(async (records: DroppedMediaFileRecord[]) => {
    if (records.length === 0) return 0;
    const mediaStore = useMediaStore.getState();
    const documentRecords = records.filter((record) => isPlanningDocumentFile(record.file));
    const mediaRecords = records.filter((record) => !isPlanningDocumentFile(record.file));
    const existingDocumentKeys = new Set(planningDocuments.map((document) => (
      `${document.name}|${document.byteLength}|${document.lastModified}`
    )));
    let importedCount = 0;
    const documentErrors: Error[] = [];

    for (const record of documentRecords) {
      const documentKey = `${record.file.name}|${record.file.size}|${record.file.lastModified}`;
      if (existingDocumentKeys.has(documentKey)) continue;
      try {
        const legacy = await extractPlanningDocument(record.file);
        const parsed = await importProjectDocument(record.file);
        useDocumentsStore.getState().importDocument(record.file.name, parsed.kind, parsed.blocks,
          parsed.source, `story:${legacy.id}`, parsed.screenplayTitlePage);
        putPlanningDocument(legacy);
        existingDocumentKeys.add(documentKey);
        importedCount += 1;
      } catch (error) {
        documentErrors.push(error instanceof Error ? error : new Error('Document import failed.'));
      }
    }

    if (mediaRecords.length > 0) {
      await importDroppedMediaFiles(mediaRecords, null, {
        createFolder: mediaStore.createFolder,
        existingFolders: mediaStore.folders,
        importFiles: mediaStore.importFiles,
        importFilesWithHandles: mediaStore.importFilesWithHandles,
      });
      importedCount += mediaRecords.length;
    }
    if (documentErrors[0]) throw documentErrors[0];
    return importedCount;
  }, [planningDocuments, putPlanningDocument]);

  const importProjectMedia = useCallback(async (dataTransfer: DataTransfer) => (
    importProjectRecords(await collectDroppedMediaFiles(dataTransfer))
  ), [importProjectRecords]);

  const pickProjectFiles = useCallback(async (pickedFiles: File[]) => (
    importProjectRecords(pickedFiles.map((file) => ({ file, folderSegments: [] })))
  ), [importProjectRecords]);

  const removeProjectFile = useCallback(async (item: LandingProjectMediaItem) => {
    const mediaStore = useMediaStore.getState();
    if (item.type === 'document') {
      useDocumentsStore.getState().deleteDocument(item.id);
      if (item.id.startsWith('story:')) removePlanningDocument(item.id.slice('story:'.length));
      return true;
    }
    if (item.type === 'text') {
      mediaStore.removeTextItem(item.id);
      return true;
    }

    const clipCount = mediaStore.getMediaFileUsages([item.id])
      .reduce((total, usage) => total + usage.clipCount, 0);
    if (
      clipCount > 0
      && !window.confirm(
        `Remove "${item.name}" from the project? This also removes ${clipCount} timeline ${clipCount === 1 ? 'clip' : 'clips'} that use it.`,
      )
    ) return false;

    const result = await mediaStore.deleteMediaFilesEverywhere([item.id]);
    if (result.artifactFailures.length > 0) {
      log.warn('Some landing-page media artifacts could not be deleted', result.artifactFailures);
    }
    return result.deletedMediaFileIds.includes(item.id);
  }, [removePlanningDocument]);

  useEffect(() => {
    if (!isOpeningEditor) return;

    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const timeoutId = window.setTimeout(() => {
      if (window.location.pathname === '/chat') {
        window.history.pushState(window.history.state, '', '/editor');
      }

      loadSavedLayout(FACTORY_VIDEO_EDIT_LAYOUT_ID, {
        transitionDurationMs: reduceMotion ? 0 : START_EDITOR_REVEAL_DURATION_MS,
        transitionStaggerMode: 'sequence',
      });
      if (pendingDocumentRef.current) {
        pendingDocumentRef.current = null;
        window.setTimeout(() => useDockStore.getState().activatePanelType('documents'), 0);
      }
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
          directChatRunning
          || backgroundJob?.state === 'queued'
          || backgroundJob?.state === 'running'
        }
        isOpeningEditor={isOpeningEditor}
        isNewProjectNaming={isNamingNewProject}
        onCancelNewProjectNaming={() => setIsNamingNewProject(false)}
        onOpenChat={runBackgroundChat}
        onOpenDirectChat={runDirectChat}
        onStopChat={stopLandingChat}
        onChooseNewProject={chooseNewProject}
        onCreateNewProject={createNamedProject}
        onDropProjectMedia={importProjectMedia}
        onOpenProject={openProject}
        onShowProjectPicker={toggleProjectPicker}
        onOpenRecentProject={openRecentProject}
        onPickProjectFiles={pickProjectFiles}
        onRemoveProjectFile={removeProjectFile}
        onOpenProjectFile={openProjectFile}
        onOpenEditor={openEditor}
        onRenderVideo={renderReviewedVideo}
        onSelectSequence={selectSequence}
        openingProjectId={openingProjectId}
        projectMedia={selectedProjectId === null ? [] : projectMedia}
        projectName={
          selectedProjectId !== null && typeof currentProjectName === 'string'
            ? currentProjectName
            : undefined
        }
        directMessages={directMessages}
        recentProjects={recentProjects}
        projectPickerCanClose={selectedProjectId === null && lastSelectedProjectIdRef.current !== null}
        reviewCompositionId={reviewCompositionId}
        reviewCompositionName={reviewComposition?.name}
        reviewMessages={reviewMessages}
        reviewActiveVariantId={backgroundJob?.editSession?.activeVariantId}
        reviewError={
          backgroundJob?.reviewBeforeRender
          && backgroundJob.phase === 'rendering'
          && backgroundJob.state === 'failed'
            ? backgroundJob.error
            : undefined
        }
        reviewReady={Boolean(
          backgroundJob?.reviewBeforeRender
          && reviewTargetReady
          && selectedSequenceId === reviewCompositionId
          && (
            backgroundJob.state === 'awaiting-review'
            || (
              backgroundJob.phase === 'editing'
              && (
                backgroundJob.state === 'queued'
                || backgroundJob.state === 'running'
                || backgroundJob.state === 'failed'
              )
            )
            || (
              backgroundJob.phase === 'rendering'
              && (
                backgroundJob.state === 'queued'
                || backgroundJob.state === 'running'
                || backgroundJob.state === 'failed'
              )
            )
          )
        )}
        reviewRendering={Boolean(
          backgroundJob?.reviewBeforeRender
          && backgroundJob.phase === 'rendering'
          && (backgroundJob.state === 'queued' || backgroundJob.state === 'running')
        )}
        reviewVariants={backgroundJob?.editSession?.variants
          .filter(variant => Boolean(variant.compositionId))
          .map(variant => ({
            id: variant.id,
            label: variant.label,
            status: variant.status,
          }))}
        onSelectReviewVariant={(variantId) => selectLandingBackgroundJobVariant(variantId)}
        selectedProjectId={selectedProjectId}
        selectedSequenceId={selectedSequenceId}
        selectedSequenceReady={selectedSequenceReady}
        sequences={selectedProjectId === null ? [] : sequences}
    />
  );
}
