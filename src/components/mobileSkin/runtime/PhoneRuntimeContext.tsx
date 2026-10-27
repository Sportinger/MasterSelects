// Runtime context of the phone skin: boot/engine status and the single history owner's controls.

import { createContext, useContext, type ReactNode } from 'react';
import type { PhoneRuntimeValue } from '../contracts';

const PhoneRuntimeContext = createContext<PhoneRuntimeValue | null>(null);

interface PhoneProjectSelectionValue {
  /** The project chooser reports an opened/created project so the shell appears at once. */
  markProjectSelected: () => void;
}

const PhoneProjectSelectionContext = createContext<PhoneProjectSelectionValue | null>(null);

interface PhoneRuntimeProviderProps {
  value: PhoneRuntimeValue;
  projectSelection: PhoneProjectSelectionValue;
  children: ReactNode;
}

export function PhoneRuntimeProvider({ value, projectSelection, children }: PhoneRuntimeProviderProps) {
  return (
    <PhoneRuntimeContext.Provider value={value}>
      <PhoneProjectSelectionContext.Provider value={projectSelection}>
        {children}
      </PhoneProjectSelectionContext.Provider>
    </PhoneRuntimeContext.Provider>
  );
}

export function usePhoneRuntime(): PhoneRuntimeValue {
  const value = useContext(PhoneRuntimeContext);
  if (!value) throw new Error('usePhoneRuntime must be used inside PhoneRuntimeHost');
  return value;
}

export function usePhoneProjectSelection(): PhoneProjectSelectionValue {
  const value = useContext(PhoneProjectSelectionContext);
  if (!value) throw new Error('usePhoneProjectSelection must be used inside PhoneRuntimeHost');
  return value;
}
