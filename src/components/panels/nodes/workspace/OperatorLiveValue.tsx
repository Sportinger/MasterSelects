import type { NodeGraphNode } from '../../../../types/nodeGraph';
import { nodePreviewKey } from '../../../../services/nodePreview/previewTypes';
import { useNodeValueFrame } from '../previews/useNodeValueFrame';
import { ResolveInspectorRow } from '../../properties/resolveInspector/ResolveInspectorPrimitives';

export function OperatorLiveValue({ clipId, node, portId, label, direction = 'input' }: {
  clipId: string; node: NodeGraphNode; portId: string; label: string; direction?: 'input' | 'output';
}) {
  const frame = useNodeValueFrame(nodePreviewKey(clipId, node));
  const value = frame?.values?.find(value => value.portId === portId && value.direction === direction)?.value;
  return <ResolveInspectorRow label={label}>
    <output aria-label={`${node.label} ${label} live`} className="operator-live-value"
      title="Live sample at the center grid cell. Values vary across the image.">{value === undefined ? '—' : Number(value.toFixed(4))}</output>
  </ResolveInspectorRow>;
}
