import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import type { FfmpegHealth } from '../../shared/types'

let cachedFfmpegPath: string | null = null
let cachedFfprobePath: string | null = null

const COMMON_WIN_DIRS = [
  'C:\\ProgramData\\chocolatey\\bin',
  'C:\\ffmpeg\\bin',
  `${process.env.LOCALAPPDATA ?? ''}\\Microsoft\\WinGet\\Links`
]

function resolveBinary(name: 'ffmpeg' | 'ffprobe'): string | null {
  const envKey = name === 'ffmpeg' ? process.env.FFMPEG_PATH : process.env.FFPROBE_PATH
  if (envKey && existsSync(envKey)) {
    return envKey
  }

  const direct = spawnSync(name, ['-version'], {
    encoding: 'utf-8',
    windowsHide: true,
    timeout: 5000
  })
  if (direct.status === 0) {
    return name
  }

  if (process.platform === 'win32') {
    for (const dir of COMMON_WIN_DIRS) {
      if (!dir) continue
      const candidate = `${dir}\\${name}.exe`
      if (existsSync(candidate)) {
        const check = spawnSync(candidate, ['-version'], {
          encoding: 'utf-8',
          windowsHide: true,
          timeout: 5000
        })
        if (check.status === 0) return candidate
      }
    }
  }

  return null
}

export function getFfmpegBins(): { ffmpegPath: string; ffprobePath: string } {
  if (!cachedFfmpegPath) cachedFfmpegPath = resolveBinary('ffmpeg')
  if (!cachedFfprobePath) cachedFfprobePath = resolveBinary('ffprobe')

  if (!cachedFfmpegPath || !cachedFfprobePath) {
    throw new Error(
      'FFmpeg / FFprobe was not found on your system PATH. Please install FFmpeg and restart Video Stitch.'
    )
  }

  return {
    ffmpegPath: cachedFfmpegPath,
    ffprobePath: cachedFfprobePath
  }
}

export async function checkFfmpegHealth(): Promise<FfmpegHealth> {
  try {
    const { ffmpegPath, ffprobePath } = getFfmpegBins()
    const res = spawnSync(ffmpegPath, ['-version'], {
      encoding: 'utf-8',
      windowsHide: true,
      timeout: 5000
    })
    const firstLine = res.stdout?.split(/\r?\n/)[0]?.trim() ?? null
    return {
      available: res.status === 0,
      ffmpegPath,
      ffprobePath,
      version: firstLine
    }
  } catch (err) {
    return {
      available: false,
      ffmpegPath: cachedFfmpegPath,
      ffprobePath: cachedFfprobePath,
      version: null,
      error: err instanceof Error ? err.message : String(err)
    }
  }
}
