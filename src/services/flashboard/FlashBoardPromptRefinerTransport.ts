import { cloudAiService } from '../cloudAiService';
import {
  FLASHBOARD_PROMPT_REFINER_MODEL,
  FLASHBOARD_PROMPT_REFINER_OPENAI_RESPONSES_URL,
} from './FlashBoardPromptRefinerConfig';
import {
  buildFlashBoardPromptRefinerInstructions,
  buildFlashBoardPromptRefinerStreamingUserText,
  buildFlashBoardPromptRefinerUserText,
  isSunoTarget,
} from './FlashBoardPromptRefinerPrompt';
import {
  extractRefinedPromptFromOpenAIResponse,
  getOpenAIErrorMessage,
  getResponseOutputText,
  readOpenAIStreamEvents,
} from './FlashBoardPromptRefinerResponseMapping';
import { prepareReferenceImages } from './FlashBoardPromptRefinerReferences';
import type {
  OpenAIResponsePayload,
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

function buildHostedChatRefinerContent(
  input: RefineFlashBoardPromptInput,
  preparedReferences: PreparedPromptReference[],
): Array<Record<string, unknown>> {
  const content: Array<Record<string, unknown>> = [
    {
      type: 'text',
      text: buildFlashBoardPromptRefinerStreamingUserText(input, input.references),
    },
  ];

  for (const reference of preparedReferences) {
    content.push(
      {
        type: 'text',
        text: `${reference.label}: ${reference.displayName}`,
      },
      {
        type: 'image_url',
        image_url: {
          detail: 'high',
          url: reference.dataUrl,
        },
      },
    );
  }

  return content;
}

function readHostedChatText(payload: unknown): string {
  if (!payload || typeof payload !== 'object') {
    return '';
  }

  const record = payload as Record<string, unknown>;
  if (typeof record.output_text === 'string') {
    return record.output_text.trim();
  }

  const choices = Array.isArray(record.choices) ? record.choices : [];
  for (const choice of choices) {
    if (!choice || typeof choice !== 'object') {
      continue;
    }

    const message = (choice as Record<string, unknown>).message;
    if (!message || typeof message !== 'object') {
      continue;
    }

    const content = (message as Record<string, unknown>).content;
    if (typeof content === 'string') {
      return content.trim();
    }

    if (Array.isArray(content)) {
      const text = content
        .map((part) => {
          if (!part || typeof part !== 'object') {
            return '';
          }

          const partRecord = part as Record<string, unknown>;
          return typeof partRecord.text === 'string' ? partRecord.text : '';
        })
        .filter(Boolean)
        .join('\n')
        .trim();

      if (text) {
        return text;
      }
    }
  }

  return '';
}

export async function refineFlashBoardPromptHostedTransport(
  input: RefineFlashBoardPromptInput,
  options: Pick<RefineFlashBoardPromptStreamOptions, 'signal'> = {},
): Promise<string> {
  if (options.signal?.aborted) {
    throw new DOMException('Prompt refinement was canceled.', 'AbortError');
  }

  const preparedReferences = await prepareReferenceImages(input.references);
  const payload = await cloudAiService.createChatCompletion({
    idempotencyKey: `prompt-refine:${Date.now()}:${crypto.randomUUID()}`,
    max_completion_tokens: isSunoTarget(input) ? 1800 : 900,
    messages: [
      {
        role: 'system',
        content: buildFlashBoardPromptRefinerInstructions(input),
      },
      {
        role: 'user',
        content: buildHostedChatRefinerContent(input, preparedReferences),
      },
    ],
    model: FLASHBOARD_PROMPT_REFINER_MODEL,
  });

  if (options.signal?.aborted) {
    throw new DOMException('Prompt refinement was canceled.', 'AbortError');
  }

  const refinedPrompt = readHostedChatText(payload);
  if (!refinedPrompt) {
    throw new Error('Cloud prompt refinement returned an empty response.');
  }

  return refinedPrompt;
}

export async function streamRefineFlashBoardPromptTransport(
  input: RefineFlashBoardPromptInput,
  options: RefineFlashBoardPromptStreamOptions = {},
): Promise<string> {
  const apiKey = input.apiKey?.trim() ?? '';
  if (!apiKey) {
    throw new Error('Add an OpenAI API key in Settings to refine prompts.');
  }

  const preparedReferences = await prepareReferenceImages(input.references);
  const response = await fetch(FLASHBOARD_PROMPT_REFINER_OPENAI_RESPONSES_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    signal: options.signal,
    body: JSON.stringify({
      ...buildOpenAIRefinerBaseBody(input, buildOpenAIRefinerContent(input, preparedReferences, true)),
      stream: true,
      text: {
        verbosity: 'low',
      },
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    let payload: OpenAIResponsePayload | null = null;
    try {
      payload = text ? JSON.parse(text) as OpenAIResponsePayload : null;
    } catch {
      payload = null;
    }
    throw new Error(getOpenAIErrorMessage(payload, response.status, response.statusText));
  }

  let refinedPrompt = '';

  for await (const event of readOpenAIStreamEvents(response)) {
    if (event.type === 'error') {
      throw new Error(event.message || event.error?.message || 'OpenAI prompt refinement failed.');
    }

    if (event.type === 'response.output_text.delta' && typeof event.delta === 'string') {
      refinedPrompt += event.delta;
      options.onDelta?.(event.delta, refinedPrompt);
    } else if (event.type === 'response.output_text.done' && typeof event.text === 'string') {
      refinedPrompt = event.text;
    } else if (event.type === 'response.completed' && event.response && !refinedPrompt.trim()) {
      refinedPrompt = getResponseOutputText(event.response);
    }
  }

  const trimmedPrompt = refinedPrompt.trim();
  if (!trimmedPrompt) {
    throw new Error('OpenAI returned an empty prompt refinement.');
  }

  return trimmedPrompt;
}

export async function refineFlashBoardPromptTransport(input: RefineFlashBoardPromptInput): Promise<string> {
  const apiKey = input.apiKey?.trim() ?? '';
  if (!apiKey) {
    throw new Error('Add an OpenAI API key in Settings to refine prompts.');
  }

  const preparedReferences = await prepareReferenceImages(input.references);
  const content = buildOpenAIRefinerContent(input, preparedReferences, false);

  const response = await fetch(FLASHBOARD_PROMPT_REFINER_OPENAI_RESPONSES_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      ...buildOpenAIRefinerBaseBody(input, content),
      text: {
        verbosity: 'low',
        format: {
          type: 'json_schema',
          name: 'flashboard_prompt_refinement',
          strict: true,
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              prompt: {
                type: 'string',
                description: 'The refined English generation prompt.',
              },
            },
            required: ['prompt'],
          },
        },
      },
    }),
  });

  const payload = await response.json().catch(() => null) as OpenAIResponsePayload | null;
  if (!response.ok) {
    throw new Error(getOpenAIErrorMessage(payload, response.status, response.statusText));
  }

  if (!payload) {
    throw new Error('OpenAI returned an empty response.');
  }

  return extractRefinedPromptFromOpenAIResponse(payload);
}
