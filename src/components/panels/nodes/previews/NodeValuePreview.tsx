import { useState } from 'react';
import type { NodeGraphNode } from '../../../../types/nodeGraph';
import { useNodeValueFrame } from './useNodeValueFrame';
import { editPreviewValue } from '../../../../services/nodePreview/editPreviewValue';
import { PreviewNumber } from './PreviewNumber';
import { getNodeHeight, getPortCenter } from '../canvas/canvasGeometry';
import { inlineNumericPorts, previewRect } from './previewGeometry';
import type { PreviewValueControl } from '../../../../services/nodePreview/previewTypes';
import './NodeValuePreview.css';
import { OperatorColorInput } from '../workspace/OperatorColorInput';
import { InspectorSelect } from '../../../inspector/InspectorSelect';

/** Canvas owns idle visuals. DOM controls remain transparent interaction and
 * accessibility targets, revealed only for editing or keyboard focus. */
export function NodeValuePreview({ node, canvasRendered = false }: { node: NodeGraphNode; canvasRendered?: boolean }) {
  const key = node.preview?.key ?? '';
  const frame = useNodeValueFrame(key);
  const [error, setError] = useState('');
  if (!node.preview?.enabled || !frame) return null;
  const rect = previewRect(getNodeHeight(node), node), drawing = frame.drawing;
  const change = (control: PreviewValueControl, value: number | boolean | string) => {
    try { editPreviewValue(control, value); setError(''); return true; }
    catch (error) { setError(String(error)); return false; }
  };
  const control = (entry: PreviewValueControl) => <label key={entry.target.parameter} className="node-value-row">
    <span>{entry.label}</span>
    {typeof entry.value === 'boolean' ? <input type="checkbox" aria-label={`${node.label} ${entry.label} inline`} checked={entry.value}
      onChange={event => change(entry, event.target.checked)} onClick={event => event.currentTarget.blur()} />
      : typeof entry.value === 'string' && entry.options?.length ? <InspectorSelect ariaLabel={`${node.label} ${entry.label} inline`}
        value={entry.value} options={[...entry.options]} onChange={value => change(entry, value)} onReset={() => change(entry, entry.defaultValue)} />
      : typeof entry.value === 'string' ? <OperatorColorInput ariaLabel={`${node.label} ${entry.label} inline`} value={entry.value}
        onChange={value => change(entry, value)} />
      : <PreviewNumber entry={entry} revision={frame.revision} nodeId={node.id} label={`${node.label} ${entry.label} inline`}
          onChange={value => change(entry, value)} />}
  </label>;
  if (inlineNumericPorts(node)) {
    const entries = frame.controls?.filter(entry => entry.portId) ?? [];
    const editablePorts = new Set(entries.map(entry => `${entry.direction ?? 'input'}:${entry.portId}`));
    return <>
      {entries.map(entry => { const point = getPortCenter(node, entry.portId!, entry.direction ?? 'input');
        return <div className={`node-value-inline${canvasRendered ? ' node-value-canvas-control' : ''}`} key={entry.target.parameter} aria-label={`Value below ${entry.portId}`}
          style={{ left: node.layout.x + (entry.direction === 'output' ? 99 : 16), top: point.y + 12, width: 70 }}
          onPointerDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
          {control(entry)}
        </div>;
      })}
      {!canvasRendered && frame.values?.filter(entry => !editablePorts.has(`${entry.direction}:${entry.portId}`)).map(entry => { const point = getPortCenter(node, entry.portId, entry.direction);
        return <output key={`${entry.direction}-${entry.portId}`} className="node-value-inline node-value-computed" aria-label={`${node.label} ${entry.direction} ${entry.portId} live value`}
          onPointerDown={event => event.stopPropagation()}
          title={frame.label.toLowerCase().includes('center cell') ? 'Live sample at the center grid cell. Values vary across the image.' : frame.label} style={{ left: node.layout.x + (entry.direction === 'output' ? 99 : 16), top: point.y + 12, width: 70 }}>
          {entry.value === undefined ? '—' : Number(entry.value.toFixed(4))}</output>;
      })}
      {error && <small className="node-value-inline node-value-status" role="alert"
        style={{ left: node.layout.x + rect.x, top: node.layout.y + rect.y + 17, width: rect.width }}>{error}</small>}
    </>;
  }
  if (canvasRendered && !frame.controls?.length) return null;
  return <div className={`node-value-preview${drawing?.kind === 'number' ? ' node-value-large' : ''}${canvasRendered && !error ? ' node-value-canvas-control' : ''}`} aria-label={`Values for ${node.label}`}
    style={{ left: node.layout.x + rect.x, top: node.layout.y + rect.y + 17, width: rect.width, height: rect.height - 17 }}
    onPointerDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
    <div className="node-value-content">
      {frame.controls?.length ? frame.controls.map(control)
        : drawing?.kind === 'number' ? <><output>{drawing.value}</output><span>{drawing.caption}</span></>
        : drawing?.kind === 'text' ? drawing.lines.map((line, index) => <div key={index}>{line}</div>) : null}
      {drawing?.kind === 'number' && drawing.details?.map(line => <small key={line}>{line}</small>)}
    </div>
    <small className="node-value-status" role={error ? 'alert' : undefined}>{error || frame.label}</small>
  </div>;
}
