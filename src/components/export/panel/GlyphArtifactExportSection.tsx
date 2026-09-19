import { useMemo, useState } from 'react';
import { getEffect } from '../../../effects';
import { readActiveCellGrid } from '../../../effects/_shared/cellGrid';
import {
  buildCellGridSvg,
  buildCellGridText,
  buildCellGridWebPack,
  downloadArtifact,
} from '../../../effects/_shared/cellGridArtifacts';
import { useTimelineStore } from '../../../stores/timeline';
import { landmarkRuntime } from '../../../services/landmarkTracking/landmarkRuntime';
import {
  ExportInspectorNote,
  ExportInspectorRow,
  ExportInspectorSection,
  ExportInspectorToggle,
} from './ExportInspectorPrimitives';

function safeName(value: string): string {
  return value.trim().replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '') || 'glyph-artifact';
}

export function GlyphArtifactExportSection() {
  const clips = useTimelineStore((state) => state.clips);
  const selectedClipIds = useTimelineStore((state) => state.selectedClipIds);
  const primarySelectedClipId = useTimelineStore((state) => state.primarySelectedClipId);
  const [columns, setColumns] = useState(96);
  const [trueShape, setTrueShape] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const clipId = primarySelectedClipId && selectedClipIds.has(primarySelectedClipId)
    ? primarySelectedClipId
    : [...selectedClipIds][0] ?? null;
  const clip = clips.find((candidate) => candidate.id === clipId) ?? null;
  const glyphEffect = useMemo(() => clip?.effects.find((effect) => getEffect(effect.type)?.category === 'glyph') ?? null, [clip]);
  if (!glyphEffect) return null;

  const basename = safeName(clip?.name ?? glyphEffect.name ?? 'glyph-artifact');
  const params = glyphEffect.params as Record<string, number | boolean | string>;
  const gridOptions = {
    columns,
    rampPreset: String(params.rampPreset ?? 'standard'),
    customRamp: String(params.customRamp ?? ''),
    invert: params.invert === true,
  };
  const svgOptions = {
    fontFamily: String(params.fontFamily ?? 'ui-monospace, monospace'),
    trueShape,
  };

  const run = async (kind: 'svg' | 'txt' | 'zip') => {
    setBusy(true);
    setStatus(null);
    try {
      const grid = await readActiveCellGrid(gridOptions);
      if (!grid) throw new Error('The active GPU frame is not available for cell-grid readback.');
      if (kind === 'svg') downloadArtifact(new Blob([buildCellGridSvg(grid, svgOptions)], { type: 'image/svg+xml' }), `${basename}.svg`);
      if (kind === 'txt') downloadArtifact(new Blob([buildCellGridText(grid)], { type: 'text/plain' }), `${basename}.txt`);
      if (kind === 'zip') {
        downloadArtifact(await buildCellGridWebPack({
          basename,
          grid,
          svgOptions,
          trackingSidecar: clip ? landmarkRuntime.getSeries(clip.id) ?? undefined : undefined,
        }), `${basename}-web-pack.zip`);
      }
      setStatus(`${kind.toUpperCase()} ready`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Artifact export failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <ExportInspectorSection defaultOpen={false} title="Glyph Artifacts">
      <ExportInspectorRow label="Columns">
        <input
          max={240}
          min={8}
          onChange={event => setColumns(Number(event.target.value))}
          type="number"
          value={columns}
        />
      </ExportInspectorRow>
      <ExportInspectorRow label="Shape">
        <ExportInspectorToggle
          checked={trueShape}
          label="Preserve glyph shape"
          onChange={setTrueShape}
        />
      </ExportInspectorRow>
      <ExportInspectorRow label="Export">
        <div className="export-inspector-button-row">
          <button disabled={busy} onClick={() => void run('svg')} type="button">SVG</button>
          <button disabled={busy} onClick={() => void run('txt')} type="button">TXT</button>
          <button disabled={busy} onClick={() => void run('zip')} type="button">Web Pack</button>
        </div>
      </ExportInspectorRow>
      <ExportInspectorNote>True vector SVG and text from the selected glyph effect.</ExportInspectorNote>
      {status && <p className="export-inspector-status-text" role="status">{status}</p>}
    </ExportInspectorSection>
  );
}
