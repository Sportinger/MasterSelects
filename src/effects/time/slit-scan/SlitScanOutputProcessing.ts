import type { SlitScanGeometryCapture, SlitScanGeometryCaptureSink } from './geometryCapture';
import { GeometryQueryOutput } from './GeometryQueryOutput';
import { SlitScanSeamSmoothing } from './SlitScanSeamSmoothing';
import { temporalSourceTime } from '../temporalClipSource';
import { setTemporalStatus } from '../temporalResourcePreparation';

interface Owner { query: GeometryQueryOutput; filter: SlitScanSeamSmoothing; bytes: number }
const number = (value: unknown, fallback: number, max: number) => typeof value === 'number' && Number.isFinite(value)
  ? Math.max(0, Math.min(max, value)) : fallback;

/** Owns the complete Slit Scan color boundary before later effects and 3D.
 * This presentation filter never changes time fields, source caches or geometry. */
export class SlitScanOutputProcessing {
  private owners = new Map<string, Owner>();
  process(frame: SlitScanGeometryCapture, capture?: SlitScanGeometryCaptureSink): GPUTextureView {
    const key = JSON.stringify([frame.scopeId, frame.effect.id]), params = frame.effect.params;
    const radius = number(params.seamSmoothing, 0, 8);
    let output = frame;
    if (radius > 0 && frame.source && (params.preview ?? 'result') === 'result' && (params.rgbTimeMode ?? 'linked') === 'linked') {
      const sampler = String(params.geometrySampler || 'history');
      const id = frame.historyResources.find(resource => resource.owner === sampler && resource.part === 'ages')?.id;
      const sampling = id ? frame.resources.get(id)?.temporalSamples : undefined;
      if (sampling?.samples.length) {
        let owner = this.owners.get(key);
        if (!owner) owner = { query: new GeometryQueryOutput('seams'), filter: new SlitScanSeamSmoothing(frame.device), bytes: 0 };
        owner.bytes = frame.width * frame.height * 20;
        this.owners.delete(key); this.owners.set(key, owner);
        const query = owner.query.capture(frame, sampler);
        if (query) output = { ...frame, baseQuery: { samplerId: sampler, view: query }, color: owner.filter.encode(frame.encoder,
          frame.color, query, frame.width, frame.height, sampling, temporalSourceTime(frame.source, frame.source.localTime),
          radius, number(params.seamEdgeProtection, .65, 1), number(params.mix, 1, 1)) };
        setTemporalStatus(`${frame.effect.id}:seams`, query ? 'Source-time seams · ready' : 'Preparing seam time field…');
        // Keep one oversized frame if necessary, never unbounded removed effects.
        let bytes = [...this.owners.values()].reduce((sum, item) => sum + item.bytes, 0);
        for (const [oldKey, old] of this.owners) {
          if (this.owners.size <= 4 && bytes <= 128 * 1024 * 1024) break;
          if (oldKey === key) continue;
          this.release(oldKey); bytes -= old.bytes;
        }
      } else {
        this.release(key);
        setTemporalStatus(`${frame.effect.id}:seams`, 'Seam smoothing needs resolved times for the selected base sampler.');
      }
    } else {
      this.release(key);
      setTemporalStatus(`${frame.effect.id}:seams`, radius > 0 ? 'Seam smoothing applies to Result with linked RGB time.' : '');
    }
    capture?.(output); return output.color;
  }
  private release(key: string): void {
    const owner = this.owners.get(key); if (!owner) return;
    owner.query.destroy(); owner.filter.destroy(); this.owners.delete(key);
  }
  destroy(): void { for (const key of this.owners.keys()) this.release(key); }
}
