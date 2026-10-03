import type { TextClipProperties, TextRevealMode } from '../../types/text';

/**
 * Per-character text reveal (typewriter, decode, fade, rise).
 *
 * The full text is laid out first; reveal only decides how each glyph slot is
 * drawn, so centered or wrapped text never shifts while it builds up. The
 * state is a pure function of the (keyframeable) `reveal` progress, which keeps
 * preview, scrubbing and export deterministic.
 */
export const TEXT_REVEAL_MODES: readonly TextRevealMode[] = ['typewriter', 'decode', 'fade', 'rise'];
export const TEXT_REVEAL_MODE_LABELS: Record<TextRevealMode, string> = {
  typewriter: 'Typewriter',
  decode: 'Decode',
  fade: 'Fade',
  rise: 'Rise',
};

const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#%&/<>*+=';
const LOWER = 'abcdefghijklmnopqrstuvwxyz0123456789#%&/<>*+=';

export interface TextRevealGlyph {
  visible: boolean;
  alpha: number;
  offsetY: number;
  glyph: string;
}

export interface TextRevealPlan {
  /** State of the glyph slot at `index` (counted across lines, newlines excluded). */
  glyph(index: number, char: string): TextRevealGlyph;
  /** Slot index that shows the block cursor, or -1. */
  cursorIndex: number;
}

const HIDDEN: TextRevealGlyph = { visible: false, alpha: 0, offsetY: 0, glyph: '' };

export function normalizeTextRevealMode(mode: unknown): TextRevealMode {
  return TEXT_REVEAL_MODES.includes(mode as TextRevealMode) ? mode as TextRevealMode : 'typewriter';
}

export function countTextRevealSlots(text: string): number {
  let count = 0;
  for (const char of text) if (char !== '\n') count++;
  return count;
}

function scrambleGlyph(char: string, index: number, step: number): string {
  if (/\s/.test(char)) return char;
  let h = Math.imul(index + 1, 0x9e3779b1) ^ Math.imul(step + 7, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h ^= h >>> 12;
  const set = char >= 'a' && char <= 'z' ? LOWER : UPPER;
  return set[(h >>> 0) % set.length]!;
}

/** Returns null when the text is fully revealed, so the renderer keeps its fast path. */
export function createTextRevealPlan(props: Pick<TextClipProperties, 'text' | 'fontSize' | 'reveal' | 'revealMode' | 'revealSpread' | 'revealCursor'>): TextRevealPlan | null {
  const reveal = props.reveal ?? 1;
  if (!(reveal < 1)) return null;
  const progress = Math.max(0, reveal);
  const mode = normalizeTextRevealMode(props.revealMode);
  const slots = countTextRevealSlots(props.text);
  const spread = Math.max(0.5, props.revealSpread ?? 3);

  if (mode === 'fade' || mode === 'rise') {
    const head = progress * (slots + spread);
    const lift = props.fontSize * 0.45;
    return {
      cursorIndex: -1,
      glyph(index, char) {
        const alpha = Math.min(1, Math.max(0, (head - index) / spread));
        if (alpha <= 0) return HIDDEN;
        return { visible: true, alpha, offsetY: mode === 'rise' ? (1 - alpha) * (1 - alpha) * lift : 0, glyph: char };
      },
    };
  }

  const head = progress * slots;
  const shown = Math.floor(head);
  const scrambleCount = mode === 'decode' ? Math.round(spread) : 0;
  // Scramble glyphs change several times per revealed character.
  const step = Math.floor(head * 3);
  return {
    cursorIndex: props.revealCursor && progress > 0 ? Math.min(shown + scrambleCount, slots) : -1,
    glyph(index, char) {
      if (index < shown) return { visible: true, alpha: 1, offsetY: 0, glyph: char };
      if (index < shown + scrambleCount) return { visible: true, alpha: 1, offsetY: 0, glyph: scrambleGlyph(char, index, step) };
      return HIDDEN;
    },
  };
}
