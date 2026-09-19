import { useState } from 'react';
import { bakeFaceStabilization } from '../../../services/landmarkTracking/bakeFaceStabilization';
import { useLandmarkTrackingStore } from '../../../stores/landmarkTrackingStore';
import type { FaceStabilizationTarget } from '../../../services/landmarkTracking/faceStabilization';

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
    <label><input type="checkbox" checked={lockCenter} onChange={event => setLockCenter(event.target.checked)} />Lock tracked center to image center</label>
    <div className="face-stabilization-actions">
      <button type="button" disabled={disabled} onClick={() => run('face')}>Stabilize face</button>
      <button type="button" disabled={disabled} onClick={() => run('lips')}>Stabilize lips</button>
    </div>
    <span>Bakes position and Z rotation keyframes. Keeps scale; does not correct 3D turns. Missing detections hold the last transform.</span>
    {message && <output aria-live="polite">{message}</output>}
  </>;
}
