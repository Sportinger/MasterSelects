function normalizedSearchText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLocaleLowerCase('en')
    .replace(/[^a-z0-9]+/gu, ' ')
    .trim();
}

/** Returns a relevance score, or undefined when every query token is not present. */
export function templateSearchScore(query: string, values: string[]): number | undefined {
  const normalizedQuery = normalizedSearchText(query);
  if (!normalizedQuery) return undefined;
  const normalizedValues = values.map(normalizedSearchText).filter(Boolean);
  const combined = normalizedValues.join(' ');
  const tokens = normalizedQuery.split(' ').filter(Boolean);
  if (!tokens.every((token) => combined.includes(token))) return undefined;

  const primary = normalizedValues[0] ?? '';
  if (primary === normalizedQuery) return 400;
  if (primary.startsWith(normalizedQuery)) return 300;
  if (primary.includes(normalizedQuery)) return 200;
  return 100 - Math.min(primary.length, 80);
}
