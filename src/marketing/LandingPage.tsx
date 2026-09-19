import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import {
  IconArrowRight,
  IconArrowUp,
  IconPlus,
} from '@tabler/icons-react';
import { PromptDictationButton } from '../components/common/PromptDictationButton';
import type { LandingBackgroundStatus } from './runLandingBackgroundCreation';
import { LandingChatActivity } from './LandingChatActivity';
import { useSeedancePreproductionController } from './useSeedancePreproductionController';
import type { LandingProjectMediaItem } from './LandingProjectMediaStrip';
import {
  LandingDropOverlay,
  LandingFinalOutput,
  LandingProjectOverview,
  LandingTopActions,
} from './LandingPageFrame';
import { LandingChatHeading, LandingCreationResults, LandingReviewPromptModeToggle, LandingSequenceSelector } from './LandingCreationSections';
import { LandingReviewConversation } from './LandingReviewConversation';
import type { LandingPageProps, LandingPromptPath } from './LandingPageProps';
import { hasDraggedLandingFiles, resizeLandingChatInput } from './landingInputLayout';
import { useLandingPromptDictation } from './useLandingPromptDictation';
import './landing.css';

export type { LandingProjectMediaItem } from './LandingProjectMediaStrip';
export type { LandingPageProps } from './LandingPageProps';

const MAX_INPUT_HEIGHT = 152;
const COMPLETION_STATUS_DURATION_MS = 1800;
const PROJECT_PICKER_EXIT_DURATION_MS = 360;

export function LandingPage({
  backgroundActivityStatus = null,
  backgroundJobRunning = false,
  isOpeningEditor = false,
  isNewProjectNaming = false,
  onCancelNewProjectNaming,
  onChooseNewProject,
  onCreateNewProject,
  onOpenEditor,
  onOpenChat,
  onOpenDirectChat,
  onStopChat,
  onDropProjectMedia,
  onOpenProject,
  onShowProjectPicker,
  onOpenRecentProject,
  onRemoveProjectFile,
  openingProjectId = null,
  onRenderVideo,
  onSelectReviewVariant, onSelectSequence,
  projectMedia = [],
  projectName,
  projectPickerCanClose = false,
  directMessages = [],
  recentProjects = [],
  reviewCompositionId,
  reviewCompositionName,
  reviewActiveVariantId,
  reviewError,
  reviewMessages = [],
  reviewReady = false,
  reviewRendering = false,
  reviewVariants = [],
  selectedProjectId, selectedSequenceId, selectedSequenceReady = false, sequences = [],
}: LandingPageProps) {
  const [draft, setDraft] = useState('');
  const [projectNameDraft, setProjectNameDraft] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const [activityStatus, setActivityStatus] = useState<LandingBackgroundStatus | null>(null);
  const [isFileDragActive, setIsFileDragActive] = useState(false);
  const [isImportingDrop, setIsImportingDrop] = useState(false);
  const [removingProjectFileId, setRemovingProjectFileId] = useState<string | null>(null);
  const [reviewPromptMode, setReviewPromptMode] = useState<'revise' | 'variant'>('revise');
  const [projectPickerMounted, setProjectPickerMounted] = useState(
    () => selectedProjectId === null || selectedProjectId === undefined,
  );
  const [projectPickerEntering, setProjectPickerEntering] = useState(false);
  const [projectPickerExiting, setProjectPickerExiting] = useState(false);
  const executeDirectEdit = useCallback(async ({
    idempotencyKey,
    prompt,
    runId,
    sourceFileIds,
  }: {
    idempotencyKey: string;
    prompt: string;
    runId: string;
    sourceFileIds: string[];
  }) => {
    if (!onOpenChat) throw new Error('The direct editor handoff is unavailable.');
    await onOpenChat(prompt, setActivityStatus, {
      idempotencyKey,
      preproductionRunId: runId,
      sourceFileIds,
    });
  }, [onOpenChat]);
  const seedance = useSeedancePreproductionController({
    executeDirectEdit,
    stopDirectEdit: onStopChat,
  });
  const directPathAvailable = Boolean(onOpenDirectChat);
  const [promptPath, setPromptPath] = useState<LandingPromptPath>(
    () => seedance.run ? 'story' : directPathAvailable ? 'direct' : 'auto',
  );
  const seedanceEnabled = promptPath === 'story';
  const directEnabled = promptPath === 'direct';
  const [selectedSeedanceSourceIds, setSelectedSeedanceSourceIds] = useState<Set<string>>(
    () => new Set(seedance.run?.sourceMediaFileIds ?? []),
  );
  const dragDepthRef = useRef(0);
  const importSelectionBaselineRef = useRef<Set<string> | null>(null);
  const completionStatusTimeoutRef = useRef<number | null>(null);
  const directHistoryRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const appendDictation = useLandingPromptDictation(setDraft, setActivityStatus, textareaRef, MAX_INPUT_HEIGHT);

  const projectFiles = useMemo(
    () => projectMedia.filter((item) => !item.isFinalOutput),
    [projectMedia],
  );
  const projectSourceIds = useMemo(
    () => new Set(projectFiles
      .filter((item) => item.type === 'video' || item.type === 'image' || item.type === 'audio')
      .map((item) => item.id)),
    [projectFiles],
  );
  const latestFinalOutput = projectMedia.find((item) => (
    item.type === 'video' && item.isFinalOutput
  ));
  const displayedActivityStatus = backgroundActivityStatus ?? activityStatus;
  const visibleActivityStatus = seedanceEnabled ? null : displayedActivityStatus;
  const seedanceBusy = Boolean(seedance.run && [
    'generating-ideas',
    'writing-story',
    'planning-assets',
    'researching',
    'implementing-edit',
    'generating-masters',
    'generating-keyframes',
  ].includes(seedance.run.phase));
  const canStopSeedance = seedanceEnabled && seedanceBusy;
  const canStopNormal = !seedanceEnabled
    && !isNewProjectNaming
    && (backgroundJobRunning || isSubmitting);
  const canStopChat = canStopSeedance || canStopNormal;
  const isChatBusy = backgroundJobRunning || isSubmitting || (seedanceEnabled && seedanceBusy);
  const projectSelectionPending = selectedProjectId === null;
  const seedanceSourceSelectionMissing = seedanceEnabled
    && !seedance.run
    && projectSourceIds.size > 0
    && selectedSeedanceSourceIds.size === 0;
  const sourceSelectionMode = !isNewProjectNaming && !seedance.run;
  const activeDraft = isNewProjectNaming ? projectNameDraft : draft;

  useEffect(() => {
    if (seedance.run) setPromptPath('story');
  }, [seedance.run]);

  useEffect(() => {
    if (!directEnabled || !directHistoryRef.current) return;
    directHistoryRef.current.scrollTop = directHistoryRef.current.scrollHeight;
  }, [directEnabled, directMessages]);

  useEffect(() => {
    setReviewPromptMode('revise');
  }, [reviewActiveVariantId, reviewReady]);

  useEffect(() => {
    setSelectedSeedanceSourceIds((current) => {
      const next = new Set([...current].filter((id) => projectSourceIds.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [projectSourceIds]);

  useEffect(() => {
    const baseline = importSelectionBaselineRef.current;
    if (!baseline) return;
    const addedIds = [...projectSourceIds].filter((id) => !baseline.has(id));
    if (addedIds.length === 0) return;
    setSelectedSeedanceSourceIds((current) => new Set([...current, ...addedIds]));
    importSelectionBaselineRef.current = null;
  }, [projectSourceIds]);

  useEffect(() => {
    if (seedance.run?.sourceMediaFileIds) {
      setSelectedSeedanceSourceIds(new Set(seedance.run.sourceMediaFileIds));
    }
  }, [seedance.run?.id, seedance.run?.sourceMediaFileIds]);

  useEffect(() => {
    if (selectedProjectId === null && !isNewProjectNaming) {
      if (!projectPickerMounted) {
        const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
        setProjectPickerEntering(!reduceMotion);
      }
      setProjectPickerMounted(true);
      setProjectPickerExiting(false);
      return;
    }
    if ((selectedProjectId === undefined && !isNewProjectNaming) || !projectPickerMounted) return;

    setProjectPickerExiting(true);
    const timeout = window.setTimeout(() => {
      setProjectPickerMounted(false);
      setProjectPickerExiting(false);
    }, PROJECT_PICKER_EXIT_DURATION_MS);
    return () => window.clearTimeout(timeout);
  }, [isNewProjectNaming, projectPickerMounted, selectedProjectId]);

  useEffect(() => {
    if (!projectPickerMounted || !projectPickerEntering) return;
    let secondFrame = 0;
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => setProjectPickerEntering(false));
    });
    return () => {
      window.cancelAnimationFrame(firstFrame);
      if (secondFrame) window.cancelAnimationFrame(secondFrame);
    };
  }, [projectPickerEntering, projectPickerMounted]);

  useEffect(() => {
    if (!isNewProjectNaming) return;
    setAnnouncement('');
    setActivityStatus(null);
    window.requestAnimationFrame(() => textareaRef.current?.focus());
  }, [isNewProjectNaming]);

  useEffect(() => {
    const previousTitle = document.title;
    document.title = 'MasterSelects — Start creating';

    return () => {
      document.title = previousTitle;
    };
  }, []);

  useEffect(() => () => {
    if (completionStatusTimeoutRef.current !== null) {
      window.clearTimeout(completionStatusTimeoutRef.current);
    }
  }, []);

  const handleChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    if (completionStatusTimeoutRef.current !== null) {
      window.clearTimeout(completionStatusTimeoutRef.current);
      completionStatusTimeoutRef.current = null;
    }
    setActivityStatus(null);
    if (isNewProjectNaming) {
      setProjectNameDraft(event.target.value);
    } else {
      setDraft(event.target.value);
    }
    resizeLandingChatInput(event.target, MAX_INPUT_HEIGHT);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const prompt = activeDraft.trim();

    if (isNewProjectNaming) {
      if (!prompt || isSubmitting || isOpeningEditor || !onCreateNewProject) {
        textareaRef.current?.focus();
        return;
      }

      setIsSubmitting(true);
      setAnnouncement('');
      try {
        const error = await onCreateNewProject(prompt);
        if (error) {
          setAnnouncement(error);
          textareaRef.current?.focus();
          return;
        }
        setProjectNameDraft('');
        if (textareaRef.current) textareaRef.current.style.height = 'auto';
      } catch {
        setAnnouncement('The project could not be created. Please try again.');
        textareaRef.current?.focus();
      } finally {
        setIsSubmitting(false);
      }
      return;
    }

    if (
      !prompt
      || visibleActivityStatus
      || isChatBusy
      || isOpeningEditor
      || projectSelectionPending
      || seedanceSourceSelectionMissing
      || (seedanceEnabled && seedance.run)
      || (directEnabled && !onOpenDirectChat)
    ) {
      textareaRef.current?.focus();
      return;
    }

    setIsSubmitting(true);
    setAnnouncement('');
    setActivityStatus(seedanceEnabled ? null : { label: 'Starting AI…' });

    try {
      if (seedanceEnabled) {
        const outcome = await seedance.start(prompt, [...selectedSeedanceSourceIds]);
        if (outcome !== 'completed') {
          setAnnouncement(outcome === 'stopped'
            ? 'Story workflow stopped.'
            : 'Story workflow could not be completed.');
          return;
        }
      } else if (directEnabled) {
        if (!onOpenDirectChat) throw new Error('Codex Direct is unavailable.');
        await onOpenDirectChat(prompt, setActivityStatus);
      } else {
        await onOpenChat?.(prompt || undefined, setActivityStatus, {
          ...(reviewReady ? { reviewMode: reviewPromptMode } : {}),
          sourceFileIds: [...selectedSeedanceSourceIds],
          ...(selectedSequenceId ? { targetCompositionId: selectedSequenceId } : {}),
        });
      }
      setDraft('');
      setReviewPromptMode('revise');
      setAnnouncement(seedanceEnabled
        ? 'Story workflow is ready.'
        : directEnabled ? 'Direct task completed.' : 'AI task completed.');
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
        textareaRef.current.style.overflowY = 'hidden';
      }
      if (!seedanceEnabled) completionStatusTimeoutRef.current = window.setTimeout(() => {
        setActivityStatus(null);
        completionStatusTimeoutRef.current = null;
        textareaRef.current?.focus();
      }, COMPLETION_STATUS_DURATION_MS);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        setAnnouncement('AI task stopped.');
        setActivityStatus(null);
        window.setTimeout(() => textareaRef.current?.focus(), 0);
        return;
      }
      setAnnouncement(directEnabled
        ? error instanceof Error ? error.message : String(error)
        : 'The AI task could not be completed. Please try again.');
      setActivityStatus({ label: 'Something went wrong' });
      textareaRef.current?.focus();
      completionStatusTimeoutRef.current = window.setTimeout(() => {
        setActivityStatus(null);
        completionStatusTimeoutRef.current = null;
      }, COMPLETION_STATUS_DURATION_MS);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Escape' && isNewProjectNaming && !isSubmitting) {
      event.preventDefault();
      setProjectNameDraft('');
      setAnnouncement('');
      onCancelNewProjectNaming?.();
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  };

  const handleDragEnter = (event: DragEvent<HTMLElement>) => {
    if (!hasDraggedLandingFiles(event.dataTransfer)) return;
    event.preventDefault();
    if (projectSelectionPending) return;
    dragDepthRef.current += 1;
    setIsFileDragActive(true);
  };

  const handleStopChat = () => {
    if (!canStopChat) return;
    if (canStopSeedance) {
      seedance.stop();
      setAnnouncement('Story workflow stopped.');
    } else {
      const stopped = onStopChat?.();
      if (stopped === false) {
        setAnnouncement('This AI task could not be stopped. Please wait for it to finish.');
        return;
      }
      setAnnouncement('AI task stopped.');
    }
    setIsSubmitting(false);
    setActivityStatus(null);
    window.setTimeout(() => textareaRef.current?.focus(), 0);
  };

  const handleDragOver = (event: DragEvent<HTMLElement>) => {
    if (!hasDraggedLandingFiles(event.dataTransfer)) return;
    event.preventDefault();
    if (projectSelectionPending) {
      event.dataTransfer.dropEffect = 'none';
      return;
    }
    event.dataTransfer.dropEffect = 'copy';
  };

  const handleDragLeave = (event: DragEvent<HTMLElement>) => {
    if (!hasDraggedLandingFiles(event.dataTransfer)) return;
    event.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setIsFileDragActive(false);
  };

  const handleDrop = (event: DragEvent<HTMLElement>) => {
    if (!hasDraggedLandingFiles(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    if (projectSelectionPending) return;
    dragDepthRef.current = 0;
    setIsFileDragActive(false);
    setIsImportingDrop(true);
    setAnnouncement('');
    importSelectionBaselineRef.current = new Set(projectSourceIds);

    const importPromise = onDropProjectMedia
      ? onDropProjectMedia(event.dataTransfer)
      : Promise.resolve(0);

    void importPromise
      .then((count) => {
        if (typeof count === 'number' && count > 0) {
          setAnnouncement(`${count} ${count === 1 ? 'file' : 'files'} added to the project.`);
        } else {
          importSelectionBaselineRef.current = null;
        }
      })
      .catch((error: unknown) => {
        importSelectionBaselineRef.current = null;
        setAnnouncement(error instanceof Error ? error.message : 'The files could not be imported.');
      })
      .finally(() => setIsImportingDrop(false));
  };

  const handleRemoveProjectFile = (item: LandingProjectMediaItem) => {
    if (!onRemoveProjectFile || removingProjectFileId !== null) return;
    setRemovingProjectFileId(item.id);
    setAnnouncement('');
    void Promise.resolve(onRemoveProjectFile(item))
      .then((removed) => {
        if (removed !== false) setAnnouncement(`${item.name} removed from the project.`);
      })
      .catch((error: unknown) => {
        setAnnouncement(error instanceof Error ? error.message : `${item.name} could not be removed.`);
      })
      .finally(() => setRemovingProjectFileId(null));
  };

  const handleToggleSeedanceSource = (item: LandingProjectMediaItem) => {
    if (isChatBusy || isOpeningEditor || seedance.run) return;
    setSelectedSeedanceSourceIds((current) => {
      const next = new Set(current);
      if (next.has(item.id)) next.delete(item.id);
      else next.add(item.id);
      return next;
    });
    setAnnouncement('');
  };

  const selectReviewInputOption = (prompt: string) => {
    setDraft(prompt);
    window.requestAnimationFrame(() => {
      if (!textareaRef.current) return;
      resizeLandingChatInput(textareaRef.current, MAX_INPUT_HEIGHT);
      textareaRef.current.focus();
    });
  };

  return (
    <main
      className={`landing-page ${isOpeningEditor ? 'is-opening-editor' : ''} ${isFileDragActive ? 'is-file-drag-active' : ''} ${seedanceEnabled && seedance.run ? 'is-seedance-active' : ''} ${directEnabled ? 'is-direct-chat' : ''} ${reviewReady || selectedSequenceReady ? 'is-review-ready' : ''}`}
      data-creation-morph-target="surface:start"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <div className="landing-atmosphere" aria-hidden="true" />

      {projectName && !projectSelectionPending && (
        <p className="landing-active-project-name" title={projectName}>{projectName}</p>
      )}

      <LandingTopActions
        isOpeningEditor={isOpeningEditor}
        onOpenEditor={onOpenEditor}
        onShowProjectPicker={onShowProjectPicker ? () => {
          seedance.reset();
          setPromptPath(directPathAvailable ? 'direct' : 'auto');
          onShowProjectPicker();
        } : undefined}
        openingProjectId={openingProjectId}
        projectPickerCanClose={projectPickerCanClose}
        projectSelectionPending={projectSelectionPending}
      />

      <div className={`landing-content ${seedanceEnabled && seedance.run ? 'is-seedance-active' : ''}`}>
        <LandingProjectOverview
          disabled={isChatBusy || isOpeningEditor || reviewReady}
          entering={projectPickerEntering}
          exiting={projectPickerExiting}
          items={projectFiles}
          mounted={projectPickerMounted}
          onChooseNewProject={onChooseNewProject}
          onOpenProject={onOpenProject}
          onOpenRecentProject={onOpenRecentProject}
          onRemoveItem={onRemoveProjectFile ? handleRemoveProjectFile : undefined}
          onShowProjects={onShowProjectPicker && !projectSelectionPending ? () => {
            seedance.reset();
            setPromptPath(directPathAvailable ? 'direct' : 'auto');
            onShowProjectPicker();
          } : undefined}
          onToggleSourceItem={handleToggleSeedanceSource}
          removingItemId={removingProjectFileId}
          openingProjectId={openingProjectId}
          recentProjects={recentProjects}
          selectedProjectId={selectedProjectId}
          selectedSourceItemIds={selectedSeedanceSourceIds}
          showPicker={!seedance.run}
          sourceSelectionMode={sourceSelectionMode}
        />

        <section className="landing-chat-section" aria-labelledby="landing-chat-heading">
          <LandingChatHeading
            directAvailable={directPathAvailable}
            isNewProjectNaming={isNewProjectNaming}
            isSubmitting={isSubmitting}
            onCancelNewProjectNaming={() => {
              setProjectNameDraft('');
              setAnnouncement('');
              onCancelNewProjectNaming?.();
            }}
            onPromptPathChange={(path) => {
              setPromptPath(path);
              setActivityStatus(null);
              setAnnouncement('');
            }}
            promptPath={promptPath}
          />
          {directEnabled && directMessages.length > 0 && (
            <div className="landing-direct-conversation-scroll" ref={directHistoryRef}>
              <LandingReviewConversation
                disabled={isChatBusy}
                messages={directMessages}
                onSelectInputOption={selectReviewInputOption}
              />
            </div>
          )}
          <form
            className={`landing-chat-pill ${visibleActivityStatus ? 'is-reporting' : ''} ${seedanceEnabled && !isNewProjectNaming ? 'is-seedance-mode' : ''} ${directEnabled && !isNewProjectNaming ? 'is-direct-mode' : ''} ${isNewProjectNaming ? 'is-project-naming' : ''}`}
            data-creation-morph-target="start:chat-pill"
            aria-label={isNewProjectNaming ? 'Name new project' : 'Open MasterSelects AI Chat'}
            onSubmit={handleSubmit}
          >
            <span className="landing-chat-orb" aria-hidden="true">
              {isNewProjectNaming && <IconPlus />}
            </span>
            <label className="landing-visually-hidden" htmlFor="landing-chat-input">
              {isNewProjectNaming ? 'Project title' : 'Message for AI Chat'}
            </label>
            <textarea
              ref={textareaRef}
              id="landing-chat-input"
              className="landing-chat-input"
              aria-describedby="landing-chat-status"
              autoComplete="off"
              autoFocus={!projectSelectionPending}
              enterKeyHint="go"
              maxLength={isNewProjectNaming ? 120 : 4000}
              disabled={projectSelectionPending && !isNewProjectNaming}
              onChange={handleChange}
              onKeyDown={handleKeyDown}
              placeholder={isNewProjectNaming
                ? 'Project title'
                : projectSelectionPending
                ? 'Choose New project or a recent project above'
                : directEnabled
                  ? 'What should Codex do in MasterSelects?'
                : reviewReady
                  ? reviewPromptMode === 'variant'
                    ? 'Describe the alternative version you want'
                    : 'What should AI change in this version?'
                : seedanceEnabled
                  ? 'Pick your media to work with'
                  : 'What would you like to create?'}
              rows={1}
              value={activeDraft}
            />
            {visibleActivityStatus && (
              <LandingChatActivity status={visibleActivityStatus} />
            )}
            {!isNewProjectNaming && (
              <PromptDictationButton
                className="landing-chat-dictation"
                disabled={projectSelectionPending || isChatBusy || isImportingDrop || isOpeningEditor}
                onTranscript={appendDictation}
              />
            )}
            <button
              className="landing-chat-send"
              type={canStopChat ? 'button' : 'submit'}
              aria-label={isNewProjectNaming
                ? isSubmitting ? 'Choosing project location' : 'Continue to project location'
                : canStopSeedance ? 'Stop Story workflow'
                  : canStopNormal ? 'Stop AI task'
                  : isChatBusy ? 'AI is preparing the project'
                  : seedanceSourceSelectionMissing ? 'Choose at least one source file'
                  : seedanceEnabled ? 'Start Story' : directEnabled ? 'Send to Direkt' : 'Create with AI'}
              data-busy={isChatBusy ? 'true' : 'false'}
              data-stoppable={canStopChat ? 'true' : 'false'}
              disabled={canStopChat
                ? false
                : isNewProjectNaming
                ? !projectNameDraft.trim() || isSubmitting || isOpeningEditor
                : projectSelectionPending || !draft.trim() || visibleActivityStatus !== null || isChatBusy || isOpeningEditor || seedanceSourceSelectionMissing || (seedanceEnabled && Boolean(seedance.run))}
              onClick={canStopChat ? handleStopChat : undefined}
            >
              {canStopChat
                ? <span className="landing-chat-stop" aria-hidden="true" />
                : isChatBusy
                ? <span className="landing-chat-spinner" aria-hidden="true" />
                : isNewProjectNaming ? <IconArrowRight aria-hidden="true" /> : <IconArrowUp aria-hidden="true" />}
            </button>
            <span
              id="landing-chat-status"
              className="landing-visually-hidden"
              aria-live="polite"
              role="status"
            >
              {announcement}
            </span>
          </form>
          {!seedanceEnabled && !isNewProjectNaming && <LandingSequenceSelector disabled={isChatBusy || isOpeningEditor} onSelect={onSelectSequence} selectedSequenceId={selectedSequenceId} sequences={sequences} />}
          {reviewReady && !seedanceEnabled && !directEnabled && !isNewProjectNaming && (
            <LandingReviewPromptModeToggle
              disabled={isChatBusy || isOpeningEditor}
              mode={reviewPromptMode}
              onChange={setReviewPromptMode}
            />
          )}
          {announcement && (
            <p className="landing-import-announcement" aria-hidden="true">{announcement}</p>
          )}
        </section>

        <LandingCreationResults
          isChatBusy={isChatBusy}
          onOpenEditor={onOpenEditor}
          onRenderVideo={onRenderVideo}
          onSelectReviewVariant={onSelectReviewVariant}
          onSelectReviewInputOption={selectReviewInputOption}
          reviewActiveVariantId={reviewActiveVariantId}
          reviewCompositionId={reviewCompositionId}
          reviewCompositionName={reviewCompositionName}
          reviewError={reviewError}
          reviewMessages={reviewMessages}
          reviewReady={reviewReady && !directEnabled}
          reviewRendering={reviewRendering}
          reviewVariants={reviewVariants}
          selectedSequence={sequences.find((sequence) => sequence.id === selectedSequenceId)} selectedSequenceReady={selectedSequenceReady && !directEnabled}
          seedance={seedance}
          seedanceEnabled={seedanceEnabled}
        />

        {latestFinalOutput && <LandingFinalOutput output={latestFinalOutput} />}
      </div>

      {(isFileDragActive || isImportingDrop) && (
        <LandingDropOverlay isImporting={isImportingDrop} />
      )}
    </main>
  );
}
