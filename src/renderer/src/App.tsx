import React, { useCallback, useEffect, useState } from 'react'
import { UploadCloud } from 'lucide-react'
import { stageBrowserFiles, videoStitchClient } from './lib/videoStitchClient'
import { useProjectStore } from './store/useProjectStore'
import { ExportModal } from './components/ExportModal'
import { HeaderBar } from './components/HeaderBar'
import { InspectorPanel } from './components/InspectorPanel'
import { PreviewMonitor } from './components/PreviewMonitor'
import { SequenceBin } from './components/SequenceBin'
import { TimelineToolbar } from './components/TimelineToolbar'
import { TimelineView } from './components/TimelineView'

export const App: React.FC = () => {
  const [isDraggingFiles, setIsDraggingFiles] = useState(false)

  const setFfmpegHealth = useProjectStore((s) => s.setFfmpegHealth)
  const setIsImporting = useProjectStore((s) => s.setIsImporting)
  const addImportedVideoClips = useProjectStore((s) => s.addImportedVideoClips)
  const addStandaloneAudioClips = useProjectStore((s) => s.addStandaloneAudioClips)
  const toast = useProjectStore((s) => s.toast)
  const setToast = useProjectStore((s) => s.setToast)

  // Check FFmpeg health on launch
  useEffect(() => {
    videoStitchClient.checkHealth().then(setFfmpegHealth).catch(() => undefined)
  }, [setFfmpegHealth])

  // Auto-dismiss toast notifications
  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 4000)
    return () => clearTimeout(timer)
  }, [toast, setToast])

  const ingestPaths = useCallback(
    async (filePaths: string[], mode: 'video' | 'audio') => {
      if (filePaths.length === 0) return
      setIsImporting(true)
      try {
        const result = await videoStitchClient.probeFiles(filePaths)
        if (result.clips.length > 0) {
          if (mode === 'audio') {
            addStandaloneAudioClips(result.clips)
          } else {
            addImportedVideoClips(result.clips)
          }
        }
        if (result.errors.length > 0) {
          setToast({
            type: 'error',
            text: `Skipped ${result.errors.length} unsupported file(s): ${result.errors[0].message}`
          })
        }
      } catch (err) {
        setToast({
          type: 'error',
          text: err instanceof Error ? err.message : 'Failed to import media files.'
        })
      } finally {
        setIsImporting(false)
      }
    },
    [addImportedVideoClips, addStandaloneAudioClips, setIsImporting, setToast]
  )

  const handleImportVideos = useCallback(async () => {
    setIsImporting(true)
    try {
      const paths = await videoStitchClient.selectVideoFiles()
      await ingestPaths(paths, 'video')
    } finally {
      setIsImporting(false)
    }
  }, [ingestPaths, setIsImporting])

  const handleImportAudio = useCallback(async () => {
    setIsImporting(true)
    try {
      const paths = await videoStitchClient.selectAudioFiles()
      await ingestPaths(paths, 'audio')
    } finally {
      setIsImporting(false)
    }
  }, [ingestPaths, setIsImporting])

  // Global NLE keyboard shortcuts
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement | null
      const inInput =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)

      if (inInput) return

      const state = useProjectStore.getState()
      if (state.exportModalOpen) return

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) {
          useProjectStore.temporal.getState().redo()
        } else {
          useProjectStore.temporal.getState().undo()
        }
        return
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        useProjectStore.temporal.getState().redo()
        return
      }

      if (e.code === 'Space') {
        e.preventDefault()
        state.togglePlayPause()
        return
      }

      if (e.key.toLowerCase() === 's' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault()
        state.splitAtPlayhead('selected')
        return
      }

      if (e.key.toLowerCase() === 'l' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault()
        state.setLinkEnabled(!state.linkEnabled)
        return
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (state.selectedSegmentId) {
          e.preventDefault()
          state.deleteSegment(state.selectedSegmentId)
        }
        return
      }

      if (e.altKey && e.key === 'ArrowLeft') {
        e.preventDefault()
        state.moveSelectedSegment(-1)
        return
      }

      if (e.altKey && e.key === 'ArrowRight') {
        e.preventDefault()
        state.moveSelectedSegment(1)
        return
      }

      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        state.setIsPlaying(false)
        state.setPlayheadSec(Math.max(0, state.playheadSec - (e.shiftKey ? 1 : 0.1)))
        return
      }

      if (e.key === 'ArrowRight') {
        e.preventDefault()
        state.setIsPlaying(false)
        state.setPlayheadSec(state.playheadSec + (e.shiftKey ? 1 : 0.1))
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const handleDrop = async (e: React.DragEvent): Promise<void> => {
    e.preventDefault()
    setIsDraggingFiles(false)

    const files = Array.from(e.dataTransfer.files)
    if (files.length === 0) return

    setIsImporting(true)
    try {
      const paths = await stageBrowserFiles(files)
      await ingestPaths(paths, 'video')
    } catch (err) {
      setToast({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to import dropped files.'
      })
    } finally {
      setIsImporting(false)
    }
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault()
        if (e.dataTransfer.types.includes('Files')) {
          setIsDraggingFiles(true)
        }
      }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node)) return
        setIsDraggingFiles(false)
      }}
      onDrop={handleDrop}
      className="h-screen w-screen flex flex-col bg-zinc-950 text-zinc-100 overflow-hidden relative"
    >
      <HeaderBar onImportVideos={handleImportVideos} onImportAudio={handleImportAudio} />

      {/* Main Workspace: Sequence Bin | Live Preview | Inspector */}
      <div className="flex-1 min-h-0 flex">
        <SequenceBin onImportVideos={handleImportVideos} />
        <PreviewMonitor />
        <InspectorPanel />
      </div>

      {/* Bottom Dual-Track Timeline */}
      <TimelineToolbar />
      <TimelineView />

      {/* Drag & Drop Overlay */}
      {isDraggingFiles && (
        <div className="absolute inset-3 rounded-2xl bg-indigo-950/80 border-2 border-dashed border-indigo-400 z-50 flex flex-col items-center justify-center pointer-events-none backdrop-blur-xs">
          <UploadCloud className="w-12 h-12 text-indigo-300 mb-2" />
          <p className="text-base font-semibold text-white">Drop Videos to Add &amp; Stitch</p>
          <p className="text-xs text-indigo-200 mt-1">
            Clips sort alphabetically by default and split onto V1 Video + A1 Audio tracks
          </p>
        </div>
      )}

      {/* Toast Notification */}
      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-50 px-3.5 py-2 rounded-lg shadow-xl border text-xs font-medium ${
            toast.type === 'error'
              ? 'bg-red-950/95 border-red-500/50 text-red-200'
              : toast.type === 'success'
                ? 'bg-emerald-950/95 border-emerald-500/50 text-emerald-200'
                : 'bg-zinc-900/95 border-zinc-700 text-zinc-200'
          }`}
        >
          {toast.text}
        </div>
      )}

      <ExportModal />
    </div>
  )
}

export default App
