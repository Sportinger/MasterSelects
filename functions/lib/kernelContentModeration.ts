import { insertAiAuditEvent } from './aiAudit';
import {
  blocksAiRequest,
  collectModerationImages,
  moderateAiContent,
  type AiModerationResult,
} from './aiModeration';
import type { AppContext, Env } from './env';

/**
 * Content moderation for requests the editor relays to the private kernel:
 * hosted-agent turns, their visual operation results, and Seedance
 * preproduction source frames. The kernel forwards this content to model
 * providers, so it is checked here before it leaves the Cloudflare edge.
 */

export interface KernelContentVerdict {
  blocked: boolean;
  moderation: AiModerationResult;
}

// Editing requests routinely describe action or fight scenes.
const TEXT_ALLOWED_CATEGORIES = ['violence'] as const;
const CAPTURE_GRID_OPERATION_ID = 'timeline.visual.capture-grid.v1';
// Every contact sheet (all frames as thumbnails) plus every Nth full source frame.
const SOURCE_FRAME_SAMPLE_INTERVAL = 4;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function verdict(env: Env, text: string, images: readonly string[]): Promise<KernelContentVerdict> {
  const moderation = await moderateAiContent(env, { images, text });
  return {
    blocked: blocksAiRequest(moderation, { allowedFlaggedCategories: TEXT_ALLOWED_CATEGORIES }),
    moderation,
  };
}

/** The user's request text and inline visual references of a hosted-agent turn start. */
export function moderateHostedAgentStart(
  env: Env,
  start: { request: string; visualReferences: ReadonlyArray<{ source: string; transport: string }> },
): Promise<KernelContentVerdict> {
  const images = start.visualReferences
    .filter((reference) => reference.transport === 'data-url')
    .map((reference) => reference.source);
  return verdict(env, start.request, images);
}

/** Every captured frame grid in a hosted-agent operation result batch. */
export function hostedAgentResultImages(operationResult: unknown): string[] {
  const boundary = isRecord(operationResult) && isRecord(operationResult.result)
    ? operationResult.result
    : null;
  const items = boundary && Array.isArray(boundary.results) ? boundary.results : [];
  return items.flatMap((item) => {
    if (!isRecord(item) || item.operationId !== CAPTURE_GRID_OPERATION_ID) return [];
    const result = isRecord(item.result) ? item.result : null;
    const data = result && isRecord(result.data) ? result.data : null;
    return data && typeof data.imageDataUrl === 'string' ? [data.imageDataUrl] : [];
  });
}

export function moderateHostedAgentOperationResult(
  env: Env,
  operationResult: unknown,
): Promise<KernelContentVerdict> {
  return verdict(env, '', hostedAgentResultImages(operationResult));
}

/** Images in a Seedance preproduction or other kernel relay body. */
export function kernelRelayImages(path: string, body: unknown): string[] {
  if (path !== 'preproduction/seedance/source-frames') return collectModerationImages(body);
  const items = isRecord(body) && Array.isArray(body.items) ? body.items : [];
  return items.flatMap((item) => {
    if (!isRecord(item) || typeof item.dataUrl !== 'string') return [];
    const sampled = item.kind === 'contact-sheet'
      || (typeof item.index === 'number' && item.index % SOURCE_FRAME_SAMPLE_INTERVAL === 0);
    return sampled ? [item.dataUrl] : [];
  });
}

export function moderateKernelRelayBody(env: Env, path: string, body: unknown): Promise<KernelContentVerdict> {
  return verdict(env, '', kernelRelayImages(path, body));
}

export function kernelContentBlockedMessage(moderation: AiModerationResult): string {
  return moderation.status === 'error'
    ? 'Content safety checks are unavailable. Please try again later.'
    : 'This request was blocked by content safety checks.';
}

export function kernelContentBlockedStatus(moderation: AiModerationResult): number {
  return moderation.status === 'error' ? 503 : 400;
}

export function kernelContentBlockedCode(moderation: AiModerationResult): string {
  return moderation.status === 'error' ? 'moderation_unavailable' : 'content_policy_violation';
}

/** Records a blocked kernel request for abuse investigation; never fails the response. */
export async function recordBlockedKernelContent(
  context: AppContext,
  input: { feature: string; moderation: AiModerationResult; prompt: unknown; userId: string },
): Promise<void> {
  await insertAiAuditEvent(context, {
    feature: input.feature,
    moderation: input.moderation,
    prompt: input.prompt,
    provider: 'kernel',
    status: 'blocked',
    userId: input.userId,
  }).catch(() => undefined);
}
