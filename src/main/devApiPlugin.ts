import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, stat } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { basename, extname, join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import type { Plugin } from 'vite'
import type { ExportJobRequest, ExportProgressEvent } from '../shared/types'
import { cancelExportJob, executeExportJob } from './ffmpeg/exportService'
import { checkFfmpegHealth } from './ffmpeg/locator'
import { probeFilesBatch } from './ffmpeg/probeService'

const MIME_MAP: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp'
}

const STAGING_DIR = join(tmpdir(), 'video-stitch-browser-staged')
const EXPORT_OUT_DIR = join(tmpdir(), 'video-stitch-browser-exports')
const latestProgressByJob = new Map<string, ExportProgressEvent>()

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  })
  res.end(payload)
}

function readJsonBody<T>(req: IncomingMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    let raw = ''
    req.on('data', (chunk) => {
      raw += chunk.toString()
    })
    req.on('error', reject)
    req.on('end', () => {
      try {
        resolve(JSON.parse(raw || '{}') as T)
      } catch (err) {
        reject(err)
      }
    })
  })
}

async function serveMediaRange(
  req: IncomingMessage,
  res: ServerResponse,
  filePath: string,
  asAttachment = false
): Promise<void> {
  try {
    const fileStat = await stat(filePath)
    const totalSize = fileStat.size
    const ext = extname(filePath).toLowerCase()
    const contentType = MIME_MAP[ext] ?? 'application/octet-stream'
    const dispositionHeaders: Record<string, string> = asAttachment
      ? {
          'Content-Disposition': `attachment; filename="${encodeURIComponent(basename(filePath))}"`
        }
      : {}

    const rangeHeader = req.headers.range
    if (rangeHeader && !asAttachment) {
      const match = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader.trim())
      if (!match) {
        res.writeHead(416, { 'Content-Range': `bytes */${totalSize}` })
        res.end()
        return
      }
      const start = match[1] ? Number.parseInt(match[1], 10) : 0
      const end = match[2] ? Math.min(Number.parseInt(match[2], 10), totalSize - 1) : totalSize - 1
      if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= totalSize) {
        res.writeHead(416, { 'Content-Range': `bytes */${totalSize}` })
        res.end()
        return
      }
      const chunkLen = end - start + 1
      res.writeHead(206, {
        'Content-Type': contentType,
        'Content-Length': String(chunkLen),
        'Content-Range': `bytes ${start}-${end}/${totalSize}`,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-cache'
      })
      const stream = createReadStream(filePath, { start, end })
      req.on('close', () => stream.destroy())
      stream.pipe(res)
      return
    }

    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': String(totalSize),
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-cache',
      ...dispositionHeaders
    })
    const stream = createReadStream(filePath)
    req.on('close', () => stream.destroy())
    stream.pipe(res)
  } catch {
    res.writeHead(404)
    res.end('File not found')
  }
}

function revealInExplorer(filePath: string): void {
  if (process.platform === 'win32') {
    spawn('explorer.exe', [`/select,${filePath}`], { detached: true, stdio: 'ignore' }).unref()
  }
}

export function videoStitchDevApiPlugin(): Plugin {
  return {
    name: 'video-stitch-dev-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url || !req.url.startsWith('/api/')) {
          next()
          return
        }

        try {
          const url = new URL(req.url, 'http://localhost')

          if (req.method === 'GET' && url.pathname === '/api/health') {
            const health = await checkFfmpegHealth()
            sendJson(res, 200, health)
            return
          }

          if (req.method === 'GET' && url.pathname === '/api/media') {
            const fp = url.searchParams.get('path')
            if (!fp) {
              sendJson(res, 400, { error: 'Missing path' })
              return
            }
            await serveMediaRange(req, res, fp, false)
            return
          }

          if (req.method === 'GET' && url.pathname === '/api/download') {
            const fp = url.searchParams.get('path')
            if (!fp) {
              sendJson(res, 400, { error: 'Missing path' })
              return
            }
            await serveMediaRange(req, res, fp, true)
            return
          }

          if (req.method === 'POST' && url.pathname === '/api/stage-file') {
            const rawName = url.searchParams.get('name') || `clip_${Date.now()}.mp4`
            const safeBase = basename(rawName).replace(/[<>:"/\\|?*]/g, '_')
            const batchFolder = join(STAGING_DIR, randomUUID().slice(0, 8))
            await mkdir(batchFolder, { recursive: true })
            const targetPath = join(batchFolder, safeBase)
            await pipeline(req, createWriteStream(targetPath))
            sendJson(res, 200, { filePath: targetPath })
            return
          }

          if (req.method === 'POST' && url.pathname === '/api/probe') {
            const body = await readJsonBody<{ filePaths?: string[] }>(req)
            const result = await probeFilesBatch(body.filePaths ?? [])
            sendJson(res, 200, result)
            return
          }

          if (req.method === 'POST' && url.pathname === '/api/prepare-export-path') {
            const body = await readJsonBody<{ defaultName?: string }>(req)
            await mkdir(EXPORT_OUT_DIR, { recursive: true })
            const safeName = basename(body.defaultName || 'stitched_output.mp4').replace(
              /[<>:"/\\|?*]/g,
              '_'
            )
            const stamped = `${Date.now()}_${safeName}`
            sendJson(res, 200, { outputPath: join(EXPORT_OUT_DIR, stamped) })
            return
          }

          if (req.method === 'GET' && url.pathname === '/api/export-progress') {
            const jobId = url.searchParams.get('jobId') ?? ''
            sendJson(res, 200, { progress: latestProgressByJob.get(jobId) ?? null })
            return
          }

          if (req.method === 'POST' && url.pathname === '/api/export') {
            const request = await readJsonBody<ExportJobRequest>(req)
            const result = await executeExportJob(request, (ev) => {
              latestProgressByJob.set(request.jobId, ev)
            })
            setTimeout(() => latestProgressByJob.delete(request.jobId), 30000)
            sendJson(res, 200, result)
            return
          }

          if (req.method === 'POST' && url.pathname === '/api/export-cancel') {
            const body = await readJsonBody<{ jobId: string }>(req)
            const ok = cancelExportJob(body.jobId)
            sendJson(res, 200, { canceled: ok })
            return
          }

          if (req.method === 'POST' && url.pathname === '/api/reveal') {
            const body = await readJsonBody<{ filePath: string }>(req)
            if (body.filePath) revealInExplorer(body.filePath)
            sendJson(res, 200, { ok: true })
            return
          }

          sendJson(res, 404, { error: 'Unknown API route' })
        } catch (err) {
          sendJson(res, 500, {
            error: err instanceof Error ? err.message : String(err)
          })
        }
      })
    }
  }
}
