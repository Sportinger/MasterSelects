// ?test=effect-graph&effect=<id>[&level=stages|all][&open=<folders>][&focus=<folder>][&chain=1]
// Shows an effect's real default operator graph on the Node Workspace canvas, read-only and
// fitted to the window, for docs pictures (scripts/effect-graph-shot.mjs).
import { useCallback, useLayoutEffect, useMemo, useState } from 'react';
import { NodeGraphCanvas } from '../../components/panels/nodes/NodeGraphCanvas';
import { reconcileCanvasPlacement } from '../../components/panels/nodes/canvas/nodeCanvasPlacement';
import { annotatedGraphBounds } from '../../components/panels/nodes/canvas/groupBounds';
import { useTimelineStore } from '../../stores/timeline';
import {
  buildEffectGraphDoc, effectGraphDocTrack, parseEffectGraphDocQuery, type EffectGraphDoc, type EffectGraphDocQuery,
} from './effectGraphDocModel';
import '../../components/panels/nodes/NodeWorkspacePanel.css';
import './EffectGraphDocShot.css';

interface EffectGraphDocState { ready: boolean; error?: string; title?: string; nodes?: number; edges?: number;
  bounds?: { width: number; height: number }; folders?: EffectGraphDoc['groups'] }
declare global { interface Window { __effectGraphDoc?: EffectGraphDocState } }

const noop = () => {};

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
    const bounds = annotatedGraphBounds(doc.graph, doc.graph.nodes.map(node => ({ ...node, layout: placement.nodes[node.id] ?? node.layout })));
    window.__effectGraphDoc = { ready: true, title: doc.title, nodes: doc.graph.nodes.length, edges: doc.graph.edges.length,
      bounds: { width: Math.round(bounds.right - bounds.left), height: Math.round(bounds.bottom - bounds.top) }, folders: doc.groups };
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
