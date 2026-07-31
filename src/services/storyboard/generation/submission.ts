import {
  getFlashBoardActiveGenerationRecords,
  prepareFlashBoardActiveGenerationRequest,
  startFlashBoardActiveGenerationRecord,
} from '../../../stores/flashboardStore/activeGenerationRecords';
import type {
  FlashBoardActiveGenerationRecord,
} from '../../../stores/flashboardStore/types';
import { getFlashBoardPriceQuote } from '../../flashboard/FlashBoardPricing';
import { reconcileStoryboardGenerationRecord } from '../candidates';
import { validateStoryboardGenerationApproval } from './approvalTokens';
import {
  generationRequestsEqual,
  preparedGenerationFingerprintMaterial,
  stableStringifyGenerationValue,
} from './canonical';
import { createStoryboardGenerationPricingInput } from './preparedGeneration';
import type {
  StoryboardGenerationSubmissionPorts,
  StoryboardGenerationSubmissionResult,
  SubmitPreparedStoryboardGenerationInput,
} from './types';
import { recordStoryboardTelemetry } from '../telemetry';

interface InFlightSubmission {
  binding: string;
  promise: Promise<StoryboardGenerationSubmissionResult>;
}

const inFlightSubmissions = new Map<string, InFlightSubmission>();

const defaultPorts: StoryboardGenerationSubmissionPorts = {
  createRecord: prepareFlashBoardActiveGenerationRequest,
  listRecords: getFlashBoardActiveGenerationRecords,
  persistState: async (state) => {
    const { hydrateStoryboardProjectState } = await import('../../../stores/storyboardStore');
    hydrateStoryboardProjectState(state);
  },
  startRecord: startFlashBoardActiveGenerationRecord,
};

function recordForRequestKey(
  records: readonly FlashBoardActiveGenerationRecord[],
  generationRequestKey: string,
): FlashBoardActiveGenerationRecord | undefined {
  return records.find(
    (record) => record.request?.idempotencyKey === generationRequestKey,
  );
}

function assertCurrentPrice(
  input: SubmitPreparedStoryboardGenerationInput,
  maxSpend: number,
): void {
  const pricingPort = input.pricingPort ?? getFlashBoardPriceQuote;
  let currentTotal = 0;
  for (const entry of input.prepared.entries) {
    const current = pricingPort(createStoryboardGenerationPricingInput(entry.request));
    const approved = input.prepared.quote.perRequest;
    if (
      !current?.exact
      || current.amount !== approved.amount
      || current.unit !== approved.unit
      || current.pricingVersion !== approved.pricingVersion
    ) {
      throw new Error('Generation price changed after approval.');
    }
    currentTotal += current.amount;
  }
  if (
    currentTotal !== input.prepared.quote.total
    || currentTotal > maxSpend
  ) {
    throw new Error('Generation request count or total spend changed after approval.');
  }
}

function withCandidateFailure(
  state: SubmitPreparedStoryboardGenerationInput['state'],
  candidateId: string,
): SubmitPreparedStoryboardGenerationInput['state'] {
  const candidate = state.candidates[candidateId];
  if (!candidate) return state;
  return {
    ...state,
    candidates: {
      ...state.candidates,
      [candidateId]: { ...candidate, state: 'failed' },
    },
  };
}

function mapCandidateToRecord(
  state: SubmitPreparedStoryboardGenerationInput['state'],
  candidateId: string,
  record: FlashBoardActiveGenerationRecord,
): SubmitPreparedStoryboardGenerationInput['state'] {
  const candidate = state.candidates[candidateId];
  if (!candidate) return state;
  const mapped = {
    ...candidate,
    generationRecordId: record.id,
    state: record.job?.status === 'processing' ? 'processing' as const : 'queued' as const,
  };
  const mappedState = {
    ...state,
    candidates: {
      ...state.candidates,
      [candidateId]: mapped,
    },
  };
  return mappedState;
}

function reconcileCandidateRecord(
  state: SubmitPreparedStoryboardGenerationInput['state'],
  candidateId: string,
  record: FlashBoardActiveGenerationRecord,
): SubmitPreparedStoryboardGenerationInput['state'] {
  const candidate = state.candidates[candidateId];
  if (!candidate) return state;
  return reconcileStoryboardGenerationRecord(state, {
    generationBriefRevision: inputBriefRevision(candidate),
    generationRequestKey: candidate.generationRequestKey,
    record,
    sceneId: candidate.sceneId,
  }).state;
}

function inputBriefRevision(candidate: { generationBriefRevision?: number }): number {
  if (candidate.generationBriefRevision === undefined) {
    throw new Error('Prepared storyboard candidate is missing its brief revision.');
  }
  return candidate.generationBriefRevision;
}

async function runSubmission(
  input: SubmitPreparedStoryboardGenerationInput,
): Promise<StoryboardGenerationSubmissionResult> {
  if (!input.prepared.capability.submissionSupported) {
    throw new Error(
      input.prepared.capability.unsupportedReason
      ?? 'The prepared provider route cannot be submitted safely.',
    );
  }
  const approval = await validateStoryboardGenerationApproval(
    input.prepared,
    input.token,
    {
      now: input.now ?? Date.now(),
      projectId: input.projectId,
      userId: input.userId,
    },
  );
  assertCurrentPrice(input, approval.maxSpend);

  const ports = input.ports ?? defaultPorts;
  let state = {
    ...input.state,
    candidates: { ...input.state.candidates },
  };
  for (const entry of input.prepared.entries) {
    state.candidates[entry.candidate.id] =
      state.candidates[entry.candidate.id] ?? { ...entry.candidate };
  }
  await ports.persistState?.(state);

  const results: StoryboardGenerationSubmissionResult['entries'] = [];
  for (const entry of input.prepared.entries) {
    try {
      let record = recordForRequestKey(ports.listRecords(), entry.generationRequestKey);
      let created = false;
      if (record && !generationRequestsEqual(record.request, entry.request)) {
        throw new Error(
          `Generation idempotency collision for ${entry.generationRequestKey}.`,
        );
      }
      if (!record) {
        record = ports.createRecord(entry.request);
        created = true;
      }
      if (!generationRequestsEqual(record.request, entry.request)) {
        throw new Error(
          `FlashBoard record ${record.id} does not match its prepared request.`,
        );
      }
      state = mapCandidateToRecord(state, entry.candidate.id, record);
      // This persistence is the external-side-effect boundary: candidate and
      // record provenance exist before startRecord can reach a provider.
      await ports.persistState?.(state);
      const shouldStart = record.job?.status === 'draft';
      if (shouldStart) {
        record = ports.startRecord(record.id);
      }
      state = reconcileCandidateRecord(state, entry.candidate.id, record);
      await ports.persistState?.(state);
      results.push({
        candidateId: entry.candidate.id,
        generationRequestKey: entry.generationRequestKey,
        recordId: record.id,
        status: created || shouldStart ? 'submitted' : 'reused',
      });
    } catch (error) {
      state = withCandidateFailure(state, entry.candidate.id);
      await ports.persistState?.(state);
      results.push({
        candidateId: entry.candidate.id,
        error: error instanceof Error ? error.message : String(error),
        generationRequestKey: entry.generationRequestKey,
        status: 'failed',
      });
    }
  }

  const successful = results.filter((entry) => entry.status !== 'failed').length;
  const result: StoryboardGenerationSubmissionResult = {
    entries: results,
    state,
    status: successful === results.length
      ? 'submitted'
      : successful === 0
        ? 'failed'
        : 'partial',
  };
  recordStoryboardTelemetry('generation.submitted', {
    count: results.length,
    failedCount: results.length - successful,
    status: result.status,
    succeededCount: successful,
  });
  return result;
}

export function submitPreparedStoryboardGeneration(
  input: SubmitPreparedStoryboardGenerationInput,
): Promise<StoryboardGenerationSubmissionResult> {
  const lockKey = String(input.token);
  const binding = stableStringifyGenerationValue({
    prepared: preparedGenerationFingerprintMaterial(input.prepared),
    projectId: input.projectId,
    userId: input.userId,
  });
  const existing = inFlightSubmissions.get(lockKey);
  if (existing) {
    return existing.binding === binding
      ? existing.promise
      : Promise.reject(new Error('Concurrent generation submission changed its approval binding.'));
  }

  const submission = runSubmission(input).finally(() => {
    if (inFlightSubmissions.get(lockKey)?.promise === submission) {
      inFlightSubmissions.delete(lockKey);
    }
  });
  inFlightSubmissions.set(lockKey, { binding, promise: submission });
  return submission;
}
