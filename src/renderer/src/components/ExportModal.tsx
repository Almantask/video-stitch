import React, { useEffect, useState } from 'react'
import {
  CheckCircle2,
  Download,
  FolderOpen,
  Loader2,
  X
} from 'lucide-react'
import { formatTimecode, getTrackTotalDuration } from '@shared/timelineMath'
import type {
  AudioExportFormat,
  DurationPolicy,
  ExportMode,
  ExportProgressEvent,
  ExportResolution
} from '@shared/types'
import { videoStitchClient } from '../lib/videoStitchClient'
import { useProjectStore } from '../store/useProjectStore'

export const ExportModal: React.FC = () => {
  const open = useProjectStore((s) => s.exportModalOpen)
  const setOpen = useProjectStore((s) => s.setExportModalOpen)
  const clips = useProjectStore((s) => s.clips)
  const videoSegments = useProjectStore((s) => s.videoSegments)
  const audioSegments = useProjectStore((s) => s.audioSegments)

  const [mode, setMode] = useState<ExportMode>('combined')
  const [resolution, setResolution] = useState<ExportResolution>('1920x1080')
  const [fps, setFps] = useState<24 | 30 | 60>(30)
  const [audioFormat, setAudioFormat] = useState<AudioExportFormat>('mp3')
  const [durationPolicy, setDurationPolicy] = useState<DurationPolicy>('longest')

  const [activeJobId, setActiveJobId] = useState<string | null>(null)
  const [progress, setProgress] = useState<ExportProgressEvent | null>(null)
  const [completedFiles, setCompletedFiles] = useState<string[]>([])
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    if (videoSegments.length === 0 && audioSegments.length > 0) {
      setMode('audio-only')
    } else if (audioSegments.length === 0 && videoSegments.length > 0 && mode === 'audio-only') {
      setMode('video-only')
    }
  }, [open, videoSegments.length, audioSegments.length, mode])

  useEffect(() => {
    if (!open) return
    const unsubscribe = videoStitchClient.onExportProgress((ev) => {
      setProgress(ev)
    })
    return unsubscribe
  }, [open])

  if (!open) return null

  const vTotal = getTrackTotalDuration(videoSegments)
  const aTotal = getTrackTotalDuration(audioSegments)
  const isExporting = Boolean(activeJobId)

  const hasVideoContent = videoSegments.length > 0
  const hasAudioContent = audioSegments.length > 0
  const isModeInvalid =
    (mode !== 'audio-only' && !hasVideoContent) || (mode === 'audio-only' && !hasAudioContent)

  const handleStartExport = async (): Promise<void> => {
    setErrorMsg(null)
    setCompletedFiles([])

    const ext = mode === 'audio-only' ? audioFormat : 'mp4'
    const defaultName = `stitched_output.${ext}`
    const chosenPath = await videoStitchClient.chooseExportPath(defaultName, mode, audioFormat)
    if (!chosenPath) return

    const jobId = `job_${Date.now()}`
    setActiveJobId(jobId)
    setProgress({
      jobId,
      percent: 1,
      currentTimeSec: 0,
      totalDurationSec: Math.max(vTotal, aTotal),
      phase: 'Preparing FFmpeg filtergraph...'
    })

    const result = await videoStitchClient.startExport({
      jobId,
      clips,
      videoSegments,
      audioSegments,
      settings: {
        mode,
        resolution,
        fps,
        audioFormat,
        durationPolicy,
        outputPath: chosenPath
      }
    })

    setActiveJobId(null)
    if (result.success) {
      setCompletedFiles(result.outputPaths)
    } else if (!result.canceled) {
      setErrorMsg(result.error ?? 'Export failed.')
    } else {
      setProgress(null)
    }
  }

  const handleCancel = async (): Promise<void> => {
    if (activeJobId) {
      await videoStitchClient.cancelExport(activeJobId)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="w-full max-w-lg rounded-xl bg-zinc-900 border border-zinc-800 shadow-2xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-zinc-800 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-zinc-100">Export Stitched Output</h2>
            <p className="text-[11px] text-zinc-400">
              V1 Video: {formatTimecode(vTotal)} &bull; A1 Audio: {formatTimecode(aTotal)}
            </p>
          </div>
          {!isExporting && (
            <button
              type="button"
              onClick={() => {
                setCompletedFiles([])
                setErrorMsg(null)
                setOpen(false)
              }}
              className="p-1 rounded hover:bg-zinc-800 text-zinc-400 hover:text-zinc-100 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        <div className="p-5 space-y-4 text-xs">
          {/* Output Mode */}
          <div className="space-y-1.5">
            <label className="block font-semibold text-zinc-200">Output Mode</label>
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  {
                    id: 'combined',
                    title: 'Combined Video (.mp4)',
                    desc: 'Stitches V1 + A1 into one video'
                  },
                  {
                    id: 'separate',
                    title: 'Separate Video + Audio',
                    desc: 'Saves muted .mp4 + audio file'
                  },
                  {
                    id: 'video-only',
                    title: 'Video Only (.mp4)',
                    desc: 'Stitches V1 without audio'
                  },
                  {
                    id: 'audio-only',
                    title: 'Audio Only',
                    desc: 'Exports edited A1 audio track'
                  }
                ] as const
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  disabled={isExporting}
                  onClick={() => setMode(opt.id)}
                  className={`p-2.5 rounded-lg border text-left transition cursor-pointer ${
                    mode === opt.id
                      ? 'bg-indigo-600/20 border-indigo-500 text-zinc-100'
                      : 'bg-zinc-950/70 hover:bg-zinc-800/70 border-zinc-800 text-zinc-300'
                  }`}
                >
                  <div className="font-semibold">{opt.title}</div>
                  <div className="text-[10px] text-zinc-400 mt-0.5">{opt.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {mode !== 'audio-only' && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold text-zinc-300 mb-1">Canvas Resolution</label>
                <select
                  disabled={isExporting}
                  value={resolution}
                  onChange={(e) => setResolution(e.target.value as ExportResolution)}
                  className="w-full px-2.5 py-1.5 rounded bg-zinc-950 border border-zinc-800 text-zinc-100"
                >
                  <option value="1920x1080">1080p Landscape (1920&times;1080)</option>
                  <option value="1280x720">720p Landscape (1280&times;720)</option>
                  <option value="3840x2160">4K UHD (3840&times;2160)</option>
                  <option value="1080x1920">1080p Vertical (1080&times;1920)</option>
                  <option value="720x1280">720p Vertical (720&times;1280)</option>
                </select>
              </div>

              <div>
                <label className="block font-semibold text-zinc-300 mb-1">Frame Rate</label>
                <select
                  disabled={isExporting}
                  value={fps}
                  onChange={(e) => setFps(Number(e.target.value) as 24 | 30 | 60)}
                  className="w-full px-2.5 py-1.5 rounded bg-zinc-950 border border-zinc-800 text-zinc-100"
                >
                  <option value={24}>24 fps</option>
                  <option value={30}>30 fps</option>
                  <option value={60}>60 fps</option>
                </select>
              </div>
            </div>
          )}

          {(mode === 'separate' || mode === 'audio-only') && (
            <div>
              <label className="block font-semibold text-zinc-300 mb-1">Audio File Format</label>
              <select
                disabled={isExporting}
                value={audioFormat}
                onChange={(e) => setAudioFormat(e.target.value as AudioExportFormat)}
                className="w-full px-2.5 py-1.5 rounded bg-zinc-950 border border-zinc-800 text-zinc-100"
              >
                <option value="mp3">MP3 (.mp3)</option>
                <option value="wav">Lossless WAV (.wav)</option>
                <option value="m4a">AAC (.m4a)</option>
              </select>
            </div>
          )}

          {mode === 'combined' && Math.abs(vTotal - aTotal) > 0.1 && (
            <div>
              <label className="block font-semibold text-zinc-300 mb-1">
                V1 &amp; A1 Length Difference ({formatTimecode(vTotal)} vs {formatTimecode(aTotal)})
              </label>
              <select
                disabled={isExporting}
                value={durationPolicy}
                onChange={(e) => setDurationPolicy(e.target.value as DurationPolicy)}
                className="w-full px-2.5 py-1.5 rounded bg-zinc-950 border border-zinc-800 text-zinc-100"
              >
                <option value="longest">Keep full length of longest track (pad shorter)</option>
                <option value="video">Stop at end of Video track (V1)</option>
              </select>
            </div>
          )}

          {/* Live Progress */}
          {isExporting && progress && (
            <div className="p-3 rounded-lg bg-zinc-950 border border-zinc-800 space-y-2">
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-zinc-300 flex items-center gap-1.5">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-400" />
                  {progress.phase}
                </span>
                <span className="font-mono font-semibold text-indigo-300">{progress.percent}%</span>
              </div>
              <div className="h-2 rounded-full bg-zinc-800 overflow-hidden">
                <div
                  style={{ width: `${progress.percent}%` }}
                  className="h-full bg-indigo-500 transition-all duration-200"
                />
              </div>
            </div>
          )}

          {/* Validation Warning */}
          {isModeInvalid && (
            <div className="p-3 rounded-lg bg-amber-500/15 border border-amber-500/35 text-amber-300 text-[11px]">
              {mode === 'audio-only'
                ? 'Audio track (A1) has no segments to export. Add audio files or choose a video mode.'
                : 'Video track (V1) has no segments to export. Add video files or choose Audio Only.'}
            </div>
          )}

          {/* Error banner */}
          {errorMsg && (
            <div className="p-3 rounded-lg bg-red-500/15 border border-red-500/35 text-red-300 text-[11px] max-h-28 overflow-y-auto whitespace-pre-wrap">
              {errorMsg}
            </div>
          )}

          {/* Success banner */}
          {completedFiles.length > 0 && (
            <div className="p-3 rounded-lg bg-emerald-500/15 border border-emerald-500/35 space-y-2">
              <div className="flex items-center gap-1.5 text-emerald-300 font-semibold">
                <CheckCircle2 className="w-4 h-4" />
                Export Complete!
              </div>
              {completedFiles.map((fp) => (
                <div
                  key={fp}
                  className="flex items-center justify-between gap-2 text-[11px] text-zinc-200 bg-zinc-950/70 px-2.5 py-1.5 rounded"
                >
                  <span className="truncate font-mono" title={fp}>
                    {fp}
                  </span>
                  <button
                    type="button"
                    onClick={() => videoStitchClient.showItemInFolder(fp)}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-100 shrink-0 cursor-pointer"
                  >
                    <FolderOpen className="w-3 h-3" />
                    Reveal
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-zinc-800 bg-zinc-950/60 flex items-center justify-end gap-2">
          {isExporting ? (
            <button
              type="button"
              onClick={handleCancel}
              className="px-3.5 py-1.5 rounded-md text-xs font-medium bg-red-500/20 hover:bg-red-500/30 text-red-300 border border-red-500/40 cursor-pointer"
            >
              Cancel Export
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={() => {
                  setCompletedFiles([])
                  setErrorMsg(null)
                  setOpen(false)
                }}
                className="px-3.5 py-1.5 rounded-md text-xs font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-200 cursor-pointer"
              >
                Close
              </button>
              <button
                type="button"
                disabled={isModeInvalid}
                onClick={handleStartExport}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-md text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-40 disabled:pointer-events-none cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                Choose Destination &amp; Export
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
