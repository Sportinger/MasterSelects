import { useEffect, useState } from 'react';

import type { SeedancePreproductionRun } from '../services/seedancePreproduction/contracts';
import type {
  SeedanceAgentRecord,
  SeedanceOrchestrationEvent,
  SeedanceOrchestrationPhase,
} from '../services/seedancePreproduction/orchestrationContracts';
import './seedanceOrchestrationActivity.css';

interface ActivityItem {
  createdAt: number;
  detail?: string;
  id: string;
  label: string;
  tone: 'active' | 'error' | 'neutral' | 'success';
}

const ACTIVE_PHASES = new Set<SeedanceOrchestrationPhase>([
  'initializing', 'ideating', 'reviewing', 'synthesizing', 'writing-story', 'planning-scenes',
]);

const PHASE_LABELS: Record<SeedanceOrchestrationPhase, string> = {
  initializing: 'Preparing the orchestration',
  ideating: 'Developing visual directions',
  reviewing: 'Reviewing every concept independently',
  synthesizing: 'Revising and ordering the final directions',
  'awaiting-selection': 'Waiting for your direction choice',
  'writing-story': 'Writing the selected story',
  'planning-scenes': 'Planning every scene',
  'reviewing-media': 'Reviewing source coverage',
  completed: 'Story workflow completed',
  failed: 'Story workflow failed',
  cancelled: 'Story workflow stopped',
};

const ROLE_LABELS: Record<SeedanceAgentRecord['role'], string> = {
  orchestrator: 'Root orchestrator',
  ideator: 'Visual ideator',
  'concept-reviewer': 'Concept reviewer',
  'story-planner': 'Story planner',
  'scene-planner': 'Scene planner',
  'prompt-planner': 'Prompt planner',
  'visual-reviewer': 'Visual reviewer',
};

function agentStatusLabel(agent: SeedanceAgentRecord): string {
  const role = ROLE_LABELS[agent.role];
  if (agent.status === 'queued') return `${role} queued`;
  if (agent.status === 'running') return `${role} started`;
  if (agent.status === 'succeeded') return `${role} completed`;
  if (agent.status === 'failed') return `${role} failed`;
  return `${role} closed`;
}

function eventActivity(
  event: SeedanceOrchestrationEvent,
  conceptTitles: ReadonlyMap<string, string>,
): ActivityItem {
  const base = { createdAt: event.createdAt, id: event.eventId };
  switch (event.kind) {
    case 'run.started':
    case 'run.phase':
      return {
        ...base,
        label: PHASE_LABELS[event.payload.phase],
        tone: event.payload.phase === 'failed' || event.payload.phase === 'cancelled'
          ? 'error'
          : event.payload.phase === 'completed' || event.payload.phase === 'awaiting-selection'
            ? 'success'
            : 'active',
      };
    case 'root.ready':
      return {
        ...base,
        label: event.payload.resumed ? 'Root orchestrator resumed' : 'Root orchestrator ready',
        tone: 'active',
      };
    case 'agent.status': {
      const conceptTitle = event.payload.conceptId
        ? conceptTitles.get(event.payload.conceptId)
        : undefined;
      return {
        ...base,
        label: agentStatusLabel(event.payload),
        ...(event.payload.error
          ? { detail: event.payload.error }
          : conceptTitle ? { detail: conceptTitle } : {}),
        tone: event.payload.status === 'failed'
          ? 'error'
          : event.payload.status === 'succeeded' || event.payload.status === 'closed'
            ? 'success'
            : 'active',
      };
    }
    case 'concept.draft':
      return { ...base, label: 'Visual concept drafted', detail: event.payload.title, tone: 'success' };
    case 'concepts.reset':
      return { ...base, label: 'Concept drafts restarted', detail: event.payload.reason, tone: 'neutral' };
    case 'review.completed':
      return {
        ...base,
        label: `Independent review completed · ${event.payload.recommendation}`,
        detail: conceptTitles.get(event.payload.conceptId) ?? event.payload.conceptId,
        tone: 'success',
      };
    case 'orchestrator.status':
      return {
        ...base,
        label: `Root orchestrator · ${event.payload.status}`,
        detail: event.payload.message,
        tone: 'active',
      };
    case 'concept.final':
      return {
        ...base,
        label: `Final direction ${event.payload.rank} ready`,
        detail: event.payload.title,
        tone: 'success',
      };
    case 'finals.reset':
      return { ...base, label: 'Final directions restarted', detail: event.payload.reason, tone: 'neutral' };
    case 'concepts.finalized':
      return { ...base, label: `${event.payload.orderedConceptIds.length} final ${event.payload.orderedConceptIds.length === 1 ? 'direction' : 'directions'} ready`, tone: 'success' };
    case 'selection.accepted':
      return {
        ...base,
        label: 'Direction selected',
        detail: conceptTitles.get(event.payload.selectedConceptId) ?? event.payload.selectedConceptId,
        tone: 'success',
      };
    case 'story.completed':
      return { ...base, label: 'Story completed', detail: event.payload.title, tone: 'success' };
    case 'treatment.completed':
      return {
        ...base,
        label: 'Visual treatment completed',
        detail: event.payload.visualThesis,
        tone: 'success',
      };
    case 'scene.plan':
      return {
        ...base,
        label: `Scene plan accepted · revision ${event.payload.revision}`,
        detail: event.payload.dramaturgicalFunction,
        tone: 'success',
      };
    case 'run.failed':
      return { ...base, label: 'Story workflow failed', detail: event.payload.error, tone: 'error' };
    case 'run.cancelled':
      return { ...base, label: 'Story workflow stopped', detail: event.payload.reason, tone: 'error' };
  }
}

function eventTime(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(timestamp);
}

function elapsedTime(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1_000));
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    : `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function phaseTransitions(events: readonly SeedanceOrchestrationEvent[]) {
  return events.flatMap((event) => (
    event.kind === 'run.started' || event.kind === 'run.phase'
      ? [{ createdAt: event.createdAt, phase: event.payload.phase }]
      : []
  ));
}

function activeWorkDuration(
  events: readonly SeedanceOrchestrationEvent[],
  now: number,
  fallbackStartedAt: number,
  currentPhase: SeedanceOrchestrationPhase,
): number {
  const transitions = phaseTransitions(events);
  if (transitions.length === 0) {
    return ACTIVE_PHASES.has(currentPhase) ? Math.max(0, now - fallbackStartedAt) : 0;
  }
  return transitions.reduce((total, transition, index) => {
    if (!ACTIVE_PHASES.has(transition.phase)) return total;
    const next = transitions[index + 1];
    return total + Math.max(0, (next?.createdAt ?? now) - transition.createdAt);
  }, 0);
}

function useLiveNow(running: boolean): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!running) return undefined;
    const interval = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(interval);
  }, [running]);
  return now;
}

export function SeedanceOrchestrationActivity({
  compact = false,
  embedded = false,
  hideDetail = false,
  run,
}: {
  compact?: boolean;
  embedded?: boolean;
  hideDetail?: boolean;
  run: SeedancePreproductionRun;
}) {
  const orchestration = run.orchestration;
  const running = orchestration !== undefined && ACTIVE_PHASES.has(orchestration.phase);
  const liveNow = useLiveNow(running);
  if (!orchestration) return null;
  const displayNow = running ? liveNow : orchestration.updatedAt;
  const conceptTitles = new Map([
    ...orchestration.drafts.map((concept) => [concept.id, concept.title] as const),
    ...orchestration.finalConcepts.map((concept) => [concept.id, concept.title] as const),
  ]);
  const items = run.orchestrationEvents
    .slice(-100)
    .map((event) => eventActivity(event, conceptTitles));
  const snapshot: ActivityItem = {
    createdAt: orchestration.updatedAt,
    id: `${orchestration.runId}:snapshot`,
    label: PHASE_LABELS[orchestration.phase],
    ...(orchestration.error === undefined ? {} : { detail: orchestration.error }),
    tone: orchestration.phase === 'failed' || orchestration.phase === 'cancelled'
      ? 'error' as const
      : orchestration.phase === 'completed' || orchestration.phase === 'awaiting-selection'
        ? 'success' as const
        : 'active' as const,
  };
  const latestEvent = items.at(-1);
  const latest = !latestEvent || snapshot.createdAt > latestEvent.createdAt
    ? snapshot
    : latestEvent;
  const transitions = phaseTransitions(run.orchestrationEvents);
  const currentPhaseStartedAt = transitions.toReversed().find((transition) => (
    transition.phase === orchestration.phase
  ))?.createdAt ?? orchestration.updatedAt;
  const overallWork = activeWorkDuration(
    run.orchestrationEvents,
    displayNow,
    orchestration.createdAt,
    orchestration.phase,
  );
  const currentStep = Math.max(0, displayNow - currentPhaseStartedAt);
  const timedItems = items.map((item, index) => ({
    ...item,
    duration: Math.max(0, (items[index + 1]?.createdAt ?? displayNow) - item.createdAt),
  }));

  if (compact) {
    return (
      <div
        className={`seedance-orchestration-activity is-compact is-${latest.tone}`}
        aria-live="polite"
        role="status"
      >
        <span className="seedance-orchestration-compact-timing" aria-label={`Overall work ${elapsedTime(overallWork)}, current step ${elapsedTime(currentStep)}`}>
          <span><small>Work</small><strong>{elapsedTime(overallWork)}</strong></span>
          <span><small>Step</small><strong>{elapsedTime(currentStep)}</strong></span>
        </span>
        <p className="seedance-orchestration-compact-status">
          <i aria-hidden="true" />
          {latest.label}
        </p>
      </div>
    );
  }

  return (
    <section
      className={`seedance-orchestration-activity is-${latest.tone} ${embedded ? 'is-embedded' : ''}`}
      aria-label="Story live activity"
    >
      <div className="seedance-orchestration-latest" aria-live="polite" role="status">
        <span aria-hidden="true" />
        <div>
          <small>Live status</small>
          <strong>{latest.label}</strong>
          {latest.detail && !hideDetail && <p>{latest.detail}</p>}
        </div>
        <div className="seedance-orchestration-timing">
          <span><small>Overall work</small><strong>{elapsedTime(overallWork)}</strong></span>
          <span><small>Current step</small><strong>{elapsedTime(currentStep)}</strong></span>
          <time dateTime={new Date(latest.createdAt).toISOString()}>{eventTime(latest.createdAt)}</time>
        </div>
      </div>
      {items.length > 0 && (
        <details>
          <summary>{items.length} observed updates</summary>
          <ol>
            {timedItems.toReversed().map((item) => (
              <li className={`is-${item.tone}`} key={item.id}>
                <time dateTime={new Date(item.createdAt).toISOString()}>{eventTime(item.createdAt)}</time>
                <span><strong>{item.label}</strong>{item.detail && <small>{item.detail}</small>}</span>
                <time className="seedance-update-duration">{elapsedTime(item.duration)}</time>
              </li>
            ))}
          </ol>
        </details>
      )}
    </section>
  );
}
