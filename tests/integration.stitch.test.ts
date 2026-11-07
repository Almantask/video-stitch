import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { executeExportJob } from '../src/main/ffmpeg/exportService'
import { getFfmpegBins } from '../src/main/ffmpeg/locator'
import { probeFilesBatch } from '../src/main/ffmpeg/probeService'
import type { SourceClip, TimelineSegment } from '../src/shared/types'

describe('End-to-End FFmpeg Multi-Clip Probe, Cut, Speed & Stitch', () => {
  let tempDir = ''
  let clip10Path = ''
  let clip2Path = ''
  let clip1Path = ''

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'video-stitch-e2e-'))
    const { ffmpegPath } = getFfmpegBins()

    clip10Path = join(tempDir, 'clip_10.mp4')
    clip2Path = join(tempDir, 'clip_2.mp4')
    clip1Path = join(tempDir, 'clip_1.mp4')

    // Generate 3 heterogeneous clips:
    // 1) clip_10.mp4: 1280x720 @ 24fps, 2.0s with 440Hz sine audio
    spawnSync(
      ffmpegPath,
      [
        '-y',
        '-f',
        'lavfi',
        '-i',
        'testsrc=duration=2:size=1280x720:rate=24',
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=440:duration=2',
        '-c:v',
        'libx264',
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'aac',
        clip10Path
      ],
      { stdio: 'ignore' }
    )

    // 2) clip_2.mp4: 640x480 @ 30fps, 1.6s WITHOUT audio stream
    spawnSync(
      ffmpegPath,
      [
        '-y',
        '-f',
        'lavfi',
        '-i',
        'testsrc=duration=1.6:size=640x480:rate=30',
        '-c:v',
        'libx264',
        '-pix_fmt',
        'yuv420p',
        clip2Path
      ],
      { stdio: 'ignore' }
    )

    // 3) clip_1.mp4: 720x1280 vertical @ 30fps, 2.0s with 880Hz sine audio
    spawnSync(
      ffmpegPath,
      [
        '-y',
        '-f',
        'lavfi',
        '-i',
        'testsrc=duration=2:size=720x1280:rate=30',
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=880:duration=2',
        '-c:v',
        'libx264',
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'aac',
        clip1Path
      ],
      { stdio: 'ignore' }
    )
  })

  afterAll(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true }).catch(() => undefined)
    }
  })

  it('probes heterogeneous videos, sorts naturally A->Z, and stitches separated V1/A1 with cuts & speed changes', async () => {
    const probed = await probeFilesBatch([clip10Path, clip2Path, clip1Path])
    expect(probed.errors).toHaveLength(0)
    expect(probed.clips.map((c) => c.fileName)).toEqual([
      'clip_1.mp4',
      'clip_2.mp4',
      'clip_10.mp4'
    ])

    const [c1, c2, c10] = probed.clips as [SourceClip, SourceClip, SourceClip]
    expect(c1.hasAudio).toBe(true)
    expect(c1.waveformPeaks.length).toBeGreaterThan(10)
    expect(c2.hasAudio).toBe(false)

    // Build edited separated V1 and A1 timelines:
    // V1: c1 trimmed [0.2, 1.8] @ 2.0x (0.8s) + c2 [0, 1.2] @ 1.0x (1.2s) + c10 [0, 1.0] @ 0.5x (2.0s) => 4.0s total
    const videoSegments: TimelineSegment[] = [
      {
        id: 'v1',
        sourceClipId: c1.id,
        label: c1.fileName,
        track: 'video',
        linkGroupId: null,
        sourceIn: 0.2,
        sourceOut: 1.8,
        speed: 2.0,
        muted: false,
        volume: 1
      },
      {
        id: 'v2',
        sourceClipId: c2.id,
        label: c2.fileName,
        track: 'video',
        linkGroupId: null,
        sourceIn: 0,
        sourceOut: 1.2,
        speed: 1.0,
        muted: false,
        volume: 1
      },
      {
        id: 'v3',
        sourceClipId: c10.id,
        label: c10.fileName,
        track: 'video',
        linkGroupId: null,
        sourceIn: 0,
        sourceOut: 1.0,
        speed: 0.5,
        muted: false,
        volume: 1
      }
    ]

    // A1: c10 audio @ 0.25x slow-mo [0, 0.5] (2.0s, exercises chained atempo=0.5,atempo=0.5!) + c1 audio [0, 2.0] @ 1.0x (2.0s) => 4.0s
    const audioSegments: TimelineSegment[] = [
      {
        id: 'a1',
        sourceClipId: c10.id,
        label: c10.fileName,
        track: 'audio',
        linkGroupId: null,
        sourceIn: 0,
        sourceOut: 0.5,
        speed: 0.25,
        muted: false,
        volume: 1.2
      },
      {
        id: 'a2',
        sourceClipId: c1.id,
        label: c1.fileName,
        track: 'audio',
        linkGroupId: null,
        sourceIn: 0,
        sourceOut: 2.0,
        speed: 1.0,
        muted: false,
        volume: 0.9
      }
    ]

    const combinedOut = join(tempDir, 'stitched_combined.mp4')
    const combinedRes = await executeExportJob({
      jobId: 'e2e_combined',
      clips: probed.clips,
      videoSegments,
      audioSegments,
      settings: {
        mode: 'combined',
        resolution: '1920x1080',
        fps: 30,
        audioFormat: 'wav',
        durationPolicy: 'longest',
        outputPath: combinedOut
      }
    })

    expect(combinedRes.success).toBe(true)
    expect(existsSync(combinedOut)).toBe(true)

    const { ffprobePath } = getFfmpegBins()
    const probeOut = spawnSync(
      ffprobePath,
      ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', combinedOut],
      { encoding: 'utf-8' }
    )
    const meta = JSON.parse(probeOut.stdout)
    const vStream = meta.streams.find((s: { codec_type: string }) => s.codec_type === 'video')
    const aStream = meta.streams.find((s: { codec_type: string }) => s.codec_type === 'audio')

    expect(vStream).toBeDefined()
    expect(vStream.width).toBe(1920)
    expect(vStream.height).toBe(1080)
    expect(aStream).toBeDefined()
    expect(Number(meta.format.duration)).toBeGreaterThan(3.7)
    expect(Number(meta.format.duration)).toBeLessThan(4.3)

    // Also verify Separated Video + Audio file export mode
    const sepBase = join(tempDir, 'separated_export.mp4')
    const sepRes = await executeExportJob({
      jobId: 'e2e_separate',
      clips: probed.clips,
      videoSegments,
      audioSegments,
      settings: {
        mode: 'separate',
        resolution: '1280x720',
        fps: 30,
        audioFormat: 'wav',
        durationPolicy: 'longest',
        outputPath: sepBase
      }
    })

    expect(sepRes.success).toBe(true)
    expect(sepRes.outputPaths).toHaveLength(2)
    expect(existsSync(sepRes.outputPaths[0])).toBe(true)
    expect(existsSync(sepRes.outputPaths[1])).toBe(true)
  })
})
