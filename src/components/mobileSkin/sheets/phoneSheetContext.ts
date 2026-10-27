// The id of the sheet the host is rendering, so the shared PhoneSheet frame can look up its size in
// PHONE_SHEET_SIZES and remember its detent without every sheet owner passing it down.
import { createContext, useContext } from 'react';

export const PhoneSheetIdContext = createContext<string | null>(null);

export function usePhoneSheetId(): string | null {
  return useContext(PhoneSheetIdContext);
}
