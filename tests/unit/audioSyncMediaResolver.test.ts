import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TimelineClip } from '../../src/types'
import {
  getLazyTimelineAudioElementForClip,
  getLazyTimelineVideoElementForClip,
} from '../../src/services/timeline/lazyMediaElements'
import { resolveAudioSyncMedia } from '../../src/services/layerBuilder/audioSyncMediaResolver'

vi.mock('../../src/services/timeline/lazyMediaElements', () => ({
  getLazyTimelineAudioElementForClip: vi.fn(),
  getLazyTimelineVideoElementForClip: vi.fn(),
}))

function clipWithSource(source: NonNullable<TimelineClip['source']>): TimelineClip {
  return { id: 'clip', source } as TimelineClip
}

describe('resolveAudioSyncMedia', () => {
  beforeEach(() => {
    vi.mocked(getLazyTimelineAudioElementForClip).mockReturnValue(null)
    vi.mocked(getLazyTimelineVideoElementForClip).mockReturnValue(null)
  })

  it('reuses a generated composition mixdown attached directly to the clip source', () => {
    const mixdown = document.createElement('audio')
    const clip = clipWithSource({ type: 'audio', audioElement: mixdown })

    expect(resolveAudioSyncMedia(clip).htmlAudioElement).toBe(mixdown)
  })

  it('falls back to a direct video runtime handle too', () => {
    const video = document.createElement('video')
    const clip = clipWithSource({ type: 'video', videoElement: video })

    expect(resolveAudioSyncMedia(clip).htmlVideoElement).toBe(video)
  })

  it('prefers the currently managed lazy element over a stale direct handle', () => {
    const direct = document.createElement('audio')
    const lazy = document.createElement('audio')
    const clip = clipWithSource({ type: 'audio', audioElement: direct })
    vi.mocked(getLazyTimelineAudioElementForClip).mockReturnValue(lazy)

    expect(resolveAudioSyncMedia(clip).htmlAudioElement).toBe(lazy)
  })
})
