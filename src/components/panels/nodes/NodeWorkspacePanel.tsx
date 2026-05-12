import { useCallback, useMemo, useState } from 'react';
import type { NodeGraphNode, NodeGraphPort } from '../../../services/nodeGraph';
import { useDockStore } from '../../../stores/dockStore';
import { NodeGraphCanvas } from './NodeGraphCanvas';
import { useNodeGraphSubject } from './useNodeGraphSubject';
import './NodeWorkspacePanel.css';

function formatParamValue(value: string | number | boolean): string {
  if (typeof value === 'number') {
    return Number.isInteger(value) ? String(value) : value.toFixed(3).replace(/\.?0+$/, '');
  }
  return String(value);
}

function PortList({ title, ports }: { title: string; ports: NodeGraphPort[] }) {
  return (
    <div className="node-workspace-inspector-section">
      <div className="node-workspace-inspector-section-title">{title}</div>
      {ports.length > 0 ? (
        <div className="node-workspace-inspector-ports">
          {ports.map((port) => (
            <div key={port.id} className="node-workspace-inspector-port">
              <span>{port.label}</span>
              <span>{port.type}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="node-workspace-inspector-empty">None</div>
      )}
    </div>
  );
}

function NodeInspector({ node, onOpenProperties }: { node: NodeGraphNode | null; onOpenProperties: () => void }) {
  const params = Object.entries(node?.params ?? {});

  if (!node) {
    return (
      <aside className="node-workspace-inspector">
        <div className="node-workspace-inspector-empty">Select a node</div>
      </aside>
    );
  }

  return (
    <aside className="node-workspace-inspector">
      <div className="node-workspace-inspector-header">
        <span>{node.kind}</span>
        <h3>{node.label}</h3>
        <p>{node.description}</p>
      </div>

      <div className="node-workspace-inspector-meta">
        <div>
          <span>Runtime</span>
          <strong>{node.runtime}</strong>
        </div>
        {node.sourceType && (
          <div>
            <span>Source</span>
            <strong>{node.sourceType}</strong>
          </div>
        )}
      </div>

      <PortList title="Inputs" ports={node.inputs} />
      <PortList title="Outputs" ports={node.outputs} />

      <div className="node-workspace-inspector-section">
        <div className="node-workspace-inspector-section-title">Parameters</div>
        {params.length > 0 ? (
          <div className="node-workspace-param-list">
            {params.map(([key, value]) => (
              <div key={key} className="node-workspace-param">
                <span>{key}</span>
                <strong>{formatParamValue(value)}</strong>
              </div>
            ))}
          </div>
        ) : (
          <div className="node-workspace-inspector-empty">None</div>
        )}
      </div>

      <button type="button" className="node-workspace-primary-action" onClick={onOpenProperties}>
        Open Properties
      </button>
    </aside>
  );
}

export function NodeWorkspacePanel() {
  const subject = useNodeGraphSubject();
  const [selection, setSelection] = useState<{ graphId: string | null; nodeId: string | null }>({
    graphId: null,
    nodeId: null,
  });
  const selectedNodeId = selection.graphId === subject?.graph.id
    ? selection.nodeId
    : subject?.graph.nodes[0]?.id ?? null;

  const selectedNode = useMemo(() => {
    if (!subject) return null;
    return subject.graph.nodes.find((node) => node.id === selectedNodeId) ?? subject.graph.nodes[0] ?? null;
  }, [selectedNodeId, subject]);

  const selectNode = useCallback((nodeId: string) => {
    setSelection({
      graphId: subject?.graph.id ?? null,
      nodeId,
    });
  }, [subject?.graph.id]);

  const openProperties = useCallback(() => {
    useDockStore.getState().activatePanelType('clip-properties');
  }, []);

  if (!subject) {
    return (
      <div className="node-workspace-panel">
        <div className="node-workspace-empty-state">
          <h3>Nodes</h3>
          <p>Select a timeline clip</p>
        </div>
      </div>
    );
  }

  return (
    <div className="node-workspace-panel">
      <div className="node-workspace-main">
        <NodeGraphCanvas
          graph={subject.graph}
          selectedNodeId={selectedNode?.id ?? null}
          onSelectNode={selectNode}
        />
      </div>
      <NodeInspector node={selectedNode} onOpenProperties={openProperties} />
    </div>
  );
}
