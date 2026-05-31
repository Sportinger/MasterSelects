import { useState, useCallback, useRef, useEffect } from 'react';

export function useDraggableDialog(dialogRef: React.RefObject<HTMLDivElement | null>) {
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragOffset = useRef({ x: 0, y: 0 });

  // Center dialog on mount
  useEffect(() => {
    if (dialogRef.current) {
      const rect = dialogRef.current.getBoundingClientRect();
      setPosition({
        x: (window.innerWidth - rect.width) / 2,
        y: (window.innerHeight - rect.height) / 2,
      });
    }
  }, [dialogRef]);

  // Keep the dialog at the same on-screen position when the viewport (CSS) size
  // changes. Browser page zoom changes innerWidth/innerHeight, so scaling the
  // position by the ratio keeps the dialog visually anchored while zooming via
  // the Appearance zoom area (#209), rather than drifting across the screen.
  const viewportRef = useRef({ width: window.innerWidth, height: window.innerHeight });
  useEffect(() => {
    const handleResize = () => {
      const prev = viewportRef.current;
      const nextWidth = window.innerWidth;
      const nextHeight = window.innerHeight;
      if (prev.width > 0 && prev.height > 0 && (nextWidth !== prev.width || nextHeight !== prev.height)) {
        setPosition((current) => ({
          x: current.x * (nextWidth / prev.width),
          y: current.y * (nextHeight / prev.height),
        }));
      }
      viewportRef.current = { width: nextWidth, height: nextHeight };
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (dialogRef.current) {
      const rect = dialogRef.current.getBoundingClientRect();
      dragOffset.current = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      };
      setIsDragging(true);
    }
  }, [dialogRef]);

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const newX = e.clientX - dragOffset.current.x;
      const newY = e.clientY - dragOffset.current.y;

      const maxX = window.innerWidth - (dialogRef.current?.offsetWidth || 720);
      const maxY = window.innerHeight - (dialogRef.current?.offsetHeight || 560);

      setPosition({
        x: Math.max(0, Math.min(newX, maxX)),
        y: Math.max(0, Math.min(newY, maxY)),
      });
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, dialogRef]);

  return { position, isDragging, handleMouseDown };
}
