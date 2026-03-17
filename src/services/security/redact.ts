/**
 * Secret Redaction Utility
 *
 * Automatically strips API keys, bearer tokens, and other sensitive values
 * from log messages and data objects. Used by the Logger and AI tool handlers
 * as defense-in-depth against accidental secret leakage.
 *
 * Design goals:
 * - Catch common secret patterns (OpenAI keys, Bearer tokens, API keys in URLs)
 * - Preserve normal log output (short strings, UUIDs, hex color codes)
 * - Cheap for the common case (no secrets present)
 */

const REDACTED = '[REDACTED]';

// Patterns to redact - ordered by specificity
const SECRET_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  // OpenAI API keys (sk-proj-..., sk-...) and Anthropic keys (sk-ant-...)
  { pattern: /\bsk-[a-zA-Z0-9_-]{20,}\b/g, replacement: `sk-${REDACTED}` },
  // Bearer tokens in headers
  { pattern: /Bearer\s+[a-zA-Z0-9_\-.]{20,}/gi, replacement: `Bearer ${REDACTED}` },
  // x-api-key header values
  { pattern: /x-api-key[:\s]+[^\s,;]{10,}/gi, replacement: `x-api-key: ${REDACTED}` },
  // API key in URL query params (?key=VALUE or &key=VALUE)
  { pattern: /([?&]key=)[a-zA-Z0-9_\-]{15,}/gi, replacement: `$1${REDACTED}` },
  // Generic long hex tokens (40+ chars, likely secrets) — but NOT UUIDs (36 chars with dashes)
  // UUIDs match [a-f0-9]{8}-[a-f0-9]{4}-..., so the dash requirement naturally excludes them.
  { pattern: /\b[a-f0-9]{40,}\b/gi, replacement: REDACTED },
  // Generic long alphanumeric tokens (40+ chars without dashes — likely API keys/secrets)
  { pattern: /\b[a-zA-Z0-9_]{40,}\b/g, replacement: REDACTED },
];

export function redactSecrets(input: string): string {
  let result = input;
  for (const { pattern, replacement } of SECRET_PATTERNS) {
    // Reset lastIndex since we reuse RegExp objects with /g flag
    pattern.lastIndex = 0;
    result = result.replace(pattern, replacement);
  }
  return result;
}

export function redactObject(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'string') return redactSecrets(obj);
  if (typeof obj === 'number' || typeof obj === 'boolean') return obj;
  if (Array.isArray(obj)) return obj.map(redactObject);
  if (obj instanceof Error) {
    return { name: obj.name, message: redactSecrets(obj.message) };
  }
  if (typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      result[key] = redactObject(value);
    }
    return result;
  }
  return obj;
}

export { REDACTED };
