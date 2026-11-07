import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type {
  AudioExportFormat,
  ExportJobRequest,
  ExportMode,
  ExportProgressEvent,
  VideoStitchAPI
} from '@shared/types'

const api: VideoStitchAPI = {
  checkHealth: () => ipcRenderer.invoke('ffmpeg:health'),
  selectVideoFiles: () => ipcRenderer.invoke('dialog:selectVideos'),
  selectAudioFiles: () => ipcRenderer.invoke('dialog:selectAudio'),
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
  probeFiles: (filePaths: string[]) => ipcRenderer.invoke('media:probeFiles', filePaths),
  chooseExportPath: (defaultName: string, mode: ExportMode, audioFormat: AudioExportFormat) =>
    ipcRenderer.invoke('dialog:chooseExportPath', defaultName, mode, audioFormat),
  startExport: (request: ExportJobRequest) => ipcRenderer.invoke('export:start', request),
  cancelExport: (jobId: string) => ipcRenderer.invoke('export:cancel', jobId),
  onExportProgress: (callback: (event: ExportProgressEvent) => void) => {
    const listener = (_ev: Electron.IpcRendererEvent, payload: ExportProgressEvent): void => {
      callback(payload)
    }
    ipcRenderer.on('export:progress', listener)
    return () => {
      ipcRenderer.removeListener('export:progress', listener)
    }
  },
  showItemInFolder: (filePath: string) => ipcRenderer.invoke('shell:showItemInFolder', filePath),
  toMediaUrl: (filePath: string) => `media://local/media?path=${encodeURIComponent(filePath)}`
}

contextBridge.exposeInMainWorld('videoStitch', api)
