import type { AgentTimelineProvenance } from '../../../types/agentTimeline/manifest';
import {
  AGENT_TIMELINE_OCR_SCHEMA_VERSION,
  type OcrPipelineRequest,
  type OcrPipelineResult,
} from '../../../types/agentTimeline/ocr';
import type { LocalOcrWorker, OcrFrameProvider } from './localOcrRuntimeContracts';
import { createOcrCacheKey } from './ocrCacheKey';
import { decideOcrExecution } from './ocrDecisionGate';
import { normalizeOcrRecognitions } from './ocrNormalization';

function abortError(): Error {
  const error = new Error('OCR analysis cancelled');
  error.name = 'AbortError';
  return error;
}

function resultStatus(decision: OcrPipelineResult['decision']): OcrPipelineResult['status'] {
  if (decision.status === 'enabled') return 'completed';
  if (decision.status === 'disabled') return 'disabled';
  if (decision.status === 'unavailable' || decision.status === 'requires-local-download') return 'unavailable';
  return 'blocked';
}

function provenance(request: OcrPipelineRequest): AgentTimelineProvenance[] {
  return [{
    kind: 'analyzer', analyzerId: request.analyzerId, analyzerVersion: request.analyzerVersion,
    modelId: request.modelId, modelVersion: request.modelVersion,
  }];
}

export interface RunLocalOcrPipelineOptions {
  request: OcrPipelineRequest;
  worker: LocalOcrWorker;
  frames: OcrFrameProvider;
  signal?: AbortSignal;
  onProgress?: (completed: number, total: number) => void;
}

/**
 * Strictly local, dependency-injected OCR runner. Pixels exist only between
 * `frames.acquire` and lease release; durable output contains text metadata.
 */
export async function runLocalOcrPipeline(options: RunLocalOcrPipelineOptions): Promise<OcrPipelineResult> {
  const { request } = options;
  const cacheKey = createOcrCacheKey(request);
  const availability = await options.worker.getAvailability(options.signal);
  const decision = decideOcrExecution({
    profile: request.profile, languages: request.languages, availability,
    policy: request.policy, measurements: request.measurements,
  });
  const base = {
    schemaVersion: AGENT_TIMELINE_OCR_SCHEMA_VERSION,
    decision,
    cacheKey,
    analyzerId: request.analyzerId,
    analyzerVersion: request.analyzerVersion,
    modelId: request.modelId,
    modelVersion: request.modelVersion,
  } as const;
  if (decision.status !== 'enabled') return { ...base, status: resultStatus(decision), events: [], processedCandidateCount: 0 };
  const controller = new AbortController();
  const abort = () => controller.abort();
  options.signal?.addEventListener('abort', abort, { once: true });
  const recognitions = [] as import('../../../types/agentTimeline/ocr').OcrRecognition[];
  let processedCandidateCount = 0;
  try {
    for (const candidate of request.candidates) {
      if (controller.signal.aborted) throw abortError();
      const lease = await options.frames.acquire(candidate, controller.signal);
      try {
        if (controller.signal.aborted) throw abortError();
        const regions = await options.worker.recognize({
          frame: lease.frame, candidate, languages: request.languages, signal: controller.signal,
        });
        recognitions.push({ candidate: { ...candidate }, regions: [...regions].map((region) => ({ ...region, box: region.box ? { ...region.box } : undefined })), provenance: provenance(request) });
        processedCandidateCount += 1;
        options.onProgress?.(processedCandidateCount, request.candidates.length);
      } finally {
        lease.release();
      }
    }
    return { ...base, status: 'completed', events: normalizeOcrRecognitions(recognitions), processedCandidateCount };
  } catch (error) {
    if (controller.signal.aborted || (error instanceof Error && error.name === 'AbortError')) {
      return { ...base, status: 'cancelled', events: [], processedCandidateCount };
    }
    throw error;
  } finally {
    options.signal?.removeEventListener('abort', abort);
  }
}
