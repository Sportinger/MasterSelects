import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { access, stat } from 'node:fs/promises'
import path from 'node:path'
import { constants } from 'node:fs'
import { DEFAULT_REPO_ROOT } from './bridgeClient'

export type TrackedMediaRole = 'primary-motion' | 'blend-mask' | 'detail-nested'

export type ReferenceMediaRole =
  | 'dynamic-landscape'
  | 'high-frequency-60fps'
  | 'portrait-vp9'
  | 'longform-landscape'
  | 'music-audio'

export interface TrackedMediaFile {
  role: TrackedMediaRole
  fileName: string
  relativePath: string
  absolutePath: string
}

export interface TrackedMediaFixture {
  repoRoot: string
  primaryMotion: TrackedMediaFile
  blendMask: TrackedMediaFile
  detailNested: TrackedMediaFile
  files: readonly [TrackedMediaFile, TrackedMediaFile, TrackedMediaFile]
  paths: readonly [string, string, string]
}

export interface ReferenceMediaFile {
  role: ReferenceMediaRole
  kind: 'video' | 'audio'
  fileName: string
  mimeType: string
  relativePath: string
  absolutePath: string
  sizeBytes: number
  sha256: string
}

export interface ReferenceMediaFixture {
  repoRoot: string
  dynamicLandscape: ReferenceMediaFile
  highFrequency60Fps: ReferenceMediaFile
  portraitVp9: ReferenceMediaFile
  longformLandscape: ReferenceMediaFile
  musicAudio: ReferenceMediaFile
  videoFiles: readonly ReferenceMediaFile[]
  files: readonly ReferenceMediaFile[]
  paths: readonly string[]
}

const MEDIA_DEFINITIONS = [
  { role: 'primary-motion', fileName: 'masterselects_github.mp4' },
  { role: 'blend-mask', fileName: 'clippy.webm' },
  { role: 'detail-nested', fileName: 'clippy-intro.webm' },
] as const

const REFERENCE_MEDIA_DEFINITIONS = [
  {
    role: 'dynamic-landscape',
    kind: 'video',
    fileName: 'fpv-freestyle.mp4',
    mimeType: 'video/mp4',
    sizeBytes: 76_780_458,
    sha256: '96ffd7900e32efcc0d1470aff8af7a00d30e595a2a34657bc811187db7db863e',
  },
  {
    role: 'high-frequency-60fps',
    kind: 'video',
    fileName: 'striped-motion.mp4',
    mimeType: 'video/mp4',
    sizeBytes: 60_027_247,
    sha256: 'fd40ab6c208de9a39820df5e2f239a81991dcd8998fad4111a07bf976b1d56e5',
  },
  {
    role: 'portrait-vp9',
    kind: 'video',
    fileName: 'tueftenbacchus.mp4',
    mimeType: 'video/mp4',
    sizeBytes: 17_581_055,
    sha256: '10dd7326d45249da86eca75a88760d793ce9864b78e21442bd690059ba365d37',
  },
  {
    role: 'longform-landscape',
    kind: 'video',
    fileName: 'x-rays-safe.mp4',
    mimeType: 'video/mp4',
    sizeBytes: 32_109_450,
    sha256: '0eebf268d7abfed511cdcbf04bb588b0d192bbe27751d8cf0c34d3734ec52be6',
  },
  {
    role: 'music-audio',
    kind: 'audio',
    fileName: 'time-traveler-cover.mp3',
    mimeType: 'audio/mpeg',
    sizeBytes: 6_382_822,
    sha256: '7b7da54579c309d5829edc93607ca0913dc914e19170758ce2c75f6029e4c9f1',
  },
] as const

/** Resolve and verify the three tracked, redistribution-safe release fixtures. */
export async function createTrackedMediaFixture(
  repoRoot = DEFAULT_REPO_ROOT,
): Promise<TrackedMediaFixture> {
  const resolvedRepoRoot = path.resolve(repoRoot)
  const files = MEDIA_DEFINITIONS.map(({ role, fileName }) => {
    const relativePath = path.join('public', fileName)
    return {
      role,
      fileName,
      relativePath,
      absolutePath: path.join(resolvedRepoRoot, relativePath),
    }
  }) as [TrackedMediaFile, TrackedMediaFile, TrackedMediaFile]

  await Promise.all(files.map(async (file) => {
    try {
      await access(file.absolutePath, constants.R_OK)
    } catch {
      throw new Error(`Tracked Playwright media fixture is missing or unreadable: ${file.relativePath}`)
    }
  }))

  const [primaryMotion, blendMask, detailNested] = files
  return {
    repoRoot: resolvedRepoRoot,
    primaryMotion,
    blendMask,
    detailNested,
    files,
    paths: files.map((file) => file.absolutePath) as [string, string, string],
  }
}

/** Resolve and integrity-check the Git-LFS-backed reference-project media pack. */
export async function createReferenceMediaFixture(
  repoRoot = DEFAULT_REPO_ROOT,
): Promise<ReferenceMediaFixture> {
  const resolvedRepoRoot = path.resolve(repoRoot)
  const files = await Promise.all(REFERENCE_MEDIA_DEFINITIONS.map(async (definition) => {
    const relativePath = path.join(
      'fixtures',
      'playwright-reference-project',
      'media',
      definition.fileName,
    )
    const absolutePath = path.join(resolvedRepoRoot, relativePath)
    try {
      await access(absolutePath, constants.R_OK)
    } catch {
      throw new Error(
        `Playwright reference media is missing or unreadable: ${relativePath}. Run git lfs pull.`,
      )
    }

    const fileStat = await stat(absolutePath)
    if (!fileStat.isFile() || fileStat.size !== definition.sizeBytes) {
      throw new Error(
        `Playwright reference media size mismatch: ${relativePath} `
        + `(expected ${definition.sizeBytes}, received ${fileStat.size}). Run git lfs pull.`,
      )
    }
    const actualSha256 = await sha256File(absolutePath)
    if (actualSha256 !== definition.sha256) {
      throw new Error(
        `Playwright reference media checksum mismatch: ${relativePath} `
        + `(expected ${definition.sha256}, received ${actualSha256}).`,
      )
    }

    return {
      ...definition,
      relativePath,
      absolutePath,
    } satisfies ReferenceMediaFile
  }))

  const [dynamicLandscape, highFrequency60Fps, portraitVp9, longformLandscape, musicAudio] = files
  return {
    repoRoot: resolvedRepoRoot,
    dynamicLandscape,
    highFrequency60Fps,
    portraitVp9,
    longformLandscape,
    musicAudio,
    videoFiles: files.filter((file) => file.kind === 'video'),
    files,
    paths: files.map((file) => file.absolutePath),
  }
}

async function sha256File(filePath: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(filePath)) hash.update(chunk)
  return hash.digest('hex')
}
