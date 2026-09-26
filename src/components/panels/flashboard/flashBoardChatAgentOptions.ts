import type { FlashBoardChatAgentMode } from '../../../services/flashboard/FlashBoardChatService';

export const FLASHBOARD_CHAT_AGENT_OPTIONS = [
  {
    id: 'standard',
    label: 'Fast',
    title: 'Fast: the Direct workflow on DeepSeek V4.1 Flash.',
  },
  {
    id: 'direct-medium',
    label: 'Medium',
    title: 'Medium: the Direct workflow on GPT-5.6 Terra, medium reasoning, priority processing.',
  },
  {
    id: 'direct',
    label: 'Slow',
    title: 'Slow: the Direct workflow on GPT-5.6 Sol, high reasoning.',
  },
] as const satisfies ReadonlyArray<{
  id: FlashBoardChatAgentMode;
  label: string;
  title: string;
}>;

export const FLASHBOARD_CHAT_AGENT_OPTION_COUNT = FLASHBOARD_CHAT_AGENT_OPTIONS.length;

export function flashBoardChatAgentModeLabel(mode: FlashBoardChatAgentMode): string {
  if (mode === 'logic') return 'Logic';
  return FLASHBOARD_CHAT_AGENT_OPTIONS.find(option => option.id === mode)?.label ?? 'Fast';
}
