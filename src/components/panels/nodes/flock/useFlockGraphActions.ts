import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FlockNodeLayout, FlockParamValue } from '../../../../types/flock';
import type { NodeGraphConnectionRequest, NodeGraphLayout } from '../../../../services/nodeGraph';
import { startBatch, endBatch } from '../../../../stores/historyStore';
import { useTimelineStore } from '../../../../stores/timeline';
import type { TimelineClip } from '../../../../stores/timeline/types';
import { FLOCK_GROUP_OPERATOR_ID, getFlockOperator } from '../../../../services/flock/operators/flockOperatorRegistry';
import { getFlockPreset } from '../../../../services/flock/presets/flockPresets';
import {
  extractFlockGroupPreset,
  instantiateFlockGraphPreset,
  saveFlockGraphPreset,
  saveFlockGroupPreset,
  type FlockLibraryGraphPreset,
  type FlockLibraryGroupPreset,
} from '../../../../services/nodeGraph/flockGroupPresetLibrary';
import type { NodeGraphMove } from '../NodeGraphCanvas';

export interface FlockUiMessage {
  tone: 'error' | 'info';
  text: string;
}

export interface FlockGraphActions {
  message: FlockUiMessage | null;
  clearMessage: () => void;
  addOperator: (operatorId: string, layout?: NodeGraphLayout) => string | null;
  addGroupInstance: (groupId: string, layout?: NodeGraphLayout) => string | null;
  insertGroupPreset: (preset: FlockLibraryGroupPreset, layout?: NodeGraphLayout) => string | null;
  deleteNodes: (nodeIds: string[]) => boolean;
  moveNode: (nodeId: string, layout: NodeGraphLayout) => void;
  moveNodes: (moves: NodeGraphMove[]) => void;
  connect: (connection: NodeGraphConnectionRequest) => boolean;
  disconnect: (edgeId: string) => void;
  toggleBypass: (nodeId: string) => void;
  duplicate: (nodeIds: string[]) => string[];
  group: (nodeIds: string[], label?: string) => string | null;
  ungroup: (groupNodeId: string) => string[];
  rename: (nodeId: string, label: string) => void;
  setParam: (nodeId: string, paramKey: string, value: FlockParamValue) => boolean;
  exposeParam: (nodeId: string, paramKey: string, label: string, group: string) => void;
  unexposeParam: (exposedId: string) => void;
  applyBuiltInPreset: (presetId: string) => void;
  applyGraphPreset: (preset: FlockLibraryGraphPreset) => void;
  saveGroupPreset: (nodeIds: string[], label: string) => boolean;
  saveGraphPreset: (label: string) => boolean;
}

function batched<T>(label: string, run: () => T): T {
  startBatch(label);
  try {
    return run();
  } finally {
    endBatch();
  }
}

/** Flock domain adapter for the Node Workspace: one user action = one undo step. */
export function useFlockGraphActions(clip: TimelineClip | null): FlockGraphActions {
  const addFlockGraphNode = useTimelineStore((state) => state.addFlockGraphNode);
  const removeFlockGraphNodes = useTimelineStore((state) => state.removeFlockGraphNodes);
  const moveFlockGraphNode = useTimelineStore((state) => state.moveFlockGraphNode);
  const connectFlockGraphPorts = useTimelineStore((state) => state.connectFlockGraphPorts);
  const disconnectFlockGraphEdge = useTimelineStore((state) => state.disconnectFlockGraphEdge);
  const setFlockGraphBypass = useTimelineStore((state) => state.setFlockGraphBypass);
  const duplicateFlockGraphNodes = useTimelineStore((state) => state.duplicateFlockGraphNodes);
  const groupFlockGraphNodes = useTimelineStore((state) => state.groupFlockGraphNodes);
  const ungroupFlockGraphNode = useTimelineStore((state) => state.ungroupFlockGraphNode);
  const renameFlockGraphNode = useTimelineStore((state) => state.renameFlockGraphNode);
  const setFlockGraphParam = useTimelineStore((state) => state.setFlockGraphParam);
  const exposeFlockGraphParam = useTimelineStore((state) => state.exposeFlockGraphParam);
  const unexposeFlockGraphParam = useTimelineStore((state) => state.unexposeFlockGraphParam);
  const insertFlockGroupDefinition = useTimelineStore((state) => state.insertFlockGroupDefinition);
  const applyFlockPreset = useTimelineStore((state) => state.applyFlockPreset);
  const replaceFlockDefinition = useTimelineStore((state) => state.replaceFlockDefinition);
  const [message, setMessage] = useState<FlockUiMessage | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clipId = clip?.id ?? null;
  const definition = clip?.flock ?? null;

  const showMessage = useCallback((next: FlockUiMessage) => {
    setMessage(next);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setMessage(null), next.tone === 'error' ? 7000 : 3500);
  }, []);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  const clearMessage = useCallback(() => setMessage(null), []);

  return useMemo<FlockGraphActions>(() => {
    const requireClip = (): string | null => {
      if (!clipId || !definition) {
        showMessage({ tone: 'error', text: 'Select a flock clip first.' });
        return null;
      }
      return clipId;
    };
    const toLayout = (layout?: NodeGraphLayout): FlockNodeLayout | undefined => (
      layout ? { x: Math.round(layout.x), y: Math.round(layout.y) } : undefined
    );

    return {
      message,
      clearMessage,
      addOperator: (operatorId, layout) => {
        const id = requireClip();
        if (!id) return null;
        const nodeId = batched(`Add ${getFlockOperator(operatorId)?.label ?? 'flock'} node`, () => (
          addFlockGraphNode(id, operatorId, { layout: toLayout(layout) })
        ));
        if (!nodeId) showMessage({ tone: 'error', text: 'The node could not be added.' });
        return nodeId;
      },
      addGroupInstance: (groupId, layout) => {
        const id = requireClip();
        const group = definition?.groups.find((candidate) => candidate.id === groupId);
        if (!id || !group) return null;
        return batched('Add group node', () => (
          addFlockGraphNode(id, FLOCK_GROUP_OPERATOR_ID, { groupRef: groupId, label: group.label, layout: toLayout(layout) })
        ));
      },
      insertGroupPreset: (preset, layout) => {
        const id = requireClip();
        if (!id) return null;
        const nodeId = batched('Insert group preset', () => insertFlockGroupDefinition(id, preset.group, toLayout(layout)));
        if (!nodeId) showMessage({ tone: 'error', text: `Group preset "${preset.label}" could not be inserted.` });
        return nodeId;
      },
      deleteNodes: (nodeIds) => {
        const id = requireClip();
        if (!id || nodeIds.length === 0) return false;
        return batched(nodeIds.length > 1 ? 'Delete flock nodes' : 'Delete flock node', () => removeFlockGraphNodes(id, nodeIds));
      },
      moveNode: (nodeId, layout) => {
        if (clipId) moveFlockGraphNode(clipId, nodeId, Math.round(layout.x), Math.round(layout.y));
      },
      moveNodes: (moves) => {
        if (!clipId || moves.length === 0) return;
        batched('Move flock nodes', () => {
          for (const move of moves) moveFlockGraphNode(clipId, move.nodeId, Math.round(move.layout.x), Math.round(move.layout.y));
        });
      },
      connect: (connection) => {
        const id = requireClip();
        if (!id) return false;
        const result = batched('Connect flock ports', () => connectFlockGraphPorts(
          id,
          { nodeId: connection.fromNodeId, port: connection.fromPortId },
          { nodeId: connection.toNodeId, port: connection.toPortId },
        ));
        if (!result.ok) {
          showMessage({ tone: 'error', text: result.message });
          return false;
        }
        if (result.replacedEdgeId) {
          showMessage({ tone: 'info', text: 'Replaced the existing connection on that input.' });
        }
        return true;
      },
      disconnect: (edgeId) => {
        if (!clipId) return;
        batched('Disconnect flock link', () => disconnectFlockGraphEdge(clipId, edgeId));
      },
      toggleBypass: (nodeId) => {
        const node = definition?.nodes.find((candidate) => candidate.id === nodeId);
        if (!clipId || !node) return;
        const ok = batched('Toggle flock node bypass', () => setFlockGraphBypass(clipId, nodeId, node.bypassed !== true));
        if (!ok) showMessage({ tone: 'error', text: `${getFlockOperator(node.operator)?.label ?? 'This node'} cannot be bypassed.` });
      },
      duplicate: (nodeIds) => {
        const id = requireClip();
        if (!id || nodeIds.length === 0) return [];
        const idMap = batched('Duplicate flock nodes', () => duplicateFlockGraphNodes(id, nodeIds));
        return idMap ? Object.values(idMap) : [];
      },
      group: (nodeIds, label = 'Group') => {
        const id = requireClip();
        if (!id || nodeIds.length === 0) return null;
        const groupNodeId = batched('Group flock nodes', () => groupFlockGraphNodes(id, nodeIds, label));
        if (!groupNodeId) {
          showMessage({ tone: 'error', text: 'Scene Output and Simulation stay at the top level; select other nodes to group.' });
        }
        return groupNodeId;
      },
      ungroup: (groupNodeId) => {
        const id = requireClip();
        if (!id) return [];
        const idMap = batched('Ungroup flock nodes', () => ungroupFlockGraphNode(id, groupNodeId));
        if (!idMap) {
          showMessage({ tone: 'error', text: 'The group could not be ungrouped.' });
          return [];
        }
        return Object.values(idMap);
      },
      rename: (nodeId, label) => {
        if (clipId) batched('Rename flock node', () => renameFlockGraphNode(clipId, nodeId, label));
      },
      setParam: (nodeId, paramKey, value) => {
        if (!clipId) return false;
        const ok = batched('Change flock parameter', () => setFlockGraphParam(clipId, nodeId, paramKey, value));
        if (!ok) showMessage({ tone: 'error', text: 'That value is not valid for this parameter.' });
        return ok;
      },
      exposeParam: (nodeId, paramKey, label, group) => {
        if (clipId) batched('Expose flock control', () => exposeFlockGraphParam(clipId, nodeId, paramKey, { label, group }));
      },
      unexposeParam: (exposedId) => {
        if (clipId) batched('Remove flock control', () => unexposeFlockGraphParam(clipId, exposedId));
      },
      applyBuiltInPreset: (presetId) => {
        const id = requireClip();
        if (!id) return;
        const ok = batched('Apply flock preset', () => applyFlockPreset(id, presetId));
        showMessage(ok
          ? { tone: 'info', text: `Applied preset ${getFlockPreset(presetId)?.label ?? presetId}.` }
          : { tone: 'error', text: 'The preset could not be applied.' });
      },
      applyGraphPreset: (preset) => {
        const id = requireClip();
        if (!id) return;
        const ok = batched('Apply saved flock graph', () => replaceFlockDefinition(id, instantiateFlockGraphPreset(preset)));
        showMessage(ok
          ? { tone: 'info', text: `Applied saved graph ${preset.label}.` }
          : { tone: 'error', text: 'The saved graph could not be applied.' });
      },
      saveGroupPreset: (nodeIds, label) => {
        if (!definition) return false;
        const extraction = extractFlockGroupPreset(definition, nodeIds, label);
        if (!extraction.ok) {
          showMessage({ tone: 'error', text: extraction.message });
          return false;
        }
        const saved = saveFlockGroupPreset(label, extraction.group);
        showMessage(saved
          ? { tone: 'info', text: `Saved group preset ${saved.label}.` }
          : { tone: 'error', text: 'Browser storage is unavailable; the preset was not saved.' });
        return !!saved;
      },
      saveGraphPreset: (label) => {
        if (!definition) return false;
        const saved = saveFlockGraphPreset(label, definition);
        showMessage(saved
          ? { tone: 'info', text: `Saved graph preset ${saved.label}.` }
          : { tone: 'error', text: 'Browser storage is unavailable; the preset was not saved.' });
        return !!saved;
      },
    };
  }, [
    addFlockGraphNode,
    applyFlockPreset,
    clearMessage,
    clipId,
    connectFlockGraphPorts,
    definition,
    disconnectFlockGraphEdge,
    duplicateFlockGraphNodes,
    exposeFlockGraphParam,
    groupFlockGraphNodes,
    insertFlockGroupDefinition,
    message,
    moveFlockGraphNode,
    removeFlockGraphNodes,
    renameFlockGraphNode,
    replaceFlockDefinition,
    setFlockGraphBypass,
    setFlockGraphParam,
    showMessage,
    unexposeFlockGraphParam,
    ungroupFlockGraphNode,
  ]);
}
