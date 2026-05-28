import type { MediaFile } from '../../stores/mediaStore/types';
import type { FlashBoardComposerReferenceRole } from '../../stores/flashboardStore/types';
import { cloudAiService } from '../cloudAiService';
import type { CatalogEntry } from './types';

export const FLASHBOARD_PROMPT_REFINER_MODEL = 'gpt-5.5';

const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';
const MAX_REFERENCE_IMAGE_EDGE = 1280;
const REFERENCE_IMAGE_QUALITY = 0.88;

export interface FlashBoardPromptRefinerReference {
  role: FlashBoardComposerReferenceRole;
  label: string;
  displayName: string;
  mediaType: MediaFile['type'];
  file?: File;
  url?: string;
  thumbnailUrl?: string;
}

export interface RefineFlashBoardPromptInput {
  apiKey?: string;
  prompt: string;
  entry: CatalogEntry;
  service: CatalogEntry['service'];
  providerId: string;
  version: string;
  mode: string;
  duration: number;
  aspectRatio: string;
  imageSize: string;
  generateAudio: boolean;
  multiShots: boolean;
  references: FlashBoardPromptRefinerReference[];
  sunoStyle?: string;
  sunoNegativeTags?: string;
  sunoInstrumental?: boolean;
  sunoCustomMode?: boolean;
  sunoVocalGender?: string;
  sunoStyleWeight?: number;
  sunoWeirdnessConstraint?: number;
  sunoAudioWeight?: number;
}

export interface ParsedSunoPromptRefinement {
  lyrics?: string;
  style?: string;
  negativeTags?: string;
}

interface PreparedPromptReference {
  role: FlashBoardComposerReferenceRole;
  label: string;
  displayName: string;
  dataUrl: string;
}

interface PromptReferenceDescriptor {
  role: FlashBoardComposerReferenceRole;
  label: string;
  displayName: string;
  mediaType?: MediaFile['type'];
}

interface OpenAIOutputContent {
  type?: string;
  text?: string;
}

interface OpenAIOutputItem {
  type?: string;
  content?: OpenAIOutputContent[];
}

interface OpenAIResponsePayload {
  output_text?: string;
  output?: OpenAIOutputItem[];
  error?: {
    message?: string;
  };
}

interface OpenAIStreamEvent {
  type?: string;
  delta?: string;
  text?: string;
  message?: string;
  error?: {
    message?: string;
  };
  response?: OpenAIResponsePayload;
}

interface RefineFlashBoardPromptStreamOptions {
  signal?: AbortSignal;
  onDelta?: (delta: string, fullText: string) => void;
}

function getOutputTypeLabel(entry: CatalogEntry): string {
  if (entry.outputType === 'image' || entry.supportsTextToImage) {
    return 'image';
  }

  if (entry.outputType === 'audio' || entry.supportsTextToAudio) {
    return 'audio';
  }

  return 'video';
}

function isSunoTarget(input: Pick<RefineFlashBoardPromptInput, 'entry' | 'service' | 'providerId'>): boolean {
  return input.entry.service === 'suno'
    || input.service === 'suno'
    || input.providerId.toLowerCase().includes('suno');
}

function getTargetModelGuidance(
  input: Pick<
    RefineFlashBoardPromptInput,
    'entry' | 'service' | 'providerId' | 'multiShots' | 'generateAudio' | 'sunoInstrumental'
  >,
): string {
  const outputType = getOutputTypeLabel(input.entry);
  const providerId = input.providerId.toLowerCase();

  if (isSunoTarget(input)) {
    const lyricGuidance = input.sunoInstrumental
      ? 'Instrumental mode is enabled: write arrangement-focused lyrics text with section markers and no singable vocal lines.'
      : 'Write singable, production-ready lyrics with a clear structure, hook, concrete imagery, and natural English phrasing.';

    return [
      'Optimize for Suno music generation.',
      lyricGuidance,
      'Style must be concise and high-signal: genre, era, mood, tempo feel, instrumentation, vocal character, mix/production cues, and a useful structure hint.',
      'Negative tags must be short comma-separated failure modes that improve generation quality.',
      'Avoid generic filler such as "good song", "high quality", "best", or vague mood-only prompts.',
    ].join('\n');
  }

  if (outputType === 'image') {
    const referenceGuidance = providerId.includes('nano-banana')
      ? 'Nano Banana 2 is reference-aware: explicitly preserve identity, composition, materials, text, logos, style cues, and spatial relationships from relevant REF images unless the user asks to change them.'
      : 'Use reference images as visual anchors and name the exact REF labels when a subject, style, composition, or object should be carried forward.';

    return [
      'Optimize for a single still-image generation prompt.',
      referenceGuidance,
      'Describe the final image, not a process. Include subject, composition, environment, lighting, lens/framing, material/detail fidelity, color palette, and desired finish.',
      'Do not include video motion, shot lists, duration, music, or audio instructions.',
    ].join('\n');
  }

  if (outputType === 'video') {
    const multiShotGuidance = input.multiShots
      ? 'Multi-shot is enabled: write a compact global style and continuity prompt for the whole sequence, not per-shot prompts.'
      : 'Write one coherent shot prompt with clear beginning, motion, camera behavior, subject action, environment, and ending state.';
    const audioGuidance = input.generateAudio
      ? 'Sound generation is enabled: include concise diegetic sound cues only when they support the scene.'
      : 'Do not add soundtrack or sound-design instructions.';

    if (providerId.includes('kling')) {
      return [
        'Optimize for Kling-style image/video generation.',
        'Prioritize physically plausible subject motion, cinematic camera movement, clear temporal progression, and stable identity from referenced frames.',
        multiShotGuidance,
        audioGuidance,
      ].join('\n');
    }

    if (providerId.includes('seedance')) {
      return [
        'Optimize for ByteDance Seedance 2.0 video generation.',
        'Seedance responds best to concise cinematic direction: subject identity, action, scene progression, camera motion, composition, lighting, style, and a clear final state.',
        'When REF audio is supplied, treat it as the performance, speech, mouth-shape, rhythm, or timing driver. Do not describe it as background music unless the user asks for that. Audio references must be paired with at least one visual IN/REF image or video anchor.',
        'When REF image or video media is supplied, preserve the requested identity, pose, costume, object, motion, or scene cues and name the relevant REF labels explicitly.',
        'Seedance first/last-frame mode and multimodal reference mode are separate. If multiple REF media are present, write natural reference guidance instead of relying on strict first-frame wording.',
        'Avoid long shot lists, unsupported parameter names, negative prompts, or soundtrack instructions.',
        multiShotGuidance,
        audioGuidance,
      ].join('\n');
    }

    return [
      'Optimize for a video generation prompt.',
      multiShotGuidance,
      'Include subject action, camera movement, scene progression, lighting, style, and continuity with referenced frames.',
      audioGuidance,
    ].join('\n');
  }

  return [
    'Optimize for a text-to-speech prompt.',
    'Rewrite the text in clear English while preserving the speaker intent and avoiding image-generation language.',
  ].join('\n');
}

export function buildFlashBoardPromptRefinerInstructions(
  input: Pick<
    RefineFlashBoardPromptInput,
    'entry' | 'service' | 'providerId' | 'version' | 'multiShots' | 'generateAudio' | 'sunoInstrumental'
  >,
): string {
  const outputType = getOutputTypeLabel(input.entry);

  if (isSunoTarget(input)) {
    return [
      'You are MasterSelects Suno Prompt Refiner. Your job is to turn a draft song idea into excellent English Suno inputs.',
      '',
      'Success criteria:',
      '- Preserve the user intent, but make the song more vivid, singable, and model-fit.',
      '- Write lyrics that have a clear musical structure and avoid bland placeholder lines.',
      '- Write a compact style field that steers genre, vocals, arrangement, production, and mood.',
      '- Write negative tags that reduce bad artifacts without fighting the intended style.',
      '- The output must be in English even when the user draft is not.',
      '- Do not mention OpenAI, GPT, prompt rewriting, or this refinement step.',
      '',
      'Return exactly these labelled sections and nothing else:',
      'LYRICS:',
      'STYLE:',
      'NEGATIVE:',
      '',
      `Target: ${input.entry.name}`,
      `Provider: ${input.service}/${input.providerId}`,
      `Version: ${input.version}`,
      `Output type: ${outputType}`,
      '',
      getTargetModelGuidance(input),
    ].join('\n');
  }

  return [
    'You are MasterSelects Prompt Refiner. Your only job is to rewrite a user draft into one excellent English generation prompt for the selected target model.',
    '',
    'Success criteria:',
    '- Preserve the user intent and improve specificity, clarity, and model fit.',
    '- Use the supplied reference images as evidence. Do not invent identity, text, brands, logos, objects, or composition details that are not visible or requested.',
    '- Keep useful REF labels such as REF 1 or START when the downstream model should use a specific reference.',
    '- Return a final prompt only; no analysis, no alternatives, no markdown.',
    '- The final prompt must be in English even when the user draft is not.',
    '- Do not mention OpenAI, GPT, prompt rewriting, or this refinement step.',
    '',
    `Target: ${input.entry.name}`,
    `Provider: ${input.service}/${input.providerId}`,
    `Version: ${input.version}`,
    `Output type: ${outputType}`,
    '',
    getTargetModelGuidance(input),
  ].join('\n');
}

export function buildFlashBoardPromptRefinerUserText(
  input: Pick<
    RefineFlashBoardPromptInput,
    | 'prompt'
    | 'entry'
    | 'service'
    | 'providerId'
    | 'mode'
    | 'duration'
    | 'aspectRatio'
    | 'imageSize'
    | 'generateAudio'
    | 'multiShots'
    | 'sunoStyle'
    | 'sunoNegativeTags'
    | 'sunoInstrumental'
    | 'sunoCustomMode'
    | 'sunoVocalGender'
    | 'sunoStyleWeight'
    | 'sunoWeirdnessConstraint'
    | 'sunoAudioWeight'
  >,
  references: PromptReferenceDescriptor[],
): string {
  const outputType = getOutputTypeLabel(input.entry);
  const referenceLines = references.length > 0
    ? references.map((reference) => {
        const mediaType = reference.mediaType ? ` ${reference.mediaType}` : '';
        return `- ${reference.label} (${reference.role}${mediaType}): ${reference.displayName}`;
      }).join('\n')
    : '- none';

  if (isSunoTarget(input)) {
    return [
      'Rewrite the Suno inputs for the selected music generation settings.',
      '',
      `Current lyrics / song idea:\n${input.prompt.trim() || '(empty)'}`,
      '',
      `Current style:\n${input.sunoStyle?.trim() || '(empty)'}`,
      '',
      `Current negative tags:\n${input.sunoNegativeTags?.trim() || '(empty)'}`,
      '',
      'Suno settings:',
      `- Mode: ${input.sunoCustomMode ? 'custom' : 'simple'}`,
      `- Instrumental: ${input.sunoInstrumental ? 'yes' : 'no'}`,
      `- Vocal gender: ${input.sunoVocalGender || 'auto'}`,
      `- Style weight: ${input.sunoStyleWeight ?? 'default'}`,
      `- Weirdness: ${input.sunoWeirdnessConstraint ?? 'default'}`,
      `- Audio weight: ${input.sunoAudioWeight ?? 'default'}`,
      '',
      'Reference images supplied in order:',
      referenceLines,
      '',
      'Return exactly three labelled sections: LYRICS, STYLE, NEGATIVE.',
    ].join('\n');
  }

  return [
    'Rewrite the draft prompt for the selected generation settings.',
    '',
    `Current draft prompt:\n${input.prompt.trim() || '(empty: infer a useful prompt from the reference images and generation settings)'}`,
    '',
    'Generation settings:',
    `- Output: ${outputType}`,
    `- Aspect ratio: ${input.aspectRatio}`,
    `- Duration: ${outputType === 'video' ? `${input.duration}s` : 'not applicable'}`,
    `- Image size: ${outputType === 'image' ? input.imageSize : 'not applicable'}`,
    `- Mode: ${input.mode || 'default'}`,
    `- Sound: ${input.generateAudio ? 'enabled' : 'disabled'}`,
    `- Multi-shot: ${input.multiShots ? 'enabled' : 'disabled'}`,
    '',
    'Reference images supplied in order:',
    referenceLines,
    '',
    'Return JSON with a single field named "prompt".',
  ].join('\n');
}

export function buildFlashBoardPromptRefinerStreamingUserText(
  input: Pick<
    RefineFlashBoardPromptInput,
    | 'prompt'
    | 'entry'
    | 'service'
    | 'providerId'
    | 'mode'
    | 'duration'
    | 'aspectRatio'
    | 'imageSize'
    | 'generateAudio'
    | 'multiShots'
    | 'sunoStyle'
    | 'sunoNegativeTags'
    | 'sunoInstrumental'
    | 'sunoCustomMode'
    | 'sunoVocalGender'
    | 'sunoStyleWeight'
    | 'sunoWeirdnessConstraint'
    | 'sunoAudioWeight'
  >,
  references: PromptReferenceDescriptor[],
): string {
  if (isSunoTarget(input)) {
    return buildFlashBoardPromptRefinerUserText(input, references);
  }

  return [
    buildFlashBoardPromptRefinerUserText(input, references)
      .replace(
        'Return JSON with a single field named "prompt".',
        'Return the final refined English prompt text only. Do not wrap it in JSON, quotes, markdown, or commentary.',
      ),
  ].join('\n');
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

function getReferenceSource(reference: FlashBoardPromptRefinerReference): { url: string; revoke?: boolean } | null {
  if (reference.file?.type.startsWith('image/')) {
    return {
      url: URL.createObjectURL(reference.file),
      revoke: true,
    };
  }

  const url = reference.thumbnailUrl ?? (reference.mediaType === 'image' ? reference.url : undefined);
  return url ? { url } : null;
}

function loadImage(sourceUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Image could not be loaded.'));
    image.src = sourceUrl;
  });
}

async function imageUrlToJpegDataUrl(sourceUrl: string): Promise<string> {
  if (typeof document === 'undefined') {
    throw new Error('Prompt refinement image preparation requires a browser.');
  }

  const image = await loadImage(sourceUrl);
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;

  if (!sourceWidth || !sourceHeight) {
    throw new Error('Image has no readable dimensions.');
  }

  const scale = Math.min(1, MAX_REFERENCE_IMAGE_EDGE / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Could not prepare image canvas.');
  }

  context.drawImage(image, 0, 0, width, height);
  return canvas.toDataURL('image/jpeg', REFERENCE_IMAGE_QUALITY);
}

async function prepareReferenceImage(reference: FlashBoardPromptRefinerReference): Promise<PreparedPromptReference | null> {
  const source = getReferenceSource(reference);
  if (!source) {
    return null;
  }

  try {
    return {
      role: reference.role,
      label: reference.label,
      displayName: reference.displayName,
      dataUrl: await imageUrlToJpegDataUrl(source.url),
    };
  } catch (error) {
    throw new Error(`Could not prepare ${reference.label} (${reference.displayName}) for prompt refinement.`, {
      cause: error,
    });
  } finally {
    if (source.revoke) {
      URL.revokeObjectURL(source.url);
    }
  }
}

async function prepareReferenceImages(
  references: FlashBoardPromptRefinerReference[],
): Promise<PreparedPromptReference[]> {
  const prepared = await Promise.all(references.map((reference) => prepareReferenceImage(reference)));
  return prepared.filter((reference): reference is PreparedPromptReference => Boolean(reference));
}

function getOpenAIErrorMessage(payload: OpenAIResponsePayload | null, status: number, statusText: string): string {
  return payload?.error?.message || statusText || `OpenAI request failed with status ${status}`;
}

function getResponseOutputText(payload: OpenAIResponsePayload): string {
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

async function* readOpenAIStreamEvents(response: Response): AsyncGenerator<OpenAIStreamEvent> {
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

export async function refineFlashBoardPromptHosted(
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

export async function streamRefineFlashBoardPrompt(
  input: RefineFlashBoardPromptInput,
  options: RefineFlashBoardPromptStreamOptions = {},
): Promise<string> {
  const apiKey = input.apiKey?.trim() ?? '';
  if (!apiKey) {
    throw new Error('Add an OpenAI API key in Settings to refine prompts.');
  }

  const preparedReferences = await prepareReferenceImages(input.references);
  const response = await fetch(OPENAI_RESPONSES_URL, {
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

export async function refineFlashBoardPrompt(input: RefineFlashBoardPromptInput): Promise<string> {
  const apiKey = input.apiKey?.trim() ?? '';
  if (!apiKey) {
    throw new Error('Add an OpenAI API key in Settings to refine prompts.');
  }

  const preparedReferences = await prepareReferenceImages(input.references);
  const content = buildOpenAIRefinerContent(input, preparedReferences, false);

  const response = await fetch(OPENAI_RESPONSES_URL, {
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
