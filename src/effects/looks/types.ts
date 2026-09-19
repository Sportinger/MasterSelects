export type LookCategory =
  | 'editorial'
  | 'print'
  | 'digital'
  | 'analog'
  | 'motion'
  | 'custom';

export interface LookStackEntry {
  effectId: string;
  params: Record<string, number | boolean | string>;
  enabled: boolean;
}
export interface LookDefinition {
  id: string;
  name: string;
  category: LookCategory;
  thumbnail: { kind: 'generated' };
  stack: LookStackEntry[];
  tags: string[];
  builtIn: boolean;
}
