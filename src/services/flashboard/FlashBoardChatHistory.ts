import type { FlashBoardChatMessage } from '../../stores/flashboardStore';

const MAX_HISTORY_CHARACTERS = 24_000;
const MAX_TOOL_RESULT_CHARACTERS = 1_500;
const MAX_TOOL_ARGUMENT_CHARACTERS = 1_000;

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
  return value.length > maximum
    ? `${value.slice(0, maximum)}… [truncated]`
    : value;
}
