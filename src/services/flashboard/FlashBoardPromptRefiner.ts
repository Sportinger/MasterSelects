import {
  refineFlashBoardPromptHostedTransport,
  refineFlashBoardPromptTransport,
  streamRefineFlashBoardPromptTransport,
} from './FlashBoardPromptRefinerTransport';
import type {
  RefineFlashBoardPromptInput,
  RefineFlashBoardPromptStreamOptions,
} from './FlashBoardPromptRefinerTypes';

export { FLASHBOARD_PROMPT_REFINER_MODEL } from './FlashBoardPromptRefinerConfig';
export {
  buildFlashBoardPromptRefinerInstructions,
  buildFlashBoardPromptRefinerStreamingUserText,
  buildFlashBoardPromptRefinerUserText,
} from './FlashBoardPromptRefinerPrompt';
export {
  extractRefinedPromptFromOpenAIResponse,
  parseOpenAIStreamFrame,
  parseSunoPromptRefinement,
} from './FlashBoardPromptRefinerResponseMapping';
export type {
  FlashBoardPromptRefinerReference,
  ParsedSunoPromptRefinement,
  RefineFlashBoardPromptInput,
  RefineFlashBoardPromptStreamOptions,
} from './FlashBoardPromptRefinerTypes';

export async function refineFlashBoardPromptHosted(
  input: RefineFlashBoardPromptInput,
  options: Pick<RefineFlashBoardPromptStreamOptions, 'signal'> = {},
): Promise<string> {
  return refineFlashBoardPromptHostedTransport(input, options);
}

export async function streamRefineFlashBoardPrompt(
  input: RefineFlashBoardPromptInput,
  options: RefineFlashBoardPromptStreamOptions = {},
): Promise<string> {
  return streamRefineFlashBoardPromptTransport(input, options);
}

export async function refineFlashBoardPrompt(input: RefineFlashBoardPromptInput): Promise<string> {
  return refineFlashBoardPromptTransport(input);
}
