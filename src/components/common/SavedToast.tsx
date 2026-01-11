// SavedToast - Center screen notification for save actions
// Shows a brief "Saved" message in yellow when project is saved

import { useEffect, useRef } from 'react';

interface SavedToastProps {
  visible: boolean;
  onHide: () => void;
}

export function SavedToast({ visible, onHide }: SavedToastProps) {
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (visible) {
      // Clear any existing timer
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
      // Auto-hide after 600ms (animation handles the fade)
      timerRef.current = setTimeout(() => {
        onHide();
      }, 600);
    }

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, [visible, onHide]);

  if (!visible) return null;

  return (
    <div className="saved-toast">
      Saved
    </div>
  );
}
