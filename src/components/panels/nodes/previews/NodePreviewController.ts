import { readTimelineRuntimeState } from '../../../../services/timeline/timelineRuntimeCoordinator';
import type { NodeGraphNode } from '../../../../types/nodeGraph';
import type { CanvasView } from '../canvas/rendering/nodeCanvasTypes';
import { useTimelineStore } from '../../../../stores/timeline';
import { useLandmarkTrackingStore } from '../../../../stores/landmarkTrackingStore';
import { NodePreviewScheduler } from '../../../../services/nodePreview/NodePreviewScheduler';
import { previewOutput, type PreviewFrame, type PreviewRequest } from '../../../../services/nodePreview/previewTypes';
import { getNodeHeight, NODE_WIDTH } from '../canvas/canvasGeometry';
import { inlineNumericPorts, previewRect } from './previewGeometry';
import { previewInView } from './NodePreviewPainter';
import { PreviewArtifactReader } from '../../../../services/nodePreview/PreviewArtifactReader';
import { nodePreviewTextureTap } from '../../../../services/nodePreview/NodePreviewTextureTap';
import { isTextPreview, previewTextStore } from '../../../../services/nodePreview/previewTextStore';
import { nodeScalarSampleTap } from '../../../../services/nodePreview/NodeScalarSampleTap';
import { scalarPreviewSamples } from '../../../../services/nodePreview/scalarPreviewSamples';

interface Sink { preview: (frame: PreviewFrame) => void; readonly software: boolean; readonly previewBusy: boolean }

/** One clock per workspace; transport stays outside React and transfers no graph on playback. */
export class NodePreviewController {
  private scheduler: NodePreviewScheduler;
  private nodes: NodeGraphNode[] = [];
  private expanded = new Map<string, NodeGraphNode>();
  private view?: CanvasView;
  private clipId = '';
  private selected: string | null = null;
  private visible = true;
  private timer?: ReturnType<typeof setTimeout>;
  private disposed = false;
  private revision = 0;
  private continuity = 0;
  private textKeys = new Set<string>();
  private unsubscribe: () => void;
  private unsubscribeTracking: () => void;
  private unsubscribeValues: () => void;
  private sink: Sink;
  private host: HTMLElement;
  private artifacts = new PreviewArtifactReader();
  private producerStats = { calls: 0, totalMs: 0, maxMs: 0 };
  private produce?: typeof import('../../../../services/nodePreview/previewSources').produceNodePreview;
  constructor(sink: Sink, host: HTMLElement) {
    this.sink = sink; this.host = host;
    // Domain readers load after stores finish initialization; they must not pull
    // scene/media runtime owners into the editor's synchronous boot graph.
    void import('../../../../services/nodePreview/previewSources').then(sources => {
      if (this.disposed) return;
      this.produce = sources.produceNodePreview; this.wake();
    }, () => {
      if (this.disposed) return;
      this.produce = () => { throw new Error('Preview sources unavailable'); }; this.wake();
    });
    // Once loaded, invoke directly inside the scheduler's work budget. Wrapping
    // every call in sources.then() hid synchronous graph compilation in later
    // microtasks and let a whole batch monopolize the main thread unchecked.
    this.scheduler = new NodePreviewScheduler(request => {
      const start = import.meta.env.DEV ? performance.now() : 0;
      try { return this.produce!(request, this.artifacts); }
      finally {
        if (import.meta.env.DEV) {
          const elapsed = performance.now() - start;
          this.producerStats.calls++; this.producerStats.totalMs += elapsed; this.producerStats.maxMs = Math.max(this.producerStats.maxMs, elapsed);
        }
      }
    }, frame => {
      const previous = previewTextStore.get(frame.key);
      previewTextStore.publish(frame);
      if (!isTextPreview(frame)) { this.textKeys.delete(frame.key); sink.preview(frame); }
      else if (!this.textKeys.has(frame.key) || previous !== previewTextStore.get(frame.key)) {
        this.textKeys.add(frame.key);
        sink.preview({ ...frame, presentation: 'text' });
      }
    });
    this.unsubscribe = useTimelineStore.subscribe((state, previous) => {
      if (state.clips !== previous.clips || state.clipKeyframes !== previous.clipKeyframes) this.revision++;
      if (state.isPlaying !== previous.isPlaying || (!state.isPlaying && state.playheadPosition !== previous.playheadPosition)
        || Math.abs(state.playheadPosition - previous.playheadPosition) > 0.5) this.continuity++;
      if (state.playheadPosition !== previous.playheadPosition || state.isPlaying !== previous.isPlaying || state.clips !== previous.clips || state.clipKeyframes !== previous.clipKeyframes) this.wake();
    });
    this.unsubscribeTracking = useLandmarkTrackingStore.subscribe(() => { this.revision++; this.wake(); });
    this.unsubscribeValues = scalarPreviewSamples.subscribe(() => { this.scheduler.invalidateValues(); this.wake(); });
  }
  scene(clipId: string, nodes: NodeGraphNode[], selected: string | null, expanded?: NodeGraphNode[]) {
    if (this.clipId !== clipId) { this.scheduler.invalidate(); this.revision++; }
    this.clipId = clipId; this.nodes = nodes; this.selected = selected; this.wake();
    const retained = new Set(nodes.filter(node => node.preview?.enabled).map(node => node.preview!.key));
    previewTextStore.retain(this, retained);
    for (const key of this.textKeys) if (!retained.has(key)) this.textKeys.delete(key);
    this.expanded = new Map((expanded ?? nodes).map(node => [node.id, node]));
  }
  viewport(view: CanvasView) { this.view = view; this.wake(); }
  visibility(visible: boolean) { this.visible = visible; this.wake(); }
  reset() { this.textKeys.clear(); this.scheduler.invalidate(); this.wake(); }
  private wake() { if (!this.disposed && this.timer === undefined) this.timer = setTimeout(() => this.tick(), 0); }
  private tick() {
    this.timer = undefined;
    if (this.disposed) return;
    const state = readTimelineRuntimeState(useTimelineStore), view = this.view, requests: PreviewRequest[] = [];
    if (view && this.visible && !document.hidden && !state.isExporting) {
      const fps = this.sink.software ? 3 : view.zoom < 0.45 ? 5 : 12;
      const width = Math.max(48, Math.min(256, Math.round(164 * view.zoom * Math.min(1.5, view.ratio))));
      for (const node of this.nodes) {
        if (!node.preview?.enabled) continue;
        const rect = previewRect(getNodeHeight(node), node);
        const bounds = inlineNumericPorts(node) ? { ...node.layout, width: NODE_WIDTH, height: getNodeHeight(node) }
          : { ...rect, x: rect.x + node.layout.x, y: rect.y + node.layout.y };
        if (!previewInView(bounds, view, 0)) continue;
        const port = previewOutput(node, node.preview.portId);
        const endpoint = port?.metadata?.groupEndpoint, inner = endpoint && this.expanded.get(endpoint.nodeId);
        const tiny = rect.width * view.zoom < 32 && node.id !== this.selected;
        const numeric = inlineNumericPorts(node) || this.textKeys.has(node.preview.key);
        // Zoom changes presentation, not content. Keep paused images and values
        // cached; the next content update uses the latest requested resolution.
        requests.push({ key: node.preview.key, revision: `${this.revision}:${state.isPlaying ? tiny ? 'held' : Math.floor(state.playheadPosition * fps) : state.playheadPosition}`,
          continuity: `${this.revision}:${this.continuity}`,
          clipId: this.clipId, node: inner ? { ...inner, preview: node.preview } : node, port: inner ? previewOutput(inner, endpoint?.portId) : port, time: state.playheadPosition, width, height: Math.max(1, Math.min(256, Math.round(width / (node.preview.aspectRatio ?? 16 / 9)))),
          numeric, interval: numeric ? 16 : 1000 / fps, priority: node.id === this.selected ? 2 : 0 });
      }
    }
    this.scheduler.setRequests(requests);
    if (this.produce && !this.sink.previewBusy) this.scheduler.tick();
    if (import.meta.env.DEV) {
      const stats = this.scheduler.stats;
      this.host.dataset.previewStats = JSON.stringify(stats);
      this.host.dataset.previewProducerStats = JSON.stringify(this.producerStats);
    }
    if (!requests.length) { this.artifacts.dispose(); nodePreviewTextureTap.cancelClip(this.clipId); }
    if (requests.length && (state.isPlaying || this.scheduler.unsettled)) this.timer = setTimeout(() => this.tick(), requests.some(request => request.numeric) ? 16 : this.sink.software ? 100 : state.isPlaying ? 32 : 100);
  }
  dispose() { this.disposed = true; clearTimeout(this.timer); this.unsubscribe(); this.unsubscribeTracking(); this.unsubscribeValues(); this.scheduler.dispose(); this.artifacts.dispose(); nodePreviewTextureTap.cancelClip(this.clipId); nodeScalarSampleTap.cancelClip(this.clipId); scalarPreviewSamples.cancelClip(this.clipId); previewTextStore.retain(this, new Set()); }
}
