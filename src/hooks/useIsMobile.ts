// Hook to detect mobile devices

import { useState, useEffect } from 'react';

export function useIsMobile(breakpoint: number = 768): boolean {
  const [isMobile, setIsMobile] = useState(() => {
    // Check on initial render
    if (typeof window === 'undefined') return false;

    // Check for touch capability and screen size
    const hasTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    const isSmallScreen = window.innerWidth <= breakpoint;

    // Consider mobile if: small screen OR (has touch AND portrait orientation)
    return isSmallScreen || (hasTouch && window.innerHeight > window.innerWidth);
  });

  useEffect(() => {
    const checkMobile = () => {
      const hasTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
      const isSmallScreen = window.innerWidth <= breakpoint;
      setIsMobile(isSmallScreen || (hasTouch && window.innerHeight > window.innerWidth));
    };

    // Listen for resize and orientation change
    window.addEventListener('resize', checkMobile);
    window.addEventListener('orientationchange', checkMobile);

    return () => {
      window.removeEventListener('resize', checkMobile);
      window.removeEventListener('orientationchange', checkMobile);
    };
  }, [breakpoint]);

  return isMobile;
}

// Force mobile mode via URL param for testing: ?mobile=true
export function useForceMobile(): boolean {
  const [forceMobile, setForceMobile] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setForceMobile(params.get('mobile') === 'true');
  }, []);

  return forceMobile;
}
