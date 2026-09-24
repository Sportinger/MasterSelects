import { useEffect } from 'react';
import { holdExportScreenAwake } from '../services/export/exportScreenWakeLock';

export function useExportScreenWakeLock(isExporting: boolean): void {
  useEffect(() => {
    if (isExporting) return holdExportScreenAwake();
  }, [isExporting]);
}
