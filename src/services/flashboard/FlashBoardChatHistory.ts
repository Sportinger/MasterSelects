import type { FlashBoardChatMessage } from '../../stores/flashboardStore';

/**
 * Cross-turn history budget. Whole messages are dropped oldest-first when the
 * budget is exceeded; the ones that survive are never trimmed mid-content.
 * Raised from 24,000 because a single 26-clip timeline read fills that alone.
 */
const MAX_HISTORY_CHARACTERS = 400_000;
/**
 * Tool arguments and results carry the ids the next turn needs ("now shuffle
 * them"). They used to be cut at 1,500 / 1,000 characters, so a clip list was
 * already lossy by the time the follow-up turn read it. Kept verbatim now.
 */
const MAX_TOOL_RESULT_CHARACTERS = Number.POSITIVE_INFINITY;
const MAX_TOOL_ARGUMENT_CHARACTERS = Number.POSITIVE_INFINITY;

export function buildFlashBoardChatRequestPrompt(
  messages: FlashBoardChatMessage[],
  nextUserPrompt: string,
): string {
  const entries = messages
    .filter((message) => !message.isPending && !message.isError && message.text.trim())
    .map(formatHistoryMessage);
  const selected: string[] = [];
  let usedCharacters = nextUserPrompt.length;

  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]!;
    if (selected.length > 0 && usedCharacters + entry.length > MAX_HISTORY_CHARACTERS) break;
    selected.unshift(entry);
    usedCharacters += entry.length;
  }

  return selected.length > 0
    ? `${selected.join('\n\n')}\n\nUser: ${nextUserPrompt}`
    : nextUserPrompt;
}

function formatHistoryMessage(message: FlashBoardChatMessage): string {
  const role = message.role === 'user' ? 'User' : 'Assistant';
  const toolCalls = (message.toolCalls ?? []).map((call) => {
    const status = call.result.success ? 'success' : `failed: ${call.result.error ?? 'unknown error'}`;
    return [
      `- ${call.toolCall.name}(${truncate(call.toolCall.arguments, MAX_TOOL_ARGUMENT_CHARACTERS)})`,
      `  ${status}`,
      `  result: ${truncate(call.modelContent, MAX_TOOL_RESULT_CHARACTERS)}`,
    ].join('\n');
  });

  return toolCalls.length > 0
    ? `${role}: ${message.text.trim()}\nExecuted tools:\n${toolCalls.join('\n')}`
    : `${role}: ${message.text.trim()}`;
}

function truncate(value: string, maximum: number): string {
  return Number.isFinite(maximum) && value.length > maximum
    ? `${value.slice(0, maximum)}… [truncated]`
    : value;
}
