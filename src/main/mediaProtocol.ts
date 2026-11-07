import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { extname } from 'node:path'
import { Readable } from 'node:stream'
import { protocol } from 'electron'

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

function getMimeType(filePath: string): string {
  const ext = extname(filePath).toLowerCase()
  return MIME_MAP[ext] ?? 'application/octet-stream'
}

export function registerMediaSchemePrivileges(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'media',
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        bypassCSP: true
      }
    }
  ])
}

export function registerMediaProtocolHandler(): void {
  protocol.handle('media', async (request) => {
    try {
      const parsed = new URL(request.url)
      const filePath = parsed.searchParams.get('path')
      if (!filePath) {
        return new Response('Missing path parameter', { status: 400 })
      }

      const fileStat = await stat(filePath)
      const totalSize = fileStat.size
      const contentType = getMimeType(filePath)
      const rangeHeader = request.headers.get('range')

      if (rangeHeader) {
        const match = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader.trim())
        if (!match) {
          return new Response('Invalid Range header', {
            status: 416,
            headers: { 'Content-Range': `bytes */${totalSize}` }
          })
        }

        const start = match[1] ? Number.parseInt(match[1], 10) : 0
        const end = match[2] ? Math.min(Number.parseInt(match[2], 10), totalSize - 1) : totalSize - 1

        if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= totalSize) {
          return new Response('Range Not Satisfiable', {
            status: 416,
            headers: { 'Content-Range': `bytes */${totalSize}` }
          })
        }

        const chunkLength = end - start + 1
        const nodeStream = createReadStream(filePath, { start, end })
        request.signal.addEventListener('abort', () => {
          nodeStream.destroy()
        })

        return new Response(Readable.toWeb(nodeStream) as ReadableStream, {
          status: 206,
          headers: {
            'Content-Type': contentType,
            'Content-Length': String(chunkLength),
            'Content-Range': `bytes ${start}-${end}/${totalSize}`,
            'Accept-Ranges': 'bytes',
            'Cache-Control': 'no-cache'
          }
        })
      }

      const fullStream = createReadStream(filePath)
      request.signal.addEventListener('abort', () => {
        fullStream.destroy()
      })

      return new Response(Readable.toWeb(fullStream) as ReadableStream, {
        status: 200,
        headers: {
          'Content-Type': contentType,
          'Content-Length': String(totalSize),
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'no-cache'
        }
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to read media file'
      return new Response(msg, { status: 404 })
    }
  })
}
