import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import type {
  AudioExportFormat,
  ExportJobRequest,
  ExportMode
} from '@shared/types'
import { cancelExportJob, executeExportJob } from './ffmpeg/exportService'
import { checkFfmpegHealth } from './ffmpeg/locator'
import { probeFilesBatch } from './ffmpeg/probeService'
import {
  registerMediaProtocolHandler,
  registerMediaSchemePrivileges
} from './mediaProtocol'

registerMediaSchemePrivileges()

if (process.argv.includes('--version')) {
  console.log(`Video Stitch v${app.getVersion()}`)
  app.exit(0)
}

const isSmokeTest = process.argv.includes('--smoke-test')

let mainWindow: BrowserWindow | null = null

function resolvePreloadPath(): string {
  const mjsPath = join(__dirname, '../preload/index.mjs')
  if (existsSync(mjsPath)) return mjsPath
  return join(__dirname, '../preload/index.js')
}

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1080,
    minHeight: 700,
    show: false,
    backgroundColor: '#09090b',
    title: 'Video Stitch',
    autoHideMenuBar: true,
    webPreferences: {
      preload: resolvePreloadPath(),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  win.on('ready-to-show', () => {
    if (!isSmokeTest) {
      win.show()
      win.focus()
    }
  })

  win.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

function registerIpcHandlers(): void {
  ipcMain.handle('ffmpeg:health', async () => {
    return checkFfmpegHealth()
  })

  ipcMain.handle('dialog:selectVideos', async () => {
    const res = await dialog.showOpenDialog(mainWindow ?? undefined!, {
      title: 'Select Videos to Stitch',
      properties: ['openFile', 'multiSelections'],
      filters: [
        {
          name: 'Video Files',
          extensions: ['mp4', 'mov', 'mkv', 'webm', 'avi', 'm4v']
        },
        { name: 'All Files', extensions: ['*'] }
      ]
    })
    return res.canceled ? [] : res.filePaths
  })

  ipcMain.handle('dialog:selectAudio', async () => {
    const res = await dialog.showOpenDialog(mainWindow ?? undefined!, {
      title: 'Select Audio Files',
      properties: ['openFile', 'multiSelections'],
      filters: [
        {
          name: 'Audio & Video Files',
          extensions: ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'mp4', 'mov', 'mkv', 'webm']
        }
      ]
    })
    return res.canceled ? [] : res.filePaths
  })

  ipcMain.handle('media:probeFiles', async (_event, filePaths: string[]) => {
    return probeFilesBatch(filePaths)
  })

  ipcMain.handle(
    'dialog:chooseExportPath',
    async (
      _event,
      defaultName: string,
      mode: ExportMode,
      audioFormat: AudioExportFormat
    ): Promise<string | null> => {
      const filters =
        mode === 'audio-only'
          ? [{ name: `${audioFormat.toUpperCase()} Audio`, extensions: [audioFormat] }]
          : [{ name: 'MP4 Video', extensions: ['mp4'] }]

      const res = await dialog.showSaveDialog(mainWindow ?? undefined!, {
        title:
          mode === 'separate'
            ? 'Choose Base Filename for Separated Video & Audio'
            : 'Export Stitched Output',
        defaultPath: defaultName,
        filters
      })
      return res.canceled || !res.filePath ? null : res.filePath
    }
  )

  ipcMain.handle('export:start', async (event, request: ExportJobRequest) => {
    return executeExportJob(request, (progress) => {
      if (!event.sender.isDestroyed()) {
        event.sender.send('export:progress', progress)
      }
    })
  })

  ipcMain.handle('export:cancel', async (_event, jobId: string) => {
    return cancelExportJob(jobId)
  })

  ipcMain.handle('shell:showItemInFolder', async (_event, filePath: string) => {
    shell.showItemInFolder(filePath)
  })
}

app.whenReady().then(async () => {
  registerMediaProtocolHandler()
  registerIpcHandlers()
  mainWindow = createMainWindow()

  if (isSmokeTest) {
    const health = await checkFfmpegHealth()
    mainWindow.webContents.once('did-finish-load', () => {
      console.log(
        JSON.stringify({
          smokeTest: 'ok',
          ffmpegAvailable: health.available,
          ffmpegVersion: health.version
        })
      )
      app.exit(health.available ? 0 : 1)
    })
    setTimeout(() => {
      console.error('Smoke test timed out waiting for renderer load')
      app.exit(2)
    }, 15000)
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createMainWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
