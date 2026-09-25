import { readTimelineRuntimeState } from '../../../../services/timeline/timelineRuntimeCoordinator';
import type { NodeGraphNode } from '../../../../types/nodeGraph';
import type { TimelineClip } from '../../../../types/timeline';
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

// Fold state, placement and viewer toggles are graph presentation. Writing them
// replaces the clip object but never changes a rendered or sampled value.
const PRESENTATION_GRAPH_KEYS = new Set(['groups', 'canvasPlacements', 'previews', 'updatedAt']);
function differsBeyond<T extends object>(a: T, b: T, ignored: (key: string) => boolean) {
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (!ignored(key) && (a as Record<string, unknown>)[key] !== (b as Record<string, unknown>)[key]) return true;
  }
  return false;
}
// Card positions inside an effect graph are presentation, like canvas placement.
function effectsContentChanged(previous: TimelineClip['effects'], next: TimelineClip['effects']) {
  if (previous === next) return false;
  if (!previous || !next || previous.length !== next.length) return true;
  return next.some((effect, index) => {
    const before = previous[index];
    if (before === effect) return false;
    if (differsBeyond(before, effect, key => key === 'operatorGraph')) return true;
    const a = before.operatorGraph, b = effect.operatorGraph;
    return a !== b && (!a || !b || differsBeyond(a, b, key => key === 'layout'));
  });
}
function clipContentChanged(previous: TimelineClip, next: TimelineClip) {
  if (previous === next) return false;
  if (previous.id !== next.id || differsBeyond(previous, next, key => key === 'nodeGraph' || key === 'effects')) return true;
  if (effectsContentChanged(previous.effects, next.effects)) return true;
  const a = previous.nodeGraph, b = next.nodeGraph;
  return a !== b && (!a || !b || differsBeyond(a, b, key => PRESENTATION_GRAPH_KEYS.has(key)));
}
function clipsContentChanged(previous: readonly TimelineClip[], next: readonly TimelineClip[]) {
  return previous.length !== next.length || next.some((clip, index) => clipContentChanged(previous[index], clip));
}

interface Sink { preview: (frame: PreviewFrame) => void; readonly software: boolean; readonly previewBusy: boolean; onPreviewsEvicted?: (keys: string[]) => void }

/** One clock per workspace; transport stays outside React and transfers no graph on playback. */
export class NodePreviewController {
  private scheduler: NodePreviewScheduler;
  private nodes: NodeGraphNode[] = [];
  private expanded = new Map<string, NodeGraphNode>();
  private view?: CanvasView;
  private clipId = '';
  private selected: string | null = null;
  private visible = true;
  private suspended = false;
  private timer?: ReturnType<typeof setTimeout>;
  private backoffTimer = false;
  private disposed = false;
  private revision = 0;
  private continuity = 0;
  private textKeys = new Set<string>();
  /** Highest request width already rendered for each preview's current content. */
  private resolved = new Map<string, { content: string; tier: number }>();
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
    sink.onPreviewsEvicted = keys => { this.scheduler.forget(keys); this.wake(); };
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
      if ((state.clips !== previous.clips && clipsContentChanged(previous.clips, state.clips)) || state.clipKeyframes !== previous.clipKeyframes) this.revision++;
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
    for (const key of this.resolved.keys()) if (!retained.has(key)) this.resolved.delete(key);
    this.scheduler.retain(retained);
    this.expanded = new Map((expanded ?? nodes).map(node => [node.id, node]));
  }
  viewport(view: CanvasView) { this.view = view; this.wake(); }
  visibility(visible: boolean) { this.visible = visible; this.wake(); }
  /** Keep the last thumbnails while folding; first-time shader work resumes once
   * cards settle instead of competing with each animation frame. */
  suspend(suspended: boolean) {
    if (this.suspended === suspended) return;
    this.suspended = suspended;
    if (suspended) {
      this.scheduler.setRequests([]);
      nodePreviewTextureTap.cancelClip(this.clipId);
      nodeScalarSampleTap.cancelClip(this.clipId);
    }
    this.wake();
  }
  reset() { this.textKeys.clear(); this.resolved.clear(); this.scheduler.invalidate(); this.wake(); }
  private wake() {
    // A retry backoff must not delay fresh content such as a seek or an edit.
    if (this.backoffTimer) { clearTimeout(this.timer); this.timer = undefined; this.backoffTimer = false; }
    if (!this.disposed && this.timer === undefined) this.timer = setTimeout(() => this.tick(), 0);
  }
  private tick() {
    this.timer = undefined; this.backoffTimer = false;
    if (this.disposed) return;
    // Preview compilation competes with the canvas build-up for the main thread;
    // keep current thumbnails and resume once the worker's layout motion settles.
    if (this.host.dataset.workerMotion === 'true') { this.timer = setTimeout(() => this.tick(), 150); return; }
    const state = readTimelineRuntimeState(useTimelineStore), view = this.view, requests: PreviewRequest[] = [];
    if (view && this.visible && !this.suspended && !document.hidden && !state.isExporting) {
      const fps = this.sink.software ? 3 : view.zoom < 0.45 ? 5 : 12;
      // Half-octave buckets: a new tier re-renders at most ~1.4x the needed pixels.
      const needed = 164 * view.zoom * Math.min(1.5, view.ratio);
      const width = Math.max(48, Math.min(256, Math.ceil(2 ** (Math.ceil(Math.log2(Math.max(1, needed)) * 2) / 2))));
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
        // Thumbnails too small to read hold their last frame instead of re-rendering
        // per seek, and zooming across that threshold must not re-render either.
        const resolved = this.resolved.get(node.preview.key);
        const held = tiny && resolved?.content.startsWith(`${this.revision}:`) ? resolved.content : undefined;
        const content = held ?? `${this.revision}:${tiny ? 'held' : state.isPlaying ? Math.floor(state.playheadPosition * fps) : state.playheadPosition}`;
        // Zooming out keeps the sharper cached image; zooming into a higher
        // resolution tier re-renders once instead of magnifying overview pixels.
        const tier = numeric ? width : Math.max(width, resolved?.content === content ? resolved.tier : 0);
        this.resolved.set(node.preview.key, { content, tier });
        requests.push({ key: node.preview.key, revision: numeric ? content : `${content}@${tier}`,
          continuity: `${this.revision}:${this.continuity}`,
          clipId: this.clipId, node: inner ? { ...inner, preview: node.preview } : node, port: inner ? previewOutput(inner, endpoint?.portId) : port, time: state.playheadPosition, width: tier, height: Math.max(1, Math.min(256, Math.round(tier / (node.preview.aspectRatio ?? 16 / 9)))),
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
    if (requests.length && (state.isPlaying || this.scheduler.unsettled)) {
      const cadence = requests.some(request => request.numeric) ? 16 : this.sink.software ? 100 : state.isPlaying ? 32 : 100;
      const delay = state.isPlaying ? cadence : Math.max(cadence, this.scheduler.nextRetryIn());
      this.backoffTimer = delay > cadence;
      this.timer = setTimeout(() => this.tick(), delay);
    }
  }
  dispose() { this.sink.onPreviewsEvicted = undefined; this.disposed = true; clearTimeout(this.timer); this.unsubscribe(); this.unsubscribeTracking(); this.unsubscribeValues(); this.scheduler.dispose(); this.artifacts.dispose(); nodePreviewTextureTap.cancelClip(this.clipId); nodeScalarSampleTap.cancelClip(this.clipId); scalarPreviewSamples.cancelClip(this.clipId); previewTextStore.retain(this, new Set()); }
}
