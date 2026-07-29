import type { KernelMissingPrecondition } from './types';

/**
 * Structured record of one kernel run.
 *
 * The gateway used to flatten every compile artifact into a single prose
 * string, so the UI could never show what the kernel understood, did, or
 * checked. This module keeps that evidence intact: the gateway builds a
 * `KernelRunReport`, the UI renders it, and `formatKernelRunMessage` derives
 * the legacy one-line text for the bridge, MCP, and chat-run audit.
 *
 * Readers here mirror the kernel contracts (taskContract §5, plan §7,
 * verification §9) by exact key. Anything that does not match the contract is
 * dropped rather than guessed at, so a contract drift shows up as a missing
 * section instead of an invented number.
 */

export type KernelRunOutcome = 'verified' | 'declined' | 'failed';

export type KernelGoalOperation = 'set' | 'add' | 'remove' | 'preserve';

export interface KernelReportGoal {
  property: string;
  operation: KernelGoalOperation;
  value?: unknown;
}

export interface KernelReportTarget {
  kind: string;
  resolution: string;
  name?: string;
}

export type KernelAmbiguityResolution =
  | 'contextResolution'
  | 'assumption'
  | 'candidates'
  | 'humanGate';

export interface KernelReportAmbiguity {
  description: string;
  options?: string[];
  resolvedBy: KernelAmbiguityResolution;
  chosen?: string;
  gateReason?: string;
}

export interface KernelReportAssumption {
  name: string;
  value: unknown;
}

export interface KernelReportUnderstood {
  request?: string;
  targets: KernelReportTarget[];
  goals: KernelReportGoal[];
  preserve: string[];
  assumptions: KernelReportAssumption[];
  ambiguities: KernelReportAmbiguity[];
}

export interface KernelReportStep {
  stepId: string;
  tool: string;
  capability?: string;
  /** Resolved arguments, kept so the chat-run audit shows what actually ran. */
  args?: Record<string, unknown>;
  status: 'ok' | 'failed' | 'skipped';
  durationMs?: number;
  error?: string;
}

export interface KernelReportCheck {
  name: string;
  passed: boolean;
}

export interface KernelReportVerified {
  matches: boolean;
  fingerprint?: string;
  counts: {
    video?: number;
    audio?: number;
    clips?: number;
    tracks?: number;
  };
  occupied?: {
    startSeconds: number;
    endSeconds: number;
    spanSeconds: number;
  };
  checks: KernelReportCheck[];
}

export interface KernelReportTimings {
  totalMs: number;
  compileMs?: number;
  executeMs?: number;
  verifyMs?: number;
}

export interface KernelReportDecline {
  /** Kernel contract reason, kept verbatim for support and telemetry. */
  reason: string;
  /** User-facing explanation resolved from the reason. */
  explanation: string;
  /** Optional next step that clears the blocker. */
  nextStep?: string;
  /** Raw kernel detail, shown only on demand — it is contract jargon. */
  detail?: string;
  missingPrecondition?: KernelMissingPrecondition;
}

export interface KernelRunReport {
  schemaVersion: 1;
  runId?: string;
  mode?: 'mechanical' | 'story';
  outcome: KernelRunOutcome;
  understood?: KernelReportUnderstood;
  steps: KernelReportStep[];
  verified?: KernelReportVerified;
  timings: KernelReportTimings;
  decline?: KernelReportDecline;
  /** Present for `failed`: the raw failure detail. */
  failure?: string;
  /** Story-path assumption note, when the kernel reported one. */
  assumptionNote?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function readFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is string => typeof entry === 'string');
}

function readGoal(value: unknown): KernelReportGoal | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const property = readString(value.property);
  const operation = readString(value.operation);
  if (!property
    || (operation !== 'set'
      && operation !== 'add'
      && operation !== 'remove'
      && operation !== 'preserve')) {
    return undefined;
  }
  return {
    property,
    operation,
    ...(value.value === undefined ? {} : { value: value.value }),
  };
}

function readTarget(value: unknown): KernelReportTarget | undefined {
  if (!isRecord(value) || !isRecord(value.selector)) {
    return undefined;
  }
  const kind = readString(value.selector.kind);
  const resolution = readString(value.selector.resolution);
  if (!kind || !resolution) {
    return undefined;
  }
  const name = readString(value.selector.name);
  return { kind, resolution, ...(name === undefined ? {} : { name }) };
}

function readAmbiguity(value: unknown): KernelReportAmbiguity | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const description = readString(value.description);
  const resolvedBy = readString(value.resolvedBy);
  if (!description
    || (resolvedBy !== 'contextResolution'
      && resolvedBy !== 'assumption'
      && resolvedBy !== 'candidates'
      && resolvedBy !== 'humanGate')) {
    return undefined;
  }
  const options = readStringArray(value.options);
  const chosen = readString(value.chosen);
  const gateReason = readString(value.gateReason);
  return {
    description,
    resolvedBy,
    ...(options.length === 0 ? {} : { options }),
    ...(chosen === undefined ? {} : { chosen }),
    ...(gateReason === undefined ? {} : { gateReason }),
  };
}

/** Extracts the durable intent the kernel compiled from the request. */
export function buildUnderstood(taskContract: unknown): KernelReportUnderstood | undefined {
  if (!isRecord(taskContract)) {
    return undefined;
  }

  const goals = Array.isArray(taskContract.goals)
    ? taskContract.goals.map(readGoal).filter((goal): goal is KernelReportGoal => goal !== undefined)
    : [];
  const targets = Array.isArray(taskContract.targets)
    ? taskContract.targets
      .map(readTarget)
      .filter((target): target is KernelReportTarget => target !== undefined)
    : [];
  const ambiguities = Array.isArray(taskContract.ambiguities)
    ? taskContract.ambiguities
      .map(readAmbiguity)
      .filter((ambiguity): ambiguity is KernelReportAmbiguity => ambiguity !== undefined)
    : [];
  const assumptions = isRecord(taskContract.assumptions)
    ? Object.entries(taskContract.assumptions).map(([name, value]) => ({ name, value }))
    : [];
  const preserve = readStringArray(taskContract.preserve);
  const request = readString(taskContract.request);

  if (goals.length === 0
    && targets.length === 0
    && ambiguities.length === 0
    && assumptions.length === 0
    && preserve.length === 0
    && request === undefined) {
    return undefined;
  }

  return {
    ...(request === undefined ? {} : { request }),
    targets,
    goals,
    preserve,
    assumptions,
    ambiguities,
  };
}

/**
 * Maps executed calls to report steps, enriching each with the plan capability
 * when the compiler kept the step id stable.
 */
export function buildSteps(
  resolvedCalls: { stepId: string; tool: string; args?: Record<string, unknown> }[],
  plan: unknown,
): KernelReportStep[] {
  const capabilityByStepId = new Map<string, string>();
  if (isRecord(plan) && Array.isArray(plan.steps)) {
    for (const step of plan.steps) {
      if (!isRecord(step)) continue;
      const id = readString(step.id);
      const capability = readString(step.capability);
      if (id && capability) {
        capabilityByStepId.set(id, capability);
      }
    }
  }

  return resolvedCalls.map((call) => {
    const capability = capabilityByStepId.get(call.stepId);
    return {
      stepId: call.stepId,
      tool: call.tool,
      ...(capability === undefined ? {} : { capability }),
      ...(call.args === undefined ? {} : { args: call.args }),
      status: 'ok' as const,
    };
  });
}

function readChecks(report: Record<string, unknown> | undefined): KernelReportCheck[] {
  const raw = report?.checks;
  if (!Array.isArray(raw)) {
    return [];
  }
  const checks: KernelReportCheck[] = [];
  for (const entry of raw) {
    if (!isRecord(entry)) continue;
    const name = readString(entry.check) ?? readString(entry.name);
    if (!name) continue;
    const passed = entry.passed === true
      || entry.ok === true
      || readString(entry.status)?.toLowerCase() === 'passed';
    checks.push({ name, passed });
  }
  return checks;
}

/**
 * Reads the verification counters. The verification report nests its summary
 * differently for the mechanical and story paths, so both shapes are probed —
 * but each key is read exactly, never guessed by prefix.
 */
export function buildVerified(
  fingerprintAssert: { matches: boolean } & Record<string, unknown>,
  verificationReport: unknown,
  compileSummary: unknown,
  fingerprint: string | undefined,
  finalSnapshot?: unknown,
): KernelReportVerified {
  const report = isRecord(verificationReport) ? verificationReport : undefined;
  const reportSummary = report && isRecord(report.summary) ? report.summary : undefined;
  const verified = report && isRecord(report.verified) ? report.verified : undefined;
  const compiled = isRecord(compileSummary) ? compileSummary : undefined;
  const snapshot = isRecord(finalSnapshot) ? finalSnapshot : undefined;
  const snapshotOccupied = snapshot && isRecord(snapshot.occupancy)
    && isRecord(snapshot.occupancy.occupied)
    ? snapshot.occupancy.occupied
    : undefined;
  const counts = [reportSummary?.counts, report?.counts, compiled?.counts].find(isRecord);

  // The verification report is authoritative; the final snapshot only fills
  // gaps the report leaves (the story path reports fewer counters).
  const sources: Array<Record<string, unknown> | undefined> = [
    counts,
    verified,
    reportSummary,
    report,
    compiled,
    snapshot,
  ];

  const pick = (keys: string[]): number | undefined => {
    for (const source of sources) {
      if (!source) continue;
      for (const key of keys) {
        const direct = readFiniteNumber(source[key]);
        if (direct !== undefined) return direct;
        if (Array.isArray(source[key])) return (source[key] as unknown[]).length;
      }
    }
    return undefined;
  };

  const video = pick(['videoCount', 'videoClipCount']);
  const audio = pick(['audioCount', 'audioClipCount']);
  const clips = pick(['clipCount', 'totalClips', 'clips']);
  const tracks = pick(['trackCount', 'totalTracks', 'tracks']);

  const occupancySource = [
    reportSummary?.occupied,
    reportSummary?.occupiedSpan,
    report?.occupied,
    compiled?.occupied,
    snapshotOccupied,
  ].find(isRecord);
  const range = [
    reportSummary?.occupiedRange,
    verified?.occupiedRange,
    report?.occupiedRange,
    compiled?.occupiedRange,
  ].find((value): value is unknown[] => Array.isArray(value) && value.length >= 2);

  const occupancySources: Array<Record<string, unknown> | undefined> = [
    occupancySource,
    ...sources,
  ];
  const pickFrom = (
    from: Array<Record<string, unknown> | undefined>,
    keys: string[],
  ): number | undefined => {
    for (const source of from) {
      if (!source) continue;
      for (const key of keys) {
        const direct = readFiniteNumber(source[key]);
        if (direct !== undefined) return direct;
      }
    }
    return undefined;
  };

  const startSeconds = readFiniteNumber(range?.[0])
    ?? pickFrom(occupancySources, ['occupiedStartSeconds', 'startSeconds', 'start']);
  const endSeconds = readFiniteNumber(range?.[1])
    ?? pickFrom(occupancySources, ['occupiedEndSeconds', 'endSeconds', 'end']);
  const spanSeconds = pickFrom(occupancySources, [
    'occupiedSpanSeconds',
    'spanSeconds',
    'durationSeconds',
    'duration',
  ]);

  const occupied = startSeconds !== undefined && endSeconds !== undefined
    ? {
        startSeconds,
        endSeconds,
        spanSeconds: spanSeconds ?? endSeconds - startSeconds,
      }
    : undefined;

  return {
    matches: fingerprintAssert.matches,
    ...(fingerprint === undefined ? {} : { fingerprint }),
    counts: {
      ...(video === undefined ? {} : { video }),
      ...(audio === undefined ? {} : { audio }),
      ...(clips === undefined ? {} : { clips }),
      ...(tracks === undefined ? {} : { tracks }),
    },
    ...(occupied === undefined ? {} : { occupied }),
    checks: readChecks(report),
  };
}

/**
 * User-facing copy per decline reason. The kernel reasons come from the
 * compile contract; the rest are gateway-local codes. Nothing changed on the
 * timeline in any of these cases — that is the promise the copy has to keep.
 */
const DECLINE_COPY: Record<string, { explanation: string; nextStep?: string }> = {
  // Kernel compile contract reasons.
  notMechanicalTask: {
    explanation: 'This needs narrative judgement rather than a mechanical edit, '
      + 'and the kernel only runs edits it can prove correct.',
    nextStep: 'Try naming the concrete change you want, e.g. "remove all silent parts".',
  },
  storyPathNeedsProvider: {
    explanation: 'Story edits need the planning service, which is not reachable right now. '
      + 'Nothing on your timeline changed.',
    nextStep: 'Check the connection and try again.',
  },
  storyPathNeedsMoments: {
    explanation: 'Story edits are built from what is actually said on screen, '
      + 'and this footage has no transcript yet.',
    nextStep: 'Transcribe the clip, then ask again.',
  },
  storyOnlyModeActive: {
    // Not a transcript problem: story-only calibration mode parks the
    // mechanical families, so every request lands on the story path.
    explanation: 'Story-only calibration mode is active, so every request is '
      + 'routed to the story path — including this one, which is not a story edit.',
    nextStep: 'Turn off KERNEL_STORY_ONLY on the kernel service to run '
      + 'mechanical edits again.',
  },
  // Gateway-local codes.
  cancelled: {
    explanation: 'Run cancelled. Your timeline is unchanged.',
  },
  transportError: {
    explanation: 'The kernel service could not be reached, so nothing was changed.',
    nextStep: 'Try again in a moment.',
  },
  unreadableResponse: {
    explanation: 'The kernel replied in a format this version cannot read, '
      + 'so the run was stopped before touching the timeline.',
  },
  gatewayError: {
    explanation: 'The run stopped before any edit was applied.',
  },
  compileFailed: {
    explanation: 'The kernel could not turn this request into a plan it can verify, '
      + 'so it stopped before changing anything.',
  },
  toolExecutionFailed: {
    explanation: 'A step failed while applying the edit, so everything was rolled back.',
  },
};

/** Translates a kernel decline reason into user-facing copy. */
export function buildDecline(
  reason: string | undefined,
  detail?: string,
  missingPrecondition?: KernelMissingPrecondition,
): KernelReportDecline {
  const trimmedDetail = detail?.trim();
  const known = reason === undefined ? undefined : DECLINE_COPY[reason];
  if (reason !== undefined && known) {
    return {
      reason,
      explanation: known.explanation,
      ...(known.nextStep === undefined ? {} : { nextStep: known.nextStep }),
      ...(trimmedDetail ? { detail: trimmedDetail } : {}),
      ...(missingPrecondition === undefined ? {} : { missingPrecondition }),
    };
  }
  // An unmapped reason is a contract drift. Surface the detail rather than a
  // generic sentence, so the run stays diagnosable.
  return {
    reason: reason ?? 'unknown',
    explanation: 'The kernel stopped before changing anything.',
    ...(trimmedDetail ? { detail: trimmedDetail } : {}),
    ...(missingPrecondition === undefined ? {} : { missingPrecondition }),
  };
}

const FINGERPRINT_SHORT_LENGTH = 8;

/** Short digest form used in headlines and copy affordances. */
export function shortFingerprint(fingerprint: string | undefined): string | undefined {
  if (!fingerprint) {
    return undefined;
  }
  const separatorIndex = fingerprint.indexOf(':');
  const digest = separatorIndex >= 0 ? fingerprint.slice(separatorIndex + 1) : fingerprint;
  return digest.slice(0, FINGERPRINT_SHORT_LENGTH) || undefined;
}

function formatNumber(value: number): string {
  if (Number.isInteger(value)) {
    return String(value);
  }
  return value.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
}

/** Human-readable summary of what the run changed. */
export function describeVerifiedDetails(verified: KernelReportVerified): string {
  const details: string[] = [];
  const { counts, occupied } = verified;

  if (counts.video !== undefined) details.push(`${formatNumber(counts.video)} video clips`);
  if (counts.audio !== undefined) details.push(`${formatNumber(counts.audio)} audio clips`);
  if (counts.video === undefined && counts.audio === undefined && counts.clips !== undefined) {
    details.push(`${formatNumber(counts.clips)} clips`);
  }
  if (counts.tracks !== undefined) details.push(`${formatNumber(counts.tracks)} tracks`);
  if (occupied) {
    details.push(
      `timeline ${formatNumber(occupied.startSeconds)}–${formatNumber(occupied.endSeconds)}s`
      + ` (${formatNumber(occupied.spanSeconds)}s)`,
    );
  }

  return details.length > 0 ? details.join(', ') : 'The task completed successfully.';
}

/**
 * Derives the legacy single-line message. Kept so the chat-run audit, the
 * bridge, and MCP clients keep receiving the same shape they always have.
 */
export function formatKernelRunMessage(report: KernelRunReport): string {
  if (report.outcome === 'declined' && report.decline) {
    return report.decline.nextStep
      ? `${report.decline.explanation} ${report.decline.nextStep}`
      : report.decline.explanation;
  }

  if (report.outcome === 'failed') {
    const digest = report.verified?.fingerprint
      ? shortFingerprint(report.verified.fingerprint)
      : undefined;
    const prefix = digest ? `Kernel verification failed (${digest})` : 'Kernel run failed';
    return report.failure?.trim()
      ? `${prefix}: ${report.failure.trim()}`
      : `${prefix}: the kernel did not report a reason.`;
  }

  const digest = shortFingerprint(report.verified?.fingerprint);
  const details = report.verified
    ? describeVerifiedDetails(report.verified)
    : 'The task completed successfully.';
  const headline = digest
    ? `Kernel verified (${digest}): ${details}`
    : `Kernel verified: ${details}`;

  return report.assumptionNote
    ? `${headline}\n${report.assumptionNote}`
    : headline;
}
