export type StoryboardTelemetryEventName =
  | 'decision.resolved'
  | 'generation.cancelled'
  | 'generation.import_failed'
  | 'generation.restored'
  | 'generation.submitted'
  | 'template.applied'
  | 'variant.commit_failed'
  | 'variant.committed'
  | 'variant.materialized'
  | 'variant.stale';

export interface StoryboardTelemetryEvent {
  schemaVersion: 1;
  name: StoryboardTelemetryEventName;
  occurredAt: number;
  attributes: Readonly<Record<string, boolean | number | string>>;
}

export type StoryboardTelemetrySink = (event: StoryboardTelemetryEvent) => void;

const MAX_JOURNAL_EVENTS = 200;
const RETENTION_MS = 60 * 60 * 1_000;
const SAFE_ATTRIBUTE_KEYS = new Set([
  'boundaryPolicy',
  'count',
  'failedCount',
  'mode',
  'optionCount',
  'reason',
  'status',
  'succeededCount',
  'warningCount',
]);
const SAFE_STRING_VALUES = new Set([
  'accepted',
  'automatic',
  'building',
  'cancel-requested',
  'canceled-before-submission',
  'cancelled',
  'completed-billable',
  'drop-with-warning',
  'failed',
  'full',
  'import',
  'materialization',
  'milestones',
  'partial',
  'preserve',
  'rebuild',
  'review',
  'runtime',
  'stale',
  'submitted',
  'verification',
]);

let sink: StoryboardTelemetrySink | undefined;
let journal: StoryboardTelemetryEvent[] = [];

function safeAttributes(
  input: Readonly<Record<string, unknown>>,
): Record<string, boolean | number | string> {
  const output: Record<string, boolean | number | string> = {};
  for (const [key, value] of Object.entries(input)) {
    if (!SAFE_ATTRIBUTE_KEYS.has(key)) continue;
    if (typeof value === 'boolean') {
      output[key] = value;
    } else if (typeof value === 'number' && Number.isFinite(value)) {
      output[key] = Math.max(-1_000_000, Math.min(1_000_000, value));
    } else if (typeof value === 'string' && SAFE_STRING_VALUES.has(value)) {
      output[key] = value;
    }
  }
  return output;
}

function prune(now: number): void {
  journal = journal
    .filter((event) => now - event.occurredAt <= RETENTION_MS)
    .slice(-MAX_JOURNAL_EVENTS);
}

export function recordStoryboardTelemetry(
  name: StoryboardTelemetryEventName,
  attributes: Readonly<Record<string, unknown>> = {},
  occurredAt = Date.now(),
): StoryboardTelemetryEvent {
  const event: StoryboardTelemetryEvent = Object.freeze({
    schemaVersion: 1,
    name,
    occurredAt,
    attributes: Object.freeze(safeAttributes(attributes)),
  });
  prune(occurredAt);
  journal.push(event);
  if (journal.length > MAX_JOURNAL_EVENTS) {
    journal = journal.slice(-MAX_JOURNAL_EVENTS);
  }
  sink?.(event);
  return event;
}

export function readStoryboardTelemetryJournal(
  now = Date.now(),
): StoryboardTelemetryEvent[] {
  prune(now);
  return structuredClone(journal);
}

export function setStoryboardTelemetrySink(
  nextSink: StoryboardTelemetrySink | undefined,
): void {
  sink = nextSink;
}

export function resetStoryboardTelemetryForTests(): void {
  journal = [];
  sink = undefined;
}
