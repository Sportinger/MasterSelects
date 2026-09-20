import { useMemo, useState } from 'react';
import type { Keyframe } from '../../../../types/keyframes';
import type { TimelineClip } from '../../../../types/timeline';
import type { NodeGraphNode } from '../../../../types/nodeGraph';
import { useTimelineStore } from '../../../../stores/timeline';
import { startBatch, endBatch } from '../../../../stores/historyStore';
import { keyframeNodeParameters } from '../../../../services/nodeGraph/keyframeNodeParameters';
import { extractKeyframeChannel } from '../../../../services/nodeGraph/keyframeNodeActions';
import { requestNodeAnimation } from '../../../../services/nodeGraph/nodeWorkspaceNavigation';
import { InspectorSelect } from '../../../inspector/InspectorSelect';
import { ResolveInspectorRow, ResolveInspectorSection } from '../../properties/resolveInspector/ResolveInspectorPrimitives';
import { KeyframeChannelEditor } from './KeyframeNodeInspector';

const EMPTY: Keyframe[] = [];
export function NodeAnimationInspector({ clip, node, onShowParameters }: {
  clip: TimelineClip; node: NodeGraphNode; onShowParameters?: () => void;
}) {
  const [selected, setSelected] = useState('');
  const [message, setMessage] = useState('');
  const keys = useTimelineStore(state => state.clipKeyframes.get(clip.id) ?? EMPTY);
  const locked = useTimelineStore(state => state.isExporting || Boolean(state.tracks.find(track => track.id === clip.trackId)?.locked));
  const parameters = useMemo(() => keyframeNodeParameters(clip), [clip]);
  const refs = node.animation?.channels ?? [];
  const ref = refs.find(candidate => candidate.property === selected) ?? refs[0];
  const definition = clip.nodeGraph?.keyframeNodes?.find(candidate => candidate.id === ref?.nodeId);
  const channel = definition?.channels.find(candidate => candidate.id === ref?.channelId);
  if (!definition || !channel || !ref) return null;
  const separate = definition.presentation === 'node' || definition.channels.some(candidate => candidate.targets.length > 0);
  const safely = (label: string, action: () => void) => {
    const batch = startBatch(label);
    try { action(); setMessage(''); }
    catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { if (batch.opened) endBatch(); }
  };
  // A follower edits its materialized lane; the shared-curve synchronizer maps it
  // back to the source, including explicit scale/offset and Bezier handles.
  const displayed = { ...definition, channels: [{ ...channel, property: ref.property, targets: [] }] };
  return <div className="keyframe-node-inspector" onClick={event => {
    if (event.detail > 0 && event.target instanceof Element && !event.target.closest('.inspector-select')) event.target.closest<HTMLButtonElement>('button')?.blur();
  }}>
    <ResolveInspectorSection title={`${node.label} · Animation`} indicator="none">
      <button type="button" className="node-workspace-secondary-action" onClick={onShowParameters}>Back to parameters</button>
      <ResolveInspectorRow label="Curve"><InspectorSelect ariaLabel="Animated parameter" value={ref.property}
        options={refs.map(candidate => ({ value: candidate.property,
          label: parameters.find(parameter => parameter.property === candidate.property)?.label ?? candidate.property }))}
        onChange={setSelected} /></ResolveInspectorRow>
      <p className="keyframe-node-hint">{refs.length} curves · Same keyframes as the timeline{separate ? ' · Shared animation node' : ''}</p>
    </ResolveInspectorSection>
    <KeyframeChannelEditor key={ref.property} clip={clip} node={displayed} channelId={channel.id} keys={keys}
      parameters={parameters} available={[]} locked={locked} safely={safely} embedded />
    <button type="button" className="node-workspace-secondary-action" disabled={locked && !separate}
      onClick={() => safely('Show animation node', () => {
        const id = separate ? definition.id : extractKeyframeChannel(clip.id, definition.id, channel.id,
          { x: node.layout.x - 250, y: node.layout.y - 120 });
        requestNodeAnimation(clip.id, id, false);
      })}>{separate ? 'Show shared keyframe node' : 'Extract as keyframe node'}</button>
    {message && <p className="keyframe-node-hint" role="alert">{message}</p>}
  </div>;
}
