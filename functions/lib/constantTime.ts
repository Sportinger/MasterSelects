const encoder = new TextEncoder();

/**
 * Compares two byte sequences without leaking where they diverge. A length
 * mismatch still walks the longer input so the response time depends only on
 * the input sizes, never on the position of the first differing byte.
 */
export function timingSafeEqualBytes(supplied: Uint8Array, expected: Uint8Array): boolean {
  const length = Math.max(supplied.length, expected.length);
  let difference = supplied.length ^ expected.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (supplied[index] ?? 0) ^ (expected[index] ?? 0);
  }
  return difference === 0;
}

/**
 * Constant-time comparison for secrets carried as strings: HMAC signatures,
 * bearer tokens, webhook secrets, CSRF tokens. Non-string inputs never match.
 */
export function timingSafeEqualStrings(
  supplied: string | null | undefined,
  expected: string | null | undefined,
): boolean {
  if (typeof supplied !== 'string' || typeof expected !== 'string') {
    return false;
  }
  return timingSafeEqualBytes(encoder.encode(supplied), encoder.encode(expected));
}
