import type {
  KernelDecisionPrompt,
  StoryboardDecision,
  StoryboardFingerprint,
} from '../contracts';

export interface StoryboardDecisionSelection {
  decisionId: string;
  optionIds: string[];
  freeform?: string;
  refinement?: 'more-like';
}

export type StoryboardDecisionSelectionValidation =
  | { ok: true; selection: StoryboardDecisionSelection }
  | { ok: false; reason: string; stale: boolean };

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

export function createStoryboardDecisionRecord(
  prompt: KernelDecisionPrompt,
  options: {
    explanation?: string;
    parentDecisionId?: string;
    sceneId?: string;
    variantSetId?: string;
    createdAt?: number;
  } = {},
): StoryboardDecision {
  return {
    schemaVersion: 1,
    id: prompt.id,
    kind: prompt.kind,
    question: prompt.question,
    state: 'pending',
    baseFingerprint: { ...prompt.baseFingerprint },
    options: prompt.options.map((option) => ({
      id: option.id,
      title: option.title,
      summary: option.summary,
      tradeoffs: [...(option.tradeoffs ?? [])],
      ...(option.rationale === undefined ? {} : { rationale: option.rationale }),
      ...(option.estimatedCredits === undefined
        ? {}
        : { estimatedCredits: option.estimatedCredits }),
      ...(option.preview === undefined ? {} : { preview: option.preview }),
    })),
    allowMultiple: prompt.allowMultiple ?? false,
    allowFreeform: prompt.allowFreeform ?? false,
    selectedOptionIds: [],
    createdAt: options.createdAt ?? Date.now(),
    ...(options.explanation === undefined ? {} : { explanation: options.explanation }),
    ...(options.parentDecisionId === undefined ? {} : { parentDecisionId: options.parentDecisionId }),
    ...(options.sceneId === undefined ? {} : { sceneId: options.sceneId }),
    ...(options.variantSetId === undefined ? {} : { variantSetId: options.variantSetId }),
  };
}

export function validateStoryboardDecisionSelection(
  decision: StoryboardDecision,
  input: StoryboardDecisionSelection,
  latestFingerprint?: StoryboardFingerprint,
): StoryboardDecisionSelectionValidation {
  if (decision.id !== input.decisionId) {
    return { ok: false, reason: 'Decision ID does not match.', stale: false };
  }
  if (decision.state !== 'pending') {
    return {
      ok: false,
      reason: `Decision is ${decision.state}, not pending.`,
      stale: decision.state === 'stale',
    };
  }
  if (
    latestFingerprint
    && latestFingerprint.value !== decision.baseFingerprint.value
  ) {
    return {
      ok: false,
      reason: 'Decision base fingerprint is stale.',
      stale: true,
    };
  }

  const optionIds = unique(input.optionIds);
  const allowedIds = new Set(decision.options.map((option) => option.id));
  if (optionIds.some((optionId) => !allowedIds.has(optionId))) {
    return { ok: false, reason: 'Selection contains an unknown option.', stale: false };
  }
  if (!decision.allowMultiple && optionIds.length > 1) {
    return { ok: false, reason: 'Decision allows only one option.', stale: false };
  }
  const freeform = input.freeform?.trim();
  if (freeform && !decision.allowFreeform && input.refinement !== 'more-like') {
    return { ok: false, reason: 'Decision does not allow a freeform answer.', stale: false };
  }
  if (optionIds.length === 0 && !freeform) {
    return { ok: false, reason: 'Select an option or enter a response.', stale: false };
  }
  return {
    ok: true,
    selection: {
      decisionId: decision.id,
      optionIds,
      ...(freeform ? { freeform } : {}),
      ...(input.refinement === undefined ? {} : { refinement: input.refinement }),
    },
  };
}

export function resolveStoryboardDecisionRecord(
  decision: StoryboardDecision,
  selection: StoryboardDecisionSelection,
  resolvedAt = Date.now(),
): StoryboardDecision {
  const validation = validateStoryboardDecisionSelection(decision, selection);
  if (!validation.ok) throw new Error(validation.reason);
  return {
    ...decision,
    state: 'resolved',
    selectedOptionIds: validation.selection.optionIds,
    ...(validation.selection.freeform === undefined
      ? {}
      : { freeform: validation.selection.freeform }),
    resolvedAt,
  };
}

export function markStoryboardDecisionStale(
  decision: StoryboardDecision,
): StoryboardDecision {
  return decision.state === 'pending'
    ? { ...decision, state: 'stale' }
    : decision;
}

export function buildStoryboardDecisionContinuationPrompt(
  decision: StoryboardDecision,
  selection: StoryboardDecisionSelection,
): string {
  const selected = selection.optionIds
    .map((optionId) => decision.options.find((option) => option.id === optionId)?.title ?? optionId)
    .join(', ');
  return [
    `Decision: ${decision.question}`,
    selected ? `Selected: ${selected}` : '',
    selection.freeform ? `Direction: ${selection.freeform}` : '',
    'Recompile this choice against the latest editor snapshot. Do not replay stored tool calls.',
  ].filter(Boolean).join('\n');
}
