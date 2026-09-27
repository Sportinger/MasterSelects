// Exact rational arithmetic for musical time (score editor, issue #366).
//
// Musical time is rational — tuplets create time values like 1/3, 1/7, 1/11
// that cannot be represented exactly in floating point. This module provides
// operations over the immutable `Fraction` type that keep all arithmetic exact.
//
// All Fractions are stored in reduced form with a positive denominator.
// The numerator carries the sign.
//
// Unit: beats (quarter notes). A quarter note = {num:1, den:1}.

import type { Fraction, NoteDuration } from '../../types/scoreClip';

export type { Fraction };

function gcd(a: number, b: number): number {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b !== 0) {
    const t = b;
    b = a % b;
    a = t;
  }
  return a === 0 ? 1 : a;
}

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

/**
 * Create a reduced Fraction. Denominator must be non-zero.
 * The denominator of the result is always positive.
 */
export function fracCreate(num: number, den: number): Fraction {
  if (den === 0) throw new Error('Fraction denominator cannot be zero');
  if (num === 0) return { num: 0, den: 1 };
  const sign = den < 0 ? -1 : 1;
  const g = gcd(Math.abs(num), Math.abs(den));
  return { num: (sign * num) / g, den: (sign * den) / g };
}

/** Convenience: integer n becomes n/1 */
export function fracFromInt(n: number): Fraction {
  return { num: n, den: 1 };
}

/**
 * Convert a floating-point number to the nearest Fraction with denominator
 * drawn from musical subdivisions (up to 128th-note resolution in a triplet).
 *
 * This is only used for legacy score migration — prefer fracCreate for new code.
 */
export function fracFromFloat(value: number): Fraction {
  // Use denominators that cover all standard + tuplet durations:
  //   1,2,4,8,16,32 (standard) and their *2/3, *4/5, *4/7 equivalents.
  const CANDIDATE_DENS = [1, 2, 3, 4, 5, 6, 7, 8, 12, 14, 16, 21, 24, 28, 32, 48, 56, 96, 112, 192, 224];
  let bestNum = Math.round(value);
  let bestDen = 1;
  let bestErr = Math.abs(value - bestNum);

  for (const d of CANDIDATE_DENS) {
    const n = Math.round(value * d);
    const err = Math.abs(value - n / d);
    if (err < bestErr) {
      bestErr = err;
      bestNum = n;
      bestDen = d;
    }
    if (bestErr === 0) break;
  }

  return fracCreate(bestNum, bestDen);
}

// ---------------------------------------------------------------------------
// Arithmetic
// ---------------------------------------------------------------------------

export function fracAdd(a: Fraction, b: Fraction): Fraction {
  return fracCreate(a.num * b.den + b.num * a.den, a.den * b.den);
}

export function fracSub(a: Fraction, b: Fraction): Fraction {
  return fracCreate(a.num * b.den - b.num * a.den, a.den * b.den);
}

export function fracMul(a: Fraction, b: Fraction): Fraction {
  return fracCreate(a.num * b.num, a.den * b.den);
}

export function fracDiv(a: Fraction, b: Fraction): Fraction {
  if (b.num === 0) throw new Error('Division by zero fraction');
  return fracCreate(a.num * b.den, a.den * b.num);
}

export function fracNeg(a: Fraction): Fraction {
  if (a.num === 0) return a;
  return { num: -a.num, den: a.den };
}

// ---------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------

export function fracEq(a: Fraction, b: Fraction): boolean {
  return a.num * b.den === b.num * a.den;
}

export function fracLt(a: Fraction, b: Fraction): boolean {
  return a.num * b.den < b.num * a.den;
}

export function fracLte(a: Fraction, b: Fraction): boolean {
  return a.num * b.den <= b.num * a.den;
}

export function fracGt(a: Fraction, b: Fraction): boolean {
  return a.num * b.den > b.num * a.den;
}

export function fracGte(a: Fraction, b: Fraction): boolean {
  return a.num * b.den >= b.num * a.den;
}

/**
 * Returns negative/zero/positive — suitable for Array.sort comparator.
 * Uses subtraction of cross-products to avoid division.
 */
export function fracCompare(a: Fraction, b: Fraction): number {
  return a.num * b.den - b.num * a.den;
}

// ---------------------------------------------------------------------------
// Predicates
// ---------------------------------------------------------------------------

export function fracIsZero(f: Fraction): boolean {
  return f.num === 0;
}

export function fracIsPositive(f: Fraction): boolean {
  return f.num > 0;
}

export function fracIsNegative(f: Fraction): boolean {
  return f.num < 0;
}

// ---------------------------------------------------------------------------
// Conversion
// ---------------------------------------------------------------------------

/**
 * Convert to floating-point number for pixel math and audio scheduling.
 * Do not use this result for comparisons — use fracEq/fracLt.
 */
export function fracToNumber(f: Fraction): number {
  return f.num / f.den;
}

// ---------------------------------------------------------------------------
// Musical duration mapping
// ---------------------------------------------------------------------------

/**
 * Duration values in beats (quarter note = 1 beat).
 *
 *   'w'  → 4/1   'h'  → 2/1   'q'  → 1/1
 *   '8'  → 1/2   '16' → 1/4   '32' → 1/8
 *
 * Dots multiply by 3/2 (one dot) or 7/4 (two dots) — exact fractions.
 */
const DURATION_FRACTIONS: Record<NoteDuration, Fraction> = {
  w: { num: 4, den: 1 },
  h: { num: 2, den: 1 },
  q: { num: 1, den: 1 },
  '8': { num: 1, den: 2 },
  '16': { num: 1, den: 4 },
  '32': { num: 1, den: 8 },
};

const DOT_MULTIPLIERS: Fraction[] = [
  { num: 1, den: 1 }, // 0 dots — identity
  { num: 3, den: 2 }, // 1 dot  — × 3/2
  { num: 7, den: 4 }, // 2 dots — × 7/4
];

/** Convert a NoteDuration + optional dot count to an exact Fraction in beats. */
export function durationToFraction(duration: NoteDuration, dots = 0): Fraction {
  const base = DURATION_FRACTIONS[duration];
  const dotMul = DOT_MULTIPLIERS[Math.min(dots, 2)] ?? DOT_MULTIPLIERS[0];
  return fracMul(base, dotMul);
}

/**
 * Compute the actual sounding duration of a tuplet note as an exact Fraction.
 *
 * @param duration   Written note duration
 * @param dots       Number of dots on the note
 * @param numNotes   N in "N notes fit in space of M" (e.g. 3 for triplet)
 * @param notesOccupied  M in the ratio (e.g. 2 for triplet)
 */
export function tupletNoteDurationFraction(
  duration: NoteDuration,
  dots: number,
  numNotes: number,
  notesOccupied: number,
): Fraction {
  const written = durationToFraction(duration, dots);
  // actual = written × (notesOccupied / numNotes)
  return fracMul(written, fracCreate(notesOccupied, numNotes));
}
