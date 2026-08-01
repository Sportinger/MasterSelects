import { randomUUID } from 'node:crypto'
import { copyFile, link, mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import type { TestInfo } from '@playwright/test'
import type { BridgeClient } from './bridgeClient'
import type {
  ReferenceMediaFixture,
  ReferenceMediaFile,
  ReferenceMediaRole,
} from './mediaFixture'

interface StressImportResult {
  imported: Array<{
    id: string
    name: string
    path: string
  }>
  mediaRoles: {
    primaryMotion: string
    blendMask: string
    detailNested: string
  }
  compositionSummaries: Array<{
    id: string
    name: string
  }>
}

interface CompositionResult {
  compositionId: string
  name: string
  width: number
  height: number
  frameRate: number
  duration: number
}

interface TrackResult {
  trackId: string
  trackName?: string
  trackType: string
}

interface TimelineTrackSummary {
  id: string
  name: string
  type: string
}

interface TimelineStateResult {
  videoTracks: TimelineTrackSummary[]
}

interface SegmentClipResult {
  id: string
  trackId: string
  startTime: number
  duration: number
  inPoint: number
  outPoint: number
  linkedClipId?: string
}

interface SegmentResult {
  clips: SegmentClipResult[]
}

interface AddMaskResult {
  maskId: string
}

interface MaskTemplateVertex {
  x: number
  y: number
}

interface MaskReferenceProjectTemplate {
  schemaVersion: 1
  templateId: string
  name: string
  description: string
  composition: {
    name: string
    width: number
    height: number
    frameRate: number
    duration: number
  }
  layers: {
    base: {
      mediaRole: ReferenceMediaRole
      sourceIn: number
      sourceOut: number
    }
    foreground: {
      mediaRole: ReferenceMediaRole
      sourceIn: number
      sourceOut: number
    }
  }
  mask: {
    name: string
    closed: boolean
    opacity: number
    feather: number
    inverted: boolean
    enabled: boolean
    visible: boolean
    mode: 'add' | 'subtract' | 'intersect'
    vertices: MaskTemplateVertex[]
  }
  review: {
    sampleTime: number
    expectedInside: string
    expectedOutside: string
  }
}

interface NestedSuperProjectCompositionTemplate {
  id: string
  name: string
  width: number
  height: number
  frameRate: number
  duration: number
  splitTime?: number
  nestedVideoClipIds?: string[]
  animatedNestedClipId?: string
  expectedMaskCount?: number
  expectedKeyframeCount?: number
  solidClipId?: string
  stripedClipId?: string
  expectedSolidKeyframeCount?: number
  expectedStripedMaskCount?: number
  expectedStripedKeyframeCount?: number
}

interface NestedSuperProjectTemplate {
  schemaVersion: 1
  templateId: 'nested-super-project-v1'
  name: string
  description: string
  projectFile: string
  mediaLinks: Array<{
    role: ReferenceMediaRole
    projectMediaId: string
    target: string
  }>
  compositions: {
    main: NestedSuperProjectCompositionTemplate
    level2: NestedSuperProjectCompositionTemplate
    level1: NestedSuperProjectCompositionTemplate
  }
  review: {
    initialComposition: 'main'
    initialTime: number
    sampleTimes: number[]
  }
}

export interface MaskReferenceProjectData {
  projectName: string
  template: {
    id: string
    schemaVersion: number
    relativePath: string
    description: string
  }
  composition: CompositionResult
  media: {
    baseMediaId: string
    foregroundMediaId: string
  }
  tracks: {
    foregroundTrackId: string
    baseTrackId: string
  }
  clips: {
    foregroundClipId: string
    baseClipId: string
  }
  mask: {
    id: string
    name: string
    vertices: MaskTemplateVertex[]
  }
  sourceTimes: {
    baseInPoint: number
    foregroundInPoint: number
  }
  sampleTime: number
  review: {
    expectedInside: string
    expectedOutside: string
  }
}

export interface NestedSuperProjectData {
  projectName: string
  workingDirectory: string
  projectFile: string
  template: {
    id: string
    schemaVersion: number
    relativePath: string
    description: string
  }
  compositions: NestedSuperProjectTemplate['compositions']
  review: NestedSuperProjectTemplate['review']
}

const MASK_TEMPLATE_RELATIVE_PATH = path.join(
  'fixtures',
  'playwright-reference-project',
  'projects',
  'masks-rectangle-v1.json',
)

const NESTED_SUPER_TEMPLATE_RELATIVE_PATH = path.join(
  'fixtures',
  'playwright-reference-project',
  'projects',
  'nested-super-project-v1',
  'fixture.json',
)

/** Builds categorized, isolated reference compositions from the fixed media pack. */
export class ReferenceProjectFixture {
  private readonly bridge: BridgeClient
  private readonly media: ReferenceMediaFixture
  private readonly testInfo: TestInfo

  constructor(
    bridge: BridgeClient,
    media: ReferenceMediaFixture,
    testInfo: TestInfo,
  ) {
    this.bridge = bridge
    this.media = media
    this.testInfo = testInfo
  }

  /** Opens a disposable copy of the user-authored two-level nested project. */
  async createNestedSuperProject(): Promise<NestedSuperProjectData> {
    const template = await this.loadNestedSuperTemplate()
    const templateDirectory = path.dirname(path.join(
      this.media.repoRoot,
      NESTED_SUPER_TEMPLATE_RELATIVE_PATH,
    ))
    const sourceProjectFile = path.join(templateDirectory, template.projectFile)
    const projectSnapshot = JSON.parse(await readFile(sourceProjectFile, 'utf8')) as unknown
    assertNestedSuperProjectSnapshot(projectSnapshot, template, sourceProjectFile)

    const workingDirectory = this.testInfo.outputPath(
      'reference-projects',
      `${template.templateId}-${randomUUID().slice(0, 8)}`,
    )
    const rawDirectory = path.join(workingDirectory, 'Raw')
    const projectFile = path.join(workingDirectory, 'project.json')
    await mkdir(rawDirectory, { recursive: true })
    await copyFile(sourceProjectFile, projectFile)

    for (const mediaLink of template.mediaLinks) {
      const source = this.mediaForRole(mediaLink.role).absolutePath
      const target = path.resolve(workingDirectory, mediaLink.target)
      assertPathWithinProject(target, workingDirectory, mediaLink.target)
      await mkdir(path.dirname(target), { recursive: true })
      await linkOrCopy(source, target)
    }

    const loaded = await this.bridge.debugActionData<{
      projectName: string | null
    }>('load-project-snapshot', {
      project: projectSnapshot,
      mediaSources: template.mediaLinks.map((mediaLink) => ({
        projectMediaId: mediaLink.projectMediaId,
        path: this.mediaForRole(mediaLink.role).absolutePath,
      })),
    }, { timeoutMs: 120_000, fetchTimeoutMs: 130_000 })

    if (loaded.projectName !== template.name) {
      throw new Error(
        `Loaded nested reference project name mismatch: expected ${template.name}, received ${loaded.projectName}`,
      )
    }
    await this.bridge.toolData('setPlayhead', { time: template.review.initialTime })

    return {
      projectName: template.name,
      workingDirectory,
      projectFile,
      template: {
        id: template.templateId,
        schemaVersion: template.schemaVersion,
        relativePath: NESTED_SUPER_TEMPLATE_RELATIVE_PATH,
        description: template.description,
      },
      compositions: template.compositions,
      review: template.review,
    }
  }

  async createMaskReferenceProject(): Promise<MaskReferenceProjectData> {
    const template = await this.loadMaskTemplate()
    const baseMedia = this.mediaForRole(template.layers.base.mediaRole)
    const foregroundMedia = this.mediaForRole(template.layers.foreground.mediaRole)
    const fallbackMedia = this.media.videoFiles.find(
      (file) => file.role !== baseMedia.role && file.role !== foregroundMedia.role,
    ) ?? foregroundMedia

    // The existing stress fixture is the only bridge operation with a complete,
    // safe new-project reset. Use it to reset and import the fixed sources, then
    // materialize a fresh working copy of the versioned project template.
    const imported = await this.bridge.toolData<StressImportResult>(
      'createStressTestProjectFixture',
      {
        paths: [
          baseMedia.absolutePath,
          foregroundMedia.absolutePath,
          fallbackMedia.absolutePath,
        ],
        resetProject: true,
        projectName: template.name,
        durationSeconds: template.composition.duration,
        width: template.composition.width,
        height: template.composition.height,
        frameRate: template.composition.frameRate,
      },
      { timeoutMs: 120_000, fetchTimeoutMs: 130_000 },
    )

    const composition = await this.bridge.toolData<CompositionResult>('createComposition', {
      ...template.composition,
      openAfterCreate: true,
    }, { timeoutMs: 20_000, fetchTimeoutMs: 25_000 })

    const initialTimeline = await this.bridge.toolData<TimelineStateResult>('getTimelineState')
    const baseTrack = initialTimeline.videoTracks.at(-1)
    if (!baseTrack) throw new Error('Mask reference composition has no default base video track.')

    const foregroundTrack = await this.bridge.toolData<TrackResult>('createTrack', {
      type: 'video',
    })

    const baseInPoint = template.layers.base.sourceIn
    const foregroundInPoint = template.layers.foreground.sourceIn
    const baseSegment = await this.bridge.toolData<SegmentResult>('addClipSegment', {
      mediaFileId: imported.mediaRoles.primaryMotion,
      trackId: baseTrack.id,
      startTime: 0,
      inPoint: baseInPoint,
      outPoint: template.layers.base.sourceOut,
    }, { timeoutMs: 30_000, fetchTimeoutMs: 35_000 })
    const foregroundSegment = await this.bridge.toolData<SegmentResult>('addClipSegment', {
      mediaFileId: imported.mediaRoles.blendMask,
      trackId: foregroundTrack.trackId,
      startTime: 0,
      inPoint: foregroundInPoint,
      outPoint: template.layers.foreground.sourceOut,
    }, { timeoutMs: 30_000, fetchTimeoutMs: 35_000 })

    const baseClip = baseSegment.clips.find((clip) => clip.trackId === baseTrack.id)
    const foregroundClip = foregroundSegment.clips.find(
      (clip) => clip.trackId === foregroundTrack.trackId,
    )
    if (!baseClip || !foregroundClip) {
      throw new Error('Mask reference composition did not create both expected video clips.')
    }

    const storedMask = await this.bridge.toolData<AddMaskResult>('addMask', {
      clipId: foregroundClip.id,
      ...template.mask,
    })

    // The reset/import bridge currently builds its own stress compositions as
    // an implementation detail. They are not part of this reference project.
    // Remove them, together with the third import required only by that bridge,
    // before exposing the clean template working copy to the test or reviewer.
    for (const stressComposition of imported.compositionSummaries) {
      await this.bridge.toolData('deleteMediaItem', { itemId: stressComposition.id })
    }
    const fallbackImport = imported.imported[2]
    if (
      fallbackImport
      && fallbackImport.id !== imported.mediaRoles.primaryMotion
      && fallbackImport.id !== imported.mediaRoles.blendMask
    ) {
      await this.bridge.toolData('deleteMediaItem', { itemId: fallbackImport.id })
    }

    await this.bridge.toolData('selectClips', { clipIds: [foregroundClip.id] })
    const sampleTime = template.review.sampleTime
    await this.bridge.toolData('setPlayhead', { time: sampleTime })

    return {
      projectName: template.name,
      template: {
        id: template.templateId,
        schemaVersion: template.schemaVersion,
        relativePath: MASK_TEMPLATE_RELATIVE_PATH,
        description: template.description,
      },
      composition,
      media: {
        baseMediaId: imported.mediaRoles.primaryMotion,
        foregroundMediaId: imported.mediaRoles.blendMask,
      },
      tracks: {
        foregroundTrackId: foregroundTrack.trackId,
        baseTrackId: baseTrack.id,
      },
      clips: {
        foregroundClipId: foregroundClip.id,
        baseClipId: baseClip.id,
      },
      mask: {
        id: storedMask.maskId,
        name: template.mask.name,
        vertices: template.mask.vertices,
      },
      sourceTimes: { baseInPoint, foregroundInPoint },
      sampleTime,
      review: template.review,
    }
  }

  private async loadMaskTemplate(): Promise<MaskReferenceProjectTemplate> {
    const templatePath = path.join(this.media.repoRoot, MASK_TEMPLATE_RELATIVE_PATH)
    const parsed = JSON.parse(await readFile(templatePath, 'utf8')) as unknown
    assertMaskTemplate(parsed, templatePath)
    return parsed
  }

  private async loadNestedSuperTemplate(): Promise<NestedSuperProjectTemplate> {
    const templatePath = path.join(this.media.repoRoot, NESTED_SUPER_TEMPLATE_RELATIVE_PATH)
    const parsed = JSON.parse(await readFile(templatePath, 'utf8')) as unknown
    assertNestedSuperTemplate(parsed, templatePath)
    return parsed
  }

  private mediaForRole(role: ReferenceMediaRole): ReferenceMediaFile {
    const media = this.media.files.find((file) => file.role === role)
    if (!media) throw new Error(`Reference media role is not available: ${role}`)
    if (media.kind !== 'video') {
      throw new Error(`Mask reference layer must resolve to video media: ${role}`)
    }
    return media
  }
}

function assertMaskTemplate(
  value: unknown,
  templatePath: string,
): asserts value is MaskReferenceProjectTemplate {
  if (!isRecord(value) || value.schemaVersion !== 1 || value.templateId !== 'masks-rectangle-v1') {
    throw new Error(`Invalid mask reference project template header: ${templatePath}`)
  }
  if (
    typeof value.name !== 'string'
    || typeof value.description !== 'string'
    || !isRecord(value.composition)
    || !isRecord(value.layers)
    || !isRecord(value.layers.base)
    || !isRecord(value.layers.foreground)
    || !isRecord(value.mask)
    || !Array.isArray(value.mask.vertices)
    || value.mask.vertices.length !== 4
    || !isRecord(value.review)
  ) {
    throw new Error(`Invalid mask reference project template structure: ${templatePath}`)
  }
  for (const vertex of value.mask.vertices) {
    if (!isRecord(vertex) || typeof vertex.x !== 'number' || typeof vertex.y !== 'number') {
      throw new Error(`Invalid mask vertex in reference project template: ${templatePath}`)
    }
  }
}

function assertNestedSuperTemplate(
  value: unknown,
  templatePath: string,
): asserts value is NestedSuperProjectTemplate {
  if (
    !isRecord(value)
    || value.schemaVersion !== 1
    || value.templateId !== 'nested-super-project-v1'
    || typeof value.name !== 'string'
    || typeof value.description !== 'string'
    || typeof value.projectFile !== 'string'
    || !Array.isArray(value.mediaLinks)
    || !isRecord(value.compositions)
    || !isRecord(value.compositions.main)
    || !isRecord(value.compositions.level2)
    || !isRecord(value.compositions.level1)
    || !isRecord(value.review)
    || !Array.isArray(value.review.sampleTimes)
  ) {
    throw new Error(`Invalid nested Super Project template: ${templatePath}`)
  }

  const allowedRoles = new Set<ReferenceMediaRole>([
    'dynamic-landscape',
    'high-frequency-60fps',
    'longform-landscape',
  ])
  for (const mediaLink of value.mediaLinks) {
    if (
      !isRecord(mediaLink)
      || typeof mediaLink.role !== 'string'
      || !allowedRoles.has(mediaLink.role as ReferenceMediaRole)
      || typeof mediaLink.projectMediaId !== 'string'
      || typeof mediaLink.target !== 'string'
    ) {
      throw new Error(`Invalid nested Super Project media link: ${templatePath}`)
    }
  }
}

function assertNestedSuperProjectSnapshot(
  value: unknown,
  template: NestedSuperProjectTemplate,
  projectPath: string,
): void {
  if (!isRecord(value) || value.version !== 1 || value.name !== template.name) {
    throw new Error(`Invalid nested Super Project snapshot header: ${projectPath}`)
  }
  if (!Array.isArray(value.media) || value.media.length !== template.mediaLinks.length) {
    throw new Error(`Nested Super Project media contract mismatch: ${projectPath}`)
  }
  if (!Array.isArray(value.compositions) || value.compositions.length !== 3) {
    throw new Error(`Nested Super Project composition contract mismatch: ${projectPath}`)
  }

  for (const expected of Object.values(template.compositions)) {
    const composition = value.compositions.find(
      (candidate) => isRecord(candidate) && candidate.id === expected.id,
    )
    if (
      !isRecord(composition)
      || composition.name !== expected.name
      || composition.width !== expected.width
      || composition.height !== expected.height
      || composition.frameRate !== expected.frameRate
      || composition.duration !== expected.duration
      || !Array.isArray(composition.clips)
    ) {
      throw new Error(`Nested Super Project composition mismatch for ${expected.name}: ${projectPath}`)
    }
  }
}

function assertPathWithinProject(target: string, projectDirectory: string, label: string): void {
  const relative = path.relative(projectDirectory, target)
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Nested Super Project media target escapes the working copy: ${label}`)
  }
}

async function linkOrCopy(source: string, target: string): Promise<void> {
  try {
    await link(source, target)
  } catch (error) {
    const code = isRecord(error) && typeof error.code === 'string' ? error.code : ''
    if (!['EXDEV', 'EPERM', 'EACCES', 'ENOTSUP'].includes(code)) throw error
    await copyFile(source, target)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
