import { useContext } from 'react';
import { useTimelineStore } from '../../../stores/timeline';
import type { TextNumericParameter } from '../../../services/text/textAnimation';
import { isParameterNodeDriven } from '../../../services/parameterSources/parameterSourceTargets';
import { TextSelectionContext } from './TextSelectionContext';
import { editTextSelection, getTextEditTargets, sampleTextNumber } from './textSelectionEditing';
import { KeyframeToggle } from './shared';

export function TextSelectionKeyframeToggle({ clipId, parameter, value }: {
  clipId: string; parameter: TextNumericParameter; value: number;
}) {
  const selection = useContext(TextSelectionContext);
  const property = `text.${parameter}` as const;
  const multiple = useTimelineStore(state => getTextEditTargets(state, clipId, selection).length > 1);
  const recording = useTimelineStore(state => getTextEditTargets(state, clipId, selection)
    .some(clip => state.keyframeRecordingEnabled.has(`${clip.id}:${property}`)));
  const hasKeys = useTimelineStore(state => getTextEditTargets(state, clipId, selection)
    .some(clip => state.clipKeyframes.get(clip.id)?.some(key => key.property === property)));
  if (!multiple) return <KeyframeToggle clipId={clipId} property={property} value={value} />;
  const apply = (disable: boolean) => {
    const state = useTimelineStore.getState();
    editTextSelection(state, clipId, selection, clip => {
      if (clip.captionProperties || clip.captionLayerBinding || isParameterNodeDriven(clip, property)) return;
      const current = sampleTextNumber(state, clip, parameter, true);
      if (disable) state.disablePropertyKeyframes(clip.id, property, current);
      else {
        const enableRecording = !state.isRecording(clip.id, property) && !state.hasKeyframes(clip.id, property);
        state.addKeyframe(clip.id, property, current);
        if (enableRecording) state.toggleKeyframeRecording(clip.id, property);
      }
    });
  };
  return <button type="button" className={`keyframe-toggle ${recording ? 'recording' : ''} ${hasKeys ? 'has-keyframes' : ''}`}
    title="Add keyframes to selected text clips (right-click to disable)"
    onClick={event => { event.stopPropagation(); apply(false); if (event.detail > 0) event.currentTarget.blur(); }}
    onContextMenu={event => { event.preventDefault(); event.stopPropagation(); apply(true); }}>
    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="13" r="7" /><path d="M12 13V9M12 2v3M9 3h6" />
    </svg>
  </button>;
}
