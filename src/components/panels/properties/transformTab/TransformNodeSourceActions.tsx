import { useState } from 'react';
import { useTimelineStore } from '../../../../stores/timeline';
import { useDockStore } from '../../../../stores/dockStore';
import type { OperatorEndpoint } from '../../../../types/operatorGraph';
import { createParameterSourceEvaluator } from '../../../../services/parameterSources/parameterSourceEvaluation';
import { getControlOperator } from '../../../../services/parameterSources/controlOperators';
import { setParameterSourceBinding } from '../../../../services/parameterSources/parameterSourceActions';
import { requestNodeAnimation } from '../../../../services/nodeGraph/nodeWorkspaceNavigation';
import { ResolveInspectorIconButton } from '../resolveInspector/ResolveInspectorPrimitives';

function NodeSourceIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16">
      <circle cx="4" cy="4.5" r="2" />
      <circle cx="12" cy="11.5" r="2" />
      <path d="M6 4.5h2.5a2 2 0 0 1 2 2v3" />
    </svg>
  );
}

function UnlinkIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16">
      <path d="M6.2 9.8 4.6 11.4a2.1 2.1 0 0 1-3-3l1.6-1.6M9.8 6.2l1.6-1.6a2.1 2.1 0 0 1 3 3l-1.6 1.6" />
      <path d="m2.5 2.5 11 11" />
    </svg>
  );
}

/**
 * Row actions for transform properties driven by control nodes: replaces the keyframe and reset
 * actions with the way to the source and back to the local value. A failing source is marked;
 * rendering keeps the keyframe value for it.
 */
export function TransformNodeSourceActions({ clipId, properties, sources }: {
  clipId: string;
  properties: readonly string[];
  sources: ReadonlyMap<string, OperatorEndpoint>;
}) {
  const clip = useTimelineStore(state => state.clips.find(item => item.id === clipId));
  const keys = useTimelineStore(state => state.clipKeyframes?.get(clipId));
  const playhead = useTimelineStore(state => state.playheadPosition);
  const locked = useTimelineStore(state => state.isExporting || Boolean(state.tracks?.some(track => track.id === clip?.trackId && track.locked)));
  const [message, setMessage] = useState('');
  const driven = properties.filter(path => sources.has(path));
  if (!clip || !driven.length) return null;
  const graph = clip.nodeGraph?.parameterSources?.graph;
  const first = sources.get(driven[0])!;
  const node = graph?.nodes.find(item => item.id === first.nodeId);
  const definition = node && getControlOperator(node.operator);
  const port = definition && definition.outputs.length > 1 ? ` / ${definition.outputs.find(output => output.id === first.portId)?.label ?? first.portId}` : '';
  let error = message;
  if (!error) {
    const evaluator = createParameterSourceEvaluator(clip, keys ?? [], Math.max(0, Math.min(clip.duration, playhead - clip.startTime)));
    for (const path of driven) {
      try { evaluator.resolve(path); } catch (failure) { error = failure instanceof Error ? failure.message : String(failure); break; }
    }
  }
  const sourceName = `${definition?.label ?? node?.operator ?? 'node'}${port}`;
  const goTitle = error ? `Node source failed: ${error}. Using the keyframe value.` : `Driven by ${sourceName}. Go to source`;
  return (
    <>
      <ResolveInspectorIconButton
        active
        ariaLabel={`Go to node source of ${driven.join(', ')}`}
        className={`transform-node-source-button${error ? ' has-error' : ''}`}
        onClick={event => {
          event.currentTarget.blur();
          requestNodeAnimation(clipId, first.nodeId, false);
          useDockStore.getState().activatePanelType('node-workspace');
        }}
        title={goTitle}
      >
        <NodeSourceIcon />
      </ResolveInspectorIconButton>
      <ResolveInspectorIconButton
        ariaLabel={`Use local value for ${driven.join(', ')}`}
        disabled={locked}
        onClick={event => {
          event.currentTarget.blur();
          try {
            for (const path of driven) setParameterSourceBinding(clipId, path, { enabled: false });
            setMessage('');
          } catch (failure) { setMessage(failure instanceof Error ? failure.message : String(failure)); }
        }}
        title="Use the local value and keys (the node stays connected but inactive)"
      >
        <UnlinkIcon />
      </ResolveInspectorIconButton>
    </>
  );
}
