import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type KeyboardEvent,
  type RefObject,
} from 'react';
import { layerBuilder } from '../../services/layerBuilder';
import {
  getCaptionWordEditSnapshot,
} from '../../services/captions/captionTextRuntime';
import { deleteCaptionTimelineRange } from '../../services/captions/captionTimelineEditing';
import { createCaptionTimelineTranscript } from '../../services/captions/captionTimelineTranscript';
import {
  correctTranscriptWordFromCaption,
  getTranscriptWordForCaptionEdit,
} from '../../services/transcription/artifactPersistence';
import { renderHostPort } from '../../services/render/renderHostPort';
import { useTimelineStore } from '../../stores/timeline';
import type { TextClipProperties } from '../../types/text';
import type { OverlayPoint } from './editModeOverlayMath';
import {
  buildTextEditorGeometry,
  distance,
  sourcePointFromContainer,
} from './textPreview/textPreviewGeometry';
import type { EditorGeometry } from './textPreview/textPreviewTypes';

interface CaptionWordPreviewEditorProps {
  canvasInContainer: { x: number; y: number; width: number; height: number };
  canvasSize: { width: number; height: number };
  canvasWrapperRef: RefObject<HTMLDivElement | null>;
  effectiveResolution: { width: number; height: number };
  enabled: boolean;
  overlayRef: RefObject<HTMLCanvasElement | null>;
  viewZoom: number;
}

interface WordEditorState {
  clipId: string;
  draft: string;
  error?: string;
  geometry: EditorGeometry;
  rect: { x: number; y: number; width: number; height: number };
  sourceClipId: string;
  textProperties: TextClipProperties;
  timelineEnd: number;
  timelineStart: number;
  wordId: string;
}

function containsPoint(
  rect: { x: number; y: number; width: number; height: number },
  point: OverlayPoint,
  padding: number,
): boolean {
  return point.x >= rect.x - padding
    && point.x <= rect.x + rect.width + padding
    && point.y >= rect.y - padding
    && point.y <= rect.y + rect.height + padding;
}

function createEditorStyle(editor: WordEditorState): CSSProperties {
  const { geometry, rect, textProperties } = editor;
  const topLeft = geometry.projectSourcePoint(rect.x, rect.y);
  const topRight = geometry.projectSourcePoint(rect.x + rect.width, rect.y);
  const bottomLeft = geometry.projectSourcePoint(rect.x, rect.y + rect.height);
  const baseWidth = Math.max(24, distance(topLeft, topRight));
  const height = Math.max(18, distance(topLeft, bottomLeft));
  const fontSize = Math.max(11, textProperties.fontSize * geometry.scaleY);
  const estimatedDraftWidth = Math.max(
    baseWidth,
    editor.draft.length * fontSize * 0.64 + 10,
  );
  const strokeWidth = textProperties.strokeEnabled
    ? Math.max(0, textProperties.strokeWidth * geometry.scaleY)
    : 0;

  return {
    left: topLeft.x,
    top: topLeft.y,
    width: estimatedDraftWidth,
    height,
    transform: `rotate(${geometry.rotation}rad)`,
    transformOrigin: '0 0',
    fontFamily: textProperties.fontFamily,
    fontSize,
    fontStyle: textProperties.fontStyle,
    fontWeight: textProperties.fontWeight,
    letterSpacing: textProperties.letterSpacing * geometry.scaleX,
    lineHeight: `${height}px`,
    color: textProperties.color,
    WebkitTextStroke: strokeWidth > 0
      ? `${strokeWidth}px ${textProperties.strokeColor}`
      : undefined,
  };
}

export function CaptionWordPreviewEditor({
  canvasInContainer,
  canvasSize,
  canvasWrapperRef,
  effectiveResolution,
  enabled,
  overlayRef,
  viewZoom,
}: CaptionWordPreviewEditorProps) {
  const clips = useTimelineStore(state => state.clips);
  const layers = useTimelineStore(state => state.layers);
  const tracks = useTimelineStore(state => state.tracks);
  const playheadPosition = useTimelineStore(state => state.playheadPosition);
  const isPlaying = useTimelineStore(state => state.isPlaying);
  const playbackWarmup = useTimelineStore(state => state.playbackWarmup);
  const selectClip = useTimelineStore(state => state.selectClip);
  const invalidateCache = useTimelineStore(state => state.invalidateCache);
  const editorEnabled = enabled && !isPlaying && !playbackWarmup;
  const inputRef = useRef<HTMLInputElement>(null);
  const cancelledRef = useRef(false);
  const [editor, setEditor] = useState<WordEditorState | null>(null);

  useEffect(() => {
    if (!editor) return;
    window.requestAnimationFrame(() => {
      inputRef.current?.focus({ preventScroll: true });
      inputRef.current?.select();
    });
  }, [editor]);

  useEffect(() => {
    if (editorEnabled) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setEditor(null);
    });
    return () => { cancelled = true; };
  }, [editorEnabled]);

  const openEditorAt = useCallback((event: MouseEvent): boolean => {
    const container = canvasWrapperRef.current?.closest<HTMLElement>('.preview-container');
    if (!editorEnabled || editor || !container) return false;
    const containerBounds = container.getBoundingClientRect();
    const containerPoint = {
      x: event.clientX - containerBounds.left,
      y: event.clientY - containerBounds.top,
    };

    for (const layer of [...layers].reverse()) {
      if (!layer?.visible || layer.opacity <= 0 || !layer.sourceClipId) continue;
      const clip = clips.find(candidate => (
        candidate.id === layer.sourceClipId && candidate.captionProperties
      ));
      const canvas = clip?.source?.textCanvas ?? layer.source?.textCanvas;
      if (!clip?.textProperties || !canvas) continue;
      const snapshot = getCaptionWordEditSnapshot(canvas);
      if (!snapshot) continue;
      const geometry = buildTextEditorGeometry({
        clip,
        layer,
        textProperties: snapshot.textProperties,
        effectiveResolution,
        canvasSize,
        canvasInContainer,
        viewZoom,
      });
      const sourcePoint = sourcePointFromContainer({
        point: containerPoint,
        geometry,
        canvasInContainer,
        canvasSize,
        effectiveResolution,
        layer,
        viewZoom,
      });
      const padding = Math.max(6, snapshot.textProperties.fontSize * 0.12);
      for (const word of snapshot.words) {
        const rect = word.rects.find(candidate => containsPoint(candidate, sourcePoint, padding));
        if (!rect) continue;
        const sourceWord = getTranscriptWordForCaptionEdit(snapshot.sourceClipId, word.id);
        const timelineWord = createCaptionTimelineTranscript({
          captionClip: clip,
          clips,
          tracks,
        }).filter(candidate => (
          candidate.kind === 'word'
          && candidate.sourceClipId === snapshot.sourceClipId
          && candidate.wordId === word.id
        )).toSorted((left, right) => (
          Math.abs(left.timelineStart - playheadPosition)
          - Math.abs(right.timelineStart - playheadPosition)
        ))[0];
        if (!timelineWord || timelineWord.kind !== 'word') continue;
        cancelledRef.current = false;
        setEditor({
          clipId: clip.id,
          draft: sourceWord?.text ?? word.displayText,
          geometry,
          rect,
          sourceClipId: snapshot.sourceClipId,
          textProperties: snapshot.textProperties,
          timelineEnd: timelineWord.timelineEnd,
          timelineStart: timelineWord.timelineStart,
          wordId: word.id,
        });
        selectClip(clip.id, false, true);
        return true;
      }
    }
    return false;
  }, [
    canvasInContainer,
    canvasSize,
    clips,
    canvasWrapperRef,
    editor,
    editorEnabled,
    effectiveResolution,
    layers,
    playheadPosition,
    selectClip,
    tracks,
    viewZoom,
  ]);

  useEffect(() => {
    if (!editorEnabled) return undefined;
    const targets: HTMLElement[] = [];
    if (canvasWrapperRef.current) targets.push(canvasWrapperRef.current);
    if (overlayRef.current) targets.push(overlayRef.current);
    const handleDoubleClick = (event: MouseEvent) => {
      if (event.target === inputRef.current) return;
      if (!openEditorAt(event)) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
    };
    targets.forEach(target => target.addEventListener('dblclick', handleDoubleClick));
    return () => targets.forEach(target => target.removeEventListener('dblclick', handleDoubleClick));
  });

  const commit = useCallback((deleteIfEmpty = false) => {
    if (!editor || cancelledRef.current) return;
    if (!editor.draft.trim()) {
      if (!deleteIfEmpty) {
        cancelledRef.current = true;
        setEditor(null);
        return;
      }
      const deletion = deleteCaptionTimelineRange({
        captionClipId: editor.clipId,
        sourceClipId: editor.sourceClipId,
        timelineStart: editor.timelineStart,
        timelineEnd: editor.timelineEnd,
        label: 'Delete caption word',
      });
      if (!deletion.ok) {
        setEditor(current => current ? { ...current, error: deletion.error } : current);
        window.requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }));
        return;
      }
      cancelledRef.current = true;
      setEditor(null);
      return;
    }
    const result = correctTranscriptWordFromCaption({
      sourceClipId: editor.sourceClipId,
      wordId: editor.wordId,
      text: editor.draft,
    });
    if (!result.ok) {
      setEditor(current => current ? { ...current, error: result.error } : current);
      window.requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }));
      return;
    }
    cancelledRef.current = true;
    setEditor(null);
    invalidateCache();
    layerBuilder.invalidateCache();
    renderHostPort.requestNewFrameRender();
  }, [editor, invalidateCache]);

  const handleChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setEditor(current => current
      ? { ...current, draft: event.target.value, error: undefined }
      : current);
  }, []);

  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      cancelledRef.current = true;
      setEditor(null);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      commit(true);
    }
  }, [commit]);

  if (!editorEnabled || !editor) return null;
  return (
    <div className="preview-caption-word-editor-layer">
      <input
        ref={inputRef}
        className={`preview-caption-word-editor${editor.error ? ' invalid' : ''}`}
        style={createEditorStyle(editor)}
        value={editor.draft}
        aria-label="Caption-Wort bearbeiten"
        aria-invalid={Boolean(editor.error)}
        title={editor.error ?? 'Enter speichert · leer + Enter schneidet · Esc bricht ab'}
        onBlur={() => commit(false)}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onMouseDown={event => event.stopPropagation()}
        onDoubleClick={event => event.stopPropagation()}
      />
    </div>
  );
}
