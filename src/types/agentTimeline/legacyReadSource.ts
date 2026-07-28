import type { AgentTimelineRange } from './manifest';

export const LEGACY_READ_SOURCE_SCHEMA_VERSION = 'agent-timeline-legacy-read-source/v1' as const;

/** Caller-owned durable legacy input. Live media handles are intentionally absent. */
export interface LegacyReadSourceArtifactInput<TValue> {
  value: TValue | null;
  artifactRef?: string;
  /** Explicit measured source-time coverage; never inferred from event gaps. */
  coverage?: readonly AgentTimelineRange[];
}
