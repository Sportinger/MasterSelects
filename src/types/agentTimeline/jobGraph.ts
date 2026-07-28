export const AGENT_TIMELINE_JOB_GRAPH_SCHEMA_VERSION = 'agent-timeline-job-graph/v1' as const;

export type AgentTimelineJobOutcome = 'completed' | 'cached' | 'partial';

export type AgentTimelineJobStatus =
  | 'queued'
  | 'running'
  | AgentTimelineJobOutcome
  | 'failed'
  | 'cancelled'
  | 'blocked';

export interface AgentTimelineJobError {
  message: string;
  retryable: boolean;
}

export interface AgentTimelineJobSnapshot {
  id: string;
  channel: string;
  status: AgentTimelineJobStatus;
  progress: number;
  dependencies: readonly string[];
  resourceLocks: readonly string[];
  startedAt?: number;
  finishedAt?: number;
  error?: AgentTimelineJobError;
}

export interface AgentTimelineJobGraphSnapshot {
  schemaVersion: typeof AGENT_TIMELINE_JOB_GRAPH_SCHEMA_VERSION;
  graphId: string;
  status: 'queued' | 'running' | 'completed' | 'partial' | 'failed' | 'cancelled';
  jobs: readonly AgentTimelineJobSnapshot[];
}
