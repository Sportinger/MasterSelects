import type { HostedAgentProviderProtocol } from './contracts';

const MAX_INLINE_IMAGE_BYTES = 16 * 1024 * 1024;
const SUPPORTED_IMAGE_MEDIA_TYPES = new Set([
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every((key) => keys.includes(key));
}

function validBase64Payload(value: unknown): value is string {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length % 4 !== 0
    || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)
  ) {
    return false;
  }
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  return ((value.length * 3) / 4) - padding <= MAX_INLINE_IMAGE_BYTES;
}

function validInlineImageDataUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  return Boolean(
    match
    && SUPPORTED_IMAGE_MEDIA_TYPES.has(match[1].toLowerCase())
    && validBase64Payload(match[2]),
  );
}

function validOpenAiProviderContent(value: Record<string, unknown>): boolean {
  if (!hasOnlyKeys(value, ['openAiFollowupInput'])) return false;
  const followup = value.openAiFollowupInput;
  if (!Array.isArray(followup) || followup.length !== 1 || !isRecord(followup[0])) {
    return false;
  }
  const message = followup[0];
  if (!hasOnlyKeys(message, ['content', 'role']) || message.role !== 'user') return false;
  if (!Array.isArray(message.content) || message.content.length !== 2) return false;
  const [label, image] = message.content;
  return isRecord(label)
    && hasOnlyKeys(label, ['text', 'type'])
    && label.type === 'input_text'
    && typeof label.text === 'string'
    && label.text.length > 0
    && label.text.length <= 2_000
    && !/^\s*data:/i.test(label.text)
    && isRecord(image)
    && hasOnlyKeys(image, ['detail', 'image_url', 'type'])
    && image.type === 'input_image'
    && (image.detail === 'auto' || image.detail === 'high' || image.detail === 'low')
    && validInlineImageDataUrl(image.image_url);
}

function validClaudeProviderContent(value: Record<string, unknown>): boolean {
  if (!hasOnlyKeys(value, ['claudeToolResultContent'])) return false;
  const content = value.claudeToolResultContent;
  if (!Array.isArray(content) || content.length !== 2) return false;
  const [image, text] = content;
  if (!isRecord(image) || !hasOnlyKeys(image, ['source', 'type']) || image.type !== 'image') {
    return false;
  }
  if (!isRecord(image.source) || !hasOnlyKeys(image.source, ['data', 'media_type', 'type'])) {
    return false;
  }
  return image.source.type === 'base64'
    && typeof image.source.media_type === 'string'
    && SUPPORTED_IMAGE_MEDIA_TYPES.has(image.source.media_type.toLowerCase())
    && validBase64Payload(image.source.data)
    && isRecord(text)
    && hasOnlyKeys(text, ['text', 'type'])
    && text.type === 'text'
    && typeof text.text === 'string'
    && !/^\s*data:/i.test(text.text);
}

/**
 * Inline visual tool results cross an authenticated, turn-bound K2 request.
 * Keep the accepted provider payload deliberately narrower than the provider
 * APIs themselves so arbitrary data URLs cannot be smuggled through generic
 * tool text or unrecognised provider fields.
 */
export function validHostedAgentInlineProviderContent(
  value: unknown,
  protocol?: HostedAgentProviderProtocol,
): boolean {
  if (!isRecord(value)) return false;
  if (protocol === undefined) {
    return validOpenAiProviderContent(value) || validClaudeProviderContent(value);
  }
  return protocol === 'openai-responses'
    ? validOpenAiProviderContent(value)
    : validClaudeProviderContent(value);
}

export function hostedAgentInlineProviderContentMaximumImageBytes(): number {
  return MAX_INLINE_IMAGE_BYTES;
}
