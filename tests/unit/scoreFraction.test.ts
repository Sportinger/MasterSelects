import { describe, it, expect } from 'vitest'
import {
  fracCreate,
  fracFromInt,
  fracFromFloat,
  fracAdd,
  fracSub,
  fracMul,
  fracDiv,
  fracNeg,
  fracEq,
  fracLt,
  fracLte,
  fracGt,
  fracGte,
  fracCompare,
  fracIsZero,
  fracIsPositive,
  fracIsNegative,
  fracToNumber,
  durationToFraction,
  tupletNoteDurationFraction,
} from '../../src/services/score/fraction'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function frac(num: number, den: number) {
  return fracCreate(num, den)
}

// ---------------------------------------------------------------------------
// Construction and reduction
// ---------------------------------------------------------------------------

describe('fracCreate', () => {
  it('reduces by GCD', () => {
    expect(frac(6, 4)).toEqual({ num: 3, den: 2 })
    expect(frac(15, 10)).toEqual({ num: 3, den: 2 })
    expect(frac(100, 25)).toEqual({ num: 4, den: 1 })
  })

  it('normalises zero to 0/1', () => {
    expect(frac(0, 7)).toEqual({ num: 0, den: 1 })
  })

  it('moves sign to numerator', () => {
    expect(frac(1, -2)).toEqual({ num: -1, den: 2 })
    expect(frac(-1, -2)).toEqual({ num: 1, den: 2 })
    expect(frac(-3, 4)).toEqual({ num: -3, den: 4 })
  })

  it('throws on zero denominator', () => {
    expect(() => frac(1, 0)).toThrow()
  })

  it('handles large numbers', () => {
    expect(frac(1000, 2000)).toEqual({ num: 1, den: 2 })
  })
})

describe('fracFromInt', () => {
  it('creates n/1', () => {
    expect(fracFromInt(4)).toEqual({ num: 4, den: 1 })
    expect(fracFromInt(0)).toEqual({ num: 0, den: 1 })
    expect(fracFromInt(-3)).toEqual({ num: -3, den: 1 })
  })
})

// ---------------------------------------------------------------------------
// Arithmetic
// ---------------------------------------------------------------------------

describe('fracAdd', () => {
  it('adds same denominator', () => {
    expect(fracAdd(frac(1, 3), frac(1, 3))).toEqual(frac(2, 3))
  })

  it('adds different denominators', () => {
    expect(fracAdd(frac(1, 4), frac(1, 2))).toEqual(frac(3, 4))
  })

  it('triplet notes sum to whole group: 1/3 + 1/3 + 1/3 = 1', () => {
    const third = frac(1, 3)
    const sum = fracAdd(fracAdd(third, third), third)
    expect(sum).toEqual(frac(1, 1))
  })

  it('triplet quarter notes sum to half note: 2/3 + 2/3 + 2/3 = 2', () => {
    const tripletQ = frac(2, 3)
    const sum = fracAdd(fracAdd(tripletQ, tripletQ), tripletQ)
    expect(sum).toEqual(frac(2, 1))
  })

  it('11-tuplet eighths sum to whole group: 11 × (4/11) = 4 beats', () => {
    // 11 eighth notes in space of 8 eighths: each note = (1/2) * (8/11) = 4/11 beats
    const eleventhQ = frac(4, 11)
    let acc = frac(0, 1)
    for (let i = 0; i < 11; i++) acc = fracAdd(acc, eleventhQ)
    expect(acc).toEqual(frac(4, 1)) // 11 * 4/11 = 4 beats (8 eighths = 4 beats)
  })

  it('is commutative', () => {
    const a = frac(3, 7)
    const b = frac(2, 5)
    expect(fracAdd(a, b)).toEqual(fracAdd(b, a))
  })

  it('is associative', () => {
    const a = frac(1, 3)
    const b = frac(1, 5)
    const c = frac(1, 7)
    expect(fracAdd(fracAdd(a, b), c)).toEqual(fracAdd(a, fracAdd(b, c)))
  })

  it('handles negative operands', () => {
    expect(fracAdd(frac(1, 2), frac(-1, 2))).toEqual(frac(0, 1))
    expect(fracAdd(frac(3, 4), frac(-1, 4))).toEqual(frac(1, 2))
  })
})

describe('fracSub', () => {
  it('subtracts correctly', () => {
    expect(fracSub(frac(3, 4), frac(1, 4))).toEqual(frac(1, 2))
    expect(fracSub(frac(1, 1), frac(1, 3))).toEqual(frac(2, 3))
  })

  it('produces zero', () => {
    expect(fracSub(frac(5, 7), frac(5, 7))).toEqual(frac(0, 1))
  })

  it('produces negative', () => {
    expect(fracSub(frac(1, 4), frac(1, 2))).toEqual(frac(-1, 4))
  })
})

describe('fracMul', () => {
  it('multiplies correctly', () => {
    expect(fracMul(frac(1, 2), frac(1, 2))).toEqual(frac(1, 4))
    expect(fracMul(frac(3, 4), frac(2, 3))).toEqual(frac(1, 2))
  })

  it('tuplet ratio: quarter × 2/3 = 2/3 (triplet quarter duration)', () => {
    expect(fracMul(frac(1, 1), frac(2, 3))).toEqual(frac(2, 3))
  })

  it('quintuplet ratio: eighth × 4/5 = 4/10 = 2/5 (quintuplet eighth duration)', () => {
    expect(fracMul(frac(1, 2), frac(4, 5))).toEqual(frac(2, 5))
  })

  it('nested: sixteenth (1/4 beat) × 2/3 × 4/5 = 8/60 = 2/15', () => {
    const sixteenth = frac(1, 4) // 1/4 beat
    const outer = frac(2, 3)
    const inner = frac(4, 5)
    expect(fracMul(fracMul(sixteenth, outer), inner)).toEqual(frac(2, 15))
  })

  it('is commutative', () => {
    expect(fracMul(frac(3, 7), frac(2, 5))).toEqual(fracMul(frac(2, 5), frac(3, 7)))
  })

  it('identity element is 1/1', () => {
    const a = frac(3, 7)
    expect(fracMul(a, frac(1, 1))).toEqual(a)
  })

  it('multiplying by zero gives zero', () => {
    expect(fracMul(frac(5, 7), frac(0, 1))).toEqual(frac(0, 1))
  })
})

describe('fracDiv', () => {
  it('divides correctly', () => {
    expect(fracDiv(frac(1, 2), frac(1, 4))).toEqual(frac(2, 1))
    expect(fracDiv(frac(3, 4), frac(3, 8))).toEqual(frac(2, 1))
  })

  it('inverse of multiply', () => {
    const a = frac(3, 7)
    const b = frac(2, 5)
    expect(fracDiv(fracMul(a, b), b)).toEqual(a)
  })

  it('throws on zero divisor', () => {
    expect(() => fracDiv(frac(1, 2), frac(0, 1))).toThrow()
  })
})

describe('fracNeg', () => {
  it('negates', () => {
    expect(fracNeg(frac(3, 4))).toEqual(frac(-3, 4))
    expect(fracNeg(frac(-1, 2))).toEqual(frac(1, 2))
    expect(fracNeg(frac(0, 1))).toEqual(frac(0, 1))
  })
})

// ---------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------

describe('fracEq', () => {
  it('same fraction', () => {
    expect(fracEq(frac(1, 2), frac(1, 2))).toBe(true)
  })

  it('equivalent fractions', () => {
    expect(fracEq(frac(2, 4), frac(1, 2))).toBe(true)
    expect(fracEq(frac(3, 9), frac(1, 3))).toBe(true)
  })

  it('detects inequality float would miss', () => {
    // 1/3 + 1/3 + 1/3 === 1/1 exactly; float would be 0.9999...
    const third = frac(1, 3)
    const sum = fracAdd(fracAdd(third, third), third)
    expect(fracEq(sum, frac(1, 1))).toBe(true)
  })

  it('not equal', () => {
    expect(fracEq(frac(1, 3), frac(1, 4))).toBe(false)
  })
})

describe('fracLt / fracLte / fracGt / fracGte', () => {
  it('fracLt', () => {
    expect(fracLt(frac(1, 3), frac(1, 2))).toBe(true)
    expect(fracLt(frac(1, 2), frac(1, 3))).toBe(false)
    expect(fracLt(frac(1, 3), frac(1, 3))).toBe(false)
  })

  it('fracLte', () => {
    expect(fracLte(frac(1, 3), frac(1, 3))).toBe(true)
    expect(fracLte(frac(1, 3), frac(1, 2))).toBe(true)
    expect(fracLte(frac(1, 2), frac(1, 3))).toBe(false)
  })

  it('fracGt', () => {
    expect(fracGt(frac(2, 3), frac(1, 2))).toBe(true)
    expect(fracGt(frac(1, 4), frac(1, 2))).toBe(false)
  })

  it('fracGte', () => {
    expect(fracGte(frac(2, 3), frac(2, 3))).toBe(true)
    expect(fracGte(frac(3, 4), frac(1, 2))).toBe(true)
    expect(fracGte(frac(1, 4), frac(1, 2))).toBe(false)
  })
})

describe('fracCompare', () => {
  it('negative when a < b', () => {
    expect(fracCompare(frac(1, 3), frac(1, 2))).toBeLessThan(0)
  })

  it('zero when a === b', () => {
    expect(fracCompare(frac(2, 4), frac(1, 2))).toBe(0)
  })

  it('positive when a > b', () => {
    expect(fracCompare(frac(3, 4), frac(1, 2))).toBeGreaterThan(0)
  })

  it('can sort an array of fractions', () => {
    const fracs = [frac(3, 4), frac(1, 3), frac(1, 2), frac(0, 1), frac(1, 1)]
    const sorted = [...fracs].sort(fracCompare)
    expect(sorted).toEqual([frac(0, 1), frac(1, 3), frac(1, 2), frac(3, 4), frac(1, 1)])
  })
})

// ---------------------------------------------------------------------------
// Predicates
// ---------------------------------------------------------------------------

describe('fracIsZero / fracIsPositive / fracIsNegative', () => {
  it('zero', () => {
    expect(fracIsZero(frac(0, 1))).toBe(true)
    expect(fracIsZero(frac(1, 3))).toBe(false)
  })

  it('positive', () => {
    expect(fracIsPositive(frac(1, 2))).toBe(true)
    expect(fracIsPositive(frac(0, 1))).toBe(false)
    expect(fracIsPositive(frac(-1, 2))).toBe(false)
  })

  it('negative', () => {
    expect(fracIsNegative(frac(-1, 2))).toBe(true)
    expect(fracIsNegative(frac(0, 1))).toBe(false)
    expect(fracIsNegative(frac(1, 2))).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Conversion
// ---------------------------------------------------------------------------

describe('fracToNumber', () => {
  it('converts standard fractions exactly', () => {
    expect(fracToNumber(frac(1, 2))).toBe(0.5)
    expect(fracToNumber(frac(1, 4))).toBe(0.25)
    expect(fracToNumber(frac(3, 4))).toBe(0.75)
    expect(fracToNumber(frac(2, 1))).toBe(2)
  })

  it('converts irrational fractions (for display/scheduling only)', () => {
    // These are approximate — that is expected and the whole point
    expect(fracToNumber(frac(1, 3))).toBeCloseTo(0.3333, 4)
    expect(fracToNumber(frac(2, 3))).toBeCloseTo(0.6667, 4)
    expect(fracToNumber(frac(1, 11))).toBeCloseTo(0.0909, 4)
  })
})

describe('fracFromFloat', () => {
  it('recovers standard beat positions exactly', () => {
    expect(fracFromFloat(0)).toEqual(frac(0, 1))
    expect(fracFromFloat(1)).toEqual(frac(1, 1))
    expect(fracFromFloat(0.5)).toEqual(frac(1, 2))
    expect(fracFromFloat(0.25)).toEqual(frac(1, 4))
    expect(fracFromFloat(1.5)).toEqual(frac(3, 2))
  })

  it('recovers triplet positions', () => {
    expect(fracFromFloat(1 / 3)).toEqual(frac(1, 3))
    expect(fracFromFloat(2 / 3)).toEqual(frac(2, 3))
  })

  it('recovers quintuplet positions', () => {
    expect(fracFromFloat(1 / 5)).toEqual(frac(1, 5))
    expect(fracFromFloat(2 / 5)).toEqual(frac(2, 5))
  })
})

// ---------------------------------------------------------------------------
// Musical duration mapping
// ---------------------------------------------------------------------------

describe('durationToFraction', () => {
  it('whole note = 4 beats', () => {
    expect(durationToFraction('w')).toEqual(frac(4, 1))
  })

  it('half note = 2 beats', () => {
    expect(durationToFraction('h')).toEqual(frac(2, 1))
  })

  it('quarter note = 1 beat', () => {
    expect(durationToFraction('q')).toEqual(frac(1, 1))
  })

  it('eighth note = 1/2 beat', () => {
    expect(durationToFraction('8')).toEqual(frac(1, 2))
  })

  it('sixteenth note = 1/4 beat', () => {
    expect(durationToFraction('16')).toEqual(frac(1, 4))
  })

  it('thirty-second note = 1/8 beat', () => {
    expect(durationToFraction('32')).toEqual(frac(1, 8))
  })

  it('dotted quarter = 3/2 beats', () => {
    expect(durationToFraction('q', 1)).toEqual(frac(3, 2))
  })

  it('dotted half = 3 beats', () => {
    expect(durationToFraction('h', 1)).toEqual(frac(3, 1))
  })

  it('dotted eighth = 3/4 beats', () => {
    expect(durationToFraction('8', 1)).toEqual(frac(3, 4))
  })

  it('double-dotted quarter = 7/4 beats', () => {
    expect(durationToFraction('q', 2)).toEqual(frac(7, 4))
  })

  it('double-dotted half = 7/2 beats', () => {
    expect(durationToFraction('h', 2)).toEqual(frac(7, 2))
  })
})

// ---------------------------------------------------------------------------
// Tuplet note duration
// ---------------------------------------------------------------------------

describe('tupletNoteDurationFraction', () => {
  it('triplet quarter: 1 × 2/3 = 2/3', () => {
    expect(tupletNoteDurationFraction('q', 0, 3, 2)).toEqual(frac(2, 3))
  })

  it('triplet eighth: 1/2 × 2/3 = 1/3', () => {
    expect(tupletNoteDurationFraction('8', 0, 3, 2)).toEqual(frac(1, 3))
  })

  it('quintuplet eighth: 1/2 × 4/5 = 2/5', () => {
    expect(tupletNoteDurationFraction('8', 0, 5, 4)).toEqual(frac(2, 5))
  })

  it('septuplet eighth: 1/2 × 4/7 = 2/7', () => {
    expect(tupletNoteDurationFraction('8', 0, 7, 4)).toEqual(frac(2, 7))
  })

  it('11-tuplet eighth (11:8): 1/2 × 8/11 = 4/11', () => {
    expect(tupletNoteDurationFraction('8', 0, 11, 8)).toEqual(frac(4, 11))
  })

  it('13-tuplet eighth (13:8): 1/2 × 8/13 = 4/13', () => {
    expect(tupletNoteDurationFraction('8', 0, 13, 8)).toEqual(frac(4, 13))
  })

  it('three triplet quarters sum exactly to 2 beats', () => {
    const d = tupletNoteDurationFraction('q', 0, 3, 2)
    const sum = fracAdd(fracAdd(d, d), d)
    expect(sum).toEqual(frac(2, 1))
  })

  it('five quintuplet quarters sum exactly to 4 beats', () => {
    const d = tupletNoteDurationFraction('q', 0, 5, 4)
    let acc = frac(0, 1)
    for (let i = 0; i < 5; i++) acc = fracAdd(acc, d)
    expect(acc).toEqual(frac(4, 1))
  })

  it('eleven 11-tuplet eighths sum exactly to 4 beats', () => {
    const d = tupletNoteDurationFraction('8', 0, 11, 8)
    let acc = frac(0, 1)
    for (let i = 0; i < 11; i++) acc = fracAdd(acc, d)
    expect(acc).toEqual(frac(4, 1))
  })
})
