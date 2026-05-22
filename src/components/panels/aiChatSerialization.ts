export interface ModelToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

export const MAX_TOOL_RESULT_MESSAGE_CHARS = 12000;

const MAX_TOOL_RESULT_ARRAY_ITEMS = 20;
const MAX_TOOL_RESULT_OBJECT_KEYS = 30;
const MAX_TOOL_RESULT_STRING_CHARS = 1200;

const IMAGE_DATA_URL_PATTERN = /^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)$/i;
const IMAGE_DATA_URL_GLOBAL_PATTERN = /data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=\s]+/gi;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength)}... [truncated]`;
}

function estimateDecodedBytes(base64: string): number {
  const compact = base64.replace(/\s/g, '');
  if (compact.length === 0) {
    return 0;
  }

  const padding = compact.endsWith('==') ? 2 : compact.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((compact.length * 3) / 4) - padding);
}

function formatByteCount(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function describeImageDataUrl(value: string): string | null {
  const match = IMAGE_DATA_URL_PATTERN.exec(value);
  if (!match) {
    return null;
  }

  const mediaType = match[1];
  const byteCount = estimateDecodedBytes(match[2]);
  return `[image data omitted from text context: ${mediaType}, approx ${formatByteCount(byteCount)}]`;
}

function redactImageDataUrls(value: string): string {
  return value.replace(IMAGE_DATA_URL_GLOBAL_PATTERN, (match) => (
    describeImageDataUrl(match) ?? '[image data omitted from text context]'
  ));
}

function sanitizeToolResultValue(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') {
    return describeImageDataUrl(value) ?? redactImageDataUrls(value);
  }

  if (
    value === null
    || typeof value === 'number'
    || typeof value === 'boolean'
    || typeof value === 'undefined'
  ) {
    return value;
  }

  if (depth >= 10) {
    return '[truncated nested value]';
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeToolResultValue(item, depth + 1));
  }

  if (isRecord(value)) {
    const sanitized: Record<string, unknown> = {};

    for (const [key, nestedValue] of Object.entries(value)) {
      sanitized[key] = sanitizeToolResultValue(nestedValue, depth + 1);
    }

    return sanitized;
  }

  return String(value);
}

function summarizeToolResultValue(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') {
    return truncateText(describeImageDataUrl(value) ?? redactImageDataUrls(value), MAX_TOOL_RESULT_STRING_CHARS);
  }

  if (
    value === null
    || typeof value === 'number'
    || typeof value === 'boolean'
    || typeof value === 'undefined'
  ) {
    return value;
  }

  if (depth >= 3) {
    return '[truncated nested value]';
  }

  if (Array.isArray(value)) {
    const items = value
      .slice(0, MAX_TOOL_RESULT_ARRAY_ITEMS)
      .map((item) => summarizeToolResultValue(item, depth + 1));

    if (value.length > MAX_TOOL_RESULT_ARRAY_ITEMS) {
      items.push(`[${value.length - MAX_TOOL_RESULT_ARRAY_ITEMS} more items truncated]`);
    }

    return items;
  }

  if (isRecord(value)) {
    const entries = Object.entries(value);
    const summary: Record<string, unknown> = {};

    for (const [key, nestedValue] of entries.slice(0, MAX_TOOL_RESULT_OBJECT_KEYS)) {
      summary[key] = summarizeToolResultValue(nestedValue, depth + 1);
    }

    if (entries.length > MAX_TOOL_RESULT_OBJECT_KEYS) {
      summary.__truncatedKeys = entries.length - MAX_TOOL_RESULT_OBJECT_KEYS;
    }

    return summary;
  }

  return String(value);
}

function sanitizeToolResult(result: ModelToolResult): ModelToolResult {
  return {
    data: sanitizeToolResultValue(result.data),
    error: result.error,
    success: result.success,
  };
}

function isToolResultLike(value: unknown): value is ModelToolResult {
  return isRecord(value) && typeof value.success === 'boolean';
}

function formatGenericStoredValueForApi(value: unknown, maxLength: number): string {
  const sanitized = sanitizeToolResultValue(value);
  const serialized = JSON.stringify(sanitized);

  if (serialized.length <= maxLength) {
    return serialized;
  }

  return JSON.stringify({
    preview: truncateText(redactImageDataUrls(serialized), Math.max(256, maxLength - 128)),
    truncated: true,
  });
}

export function formatToolResultForApi(
  result: ModelToolResult,
  maxLength = MAX_TOOL_RESULT_MESSAGE_CHARS,
): string {
  const sanitized = sanitizeToolResult(result);
  const serialized = JSON.stringify(sanitized);

  if (serialized.length <= maxLength) {
    return serialized;
  }

  const summarized = JSON.stringify({
    data: summarizeToolResultValue(sanitized.data),
    error: sanitized.error ?? null,
    success: sanitized.success,
    truncated: true,
  });

  if (summarized.length <= maxLength) {
    return summarized;
  }

  return JSON.stringify({
    error: sanitized.error ?? null,
    preview: truncateText(redactImageDataUrls(serialized), Math.max(256, maxLength - 128)),
    success: sanitized.success,
    truncated: true,
  });
}

export function formatStoredToolMessageForApi(
  content: string,
  maxLength = MAX_TOOL_RESULT_MESSAGE_CHARS,
): string {
  try {
    const parsed = JSON.parse(content);
    if (isToolResultLike(parsed)) {
      return formatToolResultForApi(parsed, maxLength);
    }

    return formatGenericStoredValueForApi(parsed, maxLength);
  } catch {
    const redacted = redactImageDataUrls(content);
    return redacted.length <= maxLength
      ? redacted
      : truncateText(redacted, Math.max(256, maxLength));
  }
}
