/** Parse MM:SS.cc or seconds for composition duration editing. */
export function parseTimelineClock(timeStr: string): number | null {
  const trimmed = timeStr.trim();
  if (!trimmed) return null;

  // Try MM:SS.ms format
  const match = trimmed.match(/^(\d+):(\d+)(?:\.(\d+))?$/);
  if (match) {
    const mins = parseInt(match[1], 10);
    const secs = parseInt(match[2], 10);
    const ms = match[3] ? parseInt(match[3].padEnd(2, '0').slice(0, 2), 10) : 0;
    return mins * 60 + secs + ms / 100;
  }

  // Try SS.ms or just seconds
  const num = parseFloat(trimmed);
  if (!isNaN(num) && num >= 0) {
    return num;
  }

  return null;
}
