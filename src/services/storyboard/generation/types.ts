import type {
  FlashBoardActiveGenerationRecord,
  FlashBoardGenerationRequest,
  FlashBoardMediaType,
  FlashBoardService,
} from '../../../stores/flashboardStore/types';
import type {
  FlashBoardPriceQuote,
  FlashBoardPricingInput,
} from '../../flashboard/FlashBoardPricing';
import type { CatalogEntry } from '../../flashboard/types';
import type {
  StoryboardCandidate,
  StoryboardGenerationBrief,
  StoryboardProjectState,
} from '../contracts';

export const STORYBOARD_GENERATION_REQUEST_KEY_PREFIX = 'storyboard-generation:';
export const STORYBOARD_GENERATION_APPROVAL_TTL_MS = 5 * 60 * 1000;

export type StoryboardGenerationRoute = 'hosted';

export interface StoryboardGenerationAvailability {
  hostedAvailable: boolean;
}

export interface StoryboardGenerationReference {
  mediaFileId: string;
  mediaType: FlashBoardMediaType;
  role: 'start-frame' | 'end-frame' | 'reference';
}

export interface StoryboardGenerationCapabilitySelection {
  imageSize?: string;
  mode?: string;
  providerId?: string;
  service?: FlashBoardService;
  version?: string;
}

export interface StoryboardGenerationCapability {
  aspectRatio: string;
  description: string;
  durationSeconds: number;
  durableProviderIdempotency: boolean;
  imageSize?: string;
  mode?: string;
  name: string;
  outputType: 'audio' | 'image' | 'video';
  providerId: string;
  references: StoryboardGenerationReference[];
  route: StoryboardGenerationRoute;
  service: FlashBoardService;
  submissionSupported: boolean;
  unsupportedReason?: string;
  version: string;
}

export interface ResolveStoryboardGenerationCapabilitiesInput {
  availability: StoryboardGenerationAvailability;
  brief: StoryboardGenerationBrief;
  catalogEntries?: readonly CatalogEntry[];
  referenceMediaTypes?: Readonly<Record<string, FlashBoardMediaType>>;
  selection?: StoryboardGenerationCapabilitySelection;
}

export type StoryboardGenerationPricingPort = (
  input: FlashBoardPricingInput,
) => FlashBoardPriceQuote | null;

export interface StoryboardGenerationBatchQuote {
  maximumSpend: number;
  perRequest: FlashBoardPriceQuote;
  requestCount: number;
  total: number;
}

export interface PreparedStoryboardGenerationEntry {
  candidate: StoryboardCandidate;
  generationRequestKey: string;
  index: number;
  request: FlashBoardGenerationRequest;
}

export interface PreparedStoryboardGeneration {
  batchKey: string;
  briefId: string;
  briefRevision: number;
  candidateCount: number;
  capability: StoryboardGenerationCapability;
  compatibleCapabilities: StoryboardGenerationCapability[];
  entries: PreparedStoryboardGenerationEntry[];
  fingerprint: string;
  preparedAt: number;
  projectId: string;
  quote: StoryboardGenerationBatchQuote;
  sceneId: string;
  schemaVersion: 1;
  userId: string;
}

export interface PrepareStoryboardGenerationInput
  extends ResolveStoryboardGenerationCapabilitiesInput {
  candidateCount: number;
  now?: number;
  pricingPort?: StoryboardGenerationPricingPort;
  projectId: string;
  userId: string;
}

declare const storyboardGenerationApprovalTokenBrand: unique symbol;
export type StoryboardGenerationApprovalToken = string & {
  readonly [storyboardGenerationApprovalTokenBrand]: true;
};

export interface ApprovePreparedStoryboardGenerationInput {
  explicitUserApproval: true;
  expiresInMs?: number;
  maxSpend: number;
  now?: number;
  priceUnit: FlashBoardPriceQuote['unit'];
  projectId: string;
  userId: string;
}

export interface StoryboardGenerationApproval {
  expiresAt: number;
  maxSpend: number;
  priceUnit: FlashBoardPriceQuote['unit'];
  token: StoryboardGenerationApprovalToken;
}

export interface StoryboardGenerationSubmissionPorts {
  createRecord(
    request: FlashBoardGenerationRequest,
  ): FlashBoardActiveGenerationRecord;
  listRecords(): readonly FlashBoardActiveGenerationRecord[];
  persistState?(state: StoryboardProjectState): Promise<void> | void;
  startRecord(recordId: string): FlashBoardActiveGenerationRecord;
}

export interface SubmitPreparedStoryboardGenerationInput {
  now?: number;
  ports?: StoryboardGenerationSubmissionPorts;
  prepared: PreparedStoryboardGeneration;
  pricingPort?: StoryboardGenerationPricingPort;
  projectId: string;
  state: StoryboardProjectState;
  token: StoryboardGenerationApprovalToken;
  userId: string;
}

export interface StoryboardGenerationSubmissionEntryResult {
  candidateId: string;
  error?: string;
  generationRequestKey: string;
  recordId?: string;
  status: 'failed' | 'reused' | 'submitted';
}

export interface StoryboardGenerationSubmissionResult {
  entries: StoryboardGenerationSubmissionEntryResult[];
  state: StoryboardProjectState;
  status: 'failed' | 'partial' | 'submitted';
}

export type StoryboardGenerationRestoreAction =
  | {
      kind: 'resume';
      recordId: string;
      remoteTaskId: string;
      request: FlashBoardGenerationRequest;
    }
  | {
      kind: 'resubmit-idempotently';
      recordId: string;
      request: FlashBoardGenerationRequest;
    }
  | {
      kind: 'needs-confirmation';
      reason: string;
      recordId: string;
    }
  | {
      kind: 'awaiting-import';
      recordId: string;
    };

export interface ReconcileStoryboardGenerationRecordsResult {
  actions: StoryboardGenerationRestoreAction[];
  state: StoryboardProjectState;
}

export interface StoryboardGenerationRestorePorts {
  hasJob(recordId: string): boolean;
  resume(input: {
    recordId: string;
    remoteTaskId: string;
    request: FlashBoardGenerationRequest;
  }): void;
  submit(input: {
    recordId: string;
    request: FlashBoardGenerationRequest;
  }): unknown;
}

export interface StoryboardGenerationRestoreExecutionResult {
  executedRecordIds: string[];
  failed: Array<{
    error: string;
    recordId: string;
  }>;
  needsConfirmationRecordIds: string[];
}

export interface StoryboardGenerationCancelPortResult {
  billingMayContinue: boolean;
  disposition: 'canceled-before-submission' | 'cancel-requested' | 'not-found';
  recordId: string;
  remoteTaskId?: string;
}

export interface StoryboardGenerationCancelPorts {
  cancelJob(recordId: string): StoryboardGenerationCancelPortResult;
  getRecord(recordId: string): FlashBoardActiveGenerationRecord | undefined;
  updateJob(
    recordId: string,
    patch: {
      error?: string;
      remoteTaskId?: string;
      status: 'canceled' | 'processing';
    },
  ): void;
}

export interface CancelStoryboardGenerationInput {
  candidateId: string;
  ports?: StoryboardGenerationCancelPorts;
  state: StoryboardProjectState;
}

export interface CancelStoryboardGenerationResult {
  billingMayContinue: boolean;
  disposition:
    | 'canceled-before-submission'
    | 'cancel-requested'
    | 'completed-billable';
  state: StoryboardProjectState;
}
