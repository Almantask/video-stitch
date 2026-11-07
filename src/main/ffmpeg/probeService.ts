import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { sortByFileName } from '../../shared/sorting'
import type { ProbeBatchResult, SourceClip } from '../../shared/types'
import { getFfmpegBins } from './locator'

const CACHE_DIR = join(tmpdir(), 'video-stitch-cache-v1')
const PEAK_BUCKETS = 180
const SAMPLE_RATE = 1000

interface FfprobeStream {
  codec_type?: string
  codec_name?: string
  width?: number
  height?: number
  avg_frame_rate?: string
  r_frame_rate?: string
  duration?: string
  tags?: Record<string, string>
  side_data_list?: Array<{ rotation?: number }>
}

interface FfprobeOutput {
  streams?: FfprobeStream[]
  format?: {
    duration?: string
    size?: string
  }
}

function parseFrameRate(rateStr?: string): number {
  if (!rateStr) return 30
  const parts = rateStr.split('/')
  if (parts.length === 2) {
    const num = Number(parts[0])
    const den = Number(parts[1])
    if (den > 0 && Number.isFinite(num / den) && num / den > 0) {
      return Math.round((num / den) * 100) / 100
    }
  }
  const parsed = Number(rateStr)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 30
}

function runProcessCapture(bin: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args, { windowsHide: true })
    let stdout = ''
    let stderr = ''
    proc.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
    })
    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })
    proc.on('error', reject)
    proc.on('close', (code) => {
      if (code === 0) resolve(stdout)
      else reject(new Error(stderr.trim() || `Process exited with code ${code}`))
    })
  })
}

async function generateThumbnail(
  ffmpegPath: string,
  filePath: string,
  duration: number,
  cacheKey: string
): Promise<string | null> {
  await mkdir(CACHE_DIR, { recursive: true })
  const thumbPath = join(CACHE_DIR, `${cacheKey}.jpg`)
  if (existsSync(thumbPath)) return thumbPath

  const seekSec = duration > 1 ? Math.min(1.5, duration * 0.15) : 0
  try {
    await runProcessCapture(ffmpegPath, [
      '-y',
      '-ss',
      seekSec.toFixed(2),
      '-i',
      filePath,
      '-frames:v',
      '1',
      '-vf',
      'scale=320:-2',
      '-q:v',
      '4',
      thumbPath
    ])
    return existsSync(thumbPath) ? thumbPath : null
  } catch {
    return null
  }
}

async function extractWaveformPeaks(
  ffmpegPath: string,
  filePath: string,
  duration: number,
  cacheKey: string
): Promise<number[]> {
  await mkdir(CACHE_DIR, { recursive: true })
  const peaksCachePath = join(CACHE_DIR, `${cacheKey}.peaks.json`)
  if (existsSync(peaksCachePath)) {
    try {
      const cached = JSON.parse(await readFile(peaksCachePath, 'utf-8'))
      if (Array.isArray(cached) && cached.length > 0) return cached
    } catch {
      // regenerate
    }
  }

  const totalExpectedSamples = Math.max(PEAK_BUCKETS, Math.ceil(duration * SAMPLE_RATE))
  const samplesPerBucket = Math.max(1, Math.ceil(totalExpectedSamples / PEAK_BUCKETS))
  const buckets = new Float32Array(PEAK_BUCKETS)

  return new Promise((resolve) => {
    const proc = spawn(
      ffmpegPath,
      [
        '-v',
        'error',
        '-i',
        filePath,
        '-vn',
        '-ac',
        '1',
        '-ar',
        String(SAMPLE_RATE),
        '-f',
        's16le',
        'pipe:1'
      ],
      { windowsHide: true }
    )

    let sampleIndex = 0
    let leftover: Buffer | null = null

    proc.stdout.on('data', (chunk: Buffer) => {
      const buf = leftover ? Buffer.concat([leftover, chunk]) : chunk
      const usableBytes = buf.length - (buf.length % 2)
      leftover = usableBytes < buf.length ? buf.subarray(usableBytes) : null

      for (let offset = 0; offset < usableBytes; offset += 2) {
        const val = Math.abs(buf.readInt16LE(offset)) / 32768
        const bucketIdx = Math.min(PEAK_BUCKETS - 1, Math.floor(sampleIndex / samplesPerBucket))
        if (val > buckets[bucketIdx]) {
          buckets[bucketIdx] = val
        }
        sampleIndex++
      }
    })

    proc.on('error', () => {
      resolve(new Array(PEAK_BUCKETS).fill(0.15))
    })

    proc.on('close', async () => {
      let maxPeak = 0
      for (let i = 0; i < buckets.length; i++) {
        if (buckets[i] > maxPeak) maxPeak = buckets[i]
      }
      const normFactor = maxPeak > 0.01 ? 1 / maxPeak : 1
      const normalized = Array.from(buckets, (v) =>
        Math.min(1, Math.max(0.04, Math.round(v * normFactor * 1000) / 1000))
      )
      try {
        await writeFile(peaksCachePath, JSON.stringify(normalized), 'utf-8')
      } catch {
        // ignore cache write errors
      }
      resolve(normalized)
    })
  })
}

export async function probeSingleFile(filePath: string): Promise<SourceClip> {
  const { ffmpegPath, ffprobePath } = getFfmpegBins()
  const fileStat = await stat(filePath)
  const rawJson = await runProcessCapture(ffprobePath, [
    '-v',
    'quiet',
    '-print_format',
    'json',
    '-show_format',
    '-show_streams',
    filePath
  ])

  const parsed = JSON.parse(rawJson) as FfprobeOutput
  const streams = parsed.streams ?? []
  const videoStream = streams.find((s) => s.codec_type === 'video')
  const audioStream = streams.find((s) => s.codec_type === 'audio')

  if (!videoStream && !audioStream) {
    throw new Error('No decodable video or audio streams found.')
  }

  const formatDuration = Number(parsed.format?.duration ?? 0)
  const streamDuration = Number(videoStream?.duration ?? audioStream?.duration ?? 0)
  const duration = Math.max(0.1, formatDuration || streamDuration || 0.1)

  let width = videoStream?.width ?? 0
  let height = videoStream?.height ?? 0
  const rotation =
    videoStream?.side_data_list?.find((d) => typeof d.rotation === 'number')?.rotation ??
    Number(videoStream?.tags?.rotate ?? 0)
  if (Math.abs(rotation) === 90 || Math.abs(rotation) === 270) {
    ;[width, height] = [height, width]
  }

  const fps = parseFrameRate(videoStream?.avg_frame_rate || videoStream?.r_frame_rate)
  const hasVideo = Boolean(videoStream)
  const hasAudio = Boolean(audioStream)

  const cacheKey = createHash('sha1')
    .update(`${filePath}|${fileStat.size}|${fileStat.mtimeMs}`)
    .digest('hex')

  const [thumbnailPath, waveformPeaks] = await Promise.all([
    hasVideo ? generateThumbnail(ffmpegPath, filePath, duration, cacheKey) : Promise.resolve(null),
    hasAudio ? extractWaveformPeaks(ffmpegPath, filePath, duration, cacheKey) : Promise.resolve([])
  ])

  return {
    id: randomUUID(),
    filePath,
    fileName: basename(filePath),
    fileSize: fileStat.size,
    duration: Math.round(duration * 1000) / 1000,
    width,
    height,
    fps,
    videoCodec: videoStream?.codec_name ?? 'none',
    hasVideo,
    hasAudio,
    audioCodec: audioStream?.codec_name ?? null,
    thumbnailPath,
    waveformPeaks
  }
}

export async function probeFilesBatch(filePaths: string[]): Promise<ProbeBatchResult> {
  const uniquePaths = Array.from(new Set(filePaths.filter(Boolean)))
  const clips: SourceClip[] = []
  const errors: Array<{ filePath: string; message: string }> = []

  const concurrency = 4
  let cursor = 0

  async function worker(): Promise<void> {
    while (cursor < uniquePaths.length) {
      const idx = cursor++
      const target = uniquePaths[idx]
      try {
        const clip = await probeSingleFile(target)
        clips.push(clip)
      } catch (err) {
        errors.push({
          filePath: target,
          message: err instanceof Error ? err.message : String(err)
        })
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, uniquePaths.length) }, () => worker()))

  return {
    clips: sortByFileName(clips, 'asc'),
    errors
  }
}
