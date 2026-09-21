import { useState } from 'react';
import { bakeFaceStabilization } from '../../../services/landmarkTracking/bakeFaceStabilization';
import { useLandmarkTrackingStore } from '../../../stores/landmarkTrackingStore';
import type { FaceStabilizationTarget } from '../../../services/landmarkTracking/faceStabilization';
import { ResolveInspectorRow } from './resolveInspector/ResolveInspectorPrimitives';

export function FaceStabilizationControls({ clipId, disabled }: { clipId: string; disabled: boolean }) {
  const [lockCenter, setLockCenter] = useState(true);
  const [message, setMessage] = useState('');
  const run = (target: FaceStabilizationTarget) => {
    try {
      const frames = bakeFaceStabilization(clipId, target, lockCenter, useLandmarkTrackingStore.getState().faceSmoothing);
      setMessage(`${target === 'face' ? 'Face' : 'Lips'} stabilized · ${frames} frames · Undo available`);
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
  };
  return <>
    <ResolveInspectorRow label="Stabilize"><label className="tracking-panel-check"><input type="checkbox" checked={lockCenter} onChange={event => setLockCenter(event.target.checked)} />Lock center</label></ResolveInspectorRow>
    <div className="tracking-panel-actions">
      <button type="button" disabled={disabled} onClick={() => run('face')}>Stabilize face</button>
      <button type="button" disabled={disabled} onClick={() => run('lips')}>Stabilize lips</button>
    </div>
    {message && <output className="tracking-panel-status" aria-live="polite">{message}</output>}
  </>;
}
