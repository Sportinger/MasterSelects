import { useContext, useRef } from 'react';
import { TextSelectionContext } from './TextSelectionContext';
import { captureTextNumberGesture, editTextNumber, type TextNumberGesture } from './textSelectionEditing';
import { useTimelineStore } from '../../../stores/timeline';
import { interpolateKeyframes } from '../../../utils/keyframeInterpolation';
import { TEXT_NUMERIC_PARAMETERS, type TextNumericParameter } from '../../../services/text/textAnimation';
import { ResolveInspectorNumberRow } from './resolveInspector/ResolveInspectorNumberRow';
import { TextSelectionKeyframeToggle } from './TextSelectionKeyframeToggle';

export function TextAnimatedNumberRow({ clipId, parameter, baseValue, defaultValue, disabled = false, animatable = true }: {
  clipId: string; parameter: TextNumericParameter; baseValue: number; defaultValue: number; disabled?: boolean; animatable?: boolean;
}) {
  const selection = useContext(TextSelectionContext);
  const gesture = useRef<TextNumberGesture | null>(null);
  const property = `text.${parameter}` as const, definition = TEXT_NUMERIC_PARAMETERS[parameter];
  const value = useTimelineStore(state => {
    const clip = state.clips.find(item => item.id === clipId);
    return !animatable ? baseValue : interpolateKeyframes(state.clipKeyframes.get(clipId) ?? [], property,
      Math.max(0, Math.min(clip?.duration ?? 0, state.playheadPosition - (clip?.startTime ?? 0))), baseValue);
  });
  const locked = useTimelineStore(state => state.isExporting || state.tracks.some(track => track.locked
    && track.id === state.clips.find(clip => clip.id === clipId)?.trackId));
  const sliderMin = 'sliderMin' in definition ? definition.sliderMin : definition.min;
  const sliderMax = 'sliderMax' in definition ? definition.sliderMax : definition.max;
  return <ResolveInspectorNumberRow label={definition.label} value={value} defaultValue={defaultValue}
    min={sliderMin} max={sliderMax} numberMin={definition.min} numberMax={definition.max}
    hardMin={definition.min} hardMax={definition.max} step={definition.step}
    disabled={disabled || locked}
    onDragStart={() => { gesture.current = captureTextNumberGesture(useTimelineStore.getState(), clipId, selection, parameter, animatable); }}
    onDragEnd={() => { gesture.current = null; }}
    onChange={next => {
      if (disabled || locked) return;
      editTextNumber(useTimelineStore.getState(), clipId, selection, parameter, next, animatable, gesture.current);
    }} keyframeToggle={animatable && !disabled && !locked ? <TextSelectionKeyframeToggle clipId={clipId} parameter={parameter} value={value} /> : undefined} />;
}
