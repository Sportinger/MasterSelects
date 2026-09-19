import {
  FLOCK_DEFINITION_VERSION,
  type FlockDefinition,
  type FlockEdge,
  type FlockExposedParam,
  type FlockNode,
  type FlockNodeLayout,
  type FlockParamValue,
} from '../../../types/flock';
import { createFlockNode, generateFlockNodeId, getFlockOperator } from '../operators/flockOperatorRegistry';

/** Small fluent helper for authoring preset graphs in code. */
export class FlockGraphBuilder {
  private readonly nodes: FlockNode[] = [];
  private readonly edges: FlockEdge[] = [];
  private readonly exposed: FlockExposedParam[] = [];
  private readonly layout: Record<string, FlockNodeLayout> = {};

  add(
    operatorId: string,
    params: Record<string, FlockParamValue> = {},
    position: [number, number] = [0, 0],
    label?: string,
  ): string {
    const node = createFlockNode(operatorId, { params, label });
    this.nodes.push(node);
    this.layout[node.id] = { x: position[0], y: position[1] };
    return node.id;
  }

  connect(fromNodeId: string, fromPort: string, toNodeId: string, toPort: string): this {
    this.edges.push({
      id: generateFlockNodeId('fe'),
      from: { nodeId: fromNodeId, port: fromPort },
      to: { nodeId: toNodeId, port: toPort },
    });
    return this;
  }

  expose(nodeId: string, param: string, group: string, label?: string, range?: { min?: number; max?: number }): this {
    const node = this.nodes.find((candidate) => candidate.id === nodeId);
    const descriptor = node ? getFlockOperator(node.operator)?.params.find((candidate) => candidate.id === param) : undefined;
    this.exposed.push({
      id: generateFlockNodeId('fx'),
      nodeId,
      param,
      label: label ?? descriptor?.label ?? param,
      group,
      order: this.exposed.length,
      ...(range?.min !== undefined ? { min: range.min } : {}),
      ...(range?.max !== undefined ? { max: range.max } : {}),
    });
    return this;
  }

  build(presetId: string, time: FlockDefinition['time'] = { loop: 'none', loopSeconds: 10 }): FlockDefinition {
    return {
      version: FLOCK_DEFINITION_VERSION,
      presetId,
      nodes: structuredClone(this.nodes),
      edges: structuredClone(this.edges),
      exposed: structuredClone(this.exposed),
      groups: [],
      layout: structuredClone(this.layout),
      time: { ...time },
    };
  }
}
