import type { TimelineStore } from '../../../stores/timeline/types';
import type { TimelineClip } from '../../../types/timeline';
import type { TextClipProperties } from '../../../types/text';
import { getEditorRepositorySession } from '../../../services/project/repository/transaction/editorMutationRuntime';
import { runEditorGesture, finishEditorGesture } from '../../../services/project/repository/transaction/editorGestureOwnership';
import { startBatch, endBatch } from '../../../stores/historyStore';
import { interpolateKeyframes } from '../../../utils/keyframeInterpolation';
import { TEXT_NUMERIC_PARAMETERS, normalizeTextValue, type TextNumericParameter } from '../../../services/text/textAnimation';
import { isParameterNodeDriven } from '../../../services/parameterSources/parameterSourceTargets';

export type EditableTextClip = TimelineClip & { textProperties: TextClipProperties };

/** Selection expansion belongs to the inspector; single-clip store/tools stay atomic. */
export function getTextEditTargets(state: TimelineStore, clipId: string, selection: boolean): EditableTextClip[] {
  if (state.isExporting) return [];
  const editable = (clip: TimelineClip): clip is EditableTextClip => !!clip.textProperties
    && clip.source?.type === 'text' && !state.tracks.some(track => track.id === clip.trackId && track.locked);
  const primary = state.clips.find(clip => clip.id === clipId);
  if (!primary || !editable(primary)) return [];
  return selection && state.selectedClipIds.has(clipId)
    ? state.clips.filter((clip): clip is EditableTextClip => state.selectedClipIds.has(clip.id) && editable(clip))
    : [primary];
}

export function editTextSelection(
  state: TimelineStore, clipId: string, selection: boolean,
  edit: (clip: EditableTextClip, primary: EditableTextClip) => void,
) {
  const targets = getTextEditTargets(state, clipId, selection);
  const primary = targets.find(clip => clip.id === clipId);
  if (!primary) return;
  const batch = targets.length > 1 ? startBatch('Edit selected text clips') : undefined;
  const repository = getEditorRepositorySession();
  const apply = () => targets.forEach(clip => edit(clip, primary));
  try {
    if (repository && batch?.batchId != null) runEditorGesture(batch.batchId, apply);
    else apply();
  } finally {
    if (batch?.opened) {
      if (repository && batch.batchId !== null) finishEditorGesture(batch.batchId);
      endBatch();
    }
  }
}

export function sampleTextNumber(state: TimelineStore, clip: EditableTextClip, parameter: TextNumericParameter, animatable: boolean) {
  const base = clip.textProperties[parameter] ?? TEXT_NUMERIC_PARAMETERS[parameter].fallback;
  return animatable && !clip.captionProperties && !clip.captionLayerBinding
    ? interpolateKeyframes(state.clipKeyframes.get(clip.id) ?? [], `text.${parameter}`,
      Math.max(0, Math.min(clip.duration, state.playheadPosition - clip.startTime)), base)
    : base;
}

export interface TextNumberGesture {
  clipId: string;
  values: Map<string, number>;
}

export function captureTextNumberGesture(state: TimelineStore, clipId: string, selection: boolean, parameter: TextNumericParameter, animatable: boolean): TextNumberGesture {
  return { clipId, values: new Map(getTextEditTargets(state, clipId, selection)
    .map(clip => [clip.id, sampleTextNumber(state, clip, parameter, animatable)])) };
}

/** Apply a delta from the displayed clip, sampling each clip at its own local time. */
export function editTextNumber(
  state: TimelineStore, clipId: string, selection: boolean, parameter: TextNumericParameter,
  next: number, animatable: boolean, gesture?: TextNumberGesture | null,
) {
  if (!Number.isFinite(next)) return;
  const property = `text.${parameter}` as const;
  const primary = state.clips.find(clip => clip.id === clipId);
  if (!primary || isParameterNodeDriven(primary, property)) return;
  const values = gesture?.clipId === clipId ? gesture.values : undefined;
  editTextSelection(state, clipId, selection, (clip, anchor) => {
    if (isParameterNodeDriven(clip, property)) return;
    const previous = values?.get(anchor.id) ?? sampleTextNumber(state, anchor, parameter, animatable);
    const current = values?.get(clip.id) ?? sampleTextNumber(state, clip, parameter, animatable);
    const value = normalizeTextValue(parameter, current + next - previous);
    if (animatable && !clip.captionProperties && !clip.captionLayerBinding) state.setPropertyValue(clip.id, property, value);
    else state.updateTextProperties(clip.id, { [parameter]: value });
  });
}
