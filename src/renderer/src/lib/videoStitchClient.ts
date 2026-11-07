import type {
  AudioExportFormat,
  ExportJobRequest,
  ExportJobResult,
  ExportMode,
  ExportProgressEvent,
  FfmpegHealth,
  ProbeBatchResult,
  VideoStitchAPI
} from '@shared/types'

export function isElectronContext(): boolean {
  return typeof window !== 'undefined' && typeof window.videoStitch !== 'undefined'
}

const progressListeners = new Set<(ev: ExportProgressEvent) => void>()

function pickBrowserFiles(accept: string): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.multiple = true
    input.accept = accept
    input.style.display = 'none'
    document.body.appendChild(input)

    let settled = false
    const finish = (files: File[]): void => {
      if (settled) return
      settled = true
      input.remove()
      resolve(files)
    }

    input.addEventListener('change', () => {
      finish(input.files ? Array.from(input.files) : [])
    })
    input.addEventListener('cancel', () => {
      finish([])
    })

    input.click()
  })
}

export async function stageBrowserFiles(files: readonly File[]): Promise<string[]> {
  if (files.length === 0) return []

  if (isElectronContext()) {
    return files
      .map((f) => window.videoStitch.getPathForFile(f))
      .filter((p): p is string => Boolean(p))
  }

  const stagedPaths: string[] = []
  for (const file of files) {
    const res = await fetch(`/api/stage-file?name=${encodeURIComponent(file.name)}`, {
      method: 'POST',
      body: file
    })
    if (!res.ok) {
      throw new Error(`Failed to stage file ${file.name}`)
    }
    const data = (await res.json()) as { filePath: string }
    if (data.filePath) stagedPaths.push(data.filePath)
  }
  return stagedPaths
}

function triggerBrowserDownload(filePath: string): void {
  const a = document.createElement('a')
  a.href = `/api/download?path=${encodeURIComponent(filePath)}`
  const parts = filePath.replace(/\\/g, '/').split('/')
  a.download = parts[parts.length - 1] || 'stitched_output.mp4'
  document.body.appendChild(a)
  a.click()
  a.remove()
}

const browserFallbackApi: VideoStitchAPI = {
  checkHealth: async (): Promise<FfmpegHealth> => {
    const res = await fetch('/api/health')
    if (!res.ok) {
      return {
        available: false,
        ffmpegPath: null,
        ffprobePath: null,
        version: null,
        error: 'Local dev server API unavailable'
      }
    }
    return (await res.json()) as FfmpegHealth
  },

  selectVideoFiles: async (): Promise<string[]> => {
    const files = await pickBrowserFiles('.mp4,.mov,.mkv,.webm,.avi,.m4v,video/*')
    return stageBrowserFiles(files)
  },

  selectAudioFiles: async (): Promise<string[]> => {
    const files = await pickBrowserFiles('.mp3,.wav,.m4a,.aac,.ogg,.mp4,.mov,audio/*,video/*')
    return stageBrowserFiles(files)
  },

  getPathForFile: (_file: File): string => {
    return ''
  },

  probeFiles: async (filePaths: string[]): Promise<ProbeBatchResult> => {
    const res = await fetch('/api/probe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filePaths })
    })
    if (!res.ok) {
      throw new Error('Failed to probe media files')
    }
    return (await res.json()) as ProbeBatchResult
  },

  chooseExportPath: async (
    defaultName: string,
    _mode: ExportMode,
    _audioFormat: AudioExportFormat
  ): Promise<string | null> => {
    const res = await fetch('/api/prepare-export-path', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ defaultName })
    })
    if (!res.ok) return null
    const data = (await res.json()) as { outputPath: string }
    return data.outputPath ?? null
  },

  startExport: async (request: ExportJobRequest): Promise<ExportJobResult> => {
    const pollTimer = window.setInterval(async () => {
      try {
        const r = await fetch(`/api/export-progress?jobId=${encodeURIComponent(request.jobId)}`)
        if (r.ok) {
          const data = (await r.json()) as { progress: ExportProgressEvent | null }
          if (data.progress) {
            progressListeners.forEach((cb) => cb(data.progress!))
          }
        }
      } catch {
        // ignore transient poll error
      }
    }, 350)

    try {
      const res = await fetch('/api/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request)
      })
      const result = (await res.json()) as ExportJobResult
      if (result.success) {
        for (const outPath of result.outputPaths) {
          triggerBrowserDownload(outPath)
        }
      }
      return result
    } finally {
      window.clearInterval(pollTimer)
    }
  },

  cancelExport: async (jobId: string): Promise<boolean> => {
    const res = await fetch('/api/export-cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobId })
    })
    if (!res.ok) return false
    const data = (await res.json()) as { canceled: boolean }
    return Boolean(data.canceled)
  },

  onExportProgress: (callback: (ev: ExportProgressEvent) => void) => {
    progressListeners.add(callback)
    return () => {
      progressListeners.delete(callback)
    }
  },

  showItemInFolder: async (filePath: string): Promise<void> => {
    await fetch('/api/reveal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filePath })
    })
  },

  toMediaUrl: (filePath: string): string => {
    return `/api/media?path=${encodeURIComponent(filePath)}`
  }
}

export const videoStitchClient: VideoStitchAPI = new Proxy({} as VideoStitchAPI, {
  get(_target, prop: keyof VideoStitchAPI) {
    if (isElectronContext()) {
      const fn = window.videoStitch[prop]
      return typeof fn === 'function' ? fn.bind(window.videoStitch) : fn
    }
    const fallback = browserFallbackApi[prop]
    return typeof fallback === 'function' ? fallback.bind(browserFallbackApi) : fallback
  }
})
