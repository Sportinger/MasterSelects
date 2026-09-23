import type { BoundOperatorNode, EffectOperatorGraph, OperatorDefinition, OperatorEndpoint, OperatorPort } from '../../types/operatorGraph';

export type FieldRef = OperatorEndpoint | { input: string };

/** Builds pure field recipes with explicit boundaries; never consults an effect or the runtime registry. */
export class FieldCompositionBuilder {
  private nodes: BoundOperatorNode[] = [];
  private edges: EffectOperatorGraph['edges'] = [];
  private ports: OperatorPort[] = [];
  private inputs: Record<string, OperatorEndpoint[]> = {};

  input(id: string, label: string, type: OperatorPort['type'] = 'number'): FieldRef {
    this.ports.push({ id, label, type, required: true });
    this.inputs[id] = [];
    return { input: id };
  }

  node(id: string, operator: string, inputs: Record<string, FieldRef> = {}, portId = 'value', value?: number): OperatorEndpoint {
    this.nodes.push({ id, operator, operatorVersion: 1, bindings: {}, ...(value === undefined ? {} : { constants: { value } }) });
    for (const [input, ref] of Object.entries(inputs)) {
      if ('input' in ref) this.inputs[ref.input].push({ nodeId: id, portId: input });
      else this.edges.push({ id: `${id}-${input}`, from: ref.nodeId, output: ref.portId, to: id, input });
    }
    return { nodeId: id, portId };
  }

  literal(id: string, value: number) { return this.node(id, 'values.number', {}, 'value', value); }
  unary(id: string, operator: string, value: FieldRef) { return this.node(id, operator, { value }); }
  binary(id: string, operator: string, a: FieldRef, b: FieldRef) { return this.node(id, operator, { a, b }); }
  mix(id: string, a: FieldRef, b: FieldRef, t: FieldRef) { return this.node(id, 'math.mix.scalar', { a, b, t }); }
  select(id: string, condition: FieldRef, falseValue: FieldRef, trueValue: FieldRef) {
    return this.node(id, 'select.scalar', { condition, falseValue, trueValue });
  }
  greater(id: string, a: FieldRef, b: FieldRef) { return this.node(id, 'compare.greater.scalar', { a, b }, 'condition'); }

  finish(id: string, label: string, description: string, outputs: Record<string, { ref: OperatorEndpoint; type?: OperatorPort['type']; label?: string }>): OperatorDefinition {
    if (this.ports.some(port => !this.inputs[port.id].length)) throw new Error(`Unused field composition input in ${id}.`);
    return { id, label, description, version: 1, inputs: this.ports,
      outputs: Object.entries(outputs).map(([key, value]) => ({ id: key, type: value.type ?? 'number', label: value.label ?? key })),
      parameters: [], runtime: 'builtin', invalidates: 'appearance', state: 'stateless', fusion: 'inline',
      implementation: 'shared', consumers: ['Image graphs'], addable: true,
      composition: { inputs: this.inputs, outputs: Object.fromEntries(Object.entries(outputs).map(([key, value]) => [key, value.ref])),
        graph: { version: 1, schemaVersion: 1, domain: 'image', nodes: this.nodes, edges: this.edges,
          layout: Object.fromEntries(this.nodes.map((node, index) => [node.id, { x: (index % 5) * 280, y: Math.floor(index / 5) * 220 }])) } } };
  }
}
