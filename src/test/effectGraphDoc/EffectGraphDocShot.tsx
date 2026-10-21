// ?test=effect-graph&effect=<id>[&level=stages|all][&open=<folders>][&focus=<folder>][&chain=1][&cables=avoid]
// Shows an effect's real default operator graph on the Node Workspace canvas, read-only and
// fitted to the window, for docs pictures (scripts/effect-graph-shot.mjs).
import { useCallback, useLayoutEffect, useMemo, useState } from 'react';
import { NodeGraphCanvas } from '../../components/panels/nodes/NodeGraphCanvas';
import { reconcileCanvasPlacement } from '../../components/panels/nodes/canvas/nodeCanvasPlacement';
import { annotatedGraphBounds } from '../../components/panels/nodes/canvas/groupBounds';
import { getNodeHeight, getNodeWidth, getPortCenter } from '../../components/panels/nodes/canvas/canvasGeometry';
import { routeAroundCards } from '../../components/panels/nodes/canvas/cableAvoidance';
import { cableRoute, sampleCableRoute } from '../../components/panels/nodes/canvas/cableRoute';
import { buildCanvasScene } from '../../components/panels/nodes/canvas/rendering/buildCanvasScene';
import { paintedTitleSize } from '../../components/panels/nodes/canvas/rendering/paintNodeCanvas';
import type { NodeGraph } from '../../types/nodeGraph';
import { useTimelineStore } from '../../stores/timeline';
import {
  EFFECT_GRAPH_DOC_CLIP_ID, buildEffectGraphDoc, effectGraphDocTrack, parseEffectGraphDocQuery, type EffectGraphDoc, type EffectGraphDocQuery,
} from './effectGraphDocModel';
import { cableCrossings } from './effectGraphDocLayout';
import '../../components/panels/nodes/NodeWorkspacePanel.css';
import './EffectGraphDocShot.css';

interface EffectGraphDocState { ready: boolean; error?: string; title?: string; nodes?: number; edges?: number;
  bounds?: { width: number; height: number }; folders?: EffectGraphDoc['groups'];
  /** Local node id and title of every card, for `only=`, `break=` and `marks=`. */
  cards?: string[];
  /** How far cables bend out past the cards and frames on each side (graph units): the crop keeps them. */
  overhang?: { left: number; top: number; right: number; bottom: number };
  /** Cables that run through a card other than their two ends ("from → to through card"). */
  crossings?: string[];
  /** Cards the canvas placed elsewhere than the doc layout asked (graph units moved). */
  displaced?: string[] }
/** The fitted canvas zoom and the title size most cards are painted with (graph units), measured after Fit. */
interface EffectGraphDocTitle { zoom: number; titleSize: number }
declare global { interface Window { __effectGraphDoc?: EffectGraphDocState; __effectGraphDocTitle?: () => EffectGraphDocTitle | undefined } }

const noop = () => {};

/** Cables leaving the last card of a wrapped row bend out past the frame before they turn back.
 * With `cableRouting: 'avoid'` the routes around the cards decide instead (as the canvas draws them). */
function cableOverhang(graph: NodeGraph, placed: NodeGraph['nodes'], bounds: { left: number; top: number; right: number; bottom: number }) {
  const byId = new Map(placed.map(node => [node.id, node]));
  const overhang = { left: 0, top: 0, right: 0, bottom: 0 };
  // Plug tips sit 24 units out from the port dots (connectionPlugs.ts).
  const cables = graph.edges.flatMap(edge => {
    const from = byId.get(edge.fromNodeId), to = byId.get(edge.toNodeId);
    if (!from || !to) return [];
    const out = getPortCenter(from, edge.fromPortId, 'output'), into = getPortCenter(to, edge.toPortId, 'input');
    return [{ id: edge.id, from: { x: out.x + 24, y: out.y }, to: { x: into.x - 24, y: into.y } }];
  });
  const routes = graph.cableRouting === 'avoid'
    ? routeAroundCards(placed.map(node => ({ x: node.layout.x, y: node.layout.y, width: getNodeWidth(node), height: getNodeHeight(node) })), cables)
    : undefined;
  for (const cable of cables) {
    for (const point of sampleCableRoute(cableRoute(cable.from, cable.to, 'curved', routes?.get(cable.id)))) {
      overhang.left = Math.max(overhang.left, bounds.left - point.x); overhang.right = Math.max(overhang.right, point.x - bounds.right);
      overhang.top = Math.max(overhang.top, bounds.top - point.y); overhang.bottom = Math.max(overhang.bottom, point.y - bounds.bottom);
    }
  }
  return overhang;
}

function readQuery(): { query?: EffectGraphDocQuery; error?: string } {
  try { return { query: parseEffectGraphDocQuery(window.location.search) }; } catch (error) { return { error: String(error) }; }
}

export function EffectGraphDocShot() {
  const [{ query, error: queryError }] = useState(readQuery);
  // Folder headers stay clickable so a level can be explored before it is put into a URL.
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const result = useMemo(() => {
    if (!query) return { error: queryError };
    try { return { doc: buildEffectGraphDoc(query, overrides) }; } catch (error) { return { error: error instanceof Error ? error.message : String(error) }; }
  }, [query, queryError, overrides]);
  const doc = result.doc;

  // Cards read their clip (and its preview preferences) from the timeline store, as in the Node
  // Workspace. The canvas waits for it: its first placement would otherwise reserve preview space
  // under every card and keep those gaps.
  const storedClip = useTimelineStore(state => state.clips.find(clip => clip.id === EFFECT_GRAPH_DOC_CLIP_ID));
  // The title probe paints the scene as the canvas does, from the same store state.
  const clips = useTimelineStore(state => state.clips);
  const clipKeyframes = useTimelineStore(state => state.clipKeyframes);
  const getSourceTimeForClip = useTimelineStore(state => state.getSourceTimeForClip);
  useLayoutEffect(() => {
    if (doc) useTimelineStore.setState({ clips: [doc.clip], tracks: [effectGraphDocTrack()], clipKeyframes: new Map() });
  }, [doc]);

  useLayoutEffect(() => {
    if (!doc) { window.__effectGraphDoc = { ready: true, error: result.error }; return; }
    const placement = reconcileCanvasPlacement(doc.graph);
    const placed = doc.graph.nodes.map(node => ({ ...node, layout: placement.nodes[node.id] ?? node.layout }));
    const bounds = annotatedGraphBounds(doc.graph, placed);
    const label = (id: string) => placed.find(node => node.id === id)?.label ?? id;
    const crossings = cableCrossings(placed, doc.graph.edges)
      .map(({ edge, card }) => `${label(edge.fromNodeId)} → ${label(edge.toNodeId)} runs through ${card.label}`);
    const displaced = doc.graph.nodes.flatMap(node => {
      const at = placement.nodes[node.id];
      const moved = at ? Math.hypot(at.x - node.layout.x, at.y - node.layout.y) : 0;
      return moved > 1 ? [`${node.label}: ${Math.round(moved)}`] : [];
    });
    window.__effectGraphDocTitle = () => {
      const card = document.querySelector<HTMLElement>('.node-workspace-node[data-node-id]');
      const node = card && placed.find(item => item.id === card.dataset.nodeId);
      const context = new OffscreenCanvas(8, 8).getContext('2d');
      if (!card || !node || !context) return undefined;
      const zoom = card.getBoundingClientRect().width / getNodeWidth(node);
      const scene = buildCanvasScene({ graph: doc.graph, nodes: placed, plugs: [], selection: new Set(), selectedNodeId: null, selectedEdgeId: null,
        hoveredEdgeId: null, hoveredPort: null, draft: null, clips, keyframes: clipKeyframes, sourceTime: getSourceTimeForClip });
      return { zoom, titleSize: paintedTitleSize(context, scene, zoom) };
    };
    window.__effectGraphDoc = { ready: true, title: doc.title, nodes: doc.graph.nodes.length, edges: doc.graph.edges.length,
      crossings, displaced, overhang: cableOverhang(doc.graph, placed, bounds),
      bounds: { width: Math.round(bounds.right - bounds.left), height: Math.round(bounds.bottom - bounds.top) }, folders: doc.groups,
      cards: doc.graph.nodes.map(node => `${node.id.split('/').at(-1)} (${node.label})`) };
  }, [doc, result.error, clips, clipKeyframes, getSourceTimeForClip]);

  const toggleGroup = useCallback((id: string) => {
    const collapsed = doc?.graph.groups?.find(group => group.id === id)?.collapsed;
    if (collapsed !== undefined) setOverrides(current => ({ ...current, [id]: !collapsed }));
  }, [doc]);

  if (!doc) return <main className="effect-graph-doc effect-graph-doc--error" role="alert">{result.error}</main>;
  return <main className="effect-graph-doc" aria-label={`${doc.title} node graph`}>
    {storedClip === doc.clip && <NodeGraphCanvas graph={doc.graph} selectedNodeId={null} onSelectNode={noop} onToggleGroup={toggleGroup} />}
  </main>;
}
