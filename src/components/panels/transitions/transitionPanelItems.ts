import {
  getTransitionFamilyDimension,
  getTransitionFamilyGroup,
  type TransitionDefinition,
  type TransitionFamilyDimension,
  type TransitionFamilyGroup,
} from '../../../transitions';

export interface TransitionPanelItem {
  key: string;
  label: string;
  dimension: TransitionFamilyDimension;
  transition: TransitionDefinition;
  variantCount: number;
  variants: readonly TransitionDefinition[];
  searchText: string;
}

export interface TransitionPanelSection {
  dimension: TransitionFamilyDimension;
  label: string;
  items: TransitionPanelItem[];
}

const TRANSITION_FAMILY_SEARCH_ALIASES: Partial<Record<string, readonly string[]>> = {
  dissolve: ['fade', 'crossfade', 'additive', 'blur', 'soft'],
  flip: ['3d', 'depth', 'horizontal', 'vertical', 'card'],
  glitch: ['digital', 'analog', 'blocks', 'breakup', 'distortion', 'rgb', 'split', 'chroma', 'mosaic', 'pixelate', 'scanline'],
  iris: ['shape', 'radial', 'circle', 'oval', 'diamond', 'square', 'triangle', 'cross', 'star'],
  light: ['film', 'analog', 'flash', 'sweep', 'flicker', 'projector', 'roll', 'vignette', 'bloom', 'leak', 'flare', 'burn', 'glow'],
  'motion-blur': ['motion', 'blur', 'directional', 'whip', 'pan', 'speed'],
  pattern: ['graphic', 'matte', 'blocks', 'dots', 'splatter', 'blinds', 'bars', 'puzzle', 'pieces', 'magnet', 'magnetic', 'tiles'],
  push: ['motion', 'direction', 'move'],
  rotate: ['2d', 'flat', 'turn', 'quarter', 'left', 'right'],
  roll: ['3d', 'depth', 'barrel'],
  slide: ['motion', 'direction', 'move'],
  spin: ['3d', 'depth', 'card', 'spinback'],
  stylize: ['style', 'dissolve', 'noise', 'water', 'swirl', 'kaleidoscope', 'prism', 'mirror'],
  tumble: ['3d', 'depth', 'fall', 'tilt'],
  wipe: ['direction', 'center', 'clock', 'barn', 'door', 'edge'],
  zoom: ['lens', 'motion', 'scale', 'spin', 'blur'],
};

const THREE_D_PANEL_ORDER: Record<string, number> = {
  flip: 0,
  tumble: 1,
  roll: 2,
  spin: 3,
  cube: 4,
  door: 5,
  fold: 6,
  peel: 7,
};

export function groupTransitionPanelItems(transitions: readonly TransitionDefinition[]): TransitionPanelItem[] {
  const byId = new Map(transitions.map((transition) => [transition.id, transition]));
  const seen = new Set<string>();

  return transitions.flatMap((transition) => {
    const family = getTransitionFamilyGroup(transition.id);
    const key = family?.id ?? transition.id;
    if (seen.has(key)) return [];
    seen.add(key);

    const familyTransitions = family
      ? family.types.map((type) => byId.get(type)).filter((item): item is TransitionDefinition => Boolean(item))
      : [transition];
    const representative = family
      ? byId.get(family.defaultType) ?? transition
      : transition;

    return [{
      key,
      label: family?.label ?? transition.name,
      dimension: family?.dimension ?? getTransitionFamilyDimension(transition.id),
      transition: representative,
      variantCount: familyTransitions.length,
      variants: familyTransitions,
      searchText: createTransitionPanelSearchText(transition, family, byId),
    }];
  });
}

function createTransitionPanelSearchText(
  transition: TransitionDefinition,
  family: TransitionFamilyGroup | undefined,
  byId: ReadonlyMap<string, TransitionDefinition>
): string {
  const familyTransitions = family
    ? family.types.map((type) => byId.get(type)).filter((item): item is TransitionDefinition => Boolean(item))
    : [transition];

  return [
    family?.id,
    family?.label,
    family?.dimension,
    ...(family ? TRANSITION_FAMILY_SEARCH_ALIASES[family.id] ?? [] : []),
    transition.id,
    transition.name,
    transition.category,
    transition.description,
    ...familyTransitions.flatMap((item) => [
      item.id,
      item.name,
      item.category,
      item.description,
    ]),
  ]
    .filter((value): value is string => Boolean(value))
    .join(' ')
    .toLowerCase();
}

function createTransitionSearchTokens(query: string): string[] {
  return query.trim().toLowerCase().split(/\s+/).filter(Boolean);
}

function transitionSearchTextIncludesToken(searchText: string, token: string): boolean {
  if (searchText.includes(token)) return true;
  return token.endsWith('s') && token.length > 2 && searchText.includes(token.slice(0, -1));
}

export function filterTransitionPanelItems(items: readonly TransitionPanelItem[], query: string): TransitionPanelItem[] {
  const tokens = createTransitionSearchTokens(query);
  if (tokens.length === 0) return [...items];
  return items.filter((item) => (
    tokens.every((token) => transitionSearchTextIncludesToken(item.searchText, token))
  ));
}

export function sectionTransitionPanelItems(items: readonly TransitionPanelItem[]): TransitionPanelSection[] {
  const sections: TransitionPanelSection[] = [
    {
      dimension: '2d',
      label: '2D',
      items: items.filter((item) => item.dimension === '2d'),
    },
    {
      dimension: '3d',
      label: '3D',
      items: items
        .filter((item) => item.dimension === '3d')
        .toSorted((a, b) => (THREE_D_PANEL_ORDER[a.key] ?? 99) - (THREE_D_PANEL_ORDER[b.key] ?? 99)),
    },
  ];
  return sections.filter((section) => section.items.length > 0);
}
