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
import { compactRecipeLayout, withBoundaryStubs, withCanvasPlacement, wrapFlowRows } from './effectGraphDocLayout';

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
  /** Node ids that start a new row in a focused folder (instead of `rows`). */
  breaks: string[];
  /** Only these node ids of the focused folder (local ids), laid out compactly; their other inputs become stubs. */
  only: string[];
  /** `hide`: leave out the Constants and Coordinates & Resources folders and their cables, so the stages read as one path. */
  plumbing: 'show' | 'hide';
  /** With `only`: literal values the picks read from the Constants folder become value cards (`show`, default) or stay cut. */
  constants: 'show' | 'hide';
  /** Cards left out with their cables (local ids), e.g. the effect's Output card in an overview. */
  omit: string[];
  /** Keep the clip chain (source, transform, output) around the effect. */
  chain: boolean;
  /** `avoid`: cables route around cards (the Node Workspace's Avoid), so none passes behind a card. */
  cables: 'direct' | 'avoid';
}

/** Folders that only feed numbers and coordinates into every stage. */
export const PLUMBING_FOLDERS = new Set(['Constants', 'Coordinates & Resources']);

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
  const plumbing = params.get('plumbing') ?? 'show';
  if (plumbing !== 'show' && plumbing !== 'hide') throw new Error(`Unknown plumbing "${plumbing}": use show or hide.`);
  const constants = params.get('constants') ?? 'show';
  if (constants !== 'show' && constants !== 'hide') throw new Error(`Unknown constants "${constants}": use show or hide.`);
  const only = listParam(params.get('only'));
  if (only.length && !focus) throw new Error('only= picks nodes inside a focused folder: add focus=<folder>.');
  const cables = params.get('cables') ?? 'direct';
  if (cables !== 'direct' && cables !== 'avoid') throw new Error(`Unknown cables "${cables}": use direct or avoid.`);
  return { effectType: params.get('effect')?.trim() || 'gaussian-blur', level, open: listParam(params.get('open')), focus,
    rows: rows ? Math.round(Number(rows)) : 'auto', breaks: listParam(params.get('break')), only, plumbing, constants, omit: listParam(params.get('omit')),
    chain: params.get('chain') === '1', cables };
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

/** Drops the plumbing folders, their cables and the folder inputs that only they fed. */
function withoutPlumbing(graph: NodeGraph): NodeGraph {
  const hidden = new Set(graph.nodes.filter(node => PLUMBING_FOLDERS.has(node.label) && node.binding?.kind === 'operator-group').map(node => node.id));
  if (!hidden.size) return graph;
  const edges = graph.edges.filter(edge => !hidden.has(edge.fromNodeId) && !hidden.has(edge.toNodeId));
  const fed = new Set(edges.map(edge => `${edge.toNodeId}:${edge.toPortId}`));
  const orphaned = new Set(graph.edges.filter(edge => hidden.has(edge.fromNodeId)).map(edge => `${edge.toNodeId}:${edge.toPortId}`));
  return { ...graph, edges, nodes: graph.nodes.filter(node => !hidden.has(node.id)).map(node => ({ ...node,
    inputs: node.inputs.filter(port => !orphaned.has(`${node.id}:${port.id}`) || fed.has(`${node.id}:${port.id}`)) })),
  groups: graph.groups?.filter(group => !hidden.has(group.proxyId)).map(group => ({ ...group, nodeIds: group.nodeIds.filter(id => !hidden.has(id)) })) };
}

/** A local node id; recognized compositions start with `@`, which the token may leave out (it ends a shot name). */
const isNode = (id: string, token: string) => [token, `@${token}`].some(local => id.toLowerCase() === local || id.toLowerCase().endsWith(`/${local}`));

/** Keeps the picked nodes of a focused folder; cables from the others become stubs later (laid out with them). */
function keepOnly(graph: NodeGraph, tokens: readonly string[]): NodeGraph {
  const missing = tokens.filter(token => !graph.nodes.some(node => isNode(node.id, token)));
  if (missing.length) throw new Error(`No node ${missing.join(', ')} in this folder. Nodes: ${graph.nodes.map(node => node.id.split('/').at(-1)).join(', ')}.`);
  const kept = new Set(graph.nodes.filter(node => tokens.some(token => isNode(node.id, token))).map(node => node.id));
  return { ...graph, nodes: graph.nodes.filter(node => kept.has(node.id)),
    edges: graph.edges.filter(edge => kept.has(edge.fromNodeId) && kept.has(edge.toNodeId)),
    // Folded folders that were not picked would still reserve their frame on the canvas.
    groups: graph.groups?.map(group => ({ ...group, nodeIds: group.nodeIds.filter(id => kept.has(id)) }))
      .filter(group => !group.collapsed || kept.has(group.proxyId)) };
}

/** Leaves out the named cards and their cables. */
function omitNodes(graph: NodeGraph, tokens: readonly string[]): NodeGraph {
  if (!tokens.length) return graph;
  const missing = tokens.filter(token => !graph.nodes.some(node => isNode(node.id, token)));
  if (missing.length) throw new Error(`No node ${missing.join(', ')} to omit. Nodes: ${graph.nodes.map(node => node.id.split('/').at(-1)).join(', ')}.`);
  const dropped = new Set(graph.nodes.filter(node => tokens.some(token => isNode(node.id, token))).map(node => node.id));
  return { ...graph, nodes: graph.nodes.filter(node => !dropped.has(node.id)),
    edges: graph.edges.filter(edge => !dropped.has(edge.fromNodeId) && !dropped.has(edge.toNodeId)),
    groups: graph.groups?.map(group => ({ ...group, nodeIds: group.nodeIds.filter(id => !dropped.has(id)) })) };
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
  const placed = focus ? withCanvasPlacement(full) : full;
  // Constants are literal numbers (their cards show the value); other outside inputs get named stubs.
  const skip = (source: NodeGraph['nodes'][number]) => source.label === 'Constants' || (query.plumbing === 'hide' && PLUMBING_FOLDERS.has(source.label));
  const folder = focus ? cropToGroup(placed, focus.id) : undefined;
  const picked = folder && query.only.length ? keepOnly(folder, query.only) : folder;
  // A focused folder is laid out here (rows, stubs, picks); the canvas must not re-flow it.
  const fixedLayout = (graph: NodeGraph): NodeGraph => ({ ...graph, groups: graph.groups?.map(({ layoutMode: _flow, ...group }) => group) });
  // A recipe (only=) is laid out afresh with its stubs and constants; a whole folder keeps its flow and gets stub columns.
  const shaped = picked && query.only.length
    ? compactRecipeLayout(withBoundaryStubs(picked, placed, skip, { constants: query.constants === 'show', place: false }))
    : picked && withBoundaryStubs(picked, placed, skip);
  const cropped = shaped ? fixedLayout(wrapFlowRows(shaped, query.rows, query.breaks))
    : query.chain ? full : cropToGroup(full, EFFECT_GRAPH_DOC_GROUP);
  // Without plumbing the stages read as one path: lay them out like a recipe, so no cable runs
  // behind a stage it does not belong to (the editor's flow layout allows that).
  const graph = query.plumbing === 'hide' && !focus && !query.chain ? fixedLayout(compactRecipeLayout(omitNodes(withoutPlumbing(cropped), query.omit)))
    : omitNodes(query.plumbing === 'hide' && !focus ? withoutPlumbing(cropped) : cropped, query.omit);
  // The canvas refits per graph id: one id per level keeps a refit when the level changes.
  const id = `${full.id}:${query.effectType}:${query.level}:${query.open.join('+')}:${query.focus ?? ''}:${query.rows}:${query.breaks.join('+')}:${query.only.join('+')}`
    + `:${query.plumbing}:${query.constants}:${query.omit.join('+')}:${query.chain ? 'chain' : 'effect'}:${query.cables}`;
  const values = graph.nodes.filter(node => node.operatorId?.startsWith('values.'));
  const shown = { ...clip, nodeGraph: { ...clip.nodeGraph!, previews: { enabled: false,
    nodes: Object.fromEntries(values.map(node => [nodePreviewPreferenceKey(clip.id, node), { enabled: true }])) } } };
  // Docs pictures give every card title one size, so short stub names do not outshout the recipe.
  return { title: focus ? `${clip.name} – ${focus.label}` : clip.name, clip: shown, graph: { ...graph, id, overviewTitles: 'uniform',
    ...(query.cables === 'avoid' ? { cableRouting: 'avoid' as const } : {}) },
    groups: folders.map(folder => ({ id: folder.id, label: folder.label, path: folder.path, collapsed: states[folder.id]?.collapsed ?? true })) };
}
