export const ALL_FONT_WEIGHTS = [100, 200, 300, 400, 500, 600, 700, 800, 900] as const;

export function getFontWeightLabel(weight: number): string {
  if (weight === 100) return 'Thin';
  if (weight === 200) return 'Extra Light';
  if (weight === 300) return 'Light';
  if (weight === 400) return 'Regular';
  if (weight === 500) return 'Medium';
  if (weight === 600) return 'Semi Bold';
  if (weight === 700) return 'Bold';
  if (weight === 800) return 'Extra Bold';
  if (weight === 900) return 'Black';
  return `${weight}`;
}
