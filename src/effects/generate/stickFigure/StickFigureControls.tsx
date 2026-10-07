import { useState } from 'react';
import type { EffectControlProps } from '../../types';
import type { AnimatableProperty, EasingType } from '../../../types';
import { InspectorSelect } from '../../../components/inspector/InspectorSelect';
import { ResolveInspectorRow, ResolveInspectorSection } from '../../../components/panels/properties/resolveInspector/ResolveInspectorPrimitives';
import { useTimelineStore } from '../../../stores/timeline';
import { endBatch, startBatch } from '../../../stores/historyStore';
import {
  getSkeletonPosePreset,
  SKELETON_ANGLE_KEYS,
  SKELETON_POSE_PRESETS,
  type SkeletonAngleKey,
} from '../../../services/rig/skeletonRig';
import { deleteSkeletonPose, listSkeletonPoses, saveSkeletonPose } from '../../../services/rig/skeletonPoseLibrary';
import { driveStickFigureWithGait } from '../../../services/rig/stickFigureActions';
import { StickFigureActionLane } from './StickFigureActionLane';

const EASINGS: ReadonlyArray<{ value: EasingType; label: string }> = [
  { value: 'ease-in-out', label: 'Ease in-out' }, { value: 'linear', label: 'Linear' },
  { value: 'ease-in', label: 'Ease in' }, { value: 'ease-out', label: 'Ease out' },
];

/** Pose library, colour and one-click gait wiring below the generic Stick Figure parameters. */
export default function StickFigureControls({ params, onChange, clipId = '', effectInstanceId = '' }: EffectControlProps) {
  const [library, setLibrary] = useState(listSkeletonPoses);
  const [poseId, setPoseId] = useState('stand');
  const [easing, setEasing] = useState<EasingType>('ease-in-out');
  const [poseName, setPoseName] = useState('');
  const [message, setMessage] = useState('');
  const ready = Boolean(clipId && effectInstanceId);
  const path = (key: string) => `effect.${effectInstanceId}.${key}` as AnimatableProperty;

  const poseOf = (id: string): Record<SkeletonAngleKey, number> | undefined =>
    getSkeletonPosePreset(id)?.pose ?? library.find(item => item.id === id)?.pose;
  const run = (label: string, action: () => void) => {
    const batch = startBatch(label);
    try { action(); setMessage(''); }
    catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { if (batch.opened) endBatch(); }
  };
  /** The pose that renders at the playhead: keyframes and node sources included. */
  const currentPose = (): Record<SkeletonAngleKey, number> => {
    const state = useTimelineStore.getState();
    const clip = state.clips.find(item => item.id === clipId);
    const localTime = clip ? Math.max(0, Math.min(clip.duration, state.playheadPosition - clip.startTime)) : 0;
    const effect = clip ? state.getInterpolatedEffects(clipId, localTime).find(item => item.id === effectInstanceId) : undefined;
    const values = effect?.params ?? params;
    return Object.fromEntries(SKELETON_ANGLE_KEYS.map(key => [key, Number(values[key] ?? 0)])) as Record<SkeletonAngleKey, number>;
  };
  const applyPose = (keyed: boolean) => {
    const pose = poseOf(poseId);
    if (!pose || !ready) return;
    const state = useTimelineStore.getState();
    run(keyed ? 'Key pose' : 'Apply pose', () => SKELETON_ANGLE_KEYS.forEach(key => {
      if (keyed) state.addKeyframe(clipId, path(key), pose[key], undefined, easing);
      else state.setPropertyValue(clipId, path(key), pose[key]);
    }));
  };

  return (
    <>
      <ResolveInspectorSection title="Pose library" indicator="none">
        <ResolveInspectorRow label="Pose">
          <InspectorSelect
            ariaLabel="Stick figure pose"
            value={poseId}
            groups={[
              { label: 'Built-in', options: SKELETON_POSE_PRESETS.map(preset => ({ value: preset.id, label: preset.name })) },
              ...(library.length ? [{ label: 'Saved', options: library.map(item => ({ value: item.id, label: item.name })) }] : []),
            ]}
            onChange={setPoseId}
          />
        </ResolveInspectorRow>
        <ResolveInspectorRow label="Use">
          <button type="button" className="perspective-action" disabled={!ready}
            title="Set the pose; joints that have keys get a key at the playhead" onClick={() => applyPose(false)}>Apply</button>
          <button type="button" className="perspective-action" disabled={!ready}
            title="Key every joint at the playhead, so poses blend over time" onClick={() => applyPose(true)}>Key pose</button>
        </ResolveInspectorRow>
        <ResolveInspectorRow label="Key easing">
          <InspectorSelect ariaLabel="Pose key easing" value={easing} options={[...EASINGS]} onChange={setEasing} />
        </ResolveInspectorRow>
        <ResolveInspectorRow label="Save">
          <input aria-label="Pose name" placeholder="Pose name" value={poseName}
            onKeyDown={event => event.stopPropagation()} onChange={event => setPoseName(event.target.value)} />
          <button type="button" className="perspective-action" disabled={!poseName.trim() || !ready}
            title="Save the pose shown at the playhead"
            onClick={() => {
              try {
                const next = saveSkeletonPose(poseName, currentPose());
                setLibrary(next); setPoseId(next.at(-1)!.id); setPoseName(''); setMessage('');
              } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
            }}>Save pose</button>
          {library.some(item => item.id === poseId) && (
            <button type="button" className="perspective-action"
              onClick={() => { setLibrary(deleteSkeletonPose(poseId)); setPoseId('stand'); }}>Delete</button>
          )}
        </ResolveInspectorRow>
      </ResolveInspectorSection>
      <ResolveInspectorSection title="Motion" indicator="none">
        <ResolveInspectorRow label="Gait">
          {(['walk', 'run', 'idle'] as const).map(gait => (
            <button key={gait} type="button" className="perspective-action" disabled={!ready}
              title={`Add a Gait Cycle node (${gait}) and connect it to every joint`}
              onClick={() => run(`Drive figure: ${gait}`, () => driveStickFigureWithGait(clipId, effectInstanceId, gait))}>
              {gait[0].toUpperCase() + gait.slice(1)}
            </button>
          ))}
        </ResolveInspectorRow>
        <ResolveInspectorRow label="Color">
          <input type="color" aria-label="Stick figure color" value={String(params.color ?? '#ffffff').slice(0, 7)}
            onChange={event => onChange({ ...params, color: event.target.value })} />
        </ResolveInspectorRow>
      </ResolveInspectorSection>
      {ready && <StickFigureActionLane clipId={clipId} effectId={effectInstanceId} actionsParam={params.actions} />}
      {message && <p className="effect-info" role="status">{message}</p>}
    </>
  );
}
