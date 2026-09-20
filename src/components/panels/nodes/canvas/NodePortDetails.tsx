import type { NodeGraphPort } from '../../../../types/nodeGraph';
import { describeNodePort } from '../../../../services/nodeGraph/nodePortPresentation';

export function NodePortDetails({ port, compact = false }: { port: Pick<NodeGraphPort, 'label' | 'direction' | 'metadata'> & { type: string }; compact?: boolean }) {
  const info = describeNodePort(port), input = port.direction === 'input';
  if (compact) return <>
    <strong>{input ? 'In' : 'Out'} · {info.typeLabel}</strong>
    <div className="node-port-compact-formats">{info.formatLabels.join('; ')}</div>
    {input && <div className="node-port-detail-footer">{port.metadata?.required ? 'Required' : 'Optional'} · {port.metadata?.repeated ? 'Multiple connections' : '1 connection'}</div>}
  </>;
  return <>
    <strong>{input ? 'Input' : 'Output'} · {port.label}</strong>
    <div className="node-port-detail-type">{info.typeLabel}</div>
    <p>{info.description}</p>
    <div className="node-port-detail-heading">{input ? 'Accepted formats' : 'Output formats'}</div>
    <ul>{info.formatLabels.map(format => <li key={format}>{format}</li>)}</ul>
    {info.constraints?.map(text => <p key={text}>{text}</p>)}
    <div className="node-port-detail-footer">{input
      ? `${port.metadata?.required ? 'Required' : 'Optional'} · ${port.metadata?.repeated ? 'Multiple connections' : 'One connection'}`
      : 'Can feed multiple compatible inputs'}</div>
  </>;
}
