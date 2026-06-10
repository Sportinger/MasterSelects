import type {
  OpenAIResponsePayload,
  OpenAIStreamEvent,
  ParsedSunoPromptRefinement,
} from './FlashBoardPromptRefinerTypes';

export function getOpenAIErrorMessage(
  payload: OpenAIResponsePayload | null,
  status: number,
  statusText: string,
): string {
  return payload?.error?.message || statusText || `OpenAI request failed with status ${status}`;
}

export function getResponseOutputText(payload: OpenAIResponsePayload): string {
  if (typeof payload.output_text === 'string') {
    return payload.output_text;
  }

  return payload.output
    ?.flatMap((item) => item.content ?? [])
    .filter((content) => content.type === 'output_text' && typeof content.text === 'string')
    .map((content) => content.text)
    .join('\n')
    .trim() ?? '';
}

function parseJsonObject(text: string): unknown {
  const trimmed = text.trim();
  if (trimmed.startsWith('```')) {
    return JSON.parse(trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, ''));
  }

  return JSON.parse(trimmed);
}

function getSseFrameBoundary(buffer: string): { index: number; length: number } | null {
  const lineFeedIndex = buffer.indexOf('\n\n');
  const carriageReturnIndex = buffer.indexOf('\r\n\r\n');

  if (lineFeedIndex === -1 && carriageReturnIndex === -1) {
    return null;
  }

  if (lineFeedIndex === -1) {
    return { index: carriageReturnIndex, length: 4 };
  }

  if (carriageReturnIndex === -1 || lineFeedIndex < carriageReturnIndex) {
    return { index: lineFeedIndex, length: 2 };
  }

  return { index: carriageReturnIndex, length: 4 };
}

export function parseSunoPromptRefinement(text: string): ParsedSunoPromptRefinement {
  const fencedTrimmed = text
    .trim()
    .replace(/^```(?:json|text)?\s*/i, '')
    .replace(/\s*```$/i, '');

  if (!fencedTrimmed) {
    return {};
  }

  try {
    const parsed = JSON.parse(fencedTrimmed) as unknown;
    if (parsed && typeof parsed === 'object') {
      const source = parsed as Record<string, unknown>;
      return {
        lyrics: typeof source.lyrics === 'string' ? source.lyrics.trim() : undefined,
        style: typeof source.style === 'string' ? source.style.trim() : undefined,
        negativeTags: typeof source.negativeTags === 'string'
          ? source.negativeTags.trim()
          : typeof source.negative_tags === 'string'
            ? source.negative_tags.trim()
            : typeof source.negativePrompt === 'string'
              ? source.negativePrompt.trim()
          : typeof source.negative === 'string'
            ? source.negative.trim()
            : undefined,
      };
    }
  } catch {
    // Labelled text is the preferred streaming format.
  }

  const result: ParsedSunoPromptRefinement = {};
  let currentKey: keyof ParsedSunoPromptRefinement | null = null;
  const sectionBuffers: Record<keyof ParsedSunoPromptRefinement, string[]> = {
    lyrics: [],
    style: [],
    negativeTags: [],
  };

  const getSection = (line: string): { key: keyof ParsedSunoPromptRefinement; rest: string } | null => {
    const match = line.match(/^\s*(?:#{1,3}\s*)?(lyrics?|song lyrics|lyric prompt|style|style prompt|negative|negative tags|avoid)\s*:?\s*(.*)$/i);
    if (!match) {
      return null;
    }

    const label = match[1].toLowerCase();
    const key = label.startsWith('style')
      ? 'style'
      : label.startsWith('negative') || label === 'avoid'
        ? 'negativeTags'
        : 'lyrics';

    return { key, rest: match[2] ?? '' };
  };

  for (const line of fencedTrimmed.replace(/\r\n/g, '\n').split('\n')) {
    const section = getSection(line);
    if (section) {
      currentKey = section.key;
      if (section.rest.trim()) {
        sectionBuffers[currentKey].push(section.rest);
      }
      continue;
    }

    if (currentKey) {
      sectionBuffers[currentKey].push(line);
    }
  }

  for (const key of Object.keys(sectionBuffers) as Array<keyof ParsedSunoPromptRefinement>) {
    const value = sectionBuffers[key].join('\n').trim();
    if (value) {
      result[key] = value;
    }
  }

  return result;
}

export function parseOpenAIStreamFrame(frame: string): OpenAIStreamEvent | null {
  const data = frame
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart())
    .join('\n')
    .trim();

  if (!data || data === '[DONE]') {
    return null;
  }

  return JSON.parse(data) as OpenAIStreamEvent;
}

export async function* readOpenAIStreamEvents(response: Response): AsyncGenerator<OpenAIStreamEvent> {
  if (!response.body) {
    throw new Error('OpenAI streaming is not available in this browser.');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });

    let boundary = getSseFrameBoundary(buffer);
    while (boundary) {
      const frame = buffer.slice(0, boundary.index);
      buffer = buffer.slice(boundary.index + boundary.length);
      const event = parseOpenAIStreamFrame(frame);
      if (event) {
        yield event;
      }
      boundary = getSseFrameBoundary(buffer);
    }

    if (done) {
      break;
    }
  }

  if (buffer.trim()) {
    const event = parseOpenAIStreamFrame(buffer);
    if (event) {
      yield event;
    }
  }
}

export function extractRefinedPromptFromOpenAIResponse(payload: OpenAIResponsePayload): string {
  const outputText = getResponseOutputText(payload);

  if (!outputText) {
    throw new Error('OpenAI returned an empty prompt refinement.');
  }

  const parsed = parseJsonObject(outputText);
  const prompt = typeof parsed === 'object' && parsed && 'prompt' in parsed
    ? (parsed as { prompt?: unknown }).prompt
    : null;

  if (typeof prompt !== 'string' || !prompt.trim()) {
    throw new Error('OpenAI returned an invalid prompt refinement.');
  }

  return prompt.trim();
}
