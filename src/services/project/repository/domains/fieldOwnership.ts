/** Every persisted DTO key must name its storage owner; adding a field breaks its map. */
export type FieldClass = 'content' | 'workspace' | 'journal' | 'resolver' | 'cache' | 'derived' | 'runtime' | 'container' | 'mixed';
export interface FieldOwnership { readonly class: FieldClass; readonly owner: string; }
export type FieldOwnershipMap<T> = { readonly [K in keyof T]-?: FieldOwnership };
export type ClassifiedValues = Partial<Record<FieldClass, Record<string, unknown>>>;
export function classifyFields(value: object, ownership: Record<string, FieldOwnership>): ClassifiedValues {
  const groups: ClassifiedValues = {};
  for (const [key, item] of Object.entries(value)) {
    const field = ownership[key];
    if (!field) throw new TypeError(`Unclassified persisted field: ${key}`);
    if (item !== undefined) (groups[field.class] ??= {})[key] = item;
  }
  return groups;
}
