// Score editor UI state (issue #366, phase 3).
//
// Port of kikoromantest's EditorState. The controllers are framework-free
// and mutate this object directly (as they did under Vue's reactive()); the
// React side observes it through a Proxy that notifies subscribers on every
// set, driving useSyncExternalStore in the toolbar/editor components.

import type { Accidental, NoteDuration } from '../../types/scoreClip';

export type ScoreToolMode = 'entry' | 'selection';

/** All mutable UI state for the score editor. */
export interface ScoreEditorState {
  // --- Tool ---
  selectedTool: ScoreToolMode;

  // --- Note selection ---
  selectedNoteId: string | null;
  selectedArticulationNoteId: string | null;
  selectedArticulationType: string | null;
  selectedAccidentalNoteId: string | null;
  selectedAccidentalType: string | null;
  selectedTupletId: string | null;
  selectedTieFromNoteId: string | null;

  // --- Palette ---
  selectedDuration: NoteDuration;
  selectedAccidental: Accidental | null;
  selectedDots: number;
  accent: boolean;
  staccato: boolean;
  tenuto: boolean;
  tupletMode: boolean;

  // --- UI ---
  showCursor: boolean;
  /** Sheet zoom factor (1 = 100%) */
  zoom: number;
}

export function createScoreEditorState(): ScoreEditorState {
  return {
    selectedTool: 'entry',
    selectedNoteId: null,
    selectedArticulationNoteId: null,
    selectedArticulationType: null,
    selectedAccidentalNoteId: null,
    selectedAccidentalType: null,
    selectedTupletId: null,
    selectedTieFromNoteId: null,
    selectedDuration: 'q',
    selectedAccidental: null,
    selectedDots: 0,
    accent: false,
    staccato: false,
    tenuto: false,
    tupletMode: false,
    showCursor: true,
    zoom: 1,
  };
}

export interface ObservableScoreEditorState {
  /** The state object controllers mutate (Proxy — every set notifies). */
  state: ScoreEditorState;
  /** Subscribe to changes; returns an unsubscribe function. */
  subscribe(listener: () => void): () => void;
  /** Monotonic version for useSyncExternalStore snapshots. */
  getVersion(): number;
}

/** Wrap a fresh EditorState in a change-notifying Proxy (Vue-reactive stand-in). */
export function createObservableScoreEditorState(): ObservableScoreEditorState {
  const listeners = new Set<() => void>();
  let version = 0;

  const state = new Proxy(createScoreEditorState(), {
    set(target, key, value) {
      if (Reflect.get(target, key) === value) return true;
      Reflect.set(target, key, value);
      version++;
      listeners.forEach(listener => listener());
      return true;
    },
  });

  return {
    state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getVersion: () => version,
  };
}
