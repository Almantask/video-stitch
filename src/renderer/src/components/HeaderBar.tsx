import React from 'react'
import {
  Clapperboard,
  Download,
  FolderPlus,
  Music,
  Redo2,
  Trash2,
  Undo2
} from 'lucide-react'
import { useProjectStore, useTemporalHistory } from '../store/useProjectStore'

interface HeaderBarProps {
  onImportVideos: () => void
  onImportAudio: () => void
}

export const HeaderBar: React.FC<HeaderBarProps> = ({ onImportVideos, onImportAudio }) => {
  const clips = useProjectStore((s) => s.clips)
  const videoSegments = useProjectStore((s) => s.videoSegments)
  const audioSegments = useProjectStore((s) => s.audioSegments)
  const isImporting = useProjectStore((s) => s.isImporting)
  const ffmpegHealth = useProjectStore((s) => s.ffmpegHealth)
  const setExportModalOpen = useProjectStore((s) => s.setExportModalOpen)
  const clearProject = useProjectStore((s) => s.clearProject)

  const { undo, redo, pastStates, futureStates } = useTemporalHistory()
  const hasContent = videoSegments.length > 0 || audioSegments.length > 0

  return (
    <header className="h-13 shrink-0 border-b border-zinc-800 bg-zinc-900/90 px-4 flex items-center justify-between gap-4">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-indigo-600/20 border border-indigo-500/40 flex items-center justify-center text-indigo-400">
            <Clapperboard className="w-4 h-4" />
          </div>
          <div>
            <h1 className="text-sm font-semibold tracking-tight text-zinc-100 leading-none">
              Video Stitch
            </h1>
            <p className="text-[11px] text-zinc-400 mt-0.5">
              Multi-clip stitcher &bull; Separated V1/A1 tracks
            </p>
          </div>
        </div>

        {ffmpegHealth && (
          <span
            title={ffmpegHealth.version ?? ffmpegHealth.error ?? 'FFmpeg status'}
            className={`ml-2 px-2 py-0.5 rounded-full text-[11px] font-medium border ${
              ffmpegHealth.available
                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/25'
                : 'bg-red-500/15 text-red-400 border-red-500/30'
            }`}
          >
            {ffmpegHealth.available ? 'FFmpeg Ready' : 'FFmpeg Missing'}
          </span>
        )}
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onImportVideos}
          disabled={isImporting}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-100 border border-zinc-700 transition disabled:opacity-50 cursor-pointer"
        >
          <FolderPlus className="w-3.5 h-3.5 text-indigo-400" />
          {isImporting ? 'Probing...' : 'Add Videos'}
        </button>

        <button
          type="button"
          onClick={onImportAudio}
          disabled={isImporting}
          title="Import standalone audio file onto Audio Track (A1)"
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium bg-zinc-800/70 hover:bg-zinc-700 text-zinc-200 border border-zinc-700/80 transition disabled:opacity-50 cursor-pointer"
        >
          <Music className="w-3.5 h-3.5 text-emerald-400" />
          Add Audio
        </button>

        <div className="h-5 w-px bg-zinc-800 mx-1" />

        <button
          type="button"
          onClick={() => undo()}
          disabled={pastStates.length === 0}
          title="Undo (Ctrl+Z)"
          className="p-1.5 rounded-md text-zinc-300 hover:bg-zinc-800 disabled:opacity-35 transition cursor-pointer"
        >
          <Undo2 className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={() => redo()}
          disabled={futureStates.length === 0}
          title="Redo (Ctrl+Y)"
          className="p-1.5 rounded-md text-zinc-300 hover:bg-zinc-800 disabled:opacity-35 transition cursor-pointer"
        >
          <Redo2 className="w-4 h-4" />
        </button>

        {clips.length > 0 && (
          <button
            type="button"
            onClick={clearProject}
            title="Clear all clips and reset timeline"
            className="p-1.5 rounded-md text-zinc-400 hover:text-red-400 hover:bg-zinc-800 transition cursor-pointer"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        )}

        <div className="h-5 w-px bg-zinc-800 mx-1" />

        <button
          type="button"
          onClick={() => setExportModalOpen(true)}
          disabled={!hasContent}
          className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-md text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white shadow-sm transition disabled:opacity-40 disabled:pointer-events-none cursor-pointer"
        >
          <Download className="w-3.5 h-3.5" />
          Export &amp; Stitch
        </button>
      </div>
    </header>
  )
}
