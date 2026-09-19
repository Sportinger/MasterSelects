import type { MouseEvent } from 'react';
import type { FlockDefinition, FlockNode } from '../../../../types/flock';
import type { NodeGraphNode } from '../../../../services/nodeGraph';
import { getFlockPortType } from '../../../../services/nodeGraph';
import { checkFlockConnection } from '../../../../services/flock/graph/flockGraphValidation';
import {
  FLOCK_GROUP_OPERATOR_ID,
  getFlockOperator,
  resolveFlockNodePorts,
} from '../../../../services/flock/operators/flockOperatorRegistry';
import type { FlockGraphActions } from './useFlockGraphActions';

function nodeLabel(definition: FlockDefinition, node: FlockNode): string {
  if (node.label) return node.label;
  if (node.operator === FLOCK_GROUP_OPERATOR_ID) {
    return definition.groups.find((group) => group.id === node.groupRef)?.label ?? 'Group';
  }
  return getFlockOperator(node.operator)?.label ?? node.operator;
}

function blurAfterPointer(event: MouseEvent<HTMLButtonElement>): void {
  if (event.detail > 0) event.currentTarget.blur();
}

/**
 * Keyboard-accessible connection editing: every input lists its current
 * sources and a select of compatible upstream outputs.
 */
export function FlockPortConnections({
  definition,
  node,
  actions,
  onSelectNode,
}: {
  definition: FlockDefinition;
  node: NodeGraphNode;
  actions: FlockGraphActions;
  onSelectNode: (nodeId: string) => void;
}) {
  const findNode = (nodeId: string) => definition.nodes.find((candidate) => candidate.id === nodeId);

  return (
    <>
      <div className="node-workspace-inspector-section">
        <div className="node-workspace-inspector-section-title">Inputs</div>
        {node.inputs.length === 0 && <div className="node-workspace-inspector-empty">None</div>}
        {node.inputs.map((port) => {
          const flockType = getFlockPortType(port);
          const incoming = definition.edges.filter((edge) => edge.to.nodeId === node.id && edge.to.port === port.id);
          const candidates = definition.nodes
            .filter((candidate) => candidate.id !== node.id)
            .flatMap((candidate) => (resolveFlockNodePorts(candidate, definition)?.outputs ?? [])
              .filter((output) => output.type === flockType)
              .filter((output) => !incoming.some((edge) => edge.from.nodeId === candidate.id && edge.from.port === output.id))
              .filter((output) => checkFlockConnection(
                definition,
                { nodeId: candidate.id, port: output.id },
                { nodeId: node.id, port: port.id },
              ).ok)
              .map((output) => ({
                value: `${candidate.id}::${output.id}`,
                label: `${nodeLabel(definition, candidate)} › ${output.label}`,
              })));
          const missingRequired = port.metadata?.required === true && incoming.length === 0;

          return (
            <div key={port.id} className={`node-workspace-flock-port${missingRequired ? ' missing' : ''}`}>
              <div className="node-workspace-flock-port-head">
                <span>{port.label}{port.metadata?.required ? ' *' : ''}</span>
                <code>{flockType}{port.metadata?.repeated ? ' ×n' : ''}</code>
              </div>
              {incoming.map((edge) => {
                const source = findNode(edge.from.nodeId);
                return (
                  <div key={edge.id} className="node-workspace-flock-port-link">
                    <button
                      type="button"
                      className="node-workspace-flock-link-button"
                      onClick={(event) => {
                        blurAfterPointer(event);
                        onSelectNode(edge.from.nodeId);
                      }}
                    >
                      {source ? nodeLabel(definition, source) : edge.from.nodeId} › {edge.from.port}
                    </button>
                    <button
                      type="button"
                      className="node-workspace-flock-unlink"
                      aria-label={`Disconnect ${port.label}`}
                      title="Disconnect"
                      onClick={(event) => {
                        blurAfterPointer(event);
                        actions.disconnect(edge.id);
                      }}
                    >
                      ×
                    </button>
                  </div>
                );
              })}
              {(incoming.length === 0 || port.metadata?.repeated || candidates.length > 0) && (
                <select
                  className="node-workspace-flock-select"
                  value=""
                  aria-label={`Connect ${port.label}`}
                  disabled={candidates.length === 0}
                  onChange={(event) => {
                    const [fromNodeId, fromPortId] = event.target.value.split('::');
                    if (!fromNodeId || !fromPortId) return;
                    actions.connect({ fromNodeId, fromPortId, toNodeId: node.id, toPortId: port.id });
                  }}
                >
                  <option value="">
                    {candidates.length === 0
                      ? 'No compatible outputs'
                      : incoming.length > 0 && !port.metadata?.repeated ? 'Replace with…' : 'Connect…'}
                  </option>
                  {candidates.map((candidate) => (
                    <option key={candidate.value} value={candidate.value}>{candidate.label}</option>
                  ))}
                </select>
              )}
            </div>
          );
        })}
      </div>

      <div className="node-workspace-inspector-section">
        <div className="node-workspace-inspector-section-title">Outputs</div>
        {node.outputs.length === 0 && <div className="node-workspace-inspector-empty">None</div>}
        {node.outputs.map((port) => {
          const outgoing = definition.edges.filter((edge) => edge.from.nodeId === node.id && edge.from.port === port.id);
          return (
            <div key={port.id} className="node-workspace-flock-port">
              <div className="node-workspace-flock-port-head">
                <span>{port.label}</span>
                <code>{getFlockPortType(port)}</code>
              </div>
              {outgoing.length === 0 && <div className="node-workspace-inspector-empty">Not connected</div>}
              {outgoing.map((edge) => {
                const target = findNode(edge.to.nodeId);
                return (
                  <div key={edge.id} className="node-workspace-flock-port-link">
                    <button
                      type="button"
                      className="node-workspace-flock-link-button"
                      onClick={(event) => {
                        blurAfterPointer(event);
                        onSelectNode(edge.to.nodeId);
                      }}
                    >
                      → {target ? nodeLabel(definition, target) : edge.to.nodeId} › {edge.to.port}
                    </button>
                    <button
                      type="button"
                      className="node-workspace-flock-unlink"
                      aria-label={`Disconnect ${port.label}`}
                      title="Disconnect"
                      onClick={(event) => {
                        blurAfterPointer(event);
                        actions.disconnect(edge.id);
                      }}
                    >
                      ×
                    </button>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </>
  );
}
