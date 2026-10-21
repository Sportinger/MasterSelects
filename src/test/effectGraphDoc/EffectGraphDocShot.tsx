// ?test=effect-graph&effect=<id>[&level=stages|all][&open=<folders>][&focus=<folder>][&chain=1]
// Shows an effect's real default operator graph on the Node Workspace canvas, read-only and
// fitted to the window, for docs pictures (scripts/effect-graph-shot.mjs).
import { useCallback, useLayoutEffect, useMemo, useState } from 'react';
import { NodeGraphCanvas } from '../../components/panels/nodes/NodeGraphCanvas';
import { reconcileCanvasPlacement } from '../../components/panels/nodes/canvas/nodeCanvasPlacement';
import { annotatedGraphBounds } from '../../components/panels/nodes/canvas/groupBounds';
import { getPortCenter } from '../../components/panels/nodes/canvas/canvasGeometry';
import { cableRoute, sampleCableRoute } from '../../components/panels/nodes/canvas/cableRoute';
import type { NodeGraph } from '../../types/nodeGraph';
import { useTimelineStore } from '../../stores/timeline';
import {
  buildEffectGraphDoc, effectGraphDocTrack, parseEffectGraphDocQuery, type EffectGraphDoc, type EffectGraphDocQuery,
} from './effectGraphDocModel';
import '../../components/panels/nodes/NodeWorkspacePanel.css';
import './EffectGraphDocShot.css';

interface EffectGraphDocState { ready: boolean; error?: string; title?: string; nodes?: number; edges?: number;
  bounds?: { width: number; height: number }; folders?: EffectGraphDoc['groups'];
  /** Local node id and title of every card, for `only=`, `break=` and `marks=`. */
  cards?: string[];
  /** How far cables bend out past the cards and frames on each side (graph units): the crop keeps them. */
  overhang?: { left: number; top: number; right: number; bottom: number } }
declare global { interface Window { __effectGraphDoc?: EffectGraphDocState } }

const noop = () => {};

/** Cables leaving the last card of a wrapped row bend out past the frame before they turn back. */
function cableOverhang(graph: NodeGraph, placed: NodeGraph['nodes'], bounds: { left: number; top: number; right: number; bottom: number }) {
  const byId = new Map(placed.map(node => [node.id, node]));
  const overhang = { left: 0, top: 0, right: 0, bottom: 0 };
  for (const edge of graph.edges) {
    const from = byId.get(edge.fromNodeId), to = byId.get(edge.toNodeId);
    if (!from || !to) continue;
    for (const point of sampleCableRoute(cableRoute(getPortCenter(from, edge.fromPortId, 'output'), getPortCenter(to, edge.toPortId, 'input')))) {
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

  // Cards read their clip from the timeline store, as in the Node Workspace.
  useLayoutEffect(() => {
    if (doc) useTimelineStore.setState({ clips: [doc.clip], tracks: [effectGraphDocTrack()], clipKeyframes: new Map() });
  }, [doc]);

  useLayoutEffect(() => {
    if (!doc) { window.__effectGraphDoc = { ready: true, error: result.error }; return; }
    const placement = reconcileCanvasPlacement(doc.graph);
    const placed = doc.graph.nodes.map(node => ({ ...node, layout: placement.nodes[node.id] ?? node.layout }));
    const bounds = annotatedGraphBounds(doc.graph, placed);
    window.__effectGraphDoc = { ready: true, title: doc.title, nodes: doc.graph.nodes.length, edges: doc.graph.edges.length,
      overhang: cableOverhang(doc.graph, placed, bounds),
      bounds: { width: Math.round(bounds.right - bounds.left), height: Math.round(bounds.bottom - bounds.top) }, folders: doc.groups,
      cards: doc.graph.nodes.map(node => `${node.id.split('/').at(-1)} (${node.label})`) };
  }, [doc, result.error]);

  const toggleGroup = useCallback((id: string) => {
    const collapsed = doc?.graph.groups?.find(group => group.id === id)?.collapsed;
    if (collapsed !== undefined) setOverrides(current => ({ ...current, [id]: !collapsed }));
  }, [doc]);

  if (!doc) return <main className="effect-graph-doc effect-graph-doc--error" role="alert">{result.error}</main>;
  return <main className="effect-graph-doc" aria-label={`${doc.title} node graph`}>
    <NodeGraphCanvas graph={doc.graph} selectedNodeId={null} onSelectNode={noop} onToggleGroup={toggleGroup} />
  </main>;
}
