import type { PreviewFrame, PreviewRequest } from './previewTypes';
import type { ResolvedImageGraphExternalResource } from '../../effects/_shared/imageGraphExternalResources';
import { imageOperatorPreviewPrefix, imageOperatorPreviewStage, parseImageOperatorPreviewStage, type ImageOperatorPreviewTarget } from './imageOperatorPreviewStages';

interface Demand { request: PreviewRequest; resolve: (frame: PreviewFrame) => void; timeout: ReturnType<typeof setTimeout> }

/** Runtime-only text channel for typed uint resources. The resource never becomes an RGBA preview. */
class MemoryImageOperatorPreviewTap {
  private readonly demands = new Map<string, Demand>();

  request(target: ImageOperatorPreviewTarget, request: PreviewRequest): Promise<PreviewFrame> {
    const stage = imageOperatorPreviewStage(target);
    if (this.demands.has(stage)) return Promise.resolve(this.frame(request, 'Waiting for memory resource', false));
    return new Promise(resolve => {
      const timeout = setTimeout(() => {
        const demand = this.demands.get(stage);
        if (demand) { this.demands.delete(stage); demand.resolve(this.frame(demand.request, 'Memory resource unavailable', false)); }
      }, 350);
      this.demands.set(stage, { request, resolve, timeout });
      void import('../render/renderHostPort').then(({ renderHostPort }) => renderHostPort.requestRender()).catch(() => {});
    });
  }

  matching(effectId: string) {
    const prefix = imageOperatorPreviewPrefix(effectId);
    return [...this.demands].flatMap(([stage, demand]) => {
      const target = stage.startsWith(prefix) ? parseImageOperatorPreviewStage(stage) : undefined;
      return target ? [{ stage, demand, target }] : [];
    });
  }

  resolve(stage: string, resource: ResolvedImageGraphExternalResource, metadata: boolean) {
    const demand = this.demands.get(stage); if (!demand) return;
    clearTimeout(demand.timeout); this.demands.delete(stage);
    const width = resource.width ?? 0, height = resource.height ?? 0, available = resource.available === true;
    const lines = metadata
      ? [`Available: ${available ? 1 : 0}`, `Word width: ${width}`, `Rows: ${height}`, 'Reserved: 0']
      : ['Raw unsigned 32-bit texture', `Available: ${available ? 'yes' : 'no'}`, `Word width: ${width}`, `Rows: ${height}`];
    demand.resolve({ key: demand.request.key, revision: demand.request.revision, time: demand.request.time,
      status: available ? 'live' : 'missing', label: metadata ? 'Memory metadata' : 'Memory words', presentation: 'text', drawing: { kind: 'text', lines } });
  }

  reject(stage: string, label = 'Memory resource unavailable') {
    const demand = this.demands.get(stage); if (!demand) return;
    clearTimeout(demand.timeout); this.demands.delete(stage);
    demand.resolve(this.frame(demand.request, label, false));
  }

  private frame(request: PreviewRequest, label: string, live: boolean): PreviewFrame {
    return { key: request.key, revision: request.revision, time: request.time, status: live ? 'live' : 'missing', label, presentation: 'text' };
  }
}

const hot = import.meta.hot?.data as { memoryImageOperatorPreviewTap?: MemoryImageOperatorPreviewTap } | undefined;
export const memoryImageOperatorPreviewTap = hot?.memoryImageOperatorPreviewTap ?? new MemoryImageOperatorPreviewTap();
if (hot?.memoryImageOperatorPreviewTap) Object.setPrototypeOf(memoryImageOperatorPreviewTap, MemoryImageOperatorPreviewTap.prototype);
if (import.meta.hot) import.meta.hot.dispose(data => { data.memoryImageOperatorPreviewTap = memoryImageOperatorPreviewTap; });
