import { beforeEach, describe, expect, it } from 'vitest'
import {
  computeTrackLayout,
  findSegmentAtTime,
  getSegmentTimelineDuration,
  splitSegmentAtTimelineTime,
  trimSegmentBounds
} from '../src/shared/timelineMath'
import type { SourceClip, TimelineSegment } from '../src/shared/types'
import { useProjectStore } from '../src/renderer/src/store/useProjectStore'

function makeMockClip(id: string, fileName: string, duration = 10, hasAudio = true): SourceClip {
  return {
    id,
    filePath: `E:\\clips\\${fileName}`,
    fileName,
    fileSize: 1024,
    duration,
    width: 1920,
    height: 1080,
    fps: 30,
    videoCodec: 'h264',
    hasVideo: true,
    hasAudio,
    audioCodec: hasAudio ? 'aac' : null,
    thumbnailPath: null,
    waveformPeaks: hasAudio ? [0.4, 0.8] : []
  }
}

describe('Timeline Math & Dual-Track Project Store', () => {
  beforeEach(() => {
    useProjectStore.getState().clearProject()
    useProjectStore.temporal.getState().clear()
    useProjectStore.getState().setLinkEnabled(false)
  })

  it('calculates timeline duration accurately when speeding up or slowing down', () => {
    expect(getSegmentTimelineDuration({ sourceIn: 2, sourceOut: 10, speed: 2 })).toBeCloseTo(4)
    expect(getSegmentTimelineDuration({ sourceIn: 0, sourceOut: 4, speed: 0.5 })).toBeCloseTo(8)
  })

  it('maps timeline playhead to exact source media timestamp and splits accurately', () => {
    const seg: TimelineSegment = {
      id: 's1',
      sourceClipId: 'c1',
      label: 'clip.mp4',
      track: 'video',
      linkGroupId: null,
      sourceIn: 2,
      sourceOut: 10,
      speed: 2, // 4s on timeline
      muted: false,
      volume: 1
    }

    const layout = computeTrackLayout([seg])
    expect(layout[0].timelineDuration).toBeCloseTo(4)

    // At 1.5s on timeline with 2x speed, source offset = 2 + 1.5 * 2 = 5.0s
    const hit = findSegmentAtTime(layout, 1.5)
    expect(hit?.sourceTime).toBeCloseTo(5.0)

    const split = splitSegmentAtTimelineTime(layout[0], 1.5, 'left', 'right', null)
    expect(split).not.toBeNull()
    expect(split![0].sourceIn).toBeCloseTo(2)
    expect(split![0].sourceOut).toBeCloseTo(5)
    expect(split![1].sourceIn).toBeCloseTo(5)
    expect(split![1].sourceOut).toBeCloseTo(10)
  })

  it('clamps trim bounds safely within clip duration', () => {
    const seg: TimelineSegment = {
      id: 's1',
      sourceClipId: 'c1',
      label: 'clip.mp4',
      track: 'video',
      linkGroupId: null,
      sourceIn: 0,
      sourceOut: 5,
      speed: 1,
      muted: false,
      volume: 1
    }
    const trimmed = trimSegmentBounds(seg, -3, 12, 8)
    expect(trimmed.sourceIn).toBe(0)
    expect(trimmed.sourceOut).toBe(8)
  })

  it('defaults imported clips to alphabetical order, separates V1 & A1, and supports independent edits + undo', () => {
    const store = useProjectStore.getState()
    store.addImportedVideoClips([
      makeMockClip('c10', 'clip_10.mp4', 8),
      makeMockClip('c2', 'clip_2.mp4', 6)
    ])

    let state = useProjectStore.getState()
    expect(state.clips.map((c) => c.fileName)).toEqual(['clip_2.mp4', 'clip_10.mp4'])
    expect(state.videoSegments).toHaveLength(2)
    expect(state.audioSegments).toHaveLength(2)

    // Reorder sequence in bin: clip_10 before clip_2
    state.reorderClipInBin('c10', 'c2')
    state = useProjectStore.getState()
    expect(state.clips.map((c) => c.id)).toEqual(['c10', 'c2'])
    expect(state.videoSegments.map((s) => s.sourceClipId)).toEqual(['c10', 'c2'])
    expect(state.audioSegments.map((s) => s.sourceClipId)).toEqual(['c10', 'c2'])

    // Separated V1 / A1 edit: speed up first video segment to 2x while A1 stays at 1x
    const firstVidId = state.videoSegments[0].id
    state.setSegmentSpeed(firstVidId, 2)
    state = useProjectStore.getState()
    expect(state.videoSegments[0].speed).toBe(2)
    expect(state.audioSegments[0].speed).toBe(1)

    // Split V1 segment at 2s and ripple-delete left piece
    state.selectSegment(firstVidId)
    state.setPlayheadSec(2)
    expect(state.splitAtPlayhead('selected')).toBe(true)
    state = useProjectStore.getState()
    expect(state.videoSegments).toHaveLength(3)
    expect(state.audioSegments).toHaveLength(2) // Audio untouched!

    // Undo restores previous state
    useProjectStore.temporal.getState().undo()
    expect(useProjectStore.getState().videoSegments).toHaveLength(2)
  })

  it('safely guards against NaN or infinite inputs in duration and trim bounds', () => {
    const seg: TimelineSegment = {
      id: 's1',
      sourceClipId: 'c1',
      label: 'clip.mp4',
      track: 'video',
      linkGroupId: null,
      sourceIn: 1,
      sourceOut: 5,
      speed: 1,
      muted: false,
      volume: 1
    }

    expect(getSegmentTimelineDuration({ sourceIn: NaN, sourceOut: 6, speed: 2 })).toBeCloseTo(3)
    expect(getSegmentTimelineDuration({ sourceIn: 2, sourceOut: NaN, speed: 1 })).toBeCloseTo(0)
    expect(getSegmentTimelineDuration({ sourceIn: 0, sourceOut: 5, speed: NaN })).toBeCloseTo(5)

    const trimmedNaN = trimSegmentBounds(seg, NaN, NaN, 10)
    expect(trimmedNaN.sourceIn).toBe(1)
    expect(trimmedNaN.sourceOut).toBe(5)
  })

  it('retains last frame at or past timeline end in findSegmentAtTime', () => {
    const seg: TimelineSegment = {
      id: 's1',
      sourceClipId: 'c1',
      label: 'clip.mp4',
      track: 'video',
      linkGroupId: null,
      sourceIn: 0,
      sourceOut: 10,
      speed: 1,
      muted: false,
      volume: 1
    }

    const layout = computeTrackLayout([seg])
    const atEnd = findSegmentAtTime(layout, 10.0)
    expect(atEnd).not.toBeNull()
    expect(atEnd?.sourceTime).toBeCloseTo(10.0)

    const pastEnd = findSegmentAtTime(layout, 12.5)
    expect(pastEnd).not.toBeNull()
    expect(pastEnd?.sourceTime).toBeCloseTo(10.0)
  })

  it('avoids cross-track linkGroupId contamination when splitting unpartnered segments', () => {
    useProjectStore.getState().addImportedVideoClips([
      makeMockClip('c1', 'clip_1.mp4', 10),
      makeMockClip('c2', 'clip_2.mp4', 10)
    ])

    let state = useProjectStore.getState()
    // Break linkage and reorder audio track so V1[0] is c1 and A1[0] is c2
    state.setLinkEnabled(false)
    state.unlinkSegmentPair(state.videoSegments[0].id)
    state.reorderTrackSegment('audio', state.audioSegments[1].id, state.audioSegments[0].id)

    state = useProjectStore.getState()
    // Now V1[0] is c1, A1[0] is c2
    expect(state.videoSegments[0].sourceClipId).toBe('c1')
    expect(state.audioSegments[0].sourceClipId).toBe('c2')

    // Split at 3s on both tracks
    state.setPlayheadSec(3)
    const didSplit = state.splitAtPlayhead('both')
    expect(didSplit).toBe(true)

    state = useProjectStore.getState()
    const rightV = state.videoSegments[1]
    const rightA = state.audioSegments[1]

    // Ensure V1 and A1 did NOT accidentally get cross-linked together
    expect(rightV.linkGroupId).not.toEqual(rightA.linkGroupId)
  })

  it('wraps playhead from end to 0 on togglePlayPause and clamps playhead on delete', () => {
    useProjectStore.getState().addImportedVideoClips([makeMockClip('c1', 'clip_1.mp4', 5)])

    // Move playhead to end
    useProjectStore.getState().setPlayheadSec(5)
    expect(useProjectStore.getState().playheadSec).toBeCloseTo(5)

    // ArrowRight / excessive seek should clamp to max content duration
    useProjectStore.getState().setPlayheadSec(999)
    expect(useProjectStore.getState().playheadSec).toBeCloseTo(5)

    // togglePlayPause should restart from 0
    useProjectStore.getState().togglePlayPause()
    expect(useProjectStore.getState().playheadSec).toBe(0)
    expect(useProjectStore.getState().isPlaying).toBe(true)

    // Shorten timeline via delete and ensure playhead clamps
    useProjectStore.getState().setIsPlaying(false)
    useProjectStore.getState().setPlayheadSec(4)
    useProjectStore.getState().setLinkEnabled(true)
    useProjectStore.getState().deleteSegment(useProjectStore.getState().videoSegments[0].id)
    expect(useProjectStore.getState().playheadSec).toBeCloseTo(0)
  })
})
