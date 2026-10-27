import { useLayoutEffect, useRef, useState } from 'react';

/**
 * True when the element sits inside the phone skin (/m, `.mobile-skin` ancestor). The colour panels
 * are the desktop components on the phone too; this lets them drop desktop-only chrome there (dock
 * panel switching, placeholder tools) without touching the desktop layout or mouse behaviour.
 */
export function useInsidePhoneSkin<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [inside, setInside] = useState(false);
  useLayoutEffect(() => {
    setInside(Boolean(ref.current?.closest('.mobile-skin')));
  }, []);
  return [ref, inside] as const;
}
