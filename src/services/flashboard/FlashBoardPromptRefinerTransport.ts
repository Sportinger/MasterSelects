import { cloudAiService } from '../cloudAiService';
import {
  FLASHBOARD_PROMPT_REFINER_MODEL,
} from './FlashBoardPromptRefinerConfig';
import {
  buildFlashBoardPromptRefinerInstructions,
  buildFlashBoardPromptRefinerStreamingUserText,
  buildFlashBoardPromptRefinerUserText,
  isSunoTarget,
} from './FlashBoardPromptRefinerPrompt';
import { getResponseOutputText } from './FlashBoardPromptRefinerResponseMapping';
import { prepareReferenceImages } from './FlashBoardPromptRefinerReferences';
import type {
  PreparedPromptReference,
  RefineFlashBoardPromptInput,
  RefineFlashBoardPromptStreamOptions,
} from './FlashBoardPromptRefinerTypes';

function buildOpenAIRefinerContent(
  input: RefineFlashBoardPromptInput,
  preparedReferences: PreparedPromptReference[],
  streamed: boolean,
): Array<Record<string, unknown>> {
  const content: Array<Record<string, unknown>> = [
    {
      type: 'input_text',
      text: streamed
        ? buildFlashBoardPromptRefinerStreamingUserText(input, input.references)
        : buildFlashBoardPromptRefinerUserText(input, input.references),
    },
  ];

  for (const reference of preparedReferences) {
    content.push(
      {
        type: 'input_text',
        text: `${reference.label}: ${reference.displayName}`,
      },
      {
        type: 'input_image',
        image_url: reference.dataUrl,
        detail: 'high',
      },
    );
  }

  return content;
}

function buildOpenAIRefinerBaseBody(
  input: RefineFlashBoardPromptInput,
  content: Array<Record<string, unknown>>,
): Record<string, unknown> {
  return {
    model: FLASHBOARD_PROMPT_REFINER_MODEL,
    instructions: buildFlashBoardPromptRefinerInstructions(input),
    input: [
      {
        role: 'user',
        content,
      },
    ],
    reasoning: {
      effort: 'low',
    },
    max_output_tokens: isSunoTarget(input) ? 1800 : 900,
    store: false,
  };
}

export async function refineFlashBoardPromptHostedTransport(
  input: RefineFlashBoardPromptInput,
  options: Pick<RefineFlashBoardPromptStreamOptions, 'signal'> = {},
): Promise<string> {
  if (options.signal?.aborted) {
    throw new DOMException('Prompt refinement was canceled.', 'AbortError');
  }

  const preparedReferences = await prepareReferenceImages(input.references);
  const content = buildOpenAIRefinerContent(input, preparedReferences, true);
  const payload = await cloudAiService.createChatCompletion({
    ...buildOpenAIRefinerBaseBody(input, content),
    idempotencyKey: `prompt-refine:${Date.now()}:${crypto.randomUUID()}`,
    protocol: 'openai-responses',
  });

  if (options.signal?.aborted) {
    throw new DOMException('Prompt refinement was canceled.', 'AbortError');
  }

  const refinedPrompt = getResponseOutputText(payload);
  if (!refinedPrompt) {
    throw new Error('Cloud prompt refinement returned an empty response.');
  }

  return refinedPrompt;
}
