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
  const initialX = initialPosition?.x;
  const initialY = initialPosition?.y;

  useEffect(() => {
    // Wait for next frame so the menu is rendered and we can measure it
    const rafId = requestAnimationFrame(() => {
      if (initialX === undefined || initialY === undefined) {
        setAdjustedPosition(null);
        return;
      }

      // Start with initial position
      let x = initialX;
      let y = initialY;
      const menu = menuRef.current;
      if (!menu) {
        setAdjustedPosition({ x, y });
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
  }, [initialX, initialY]);

  return { menuRef, adjustedPosition };
}
