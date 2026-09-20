import { checkGraphConnection } from '../../services/nodeGraph/graphConnections';
import { colorNodePorts, colorPortSignal } from '../../services/nodeGraph/colorGraphPorts';
import {
  COLOR_FIXED_ANCHOR_SPACING,
  cloneColorCorrectionState,
  createColorNode,
  createColorNodeId,
  createDefaultColorCorrectionState,
  ensureColorCorrectionState,
  getActiveColorVersion,
  isColorGradeNode,
  isFixedColorAnchorNode,
  setColorNodeParamValue,
  type ColorCorrectionState,
  type ColorNode,
  type ColorParamValue,
  type ColorViewMode,
} from '../../types/colorCorrection';
import type { ColorCorrectionActions, Keyframe, SliceCreator } from './types';
import { updateClipColorCorrectionWithRemoteSync } from '../../types/colorGradeOwnership';

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
      clips: updateClipColorCorrectionWithRemoteSync(
        clips,
        clipId,
        current => updateClipColorState(current, updater),
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

  setColorNodeDisplayMode: (clipId, nodeDisplayMode) => {
    get().updateColorCorrection(clipId, current => ({
      ...current,
      ui: { ...current.ui, nodeDisplayMode },
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
    const node: ColorNode = createColorNode(type, nodeId);

    get().updateColorCorrection(clipId, current => {
      const activeVersion = getActiveColorVersion(current);
      if (!activeVersion) return current;

      if (type === 'alpha-output') {
        const existing = activeVersion.nodes.find(candidate => candidate.type === 'alpha-output');
        if (existing) {
          node.id = existing.id;
          return { ...current, ui: { ...current.ui, selectedNodeId: existing.id } };
        }
      }

      const originalAnchor = activeVersion.nodes.find(candidate => (
        type === 'source' ? candidate.type === 'input' : candidate.type === 'output'
      ));
      const sourceIndex = type === 'source'
        ? activeVersion.nodes.filter(candidate => candidate.type === 'source').length
        : 0;
      const nodePosition = originalAnchor && (type === 'source' || type === 'alpha-output')
        ? {
            x: originalAnchor.position.x,
            y: originalAnchor.position.y + (sourceIndex + 1) * COLOR_FIXED_ANCHOR_SPACING,
          }
        : {
            x: 180 + activeVersion.nodes.length * 34,
            y: 176 + activeVersion.nodes.length * 18,
          };

      return {
        ...current,
        versions: current.versions.map(version => (
          version.id !== activeVersion.id
            ? version
            : {
                ...version,
                nodes: [
                  ...version.nodes.filter(candidate => candidate.type !== 'output'),
                  { ...node, position: nodePosition },
                  ...version.nodes.filter(candidate => candidate.type === 'output'),
                ],
                edges: [...version.edges],
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
      if (!activeVersion || !node || isFixedColorAnchorNode(node)) {
        return current;
      }

      cleanupMatcher = createColorPropertyMatcher(activeVersion.id, nodeId);

      const remainingNodes = activeVersion.nodes.filter(candidate => candidate.id !== nodeId);
      const incoming = activeVersion.edges.filter(edge => edge.toNodeId === nodeId);
      const outgoing = activeVersion.edges.filter(edge => edge.fromNodeId === nodeId);
      const edges = activeVersion.edges.filter(edge => (
        edge.fromNodeId !== nodeId && edge.toNodeId !== nodeId
      ));
      (['texture', 'mask'] as const).forEach(signal => {
        const signalIncoming = incoming.filter(edge => colorPortSignal(edge.fromPort) === signal);
        const signalOutgoing = outgoing.filter(edge => colorPortSignal(edge.toPort) === signal);
        if (signalIncoming.length !== 1 || signalOutgoing.length !== 1) return;
        edges.push({
          id: createColorNodeId('edge'),
          fromNodeId: signalIncoming[0].fromNodeId,
          fromPort: signalIncoming[0].fromPort,
          toNodeId: signalOutgoing[0].toNodeId,
          toPort: signalOutgoing[0].toPort,
        });
      });

      const selectedNodeId = current.ui.selectedNodeId === nodeId
        ? remainingNodes.find(isColorGradeNode)?.id
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

  connectColorNodes: (clipId, fromNodeId, toNodeId, fromPort = 'out', toPort = 'in') => {
    get().updateColorCorrection(clipId, current => {
      const activeVersion = getActiveColorVersion(current);
      if (!activeVersion || fromNodeId === toNodeId) return current;

      const graph = {
        nodes: activeVersion.nodes.map(node => ({ id: node.id, ...colorNodePorts(node) })),
        edges: activeVersion.edges.map(edge => ({ ...edge, fromPortId: edge.fromPort, toPortId: edge.toPort })),
      };
      const check = checkGraphConnection(graph, { fromNodeId, fromPortId: fromPort, toNodeId, toPortId: toPort });
      if (!check.ok) return current;
      const nextEdges = activeVersion.edges.filter(edge => edge.id !== check.replacesEdgeId);

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
                    fromPort,
                    toNodeId,
                    toPort,
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
          node.id === nodeId && node.type !== 'input' && node.type !== 'output'
            ? { ...node, params: createColorNode(node.type, node.id, node.name).params }
            : node
        ),
      })),
    }));
  },

  resetColorNodeStackLayers: (clipId) => {
    get().updateColorCorrection(clipId, current => ({
      ...current,
      versions: current.versions.map(version => ({
        ...version,
        nodes: version.nodes.map(node => isColorGradeNode(node)
          ? { ...node, params: { ...node.params, stackLayer: 0 } }
          : node),
      })),
    }));
  },

  initializeColorNodeGraphLayout: (clipId, width, height, force = false) => {
    get().updateColorCorrection(clipId, current => {
      if (!force && current.ui.nodeLayoutVersion === 2) return current;
      const activeVersion = getActiveColorVersion(current);
      if (!activeVersion) return current;
      const gradeNodes = activeVersion.nodes.filter(isColorGradeNode);
      const sourceNodes = activeVersion.nodes.filter(node => node.type === 'source');
      const gradeLaneY = Math.max(64, Math.round(height * 0.4));
      const anchorLaneY = Math.max(64, Math.round(height * 0.49));
      const gradeStartX = Math.max(96, Math.round(width * 0.35));
      const rightAnchorX = Math.max(340, Math.round(width) - 25);

      return {
        ...current,
        versions: current.versions.map(version => version.id !== activeVersion.id
          ? version
          : {
              ...version,
              nodes: version.nodes.map(node => {
                if (node.type === 'input') return { ...node, position: { x: 8, y: anchorLaneY } };
                if (node.type === 'output') return { ...node, position: { x: rightAnchorX, y: anchorLaneY } };
                if (node.type === 'source') {
                  const sourceIndex = sourceNodes.findIndex(source => source.id === node.id);
                  return {
                    ...node,
                    position: {
                      x: 8,
                      y: anchorLaneY + (sourceIndex + 1) * COLOR_FIXED_ANCHOR_SPACING,
                    },
                  };
                }
                if (node.type === 'alpha-output') {
                  return {
                    ...node,
                    position: {
                      x: rightAnchorX,
                      y: anchorLaneY + COLOR_FIXED_ANCHOR_SPACING,
                    },
                  };
                }
                const gradeIndex = gradeNodes.findIndex(grade => grade.id === node.id);
                if (gradeIndex >= 0) {
                  return { ...node, position: { x: gradeStartX + gradeIndex * 92, y: gradeLaneY } };
                }
                return node;
              }),
            }),
        ui: {
          ...current.ui,
          nodeLayoutVersion: 2,
          workspaceViewport: { x: 0, y: 0, zoom: 1 },
        },
      };
    });
  },

  resetColorCorrection: (clipId) => {
    const { clips, clipKeyframes, keyframeRecordingEnabled, selectedKeyframeIds, invalidateCache } = get();
    const cleanup = cleanupClipColorKeyframes(clipId, createColorPropertyMatcher(), {
      clipKeyframes,
      keyframeRecordingEnabled,
      selectedKeyframeIds,
    });

    set({
      clips: updateClipColorCorrectionWithRemoteSync(
        clips,
        clipId,
        () => createDefaultColorCorrectionState(),
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
          selectedNodeId: nextActiveVersion.nodes.find(node => node.type !== 'input' && node.type !== 'output')?.id,
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
