export const origin: string
export const endpoint: string
export const modulePath: string
export const moduleSha256: string
export function sha(bytes: Uint8Array): string
export function assertTarget(targets: Array<{ targetId: string; url: string }>, id: string | undefined): void
export function assertTool(name: string): void
export function assertOwner(actual: string, expected: string): void
export function safePackagePath(root: string, relative: string): string
export function verifyPackage(manifestPath: string, manifestSha256: string): Promise<{
  manifestSha256: string; modulePath: string; moduleSha256: string; files: number
}>
