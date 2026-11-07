import { describe, expect, it } from 'vitest'
import {
  buildAtempoFilters,
  buildStitchCommandPlan
} from '../src/main/ffmpeg/stitchBuilder'
import type { SourceClip, TimelineSegment } from '../src/shared/types'

describe('FFmpeg Stitch Filtergraph Builder', () => {
  it('chains atempo filters cleanly for <0.5x slow-motion and >2.0x fast-forward', () => {
    expect(buildAtempoFilters(1)).toEqual([])
    expect(buildAtempoFilters(0.25)).toEqual(['atempo=0.5', 'atempo=0.5'])
    expect(buildAtempoFilters(0.3)).toEqual(['atempo=0.5', 'atempo=0.6'])
    expect(buildAtempoFilters(4)).toEqual(['atempo=2.0', 'atempo=2'])
  })

  it('builds normalized V1 + A1 filtergraph and pads shorter track when lengths diverge', () => {
    const clipA: SourceClip = {
      id: 'a',
      filePath: 'E:\\a.mp4',
      fileName: 'a.mp4',
      fileSize: 1000,
      duration: 10,
      width: 1280,
      height: 720,
      fps: 24,
      videoCodec: 'h264',
      hasVideo: true,
      hasAudio: true,
      audioCodec: 'aac',
      thumbnailPath: null,
      waveformPeaks: []
    }

    const vSeg: TimelineSegment = {
      id: 'v1',
      sourceClipId: 'a',
      label: 'a.mp4',
      track: 'video',
      linkGroupId: null,
      sourceIn: 0,
      sourceOut: 10,
      speed: 2, // 5s video
      muted: false,
      volume: 1
    }

    const aSeg: TimelineSegment = {
      id: 'a1',
      sourceClipId: 'a',
      label: 'a.mp4',
      track: 'audio',
      linkGroupId: null,
      sourceIn: 0,
      sourceOut: 8,
      speed: 1, // 8s audio (longer than 5s video!)
      muted: false,
      volume: 1.25
    }

    const plan = buildStitchCommandPlan({
      clipsById: new Map([['a', clipA]]),
      videoSegments: [vSeg],
      audioSegments: [aSeg],
      includeVideo: true,
      includeAudio: true,
      resolution: '1920x1080',
      fps: 30,
      durationPolicy: 'longest'
    })

    expect(plan.expectedDurationSec).toBeCloseTo(8)
    expect(plan.filterComplexScript).toContain('force_divisible_by=2')
    expect(plan.filterComplexScript).toContain('volume=1.250')
    expect(plan.filterComplexScript).toContain('[vpad_tail]')
    expect(plan.mapArgs).toEqual(['-map', '[vout]', '-map', '[aout]'])
  })
})
