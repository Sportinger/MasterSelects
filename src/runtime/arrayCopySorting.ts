/** Install before the UI module graph: older browsers lack copying sort. */
export function installArrayCopySorting(): void {
  if (typeof Array.prototype.toSorted === 'function') return;

  Object.defineProperty(Array.prototype, 'toSorted', {
    configurable: true,
    writable: true,
    value: function toSorted<T>(this: ArrayLike<T>, compareFn?: (a: T, b: T) => number): T[] {
      if (compareFn !== undefined && typeof compareFn !== 'function') {
        throw new TypeError('The comparison function must be a function or undefined');
      }
      if (this == null) throw new TypeError('Cannot sort null or undefined');
      const source = Object(this) as ArrayLike<T>;
      // Unary plus intentionally rejects BigInt lengths, matching ToNumber.
      const numericLength = +source.length;
      const length = Math.min(Math.max(Math.trunc(numericLength) || 0, 0), Number.MAX_SAFE_INTEGER);
      const copy = new Array<T>(length);
      // Read holes as undefined; do not consult iterators or Array species.
      for (let index = 0; index < length; index += 1) copy[index] = source[index];
      // Sorting this fresh copy cannot mutate the source or a Zustand array.
      return copy.sort(compareFn);
    },
  });
}

installArrayCopySorting();
