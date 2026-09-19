import { afterEach, expect, it } from 'vitest';
import { installArrayCopySorting } from '../../src/runtime/arrayCopySorting';

const original = Object.getOwnPropertyDescriptor(Array.prototype, 'toSorted')!;
afterEach(() => Object.defineProperty(Array.prototype, 'toSorted', original));

function installFallback() {
  Reflect.deleteProperty(Array.prototype, 'toSorted');
  installArrayCopySorting();
}

it('sorts frozen state without mutation and preserves equal-key order', () => {
  installFallback();
  const source = Object.freeze([{ id: 'a', rank: 2 }, { id: 'b', rank: 1 }, { id: 'c', rank: 2 }]);
  expect(source.toSorted((a, b) => a.rank - b.rank).map(value => value.id)).toEqual(['b', 'a', 'c']);
  expect(source.map(value => value.id)).toEqual(['a', 'b', 'c']);
  expect([10, 2, 1].toSorted()).toEqual([1, 10, 2]);
});

it('materializes holes and ignores custom iterators and species', () => {
  installFallback();
  const sparse = [3, , 1];
  const sorted = sparse.toSorted();
  expect(sorted).toEqual([1, 3, undefined]);
  expect(Object.hasOwn(sorted, 2)).toBe(true);
  expect(Object.hasOwn(sparse, 1)).toBe(false);
  class CustomArray extends Array<number> {
    *[Symbol.iterator]() { yield 99; }
  }
  const result = new CustomArray(3, 1, 2).toSorted();
  expect(result).toEqual([1, 2, 3]);
  expect(result.constructor).toBe(Array);
});

it('supports array-like receivers and rejects invalid inputs without writing', () => {
  installFallback();
  const sort = Array.prototype.toSorted;
  expect(sort.call({ 0: 'b', 1: 'a', length: 2.9 })).toEqual(['a', 'b']);
  expect(sort.call({ length: -1 })).toEqual([]);
  expect(() => sort.call(null)).toThrow(TypeError);
  expect(() => sort.call({ length: 1n })).toThrow(TypeError);
  expect(() => sort.call([], null)).toThrow(TypeError);
  const input = Object.freeze([2, 1]);
  expect(() => input.toSorted(() => { throw new Error('comparison failed'); })).toThrow('comparison failed');
  expect(input).toEqual([2, 1]);
});

it('leaves native implementations intact and installs a non-enumerable method', () => {
  installArrayCopySorting();
  expect(Array.prototype.toSorted).toBe(original.value);
  installFallback();
  expect(Object.getOwnPropertyDescriptor(Array.prototype, 'toSorted')).toMatchObject({
    enumerable: false, configurable: true, writable: true,
  });
  const installed = Array.prototype.toSorted;
  installArrayCopySorting();
  expect(Array.prototype.toSorted).toBe(installed);
});
