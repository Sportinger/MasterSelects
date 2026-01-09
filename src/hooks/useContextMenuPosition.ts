import { useEffect, useRef, useState } from 'react';

interface Position {
  x: number;
  y: number;
}

/**
 * Hook to automatically adjust context menu position to stay within viewport.
 * Returns a ref to attach to the menu element and adjusted coordinates.
 */
export function useContextMenuPosition(
  initialPosition: Position | null
): {
  menuRef: React.RefObject<HTMLDivElement | null>;
  adjustedPosition: Position | null;
} {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [adjustedPosition, setAdjustedPosition] = useState<Position | null>(initialPosition);

  useEffect(() => {
    if (!initialPosition) {
      setAdjustedPosition(null);
      return;
    }

    // Start with initial position
    let { x, y } = initialPosition;

    // Wait for next frame so the menu is rendered and we can measure it
    const rafId = requestAnimationFrame(() => {
      const menu = menuRef.current;
      if (!menu) {
        setAdjustedPosition(initialPosition);
        return;
      }

      const rect = menu.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const padding = 8; // Minimum distance from edge

      // Adjust horizontal position if menu goes off right edge
      if (x + rect.width > viewportWidth - padding) {
        x = Math.max(padding, viewportWidth - rect.width - padding);
      }

      // Adjust vertical position if menu goes off bottom edge
      if (y + rect.height > viewportHeight - padding) {
        y = Math.max(padding, viewportHeight - rect.height - padding);
      }

      setAdjustedPosition({ x, y });
    });

    return () => cancelAnimationFrame(rafId);
  }, [initialPosition?.x, initialPosition?.y]);

  return { menuRef, adjustedPosition };
}
