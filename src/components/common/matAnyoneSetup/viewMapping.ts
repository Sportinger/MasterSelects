import type { MatAnyoneSetupStatus } from '../../../stores/matanyoneStore';

export type MatAnyoneSetupView =
  | 'welcome'
  | 'installing'
  | 'model-needed'
  | 'downloading-model'
  | 'complete'
  | 'error';

export function getMatAnyoneSetupView(status: MatAnyoneSetupStatus): MatAnyoneSetupView {
  switch (status) {
    case 'not-checked':
    case 'not-installed':
    case 'not-available':
    case 'gpu-required':
      return 'welcome';
    case 'installing':
      return 'installing';
    case 'model-needed':
      return 'model-needed';
    case 'downloading-model':
      return 'downloading-model';
    case 'installed':
    case 'ready':
    case 'starting':
      return 'complete';
    case 'error':
      return 'error';
    default:
      return 'welcome';
  }
}

export function isMatAnyoneSetupBusy(status: MatAnyoneSetupStatus): boolean {
  return status === 'installing' || status === 'downloading-model' || status === 'starting';
}

export function formatVramDetail(mb: number | null): string {
  if (mb === null) return '';
  if (mb >= 1024) return ` (${(mb / 1024).toFixed(1)} GB VRAM)`;
  return ` (${mb} MB VRAM)`;
}

export function formatGpuMemory(mb: number | null): string {
  if (mb === null) return '';
  if (mb >= 1024) return ` (${(mb / 1024).toFixed(1)} GB)`;
  return ` (${mb} MB)`;
}
