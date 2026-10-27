import type { BridgeClient } from '../fixtures/bridgeClient'
import { frameCodeClipV2, type FrameCodeV2Clip } from '../fixtures/frameCodeMedia'
import {
  LAST_FRAME, MOSAIC, SOURCES, T03, T04, T06, T09, T11, TILE_CELLS, boxOf, centered, rulerLeft, t03Rect,
  type Rect, type SourceKey,
} from './mosaicLayout'

/**
 * Builds the mosaic MVP through the Dev Bridge (arrangement; the mouse build with
 * a safety net is the next step). Every layer gets its own video track; the first
 * video track in the store renders on top (src/services/layerBuilder/LayerBuilderService.ts:318-328).
 * Returns the clip ids per role so the oracles and diagnostics can read the built state.
 */
export interface MosaicBuild {
  clips: Record<string, string>
  sources: Record<SourceKey, FrameCodeV2Clip>
  innerCompositionId: string
  fullInnerCompositionId: string
}

interface TimelineState { activeCompositionId: string | null; videoTracks: Array<{ id: string; clips: Array<{ id: string }> }> }
interface ClipDetails { id: string; startTime: number; duration: number; inPoint: number; outPoint: number; speed?: number; reversed?: boolean }

/** Roles from top to bottom. */
const ROLES = ['t04.l3', 't04.l2', 't04.l1', 't09.strip', 't09.nested', 't09b.strip', 't09b.nested', 'clock', 'ruler', 't01', 't03', 't06', 't11.fast', 't11.reverse', 'background'] as const
type Role = typeof ROLES[number]

export async function generateMosaicSources(): Promise<Record<SourceKey, FrameCodeV2Clip>> {
  const entries = await Promise.all((Object.keys(SOURCES) as SourceKey[]).map(async key => [key, await frameCodeClipV2(SOURCES[key])] as const))
  return Object.fromEntries(entries) as Record<SourceKey, FrameCodeV2Clip>
}

export async function buildMosaic(bridge: BridgeClient, sources: Record<SourceKey, FrameCodeV2Clip>): Promise<MosaicBuild> {
  const mosaicId = (await bridge.toolData<TimelineState>('getTimelineState')).activeCompositionId
  if (!mosaicId) throw new Error('No active composition for the mosaic')
  const imported = await bridge.toolData<{ imported?: Array<{ id: string; path: string }> }>('importLocalFiles',
    { paths: Object.values(sources).map(source => source.path.replaceAll('\\', '/')), addToTimeline: false }, { timeoutMs: 90_000 })
  const mediaId = (key: SourceKey): string => {
    const wanted = sources[key].path.replaceAll('\\', '/')
    const item = imported.imported?.find(entry => entry.path.replaceAll('\\', '/') === wanted || wanted.endsWith(entry.path))
    if (!item) throw new Error(`importLocalFiles did not return ${wanted}`)
    return item.id
  }

  const tracks = await prepareTracks(bridge)
  const clips: Record<string, string> = {}
  const box = (tile: keyof typeof TILE_CELLS) => boxOf(TILE_CELLS[tile].column, TILE_CELLS[tile].row)

  // T09a: a 352×224 composition at 60 fps, filled and nested at once (the order a user follows):
  // create it, put the clip in, open the mosaic, drop the composition onto its track.
  const innerCompositionId = await createComposition(bridge, 'Mosaic T09a inner', MOSAIC.box.width, MOSAIC.box.height)
  await addSegment(bridge, mediaId('t09inner'), await firstVideoTrack(bridge), 0, 0, 6)
  await bridge.toolData('openComposition', { compositionId: mosaicId })
  clips['t09.nested'] = await addCompositionClip(bridge, innerCompositionId, tracks['t09.nested'])
  // T09b: the same timing in a composition of the mosaic's size, its clip at the T09b box.
  const fullInnerCompositionId = await createComposition(bridge, 'Mosaic T09b inner', MOSAIC.width, MOSAIC.height)
  const fullInnerClip = await addSegment(bridge, mediaId('t09bInner'), await firstVideoTrack(bridge), 0, 0, 6)
  await bridge.toolData('setTransform', { clipId: fullInnerClip, ...centered(box('T09b')), scaleX: 1, scaleY: 1 })
  await bridge.toolData('openComposition', { compositionId: mosaicId })
  clips['t09b.nested'] = await addCompositionClip(bridge, fullInnerCompositionId, tracks['t09b.nested'])
  const place = async (role: Role, rect: Rect, extra: Record<string, unknown> = {}) => {
    const { x, y } = centered(rect)
    await bridge.toolData('setTransform', { clipId: clips[role], x, y, ...extra })
  }
  const solid = async (role: Role, color: string, rect: Rect, extra: Record<string, unknown> = {}) => {
    clips[role] = (await bridge.toolData<{ clipId: string }>('createSolidClip', { trackId: tracks[role], start: 0, duration: MOSAIC.seconds, color, name: role })).clipId
    await place(role, rect, { scaleX: rect.width / MOSAIC.width, scaleY: rect.height / MOSAIC.height, ...extra })
  }
  const video = async (role: Role, key: SourceKey, rect: Rect, outPoint: number = MOSAIC.seconds) => {
    clips[role] = await addSegment(bridge, mediaId(key), tracks[role], 0, 0, outPoint)
    await place(role, rect, { scaleX: rect.width / sources[key].width, scaleY: rect.height / sources[key].height })
  }
  await solid('background', '#303030', { x: 0, y: 0, width: MOSAIC.width, height: MOSAIC.height })
  await video('clock', 'clock', MOSAIC.clock)
  const ruler = { x: rulerLeft(0), y: MOSAIC.ruler.y, width: MOSAIC.ruler.width, height: MOSAIC.ruler.height }
  await solid('ruler', '#ffffff', ruler)
  const rulerEnd = centered({ ...ruler, x: rulerLeft(LAST_FRAME) })
  await bridge.toolData('addKeyframe', { clipId: clips.ruler, keys: { 'position.x': [[0, centered(ruler).x, 'linear'], [LAST_FRAME / MOSAIC.fps, rulerEnd.x, 'linear']] } })

  // T01 reference: the chart at 1:1.
  await video('t01', 't01', box('T01'))

  // T03 keyframed transform: scale 0.75, x linear, y ease-in-out.
  const start = centered(t03Rect(0)), end = centered(t03Rect(LAST_FRAME))
  await video('t03', 't03', t03Rect(0))
  await bridge.toolData('addKeyframe', { clipId: clips.t03, keys: {
    'position.x': [[0, start.x, 'linear'], [T03.keyEnd, end.x, 'linear']],
    'position.y': [[0, start.y, 'ease-in-out'], [T03.keyEnd, end.y, 'ease-in-out']],
  } })

  // T04 opacity and layer order.
  const b4 = box('T04'), offset = (rect: Rect): Rect => ({ x: b4.x + rect.x, y: b4.y + rect.y, width: rect.width, height: rect.height })
  await solid('t04.l1', '#c80000', offset(T04.l1))
  await solid('t04.l2', '#00c800', offset(T04.l2), { opacity: T04.greenOpacity })
  await video('t04.l3', 't04', offset(T04.l3))
  await bridge.toolData('addKeyframe', { clipId: clips['t04.l3'], keys: { opacity: [[0, T04.opacityStart, 'linear'], [LAST_FRAME / MOSAIC.fps, T04.opacityEnd, 'linear']] } })

  // T06 rectangle mask with feather, outline hidden so it never draws over the preview.
  await video('t06', 't06', box('T06'))
  await bridge.toolData('addMask', { clipId: clips.t06, name: 'Mosaic T06', vertices: T06.vertices, feather: T06.feather, closed: true, visible: false })

  // T09 nested composition with in-point 1 s, the outer 30 fps strip over its floor band.
  const b9 = box('T09')
  await bridge.toolData('trimClip', { clipId: clips['t09.nested'], inPoint: T09.inPoint, outPoint: T09.inPoint + MOSAIC.seconds })
  await ensureStart(bridge, clips['t09.nested'], 0)
  await place('t09.nested', b9, { scaleX: 1, scaleY: 1 })
  await video('t09.strip', 't09outer', { x: b9.x, y: b9.y + T09.stripTop, width: MOSAIC.box.width, height: 32 })

  const b9b = box('T09b')
  await bridge.toolData('trimClip', { clipId: clips['t09b.nested'], inPoint: T09.inPoint, outPoint: T09.inPoint + MOSAIC.seconds })
  await ensureStart(bridge, clips['t09b.nested'], 0)
  await video('t09b.strip', 't09bOuter', { x: b9b.x, y: b9b.y + T09.stripTop, width: MOSAIC.box.width, height: 32 })

  // T11 speed 2 (upper half) and reverse (lower half).
  const b11 = box('T11')
  await video('t11.fast', 't11fast', { x: b11.x, y: b11.y, width: 352, height: 112 }, MOSAIC.seconds * T11.speed)
  await bridge.toolData('setClipSpeed', { clipId: clips['t11.fast'], speed: T11.speed })
  await video('t11.reverse', 't11reverse', { x: b11.x, y: b11.y + 112, width: 352, height: 112 }, T11.reverseOut)
  await bridge.toolData('setClipSpeed', { clipId: clips['t11.reverse'], reverse: true })

  await bridge.toolData('clearSelection')
  return { clips, sources, innerCompositionId, fullInnerCompositionId }
}

async function createComposition(bridge: BridgeClient, name: string, width: number, height: number): Promise<string> {
  const created = await bridge.toolData<{ compositionId?: string; id?: string }>('createComposition', { name, width, height, frameRate: T09.innerFps, duration: 6, openAfterCreate: true })
  const id = created.compositionId ?? created.id
  if (!id) throw new Error(`createComposition returned no id: ${JSON.stringify(created).slice(0, 300)}`)
  return id
}

async function firstVideoTrack(bridge: BridgeClient): Promise<string | null> {
  return (await bridge.toolData<TimelineState>('getTimelineState')).videoTracks[0]?.id ?? null
}

async function addSegment(bridge: BridgeClient, mediaFileId: string, trackId: string | null, startTime: number, inPoint: number, outPoint: number): Promise<string> {
  const result = await bridge.toolData<{ clips: Array<{ id: string; trackId: string }> }>('addClipSegment',
    { mediaFileId, trackId, startTime, inPoint, outPoint, visualScaleMode: 'original', deClickFadeSeconds: 0 })
  const clip = result.clips.find(entry => trackId === null || entry.trackId === trackId) ?? result.clips[0]
  if (!clip) throw new Error('addClipSegment created no clip')
  return clip.id
}

async function addCompositionClip(bridge: BridgeClient, compositionId: string, trackId: string): Promise<string> {
  const result = await bridge.toolData<{ clipId?: string; clip?: { id: string }; clips?: Array<{ id: string }> }>('addCompositionClip', { compositionId, trackId, startTime: 0 })
  const id = result.clipId ?? result.clip?.id ?? result.clips?.[0]?.id
  if (!id) throw new Error(`addCompositionClip returned no clip id: ${JSON.stringify(result).slice(0, 300)}`)
  return id
}

async function ensureStart(bridge: BridgeClient, clipId: string, startTime: number): Promise<void> {
  const details = await bridge.toolData<ClipDetails>('getClipDetails', { clipId })
  if (Math.abs(details.startTime - startTime) > 1e-9) await bridge.toolData('moveClip', { clipId, startTime })
}

/** One video track per role, assigned top to bottom in store order. */
async function prepareTracks(bridge: BridgeClient): Promise<Record<Role, string>> {
  let state = await bridge.toolData<TimelineState>('getTimelineState')
  for (let missing = ROLES.length - state.videoTracks.length; missing > 0; missing--) await bridge.toolData('createTrack', { type: 'video' })
  state = await bridge.toolData<TimelineState>('getTimelineState')
  if (state.videoTracks.some(track => track.clips.length > 0)) throw new Error('The mosaic composition must start empty')
  return Object.fromEntries(ROLES.map((role, index) => [role, state.videoTracks[index].id])) as Record<Role, string>
}

/** The built state the oracles read: clip timing as the editor stored it. */
export async function readClipDetails(bridge: BridgeClient, build: MosaicBuild): Promise<Record<string, ClipDetails>> {
  const entries = await Promise.all(Object.entries(build.clips).map(async ([role, clipId]) => [role, await bridge.toolData<ClipDetails>('getClipDetails', { clipId })] as const))
  return Object.fromEntries(entries)
}
