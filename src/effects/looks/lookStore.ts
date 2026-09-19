import { create } from 'zustand';
import { persist, subscribeWithSelector } from 'zustand/middleware';
import { getEffect } from '..';
import { STARTER_LOOKS } from './starterLooks';
import type { LookCategory, LookDefinition, LookStackEntry } from './types';

interface LookStoreState {
  customLooks: LookDefinition[];
  query: string;
  category: LookCategory | 'all';
  setQuery: (query: string) => void;
  setCategory: (category: LookCategory | 'all') => void;
  saveCustomLook: (name: string, stack: LookStackEntry[]) => LookDefinition | null;
  removeCustomLook: (id: string) => void;
}
function cleanStack(stack: LookStackEntry[]): LookStackEntry[] {
  return stack
    .filter((entry) => !!getEffect(entry.effectId))
    .map((entry) => ({
      effectId: entry.effectId,
      enabled: entry.enabled !== false,
      params: Object.fromEntries(Object.entries(entry.params).filter(([, value]) => (
        typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string'
      ))),
    }));
}

export const useLookStore = create<LookStoreState>()(
  subscribeWithSelector(
    persist(
      (set) => ({
        customLooks: [],
        query: '',
        category: 'all',
        setQuery: (query) => set({ query }),
        setCategory: (category) => set({ category }),
        saveCustomLook: (name, stack) => {
          const normalizedName = name.trim();
          const normalizedStack = cleanStack(stack);
          if (!normalizedName || normalizedStack.length === 0) return null;
          const saved: LookDefinition = {
            id: `custom-${crypto.randomUUID()}`,
            name: normalizedName,
            category: 'custom',
            thumbnail: { kind: 'generated' },
            stack: normalizedStack,
            tags: ['custom'],
            builtIn: false,
          };
          set((state) => ({ customLooks: [...state.customLooks, saved] }));
          return saved;
        },
        removeCustomLook: (id) => set((state) => ({
          customLooks: state.customLooks.filter((look) => look.id !== id),
        })),
      }),
      {
        name: 'masterselects.looks.v1',
        partialize: (state) => ({ customLooks: state.customLooks }),
      },
    ),
  ),
);

export function getVisibleLooks(state: Pick<LookStoreState, 'customLooks' | 'query' | 'category'>): LookDefinition[] {
  const query = state.query.trim().toLocaleLowerCase();
  return [...STARTER_LOOKS, ...state.customLooks].filter((look) => (
    (state.category === 'all' || look.category === state.category)
    && (!query || `${look.name} ${look.tags.join(' ')}`.toLocaleLowerCase().includes(query))
  ));
}
