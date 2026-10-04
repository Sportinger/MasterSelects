// Preview toolbar, path traced compositions: quality preset and the path tracer's live status.

import { useEffect, useState } from 'react';
import { getPtStatus, subscribePtStatus } from '../../engine/native3d/pathtrace/runtime/ptStatus';
import type { CompositionRenderSettings, PtStatus } from '../../engine/native3d/pathtrace/contracts/ptTypes';
import { updateCompositionRenderSettings } from './compositionRenderSettings';
import { setPtRegionDrawing, usePtRegionDrawing } from './PathTraceRegionOverlay';

/** Still image quality of the path tracer: samples until the image is done, and path length. */
export const PT_QUALITY_PRESETS = [
  { id: 'draft', label: 'Draft', stillSamples: 64, maxBounces: 4 },
  { id: 'standard', label: 'Standard', stillSamples: 256, maxBounces: 8 },
  { id: 'high', label: 'High', stillSamples: 1024, maxBounces: 12 },
] as const;

/** Status updates arrive every frame; the chip refreshes a few times per second. */
const REFRESH_MS = 250;

function usePtStatus(): PtStatus | null {
  const [status, setStatus] = useState<PtStatus | null>(() => getPtStatus('main'));
  useEffect(() => {
    let pending: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = subscribePtStatus(() => {
      pending ??= setTimeout(() => { pending = null; setStatus(getPtStatus('main')); }, REFRESH_MS);
    });
    return () => { unsubscribe(); if (pending) clearTimeout(pending); };
  }, []);
  return status;
}

function statusText(status: PtStatus): string {
  switch (status.state) {
    case 'fallback': return 'Raster fallback';
    case 'realtime': return 'Realtime';
    case 'denoising': return `${status.samples} spp · Denoising`;
    case 'converged': return `${status.samples} spp · Done`;
    case 'converging': return `${status.samples} / ${status.targetSamples} spp`;
    default: return '';
  }
}

export function PreviewPathTraceStatus({ compositionId, settings }: { compositionId: string; settings: CompositionRenderSettings }) {
  const status = usePtStatus();
  const presetIndex = PT_QUALITY_PRESETS.findIndex(preset => preset.stillSamples === settings.stillSamples && preset.maxBounces === settings.maxBounces);
  const preset = presetIndex >= 0 ? PT_QUALITY_PRESETS[presetIndex] : null;
  const next = PT_QUALITY_PRESETS[(presetIndex + 1) % PT_QUALITY_PRESETS.length];
  const fallback = status?.state === 'fallback';
  const drawing = usePtRegionDrawing();
  const hasRegion = !!settings.region;
  return (
    <>
      <button
        type="button"
        className="preview-edit-btn preview-render-quality-btn"
        title={`Path tracing quality ${preset ? preset.label : 'Custom'} (${settings.stillSamples} samples, ${settings.maxBounces} bounces). Click: ${next.label}`}
        aria-label={`Path tracing quality ${preset ? preset.label : 'Custom'}`}
        onClick={() => updateCompositionRenderSettings(compositionId, { stillSamples: next.stillSamples, maxBounces: next.maxBounces })}
      >
        {preset ? preset.label : 'Custom'}
      </button>
      <button
        type="button"
        className={`preview-edit-btn preview-render-region-btn ${drawing || hasRegion ? 'active' : ''}`}
        aria-pressed={drawing || hasRegion}
        title={drawing ? 'Drag over the preview to set the render region (Esc cancels)'
          : hasRegion ? 'Render region active: click to render the whole image again' : 'Render region: refine only part of the still image'}
        onClick={() => {
          if (drawing) setPtRegionDrawing(false);
          else if (hasRegion) updateCompositionRenderSettings(compositionId, { region: undefined });
          else setPtRegionDrawing(true);
        }}
      >
        Region
      </button>
      {status && status.engine === 'path-traced' && (
        <span
          className={`preview-render-status ${fallback ? 'fallback' : ''}`}
          role="status"
          title={fallback ? `Path tracing fell back to raster: ${status.fallbackReason ?? 'unknown reason'}`
            : `${status.renderSize.width} × ${status.renderSize.height} render size, ${(status.gpuBytes / 1048576).toFixed(0)} MB GPU`
              + (status.nsPerSample ? `, ${status.nsPerSample.toFixed(0)} ns per pixel sample` : '')}
        >
          {statusText(status)}
        </span>
      )}
    </>
  );
}
