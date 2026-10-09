import { createContext } from 'react';

/** Only the timeline Text inspector opts into editing the current selection. */
export const TextSelectionContext = createContext(false);
