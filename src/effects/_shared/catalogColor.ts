type CatalogPrimitive = number | boolean | string;

/** Keeps catalog colors in the canonical string representation expected by inspectors and legacy packers. */
export function normalizeCatalogColor(value: CatalogPrimitive | undefined, fallback: string): string {
  const normalized = typeof value === 'string' ? value.replace(/^#/, '') : '';
  if (/^[\da-f]{6}([\da-f]{2})?$/i.test(normalized)) return `#${normalized.toLowerCase()}`;
  const normalizedFallback = fallback.replace(/^#/, '');
  return /^[\da-f]{6}([\da-f]{2})?$/i.test(normalizedFallback) ? `#${normalizedFallback.toLowerCase()}` : '#000000';
}

/** Canonical catalog/effect color parser. Invalid input resolves through the caller's fallback. */
export function colorToRgba(value: CatalogPrimitive | undefined, fallback: string): [number, number, number, number] {
  const normalized = normalizeCatalogColor(value, fallback).slice(1);
  return [
    Number.parseInt(normalized.slice(0, 2), 16) / 255,
    Number.parseInt(normalized.slice(2, 4), 16) / 255,
    Number.parseInt(normalized.slice(4, 6), 16) / 255,
    normalized.length === 8 ? Number.parseInt(normalized.slice(6, 8), 16) / 255 : 1,
  ];
}
