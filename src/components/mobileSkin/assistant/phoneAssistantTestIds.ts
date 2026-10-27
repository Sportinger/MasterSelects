// Stable selectors of the phone assistant sheet.
export const PHONE_ASSISTANT_TEST_IDS = {
  root: 'phone-assistant',
  /** Account line; carries data-access-kind (checking/offline/signedOut/guest/noCredits/ready). */
  access: 'phone-assistant-access',
  accessAction: 'phone-assistant-access-action',
  /** Clear state when the assistant service cannot be reached; carries data-state (unreachable). */
  serviceState: 'phone-assistant-service-state',
  serviceRetry: 'phone-assistant-service-retry',
  /** One per model choice; carries data-mode and aria-pressed. */
  model: 'phone-assistant-model',
  /** Why a greyed model choice cannot be used on this server (one line per greyed choice). */
  modelUnavailable: 'phone-assistant-model-unavailable',
  newChat: 'phone-assistant-new-chat',
  messages: 'phone-assistant-messages',
  /** One per message; carries data-role, data-message-id and data-pending. */
  message: 'phone-assistant-message',
  copy: 'phone-assistant-copy',
  /** Expandable list of one request's tool calls; carries data-count. */
  toolCalls: 'phone-assistant-toolcalls',
  /** One per tool call; carries data-tool and data-status (running/done/failed). */
  toolCall: 'phone-assistant-toolcall',
  /** Live line while a request runs. */
  progress: 'phone-assistant-progress',
  error: 'phone-assistant-error',
  prompt: 'phone-assistant-prompt',
  /** Send, or Stop while a request runs; carries data-state (send/stop). */
  send: 'phone-assistant-send',
  undo: 'phone-assistant-undo',
  undoHint: 'phone-assistant-undo-hint',
  jumpLatest: 'phone-assistant-jump-latest',
} as const;

// Timeline variants (A/B/C) in the assistant sheet.
export const PHONE_ASSISTANT_VARIANTS_TEST_IDS = {
  root: 'phone-assistant-variants',
  ask: 'phone-assistant-variants-ask',
} as const;

export const PHONE_VARIANTS_PROMPT =
  'Make three alternative versions (A, B and C) of the timeline between the in and out points, or of the whole timeline, so I can compare them. Do not change my current edit until I keep one.';
