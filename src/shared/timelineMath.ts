import type { ComputedTimelineSegment, TimelineSegment } from './types'

export const MIN_SEGMENT_SOURCE_DURATION = 0.05
export const MIN_SPEED = 0.25
export const MAX_SPEED = 4.0

export function clampSpeed(speed: number): number {
  if (!Number.isFinite(speed)) return 1
  return Math.min(MAX_SPEED, Math.max(MIN_SPEED, Math.round(speed * 100) / 100))
}

export function getSegmentTimelineDuration(
  seg: Pick<TimelineSegment, 'sourceIn' | 'sourceOut' | 'speed'>
): number {
  const inPt = Number.isFinite(seg.sourceIn) ? seg.sourceIn : 0
  const outPt = Number.isFinite(seg.sourceOut) ? seg.sourceOut : 0
  const rawLen = Math.max(0, outPt - inPt)
  const spd = Number.isFinite(seg.speed) && seg.speed > 0 ? seg.speed : 1
  return rawLen / spd
}

export function computeTrackLayout(segments: readonly TimelineSegment[]): ComputedTimelineSegment[] {
  let cursor = 0
  return segments.map((seg) => {
    const timelineDuration = getSegmentTimelineDuration(seg)
    const timelineStart = cursor
    const timelineEnd = cursor + timelineDuration
    cursor = timelineEnd
    return {
      ...seg,
      timelineStart,
      timelineDuration,
      timelineEnd
    }
  })
}

export function getTrackTotalDuration(segments: readonly TimelineSegment[]): number {
  return segments.reduce((acc, s) => acc + getSegmentTimelineDuration(s), 0)
}

export interface ActiveSegmentLookup {
  segment: ComputedTimelineSegment
  index: number
  /** Offset into the source media in seconds at the requested timeline time */
  sourceTime: number
}

/**
 * Finds the segment active on a track at `timelineTime` (seconds) and calculates
 * the exact corresponding timestamp inside the source media file.
 */
export function findSegmentAtTime(
  computedTrack: readonly ComputedTimelineSegment[],
  timelineTime: number
): ActiveSegmentLookup | null {
  if (!Number.isFinite(timelineTime) || computedTrack.length === 0 || timelineTime < 0) return null

  for (let i = 0; i < computedTrack.length; i++) {
    const seg = computedTrack[i]
    const isLast = i === computedTrack.length - 1
    const within =
      timelineTime >= seg.timelineStart &&
      (timelineTime < seg.timelineEnd || (isLast && timelineTime >= seg.timelineStart))
    if (within) {
      const localElapsed = Math.min(
        seg.timelineDuration,
        Math.max(0, timelineTime - seg.timelineStart)
      )
      const sourceTime = Math.min(seg.sourceOut, seg.sourceIn + localElapsed * seg.speed)
      return { segment: seg, index: i, sourceTime }
    }
  }

  return null
}

/**
 * Splits a segment at `timelineSplitTime` into two contiguous segments.
 * Returns `null` if the split point does not fall strictly inside the segment
 * with at least `MIN_SEGMENT_SOURCE_DURATION` on both sides.
 */
export function splitSegmentAtTimelineTime(
  computedSeg: ComputedTimelineSegment,
  timelineSplitTime: number,
  leftId: string,
  rightId: string,
  newRightLinkGroupId: string | null
): [TimelineSegment, TimelineSegment] | null {
  if (
    !Number.isFinite(timelineSplitTime) ||
    timelineSplitTime <= computedSeg.timelineStart ||
    timelineSplitTime >= computedSeg.timelineEnd
  ) {
    return null
  }

  const localOffset = timelineSplitTime - computedSeg.timelineStart
  const splitSourcePoint = computedSeg.sourceIn + localOffset * computedSeg.speed

  if (
    splitSourcePoint - computedSeg.sourceIn < MIN_SEGMENT_SOURCE_DURATION ||
    computedSeg.sourceOut - splitSourcePoint < MIN_SEGMENT_SOURCE_DURATION
  ) {
    return null
  }

  const { timelineStart: _ts, timelineDuration: _td, timelineEnd: _te, ...base } = computedSeg

  const leftSeg: TimelineSegment = {
    ...base,
    id: leftId,
    sourceOut: Number(splitSourcePoint.toFixed(4))
  }

  const rightSeg: TimelineSegment = {
    ...base,
    id: rightId,
    linkGroupId: newRightLinkGroupId,
    sourceIn: Number(splitSourcePoint.toFixed(4))
  }

  return [leftSeg, rightSeg]
}

/**
 * Trims `sourceIn` and/or `sourceOut` of a segment while clamping within `[0, maxClipDuration]`
 * and enforcing `MIN_SEGMENT_SOURCE_DURATION`.
 */
export function trimSegmentBounds(
  seg: TimelineSegment,
  nextIn: number,
  nextOut: number,
  maxClipDuration: number
): TimelineSegment {
  const safeIn = Number.isFinite(nextIn) ? nextIn : seg.sourceIn
  const safeOut = Number.isFinite(nextOut) ? nextOut : seg.sourceOut
  const safeMax = Number.isFinite(maxClipDuration)
    ? Math.max(MIN_SEGMENT_SOURCE_DURATION, maxClipDuration)
    : Math.max(MIN_SEGMENT_SOURCE_DURATION, seg.sourceOut)

  let clampedIn = Math.max(0, Math.min(safeIn, safeMax - MIN_SEGMENT_SOURCE_DURATION))
  let clampedOut = Math.min(safeMax, Math.max(safeOut, clampedIn + MIN_SEGMENT_SOURCE_DURATION))

  if (clampedOut - clampedIn < MIN_SEGMENT_SOURCE_DURATION) {
    clampedIn = Math.max(0, clampedOut - MIN_SEGMENT_SOURCE_DURATION)
  }

  return {
    ...seg,
    sourceIn: Number(clampedIn.toFixed(4)),
    sourceOut: Number(clampedOut.toFixed(4))
  }
}

export function formatTimecode(seconds: number, showTenths = true): string {
  if (!Number.isFinite(seconds) || seconds < 0) return showTenths ? '00:00.0' : '00:00'
  const hrs = Math.floor(seconds / 3600)
  const mins = Math.floor((seconds % 3600) / 60)
  const secs = Math.floor(seconds % 60)
  const tenths = Math.floor((seconds - Math.floor(seconds)) * 10)

  const mm = String(mins).padStart(2, '0')
  const ss = String(secs).padStart(2, '0')
  const base = hrs > 0 ? `${String(hrs).padStart(2, '0')}:${mm}:${ss}` : `${mm}:${ss}`
  return showTenths ? `${base}.${tenths}` : base
}
