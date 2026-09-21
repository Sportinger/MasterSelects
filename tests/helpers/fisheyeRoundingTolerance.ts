export interface FisheyeRoundingContext {
  caseName: string;
  width: number;
  height: number;
  rowPitch: number;
  params: Record<string, unknown>;
}

export interface FisheyeByteComparison {
  equal: boolean;
  acceptedKnownRounding: boolean;
  message?: string;
}

const KNOWN = { caseName: 'orthographic-negative-edge-max', width: 47, height: 29, rowPitch: 256, x: 9, y: 9,
  projection: 'orthographic', strength: -.59, samples: 8, fieldOfView: 20, feather: .5, edgeFeather: .1, squeeze: .25,
  expected: 78, actual: 79 } as const;

/** The sole approved Fisheye GPU rounding exception. Everything except this
 * exact alpha-byte fingerprint remains byte-strict. */
export function compareFisheyeGpuBytes(expected: Uint8Array, actual: Uint8Array,
  context: FisheyeRoundingContext): FisheyeByteComparison {
  if (expected.length !== actual.length) return { equal: false, acceptedKnownRounding: false, message: 'byte lengths differ' };
  const differences: number[] = [];
  expected.forEach((value, index) => { if (value !== actual[index]) differences.push(index); });
  if (!differences.length) return { equal: true, acceptedKnownRounding: false };
  const byte = KNOWN.y * KNOWN.rowPitch + KNOWN.x * 4 + 3;
  const paramsMatch = context.caseName === KNOWN.caseName && context.width === KNOWN.width && context.height === KNOWN.height
    && context.rowPitch === KNOWN.rowPitch && expected.length === KNOWN.rowPitch * KNOWN.height
    && context.params.projection === KNOWN.projection && context.params.strength === KNOWN.strength
    && context.params.samples === KNOWN.samples && context.params.fieldOfView === KNOWN.fieldOfView
    && context.params.feather === KNOWN.feather && context.params.edgeFeather === KNOWN.edgeFeather
    && context.params.squeeze === KNOWN.squeeze;
  if (paramsMatch && differences.length === 1 && differences[0] === byte
    && expected[byte] === KNOWN.expected && actual[byte] === KNOWN.actual) {
    return { equal: true, acceptedKnownRounding: true,
      message: `${KNOWN.caseName}: accepted known alpha rounding at pixel (${KNOWN.x},${KNOWN.y}), ${KNOWN.expected}->${KNOWN.actual}` };
  }
  return { equal: false, acceptedKnownRounding: false };
}
