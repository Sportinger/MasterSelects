import { useExportStore } from '../../../stores/exportStore';
import { useMediaStore } from '../../../stores/mediaStore';
import {
  DEFAULT_EXPORT_RENDER_QUALITY,
  normalizeCompositionRenderSettings,
  normalizeExportRenderQuality,
  type ExportRenderQuality,
  type RenderEngine,
} from '../../../engine/native3d/pathtrace/contracts/ptTypes';
import { InspectorSelect } from '../../inspector/InspectorSelect';
import { LabeledValue } from '../../panels/properties/LabeledValue';
import { ExportInspectorNote, ExportInspectorRow, ExportInspectorSection, ExportInspectorToggle } from './ExportInspectorPrimitives';

type EngineChoice = 'composition' | RenderEngine;

/**
 * Render Quality of the 3D scene in the export (path tracing plan 4.7): the composition's engine or
 * an override, raster sub-samples (jittered pixel, lens, lights and shutter), and for the path tracer
 * samples per pixel, adaptive sampling, a time limit per frame and the AI denoise.
 */
export function ExportRenderQualitySection() {
  const stored = useExportStore(state => state.settings.renderQuality);
  const setSettings = useExportStore(state => state.setSettings);
  const compositionEngine = useMediaStore(state => normalizeCompositionRenderSettings(
    state.compositions.find(item => item.id === state.activeCompositionId)?.renderSettings).engine);
  const quality = normalizeExportRenderQuality(stored ?? DEFAULT_EXPORT_RENDER_QUALITY);
  const update = (patch: Partial<ExportRenderQuality>) => setSettings({ renderQuality: normalizeExportRenderQuality({ ...quality, ...patch }) });
  const engine = quality.engine ?? compositionEngine;
  const field = 'resolve-inspector-field resolve-inspector-field--plain';
  return (
    <ExportInspectorSection defaultOpen={false} target="render-quality-section" title="Render Quality">
      <ExportInspectorRow label="3D Engine" target="render-quality-engine">
        <InspectorSelect<EngineChoice>
          ariaLabel="3D render engine"
          value={quality.engine ?? 'composition'}
          options={[
            { value: 'composition', label: `Composition (${compositionEngine === 'path-traced' ? 'Path Traced' : 'Raster'})` },
            { value: 'raster', label: 'Raster' },
            { value: 'path-traced', label: 'Path Traced' },
          ]}
          onChange={value => update({ engine: value === 'composition' ? undefined : value })}
        />
      </ExportInspectorRow>
      {engine === 'raster' ? (
        <ExportInspectorRow label="Sub-Samples" title="Jittered renders per frame, averaged (pixel, lens, lights, shutter)">
          <LabeledValue label="" ariaLabel="Raster sub-samples per frame" className={field} value={quality.rasterSubSamples}
            defaultValue={DEFAULT_EXPORT_RENDER_QUALITY.rasterSubSamples} min={1} max={256} decimals={0} sensitivity={0.2}
            onChange={value => update({ rasterSubSamples: Math.round(value) })} />
        </ExportInspectorRow>
      ) : (
        <>
          <ExportInspectorRow label="Samples" title="Samples per pixel">
            <LabeledValue label="" ariaLabel="Path traced samples per pixel" className={field} value={quality.samplesPerPixel}
              defaultValue={DEFAULT_EXPORT_RENDER_QUALITY.samplesPerPixel} min={1} max={65536} decimals={0} sensitivity={2}
              onChange={value => update({ samplesPerPixel: Math.round(value) })} />
          </ExportInspectorRow>
          <ExportInspectorRow label="Adaptive" title="Relative error at which a pixel stops sampling; 0 samples every pixel fully">
            <LabeledValue label="" ariaLabel="Adaptive sampling threshold" className={field} value={quality.adaptiveThreshold}
              defaultValue={DEFAULT_EXPORT_RENDER_QUALITY.adaptiveThreshold} min={0} max={1} decimals={3} sensitivity={0.002}
              onChange={value => update({ adaptiveThreshold: value })} />
          </ExportInspectorRow>
          <ExportInspectorRow label="Time Limit" title="Seconds per frame; 0 for no limit">
            <LabeledValue label="" ariaLabel="Time limit per frame in seconds" className={field} value={quality.timeLimitSeconds}
              defaultValue={DEFAULT_EXPORT_RENDER_QUALITY.timeLimitSeconds} min={0} max={3600} decimals={1} suffix="s" sensitivity={0.2}
              onChange={value => update({ timeLimitSeconds: value })} />
          </ExportInspectorRow>
          <ExportInspectorRow label="Denoise">
            <ExportInspectorToggle checked={quality.denoise} label="AI denoise (OIDN)" onChange={denoise => update({ denoise })} />
          </ExportInspectorRow>
          {quality.timeLimitSeconds > 0 && (
            <ExportInspectorNote>A frame that hits the time limit is no longer reproducible bit for bit.</ExportInspectorNote>
          )}
        </>
      )}
    </ExportInspectorSection>
  );
}
