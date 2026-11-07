import React, { useMemo, useRef } from 'react'
import {
  closestCenter,
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent
} from '@dnd-kit/core'
import {
  horizontalListSortingStrategy,
  SortableContext,
  useSortable
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Film, Link2, Music, Volume2, VolumeX } from 'lucide-react'
import {
  computeTrackLayout,
  formatTimecode,
  getTrackTotalDuration
} from '@shared/timelineMath'
import type { ComputedTimelineSegment, SourceClip, TrackType } from '@shared/types'
import { videoStitchClient } from '../lib/videoStitchClient'
import { useProjectStore } from '../store/useProjectStore'
import { WaveformCanvas } from './WaveformCanvas'

interface SegmentCardProps {
  seg: ComputedTimelineSegment
  clip: SourceClip | undefined
  zoomPxPerSec: number
  isSelected: boolean
  isPartnerHighlighted: boolean
  onSelect: (id: string) => void
  onTrim: (id: string, nextIn: number, nextOut: number) => void
  onToggleMute: (id: string) => void
}

const SegmentCard: React.FC<SegmentCardProps> = ({
  seg,
  clip,
  zoomPxPerSec,
  isSelected,
  isPartnerHighlighted,
  onSelect,
  onTrim,
  onToggleMute
}) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: seg.id
  })

  const widthPx = Math.max(38, seg.timelineDuration * zoomPxPerSec)
  const isVideo = seg.track === 'video'

  const startTrimDrag = (e: React.PointerEvent, edge: 'in' | 'out'): void => {
    e.stopPropagation()
    e.preventDefault()
    onSelect(seg.id)

    const startX = e.clientX
    const origIn = seg.sourceIn
    const origOut = seg.sourceOut
    const spd = seg.speed

    useProjectStore.temporal.getState().pause()

    const handleMove = (ev: PointerEvent): void => {
      const dx = ev.clientX - startX
      const deltaTimelineSec = dx / zoomPxPerSec
      const deltaSourceSec = deltaTimelineSec * spd
      if (edge === 'in') {
        onTrim(seg.id, origIn + deltaSourceSec, origOut)
      } else {
        onTrim(seg.id, origIn, origOut + deltaSourceSec)
      }
    }

    const handleUp = (): void => {
      useProjectStore.temporal.getState().resume()
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', handleUp)
    }

    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', handleUp)
  }

  const thumbUrl =
    isVideo && clip?.thumbnailPath ? videoStitchClient.toMediaUrl(clip.thumbnailPath) : null

  const style: React.CSSProperties = {
    width: `${widthPx}px`,
    transform: CSS.Translate.toString(transform),
    transition
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      onClick={(e) => {
        e.stopPropagation()
        onSelect(seg.id)
      }}
      {...attributes}
      {...listeners}
      className={`group relative h-14 shrink-0 rounded-md overflow-hidden border select-none cursor-grab active:cursor-grabbing transition-colors ${
        isDragging ? 'z-30 opacity-90 shadow-xl' : 'z-10'
      } ${
        isVideo
          ? isSelected
            ? 'bg-indigo-950/90 border-indigo-400 ring-1 ring-indigo-400/70'
            : isPartnerHighlighted
              ? 'bg-indigo-950/65 border-indigo-500/70'
              : 'bg-indigo-950/50 hover:bg-indigo-950/75 border-indigo-500/35'
          : isSelected
            ? 'bg-emerald-950/90 border-emerald-400 ring-1 ring-emerald-400/70'
            : isPartnerHighlighted
              ? 'bg-emerald-950/65 border-emerald-500/70'
              : seg.muted || seg.isSilentSpacer
                ? 'bg-zinc-900/80 border-zinc-700/70'
                : 'bg-emerald-950/45 hover:bg-emerald-950/70 border-emerald-500/35'
      }`}
    >
      {/* Background visual: thumbnail for V1, waveform for A1 */}
      {isVideo && thumbUrl && (
        <div
          className="absolute inset-0 opacity-30 bg-repeat-x bg-left bg-contain pointer-events-none"
          style={{ backgroundImage: `url("${thumbUrl}")` }}
        />
      )}

      {!isVideo && (
        <div className="absolute inset-x-1.5 bottom-1 top-5 flex items-center pointer-events-none">
          <WaveformCanvas
            peaks={clip?.waveformPeaks ?? []}
            clipDuration={clip?.duration ?? seg.sourceOut}
            sourceIn={seg.sourceIn}
            sourceOut={seg.sourceOut}
            muted={seg.muted || Boolean(seg.isSilentSpacer)}
            volume={seg.volume}
            widthPx={widthPx - 12}
            heightPx={30}
          />
        </div>
      )}

      {/* Top info bar */}
      <div className="relative z-10 px-2 pt-1 flex items-center justify-between gap-1 text-[10px]">
        <div className="flex items-center gap-1 min-w-0">
          {seg.linkGroupId && (
            <Link2 className="w-2.5 h-2.5 text-zinc-400 shrink-0" />
          )}
          <span className="font-medium text-zinc-100 truncate">{seg.label}</span>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {Math.abs(seg.speed - 1) > 0.01 && (
            <span className="px-1 rounded bg-amber-500/25 text-amber-200 font-mono font-semibold text-[9px]">
              {seg.speed}x
            </span>
          )}
          {!isVideo && !seg.isSilentSpacer && (
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation()
                onToggleMute(seg.id)
              }}
              title={seg.muted ? 'Unmute audio segment' : 'Mute audio segment'}
              className="p-0.5 rounded hover:bg-black/40 text-zinc-200 cursor-pointer"
            >
              {seg.muted ? (
                <VolumeX className="w-3 h-3 text-red-400" />
              ) : (
                <Volume2 className="w-3 h-3 text-emerald-300" />
              )}
            </button>
          )}
        </div>
      </div>

      {isVideo && (
        <div className="relative z-10 px-2 mt-1 text-[9px] font-mono text-indigo-200/80 truncate">
          {formatTimecode(seg.timelineDuration)}
        </div>
      )}

      {/* Left Trim Handle */}
      <div
        onPointerDown={(e) => startTrimDrag(e, 'in')}
        title="Drag to trim clip start (In)"
        className="absolute left-0 inset-y-0 w-2 z-20 cursor-ew-resize bg-white/0 hover:bg-white/35 group-hover:bg-white/15 flex items-center justify-center transition"
      >
        <div className="w-0.5 h-5 rounded bg-white/60" />
      </div>

      {/* Right Trim Handle */}
      <div
        onPointerDown={(e) => startTrimDrag(e, 'out')}
        title="Drag to trim clip end (Out)"
        className="absolute right-0 inset-y-0 w-2 z-20 cursor-ew-resize bg-white/0 hover:bg-white/35 group-hover:bg-white/15 flex items-center justify-center transition"
      >
        <div className="w-0.5 h-5 rounded bg-white/60" />
      </div>
    </div>
  )
}

export const TimelineView: React.FC = () => {
  const clips = useProjectStore((s) => s.clips)
  const videoSegments = useProjectStore((s) => s.videoSegments)
  const audioSegments = useProjectStore((s) => s.audioSegments)
  const selectedSegmentId = useProjectStore((s) => s.selectedSegmentId)
  const linkEnabled = useProjectStore((s) => s.linkEnabled)
  const playheadSec = useProjectStore((s) => s.playheadSec)
  const zoomPxPerSec = useProjectStore((s) => s.zoomPxPerSec)

  const selectSegment = useProjectStore((s) => s.selectSegment)
  const setPlayheadSec = useProjectStore((s) => s.setPlayheadSec)
  const setIsPlaying = useProjectStore((s) => s.setIsPlaying)
  const reorderTrackSegment = useProjectStore((s) => s.reorderTrackSegment)
  const trimSegment = useProjectStore((s) => s.trimSegment)
  const toggleSegmentMute = useProjectStore((s) => s.toggleSegmentMute)

  const scrollContainerRef = useRef<HTMLDivElement | null>(null)
  const tracksAreaRef = useRef<HTMLDivElement | null>(null)

  const clipsById = useMemo(() => new Map(clips.map((c) => [c.id, c])), [clips])
  const computedV = useMemo(() => computeTrackLayout(videoSegments), [videoSegments])
  const computedA = useMemo(() => computeTrackLayout(audioSegments), [audioSegments])

  const vTotal = useMemo(() => getTrackTotalDuration(videoSegments), [videoSegments])
  const aTotal = useMemo(() => getTrackTotalDuration(audioSegments), [audioSegments])
  const maxDuration = Math.max(15, vTotal + 3, aTotal + 3)
  const canvasWidthPx = Math.max(800, Math.ceil(maxDuration * zoomPxPerSec))

  const selectedSeg = useMemo(
    () =>
      videoSegments.find((s) => s.id === selectedSegmentId) ??
      audioSegments.find((s) => s.id === selectedSegmentId) ??
      null,
    [videoSegments, audioSegments, selectedSegmentId]
  )

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  )

  const handleTrackDragEnd =
    (track: TrackType) =>
    (event: DragEndEvent): void => {
      const { active, over } = event
      if (over && active.id !== over.id) {
        reorderTrackSegment(track, String(active.id), String(over.id))
      }
    }

  const scrubFromClientX = (clientX: number): void => {
    const area = tracksAreaRef.current
    if (!area) return
    const rect = area.getBoundingClientRect()
    const x = Math.max(0, clientX - rect.left)
    const sec = x / zoomPxPerSec
    const contentEnd = Math.max(vTotal, aTotal)
    setPlayheadSec(contentEnd > 0 ? Math.min(contentEnd, sec) : 0)
  }

  const handleRulerPointerDown = (e: React.PointerEvent): void => {
    e.preventDefault()
    setIsPlaying(false)
    scrubFromClientX(e.clientX)

    const onMove = (ev: PointerEvent): void => scrubFromClientX(ev.clientX)
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  // Ruler ticks
  const tickStepSec = zoomPxPerSec >= 90 ? 1 : zoomPxPerSec >= 40 ? 2 : zoomPxPerSec >= 20 ? 5 : 10
  const tickCount = Math.ceil(maxDuration / tickStepSec)

  return (
    <div className="h-52 shrink-0 bg-zinc-950 flex min-h-0 overflow-hidden">
      {/* Left Sticky Track Labels */}
      <div className="w-32 shrink-0 border-r border-zinc-800 bg-zinc-900/75 flex flex-col z-20">
        <div className="h-7 border-b border-zinc-800 px-2.5 flex items-center text-[10px] font-mono uppercase tracking-wider text-zinc-500">
          Timeline
        </div>

        <div className="h-18 border-b border-zinc-800/80 px-2.5 flex flex-col justify-center">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-indigo-300">
            <Film className="w-3.5 h-3.5 text-indigo-400" />
            V1 &bull; Video
          </div>
          <span className="text-[10px] font-mono text-zinc-400 mt-0.5">
            {formatTimecode(vTotal)} ({videoSegments.length} seg)
          </span>
        </div>

        <div className="h-18 border-b border-zinc-800/80 px-2.5 flex flex-col justify-center">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-300">
            <Music className="w-3.5 h-3.5 text-emerald-400" />
            A1 &bull; Audio
          </div>
          <span className="text-[10px] font-mono text-zinc-400 mt-0.5">
            {formatTimecode(aTotal)} ({audioSegments.length} seg)
          </span>
        </div>
      </div>

      {/* Scrollable Timeline Canvas */}
      <div
        ref={scrollContainerRef}
        onClick={() => selectSegment(null)}
        className="flex-1 overflow-x-auto overflow-y-hidden relative"
      >
        <div
          ref={tracksAreaRef}
          style={{ width: `${canvasWidthPx}px` }}
          className="relative h-full"
        >
          {/* Time Ruler */}
          <div
            onPointerDown={handleRulerPointerDown}
            className="h-7 border-b border-zinc-800 bg-zinc-900/50 relative cursor-pointer"
          >
            {Array.from({ length: tickCount + 1 }, (_, idx) => {
              const sec = idx * tickStepSec
              const left = sec * zoomPxPerSec
              return (
                <div
                  key={sec}
                  style={{ left: `${left}px` }}
                  className="absolute top-0 bottom-0 border-l border-zinc-800 pl-1 pt-1 text-[10px] font-mono text-zinc-500 pointer-events-none"
                >
                  {formatTimecode(sec, false)}
                </div>
              )
            })}
          </div>

          {/* V1 Video Track */}
          <div
            onDoubleClick={(e) => scrubFromClientX(e.clientX)}
            className="h-18 border-b border-zinc-800/70 bg-zinc-950/60 flex items-center px-0 relative"
          >
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleTrackDragEnd('video')}
            >
              <SortableContext
                items={computedV.map((s) => s.id)}
                strategy={horizontalListSortingStrategy}
              >
                <div className="flex items-center h-full">
                  {computedV.map((seg) => (
                    <SegmentCard
                      key={seg.id}
                      seg={seg}
                      clip={clipsById.get(seg.sourceClipId)}
                      zoomPxPerSec={zoomPxPerSec}
                      isSelected={seg.id === selectedSegmentId}
                      isPartnerHighlighted={Boolean(
                        linkEnabled &&
                          selectedSeg?.linkGroupId &&
                          seg.linkGroupId === selectedSeg.linkGroupId &&
                          seg.id !== selectedSegmentId
                      )}
                      onSelect={selectSegment}
                      onTrim={trimSegment}
                      onToggleMute={toggleSegmentMute}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          </div>

          {/* A1 Separated Audio Track */}
          <div
            onDoubleClick={(e) => scrubFromClientX(e.clientX)}
            className="h-18 border-b border-zinc-800/70 bg-zinc-950/90 flex items-center px-0 relative"
          >
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleTrackDragEnd('audio')}
            >
              <SortableContext
                items={computedA.map((s) => s.id)}
                strategy={horizontalListSortingStrategy}
              >
                <div className="flex items-center h-full">
                  {computedA.map((seg) => (
                    <SegmentCard
                      key={seg.id}
                      seg={seg}
                      clip={clipsById.get(seg.sourceClipId)}
                      zoomPxPerSec={zoomPxPerSec}
                      isSelected={seg.id === selectedSegmentId}
                      isPartnerHighlighted={Boolean(
                        linkEnabled &&
                          selectedSeg?.linkGroupId &&
                          seg.linkGroupId === selectedSeg.linkGroupId &&
                          seg.id !== selectedSegmentId
                      )}
                      onSelect={selectSegment}
                      onTrim={trimSegment}
                      onToggleMute={toggleSegmentMute}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          </div>

          {/* Playhead Cursor */}
          <div
            style={{ left: `${playheadSec * zoomPxPerSec}px` }}
            className="absolute top-0 bottom-0 w-0.5 bg-rose-500 z-40 pointer-events-none"
          >
            <div className="w-3 h-3 -ml-[5px] bg-rose-500 rotate-45 -mt-1.5 rounded-[2px] shadow" />
          </div>
        </div>
      </div>
    </div>
  )
}
