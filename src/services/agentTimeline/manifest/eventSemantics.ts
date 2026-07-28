import type {
  AgentTimelineEvent,
  AgentTimelineRange,
} from '../../../types/agentTimeline/manifest';

export function isValidHalfOpenRange(range: AgentTimelineRange): boolean {
  return Number.isFinite(range.start) && Number.isFinite(range.end) && range.start < range.end;
}

export function eventMatchesHalfOpenRange(event: AgentTimelineEvent, range: AgentTimelineRange): boolean {
  if (!isValidHalfOpenRange(range)) return false;
  if (event.time.temporalKind === 'point') {
    return range.start <= event.time.time && event.time.time < range.end;
  }
  return event.time.start < range.end && event.time.end > range.start;
}

export function eventStart(event: AgentTimelineEvent): number {
  return event.time.temporalKind === 'point' ? event.time.time : event.time.start;
}

export function compareAgentTimelineEvents(left: AgentTimelineEvent, right: AgentTimelineEvent): number {
  const startDifference = eventStart(left) - eventStart(right);
  if (startDifference !== 0) return startDifference;
  const temporalDifference = Number(left.time.temporalKind === 'interval') - Number(right.time.temporalKind === 'interval');
  if (temporalDifference !== 0) return temporalDifference;
  const typeDifference = left.type.localeCompare(right.type);
  if (typeDifference !== 0) return typeDifference;
  return left.id.localeCompare(right.id);
}
