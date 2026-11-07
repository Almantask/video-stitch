import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, extname, join } from 'node:path'
import { getSegmentTimelineDuration } from '../../shared/timelineMath'
import type {
  AudioExportFormat,
  ExportJobRequest,
  ExportJobResult,
  ExportProgressEvent,
  SourceClip,
  TimelineSegment
} from '../../shared/types'
import { getFfmpegBins } from './locator'
import { buildStitchCommandPlan, type StitchCommandPlan } from './stitchBuilder'

const CHUNK_SIZE = 10
const activeProcesses = new Map<string, { proc: ChildProcess; canceled: boolean }>()

function audioCodecArgs(format: AudioExportFormat): string[] {
  switch (format) {
    case 'wav':
      return ['-c:a', 'pcm_s16le']
    case 'm4a':
      return ['-c:a', 'aac', '-b:a', '192k']
    case 'mp3':
    default:
      return ['-c:a', 'libmp3lame', '-b:a', '192k']
  }
}

function videoCodecArgs(): string[] {
  return ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p']
}

async function runFfmpegWithProgress(params: {
  jobId: string
  ffmpegPath: string
  args: string[]
  expectedDurationSec: number
  phase: string
  progressWeightStart: number
  progressWeightSpan: number
  onProgress?: (event: ExportProgressEvent) => void
}): Promise<void> {
  const {
    jobId,
    ffmpegPath,
    args,
    expectedDurationSec,
    phase,
    progressWeightStart,
    progressWeightSpan,
    onProgress
  } = params

  return new Promise((resolve, reject) => {
    const existing = activeProcesses.get(jobId)
    if (existing?.canceled) {
      reject(new Error('EXPORT_CANCELED'))
      return
    }

    const fullArgs = ['-y', '-hide_banner', '-progress', 'pipe:1', '-nostats', ...args]
    const proc = spawn(ffmpegPath, fullArgs, { windowsHide: true })
    activeProcesses.set(jobId, { proc, canceled: false })

    let stderr = ''
    let stdoutBuf = ''

    proc.stdout.on('data', (chunk: Buffer) => {
      stdoutBuf += chunk.toString()
      const lines = stdoutBuf.split(/\r?\n/)
      stdoutBuf = lines.pop() ?? ''

      for (const line of lines) {
        if (line.startsWith('out_time_us=') || line.startsWith('out_time_ms=')) {
          const rawUs = Number.parseInt(line.split('=')[1] ?? '0', 10)
          if (Number.isFinite(rawUs) && rawUs >= 0 && expectedDurationSec > 0) {
            const currentSec = rawUs / 1_000_000
            const localRatio = Math.min(1, Math.max(0, currentSec / expectedDurationSec))
            const overallPercent = Math.min(
              99,
              Math.round((progressWeightStart + localRatio * progressWeightSpan) * 100)
            )
            onProgress?.({
              jobId,
              percent: overallPercent,
              currentTimeSec: currentSec,
              totalDurationSec: expectedDurationSec,
              phase
            })
          }
        }
      }
    })

    proc.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
      if (stderr.length > 16000) {
        stderr = stderr.slice(-16000)
      }
    })

    proc.on('error', (err) => {
      reject(err)
    })

    proc.on('close', (code) => {
      const entry = activeProcesses.get(jobId)
      if (entry?.canceled) {
        reject(new Error('EXPORT_CANCELED'))
        return
      }
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(stderr.trim() || `FFmpeg exited with code ${code}`))
      }
    })
  })
}

function chunkArray<T>(arr: readonly T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size))
  }
  return chunks
}

function escapeConcatPath(filePath: string): string {
  return filePath.replace(/\\/g, '/').replace(/'/g, "'\\''")
}

async function renderSinglePlan(params: {
  jobId: string
  ffmpegPath: string
  workDir: string
  plan: StitchCommandPlan
  codecAndContainerArgs: string[]
  outputPath: string
  phase: string
  progressStart: number
  progressSpan: number
  onProgress?: (ev: ExportProgressEvent) => void
}): Promise<void> {
  const scriptFile = join(params.workDir, `filter_${randomUUID()}.ffscript`)
  await writeFile(scriptFile, params.plan.filterComplexScript, 'utf-8')

  const args = [
    ...params.plan.inputArgs,
    '-filter_complex_script',
    scriptFile,
    ...params.plan.mapArgs,
    ...params.codecAndContainerArgs,
    params.outputPath
  ]

  await runFfmpegWithProgress({
    jobId: params.jobId,
    ffmpegPath: params.ffmpegPath,
    args,
    expectedDurationSec: params.plan.expectedDurationSec,
    phase: params.phase,
    progressWeightStart: params.progressStart,
    progressWeightSpan: params.progressSpan,
    onProgress: params.onProgress
  })
}

/**
 * Renders a large track in bounded chunks of `CHUNK_SIZE` segments and lossless-concats them,
 * returning a synthetic `SourceClip` + single `TimelineSegment` so even 100+ video projects
 * never hit RAM or open-file-handle limits.
 */
async function preRenderLargeTrackIfNeeded(params: {
  jobId: string
  ffmpegPath: string
  workDir: string
  clipsById: Map<string, SourceClip>
  segments: TimelineSegment[]
  track: 'video' | 'audio'
  request: ExportJobRequest
  progressStart: number
  progressSpan: number
  onProgress?: (ev: ExportProgressEvent) => void
}): Promise<{ clipsById: Map<string, SourceClip>; segments: TimelineSegment[] }> {
  const { segments, track } = params
  if (segments.length <= CHUNK_SIZE) {
    return { clipsById: params.clipsById, segments }
  }

  const batches = chunkArray(segments, CHUNK_SIZE)
  const chunkFiles: string[] = []
  let totalDur = 0

  for (let b = 0; b < batches.length; b++) {
    const batch = batches[b]
    const ext = track === 'video' ? 'mp4' : 'wav'
    const chunkPath = join(params.workDir, `${track}_chunk_${b}.${ext}`)
    chunkFiles.push(chunkPath)

    const plan = buildStitchCommandPlan({
      clipsById: params.clipsById,
      videoSegments: track === 'video' ? batch : [],
      audioSegments: track === 'audio' ? batch : [],
      includeVideo: track === 'video',
      includeAudio: track === 'audio',
      resolution: params.request.settings.resolution,
      fps: params.request.settings.fps,
      durationPolicy: 'longest'
    })

    totalDur += batch.reduce((s, item) => s + getSegmentTimelineDuration(item), 0)

    const codecArgs =
      track === 'video'
        ? ['-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '16', '-pix_fmt', 'yuv420p']
        : ['-c:a', 'pcm_s16le']

    await renderSinglePlan({
      jobId: params.jobId,
      ffmpegPath: params.ffmpegPath,
      workDir: params.workDir,
      plan,
      codecAndContainerArgs: codecArgs,
      outputPath: chunkPath,
      phase: `Rendering ${track} batch ${b + 1}/${batches.length}...`,
      progressStart: params.progressStart + (b / batches.length) * params.progressSpan,
      progressSpan: params.progressSpan / batches.length,
      onProgress: params.onProgress
    })
  }

  const concatListPath = join(params.workDir, `${track}_concat.txt`)
  const concatBody = chunkFiles.map((f) => `file '${escapeConcatPath(f)}'`).join('\n')
  await writeFile(concatListPath, concatBody, 'utf-8')

  const mergedExt = track === 'video' ? 'mp4' : 'wav'
  const mergedPath = join(params.workDir, `${track}_merged.${mergedExt}`)
  await runFfmpegWithProgress({
    jobId: params.jobId,
    ffmpegPath: params.ffmpegPath,
    args: ['-f', 'concat', '-safe', '0', '-i', concatListPath, '-c', 'copy', mergedPath],
    expectedDurationSec: totalDur,
    phase: `Joining ${track} batches...`,
    progressWeightStart: params.progressStart + params.progressSpan * 0.95,
    progressWeightSpan: params.progressSpan * 0.05,
    onProgress: params.onProgress
  })

  const syntheticId = `merged_${track}_${randomUUID()}`
  const nextClips = new Map(params.clipsById)
  nextClips.set(syntheticId, {
    id: syntheticId,
    filePath: mergedPath,
    fileName: `merged_${track}.${mergedExt}`,
    fileSize: 0,
    duration: totalDur,
    width: 1920,
    height: 1080,
    fps: params.request.settings.fps,
    videoCodec: track === 'video' ? 'h264' : 'none',
    hasVideo: track === 'video',
    hasAudio: track === 'audio',
    audioCodec: track === 'audio' ? 'pcm_s16le' : null,
    thumbnailPath: null,
    waveformPeaks: []
  })

  const singleSeg: TimelineSegment = {
    id: `seg_${syntheticId}`,
    sourceClipId: syntheticId,
    label: `Merged ${track}`,
    track,
    linkGroupId: null,
    sourceIn: 0,
    sourceOut: totalDur,
    speed: 1,
    muted: false,
    volume: 1
  }

  return { clipsById: nextClips, segments: [singleSeg] }
}

export async function executeExportJob(
  request: ExportJobRequest,
  onProgress?: (event: ExportProgressEvent) => void
): Promise<ExportJobResult> {
  const { ffmpegPath } = getFfmpegBins()
  const { jobId, settings } = request
  const workDir = join(tmpdir(), `video-stitch-job-${jobId}`)

  await mkdir(workDir, { recursive: true })
  await mkdir(dirname(settings.outputPath), { recursive: true })

  activeProcesses.set(jobId, { proc: null as unknown as ChildProcess, canceled: false })

  try {
    let clipsMap = new Map<string, SourceClip>(request.clips.map((c) => [c.id, c]))
    let vSegs = [...request.videoSegments]
    let aSegs = [...request.audioSegments]

    const needsVideo = settings.mode !== 'audio-only'
    const needsAudio = settings.mode !== 'video-only'

    if (needsVideo && vSegs.length === 0) {
      throw new Error('Video track (V1) has no segments to export.')
    }
    if (settings.mode === 'audio-only' && aSegs.length === 0) {
      throw new Error('Audio track (A1) has no segments to export.')
    }

    const largeV = needsVideo && vSegs.length > CHUNK_SIZE
    const largeA = needsAudio && aSegs.length > CHUNK_SIZE
    let mainProgressStart = 0

    if (largeV) {
      const res = await preRenderLargeTrackIfNeeded({
        jobId,
        ffmpegPath,
        workDir,
        clipsById: clipsMap,
        segments: vSegs,
        track: 'video',
        request,
        progressStart: 0,
        progressSpan: largeA ? 0.35 : 0.6,
        onProgress
      })
      clipsMap = res.clipsById
      vSegs = res.segments
      mainProgressStart = largeA ? 0.35 : 0.6
    }

    if (largeA) {
      const res = await preRenderLargeTrackIfNeeded({
        jobId,
        ffmpegPath,
        workDir,
        clipsById: clipsMap,
        segments: aSegs,
        track: 'audio',
        request,
        progressStart: mainProgressStart,
        progressSpan: largeV ? 0.35 : 0.6,
        onProgress
      })
      clipsMap = res.clipsById
      aSegs = res.segments
      mainProgressStart = largeV ? 0.7 : 0.6
    }

    const remainingSpan = 1 - mainProgressStart
    const outputPaths: string[] = []

    if (settings.mode === 'combined') {
      const plan = buildStitchCommandPlan({
        clipsById: clipsMap,
        videoSegments: vSegs,
        audioSegments: aSegs,
        includeVideo: true,
        includeAudio: true,
        resolution: settings.resolution,
        fps: settings.fps,
        durationPolicy: settings.durationPolicy
      })

      await renderSinglePlan({
        jobId,
        ffmpegPath,
        workDir,
        plan,
        codecAndContainerArgs: [
          ...videoCodecArgs(),
          '-c:a',
          'aac',
          '-b:a',
          '192k',
          '-movflags',
          '+faststart'
        ],
        outputPath: settings.outputPath,
        phase: 'Stitching combined video & audio...',
        progressStart: mainProgressStart,
        progressSpan: remainingSpan,
        onProgress
      })
      outputPaths.push(settings.outputPath)
    } else if (settings.mode === 'video-only') {
      const plan = buildStitchCommandPlan({
        clipsById: clipsMap,
        videoSegments: vSegs,
        audioSegments: [],
        includeVideo: true,
        includeAudio: false,
        resolution: settings.resolution,
        fps: settings.fps,
        durationPolicy: 'video'
      })

      await renderSinglePlan({
        jobId,
        ffmpegPath,
        workDir,
        plan,
        codecAndContainerArgs: [...videoCodecArgs(), '-an', '-movflags', '+faststart'],
        outputPath: settings.outputPath,
        phase: 'Stitching video track (muted)...',
        progressStart: mainProgressStart,
        progressSpan: remainingSpan,
        onProgress
      })
      outputPaths.push(settings.outputPath)
    } else if (settings.mode === 'audio-only') {
      const plan = buildStitchCommandPlan({
        clipsById: clipsMap,
        videoSegments: [],
        audioSegments: aSegs,
        includeVideo: false,
        includeAudio: true,
        resolution: settings.resolution,
        fps: settings.fps,
        durationPolicy: 'longest'
      })

      await renderSinglePlan({
        jobId,
        ffmpegPath,
        workDir,
        plan,
        codecAndContainerArgs: ['-vn', ...audioCodecArgs(settings.audioFormat)],
        outputPath: settings.outputPath,
        phase: 'Stitching audio track...',
        progressStart: mainProgressStart,
        progressSpan: remainingSpan,
        onProgress
      })
      outputPaths.push(settings.outputPath)
    } else if (settings.mode === 'separate') {
      const ext = extname(settings.outputPath)
      const stem = ext ? settings.outputPath.slice(0, -ext.length) : settings.outputPath
      const videoOut = `${stem}_video.mp4`
      const audioOut = `${stem}_audio.${settings.audioFormat}`

      const vPlan = buildStitchCommandPlan({
        clipsById: clipsMap,
        videoSegments: vSegs,
        audioSegments: [],
        includeVideo: true,
        includeAudio: false,
        resolution: settings.resolution,
        fps: settings.fps,
        durationPolicy: 'video'
      })

      await renderSinglePlan({
        jobId,
        ffmpegPath,
        workDir,
        plan: vPlan,
        codecAndContainerArgs: [...videoCodecArgs(), '-an', '-movflags', '+faststart'],
        outputPath: videoOut,
        phase: 'Exporting separated video file...',
        progressStart: mainProgressStart,
        progressSpan: remainingSpan * (aSegs.length > 0 ? 0.7 : 1),
        onProgress
      })
      outputPaths.push(videoOut)

      if (aSegs.length > 0) {
        const aPlan = buildStitchCommandPlan({
          clipsById: clipsMap,
          videoSegments: [],
          audioSegments: aSegs,
          includeVideo: false,
          includeAudio: true,
          resolution: settings.resolution,
          fps: settings.fps,
          durationPolicy: 'longest'
        })

        await renderSinglePlan({
          jobId,
          ffmpegPath,
          workDir,
          plan: aPlan,
          codecAndContainerArgs: ['-vn', ...audioCodecArgs(settings.audioFormat)],
          outputPath: audioOut,
          phase: 'Exporting separated audio file...',
          progressStart: mainProgressStart + remainingSpan * 0.7,
          progressSpan: remainingSpan * 0.3,
          onProgress
        })
        outputPaths.push(audioOut)
      }
    }

    onProgress?.({
      jobId,
      percent: 100,
      currentTimeSec: 0,
      totalDurationSec: 0,
      phase: 'Complete'
    })

    return {
      success: true,
      outputPaths
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg === 'EXPORT_CANCELED') {
      return {
        success: false,
        canceled: true,
        outputPaths: []
      }
    }
    return {
      success: false,
      outputPaths: [],
      error: msg
    }
  } finally {
    activeProcesses.delete(jobId)
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined)
  }
}

export function cancelExportJob(jobId: string): boolean {
  const entry = activeProcesses.get(jobId)
  if (!entry) return false
  entry.canceled = true
  if (entry.proc && !entry.proc.killed) {
    entry.proc.kill('SIGKILL')
  }
  return true
}
