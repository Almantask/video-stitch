import React from 'react'
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  ArrowDownAZ,
  ArrowUpZA,
  ChevronDown,
  ChevronUp,
  Film,
  GripVertical,
  Plus,
  Volume2,
  VolumeX,
  X
} from 'lucide-react'
import { formatTimecode } from '@shared/timelineMath'
import type { SourceClip } from '@shared/types'
import { videoStitchClient } from '../lib/videoStitchClient'
import { useProjectStore } from '../store/useProjectStore'

interface SortableClipRowProps {
  clip: SourceClip
  index: number
  total: number
  onMoveIndex: (clipId: string, targetClipId: string) => void
  onRemove: (clipId: string) => void
  prevClipId?: string
  nextClipId?: string
}

const SortableClipRow: React.FC<SortableClipRowProps> = ({
  clip,
  index,
  total,
  onMoveIndex,
  onRemove,
  prevClipId,
  nextClipId
}) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: clip.id
  })

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition
  }

  const thumbUrl = clip.thumbnailPath
    ? videoStitchClient.toMediaUrl(clip.thumbnailPath)
    : null

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group flex items-center gap-2.5 p-2 rounded-lg border transition ${
        isDragging
          ? 'bg-zinc-800 border-indigo-500 shadow-lg z-20 opacity-90'
          : 'bg-zinc-900/70 hover:bg-zinc-800/80 border-zinc-800/90'
      }`}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        title="Drag to change clip sequence"
        className="text-zinc-500 hover:text-zinc-300 cursor-grab active:cursor-grabbing p-0.5"
      >
        <GripVertical className="w-4 h-4" />
      </button>

      <span className="w-5 text-center text-[11px] font-mono font-semibold text-indigo-400 shrink-0">
        {index + 1}
      </span>

      <div className="w-14 h-9 rounded bg-zinc-950 border border-zinc-800 overflow-hidden shrink-0 flex items-center justify-center">
        {thumbUrl ? (
          <img
            src={thumbUrl}
            alt={clip.fileName}
            className="w-full h-full object-cover"
            draggable={false}
          />
        ) : (
          <Film className="w-4 h-4 text-zinc-600" />
        )}
      </div>

      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-zinc-100 truncate" title={clip.fileName}>
          {clip.fileName}
        </p>
        <div className="flex items-center gap-2 text-[10px] text-zinc-400 mt-0.5">
          <span className="font-mono">{formatTimecode(clip.duration)}</span>
          {clip.hasVideo && (
            <span>
              {clip.width}&times;{clip.height}
            </span>
          )}
          <span className="inline-flex items-center gap-0.5">
            {clip.hasAudio ? (
              <Volume2 className="w-3 h-3 text-emerald-400" />
            ) : (
              <VolumeX className="w-3 h-3 text-zinc-600" />
            )}
          </span>
        </div>
      </div>

      <div className="flex flex-col gap-0.5 opacity-0 group-hover:opacity-100 transition">
        <button
          type="button"
          disabled={index === 0 || !prevClipId}
          onClick={() => prevClipId && onMoveIndex(clip.id, prevClipId)}
          title="Move clip earlier"
          className="p-0.5 rounded hover:bg-zinc-700 text-zinc-400 hover:text-zinc-100 disabled:opacity-25 cursor-pointer"
        >
          <ChevronUp className="w-3 h-3" />
        </button>
        <button
          type="button"
          disabled={index === total - 1 || !nextClipId}
          onClick={() => nextClipId && onMoveIndex(clip.id, nextClipId)}
          title="Move clip later"
          className="p-0.5 rounded hover:bg-zinc-700 text-zinc-400 hover:text-zinc-100 disabled:opacity-25 cursor-pointer"
        >
          <ChevronDown className="w-3 h-3" />
        </button>
      </div>

      <button
        type="button"
        onClick={() => onRemove(clip.id)}
        title="Remove clip from project"
        className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-red-500/20 text-zinc-500 hover:text-red-400 transition cursor-pointer"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}

interface SequenceBinProps {
  onImportVideos: () => void
}

export const SequenceBin: React.FC<SequenceBinProps> = ({ onImportVideos }) => {
  const clips = useProjectStore((s) => s.clips)
  const sortSequenceAlphabetically = useProjectStore((s) => s.sortSequenceAlphabetically)
  const reorderClipInBin = useProjectStore((s) => s.reorderClipInBin)
  const removeClipFromProject = useProjectStore((s) => s.removeClipFromProject)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const handleDragEnd = (event: DragEndEvent): void => {
    const { active, over } = event
    if (over && active.id !== over.id) {
      reorderClipInBin(String(active.id), String(over.id))
    }
  }

  return (
    <aside className="w-80 shrink-0 border-r border-zinc-800 bg-zinc-900/40 flex flex-col min-h-0">
      <div className="px-3 py-2.5 border-b border-zinc-800 flex items-center justify-between">
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-300">
            Clip Sequence ({clips.length})
          </h2>
          <p className="text-[10px] text-zinc-500">Defaults A&rarr;Z &bull; Drag to reorder</p>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => sortSequenceAlphabetically('asc')}
            disabled={clips.length < 2}
            title="Sort sequence alphabetically (A to Z)"
            className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700/80 disabled:opacity-40 cursor-pointer"
          >
            <ArrowDownAZ className="w-3.5 h-3.5 text-indigo-400" />
            A&ndash;Z
          </button>
          <button
            type="button"
            onClick={() => sortSequenceAlphabetically('desc')}
            disabled={clips.length < 2}
            title="Sort sequence reverse alphabetically (Z to A)"
            className="p-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700/80 disabled:opacity-40 cursor-pointer"
          >
            <ArrowUpZA className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2.5 space-y-1.5">
        {clips.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center px-4 py-8 border border-dashed border-zinc-800 rounded-xl">
            <Film className="w-8 h-8 text-zinc-600 mb-2" />
            <p className="text-xs font-medium text-zinc-300">No videos selected yet</p>
            <p className="text-[11px] text-zinc-500 mt-1 mb-3">
              Multi-select videos or drag &amp; drop files anywhere in the window. Clips sort
              alphabetically by default.
            </p>
            <button
              type="button"
              onClick={onImportVideos}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-indigo-600 hover:bg-indigo-500 text-white transition cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              Select Videos
            </button>
          </div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={clips.map((c) => c.id)}
              strategy={verticalListSortingStrategy}
            >
              {clips.map((clip, idx) => (
                <SortableClipRow
                  key={clip.id}
                  clip={clip}
                  index={idx}
                  total={clips.length}
                  prevClipId={clips[idx - 1]?.id}
                  nextClipId={clips[idx + 1]?.id}
                  onMoveIndex={reorderClipInBin}
                  onRemove={removeClipFromProject}
                />
              ))}
            </SortableContext>
          </DndContext>
        )}
      </div>
    </aside>
  )
}
