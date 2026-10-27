// Hands a prepared request to the assistant sheet: All tools (and any other entry point) calls
// openPhoneAssistantWithPrompt, the sheet types the text into its field when it opens and never
// sends it. One plain string, nothing durable, nothing rendered from it before the sheet takes it.

import { usePhoneUiStore } from '../state/phoneUiStore';

let pendingPrompt: string | null = null;

/** Opens the assistant with `prompt` in its field (not sent). */
export function openPhoneAssistantWithPrompt(prompt: string): void {
  pendingPrompt = prompt;
  usePhoneUiStore.getState().openSheet('assistant');
}

/** The waiting text, without taking it (safe to call during render). */
export function peekPhoneAssistantPrefill(): string | null {
  return pendingPrompt;
}

export function clearPhoneAssistantPrefill(): void {
  pendingPrompt = null;
}
