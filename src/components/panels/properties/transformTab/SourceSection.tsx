import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type DragEvent } from 'react';

import { isLiveInputUsedOutsideComposition } from '../../../../services/liveInputTimeline';
import { connectAndPersistLiveInput } from '../../../../services/mediaRuntime/liveInputConnection';
import { liveInputRuntime } from '../../../../services/mediaRuntime/liveInputRuntime';
import { useMediaStore } from '../../../../stores/mediaStore';
import { useTimelineStore } from '../../../../stores/timeline';
import type { LiveInputSource } from '../../../../types/liveInput';
import { LiveInputDialog } from '../../media/LiveInputDialog';
import { LayerModeControls } from './LayerModeControls';
import './SourceSection.css';

const MEDIA_FILE_MIME = 'application/x-media-file-id';
const COMPOSITION_MIME = 'application/x-composition-id';

interface SourceSectionProps {
  clipId: string;
  freeRun: boolean;
  isEffectively3D: boolean;
  isLocked3D: boolean;
  mediaFileId?: string;
  supportsFreeRun: boolean;
  onFreeRunToggle: () => void;
  onToggle3D: () => void;
}

function isSupportedSourceDrag(event: DragEvent<HTMLElement>): boolean {
  const types = Array.from(event.dataTransfer.types);
  return types.includes(MEDIA_FILE_MIME) || types.includes(COMPOSITION_MIME);
}

function liveSourceName(
  source: LiveInputSource,
  fallbackName: string,
  compositions: ReadonlyArray<{ id: string; name: string }>,
): string {
  if (source.kind === 'display') return source.displayLabel || fallbackName || 'Live Display';
  if (source.kind === 'video-device') return source.deviceLabel || fallbackName || 'Live Camera';
  const composition = compositions.find((candidate) => candidate.id === source.compositionId);
  return `${composition?.name ?? 'Composition'} Feedback`;
}

export function SourceSection({
  clipId,
  freeRun,
  isEffectively3D,
  isLocked3D,
  mediaFileId,
  supportsFreeRun,
  onFreeRunToggle,
  onToggle3D,
}: SourceSectionProps) {
  const clip = useTimelineStore((state) => state.clips.find((candidate) => candidate.id === clipId));
  const replaceClipSource = useTimelineStore((state) => state.replaceClipSource);
  const replaceClipSourceWithComposition = useTimelineStore((state) => state.replaceClipSourceWithComposition);
  const clips = useTimelineStore((state) => state.clips);
  const mediaFile = useMediaStore((state) => (
    mediaFileId ? state.files.find((candidate) => candidate.id === mediaFileId) : undefined
  ));
  const composition = useMediaStore((state) => (
    clip?.compositionId
      ? state.compositions.find((candidate) => candidate.id === clip.compositionId)
      : undefined
  ));
  const compositions = useMediaStore((state) => state.compositions);
  const activeCompositionId = useMediaStore((state) => state.activeCompositionId);
  const updateLiveInputSource = useMediaStore((state) => state.updateLiveInputSource);
  useSyncExternalStore(
    (listener) => liveInputRuntime.subscribe(listener),
    () => liveInputRuntime.getRevision(),
    () => 0,
  );
  const liveInputId = clip?.source?.liveInputId;
  const liveInputSource = mediaFile?.liveInput;
  const isLiveInput = Boolean(liveInputId && liveInputSource);
  const isLiveInputConnected = Boolean(liveInputId && liveInputRuntime.getVideoElement(liveInputId));
  const activeComposition = compositions.find((candidate) => candidate.id === activeCompositionId) ?? null;
  const [dragActive, setDragActive] = useState(false);
  const [dropHintActive, setDropHintActive] = useState(false);
  const [liveSourceDialogOpen, setLiveSourceDialogOpen] = useState(false);
  const [liveSourcePending, setLiveSourcePending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const dropHintTimeoutRef = useRef<number | undefined>(undefined);

  useEffect(() => () => {
    window.clearTimeout(dropHintTimeoutRef.current);
  }, []);

  const showDropHint = useCallback(() => {
    setDropHintActive(true);
    window.clearTimeout(dropHintTimeoutRef.current);
    dropHintTimeoutRef.current = window.setTimeout(() => {
      setDropHintActive(false);
    }, 1600);
  }, []);

  const handleDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (isLiveInput) return;
    if (!isSupportedSourceDrag(event)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'copy';
    setDragActive(true);
  }, [isLiveInput]);

  const handleDragLeave = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
    setDragActive(false);
  }, []);

  const handleDrop = useCallback(async (event: DragEvent<HTMLDivElement>) => {
    if (isLiveInput) return;
    if (!isSupportedSourceDrag(event)) return;
    event.preventDefault();
    event.stopPropagation();
    setDragActive(false);

    const replacementCompositionId = event.dataTransfer.getData(COMPOSITION_MIME);
    if (replacementCompositionId) {
      const replaced = await replaceClipSourceWithComposition(clipId, replacementCompositionId);
      setMessage(replaced
        ? 'Source replaced with subcomp'
        : 'Cannot use this composition here (missing, locked, or cyclic)');
      return;
    }

    const replacementMediaFileId = event.dataTransfer.getData(MEDIA_FILE_MIME);
    const replaced = replacementMediaFileId
      ? replaceClipSource(clipId, replacementMediaFileId)
      : false;
    setMessage(replaced ? 'Source replaced' : 'Drop a ready video or composition here');
  }, [clipId, isLiveInput, replaceClipSource, replaceClipSourceWithComposition]);

  const reconnectLiveSource = useCallback(async () => {
    if (!liveInputId || !liveInputSource || liveSourcePending) return;
    setLiveSourcePending(true);
    setMessage(null);
    try {
      await connectAndPersistLiveInput(liveInputId, liveInputSource, updateLiveInputSource);
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : 'The live source could not be reconnected.');
    } finally {
      setLiveSourcePending(false);
    }
  }, [liveInputId, liveInputSource, liveSourcePending, updateLiveInputSource]);

  const applyLiveSource = useCallback(async (source: LiveInputSource) => {
    if (!liveInputId) return;
    if (
      source.kind === 'composition-feedback' &&
      isLiveInputUsedOutsideComposition(liveInputId, source.compositionId, activeCompositionId, clips, compositions)
    ) {
      throw new Error('This Live Input is also used in another composition. Duplicate the Media Panel item before binding it to composition feedback.');
    }
    await connectAndPersistLiveInput(liveInputId, source, updateLiveInputSource);
    setLiveSourceDialogOpen(false);
    setMessage(null);
  }, [activeCompositionId, clips, compositions, liveInputId, updateLiveInputSource]);

  const sourceName = liveInputSource
    ? liveSourceName(liveInputSource, mediaFile?.name ?? '', compositions)
    : composition?.name ?? mediaFile?.name ?? 'Video source';
  const sourceTitle = message ?? `${sourceName} · Drop another video or composition here`;

  return (
    <section className="properties-section transform-source-section" aria-label="Source">
      <div
        className={`transform-source-dropzone${isLiveInput ? ' is-live-input' : ''}${dragActive ? ' is-drag-active' : ''}${dropHintActive ? ' is-drop-hint-active' : ''}`}
        data-guided-target="properties-transform-source"
        onDragEnter={handleDragOver}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        role="group"
        aria-label={`${isLiveInput ? 'Live' : 'Video'} source: ${sourceName}`}
        title={isLiveInput ? undefined : sourceTitle}
      >
        <span className="transform-source-label">Source</span>
        <span className="transform-source-value">
          <button
            type="button"
            className={`transform-source-name${isLiveInput && !isLiveInputConnected ? ' needs-reconnect' : ''}`}
            disabled={liveSourcePending}
            onClick={isLiveInput
              ? () => {
                  if (isLiveInputConnected) setLiveSourceDialogOpen(true);
                  else void reconnectLiveSource();
                }
              : showDropHint}
            onPointerDown={(event) => {
              if (!isLiveInput && event.pointerType === 'touch') showDropHint();
            }}
            aria-label={isLiveInput
              ? isLiveInputConnected
                ? `Choose live source for ${sourceName}`
                : `Reconnect live source ${sourceName}`
              : `Show replacement drop zone for ${sourceName}`}
            title={isLiveInput
              ? isLiveInputConnected
                ? 'Choose another live source'
                : 'Reconnect the saved live source'
              : 'Show where to drop a replacement video or composition'}
          >
            {isLiveInput && !isLiveInputConnected
              ? liveSourcePending ? 'CONNECTING…' : 'RECONNECT'
              : sourceName}
          </button>
          {!isLiveInput && <span className="transform-source-drop-label" aria-hidden="true">DROP</span>}
        </span>
        <LayerModeControls
          freeRun={freeRun}
          isEffectively3D={isEffectively3D}
          isLocked3D={isLocked3D}
          showDimensionToggle={false}
          supportsFreeRun={supportsFreeRun}
          onFreeRunToggle={onFreeRunToggle}
          onToggle3D={onToggle3D}
        />
      </div>
      {message && (
        <span className={`transform-source-message${isLiveInput ? ' is-live-input' : ''}`} role="status">
          {message}
        </span>
      )}
      {liveSourceDialogOpen && liveInputSource && (
        <LiveInputDialog
          activeComposition={activeComposition}
          initialSource={liveInputSource}
          submitLabel="Connect"
          title="Select Live Source"
          onCreate={applyLiveSource}
          onCancel={() => setLiveSourceDialogOpen(false)}
        />
      )}
    </section>
  );
}
