// Which Fast/Medium/Slow choices work on this server, learned from real Direct runs.
//
// The Direct app-server only knows the model providers it was configured with. When a run fails because
// the chosen model's provider is missing there (production: "failed to load configuration: Model
// provider `deepseek` not found"), that choice stays visible but greyed with a reason for the rest of
// the session, in every chat surface at once (desktop pills, AI Studio, the phone sheet). The state is
// session-only on purpose: a later deploy may add the provider, so a new session tries again.

import { useSyncExternalStore } from 'react';

import type { FlashBoardChatAgentMode } from '../../../services/flashboard/FlashBoardChatService';
import { Logger } from '../../../services/logger';
import { FLASHBOARD_CHAT_AGENT_OPTIONS, flashBoardChatAgentModeLabel } from './flashBoardChatAgentOptions';

const log = Logger.create('FlashBoardChatAgentAvailability');

/** The choice every server can run: the default Codex model. */
const LAST_RESORT_AGENT_MODE: FlashBoardChatAgentMode = 'direct';

export type FlashBoardChatAgentUnavailability = Readonly<Partial<Record<FlashBoardChatAgentMode, string>>>;

let unavailable: FlashBoardChatAgentUnavailability = {};
let lastWorkingAgentMode: FlashBoardChatAgentMode | null = null;
const listeners = new Set<() => void>();

/**
 * True for a Direct failure whose cause is a model provider the server does not have configured.
 * Matches the shape, not one exact string: any wording that names a "model provider" together with a
 * not-found / unknown / not-configured verdict, wherever it sits in the message.
 */
export function isDirectModelProviderMissingError(message: string | null | undefined): boolean {
  if (!message) return false;
  const text = message.replace(/\s+/g, ' ');
  if (/\b(unknown|unsupported|missing|unconfigured) model[ _-]?provider\b/i.test(text)) return true;
  if (/\bno (such )?model[ _-]?provider\b/i.test(text)) return true;
  return /\bmodel[ _-]?provider\b.{0,80}?\b(not found|not configured|not defined|not available|not registered|does not exist|doesn't exist|is unknown|unknown|missing)\b/i
    .test(text);
}

/** The reason a greyed choice shows, and the message a failed run turns into. */
export function flashBoardChatAgentModeUnavailableReason(mode: FlashBoardChatAgentMode): string {
  const others = FLASHBOARD_CHAT_AGENT_OPTIONS
    .filter((option) => option.id !== mode && unavailable[option.id] === undefined)
    .map((option) => option.label);
  const advice = others.length === 0
    ? ''
    : ` Use ${others.length === 1 ? others[0] : `${others.slice(0, -1).join(', ')} or ${others[others.length - 1]}`}.`;
  return `${flashBoardChatAgentModeLabel(mode)} is not available on this server right now.${advice}`;
}

export function getFlashBoardChatAgentUnavailability(): FlashBoardChatAgentUnavailability {
  return unavailable;
}

export function subscribeFlashBoardChatAgentUnavailability(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The greyed choices with their reasons; re-renders when one is added. */
export function useFlashBoardChatAgentUnavailability(): FlashBoardChatAgentUnavailability {
  return useSyncExternalStore(
    subscribeFlashBoardChatAgentUnavailability,
    getFlashBoardChatAgentUnavailability,
    getFlashBoardChatAgentUnavailability,
  );
}

/** Greys a choice for the rest of the session; returns its reason. */
export function markFlashBoardChatAgentModeUnavailable(mode: FlashBoardChatAgentMode, serverError?: string): string {
  if (unavailable[mode] === undefined) {
    // The owner sees a plain reason; the raw server error stays in the log for diagnosis.
    log.warn(`Chat model ${mode} greyed for this session: the server lacks its model provider.`, serverError);
    // Rebuild every reason: the advice of an earlier greyed choice must not name this one any more.
    unavailable = { ...unavailable, [mode]: '' };
    const next: Partial<Record<FlashBoardChatAgentMode, string>> = {};
    for (const key of Object.keys(unavailable) as FlashBoardChatAgentMode[]) {
      next[key] = flashBoardChatAgentModeUnavailableReason(key);
    }
    unavailable = next;
    if (lastWorkingAgentMode === mode) lastWorkingAgentMode = null;
    for (const listener of listeners) listener();
  }
  return unavailable[mode] ?? flashBoardChatAgentModeUnavailableReason(mode);
}

export function recordFlashBoardChatAgentModeWorked(mode: FlashBoardChatAgentMode): void {
  if (unavailable[mode] === undefined) lastWorkingAgentMode = mode;
}

/** The choice to use instead of `mode`: `mode` itself while it works, else the last working one, else Slow. */
export function availableFlashBoardChatAgentMode(mode: FlashBoardChatAgentMode): FlashBoardChatAgentMode {
  if (unavailable[mode] === undefined) return mode;
  if (lastWorkingAgentMode !== null && unavailable[lastWorkingAgentMode] === undefined) return lastWorkingAgentMode;
  if (unavailable[LAST_RESORT_AGENT_MODE] === undefined) return LAST_RESORT_AGENT_MODE;
  return FLASHBOARD_CHAT_AGENT_OPTIONS.find((option) => unavailable[option.id] === undefined)?.id ?? LAST_RESORT_AGENT_MODE;
}

/** Test seam: a fresh session. */
export function resetFlashBoardChatAgentAvailabilityForTests(): void {
  unavailable = {};
  lastWorkingAgentMode = null;
  for (const listener of listeners) listener();
}
