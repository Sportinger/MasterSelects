import type {
  FlockCacheSettings,
  FlockDefinition,
  FlockExposedParam,
  FlockGroupDefinition,
  FlockNodeLayout,
  FlockParamValue,
  FlockPortRef,
  FlockTimeSettings,
} from '../../../types/flock';

export interface FlockClipActions {
  addFlockClip: (trackId: string, startTime: number, options?: { duration?: number; presetId?: string; name?: string }) => string | null;
  applyFlockPreset: (clipId: string, presetId: string) => boolean;
  replaceFlockDefinition: (clipId: string, definition: FlockDefinition) => boolean;
  addFlockGraphNode: (
    clipId: string,
    operatorId: string,
    options?: { layout?: FlockNodeLayout; params?: Record<string, FlockParamValue>; label?: string; groupRef?: string },
  ) => string | null;
  removeFlockGraphNodes: (clipId: string, nodeIds: string[]) => boolean;
  connectFlockGraphPorts: (
    clipId: string,
    from: FlockPortRef,
    to: FlockPortRef,
  ) => { ok: true; edgeId: string; replacedEdgeId?: string } | { ok: false; code: string; message: string };
  disconnectFlockGraphEdge: (clipId: string, edgeId: string) => boolean;
  setFlockGraphParam: (clipId: string, nodeId: string, paramId: string, value: FlockParamValue) => boolean;
  setFlockGraphBypass: (clipId: string, nodeId: string, bypassed: boolean) => boolean;
  moveFlockGraphNode: (clipId: string, nodeId: string, x: number, y: number) => void;
  renameFlockGraphNode: (clipId: string, nodeId: string, label: string) => boolean;
  duplicateFlockGraphNodes: (clipId: string, nodeIds: string[]) => Record<string, string> | null;
  exposeFlockGraphParam: (
    clipId: string,
    nodeId: string,
    paramId: string,
    options?: { label?: string; group?: string; min?: number; max?: number },
  ) => string | null;
  unexposeFlockGraphParam: (clipId: string, exposedId: string) => boolean;
  updateFlockExposedParam: (
    clipId: string,
    exposedId: string,
    patch: Partial<Pick<FlockExposedParam, 'label' | 'group' | 'order' | 'min' | 'max'>>,
  ) => boolean;
  groupFlockGraphNodes: (clipId: string, nodeIds: string[], label?: string) => string | null;
  /** Inlines a group instance; returns inner group node id -> new node id. */
  ungroupFlockGraphNode: (clipId: string, groupNodeId: string) => Record<string, string> | null;
  insertFlockGroupDefinition: (clipId: string, group: FlockGroupDefinition, layout?: FlockNodeLayout) => string | null;
  setFlockTimeSettings: (clipId: string, patch: Partial<FlockTimeSettings>) => void;
  setFlockCacheSettings: (clipId: string, patch: Partial<FlockCacheSettings>) => void;
  setFlockParamFromProperty: (clipId: string, property: string, value: number) => boolean;
  getFlockParamForProperty: (clipId: string, property: string) => number | undefined;
}
