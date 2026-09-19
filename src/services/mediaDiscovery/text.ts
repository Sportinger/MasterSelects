const HTML_ENTITIES: Record<string, string> = {
  amp: '&',
  apos: "'",
  gt: '>',
  lt: '<',
  nbsp: ' ',
  quot: '"',
};

export function plainExternalText(value: unknown, maximum = 500): string | undefined {
  const source = typeof value === 'object' && value !== null && 'value' in value
    ? String((value as { value: unknown }).value ?? '')
    : typeof value === 'string'
      ? value
      : '';
  const plain = source
    .replace(/<[^>]*>/gu, ' ')
    .replace(/&(#x[\da-f]+|#\d+|[a-z]+);/giu, (entity, code: string) => {
      const numericValue = code.startsWith('#x')
        ? Number.parseInt(code.slice(2), 16)
        : code.startsWith('#')
          ? Number.parseInt(code.slice(1), 10)
          : undefined;
      if (numericValue !== undefined) {
        return Number.isFinite(numericValue) && numericValue <= 0x10ffff
          ? String.fromCodePoint(numericValue)
          : entity;
      }
      return HTML_ENTITIES[code.toLowerCase()] ?? entity;
    })
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, maximum);
  return plain || undefined;
}

export function safeHttpsUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

export function externalRequestSignal(signal?: AbortSignal, timeoutMs = 15_000): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
}
