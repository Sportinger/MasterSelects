import type {
  FlockDefinition,
  FlockDiagnostic,
  FlockEdge,
  FlockNode,
  FlockParamValue,
  FlockPortRef,
} from '../../../types/flock';
import { FLOCK_GROUP_OPERATOR_ID } from '../operators/flockOperatorRegistry';

export const FLOCK_GROUP_MAX_DEPTH = 4;
export const FLOCK_GROUP_ID_SEPARATOR = '__';
/** Edge source used for outputs of bypassed group instances; never resolves to a node, so consumers see a muted input. */
export const FLOCK_MUTED_NODE_ID = '__muted__';

/** Where an expanded node's parameter is authored (and keyframed). */
export interface FlockParamOwner {
  nodeId: string;
  paramKey: string;
}

export interface ExpandedFlockGraph {
  nodes: FlockNode[];
  edges: FlockEdge[];
  diagnostics: FlockDiagnostic[];
  /** expanded node id -> authored node id that should receive diagnostics / selection */
  sourceNodeIds: Map<string, string>;
  /** `${expandedNodeId}.${param}` -> authored owner (group instances override inner params) */
  paramOwners: Map<string, FlockParamOwner>;
}

/** Instance override key for an inner group parameter: `${innerNodeId}__${paramId}`. */
export function groupOverrideKey(innerNodeId: string, paramId: string): string {
  return `${innerNodeId}${FLOCK_GROUP_ID_SEPARATOR}${paramId}`;
}

export function expandFlockGroups(definition: FlockDefinition): ExpandedFlockGraph {
  const diagnostics: FlockDiagnostic[] = [];
  const sourceNodeIds = new Map<string, string>();
  const paramOwners = new Map<string, FlockParamOwner>();

  const expandLevel = (
    nodes: FlockNode[],
    edges: FlockEdge[],
    prefix: string,
    rootNodeId: string | null,
    ownerChain: Array<{ nodeId: string; keyPrefix: string; overrides: Record<string, FlockParamValue> }>,
    stack: string[],
  ): { nodes: FlockNode[]; edges: FlockEdge[]; inputMap: Map<string, FlockPortRef>; outputMap: Map<string, FlockPortRef> } => {
    const outNodes: FlockNode[] = [];
    const outEdges: FlockEdge[] = [];
    // `${nodeId}:${port}` of a group instance -> expanded inner port
    const groupInputs = new Map<string, FlockPortRef>();
    const groupOutputs = new Map<string, FlockPortRef>();

    for (const node of nodes) {
      const expandedId = `${prefix}${node.id}`;
      const authoredId = rootNodeId ?? node.id;
      if (node.operator !== FLOCK_GROUP_OPERATOR_ID) {
        const params: Record<string, FlockParamValue> = { ...node.params };
        for (const paramId of Object.keys(params)) {
          let owner: FlockParamOwner = { nodeId: node.id, paramKey: paramId };
          // Outermost instance override wins; inner overrides apply otherwise.
          let key = paramId;
          let innerId = node.id;
          for (let level = ownerChain.length - 1; level >= 0; level -= 1) {
            key = groupOverrideKey(innerId, key);
            const chain = ownerChain[level];
            if (Object.prototype.hasOwnProperty.call(chain.overrides, key)) {
              params[paramId] = chain.overrides[key];
            }
            owner = { nodeId: chain.nodeId, paramKey: key };
            innerId = chain.nodeId;
          }
          paramOwners.set(`${expandedId}.${paramId}`, owner);
        }
        outNodes.push({ ...node, id: expandedId, params });
        sourceNodeIds.set(expandedId, authoredId);
        continue;
      }

      const group = definition.groups.find((candidate) => candidate.id === node.groupRef);
      if (!group) {
        diagnostics.push({
          code: 'group-missing',
          severity: 'error',
          message: `Group definition "${node.groupRef ?? '?'}" is missing.`,
          nodeIds: [authoredId],
        });
        continue;
      }
      if (stack.includes(group.id) || stack.length >= FLOCK_GROUP_MAX_DEPTH) {
        diagnostics.push({
          code: stack.includes(group.id) ? 'group-recursion' : 'group-depth',
          severity: 'error',
          message: stack.includes(group.id)
            ? `Group "${group.label}" contains itself.`
            : `Groups nest deeper than ${FLOCK_GROUP_MAX_DEPTH} levels.`,
          nodeIds: [authoredId],
        });
        continue;
      }

      const inner = expandLevel(
        group.nodes,
        group.edges,
        `${expandedId}${FLOCK_GROUP_ID_SEPARATOR}`,
        authoredId,
        [...ownerChain, { nodeId: node.id, keyPrefix: '', overrides: node.params }],
        [...stack, group.id],
      );
      outNodes.push(...inner.nodes);
      outEdges.push(...inner.edges);
      for (const binding of group.inputs) {
        const nestedTarget = inner.inputMap.get(`${binding.target.nodeId}:${binding.target.port}`);
        groupInputs.set(`${node.id}:${binding.id}`, nestedTarget ?? {
          nodeId: `${expandedId}${FLOCK_GROUP_ID_SEPARATOR}${binding.target.nodeId}`,
          port: binding.target.port,
        });
      }
      for (const binding of group.outputs) {
        const nestedTarget = inner.outputMap.get(`${binding.target.nodeId}:${binding.target.port}`);
        groupOutputs.set(`${node.id}:${binding.id}`, node.bypassed
          ? { nodeId: FLOCK_MUTED_NODE_ID, port: binding.id }
          : nestedTarget ?? {
              nodeId: `${expandedId}${FLOCK_GROUP_ID_SEPARATOR}${binding.target.nodeId}`,
              port: binding.target.port,
            });
      }
    }

    for (const edge of edges) {
      const from = groupOutputs.get(`${edge.from.nodeId}:${edge.from.port}`)
        ?? { nodeId: `${prefix}${edge.from.nodeId}`, port: edge.from.port };
      const to = groupInputs.get(`${edge.to.nodeId}:${edge.to.port}`)
        ?? { nodeId: `${prefix}${edge.to.nodeId}`, port: edge.to.port };
      outEdges.push({ id: `${prefix}${edge.id}`, from, to });
    }

    return { nodes: outNodes, edges: outEdges, inputMap: groupInputs, outputMap: groupOutputs };
  };

  const expanded = expandLevel(definition.nodes, definition.edges, '', null, [], []);
  return {
    nodes: expanded.nodes,
    edges: expanded.edges,
    diagnostics,
    sourceNodeIds,
    paramOwners,
  };
}

/** Does adding `groupId` as a node inside `hostGroupId` create a recursive group chain? */
export function wouldCreateGroupRecursion(
  definition: Pick<FlockDefinition, 'groups'>,
  hostGroupId: string,
  groupId: string,
): boolean {
  const visit = (current: string, seen: Set<string>): boolean => {
    if (current === hostGroupId) return true;
    if (seen.has(current)) return false;
    seen.add(current);
    const group = definition.groups.find((candidate) => candidate.id === current);
    return !!group?.nodes.some((node) => (
      node.operator === FLOCK_GROUP_OPERATOR_ID && !!node.groupRef && visit(node.groupRef, seen)
    ));
  };
  return visit(groupId, new Set());
}
