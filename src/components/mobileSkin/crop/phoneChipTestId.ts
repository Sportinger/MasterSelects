/** Test id of one chip in a design-sheet chip group: `${prefix}-${value}` with value made id-safe ('16:9' -> '16-9'). */
export function phoneChipTestId(prefix: string, value: string): string {
  return `${prefix}-${value.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`;
}
