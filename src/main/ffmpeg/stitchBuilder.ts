import { getSegmentTimelineDuration } from '../../shared/timelineMath'
import type {
  DurationPolicy,
  ExportResolution,
  SourceClip,
  TimelineSegment
} from '../../shared/types'

export interface StitchCommandPlan {
  inputArgs: string[]
  filterComplexScript: string
  mapArgs: string[]
  expectedDurationSec: number
  hasVideoOutput: boolean
  hasAudioOutput: boolean
}

export function parseResolution(res: ExportResolution): { width: number; height: number } {
  const [wStr, hStr] = res.split('x')
  const width = Number.parseInt(wStr, 10) || 1920
  const height = Number.parseInt(hStr, 10) || 1080
  return { width, height }
}

/**
 * Builds chained FFmpeg `atempo` filters keeping each stage within [0.5, 2.0]
 * so extreme slow-motion (e.g. 0.25x) and fast-forward (e.g. 4.0x) work reliably.
 */
export function buildAtempoFilters(speed: number): string[] {
  if (!Number.isFinite(speed) || speed <= 0 || Math.abs(speed - 1) < 1e-4) {
    return []
  }

  const stages: string[] = []
  let remaining = speed

  while (remaining < 0.5 - 1e-6) {
    stages.push('atempo=0.5')
    remaining /= 0.5
  }

  while (remaining > 2.0 + 1e-6) {
    stages.push('atempo=2.0')
    remaining /= 2.0
  }

  if (Math.abs(remaining - 1) >= 1e-4) {
    const rounded = Number(remaining.toFixed(5))
    stages.push(`atempo=${rounded}`)
  }

  return stages
}

export interface BuildFilterPlanOptions {
  clipsById: ReadonlyMap<string, SourceClip>
  videoSegments: readonly TimelineSegment[]
  audioSegments: readonly TimelineSegment[]
  includeVideo: boolean
  includeAudio: boolean
  resolution: ExportResolution
  fps: number
  durationPolicy: DurationPolicy
}

export function buildStitchCommandPlan(options: BuildFilterPlanOptions): StitchCommandPlan {
  const {
    clipsById,
    videoSegments,
    audioSegments,
    includeVideo,
    includeAudio,
    resolution,
    fps,
    durationPolicy
  } = options

  const { width, height } = parseResolution(resolution)
  const inputArgs: string[] = []
  const filterLines: string[] = []
  let nextInputIdx = 0

  const addClipSliceInput = (filePath: string, sourceIn: number, rawDuration: number): number => {
    const idx = nextInputIdx++
    inputArgs.push(
      '-ss',
      Math.max(0, sourceIn).toFixed(4),
      '-t',
      Math.max(0.05, rawDuration).toFixed(4),
      '-i',
      filePath
    )
    return idx
  }

  // 1. Video track chain
  const vLabels: string[] = []
  let vTotalDuration = 0

  if (includeVideo && videoSegments.length > 0) {
    videoSegments.forEach((seg, i) => {
      const clip = clipsById.get(seg.sourceClipId)
      const rawDur = Math.max(0.05, seg.sourceOut - seg.sourceIn)
      const spd = seg.speed > 0 ? seg.speed : 1
      const segDur = getSegmentTimelineDuration(seg)
      vTotalDuration += segDur
      const label = `vseg${i}`

      if (clip && clip.hasVideo) {
        const inIdx = addClipSliceInput(clip.filePath, seg.sourceIn, rawDur)
        filterLines.push(
          `[${inIdx}:v:0]trim=duration=${rawDur.toFixed(4)},setpts=(PTS-STARTPTS)/${spd.toFixed(5)},fps=${fps},scale=${width}:${height}:force_original_aspect_ratio=decrease:force_divisible_by=2,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,format=yuv420p,setpts=PTS-STARTPTS[${label}]`
        )
      } else {
        filterLines.push(
          `color=c=black:s=${width}x${height}:r=${fps}:d=${segDur.toFixed(4)},setsar=1,format=yuv420p,setpts=PTS-STARTPTS[${label}]`
        )
      }
      vLabels.push(`[${label}]`)
    })
  }

  // 2. Audio track chain
  const aLabels: string[] = []
  let aTotalDuration = 0

  if (includeAudio && audioSegments.length > 0) {
    audioSegments.forEach((seg, i) => {
      const clip = clipsById.get(seg.sourceClipId)
      const rawDur = Math.max(0.05, seg.sourceOut - seg.sourceIn)
      const spd = seg.speed > 0 ? seg.speed : 1
      const segDur = getSegmentTimelineDuration(seg)
      aTotalDuration += segDur
      const label = `aseg${i}`

      const isSilent =
        seg.muted ||
        Boolean(seg.isSilentSpacer) ||
        !clip ||
        !clip.hasAudio ||
        seg.volume <= 0.0001

      if (!isSilent) {
        const inIdx = addClipSliceInput(clip.filePath, seg.sourceIn, rawDur)
        const atempoChain = buildAtempoFilters(spd)
        const tempoPart = atempoChain.length > 0 ? `,${atempoChain.join(',')}` : ''
        const volPart =
          Math.abs((seg.volume ?? 1) - 1) > 1e-3 ? `,volume=${seg.volume.toFixed(3)}` : ''

        filterLines.push(
          `[${inIdx}:a:0]atrim=duration=${rawDur.toFixed(4)},asetpts=PTS-STARTPTS${tempoPart}${volPart},aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,asetpts=PTS-STARTPTS[${label}]`
        )
      } else {
        filterLines.push(
          `anullsrc=channel_layout=stereo:sample_rate=48000,atrim=duration=${segDur.toFixed(4)},aformat=sample_fmts=fltp:channel_layouts=stereo,asetpts=PTS-STARTPTS[${label}]`
        )
      }
      aLabels.push(`[${label}]`)
    })
  }

  const hasVideo = vLabels.length > 0
  let hasAudio = aLabels.length > 0

  // If combined video+audio was requested, video exists, and audio track was emptied by user,
  // generate a clean silent stereo track matching V1 so all players see a standard A/V MP4.
  if (includeVideo && includeAudio && hasVideo && !hasAudio && vTotalDuration > 0) {
    filterLines.push(
      `anullsrc=channel_layout=stereo:sample_rate=48000,atrim=duration=${vTotalDuration.toFixed(4)},aformat=sample_fmts=fltp:channel_layouts=stereo,asetpts=PTS-STARTPTS[aseg_fill]`
    )
    aLabels.push('[aseg_fill]')
    aTotalDuration = vTotalDuration
    hasAudio = true
  }

  // Reconcile V1 and A1 lengths when both outputs are active
  let expectedDurationSec = 0
  let trimAudioToVideo = false

  if (hasVideo && hasAudio) {
    const diff = vTotalDuration - aTotalDuration
    if (durationPolicy === 'video') {
      expectedDurationSec = vTotalDuration
      if (diff > 0.02) {
        filterLines.push(
          `anullsrc=channel_layout=stereo:sample_rate=48000,atrim=duration=${diff.toFixed(4)},aformat=sample_fmts=fltp:channel_layouts=stereo,asetpts=PTS-STARTPTS[apad_tail]`
        )
        aLabels.push('[apad_tail]')
      } else if (diff < -0.02) {
        trimAudioToVideo = true
      }
    } else {
      // 'longest'
      expectedDurationSec = Math.max(vTotalDuration, aTotalDuration)
      if (diff > 0.02) {
        filterLines.push(
          `anullsrc=channel_layout=stereo:sample_rate=48000,atrim=duration=${diff.toFixed(4)},aformat=sample_fmts=fltp:channel_layouts=stereo,asetpts=PTS-STARTPTS[apad_tail]`
        )
        aLabels.push('[apad_tail]')
      } else if (diff < -0.02) {
        const padVidDur = Math.abs(diff)
        filterLines.push(
          `color=c=black:s=${width}x${height}:r=${fps}:d=${padVidDur.toFixed(4)},setsar=1,format=yuv420p,setpts=PTS-STARTPTS[vpad_tail]`
        )
        vLabels.push('[vpad_tail]')
      }
    }
  } else if (hasVideo) {
    expectedDurationSec = vTotalDuration
  } else if (hasAudio) {
    expectedDurationSec = aTotalDuration
  }

  const mapArgs: string[] = []

  if (hasVideo) {
    if (vLabels.length === 1) {
      filterLines.push(`${vLabels[0]}null[vout]`)
    } else {
      filterLines.push(`${vLabels.join('')}concat=n=${vLabels.length}:v=1:a=0[vout]`)
    }
    mapArgs.push('-map', '[vout]')
  }

  if (hasAudio) {
    const rawOutLabel = trimAudioToVideo ? 'acat_raw' : 'aout'
    if (aLabels.length === 1) {
      filterLines.push(`${aLabels[0]}anull[${rawOutLabel}]`)
    } else {
      filterLines.push(`${aLabels.join('')}concat=n=${aLabels.length}:v=0:a=1[${rawOutLabel}]`)
    }

    if (trimAudioToVideo) {
      filterLines.push(
        `[acat_raw]atrim=duration=${vTotalDuration.toFixed(4)},asetpts=PTS-STARTPTS[aout]`
      )
    }
    mapArgs.push('-map', '[aout]')
  }

  return {
    inputArgs,
    filterComplexScript: filterLines.join(';\n'),
    mapArgs,
    expectedDurationSec,
    hasVideoOutput: hasVideo,
    hasAudioOutput: hasAudio
  }
}
