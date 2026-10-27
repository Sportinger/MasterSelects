// Middle truncation for file and clip names in narrow phone rows.

/** Shortens a long file name in the middle so its start and extension stay readable. */
export function middleTruncate(text: string, max = 28): string {
  if (text.length <= max) return text;
  const keepEnd = Math.min(10, Math.floor(max / 3));
  const keepStart = max - keepEnd - 1;
  return `${text.slice(0, keepStart)}…${text.slice(-keepEnd)}`;
}
