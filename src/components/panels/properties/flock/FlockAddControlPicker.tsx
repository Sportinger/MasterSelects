import { useTimelineStore } from '../../../../stores/timeline';
import { endBatch, startBatch } from '../../../../stores/historyStore';
import type { TimelineClip } from '../../../../types/timeline';
import { getFlockNodeLabel, listFlockNodeParams } from './flockControlUtils';

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
        ...(entry.descriptor.min !== undefined ? { min: entry.descriptor.min } : {}),
        ...(entry.descriptor.max !== undefined ? { max: entry.descriptor.max } : {}),
      });
    } finally {
      endBatch();
    }
  };

  return (
    <div className="properties-section flock-add-control">
      <div className="control-row">
        <label className="prop-label" htmlFor={`flock-add-control-${clip.id}`}>Add</label>
        <select
          id={`flock-add-control-${clip.id}`}
          aria-label="Add flock control"
          value=""
          onChange={(event) => handleChange(event.target.value)}
        >
          <option value="">Expose a node parameter…</option>
          {groups.map((group) => (
            <optgroup key={group.node.id} label={group.label}>
              {group.params.map((entry) => (
                <option key={entry.key} value={`${group.node.id}${KEY_SEPARATOR}${entry.key}`}>
                  {entry.innerLabel ? `${entry.innerLabel} · ` : ''}{entry.descriptor.label}
                  {entry.descriptor.animatable && entry.descriptor.type !== 'integer' ? '' : ' (structural)'}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>
    </div>
  );
}
