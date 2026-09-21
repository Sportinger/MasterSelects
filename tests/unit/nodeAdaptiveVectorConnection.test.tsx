import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { NodeGraphCanvas } from '../../src/components/panels/nodes/NodeGraphCanvas';
import { getEffectOperator } from '../../src/services/operators/operatorRegistry';
import { operatorAdaptiveVariants } from '../../src/services/operators/operatorAdaptiveVariants';
import { IMAGE_OPERATORS } from '../../src/services/operators/imageOperators';
import { projectOperatorPort } from '../../src/services/nodeGraph/effectGraphProjection';
import type { NodeGraph, NodeGraphNode } from '../../src/types/nodeGraph';

function projectedNode(id: string, operatorId: string, x: number): NodeGraphNode {
  const operator = getEffectOperator(operatorId)!;
  return { id, operatorId, label: operator.label, kind: 'effect', runtime: operator.runtime, layout: { x, y: 50 },
    connectionVariants: operatorAdaptiveVariants(operator, IMAGE_OPERATORS),
    inputs: operator.inputs.map(port => projectOperatorPort(port, 'input')),
    outputs: operator.outputs.map(port => projectOperatorPort(port, 'output')) };
}

const graph: NodeGraph = { id: 'adaptive-vector', owner: { kind: 'clip', id: 'fixture', name: 'Fixture' }, edges: [], nodes: [
  projectedNode('combine', 'vector.combine.vec3', 40), projectedNode('split', 'vector.split.vec4', 400),
] };

function pointer(target: Element, type: string, x: number, y: number) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, Object.fromEntries(Object.entries({ clientX: x, clientY: y, pointerId: 9, pointerType: 'mouse', button: 0 })
    .map(([key, value]) => [key, { value }])));
  fireEvent(target, event);
}

const hit = vi.fn();
beforeEach(() => {
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: hit });
  HTMLElement.prototype.setPointerCapture = vi.fn(); HTMLElement.prototype.hasPointerCapture = vi.fn(() => true); HTMLElement.prototype.releasePointerCapture = vi.fn();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); hit.mockReset(); });

describe('adaptive vector connection drag', () => {
  it('lets the owner atomically adapt a combine/split family variant instead of rejecting the cable in UI preflight', () => {
    const connect = vi.fn();
    const view = render(<NodeGraphCanvas graph={graph} selectedNodeId={null} onSelectNode={vi.fn()} onConnectPorts={connect} />);
    const canvas = view.container.querySelector('.node-workspace-canvas')!;
    const output = view.container.querySelector('.node-workspace-port[data-node-id="combine"][data-port-id="value"]')!;
    const input = view.container.querySelector('.node-workspace-port[data-node-id="split"][data-port-id="value"]')!;
    hit.mockReturnValue(input);
    pointer(output, 'pointerdown', 10, 10); pointer(canvas, 'pointermove', 100, 100); pointer(canvas, 'pointerup', 100, 100);
    expect(connect).toHaveBeenCalledExactlyOnceWith({ fromNodeId: 'combine', fromPortId: 'value', toNodeId: 'split', toPortId: 'value' });
  });
});
