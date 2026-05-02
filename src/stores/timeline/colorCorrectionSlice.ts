import type { ColorCorrectionState, ColorNode, ColorParamValue, ColorViewMode } from '../../types';
import {
  cloneColorCorrectionState,
  createColorNodeId,
  createDefaultColorCorrectionState,
  createPrimaryColorNode,
  ensureColorCorrectionState,
  getActiveColorVersion,
  setColorNodeParamValue,
} from '../../types';
import type { ColorCorrectionActions, Keyframe, SliceCreator } from './types';

function wouldCreateCycle(
  edges: { fromNodeId: string; toNodeId: string }[],
  fromNodeId: string,
  toNodeId: string
): boolean {
  const outgoing = new Map<string, string[]>();
  for (const edge of edges) {
    const targets = outgoing.get(edge.fromNodeId) ?? [];
    targets.push(edge.toNodeId);
    outgoing.set(edge.fromNodeId, targets);
  }

  const stack = [toNodeId];
  const visited = new Set<string>();
  while (stack.length > 0) {
    const nodeId = stack.pop()!;
    if (nodeId === fromNodeId) return true;
    if (visited.has(nodeId)) continue;
    visited.add(nodeId);
    stack.push(...(outgoing.get(nodeId) ?? []));
  }

  return false;
}

function updateClipColorState(
  state: ColorCorrectionState | undefined,
  updater: (current: ColorCorrectionState) => ColorCorrectionState
): ColorCorrectionState {
  return updater(ensureColorCorrectionState(state));
}

function createColorPropertyMatcher(versionId?: string, nodeId?: string) {
  return (property: string): boolean => {
    if (!property.startsWith('color.')) return false;
    const [, propertyVersionId, propertyNodeId] = property.split('.');
    if (versionId && propertyVersionId !== versionId) return false;
    if (nodeId && propertyNodeId !== nodeId) return false;
    return true;
  };
}

function cleanupClipColorKeyframes(
  clipId: string,
  matcher: (property: string) => boolean,
  state: {
    clipKeyframes: Map<string, Keyframe[]>;
    keyframeRecordingEnabled: Set<string>;
    selectedKeyframeIds: Set<string>;
  }
) {
  const existingKeyframes = state.clipKeyframes.get(clipId) ?? [];
  const removedKeyframeIds = new Set<string>();
  const filteredKeyframes = existingKeyframes.filter(keyframe => {
    if (!matcher(keyframe.property)) return true;
    removedKeyframeIds.add(keyframe.id);
    return false;
  });

  let clipKeyframes = state.clipKeyframes;
  if (filteredKeyframes.length !== existingKeyframes.length) {
    clipKeyframes = new Map(state.clipKeyframes);
    if (filteredKeyframes.length > 0) {
      clipKeyframes.set(clipId, filteredKeyframes);
    } else {
      clipKeyframes.delete(clipId);
    }
  }

  const recordingPrefix = `${clipId}:`;
  let recordingChanged = false;
  const keyframeRecordingEnabled = new Set<string>();
  state.keyframeRecordingEnabled.forEach(recordingKey => {
    const property = recordingKey.startsWith(recordingPrefix)
      ? recordingKey.slice(recordingPrefix.length)
      : null;
    if (property && matcher(property)) {
      recordingChanged = true;
      return;
    }
    keyframeRecordingEnabled.add(recordingKey);
  });

  let selectedKeyframeIds = state.selectedKeyframeIds;
  if (removedKeyframeIds.size > 0) {
    selectedKeyframeIds = new Set(
      [...state.selectedKeyframeIds].filter(keyframeId => !removedKeyframeIds.has(keyframeId))
    );
  }

  return {
    clipKeyframes,
    keyframeRecordingEnabled: recordingChanged ? keyframeRecordingEnabled : state.keyframeRecordingEnabled,
    selectedKeyframeIds,
    changed:
      clipKeyframes !== state.clipKeyframes ||
      recordingChanged ||
      selectedKeyframeIds !== state.selectedKeyframeIds,
  };
}

export const createColorCorrectionSlice: SliceCreator<ColorCorrectionActions> = (set, get) => ({
  ensureColorCorrection: (clipId) => {
    const { clips, invalidateCache } = get();
    const clip = clips.find(c => c.id === clipId);
    if (!clip) return;
    if (clip.colorCorrection) return;

    set({
      clips: clips.map(c =>
        c.id === clipId
          ? { ...c, colorCorrection: createDefaultColorCorrectionState() }
          : c
      ),
    });
    invalidateCache();
  },

  updateColorCorrection: (clipId, updater) => {
    const { clips, invalidateCache } = get();
    set({
      clips: clips.map(c =>
        c.id === clipId
          ? { ...c, colorCorrection: updateClipColorState(c.colorCorrection, updater) }
          : c
      ),
    });
    invalidateCache();
  },

  setColorCorrectionEnabled: (clipId, enabled) => {
    get().updateColorCorrection(clipId, current => ({ ...current, enabled }));
  },

  setColorViewMode: (clipId, viewMode: ColorViewMode) => {
    get().updateColorCorrection(clipId, current => ({
      ...current,
      ui: { ...current.ui, viewMode },
    }));
  },

  setColorWorkspaceViewport: (clipId, workspaceViewport) => {
    const { clips } = get();
    set({
      clips: clips.map(c =>
        c.id === clipId
          ? {
              ...c,
              colorCorrection: updateClipColorState(c.colorCorrection, current => ({
                ...current,
                ui: { ...current.ui, workspaceViewport },
              })),
            }
          : c
      ),
    });
  },

  selectColorNode: (clipId, nodeId) => {
    get().updateColorCorrection(clipId, current => ({
      ...current,
      ui: { ...current.ui, selectedNodeId: nodeId },
    }));
  },

  addColorNode: (clipId, type = 'primary') => {
    const nodeId = createColorNodeId('color');
    const node: ColorNode = type === 'primary'
      ? createPrimaryColorNode(nodeId, 'Primary')
      : createPrimaryColorNode(nodeId, 'Primary');

    get().updateColorCorrection(clipId, current => {
      const activeVersion = getActiveColorVersion(current);
      if (!activeVersion) return current;

      const outputNode = activeVersion.nodes.find(candidate => candidate.type === 'output');
      const previousNode = activeVersion.nodes
        .filter(candidate => candidate.type !== 'output')
        .at(-1);
      const nextEdges = activeVersion.edges
        .filter(edge => !(outputNode && edge.toNodeId === outputNode.id));

      if (previousNode) {
        nextEdges.push({
          id: createColorNodeId('edge'),
          fromNodeId: previousNode.id,
          fromPort: 'out',
          toNodeId: node.id,
          toPort: 'in',
        });
      }
      if (outputNode) {
        nextEdges.push({
          id: createColorNodeId('edge'),
          fromNodeId: node.id,
          fromPort: 'out',
          toNodeId: outputNode.id,
          toPort: 'in',
        });
      }

      return {
        ...current,
        versions: current.versions.map(version => (
          version.id !== activeVersion.id
            ? version
            : {
                ...version,
                nodes: [
                  ...version.nodes.filter(candidate => candidate.type !== 'output'),
                  { ...node, position: { x: 160 + version.nodes.length * 120, y: 80 } },
                  ...version.nodes.filter(candidate => candidate.type === 'output'),
                ],
                edges: nextEdges,
              }
        )),
        ui: { ...current.ui, selectedNodeId: node.id },
      };
    });

    return nodeId;
  },

  removeColorNode: (clipId, nodeId) => {
    let cleanupMatcher: ((property: string) => boolean) | null = null;

    get().updateColorCorrection(clipId, current => {
      const activeVersion = getActiveColorVersion(current);
      const node = activeVersion?.nodes.find(candidate => candidate.id === nodeId);
      if (!activeVersion || !node || node.type === 'input' || node.type === 'output') {
        return current;
      }

      cleanupMatcher = createColorPropertyMatcher(activeVersion.id, nodeId);

      const remainingNodes = activeVersion.nodes.filter(candidate => candidate.id !== nodeId);
      const serialNodes = remainingNodes.filter(candidate => candidate.type !== 'output');
      const outputNode = remainingNodes.find(candidate => candidate.type === 'output');
      const edges = serialNodes.slice(0, -1).map((candidate, index) => ({
        id: createColorNodeId('edge'),
        fromNodeId: candidate.id,
        fromPort: 'out',
        toNodeId: serialNodes[index + 1].id,
        toPort: 'in',
      }));
      if (serialNodes.length > 0 && outputNode) {
        edges.push({
          id: createColorNodeId('edge'),
          fromNodeId: serialNodes[serialNodes.length - 1].id,
          fromPort: 'out',
          toNodeId: outputNode.id,
          toPort: 'in',
        });
      }

      const selectedNodeId = current.ui.selectedNodeId === nodeId
        ? remainingNodes.find(candidate => candidate.type === 'primary')?.id
        : current.ui.selectedNodeId;

      return {
        ...current,
        versions: current.versions.map(version => (
          version.id !== activeVersion.id
            ? version
            : { ...version, nodes: remainingNodes, edges }
        )),
        ui: { ...current.ui, selectedNodeId },
      };
    });

    if (cleanupMatcher) {
      const { clipKeyframes, keyframeRecordingEnabled, selectedKeyframeIds, invalidateCache } = get();
      const cleanup = cleanupClipColorKeyframes(clipId, cleanupMatcher, {
        clipKeyframes,
        keyframeRecordingEnabled,
        selectedKeyframeIds,
      });
      if (cleanup.changed) {
        set({
          clipKeyframes: cleanup.clipKeyframes,
          keyframeRecordingEnabled: cleanup.keyframeRecordingEnabled,
          selectedKeyframeIds: cleanup.selectedKeyframeIds,
        });
        invalidateCache();
      }
    }
  },

  moveColorNode: (clipId, nodeId, position) => {
    get().updateColorCorrection(clipId, current => {
      const activeVersion = getActiveColorVersion(current);
      if (!activeVersion) return current;

      return {
        ...current,
        versions: current.versions.map(version => (
          version.id !== activeVersion.id
            ? version
            : {
                ...version,
                nodes: version.nodes.map(node =>
                  node.id === nodeId ? { ...node, position } : node
                ),
              }
        )),
      };
    });
  },

  connectColorNodes: (clipId, fromNodeId, toNodeId) => {
    get().updateColorCorrection(clipId, current => {
      const activeVersion = getActiveColorVersion(current);
      if (!activeVersion || fromNodeId === toNodeId) return current;

      const fromNode = activeVersion.nodes.find(node => node.id === fromNodeId);
      const toNode = activeVersion.nodes.find(node => node.id === toNodeId);
      if (!fromNode || !toNode || fromNode.type === 'output' || toNode.type === 'input') {
        return current;
      }

      const nextEdges = activeVersion.edges.filter(edge =>
        edge.fromNodeId !== fromNodeId &&
        edge.toNodeId !== toNodeId
      );

      const candidateEdges = [
        ...nextEdges,
        { fromNodeId, toNodeId },
      ];
      if (wouldCreateCycle(candidateEdges, fromNodeId, toNodeId)) {
        return current;
      }

      return {
        ...current,
        versions: current.versions.map(version => (
          version.id !== activeVersion.id
            ? version
            : {
                ...version,
                edges: [
                  ...nextEdges,
                  {
                    id: createColorNodeId('edge'),
                    fromNodeId,
                    fromPort: 'out',
                    toNodeId,
                    toPort: 'in',
                  },
                ],
              }
        )),
      };
    });
  },

  removeColorEdge: (clipId, edgeId) => {
    get().updateColorCorrection(clipId, current => {
      const activeVersion = getActiveColorVersion(current);
      if (!activeVersion) return current;

      return {
        ...current,
        versions: current.versions.map(version => (
          version.id !== activeVersion.id
            ? version
            : {
                ...version,
                edges: version.edges.filter(edge => edge.id !== edgeId),
              }
        )),
      };
    });
  },

  updateColorNodeParam: (clipId, versionId, nodeId, paramName, value: ColorParamValue) => {
    get().updateColorCorrection(clipId, current =>
      setColorNodeParamValue(current, versionId, nodeId, paramName, value)
    );
  },

  setColorNodeEnabled: (clipId, nodeId, enabled) => {
    get().updateColorCorrection(clipId, current => ({
      ...current,
      versions: current.versions.map(version => ({
        ...version,
        nodes: version.nodes.map(node =>
          node.id === nodeId ? { ...node, enabled } : node
        ),
      })),
    }));
  },

  renameColorNode: (clipId, nodeId, name) => {
    get().updateColorCorrection(clipId, current => ({
      ...current,
      versions: current.versions.map(version => ({
        ...version,
        nodes: version.nodes.map(node =>
          node.id === nodeId ? { ...node, name } : node
        ),
      })),
    }));
  },

  resetColorNode: (clipId, nodeId) => {
    get().updateColorCorrection(clipId, current => ({
      ...current,
      versions: current.versions.map(version => ({
        ...version,
        nodes: version.nodes.map(node =>
          node.id === nodeId && node.type === 'primary'
            ? { ...node, params: createPrimaryColorNode(node.id, node.name).params }
            : node
        ),
      })),
    }));
  },

  resetColorCorrection: (clipId) => {
    const { clips, clipKeyframes, keyframeRecordingEnabled, selectedKeyframeIds, invalidateCache } = get();
    const cleanup = cleanupClipColorKeyframes(clipId, createColorPropertyMatcher(), {
      clipKeyframes,
      keyframeRecordingEnabled,
      selectedKeyframeIds,
    });

    set({
      clips: clips.map(c =>
        c.id === clipId
          ? { ...c, colorCorrection: createDefaultColorCorrectionState() }
          : c
      ),
      ...(cleanup.changed ? {
        clipKeyframes: cleanup.clipKeyframes,
        keyframeRecordingEnabled: cleanup.keyframeRecordingEnabled,
        selectedKeyframeIds: cleanup.selectedKeyframeIds,
      } : {}),
    });
    invalidateCache();
  },

  duplicateColorVersion: (clipId) => {
    const versionId = createColorNodeId('version');
    get().updateColorCorrection(clipId, current => {
      const activeVersion = getActiveColorVersion(current);
      if (!activeVersion) return current;
      const clone = cloneColorCorrectionState({
        ...current,
        versions: [activeVersion],
      }).versions[0];

      return {
        ...current,
        activeVersionId: versionId,
        versions: [
          ...current.versions,
          {
            ...clone,
            id: versionId,
            name: String.fromCharCode(65 + Math.min(current.versions.length, 25)),
          },
        ],
      };
    });
    return versionId;
  },

  deleteColorVersion: (clipId, versionId) => {
    let cleanupMatcher: ((property: string) => boolean) | null = null;

    get().updateColorCorrection(clipId, current => {
      if (current.versions.length <= 1) return current;

      const versionIndex = current.versions.findIndex(version => version.id === versionId);
      if (versionIndex < 0) return current;

      const versions = current.versions.filter(version => version.id !== versionId);
      const nextActiveVersion = current.activeVersionId === versionId
        ? versions[Math.max(0, versionIndex - 1)] ?? versions[0]
        : versions.find(version => version.id === current.activeVersionId) ?? versions[0];
      cleanupMatcher = createColorPropertyMatcher(versionId);

      return {
        ...current,
        activeVersionId: nextActiveVersion.id,
        versions,
        ui: {
          ...current.ui,
          selectedNodeId: nextActiveVersion.nodes.find(node => node.type === 'primary')?.id,
        },
      };
    });

    if (cleanupMatcher) {
      const { clipKeyframes, keyframeRecordingEnabled, selectedKeyframeIds, invalidateCache } = get();
      const cleanup = cleanupClipColorKeyframes(clipId, cleanupMatcher, {
        clipKeyframes,
        keyframeRecordingEnabled,
        selectedKeyframeIds,
      });
      if (cleanup.changed) {
        set({
          clipKeyframes: cleanup.clipKeyframes,
          keyframeRecordingEnabled: cleanup.keyframeRecordingEnabled,
          selectedKeyframeIds: cleanup.selectedKeyframeIds,
        });
        invalidateCache();
      }
    }
  },

  setActiveColorVersion: (clipId, versionId) => {
    get().updateColorCorrection(clipId, current => ({
      ...current,
      activeVersionId: versionId,
    }));
  },
});
