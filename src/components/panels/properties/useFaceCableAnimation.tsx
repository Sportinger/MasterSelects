import { useEffect, useMemo, useRef } from 'react';
import { useTimelineStore } from '../../../stores/timeline';
import { useHistoryStore } from '../../../stores/historyStore';
import { cableProperty, sampleCableConfig, type CableAnimatedParameter } from '../../../services/faceCables/cableAnimation';
import type { FaceCableConfig } from '../../../services/faceCables/cableData';
import type { Keyframe } from '../../../types/keyframes';

const EMPTY_KEYS: Keyframe[] = [];
export function useFaceCableAnimation(clipId: string, effectId: string, cable: FaceCableConfig,
  dirty: () => void, edit: (patch: Partial<FaceCableConfig>) => void, disabled: boolean) {
  const allKeys = useTimelineStore(state => state.clipKeyframes.get(clipId) ?? EMPTY_KEYS);
  const keys = useMemo(() => allKeys.filter(k => k.property.startsWith(`effect.${effectId}.cable_`)), [allKeys, effectId]);
  const time = useTimelineStore(state => keys.length && !state.isPlaying ? state.playheadPosition : null);
  const previous = useRef(keys);
  useEffect(() => {
    if (previous.current !== keys) { previous.current = keys; dirty(); }
  }, [keys, dirty]);
  const state = useTimelineStore.getState(), clip = state.clips.find(c => c.id === clipId);
  const localTime = Math.max(0, (time ?? state.playheadPosition) - (clip?.startTime ?? 0));
  const values = sampleCableConfig(cable, effectId, keys, localTime);
  const change = (key: CableAnimatedParameter, value: number) => {
    const property = cableProperty(effectId, cable.id, key);
    if (keys.some(k => k.property === property)) {
      useTimelineStore.getState().addKeyframe(clipId, property, value);
      dirty();
    } else edit({ [key]: value });
  };
  const toggle = (key: CableAnimatedParameter, label: string) => {
    const property = cableProperty(effectId, cable.id, key);
    const propertyKeys = keys.filter(k => k.property === property);
    return <button type="button" className={`keyframe-toggle ${propertyKeys.length ? 'has-keyframes' : ''}`}
      disabled={disabled} aria-label={`Add cable keyframe: ${label}`}
      title={`Add ${label} keyframe. Once animated, edits add keys. Right-click removes this parameter's animation.`}
      onClick={() => { useTimelineStore.getState().addKeyframe(clipId, property, values[key] ?? 0); dirty(); }}
      onContextMenu={event => {
        event.preventDefault();
        if (disabled || !propertyKeys.length) return;
        const history = useHistoryStore.getState(), batch = history.startBatch('Remove cable parameter animation');
        try {
          for (const keyframe of propertyKeys) useTimelineStore.getState().removeKeyframe(keyframe.id);
          edit({ [key]: values[key] ?? 0 });
        } finally { if (batch.opened) history.endBatch(); }
      }}>
      <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2 14 8 8 14 2 8Z" fill="none" stroke="currentColor" /></svg>
    </button>;
  };
  return { values, change, toggle };
}
