import { useMemo, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useAnnotationStore } from '../../../stores/annotationStore';
import { useMediaStore } from '../../../stores/mediaStore';
import { useTimelineStore } from '../../../stores/timeline';
import { useDocumentsStore } from '../../../stores/documentsStore';
import { useDockStore } from '../../../stores/dockStore';
import type { SourceAnnotation } from '../../../types/sourceAnnotation';
import './AnnotationsPanel.css';

function formatTime(seconds: number): string {
  const safeSeconds = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = safeSeconds - minutes * 60;
  return `${minutes}:${remainder.toFixed(2).padStart(5, '0')}`;
}

function parseTime(value: string, fallback: number): number {
  const normalized = value.trim();
  if (normalized.includes(':')) {
    const [minutes, seconds] = normalized.split(':', 2).map(Number);
    if (Number.isFinite(minutes) && Number.isFinite(seconds)) return Math.max(0, minutes * 60 + seconds);
  }
  const numeric = Number(normalized);
  return Number.isFinite(numeric) ? Math.max(0, numeric) : fallback;
}

function createAnnotationId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `annotation-${crypto.randomUUID()}`;
  }
  return `annotation-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function AnnotationsPanel() {
  const documents = useDocumentsStore(state => state.documents);
  const {
    activeCompositionId,
    compositions,
    files,
    sourceMonitorFileId,
  } = useMediaStore(useShallow((state) => ({
    activeCompositionId: state.activeCompositionId,
    compositions: state.compositions,
    files: state.files,
    sourceMonitorFileId: state.sourceMonitorFileId,
  })));
  const {
    clips,
    clipDragPreview,
    playheadPosition,
    primarySelectedClipId,
    selectedClipIds,
    setPlayheadPosition,
    timelineDuration,
  } = useTimelineStore(useShallow((state) => ({
    clips: state.clips,
    clipDragPreview: state.clipDragPreview,
    playheadPosition: state.playheadPosition,
    primarySelectedClipId: state.primarySelectedClipId,
    selectedClipIds: state.selectedClipIds,
    setPlayheadPosition: state.setPlayheadPosition,
    timelineDuration: state.duration,
  })));
  const { requestSourceSeek, sourcePlayback } = useAnnotationStore(useShallow((state) => ({
    requestSourceSeek: state.requestSourceSeek,
    sourcePlayback: state.sourcePlayback,
  })));

  const [text, setText] = useState('');
  const [startValue, setStartValue] = useState('0:00.00');
  const [endValue, setEndValue] = useState('0:02.00');
  const [annotationScope, setAnnotationScope] = useState<'composition' | 'clip'>('composition');

  const sourceFile = sourceMonitorFileId
    ? files.find((file) => file.id === sourceMonitorFileId) ?? null
    : null;
  const composition = !sourceFile && activeCompositionId
    ? compositions.find((candidate) => candidate.id === activeCompositionId) ?? null
    : null;
  const target = sourceFile ?? composition;
  const targetKind = sourceFile ? 'Source' : 'Composition';
  const selectedClipId = primarySelectedClipId && selectedClipIds.has(primarySelectedClipId)
    ? primarySelectedClipId
    : selectedClipIds.size > 0 ? [...selectedClipIds][0] : null;
  const selectedClip = selectedClipId
    ? clips.find((clip) => clip.id === selectedClipId) ?? null
    : null;
  const currentTime = (sourceFile && sourcePlayback?.fileId === sourceFile.id
    ? sourcePlayback.time
    : playheadPosition) ?? 0;
  const duration = (sourceFile
    ? sourcePlayback?.fileId === sourceFile.id
      ? sourcePlayback.duration
      : sourceFile.duration
    : composition?.timelineData?.duration ?? composition?.duration ?? timelineDuration) ?? 0;
  const annotations = useMemo(
    () => (sourceFile?.sourceAnnotations ?? composition?.annotations ?? []).toSorted(
      (left, right) => left.startTime - right.startTime || left.createdAt - right.createdAt,
    ),
    [composition?.annotations, sourceFile?.sourceAnnotations],
  );
  const resolvedAnnotations = useMemo(() => annotations.flatMap((annotation) => {
    if (!composition || annotation.scope !== 'clip' || !annotation.clipId) {
      return [{
        annotation,
        startTime: annotation.startTime,
        endTime: annotation.endTime,
        clipName: null as string | null,
      }];
    }
    const clip = clips.find((candidate) => candidate.id === annotation.clipId);
    if (!clip) return [];
    const clipStartTime = clipDragPreview?.patches[clip.id]?.startTime ?? clip.startTime;
    return [{
      annotation,
      startTime: clipStartTime + annotation.startTime,
      endTime: clipStartTime + annotation.endTime,
      clipName: clip.name,
    }];
  }), [annotations, clipDragPreview, clips, composition]);

  const clipScopeActive = Boolean(composition && annotationScope === 'clip');
  const selectedClipStartTime = selectedClip
    ? clipDragPreview?.patches[selectedClip.id]?.startTime ?? selectedClip.startTime
    : 0;
  const rangeStart = clipScopeActive && selectedClip ? selectedClipStartTime : 0;
  const rangeEnd = clipScopeActive && selectedClip
    ? Math.min(duration, selectedClipStartTime + selectedClip.duration)
    : duration;
  const startTime = Math.max(rangeStart, Math.min(rangeEnd, parseTime(startValue, currentTime)));
  const endTime = Math.max(rangeStart, Math.min(rangeEnd, parseTime(endValue, Math.min(rangeEnd, startTime + 2))));
  const canAdd = Boolean(
    target
    && text.trim()
    && endTime > startTime
    && (!clipScopeActive || selectedClip),
  );

  const updateAnnotations = (nextAnnotations: SourceAnnotation[]) => {
    if (sourceFile) {
      useMediaStore.setState((state) => ({
        files: state.files.map((file) => (
          file.id === sourceFile.id ? { ...file, sourceAnnotations: nextAnnotations } : file
        )),
      }));
      return;
    }
    if (composition) {
      useMediaStore.getState().updateComposition(composition.id, { annotations: nextAnnotations });
    }
  };

  const useCurrentTime = () => {
    const safeStart = Math.min(rangeEnd, Math.max(rangeStart, currentTime));
    setStartValue(formatTime(safeStart));
    setEndValue(formatTime(Math.min(rangeEnd, safeStart + 2)));
  };

  const addAnnotation = () => {
    if (!canAdd) return;
    updateAnnotations([
      ...annotations,
      {
        id: createAnnotationId(),
        text: text.trim(),
        startTime: clipScopeActive && selectedClip ? startTime - selectedClipStartTime : startTime,
        endTime: clipScopeActive && selectedClip ? endTime - selectedClipStartTime : endTime,
        createdAt: Date.now(),
        scope: composition ? annotationScope : undefined,
        clipId: clipScopeActive ? selectedClip?.id : undefined,
      },
    ].toSorted((left, right) => left.startTime - right.startTime || left.createdAt - right.createdAt));
    setText('');
  };

  const seekToAnnotation = (annotationTime: number) => {
    if (sourceFile) {
      requestSourceSeek(sourceFile.id, annotationTime);
      return;
    }
    setPlayheadPosition(annotationTime);
  };

  const releasePointerFocus = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!(event.target instanceof Element)) return;
    const control = event.target.closest('button');
    if (!(control instanceof HTMLElement)) return;
    window.setTimeout(() => {
      if (document.activeElement === control) control.blur();
    }, 0);
  };

  return (
    <div className="annotations-panel" onPointerUpCapture={releasePointerFocus}>
      <header className="annotations-panel-header">
        <div>
          <span className="annotations-panel-eyebrow">{target ? targetKind : 'No target'}</span>
          <h2 title={target?.name}>{target?.name ?? 'Open a source or composition'}</h2>
        </div>
        <span className="annotations-panel-time">{formatTime(currentTime)}</span>
      </header>

      {target ? (
        <>
          <section className="annotations-panel-composer" aria-label="Add annotation">
            {composition && (
              <div className="annotations-panel-scope" role="group" aria-label="Annotation target">
                <button
                  type="button"
                  className={annotationScope === 'composition' ? 'active' : ''}
                  aria-pressed={annotationScope === 'composition'}
                  onClick={() => setAnnotationScope('composition')}
                >
                  Composition
                </button>
                <button
                  type="button"
                  className={annotationScope === 'clip' ? 'active' : ''}
                  aria-pressed={annotationScope === 'clip'}
                  disabled={!selectedClip}
                  title={selectedClip ? `Attach to ${selectedClip.name}` : 'Select a clip first'}
                  onClick={() => setAnnotationScope('clip')}
                >
                  Selected clip
                </button>
              </div>
            )}
            {composition && annotationScope === 'clip' && (
              <div className="annotations-panel-selected-clip">
                {selectedClip ? selectedClip.name : 'Select a clip in the timeline'}
              </div>
            )}
            <textarea
              aria-label="Annotation text"
              onChange={(event) => setText(event.target.value)}
              placeholder="Add a review note for this moment..."
              rows={3}
              value={text}
            />
            <div className="annotations-panel-range">
              <label>
                <span>Start</span>
                <input value={startValue} onChange={(event) => setStartValue(event.target.value)} />
              </label>
              <label>
                <span>End</span>
                <input value={endValue} onChange={(event) => setEndValue(event.target.value)} />
              </label>
            </div>
            <div className="annotations-panel-actions">
              <button type="button" className="annotations-panel-time-button" onClick={useCurrentTime}>
                Use playhead
              </button>
              <button type="button" className="annotations-panel-add-button" disabled={!canAdd} onClick={addAnnotation}>
                Add annotation
              </button>
            </div>
          </section>

          <div className="annotations-panel-list-heading">
            <span>Notes</span>
            <span>{annotations.length}</span>
          </div>
          <div className="annotations-panel-list">
            {resolvedAnnotations.length === 0 ? (
              <div className="annotations-panel-empty">No annotations for this {targetKind.toLowerCase()}.</div>
            ) : resolvedAnnotations.map(({ annotation, startTime: displayStartTime, endTime: displayEndTime, clipName }) => {
              const documentReferences = documents.flatMap(doc => doc.links
                .filter(link => link.target.kind === (sourceFile ? 'source-annotation' : 'composition-annotation')
                  && link.target.annotationId === annotation.id
                  && (sourceFile ? link.target.kind === 'source-annotation' && link.target.mediaId === sourceFile.id
                    : link.target.kind === 'composition-annotation' && link.target.compositionId === composition?.id))
                .map(link => ({ documentId: doc.id, title: doc.title, blockId: link.anchor.blockId })));
              const active = currentTime >= displayStartTime && currentTime <= displayEndTime;
              const scopeLabel = sourceFile
                ? 'Source'
                : annotation.scope === 'clip'
                  ? `Clip${clipName ? ` · ${clipName}` : ''}`
                  : 'Composition';
              return (
                <article className={`annotations-panel-item scope-${annotation.scope ?? (sourceFile ? 'source' : 'composition')}${active ? ' active' : ''}`} key={annotation.id}
                  draggable onDragStart={event => event.dataTransfer.setData('application/x-ms-annotation', JSON.stringify({
                    annotationId: annotation.id,
                    ...(sourceFile ? { mediaId: sourceFile.id } : { compositionId: composition?.id }),
                  }))}>
                  <button type="button" className="annotations-panel-item-main" onClick={() => seekToAnnotation(displayStartTime)}>
                    <span className="annotations-panel-item-scope">{scopeLabel}</span>
                    <span className="annotations-panel-item-range">
                      {formatTime(displayStartTime)} - {formatTime(displayEndTime)}
                    </span>
                    <span className="annotations-panel-item-text">{annotation.text}</span>
                  </button>
                  {documentReferences.length > 0 && <button type="button" title="Show linked document passage"
                    onClick={() => {
                      const chosen = documentReferences.length === 1 ? 0 : Number(window.prompt(
                        documentReferences.map((ref, index) => `${index + 1}. ${ref.title}`).join('\n'), '1',
                      )) - 1;
                      const reference = documentReferences[chosen];
                      if (!reference) return;
                      useDocumentsStore.getState().showAnchor(reference.documentId, reference.blockId);
                      useDockStore.getState().activatePanelType('documents');
                    }}>In document</button>}
                  <button
                    type="button"
                    className="annotations-panel-delete"
                    aria-label="Delete annotation"
                    title="Delete annotation"
                    onClick={() => updateAnnotations(annotations.filter((candidate) => candidate.id !== annotation.id))}
                  >
                    x
                  </button>
                </article>
              );
            })}
          </div>
        </>
      ) : (
        <div className="annotations-panel-placeholder">
          Open a video in the Source Monitor or select a composition to add annotations.
        </div>
      )}
    </div>
  );
}
