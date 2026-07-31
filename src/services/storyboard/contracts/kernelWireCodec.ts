import {
  StoryboardContractError,
  isPlainRecord,
  parseStoryboardGenerationBrief,
} from './modelCodec';
import type {
  JsonObject,
  JsonValue,
  StoryboardFingerprint,
  TimelineVariantScope,
} from './models';
import type {
  KernelAbortedResponse,
  KernelExecuteResponse,
  KernelFailedResponse,
  KernelPlannedResponse,
  KernelResolvedCall,
  KernelStoryboardResponse,
  KernelVariantPlanResponse,
} from './kernelWire';

function record(value: unknown, path: string): Record<string, unknown> {
  if (!isPlainRecord(value)) throw new StoryboardContractError('expected an object', path);
  return value;
}

function string(value: unknown, path: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new StoryboardContractError('expected a non-empty string', path);
  }
  return value;
}

function number(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new StoryboardContractError('expected a finite non-negative number', path);
  }
  return value;
}

function json(value: unknown, path: string): JsonValue {
  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) throw new Error('not JSON');
    return JSON.parse(serialized) as JsonValue;
  } catch {
    throw new StoryboardContractError('expected JSON-safe content', path);
  }
}

function stringArray(value: unknown, path: string): string[] {
  if (!Array.isArray(value)) throw new StoryboardContractError('expected an array', path);
  return value.map((entry, index) => string(entry, `${path}[${index}]`));
}

function fingerprint(value: unknown, path: string): StoryboardFingerprint {
  const candidate = record(value, path);
  if (
    candidate.schemaVersion !== 1
    || candidate.algorithm !== 'sha-256'
    || typeof candidate.value !== 'string'
    || !/^[a-f0-9]{64}$/i.test(candidate.value)
  ) {
    throw new StoryboardContractError('expected a v1 SHA-256 fingerprint', path);
  }
  return {
    schemaVersion: 1,
    algorithm: 'sha-256',
    value: candidate.value,
  };
}

function resolvedCall(value: unknown, path: string): KernelResolvedCall {
  const candidate = record(value, path);
  return {
    stepId: string(candidate.stepId, `${path}.stepId`),
    tool: string(candidate.tool, `${path}.tool`),
    args: record(json(candidate.args, `${path}.args`), `${path}.args`) as JsonObject,
  };
}

function resolvedCalls(value: unknown, path: string): KernelResolvedCall[] {
  if (!Array.isArray(value)) throw new StoryboardContractError('expected an array', path);
  return value.map((entry, index) => resolvedCall(entry, `${path}[${index}]`));
}

function variantScope(value: unknown, path: string): TimelineVariantScope {
  const candidate = record(value, path);
  const startTime = number(candidate.startTime, `${path}.startTime`);
  const endTime = number(candidate.endTime, `${path}.endTime`);
  if (endTime <= startTime) {
    throw new StoryboardContractError('must be after startTime', `${path}.endTime`);
  }
  if (typeof candidate.includeLinked !== 'boolean') {
    throw new StoryboardContractError('expected a boolean', `${path}.includeLinked`);
  }
  return {
    startTime,
    endTime,
    trackIds: stringArray(candidate.trackIds, `${path}.trackIds`),
    includeLinked: candidate.includeLinked,
  };
}

function decisionPrompt(
  value: unknown,
  path: string,
): import('./kernelWire').KernelDecisionPrompt {
  const candidate = record(value, path);
  const allowedKinds = new Set(['story', 'evidence', 'generation', 'cut', 'variant', 'duration']);
  if (typeof candidate.kind !== 'string' || !allowedKinds.has(candidate.kind)) {
    throw new StoryboardContractError('unknown decision kind', `${path}.kind`);
  }
  if (!Array.isArray(candidate.options)) {
    throw new StoryboardContractError('expected an array', `${path}.options`);
  }
  if (candidate.allowMultiple !== undefined && typeof candidate.allowMultiple !== 'boolean') {
    throw new StoryboardContractError('expected a boolean', `${path}.allowMultiple`);
  }
  if (candidate.allowFreeform !== undefined && typeof candidate.allowFreeform !== 'boolean') {
    throw new StoryboardContractError('expected a boolean', `${path}.allowFreeform`);
  }
  return {
    id: string(candidate.id, `${path}.id`),
    kind: candidate.kind as import('./kernelWire').KernelDecisionPrompt['kind'],
    question: string(candidate.question, `${path}.question`),
    baseFingerprint: fingerprint(candidate.baseFingerprint, `${path}.baseFingerprint`),
    options: candidate.options.map((option, index) => {
      const optionPath = `${path}.options[${index}]`;
      const optionRecord = record(option, optionPath);
      if (optionRecord.tradeoffs !== undefined && !Array.isArray(optionRecord.tradeoffs)) {
        throw new StoryboardContractError('expected an array', `${optionPath}.tradeoffs`);
      }
      if (
        optionRecord.estimatedCredits !== undefined
        && (typeof optionRecord.estimatedCredits !== 'number'
          || !Number.isFinite(optionRecord.estimatedCredits)
          || optionRecord.estimatedCredits < 0)
      ) {
        throw new StoryboardContractError(
          'expected a finite non-negative number',
          `${optionPath}.estimatedCredits`,
        );
      }
      return {
        id: string(optionRecord.id, `${optionPath}.id`),
        title: string(optionRecord.title, `${optionPath}.title`),
        summary: string(optionRecord.summary, `${optionPath}.summary`),
        ...(optionRecord.rationale === undefined
          ? {}
          : { rationale: string(optionRecord.rationale, `${optionPath}.rationale`) }),
        ...(optionRecord.tradeoffs === undefined
          ? {}
          : { tradeoffs: stringArray(optionRecord.tradeoffs, `${optionPath}.tradeoffs`) }),
        ...(optionRecord.estimatedCredits === undefined
          ? {}
          : { estimatedCredits: optionRecord.estimatedCredits }),
        ...(optionRecord.preview === undefined
          ? {}
          : { preview: json(optionRecord.preview, `${optionPath}.preview`) }),
      };
    }),
    ...(candidate.allowMultiple === undefined
      ? {}
      : { allowMultiple: candidate.allowMultiple }),
    ...(candidate.allowFreeform === undefined
      ? {}
      : { allowFreeform: candidate.allowFreeform }),
  };
}

function parsePlanned(
  candidate: Record<string, unknown>,
  runId: string,
  message: string,
): KernelPlannedResponse {
  return {
    runId,
    status: 'planned',
    message,
    resolvedCalls: resolvedCalls(candidate.resolvedCalls, 'response.resolvedCalls'),
    ...(candidate.expectedFingerprint === undefined
      ? {}
      : { expectedFingerprint: fingerprint(candidate.expectedFingerprint, 'response.expectedFingerprint') }),
    ...(candidate.planSummary === undefined
      ? {}
      : { planSummary: json(candidate.planSummary, 'response.planSummary') }),
  };
}

function parseVariant(
  candidate: Record<string, unknown>,
  runId: string,
  message: string,
): KernelVariantPlanResponse {
  const variantSet = record(candidate.variantSet, 'response.variantSet');
  if (!Array.isArray(variantSet.options)) {
    throw new StoryboardContractError('expected an array', 'response.variantSet.options');
  }
  return {
    runId,
    status: 'variant-planned',
    message,
    variantSet: {
      scope: variantScope(variantSet.scope, 'response.variantSet.scope'),
      baseFingerprint: fingerprint(
        variantSet.baseFingerprint,
        'response.variantSet.baseFingerprint',
      ),
      options: variantSet.options.map((option, index) => {
        const optionPath = `response.variantSet.options[${index}]`;
        const optionRecord = record(option, optionPath);
        const briefs = optionRecord.generationBriefs === undefined
          ? []
          : (() => {
              if (!Array.isArray(optionRecord.generationBriefs)) {
                throw new StoryboardContractError('expected an array', `${optionPath}.generationBriefs`);
              }
              return optionRecord.generationBriefs.map((brief) => (
                parseStoryboardGenerationBrief(brief)
              ));
            })();
        return {
          id: string(optionRecord.id, `${optionPath}.id`),
          title: string(optionRecord.title, `${optionPath}.title`),
          rationale: string(optionRecord.rationale, `${optionPath}.rationale`),
          resolvedCalls: resolvedCalls(optionRecord.resolvedCalls, `${optionPath}.resolvedCalls`),
          generationBriefs: briefs,
        };
      }),
    },
  };
}

function parseExecute(
  candidate: Record<string, unknown>,
  runId: string,
): KernelExecuteResponse {
  const mode = candidate.mode;
  if (mode !== undefined && mode !== 'mechanical' && mode !== 'story') {
    throw new StoryboardContractError('expected mechanical or story', 'response.mode');
  }
  const setup = candidate.setup === undefined
    ? undefined
    : (() => {
        const setupRecord = record(candidate.setup, 'response.setup');
        const composition = record(setupRecord.newComposition, 'response.setup.newComposition');
        return {
          newComposition: {
            name: string(composition.name, 'response.setup.newComposition.name'),
            durationSeconds: number(
              composition.durationSeconds,
              'response.setup.newComposition.durationSeconds',
            ),
          },
        };
      })();
  const segments = candidate.segments === undefined
    ? undefined
    : (() => {
        const segmentsRecord = record(candidate.segments, 'response.segments');
        return {
          simulatedVideoClipIds: stringArray(
            segmentsRecord.simulatedVideoClipIds,
            'response.segments.simulatedVideoClipIds',
          ),
        };
      })();
  return {
    runId,
    status: 'compiled',
    ...(mode === undefined ? {} : { mode }),
    taskContract: json(candidate.taskContract, 'response.taskContract'),
    ...(candidate.plan === undefined ? {} : { plan: json(candidate.plan, 'response.plan') }),
    ...(candidate.storySummary === undefined
      ? {}
      : { storySummary: json(candidate.storySummary, 'response.storySummary') }),
    resolvedCalls: resolvedCalls(candidate.resolvedCalls, 'response.resolvedCalls'),
    ...(setup === undefined ? {} : { setup }),
    ...(segments === undefined ? {} : { segments }),
    expectedFingerprint: fingerprint(candidate.expectedFingerprint, 'response.expectedFingerprint'),
    summary: json(candidate.summary, 'response.summary'),
  };
}

function parseStopped(
  candidate: Record<string, unknown>,
  runId: string,
  status: 'aborted' | 'failed',
): KernelAbortedResponse | KernelFailedResponse {
  const failures = json(candidate.failures, 'response.failures');
  if (status === 'failed') {
    return {
      runId,
      status,
      failures,
      ...(candidate.message === undefined
        ? {}
        : { message: string(candidate.message, 'response.message') }),
    };
  }
  const allowedReasons = new Set([
    'notMechanicalTask',
    'storyPathNeedsProvider',
    'storyPathNeedsMoments',
    'storyOnlyModeActive',
    'staleDecision',
    'staleVariant',
    'policyDeclined',
  ]);
  if (
    candidate.reason !== undefined
    && (typeof candidate.reason !== 'string' || !allowedReasons.has(candidate.reason))
  ) {
    throw new StoryboardContractError('unknown abort reason', 'response.reason');
  }
  let missingPrecondition: { kind: 'transcript' } | undefined;
  if (candidate.missingPrecondition !== undefined) {
    const precondition = record(candidate.missingPrecondition, 'response.missingPrecondition');
    if (precondition.kind !== 'transcript') {
      throw new StoryboardContractError('unknown precondition', 'response.missingPrecondition.kind');
    }
    missingPrecondition = { kind: 'transcript' };
  }
  return {
    runId,
    status,
    failures,
    ...(candidate.reason === undefined
      ? {}
      : { reason: candidate.reason as KernelAbortedResponse['reason'] }),
    ...(missingPrecondition === undefined ? {} : { missingPrecondition }),
  };
}

export function parseKernelStoryboardResponse(value: unknown): KernelStoryboardResponse {
  const candidate = record(value, 'response');
  const runId = string(candidate.runId, 'response.runId');
  const status = candidate.status;
  switch (status) {
    case 'planned':
      return parsePlanned(candidate, runId, string(candidate.message, 'response.message'));
    case 'awaiting-decision':
      return {
        runId,
        status,
        message: string(candidate.message, 'response.message'),
        decision: decisionPrompt(candidate.decision, 'response.decision'),
      };
    case 'variant-planned':
      return parseVariant(candidate, runId, string(candidate.message, 'response.message'));
    case 'compiled':
      return parseExecute(candidate, runId);
    case 'aborted':
    case 'failed':
      return parseStopped(candidate, runId, status);
    default:
      throw new StoryboardContractError('unknown kernel response status', 'response.status');
  }
}
