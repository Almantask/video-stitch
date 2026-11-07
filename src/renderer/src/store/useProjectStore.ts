import { arrayMove } from '@dnd-kit/sortable'
import { temporal } from 'zundo'
import { create, useStore } from 'zustand'
import { sortByFileName } from '@shared/sorting'
import {
  clampSpeed,
  computeTrackLayout,
  findSegmentAtTime,
  getTrackTotalDuration,
  splitSegmentAtTimelineTime,
  trimSegmentBounds
} from '@shared/timelineMath'
import type {
  FfmpegHealth,
  SourceClip,
  TimelineSegment,
  TrackType
} from '@shared/types'

let idCounter = 0
function makeId(prefix: string): string {
  idCounter += 1
  return `${prefix}_${Date.now().toString(36)}_${idCounter}`
}

export interface ToastNotice {
  type: 'info' | 'success' | 'error'
  text: string
}

export interface ProjectState {
  // Undoable core data
  clips: SourceClip[]
  videoSegments: TimelineSegment[]
  audioSegments: TimelineSegment[]
  hasManualEdits: boolean

  // Editor / transport state (excluded from undo history)
  linkEnabled: boolean
  selectedSegmentId: string | null
  playheadSec: number
  isPlaying: boolean
  zoomPxPerSec: number
  isImporting: boolean
  exportModalOpen: boolean
  ffmpegHealth: FfmpegHealth | null
  toast: ToastNotice | null

  // Actions
  setFfmpegHealth: (health: FfmpegHealth) => void
  setToast: (toast: ToastNotice | null) => void
  setIsImporting: (busy: boolean) => void
  setExportModalOpen: (open: boolean) => void
  setLinkEnabled: (enabled: boolean) => void
  selectSegment: (segmentId: string | null) => void
  setPlayheadSec: (sec: number) => void
  setIsPlaying: (playing: boolean) => void
  togglePlayPause: () => void
  setZoomPxPerSec: (px: number) => void

  addImportedVideoClips: (incomingClips: SourceClip[]) => void
  addStandaloneAudioClips: (incomingClips: SourceClip[]) => void
  sortSequenceAlphabetically: (direction: 'asc' | 'desc') => void
  reorderClipInBin: (activeClipId: string, overClipId: string) => void
  reorderTrackSegment: (track: TrackType, activeSegId: string, overSegId: string) => void
  moveSelectedSegment: (direction: -1 | 1) => void
  splitAtPlayhead: (scope?: 'selected' | 'both' | 'video' | 'audio') => boolean
  trimSegment: (segmentId: string, nextIn: number, nextOut: number) => void
  setSegmentSpeed: (segmentId: string, speed: number) => void
  setAllSegmentsSpeed: (track: TrackType | 'both', speed: number) => void
  toggleSegmentMute: (segmentId: string) => void
  setSegmentVolume: (segmentId: string, volume: number) => void
  unlinkSegmentPair: (segmentId: string) => void
  deleteSegment: (segmentId: string) => void
  removeClipFromProject: (clipId: string) => void
  clearProject: () => void
}

type UndoableSlice = Pick<
  ProjectState,
  'clips' | 'videoSegments' | 'audioSegments' | 'hasManualEdits'
>

function createSegmentsForVideoClips(clips: readonly SourceClip[]): {
  videoSegments: TimelineSegment[]
  audioSegments: TimelineSegment[]
} {
  const videoSegments: TimelineSegment[] = []
  const audioSegments: TimelineSegment[] = []

  for (const clip of clips) {
    const linkGroupId = makeId('lnk')
    if (clip.hasVideo) {
      videoSegments.push({
        id: makeId('vseg'),
        sourceClipId: clip.id,
        label: clip.fileName,
        track: 'video',
        linkGroupId,
        sourceIn: 0,
        sourceOut: clip.duration,
        speed: 1,
        muted: false,
        volume: 1
      })
    }

    // Separate audio onto A1 track (if clip has no audio stream, insert a silent spacer
    // so subsequent clips stay aligned by default; user can delete or edit independently).
    audioSegments.push({
      id: makeId('aseg'),
      sourceClipId: clip.id,
      label: clip.hasAudio ? clip.fileName : `${clip.fileName} (No Audio)`,
      track: 'audio',
      linkGroupId,
      sourceIn: 0,
      sourceOut: clip.duration,
      speed: 1,
      muted: !clip.hasAudio,
      volume: 1,
      isSilentSpacer: !clip.hasAudio
    })
  }

  return { videoSegments, audioSegments }
}

function reorderSegmentsByClipOrder(
  segments: readonly TimelineSegment[],
  orderedClipIds: readonly string[]
): TimelineSegment[] {
  const rank = new Map<string, number>()
  orderedClipIds.forEach((id, idx) => rank.set(id, idx))

  // Stable sort preserving relative order of split sub-segments within each source clip
  return segments
    .map((seg, origIndex) => ({
      seg,
      origIndex,
      clipRank: rank.get(seg.sourceClipId) ?? Number.MAX_SAFE_INTEGER
    }))
    .sort((a, b) => (a.clipRank !== b.clipRank ? a.clipRank - b.clipRank : a.origIndex - b.origIndex))
    .map((x) => x.seg)
}

export const useProjectStore = create<ProjectState>()(
  temporal(
    (set, get) => ({
      clips: [],
      videoSegments: [],
      audioSegments: [],
      hasManualEdits: false,

      // Audio and video are separated onto independent tracks; Link V+A is off by default
      // so users can freely edit V1 and A1 independently, or toggle Link V+A on at any time.
      linkEnabled: false,
      selectedSegmentId: null,
      playheadSec: 0,
      isPlaying: false,
      zoomPxPerSec: 52,
      isImporting: false,
      exportModalOpen: false,
      ffmpegHealth: null,
      toast: null,

      setFfmpegHealth: (ffmpegHealth) => set({ ffmpegHealth }),
      setToast: (toast) => set({ toast }),
      setIsImporting: (isImporting) => set({ isImporting }),
      setExportModalOpen: (exportModalOpen) => set({ exportModalOpen, isPlaying: false }),
      setLinkEnabled: (linkEnabled) => set({ linkEnabled }),
      selectSegment: (selectedSegmentId) => set({ selectedSegmentId }),
      setPlayheadSec: (sec) => {
        const state = get()
        const maxDur = Math.max(
          getTrackTotalDuration(state.videoSegments),
          getTrackTotalDuration(state.audioSegments)
        )
        const safeMax = maxDur > 0 ? maxDur : 0
        set({ playheadSec: Math.max(0, Math.min(safeMax, Number.isFinite(sec) ? sec : 0)) })
      },
      setIsPlaying: (isPlaying) => set({ isPlaying }),
      togglePlayPause: () => {
        const state = get()
        const total = Math.max(
          getTrackTotalDuration(state.videoSegments),
          getTrackTotalDuration(state.audioSegments)
        )
        if (total <= 0) return
        if (!state.isPlaying && state.playheadSec >= total - 0.05) {
          set({ playheadSec: 0, isPlaying: true })
        } else {
          set({ isPlaying: !state.isPlaying })
        }
      },
      setZoomPxPerSec: (px) =>
        set({ zoomPxPerSec: Math.min(240, Math.max(12, Math.round(px))) }),

      addImportedVideoClips: (incomingClips) => {
        if (incomingClips.length === 0) return
        const state = get()

        // Deduplicate against already imported file paths if needed, or allow multiple imports:
        // If project has no manual edits yet, merge all clips and sort naturally A->Z!
        if (!state.hasManualEdits) {
          const combined = sortByFileName([...state.clips, ...incomingClips], 'asc')
          const rebuilt = createSegmentsForVideoClips(combined)
          set({
            clips: combined,
            videoSegments: rebuilt.videoSegments,
            audioSegments: rebuilt.audioSegments,
            selectedSegmentId: rebuilt.videoSegments[0]?.id ?? null
          })
          return
        }

        const sortedBatch = sortByFileName(incomingClips, 'asc')
        const created = createSegmentsForVideoClips(sortedBatch)
        set({
          clips: [...state.clips, ...sortedBatch],
          videoSegments: [...state.videoSegments, ...created.videoSegments],
          audioSegments: [...state.audioSegments, ...created.audioSegments],
          selectedSegmentId: state.selectedSegmentId ?? created.videoSegments[0]?.id ?? null
        })
      },

      addStandaloneAudioClips: (incomingClips) => {
        if (incomingClips.length === 0) return
        const sorted = sortByFileName(incomingClips, 'asc').filter((c) => c.hasAudio)
        if (sorted.length === 0) return

        const state = get()
        const newAudioSegs: TimelineSegment[] = sorted.map((clip) => ({
          id: makeId('aseg'),
          sourceClipId: clip.id,
          label: clip.fileName,
          track: 'audio',
          linkGroupId: null,
          sourceIn: 0,
          sourceOut: clip.duration,
          speed: 1,
          muted: false,
          volume: 1
        }))

        set({
          clips: [...state.clips, ...sorted],
          audioSegments: [...state.audioSegments, ...newAudioSegs],
          hasManualEdits: true,
          selectedSegmentId: newAudioSegs[0]?.id ?? state.selectedSegmentId
        })
      },

      sortSequenceAlphabetically: (direction) => {
        const state = get()
        if (state.clips.length <= 1) return
        const sortedClips = sortByFileName(state.clips, direction)
        const orderedIds = sortedClips.map((c) => c.id)
        set({
          clips: sortedClips,
          videoSegments: reorderSegmentsByClipOrder(state.videoSegments, orderedIds),
          audioSegments: reorderSegmentsByClipOrder(state.audioSegments, orderedIds),
          hasManualEdits: true
        })
      },

      reorderClipInBin: (activeClipId, overClipId) => {
        if (activeClipId === overClipId) return
        const state = get()
        const oldIndex = state.clips.findIndex((c) => c.id === activeClipId)
        const newIndex = state.clips.findIndex((c) => c.id === overClipId)
        if (oldIndex < 0 || newIndex < 0) return

        const nextClips = arrayMove(state.clips, oldIndex, newIndex)
        const orderedIds = nextClips.map((c) => c.id)
        set({
          clips: nextClips,
          videoSegments: reorderSegmentsByClipOrder(state.videoSegments, orderedIds),
          audioSegments: reorderSegmentsByClipOrder(state.audioSegments, orderedIds),
          hasManualEdits: true
        })
      },

      reorderTrackSegment: (track, activeSegId, overSegId) => {
        if (activeSegId === overSegId) return
        const state = get()
        const list = track === 'video' ? state.videoSegments : state.audioSegments
        const oldIdx = list.findIndex((s) => s.id === activeSegId)
        const newIdx = list.findIndex((s) => s.id === overSegId)
        if (oldIdx < 0 || newIdx < 0) return

        const activeSeg = list[oldIdx]
        const overSeg = list[newIdx]
        const nextList = arrayMove(list, oldIdx, newIdx)

        if (state.linkEnabled && activeSeg.linkGroupId && overSeg.linkGroupId) {
          const otherList = track === 'video' ? state.audioSegments : state.videoSegments
          const pOld = otherList.findIndex((s) => s.linkGroupId === activeSeg.linkGroupId)
          const pNew = otherList.findIndex((s) => s.linkGroupId === overSeg.linkGroupId)
          const nextOther =
            pOld >= 0 && pNew >= 0 ? arrayMove(otherList, pOld, pNew) : otherList
          set(
            track === 'video'
              ? { videoSegments: nextList, audioSegments: nextOther, hasManualEdits: true }
              : { audioSegments: nextList, videoSegments: nextOther, hasManualEdits: true }
          )
          return
        }

        set(
          track === 'video'
            ? { videoSegments: nextList, hasManualEdits: true }
            : { audioSegments: nextList, hasManualEdits: true }
        )
      },

      moveSelectedSegment: (direction) => {
        const state = get()
        if (!state.selectedSegmentId) return
        const vIdx = state.videoSegments.findIndex((s) => s.id === state.selectedSegmentId)
        if (vIdx >= 0) {
          const targetIdx = vIdx + direction
          if (targetIdx >= 0 && targetIdx < state.videoSegments.length) {
            state.reorderTrackSegment(
              'video',
              state.videoSegments[vIdx].id,
              state.videoSegments[targetIdx].id
            )
          }
          return
        }
        const aIdx = state.audioSegments.findIndex((s) => s.id === state.selectedSegmentId)
        if (aIdx >= 0) {
          const targetIdx = aIdx + direction
          if (targetIdx >= 0 && targetIdx < state.audioSegments.length) {
            state.reorderTrackSegment(
              'audio',
              state.audioSegments[aIdx].id,
              state.audioSegments[targetIdx].id
            )
          }
        }
      },

      splitAtPlayhead: (scope = 'selected') => {
        const state = get()
        const t = state.playheadSec
        const computedV = computeTrackLayout(state.videoSegments)
        const computedA = computeTrackLayout(state.audioSegments)

        let splitV = false
        let splitA = false

        if (scope === 'both') {
          splitV = true
          splitA = true
        } else if (scope === 'video') {
          splitV = true
        } else if (scope === 'audio') {
          splitA = true
        } else {
          // 'selected'
          const selV = computedV.find((s) => s.id === state.selectedSegmentId)
          const selA = computedA.find((s) => s.id === state.selectedSegmentId)
          if (selV && t > selV.timelineStart && t < selV.timelineEnd) {
            splitV = true
            if (state.linkEnabled && selV.linkGroupId) splitA = true
          } else if (selA && t > selA.timelineStart && t < selA.timelineEnd) {
            splitA = true
            if (state.linkEnabled && selA.linkGroupId) splitV = true
          } else {
            // Playhead is not inside selected segment -> split both tracks under playhead
            splitV = true
            splitA = true
          }
        }

        const hitV = splitV ? findSegmentAtTime(computedV, t) : null
        const hitA = splitA ? findSegmentAtTime(computedA, t) : null

        const areLinkedPartners = Boolean(
          hitV &&
            hitA &&
            hitV.segment.linkGroupId &&
            hitV.segment.linkGroupId === hitA.segment.linkGroupId
        )

        const rightVLinkId = hitV?.segment.linkGroupId ? makeId('lnk') : null
        const rightALinkId = areLinkedPartners
          ? rightVLinkId
          : hitA?.segment.linkGroupId
            ? makeId('lnk')
            : null

        let nextV = state.videoSegments
        let nextA = state.audioSegments
        let didSplit = false
        let nextSelected = state.selectedSegmentId

        if (splitV && hitV) {
          const pair = splitSegmentAtTimelineTime(
            hitV.segment,
            t,
            makeId('vseg'),
            makeId('vseg'),
            rightVLinkId
          )
          if (pair) {
            nextV = [
              ...state.videoSegments.slice(0, hitV.index),
              pair[0],
              pair[1],
              ...state.videoSegments.slice(hitV.index + 1)
            ]
            nextSelected = pair[1].id
            didSplit = true
          }
        }

        if (splitA && hitA) {
          const pair = splitSegmentAtTimelineTime(
            hitA.segment,
            t,
            makeId('aseg'),
            makeId('aseg'),
            rightALinkId
          )
          if (pair) {
            nextA = [
              ...state.audioSegments.slice(0, hitA.index),
              pair[0],
              pair[1],
              ...state.audioSegments.slice(hitA.index + 1)
            ]
            if (!splitV) nextSelected = pair[1].id
            didSplit = true
          }
        }

        if (didSplit) {
          set({
            videoSegments: nextV,
            audioSegments: nextA,
            selectedSegmentId: nextSelected,
            hasManualEdits: true
          })
        }
        return didSplit
      },

      trimSegment: (segmentId, nextIn, nextOut) => {
        const state = get()
        const clipsById = new Map(state.clips.map((c) => [c.id, c]))

        const target =
          state.videoSegments.find((s) => s.id === segmentId) ??
          state.audioSegments.find((s) => s.id === segmentId)
        if (!target) return

        const clip = clipsById.get(target.sourceClipId)
        const maxDur = clip?.duration ?? target.sourceOut
        const trimmed = trimSegmentBounds(target, nextIn, nextOut, maxDur)

        const shouldSyncPartner = Boolean(state.linkEnabled && target.linkGroupId)

        const updateList = (list: TimelineSegment[]): TimelineSegment[] =>
          list.map((seg) => {
            if (seg.id === segmentId) return trimmed
            if (shouldSyncPartner && seg.linkGroupId === target.linkGroupId) {
              const pClip = clipsById.get(seg.sourceClipId)
              return trimSegmentBounds(seg, trimmed.sourceIn, trimmed.sourceOut, pClip?.duration ?? maxDur)
            }
            return seg
          })

        const nextV = updateList(state.videoSegments)
        const nextA = updateList(state.audioSegments)
        const nextTotal = Math.max(
          getTrackTotalDuration(nextV),
          getTrackTotalDuration(nextA)
        )

        set({
          videoSegments: nextV,
          audioSegments: nextA,
          playheadSec: Math.min(state.playheadSec, nextTotal),
          hasManualEdits: true
        })
      },

      setSegmentSpeed: (segmentId, speed) => {
        const state = get()
        const clamped = clampSpeed(speed)
        const target =
          state.videoSegments.find((s) => s.id === segmentId) ??
          state.audioSegments.find((s) => s.id === segmentId)
        if (!target) return

        const syncPartner = Boolean(state.linkEnabled && target.linkGroupId)

        const updateList = (list: TimelineSegment[]): TimelineSegment[] =>
          list.map((seg) => {
            if (seg.id === segmentId) return { ...seg, speed: clamped }
            if (syncPartner && seg.linkGroupId === target.linkGroupId) {
              return { ...seg, speed: clamped }
            }
            return seg
          })

        const nextV = updateList(state.videoSegments)
        const nextA = updateList(state.audioSegments)
        const nextTotal = Math.max(
          getTrackTotalDuration(nextV),
          getTrackTotalDuration(nextA)
        )

        set({
          videoSegments: nextV,
          audioSegments: nextA,
          playheadSec: Math.min(state.playheadSec, nextTotal),
          hasManualEdits: true
        })
      },

      setAllSegmentsSpeed: (track, speed) => {
        const clamped = clampSpeed(speed)
        const state = get()
        set({
          videoSegments:
            track === 'video' || track === 'both'
              ? state.videoSegments.map((s) => ({ ...s, speed: clamped }))
              : state.videoSegments,
          audioSegments:
            track === 'audio' || track === 'both'
              ? state.audioSegments.map((s) => ({ ...s, speed: clamped }))
              : state.audioSegments,
          hasManualEdits: true
        })
      },

      toggleSegmentMute: (segmentId) => {
        const state = get()
        set({
          audioSegments: state.audioSegments.map((seg) =>
            seg.id === segmentId && !seg.isSilentSpacer ? { ...seg, muted: !seg.muted } : seg
          ),
          hasManualEdits: true
        })
      },

      setSegmentVolume: (segmentId, volume) => {
        const clamped = Math.max(0, Math.min(2, Math.round(volume * 100) / 100))
        const state = get()
        set({
          audioSegments: state.audioSegments.map((seg) =>
            seg.id === segmentId
              ? { ...seg, volume: clamped, muted: clamped === 0 ? true : seg.muted }
              : seg
          ),
          hasManualEdits: true
        })
      },

      unlinkSegmentPair: (segmentId) => {
        const state = get()
        const target =
          state.videoSegments.find((s) => s.id === segmentId) ??
          state.audioSegments.find((s) => s.id === segmentId)
        if (!target?.linkGroupId) return
        const gid = target.linkGroupId
        set({
          videoSegments: state.videoSegments.map((s) =>
            s.linkGroupId === gid ? { ...s, linkGroupId: null } : s
          ),
          audioSegments: state.audioSegments.map((s) =>
            s.linkGroupId === gid ? { ...s, linkGroupId: null } : s
          ),
          hasManualEdits: true
        })
      },

      deleteSegment: (segmentId) => {
        const state = get()
        const target =
          state.videoSegments.find((s) => s.id === segmentId) ??
          state.audioSegments.find((s) => s.id === segmentId)
        if (!target) return

        const syncPartner = Boolean(state.linkEnabled && target.linkGroupId)
        const shouldRemove = (s: TimelineSegment): boolean =>
          s.id === segmentId || Boolean(syncPartner && s.linkGroupId === target.linkGroupId)

        const nextV = state.videoSegments.filter((s) => !shouldRemove(s))
        const nextA = state.audioSegments.filter((s) => !shouldRemove(s))
        const nextTotal = Math.max(
          getTrackTotalDuration(nextV),
          getTrackTotalDuration(nextA)
        )

        set({
          videoSegments: nextV,
          audioSegments: nextA,
          selectedSegmentId: nextV[0]?.id ?? nextA[0]?.id ?? null,
          playheadSec: Math.min(state.playheadSec, nextTotal),
          hasManualEdits: true
        })
      },

      removeClipFromProject: (clipId) => {
        const state = get()
        const nextClips = state.clips.filter((c) => c.id !== clipId)
        const nextV = state.videoSegments.filter((s) => s.sourceClipId !== clipId)
        const nextA = state.audioSegments.filter((s) => s.sourceClipId !== clipId)
        const nextTotal = Math.max(
          getTrackTotalDuration(nextV),
          getTrackTotalDuration(nextA)
        )
        set({
          clips: nextClips,
          videoSegments: nextV,
          audioSegments: nextA,
          selectedSegmentId:
            state.selectedSegmentId &&
            (nextV.some((s) => s.id === state.selectedSegmentId) ||
              nextA.some((s) => s.id === state.selectedSegmentId))
              ? state.selectedSegmentId
              : (nextV[0]?.id ?? nextA[0]?.id ?? null),
          playheadSec: Math.min(state.playheadSec, nextTotal),
          hasManualEdits: nextClips.length > 0
        })
      },

      clearProject: () => {
        set({
          clips: [],
          videoSegments: [],
          audioSegments: [],
          hasManualEdits: false,
          selectedSegmentId: null,
          playheadSec: 0,
          isPlaying: false
        })
      }
    }),
    {
      limit: 60,
      partialize: (state): UndoableSlice => ({
        clips: state.clips,
        videoSegments: state.videoSegments,
        audioSegments: state.audioSegments,
        hasManualEdits: state.hasManualEdits
      }),
      equality: (past, curr) =>
        past.clips === curr.clips &&
        past.videoSegments === curr.videoSegments &&
        past.audioSegments === curr.audioSegments
    }
  )
)

export function useTemporalHistory() {
  return useStore(useProjectStore.temporal)
}
