import { useTimelineStore } from '../../../../stores/timeline';
import { endBatch, startBatch } from '../../../../stores/historyStore';
import type { TimelineClip } from '../../../../types/timeline';
import { getFlockNodeLabel, listFlockNodeParams } from './flockControlUtils';
import { InspectorSelect, type InspectorSelectGroup } from '../../../inspector/InspectorSelect';
import { ResolveInspectorRow, ResolveInspectorSection } from '../resolveInspector/ResolveInspectorPrimitives';

const KEY_SEPARATOR = '::';

/** Compact picker promoting any node parameter to the clip panel. */
export function FlockAddControlPicker({ clip }: { clip: TimelineClip }) {
  const exposeFlockGraphParam = useTimelineStore((state) => state.exposeFlockGraphParam);
  const definition = clip.flock;
  if (!definition) return null;

  const exposedKeys = new Set(definition.exposed.map((exposed) => `${exposed.nodeId}${KEY_SEPARATOR}${exposed.param}`));
  const groups = definition.nodes
    .map((node) => ({
      node,
      label: getFlockNodeLabel(definition, node.id),
      params: listFlockNodeParams(definition, node).filter((entry) => (
        entry.descriptor.type !== 'asset' && !exposedKeys.has(`${node.id}${KEY_SEPARATOR}${entry.key}`)
      )),
    }))
    .filter((group) => group.params.length > 0);

  if (groups.length === 0) return null;

  const handleChange = (value: string) => {
    if (!value) return;
    const separator = value.indexOf(KEY_SEPARATOR);
    const nodeId = value.slice(0, separator);
    const key = value.slice(separator + KEY_SEPARATOR.length);
    const group = groups.find((candidate) => candidate.node.id === nodeId);
    const entry = group?.params.find((candidate) => candidate.key === key);
    if (!group || !entry) return;
    startBatch('Expose flock parameter');
    try {
      exposeFlockGraphParam(clip.id, nodeId, key, {
        label: entry.innerLabel ? `${entry.innerLabel} ${entry.descriptor.label}` : entry.descriptor.label,
        group: group.label,
      });
    } finally {
      endBatch();
    }
  };

  const options: InspectorSelectGroup[] = [
    { options: [{ value: '', label: 'Expose a node parameter…', disabled: true }] },
    ...groups.map((group) => ({
      label: group.label,
      options: group.params.map((entry) => ({
        value: `${group.node.id}${KEY_SEPARATOR}${entry.key}`,
        label: `${entry.innerLabel ? `${entry.innerLabel} · ` : ''}${entry.descriptor.label}${entry.descriptor.animatable && entry.descriptor.type !== 'integer' ? '' : ' (structural)'}`,
      })),
    })),
  ];

  return (
    <div className="flock-add-control">
      <ResolveInspectorSection title="More controls" defaultOpen={false}>
        <ResolveInspectorRow label="Add">
          <InspectorSelect ariaLabel="Add flock control" value="" groups={options} onChange={handleChange} />
        </ResolveInspectorRow>
      </ResolveInspectorSection>
    </div>
  );
}
