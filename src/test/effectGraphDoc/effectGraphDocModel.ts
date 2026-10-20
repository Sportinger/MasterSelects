// Graph selection for the effect node-graph doc shots (?test=effect-graph).
// It builds the same unified clip graph the Node Workspace shows for a clip with one
// freshly added effect, folds it to the requested level and crops it to the effect.
import { getDefaultParams, getEffect } from '../../effects';
import { buildClipNodeGraphDocument } from '../../services/nodeGraph/clipGraphDocument';
import { buildUnifiedClipGraph } from '../../services/nodeGraph/unifiedClipGraph';
import { hasEffectOperatorGraph } from '../../services/operators/effectGraphOwner';
import { nodePreviewPreferenceKey } from '../../services/nodePreview/previewTypes';
import { DEFAULT_TRANSFORM } from '../../stores/timeline/constants';
import type { EffectType } from '../../types/effects';
import type { NodeGraph } from '../../types/nodeGraph';
import type { TimelineClip, TimelineTrack } from '../../types/timeline';
import { withCanvasPlacement, wrapFlowRows } from './effectGraphDocLayout';

/**
 * `stages`: the effect is open and its folders (stages, compositions) are folded, as when an
 * effect is first opened in the Node Workspace. `all`: every folder and composition is open.
 */
export type EffectGraphDocLevel = 'stages' | 'all';

export interface EffectGraphDocQuery {
  effectType: string;
  level: EffectGraphDocLevel;
  /** Folders to open in addition to the level: label slug, label path (`horizontal-pass/pair-tap-offsets`) or group id. */
  open: string[];
  /** Crop to the contents of this folder (same tokens as `open`; the folder opens). */
  focus?: string;
  /** A focused folder keeps its flow layout from inside the effect, split into this many rows (default: a landscape fit). */
  rows: number | 'auto';
  /** Keep the clip chain (source, transform, output) around the effect. */
  chain: boolean;
}

export interface EffectGraphDocGroup {
  id: string;
  label: string;
  /** Label slugs from the effect folder down, e.g. `horizontal-pass/pair-tap-offsets`. */
  path: string;
  collapsed: boolean;
}

export interface EffectGraphDoc {
  title: string;
  /** The clip the graph was projected from; the page puts it into the timeline store for the cards. */
  clip: TimelineClip;
  graph: NodeGraph;
  /** Every folder of the effect with its folded state at this level. */
  groups: EffectGraphDocGroup[];
}

export const EFFECT_GRAPH_DOC_CLIP_ID = 'effect-graph-doc-clip';
export const EFFECT_GRAPH_DOC_TRACK_ID = 'effect-graph-doc-track';
const EFFECT_ID = 'doc';
export const EFFECT_GRAPH_DOC_GROUP = `effect:${EFFECT_ID}`;

const listParam = (value: string | null) => (value ?? '').split(',').map(item => item.trim().toLowerCase()).filter(Boolean);

export function parseEffectGraphDocQuery(search: string): EffectGraphDocQuery {
  const params = new URLSearchParams(search);
  const requested = params.get('level');
  if (requested && requested !== 'stages' && requested !== 'all') throw new Error(`Unknown level "${requested}": use stages or all.`);
  const level: EffectGraphDocLevel = requested === 'all' ? 'all' : 'stages';
  const focus = params.get('focus')?.trim().toLowerCase() || undefined;
  const rows = params.get('rows');
  if (rows && !(Number(rows) >= 1)) throw new Error(`rows must be a number from 1 (got "${rows}").`);
  return { effectType: params.get('effect')?.trim() || 'gaussian-blur', level, open: listParam(params.get('open')), focus,
    rows: rows ? Math.round(Number(rows)) : 'auto', chain: params.get('chain') === '1' };
}

export const slugLabel = (label: string) => label.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export function effectGraphDocTrack(): TimelineTrack {
  return { id: EFFECT_GRAPH_DOC_TRACK_ID, name: 'Video', type: 'video', height: 70, muted: false, visible: true, solo: false };
}

/** A clip carrying one freshly added effect with its catalog defaults, like Add Effect creates it. */
export function effectGraphDocClip(effectType: string, groups: Record<string, { collapsed: boolean }> = {}): TimelineClip {
  const definition = getEffect(effectType);
  if (!definition) throw new Error(`Unknown effect "${effectType}".`);
  if (!hasEffectOperatorGraph(effectType)) throw new Error(`${definition.name} has no operator graph to show.`);
  return {
    id: EFFECT_GRAPH_DOC_CLIP_ID, trackId: EFFECT_GRAPH_DOC_TRACK_ID, name: definition.name, file: new File([], 'effect-graph-doc.mp4'),
    startTime: 0, duration: 5, inPoint: 0, outPoint: 5, source: null, transform: DEFAULT_TRANSFORM,
    effects: [{ id: EFFECT_ID, name: definition.name, type: effectType as EffectType, enabled: true, params: getDefaultParams(effectType) }],
    // Empty preview panes would only add blank space to a picture of the structure;
    // value cards keep theirs, which shows the number (buildEffectGraphDoc enables them).
    nodeGraph: { version: 1, nodes: [], groups, previews: { enabled: false, nodes: {} } },
  };
}

const project = (clip: TimelineClip, expandAll = false) =>
  buildUnifiedClipGraph(buildClipNodeGraphDocument(clip, effectGraphDocTrack()), clip, [clip], [], undefined, expandAll);

/** Folders of the effect (the effect group itself excluded) with their label paths. */
function effectFolders(graph: NodeGraph): Array<Omit<EffectGraphDocGroup, 'collapsed'> & { parentId?: string }> {
  const groups = new Map((graph.groups ?? []).map(group => [group.id, group]));
  const path = (id: string | undefined): string[] => {
    const group = id ? groups.get(id) : undefined;
    return !group || group.id === EFFECT_GRAPH_DOC_GROUP ? [] : [...path(group.parentId), slugLabel(group.label)];
  };
  return [...groups.values()].filter(group => group.id.startsWith(`${EFFECT_GRAPH_DOC_GROUP}/`))
    .map(group => ({ id: group.id, label: group.label, path: path(group.id).join('/'), parentId: group.parentId }));
}

/** Every folder of the effect, including folders nested in folded ones. */
export const effectGraphDocFolders = (effectType: string) => effectFolders(project(effectGraphDocClip(effectType), true));

const matches = (group: { id: string; path: string }, token: string) =>
  group.path === token || group.path.endsWith(`/${token}`) || group.id.toLowerCase() === token || group.id.toLowerCase().endsWith(`/${token}`);

/** Folded states for a level; `overrides` (group id → collapsed) win, e.g. from clicks on folder headers. */
export function effectGraphDocFoldState(query: EffectGraphDocQuery, overrides: Record<string, boolean> = {},
  folders = effectGraphDocFolders(query.effectType)): Record<string, { collapsed: boolean }> {
  const tokens = [...query.open, ...query.focus ? [query.focus] : []];
  for (const token of tokens) {
    if (!folders.some(folder => matches(folder, token))) {
      throw new Error(`No folder "${token}" in this effect. Folders: ${folders.map(folder => folder.path).join(', ') || 'none'}.`);
    }
  }
  const byId = new Map(folders.map(folder => [folder.id, folder]));
  const opened = new Set<string>();
  for (const folder of folders) if (tokens.some(token => matches(folder, token))) {
    // Opening a nested folder opens the folders around it, too.
    for (let id: string | undefined = folder.id; id && byId.has(id); id = byId.get(id)!.parentId) opened.add(id);
  }
  const states: Record<string, { collapsed: boolean }> = { [EFFECT_GRAPH_DOC_GROUP]: { collapsed: false } };
  for (const folder of folders) states[folder.id] = { collapsed: query.level !== 'all' && !opened.has(folder.id) };
  for (const [id, collapsed] of Object.entries(overrides)) states[id] = { collapsed };
  return states;
}

/** Keeps the nodes, edges and folders inside one group (the effect, or a focused folder). */
function cropToGroup(graph: NodeGraph, groupId: string): NodeGraph {
  const root = graph.groups?.find(group => group.id === groupId);
  if (!root) return graph;
  const members = new Set(root.nodeIds);
  const inside = (id: string | undefined): boolean => id === groupId || (!!id && inside(graph.groups?.find(group => group.id === id)?.parentId));
  return { ...graph, nodes: graph.nodes.filter(node => members.has(node.id)),
    edges: graph.edges.filter(edge => members.has(edge.fromNodeId) && members.has(edge.toNodeId)),
    groups: graph.groups?.filter(group => inside(group.id)).map(group => ({ ...group, nodeIds: group.nodeIds.filter(id => members.has(id)) })) };
}

export function buildEffectGraphDoc(query: EffectGraphDocQuery, overrides: Record<string, boolean> = {}): EffectGraphDoc {
  const folders = effectGraphDocFolders(query.effectType);
  const states = effectGraphDocFoldState(query, overrides, folders);
  const clip = effectGraphDocClip(query.effectType, states);
  const full = project(clip);
  const focus = query.focus ? folders.find(folder => matches(folder, query.focus!)) : undefined;
  const graph = focus ? wrapFlowRows(cropToGroup(withCanvasPlacement(full), focus.id), query.rows)
    : query.chain ? full : cropToGroup(full, EFFECT_GRAPH_DOC_GROUP);
  // The canvas refits per graph id: one id per level keeps a refit when the level changes.
  const id = `${full.id}:${query.effectType}:${query.level}:${query.open.join('+')}:${query.focus ?? ''}:${query.rows}:${query.chain ? 'chain' : 'effect'}`;
  const values = graph.nodes.filter(node => node.operatorId?.startsWith('values.'));
  const shown = { ...clip, nodeGraph: { ...clip.nodeGraph!, previews: { enabled: false,
    nodes: Object.fromEntries(values.map(node => [nodePreviewPreferenceKey(clip.id, node), { enabled: true }])) } } };
  return { title: focus ? `${clip.name} – ${focus.label}` : clip.name, clip: shown, graph: { ...graph, id },
    groups: folders.map(folder => ({ id: folder.id, label: folder.label, path: folder.path, collapsed: states[folder.id]?.collapsed ?? true })) };
}
