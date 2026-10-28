import { useCallback, useLayoutEffect, useRef } from 'react';

/**
 * A handler with a stable identity that always calls the newest `handler`.
 *
 * For event handlers passed to memoised inspector sections: the handler closes over values that
 * change on every edit (the clip, the interpolated transform), which would otherwise give every
 * section new props on every drag sample. Only call the result from events, never during render.
 */
export function useStableHandler<Args extends unknown[], Result>(
  handler: (...args: Args) => Result,
): (...args: Args) => Result {
  const handlerRef = useRef(handler);
  useLayoutEffect(() => {
    handlerRef.current = handler;
  }, [handler]);
  return useCallback((...args: Args) => handlerRef.current(...args), []);
}
