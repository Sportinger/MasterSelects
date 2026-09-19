import { useTimelineStore } from '../../../stores/timeline';
import { createEffectProperty } from '../../../types/animationProperties';
import type { Keyframe } from '../../../types/keyframes';
import { SHARED_WIND_FIELDS, sharedWindValues, type SharedWindField } from '../../../services/faceCables/cableWind';
import { ResolveInspectorRow, ResolveInspectorSection } from './resolveInspector/ResolveInspectorPrimitives';
import { ResolveInspectorNumberRow } from './resolveInspector/ResolveInspectorNumberRow';

const EMPTY_KEYS: Keyframe[] = [];
export function FaceCableEnvironmentControls({ clipId, effectId, busy, onChange }: {
  clipId: string; effectId: string; busy: boolean; onChange: () => void;
}) {
  const params = useTimelineStore(s => s.clips.find(c => c.id === clipId)?.effects.find(e => e.id === effectId)?.params);
  const keys = useTimelineStore(s => s.clipKeyframes.get(clipId) ?? EMPTY_KEYS);
  const hasAnimation = keys.some(k => k.property.startsWith(`effect.${effectId}.globalWind`));
  const time = useTimelineStore(s => hasAnimation && !s.isPlaying ? s.playheadPosition : null);
  const state = useTimelineStore.getState(), clip = state.clips.find(c => c.id === clipId);
  if (!params || !clip) return null;
  const values = sharedWindValues(params, effectId, keys, (time ?? state.playheadPosition) - clip.startTime);
  const update = (patch: Record<string, boolean | number>) => {
    const current = useTimelineStore.getState(), currentClip = current.clips.find(c => c.id === clipId);
    if (!currentClip) return;
    current.updateClip(clipId, { effects: currentClip.effects.map(e => e.id === effectId ? { ...e, params: { ...e.params, ...patch } } : e) });
    onChange();
  };
  const addKey = (key: SharedWindField, value: number) => {
    useTimelineStore.getState().addKeyframe(clipId, createEffectProperty(effectId, key), value);
    onChange();
  };
  return <ResolveInspectorSection title="Shared wind & face collision">
    <ResolveInspectorRow label="All cables"><label className="face-cable-checks">
      <input type="checkbox" checked={Boolean(params.sharedWind)} disabled={busy} onChange={e => update({ sharedWind: e.target.checked })} />Shared wind
    </label></ResolveInspectorRow>
    <p className="face-cable-hint">Shared wind replaces individual cable wind. 0°: toward camera · 90°: right · 180°: into face.</p>
    {(Object.keys(SHARED_WIND_FIELDS) as SharedWindField[]).map(key => {
      const spec = SHARED_WIND_FIELDS[key], property = createEffectProperty(effectId, key);
      const animated = keys.some(k => k.property === property);
      return <ResolveInspectorNumberRow key={key} label={spec.label} ariaLabel={`Shared wind ${spec.label.toLowerCase()}`}
        value={values[key]} defaultValue={spec.default} min={spec.min} max={spec.max} step={key === 'globalWindGusts' ? 0.05 : 0.1}
        hardMin={key === 'globalWindStrength' || key === 'globalWindGusts' ? 0 : key === 'globalWindPitch' ? -90 : undefined}
        hardMax={key === 'globalWindGusts' ? 1 : key === 'globalWindPitch' ? 90 : undefined}
        disabled={busy || !params.sharedWind} persistenceKey={`face-cables.${effectId}.${key}`}
        onChange={value => animated ? addKey(key, value) : update({ [key]: value })}
        keyframeToggle={<button type="button" className={`keyframe-toggle ${animated ? 'has-keyframes' : ''}`} disabled={busy || !params.sharedWind}
          aria-label={`Add shared wind keyframe: ${spec.label}`} onClick={() => addKey(key, values[key])}>
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2 14 8 8 14 2 8Z" fill="none" stroke="currentColor" /></svg>
        </button>} />;
    })}
    <ResolveInspectorRow label="Face contact"><label className="face-cable-checks">
      <input type="checkbox" checked={Boolean(params.faceCollision)} disabled={busy} onChange={e => update({ faceCollision: e.target.checked })} />Collide with tracked face
    </label></ResolveInspectorRow>
    <p className="face-cable-hint">Approximate tracked front surface, with friction. No cable-to-cable collision. Bake to apply.</p>
  </ResolveInspectorSection>;
}
