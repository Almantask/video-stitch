import React from 'react'
import {
  ArrowLeft,
  ArrowRight,
  Link2,
  Scissors,
  Trash2,
  Unlink2,
  ZoomIn,
  ZoomOut
} from 'lucide-react'
import { useProjectStore } from '../store/useProjectStore'

export const TimelineToolbar: React.FC = () => {
  const selectedSegmentId = useProjectStore((s) => s.selectedSegmentId)
  const linkEnabled = useProjectStore((s) => s.linkEnabled)
  const zoomPxPerSec = useProjectStore((s) => s.zoomPxPerSec)
  const videoSegments = useProjectStore((s) => s.videoSegments)
  const audioSegments = useProjectStore((s) => s.audioSegments)

  const setLinkEnabled = useProjectStore((s) => s.setLinkEnabled)
  const splitAtPlayhead = useProjectStore((s) => s.splitAtPlayhead)
  const deleteSegment = useProjectStore((s) => s.deleteSegment)
  const moveSelectedSegment = useProjectStore((s) => s.moveSelectedSegment)
  const setZoomPxPerSec = useProjectStore((s) => s.setZoomPxPerSec)
  const setToast = useProjectStore((s) => s.setToast)

  const hasSegments = videoSegments.length > 0 || audioSegments.length > 0

  const handleSplit = (scope: 'selected' | 'both'): void => {
    const ok = splitAtPlayhead(scope)
    if (!ok) {
      setToast({
        type: 'info',
        text: 'Move the red playhead inside a segment before splitting.'
      })
    }
  }

  return (
    <div className="h-10 shrink-0 border-t border-b border-zinc-800 bg-zinc-900/90 px-3 flex items-center justify-between gap-3">
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => setLinkEnabled(!linkEnabled)}
          title="Toggle whether edits apply independently to separated Video/Audio tracks or to both together (Shortcut: L)"
          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium border transition cursor-pointer ${
            linkEnabled
              ? 'bg-indigo-500/20 text-indigo-200 border-indigo-500/50'
              : 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40'
          }`}
        >
          {linkEnabled ? (
            <>
              <Link2 className="w-3.5 h-3.5" />
              Link V+A: ON
            </>
          ) : (
            <>
              <Unlink2 className="w-3.5 h-3.5" />
              Separated Tracks (Independent V1 / A1)
            </>
          )}
        </button>

        <div className="h-4 w-px bg-zinc-800 mx-1" />

        <button
          type="button"
          disabled={!hasSegments}
          onClick={() => handleSplit('selected')}
          title="Split segment under playhead (Shortcut: S)"
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700/80 disabled:opacity-35 cursor-pointer"
        >
          <Scissors className="w-3.5 h-3.5 text-indigo-400" />
          Split (S)
        </button>

        <button
          type="button"
          disabled={!hasSegments}
          onClick={() => handleSplit('both')}
          title="Split both Video (V1) and Audio (A1) at playhead"
          className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs bg-zinc-800/70 hover:bg-zinc-700 text-zinc-300 border border-zinc-700/70 disabled:opacity-35 cursor-pointer"
        >
          Split V1+A1
        </button>

        <button
          type="button"
          disabled={!selectedSegmentId}
          onClick={() => selectedSegmentId && deleteSegment(selectedSegmentId)}
          title="Ripple-delete selected segment (Shortcut: Delete)"
          className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs bg-zinc-800 hover:bg-red-500/20 text-zinc-300 hover:text-red-300 border border-zinc-700/80 disabled:opacity-35 cursor-pointer"
        >
          <Trash2 className="w-3.5 h-3.5" />
          Cut / Delete
        </button>

        <div className="h-4 w-px bg-zinc-800 mx-1" />

        <button
          type="button"
          disabled={!selectedSegmentId}
          onClick={() => moveSelectedSegment(-1)}
          title="Move selected segment earlier on track (Alt+Left)"
          className="p-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700/80 disabled:opacity-35 cursor-pointer"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          disabled={!selectedSegmentId}
          onClick={() => moveSelectedSegment(1)}
          title="Move selected segment later on track (Alt+Right)"
          className="p-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700/80 disabled:opacity-35 cursor-pointer"
        >
          <ArrowRight className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Zoom controls */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setZoomPxPerSec(zoomPxPerSec - 12)}
          title="Zoom out timeline"
          className="p-1 rounded hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 cursor-pointer"
        >
          <ZoomOut className="w-3.5 h-3.5" />
        </button>
        <input
          type="range"
          min={12}
          max={200}
          step={4}
          value={zoomPxPerSec}
          onChange={(e) => setZoomPxPerSec(Number(e.target.value))}
          className="w-24 accent-indigo-500 h-1 bg-zinc-800 rounded cursor-pointer"
        />
        <button
          type="button"
          onClick={() => setZoomPxPerSec(zoomPxPerSec + 12)}
          title="Zoom in timeline"
          className="p-1 rounded hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 cursor-pointer"
        >
          <ZoomIn className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  )
}
