import type { NodeGraphNode } from '../../../../types/nodeGraph';
import { previewOutput } from '../../../../services/nodePreview/previewTypes';
import { getNodeHeight } from '../canvas/canvasGeometry';
import { previewRect } from './previewGeometry';
import './NodePreviewControls.css';

interface Props { node: NodeGraphNode; onToggle: (id: string) => void; onOutput: (id: string, port: string) => void }
export function NodeViewerButton({ node, onToggle }: Pick<Props, 'node' | 'onToggle'>) {
  return <button type="button" className={`node-viewer-toggle${node.preview?.requested ? ' active' : ''}`}
    title="Toggle node preview" aria-label={`Preview ${node.label}`} aria-pressed={!!node.preview?.requested}
    onPointerDown={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}
    onClick={event => { event.stopPropagation(); onToggle(node.id); if (event.detail > 0) event.currentTarget.blur(); }}>◉</button>;
}

export function NodePreviewOutput({ node, onOutput }: Pick<Props, 'node' | 'onOutput'>) {
  if (!node.preview?.enabled) return null;
  const ports = node.outputs.length ? node.outputs : node.inputs, selected = previewOutput(node, node.preview.portId);
  const rect = previewRect(getNodeHeight(node), node);
  return <div className="node-preview-controls" style={{ left: rect.x, top: rect.y, width: rect.width }}>
    {ports.length > 1 ? <select aria-label={`Preview output for ${node.label}`} value={selected?.id ?? ''}
      onPointerDown={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()}
      onChange={event => { onOutput(node.id, event.target.value); }}>
      {ports.map(port => <option key={port.id} value={port.id}>{port.label}</option>)}
    </select> : <span>{selected?.label ?? 'Values'}</span>}
  </div>;
}
