/**
 * Secret Redaction Utility
 *
 * Automatically strips API keys, bearer tokens, and other sensitive values
 * from log messages and data objects. Used by the Logger and AI tool handlers
 * as defense-in-depth against accidental secret leakage.
 *
 * Design goals:
 * - Catch common secret patterns (OpenAI/Stripe/Google/GitHub/Resend keys,
 *   JWTs, Bearer tokens, API keys in URLs)
 * - Redact string values stored under secret-looking object keys regardless
 *   of their shape (short passwords, opaque cookies, header values)
 * - Preserve normal log output (short strings, UUIDs, hex color codes)
 * - Cheap for the common case (no secrets present)
 */

const REDACTED = '[REDACTED]';

// Object keys whose string values are always treated as secrets.
const SENSITIVE_KEY_PATTERN = /key|token|secret|password|credential|authorization|cookie/i;

// Patterns to redact - ordered by specificity
const SECRET_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  // OpenAI API keys (sk-proj-..., sk-...) and Anthropic keys (sk-ant-...)
  { pattern: /\bsk-[a-zA-Z0-9_-]{20,}\b/g, replacement: `sk-${REDACTED}` },
  // Stripe keys: sk_live_/sk_test_ secret, rk_ restricted, pk_ publishable, whsec_ webhook
  // secrets. Underscore form - the OpenAI pattern above requires a hyphen and never matches these.
  { pattern: /\b(sk|pk|rk|whsec)_(?:(?:live|test)_)?[A-Za-z0-9]{16,}\b/g, replacement: `$1_${REDACTED}` },
  // Google API keys (AIza + 35 url-safe characters)
  { pattern: /\bAIza[0-9A-Za-z_-]{35}(?![0-9A-Za-z_-])/g, replacement: REDACTED },
  // GitHub tokens (ghp_ personal, gho_ OAuth, ghu_/ghs_ app, ghr_ refresh)
  { pattern: /\bgh[pousr]_[A-Za-z0-9]{36}\b/g, replacement: REDACTED },
  // JSON Web Tokens (three base64url segments; the header always starts with eyJ)
  { pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, replacement: REDACTED },
  // Resend API keys (re_<id> or re_<id>_<secret>)
  { pattern: /\bre_(?:[A-Za-z0-9]{20,}|[A-Za-z0-9]{6,12}_[A-Za-z0-9]{16,})\b/g, replacement: `re_${REDACTED}` },
  // Bearer tokens in headers
  { pattern: /Bearer\s+[a-zA-Z0-9_\-.]{20,}/gi, replacement: `Bearer ${REDACTED}` },
  // x-api-key header values
  { pattern: /x-api-key[:\s]+[^\s,;]{10,}/gi, replacement: `x-api-key: ${REDACTED}` },
  // API key in URL query params (?key=VALUE or &key=VALUE)
  { pattern: /([?&]key=)[a-zA-Z0-9_-]{15,}/gi, replacement: `$1${REDACTED}` },
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

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERN.test(key);
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
      // Non-empty strings under secret-looking keys are redacted whole; empty
      // strings stay visible so "token was missing" remains diagnosable.
      result[key] = isSensitiveKey(key) && typeof value === 'string' && value.length > 0
        ? REDACTED
        : redactObject(value);
    }
    return result;
  }
  return obj;
}

export { REDACTED };
