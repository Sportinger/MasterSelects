import { useEffect } from 'react';

/**
 * Global mouse-wheel support for native <select> dropdowns (#174).
 *
 * Scrolling the wheel while hovering any closed native <select> cycles through
 * its options and applies the change instantly (fires a real `change` event so
 * React `onChange` handlers run). This works for every dropdown in the app
 * because they are all native <select> elements.
 *
 * Behaviour:
 * - Wheel up  -> previous selectable option
 * - Wheel down -> next selectable option
 * - Disabled options are skipped, the value is clamped at both ends.
 * - Multi-selects and disabled selects are ignored (native scroll preserved).
 */
export function useGlobalSelectWheel(): void {
  useEffect(() => {
    const handleWheel = (event: WheelEvent) => {
      const target = event.target as HTMLElement | null;
      const select = target?.closest?.('select') as HTMLSelectElement | null;
      if (!select || select.disabled || select.multiple) return;

      const options = select.options;
      if (!options || options.length === 0) return;

      // Dominant axis: vertical wheel preferred, fall back to horizontal.
      const delta = event.deltaY !== 0 ? event.deltaY : event.deltaX;
      if (delta === 0) return;
      const step = delta > 0 ? 1 : -1;

      // Find the next selectable (non-disabled) option in the scroll direction.
      let nextIndex = select.selectedIndex;
      for (let i = select.selectedIndex + step; i >= 0 && i < options.length; i += step) {
        if (!options[i].disabled) {
          nextIndex = i;
          break;
        }
      }

      if (nextIndex === select.selectedIndex) return;

      // Prevent the page/panel from scrolling while we adjust the value.
      event.preventDefault();
      select.selectedIndex = nextIndex;
      // Dispatch real events so controlled React <select> onChange handlers fire.
      select.dispatchEvent(new Event('input', { bubbles: true }));
      select.dispatchEvent(new Event('change', { bubbles: true }));
    };

    // Non-passive so preventDefault() can stop the surrounding scroll container.
    document.addEventListener('wheel', handleWheel, { passive: false });
    return () => document.removeEventListener('wheel', handleWheel);
  }, []);
}
