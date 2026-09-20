import { ResolveInspectorSection } from '../../properties/resolveInspector/ResolveInspectorPrimitives';
import type { FlockDefinition, FlockNode } from '../../../../types/flock';
import { FLOCK_GROUP_OPERATOR_ID, getFlockOperator } from '../../../../services/flock/operators/flockOperatorRegistry';
import type { FlockParamDescriptor } from '../../../../services/flock/operators/flockOperatorTypes';
import { readFlockParamValue } from '../../../../services/flock/flockPropertyValues';
import { groupOverrideKey } from '../../../../services/flock/graph/flockGroupExpansion';
import { useTimelineStore } from '../../../../stores/timeline';
import type { TimelineClip } from '../../../../stores/timeline/types';
import { FlockParamRow } from './FlockParamRow';
import type { FlockGraphActions } from './useFlockGraphActions';
import './FlockNodeInspector.css';

interface ParamEntry {
  nodeId: string;
  paramKey: string;
  descriptor: FlockParamDescriptor;
}

interface ParamSection {
  id: string;
  title: string | null;
  entries: ParamEntry[];
}

function buildSections(definition: FlockDefinition, flockNode: FlockNode): ParamSection[] {
  if (flockNode.operator !== FLOCK_GROUP_OPERATOR_ID) {
    const operator = getFlockOperator(flockNode.operator);
    return [{
      id: flockNode.id,
      title: null,
      entries: (operator?.params ?? []).map((descriptor) => ({ nodeId: flockNode.id, paramKey: descriptor.id, descriptor })),
    }];
  }
  const group = definition.groups.find((candidate) => candidate.id === flockNode.groupRef);
  return (group?.nodes ?? []).map((inner) => {
    const operator = getFlockOperator(inner.operator);
    return {
      id: inner.id,
      title: inner.label ?? operator?.label ?? inner.operator,
      entries: (operator?.params ?? []).map((descriptor) => ({
        nodeId: flockNode.id,
        paramKey: groupOverrideKey(inner.id, descriptor.id),
        descriptor,
      })),
    };
  });
}

export function FlockNodeParameters({
  clip,
  definition,
  flockNode,
  actions,
}: {
  clip: TimelineClip;
  definition: FlockDefinition;
  flockNode: FlockNode;
  actions: FlockGraphActions;
}) {
  const playheadPosition = useTimelineStore((state) => state.playheadPosition);
  const keyframes = useTimelineStore((state) => state.clipKeyframes.get(clip.id));
  const getSourceTimeForClip = useTimelineStore((state) => state.getSourceTimeForClip);
  const clipLocalTime = Math.max(0, Math.min(clip.duration, playheadPosition - clip.startTime));
  const operator = getFlockOperator(flockNode.operator);
  const exposeGroup = flockNode.label ?? operator?.label ?? 'Controls';
  const sections = buildSections(definition, flockNode);

  if (sections.every((section) => section.entries.length === 0)) {
    return <div className="node-workspace-inspector-empty">No parameters</div>;
  }

  const renderEntry = (entry: ParamEntry) => (
    <FlockParamRow
      key={entry.paramKey}
      clip={clip}
      nodeId={entry.nodeId}
      paramKey={entry.paramKey}
      descriptor={entry.descriptor}
      value={readFlockParamValue(definition, entry.nodeId, entry.paramKey) ?? entry.descriptor.default}
      exposed={definition.exposed.find((exposed) => exposed.nodeId === entry.nodeId && exposed.param === entry.paramKey)}
      exposeGroup={exposeGroup}
      keyframes={keyframes}
      clipLocalTime={clipLocalTime}
      resolveSourceOffset={getSourceTimeForClip}
      actions={actions}
    />
  );

  return (
    <div className="node-workspace-flock-params" onPointerUp={event => {
      if (event.target instanceof Element) event.target.closest<HTMLElement>('button,select,input[type="checkbox"]')?.blur();
    }}>
      {sections.map((section) => {
        const basic = section.entries.filter((entry) => !entry.descriptor.advanced);
        const advanced = section.entries.filter((entry) => entry.descriptor.advanced);
        return (
          <ResolveInspectorSection key={section.id} title={section.title ?? operator?.label ?? 'Parameters'}>
            {basic.map(renderEntry)}
            {advanced.length > 0 && (
              <ResolveInspectorSection title={`Advanced (${advanced.length})`} defaultOpen={false}>
                {advanced.map(renderEntry)}
              </ResolveInspectorSection>
            )}
          </ResolveInspectorSection>
        );
      })}
    </div>
  );
}
