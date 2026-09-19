export function registerGeneratedMedia(outputRoot: string, owner: string, exactFile: string): Promise<{
  owner: string; outputRoot: string; identity: { path: string; realPath: string; dev: number; ino: number; size: number; mtimeMs: number }
}>
export function cleanupGeneratedMedia(record: Awaited<ReturnType<typeof registerGeneratedMedia>>, requestedOwner: string): Promise<unknown>
export function finishExistingCase(options: {
  cleanup: () => Promise<{ errors?: string[]; remainingOwners?: string[]; [key: string]: unknown }>;
  persist: (report: any) => Promise<void>; original?: unknown; failed?: boolean
}): Promise<{ report: any; original?: unknown }>
