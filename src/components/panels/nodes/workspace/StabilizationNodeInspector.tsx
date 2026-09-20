import { useState } from 'react';
import type { Keyframe, TimelineClip } from '../../../../types';
import type { NodeGraphNode } from '../../../../types/nodeGraph';
import { useTimelineStore } from '../../../../stores/timeline';
import { useLandmarkTrackingStore } from '../../../../stores/landmarkTrackingStore';
import { startBatch, endBatch } from '../../../../stores/historyStore';
import { bakeFaceStabilization } from '../../../../services/landmarkTracking/bakeFaceStabilization';
import { usePreciseFaceTrack } from '../../../../services/landmarkTracking/usePreciseFaceTrack';
import { isStabilizationKey, isStabilizationProperty, stabilizationStatus } from '../../../../services/landmarkTracking/stabilizationProvenance';
import { requestNodeAnimation } from '../../../../services/nodeGraph/nodeWorkspaceNavigation';
import { STABILIZATION_CURVES_NODE } from '../../../../services/nodeGraph/stabilizationGraphProjection';
import { InspectorSelect } from '../../../inspector/InspectorSelect';
import { ResolveInspectorRow, ResolveInspectorSection } from '../../properties/resolveInspector/ResolveInspectorPrimitives';
import { ResolveInspectorNumberRow } from '../../properties/resolveInspector/ResolveInspectorNumberRow';

const EMPTY: Keyframe[] = [];

export function StabilizationNodeInspector({ clip, node, onOpenProperties }: {
  clip: TimelineClip; node: NodeGraphNode; onOpenProperties: () => void;
}) {
  const bake = clip.nodeGraph?.stabilization?.bake;
  const tracking = usePreciseFaceTrack(clip.id);
  const keys = useTimelineStore(state => state.clipKeyframes.get(clip.id) ?? EMPTY);
  const locked = useTimelineStore(state => state.isExporting || Boolean(state.tracks.find(track => track.id === clip.trackId)?.locked));
  const [target, setTarget] = useState<'face' | 'lips' | ''>(bake?.target ?? '');
  const [lockCenter, setLockCenter] = useState(bake?.lockCenter ?? true);
  const [smoothing, setSmoothing] = useState(bake?.smoothing ?? useLandmarkTrackingStore.getState().faceSmoothing);
  const [message, setMessage] = useState('');
  const curveCount = keys.filter(key => isStabilizationProperty(key.property)).length;
  const status = stabilizationStatus(clip, keys, tracking.createdAt);
  const unsupported = clip.is3D || clip.parentClipId || clip.sourceRect || clip.transform.rotation.x || clip.transform.rotation.y;
  const reason = locked ? 'The clip is locked or exporting.'
    : !tracking.ready ? 'Tracking data is unavailable. Restore or run precise face tracking to bake again.'
    : unsupported ? 'Rebaking requires an unparented 2D clip without crop or X/Y rotation.'
    : !target ? 'Choose Face or Lips for the next bake.' : '';
  const safely = (action: () => void) => {
    try { action(); setMessage(''); } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
  };
  return <div className="operator-parameters" onPointerUp={event => {
    if (event.target instanceof Element) event.target.closest<HTMLButtonElement>('button')?.blur();
  }}>
    <ResolveInspectorSection title="Stabilization" indicator="none">
      <ResolveInspectorRow label="Status"><span>{status}</span></ResolveInspectorRow>
      <ResolveInspectorRow label="Tracking"><span>{tracking.ready ? 'Landmarks available' : 'Unavailable'}</span></ResolveInspectorRow>
      <ResolveInspectorRow label="Target clip"><span>{clip.name}</span></ResolveInspectorRow>
      <ResolveInspectorRow label="Keyframes"><span>{curveCount} · Position X/Y, Rotation Z</span></ResolveInspectorRow>
      <p className="keyframe-node-hint">Landmarks → stabilization → saved transform curves → clip. Playback reads the saved curves. Bake again after changing tracking or settings.</p>
      {!bake && <p className="keyframe-node-hint">This older bake did not record its target or settings. Its original keyframes are preserved.</p>}
      {bake && <>
        <ResolveInspectorRow label="Last target"><span>{bake.target === 'face' ? 'Face' : 'Lips'}</span></ResolveInspectorRow>
        <ResolveInspectorRow label="Last bake"><span>{new Date(bake.bakedAt).toLocaleString()}</span></ResolveInspectorRow>
        <ResolveInspectorRow label="Samples"><span>{bake.detectedSamples} detected / {bake.sampleCount}</span></ResolveInspectorRow>
      </>}
      <button type="button" className="node-workspace-secondary-action" disabled={!curveCount}
        onClick={() => requestNodeAnimation(clip.id, node.animation?.channels.length ? node.id : STABILIZATION_CURVES_NODE)}>Edit transform curves</button>
      <button type="button" className="node-workspace-secondary-action" onClick={onOpenProperties}>Open clip properties</button>
    </ResolveInspectorSection>
    <ResolveInspectorSection title="Apply baked stabilization" enabled={clip.videoInspectorSections?.stabilization !== false}
      onEnabledChange={locked || !keys.some(isStabilizationKey) ? undefined : enabled => safely(() => {
        const state = useTimelineStore.getState();
        const current = state.clips.find(candidate => candidate.id === clip.id);
        if (!current || state.isExporting || state.tracks.find(track => track.id === current.trackId)?.locked) throw new Error('The clip is locked or exporting.');
        const batch = startBatch('Toggle baked stabilization');
        try { state.updateClip(clip.id, { videoInspectorSections: { ...current.videoInspectorSections, stabilization: enabled } }); }
        finally { if (batch.opened) endBatch(); }
      })}>
      <p className="keyframe-node-hint">Bypass keeps the baked keys, manual transforms and zoom.</p>
    </ResolveInspectorSection>
    {node.binding?.kind === 'clip-stabilization' && node.binding.stage === 'solve' && <ResolveInspectorSection title="Next bake" indicator="none">
      <ResolveInspectorRow label="Target"><InspectorSelect ariaLabel="Stabilization target" value={target} disabled={locked}
        options={[{ value: '', label: 'Choose target…' }, { value: 'face', label: 'Face' }, { value: 'lips', label: 'Lips' }]}
        onChange={value => setTarget(value as 'face' | 'lips' | '')} /></ResolveInspectorRow>
      <ResolveInspectorRow label="Center"><InspectorSelect ariaLabel="Stabilization center" value={lockCenter ? 'lock' : 'keep'} disabled={locked}
        options={[{ value: 'lock', label: 'Lock to image center' }, { value: 'keep', label: 'Keep tracked position' }]}
        onChange={value => setLockCenter(value === 'lock')} /></ResolveInspectorRow>
      <ResolveInspectorNumberRow label="Smoothing" ariaLabel="Stabilization smoothing" value={smoothing} defaultValue={0}
        min={0} max={1} hardMin={0} hardMax={1} step={0.01} disabled={locked} onChange={setSmoothing} />
      <p className="keyframe-node-hint">Bake replaces the clip’s Position X/Y and Rotation Z keys. Undo restores the previous curves and bake settings.</p>
      <button type="button" className="node-workspace-primary-action" disabled={!!reason} title={reason || 'Recalculate the saved transform curves'}
        onClick={() => safely(() => { if (target) bakeFaceStabilization(clip.id, target, lockCenter, smoothing); })}>Bake stabilization</button>
      {reason && <p className="keyframe-node-hint">{reason}</p>}
    </ResolveInspectorSection>}
    {message && <p className="keyframe-node-hint" role="alert">{message}</p>}
  </div>;
}
