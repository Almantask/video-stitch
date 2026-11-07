import React, { useMemo } from 'react'
import {
  Film,
  Gauge,
  Music,
  Scissors,
  Sliders,
  Trash2,
  Unlink2,
  Volume2,
  VolumeX
} from 'lucide-react'
import { formatTimecode, getSegmentTimelineDuration } from '@shared/timelineMath'
import { useProjectStore } from '../store/useProjectStore'

const SPEED_PRESETS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4]

export const InspectorPanel: React.FC = () => {
  const clips = useProjectStore((s) => s.clips)
  const videoSegments = useProjectStore((s) => s.videoSegments)
  const audioSegments = useProjectStore((s) => s.audioSegments)
  const selectedSegmentId = useProjectStore((s) => s.selectedSegmentId)
  const linkEnabled = useProjectStore((s) => s.linkEnabled)

  const trimSegment = useProjectStore((s) => s.trimSegment)
  const setSegmentSpeed = useProjectStore((s) => s.setSegmentSpeed)
  const setAllSegmentsSpeed = useProjectStore((s) => s.setAllSegmentsSpeed)
  const toggleSegmentMute = useProjectStore((s) => s.toggleSegmentMute)
  const setSegmentVolume = useProjectStore((s) => s.setSegmentVolume)
  const unlinkSegmentPair = useProjectStore((s) => s.unlinkSegmentPair)
  const splitAtPlayhead = useProjectStore((s) => s.splitAtPlayhead)
  const deleteSegment = useProjectStore((s) => s.deleteSegment)

  const selected = useMemo(
    () =>
      videoSegments.find((s) => s.id === selectedSegmentId) ??
      audioSegments.find((s) => s.id === selectedSegmentId) ??
      null,
    [videoSegments, audioSegments, selectedSegmentId]
  )

  const sourceClip = useMemo(
    () => (selected ? clips.find((c) => c.id === selected.sourceClipId) ?? null : null),
    [clips, selected]
  )

  if (!selected) {
    return (
      <aside className="w-80 shrink-0 border-l border-zinc-800 bg-zinc-900/40 p-4 flex flex-col items-center justify-center text-center">
        <Sliders className="w-7 h-7 text-zinc-600 mb-2" />
        <p className="text-xs font-medium text-zinc-300">Segment Inspector</p>
        <p className="text-[11px] text-zinc-500 mt-1">
          Click any Video (V1) or Audio (A1) segment on the timeline to adjust speed, trim In/Out
          points, cut, or control audio volume.
        </p>
      </aside>
    )
  }

  const maxClipDur = sourceClip?.duration ?? selected.sourceOut
  const effectiveDuration = getSegmentTimelineDuration(selected)
  const isVideo = selected.track === 'video'

  return (
    <aside className="w-80 shrink-0 border-l border-zinc-800 bg-zinc-900/40 flex flex-col min-h-0 overflow-y-auto">
      <div className="px-3.5 py-2.5 border-b border-zinc-800 flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${
              isVideo
                ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/40'
                : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
            }`}
          >
            {isVideo ? 'V1 Video' : 'A1 Audio'}
          </span>
          <span className="text-xs font-medium text-zinc-100 truncate" title={selected.label}>
            {selected.label}
          </span>
        </div>
      </div>

      <div className="p-3.5 space-y-4 text-xs">
        {/* Track separation status */}
        <div className="p-2.5 rounded-lg bg-zinc-900/90 border border-zinc-800 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-[11px] text-zinc-400">
            {isVideo ? (
              <Film className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
            ) : (
              <Music className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            )}
            <span>
              {linkEnabled && selected.linkGroupId
                ? 'Editing Linked V1 + A1 Pair'
                : `Editing ${isVideo ? 'Video' : 'Audio'} Track Only`}
            </span>
          </div>
          {selected.linkGroupId && (
            <button
              type="button"
              onClick={() => unlinkSegmentPair(selected.id)}
              title="Permanently detach this segment from its counterpart"
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700 cursor-pointer shrink-0"
            >
              <Unlink2 className="w-3 h-3" />
              Detach
            </button>
          )}
        </div>

        {/* Speed Control */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="font-semibold text-zinc-200 flex items-center gap-1.5">
              <Gauge className="w-3.5 h-3.5 text-amber-400" />
              Playback Speed
            </label>
            <span className="font-mono font-semibold text-amber-300">{selected.speed}x</span>
          </div>

          <div className="grid grid-cols-5 gap-1">
            {SPEED_PRESETS.map((preset) => {
              const active = Math.abs(selected.speed - preset) < 0.01
              return (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setSegmentSpeed(selected.id, preset)}
                  className={`py-1 rounded text-[11px] font-mono border transition cursor-pointer ${
                    active
                      ? 'bg-amber-500/20 border-amber-500/60 text-amber-200 font-semibold'
                      : 'bg-zinc-900 hover:bg-zinc-800 border-zinc-800 text-zinc-300'
                  }`}
                >
                  {preset}x
                </button>
              )
            })}
          </div>

          <input
            type="range"
            min={0.25}
            max={4}
            step={0.05}
            value={selected.speed}
            onPointerDown={() => useProjectStore.temporal.getState().pause()}
            onPointerUp={() => useProjectStore.temporal.getState().resume()}
            onChange={(e) => setSegmentSpeed(selected.id, Number(e.target.value))}
            className="w-full accent-amber-400 h-1.5 bg-zinc-800 rounded-lg cursor-pointer"
          />

          <button
            type="button"
            onClick={() =>
              setAllSegmentsSpeed(linkEnabled ? 'both' : selected.track, selected.speed)
            }
            className="w-full py-1 rounded text-[11px] bg-zinc-800/80 hover:bg-zinc-800 text-zinc-300 border border-zinc-700/80 transition cursor-pointer"
          >
            Apply {selected.speed}x to All {linkEnabled ? 'V1 + A1' : isVideo ? 'Video' : 'Audio'}{' '}
            Segments
          </button>
        </div>

        {/* Cutting & Trimming */}
        <div className="space-y-2 pt-2 border-t border-zinc-800/80">
          <div className="flex items-center justify-between">
            <label className="font-semibold text-zinc-200 flex items-center gap-1.5">
              <Scissors className="w-3.5 h-3.5 text-indigo-400" />
              Trim &amp; Cut
            </label>
            <span className="text-[11px] font-mono text-zinc-400">
              Out Len: {formatTimecode(effectiveDuration)}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <span className="block text-[10px] text-zinc-400 mb-1">Start (In sec)</span>
              <input
                type="number"
                min={0}
                max={Math.max(0, selected.sourceOut - 0.05)}
                step={0.1}
                value={Number(selected.sourceIn.toFixed(2))}
                onChange={(e) =>
                  trimSegment(selected.id, Number(e.target.value), selected.sourceOut)
                }
                className="w-full px-2 py-1 rounded bg-zinc-950 border border-zinc-800 font-mono text-xs text-zinc-100 focus:outline-none focus:border-indigo-500"
              />
            </div>
            <div>
              <span className="block text-[10px] text-zinc-400 mb-1">
                End (Out / {maxClipDur.toFixed(1)}s)
              </span>
              <input
                type="number"
                min={selected.sourceIn + 0.05}
                max={maxClipDur}
                step={0.1}
                value={Number(selected.sourceOut.toFixed(2))}
                onChange={(e) =>
                  trimSegment(selected.id, selected.sourceIn, Number(e.target.value))
                }
                className="w-full px-2 py-1 rounded bg-zinc-950 border border-zinc-800 font-mono text-xs text-zinc-100 focus:outline-none focus:border-indigo-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 pt-1">
            <button
              type="button"
              onClick={() => splitAtPlayhead('selected')}
              className="inline-flex items-center justify-center gap-1.5 py-1.5 px-2 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-100 border border-zinc-700 transition cursor-pointer"
            >
              <Scissors className="w-3.5 h-3.5 text-indigo-400" />
              Split at Playhead
            </button>
            <button
              type="button"
              onClick={() => deleteSegment(selected.id)}
              className="inline-flex items-center justify-center gap-1.5 py-1.5 px-2 rounded bg-red-500/15 hover:bg-red-500/25 text-red-300 border border-red-500/30 transition cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Delete Cut
            </button>
          </div>
        </div>

        {/* Audio-specific controls */}
        {!isVideo && (
          <div className="space-y-2 pt-2 border-t border-zinc-800/80">
            <div className="flex items-center justify-between">
              <label className="font-semibold text-zinc-200 flex items-center gap-1.5">
                {selected.muted ? (
                  <VolumeX className="w-3.5 h-3.5 text-zinc-500" />
                ) : (
                  <Volume2 className="w-3.5 h-3.5 text-emerald-400" />
                )}
                Audio Level
              </label>
              <span className="font-mono text-emerald-300">
                {selected.muted ? 'Muted' : `${Math.round(selected.volume * 100)}%`}
              </span>
            </div>

            {selected.isSilentSpacer ? (
              <p className="text-[11px] text-zinc-500">
                Source video clip had no audio stream. Kept as a silent spacer (delete it if you
                want following audio clips to slide earlier).
              </p>
            ) : (
              <>
                <input
                  type="range"
                  min={0}
                  max={2}
                  step={0.05}
                  value={selected.muted ? 0 : selected.volume}
                  onPointerDown={() => useProjectStore.temporal.getState().pause()}
                  onPointerUp={() => useProjectStore.temporal.getState().resume()}
                  onChange={(e) => setSegmentVolume(selected.id, Number(e.target.value))}
                  className="w-full accent-emerald-400 h-1.5 bg-zinc-800 rounded-lg cursor-pointer"
                />
                <button
                  type="button"
                  onClick={() => toggleSegmentMute(selected.id)}
                  className="w-full py-1.5 rounded text-xs font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700 transition cursor-pointer"
                >
                  {selected.muted ? 'Unmute Audio Segment' : 'Mute Audio Segment'}
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </aside>
  )
}
