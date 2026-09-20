import { readTimelineRuntimeState } from '../../../../services/timeline/timelineRuntimeCoordinator';
import type { NodeGraphNode } from '../../../../types/nodeGraph';
import type { CanvasView } from '../canvas/rendering/nodeCanvasTypes';
import { useTimelineStore } from '../../../../stores/timeline';
import { useLandmarkTrackingStore } from '../../../../stores/landmarkTrackingStore';
import { NodePreviewScheduler } from '../../../../services/nodePreview/NodePreviewScheduler';
import { previewOutput, type PreviewFrame, type PreviewRequest } from '../../../../services/nodePreview/previewTypes';
import { getNodeHeight } from '../canvas/canvasGeometry';
import { previewAtlasTile, previewRect } from './previewGeometry';
import { previewInView } from './NodePreviewPainter';
import { PreviewArtifactReader } from '../../../../services/nodePreview/PreviewArtifactReader';
import { nodePreviewTextureTap } from '../../../../services/nodePreview/NodePreviewTextureTap';

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
  private unsubscribe: () => void;
  private unsubscribeTracking: () => void;
  private sink: Sink;
  private host: HTMLElement;
  private artifacts = new PreviewArtifactReader();
  constructor(sink: Sink, host: HTMLElement) {
    this.sink = sink; this.host = host;
    // Domain readers load after stores finish initialization; they must not pull
    // scene/media runtime owners into the editor's synchronous boot graph.
    const sources = import('../../../../services/nodePreview/previewSources');
    this.scheduler = new NodePreviewScheduler(request => sources.then(({ produceNodePreview }) => produceNodePreview(request, this.artifacts)), frame => sink.preview(frame));
    this.unsubscribe = useTimelineStore.subscribe((state, previous) => {
      if (state.clips !== previous.clips || state.clipKeyframes !== previous.clipKeyframes) this.revision++;
      if (state.isPlaying !== previous.isPlaying || (!state.isPlaying && state.playheadPosition !== previous.playheadPosition)
        || Math.abs(state.playheadPosition - previous.playheadPosition) > 0.5) this.continuity++;
      if (state.playheadPosition !== previous.playheadPosition || state.isPlaying !== previous.isPlaying || state.clips !== previous.clips || state.clipKeyframes !== previous.clipKeyframes) this.wake();
    });
    this.unsubscribeTracking = useLandmarkTrackingStore.subscribe(() => { this.revision++; this.wake(); });
  }
  scene(clipId: string, nodes: NodeGraphNode[], selected: string | null, expanded?: NodeGraphNode[]) {
    if (this.clipId !== clipId) { this.scheduler.invalidate(); this.revision++; }
    this.clipId = clipId; this.nodes = nodes; this.selected = selected; this.wake();
    this.expanded = new Map((expanded ?? nodes).map(node => [node.id, node]));
  }
  viewport(view: CanvasView) { this.view = view; this.wake(); }
  visibility(visible: boolean) { this.visible = visible; this.wake(); }
  reset() { this.scheduler.invalidate(); this.wake(); }
  private wake() { if (!this.disposed && this.timer === undefined) this.timer = setTimeout(() => this.tick(), 0); }
  private tick() {
    this.timer = undefined;
    if (this.disposed) return;
    const state = readTimelineRuntimeState(useTimelineStore), view = this.view, requests: PreviewRequest[] = [];
    if (view && this.visible && !document.hidden && !state.isExporting) {
      const fps = this.sink.software ? 3 : view.zoom < 0.45 ? 5 : 12;
      const width = Math.max(48, Math.min(256, Math.round(164 * view.zoom * Math.min(1.5, view.ratio))));
      const resolution = `${width}:${previewAtlasTile(view.zoom, view.ratio)}`;
      for (const node of this.nodes) {
        if (!node.preview?.enabled) continue;
        const rect = previewRect(getNodeHeight(node), node);
        if (!previewInView({ ...rect, x: rect.x + node.layout.x, y: rect.y + node.layout.y }, view, 0)) continue;
        const port = previewOutput(node, node.preview.portId);
        const endpoint = port?.metadata?.groupEndpoint, inner = endpoint && this.expanded.get(endpoint.nodeId);
        const tiny = rect.width * view.zoom < 32 && node.id !== this.selected;
        requests.push({ key: node.preview.key, revision: `${this.revision}:${tiny ? 'held' : Math.floor(state.playheadPosition * fps)}:${resolution}`,
          continuity: `${this.revision}:${this.continuity}:${resolution}`,
          clipId: this.clipId, node: inner ? { ...inner, preview: node.preview } : node, port: inner ? previewOutput(inner, endpoint?.portId) : port, time: state.playheadPosition, width, height: Math.max(1, Math.min(256, Math.round(width / (node.preview.aspectRatio ?? 16 / 9)))),
          interval: 1000 / fps, priority: node.id === this.selected ? 2 : 0 });
      }
    }
    this.scheduler.setRequests(requests);
    if (!this.sink.previewBusy) this.scheduler.tick();
    if (import.meta.env.DEV) {
      const stats = this.scheduler.stats;
      this.host.dataset.previewStats = JSON.stringify(stats);
    }
    if (!requests.length) { this.artifacts.dispose(); nodePreviewTextureTap.cancelClip(this.clipId); }
    if (requests.length && (state.isPlaying || this.scheduler.unsettled)) this.timer = setTimeout(() => this.tick(), this.sink.software ? 100 : state.isPlaying ? 32 : 100);
  }
  dispose() { this.disposed = true; clearTimeout(this.timer); this.unsubscribe(); this.unsubscribeTracking(); this.scheduler.dispose(); this.artifacts.dispose(); nodePreviewTextureTap.cancelClip(this.clipId); }
}
