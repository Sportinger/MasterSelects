// Kept project load reports for the Diagnostics page, re-read once a second while it is open so a
// load that just finished shows up.
import { useEffect, useState } from 'react';
import { readPhoneProjectLoads, type PhoneLoadRow } from './phoneProjectLoads';

function sameRows(a: readonly PhoneLoadRow[], b: readonly PhoneLoadRow[]): boolean {
  return a.length === b.length && a.every((row, index) => row.key === b[index]?.key && row.firstFrame === b[index]?.firstFrame);
}

export function usePhoneProjectLoads(): PhoneLoadRow[] {
  const [rows, setRows] = useState<PhoneLoadRow[]>(readPhoneProjectLoads);
  useEffect(() => {
    const timer = window.setInterval(() => {
      const next = readPhoneProjectLoads();
      setRows((current) => (sameRows(current, next) ? current : next));
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);
  return rows;
}
