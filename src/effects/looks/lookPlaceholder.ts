export interface LookPlaceholder {
  background: string;
  initials: string;
}
function hashText(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function createLookPlaceholder(id: string, name: string): LookPlaceholder {
  const hash = hashText(id);
  const firstHue = hash % 360;
  const secondHue = (firstHue + 35 + ((hash >>> 8) % 100)) % 360;
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toLocaleUpperCase() ?? '')
    .join('');
  return {
    initials,
    background: `linear-gradient(135deg, hsl(${firstHue} 46% 22%), hsl(${secondHue} 58% 38%))`,
  };
}
