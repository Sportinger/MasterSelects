import { useMemo } from 'react';

import { endBatch, startBatch } from '../../../stores/historyStore';
import { useTimelineStore } from '../../../stores/timeline';
import type { BlendMode } from '../../../types';
import { DraggableNumber, KeyframeToggle } from './shared';
import { formatBlendModeName } from './sharedConstants';
import { getMotionAdjustmentDiagnostics } from './motionAdjustmentDiagnostics';
import { getRenderHostDevMode, type RenderHostDevMode } from '../../../services/render/renderHostPort';

const ADJUSTMENT_BLEND_MODES = [
  'normal',
  'multiply',
  'screen',
  'overlay',
  'add',
] as const satisfies readonly BlendMode[];

/** Render host modes whose worker presenter draws adjustment layers itself. */
const WORKER_RENDER_MODES: ReadonlySet<RenderHostDevMode> = new Set<RenderHostDevMode>(['worker-presenting', 'worker-only', 'worker-gpu-only']);

interface MotionAdjustmentTabProps {
  clipId: string;
  opacity: number;
  blendMode: BlendMode;
}

export function MotionAdjustmentTab({
  clipId,
  opacity,
  blendMode,
}: MotionAdjustmentTabProps) {
  const clip = useTimelineStore((state) => state.clips.find((candidate) => candidate.id === clipId));
  const diagnostics = useMemo(
    () => getMotionAdjustmentDiagnostics(clipId, clip?.effects ?? [], blendMode,
      { workerRenderMode: WORKER_RENDER_MODES.has(getRenderHostDevMode() ?? 'main') }),
    [blendMode, clip?.effects, clipId],
  );
  const setPropertyValue = useTimelineStore((state) => state.setPropertyValue);
  const updateClipTransform = useTimelineStore((state) => state.updateClipTransform);

  if (!clip || clip.source?.type !== 'motion-adjustment') {
    return null;
  }

  const opacityPercent = Math.max(0, Math.min(100, opacity * 100));

  return (
    <div
      className="properties-tab-content transform-tab-compact"
      data-guided-properties-tab="adjustment"
      data-guided-target="properties-tab:adjustment"
    >
      <div className="properties-section">
        <div className="control-row transform-option-row">
          <label className="prop-label" htmlFor={`adjustment-blend-${clipId}`}>Blend</label>
          <select
            id={`adjustment-blend-${clipId}`}
            value={blendMode}
            onChange={(event) => updateClipTransform(clipId, {
              blendMode: event.target.value as (typeof ADJUSTMENT_BLEND_MODES)[number],
            })}
          >
            {ADJUSTMENT_BLEND_MODES.map((mode) => (
              <option key={mode} value={mode}>{formatBlendModeName(mode)}</option>
            ))}
          </select>
        </div>

        <div className="control-row transform-param-row">
          <KeyframeToggle clipId={clipId} property="opacity" value={opacity} />
          <label className="prop-label">Opacity</label>
          <DraggableNumber
            value={opacityPercent}
            onChange={(value) => setPropertyValue(
              clipId,
              'opacity',
              Math.max(0, Math.min(100, value)) / 100,
            )}
            defaultValue={100}
            decimals={1}
            suffix="%"
            min={0}
            max={100}
            sensitivity={1}
            onDragStart={() => startBatch('Adjust adjustment opacity')}
            onDragEnd={() => endBatch()}
          />
        </div>
      </div>

      <div className="properties-section">
        <div className="section-header">Adjustment 1.0</div>
        <div
          className={`analysis-status ${diagnostics.compatible && !diagnostics.bypassed ? 'ready' : 'error'}`}
          role="status"
          data-testid="motion-adjustment-diagnostics"
        >
          <strong>{!diagnostics.compatible ? 'Render blocked' : diagnostics.bypassed ? 'Effects bypassed' : 'Render compatible'}</strong>
          <span>{diagnostics.message}</span>
        </div>
        <p className="property-hint">
          Every video effect processes the composite below, except the few that need a source clip of
          their own; their cards say why and they are bypassed. Adjustment transforms and color
          correction stay disabled so preview and export cannot diverge.
        </p>
      </div>
    </div>
  );
}
