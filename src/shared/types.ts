export type TrackType = 'video' | 'audio'

export interface SourceClip {
  id: string
  filePath: string
  fileName: string
  fileSize: number
  duration: number
  width: number
  height: number
  fps: number
  videoCodec: string
  hasVideo: boolean
  hasAudio: boolean
  audioCodec: string | null
  thumbnailPath: string | null
  waveformPeaks: number[]
}

export interface TimelineSegment {
  id: string
  sourceClipId: string
  label: string
  track: TrackType
  /** Shared ID linking a video segment and its corresponding audio segment when linked editing is enabled */
  linkGroupId: string | null
  /** Start offset in the source file (seconds) */
  sourceIn: number
  /** End offset in the source file (seconds) */
  sourceOut: number
  /** Playback speed multiplier (e.g. 0.25 to 4.0) */
  speed: number
  /** Audio track mute flag */
  muted: boolean
  /** Audio gain multiplier (0.0 to 2.0, default 1.0) */
  volume: number
  /** True if generated as silent filler for a video clip that had no audio stream */
  isSilentSpacer?: boolean
}

export interface ComputedTimelineSegment extends TimelineSegment {
  timelineStart: number
  timelineDuration: number
  timelineEnd: number
}

export type ExportMode = 'combined' | 'separate' | 'video-only' | 'audio-only'
export type ExportResolution =
  | '1920x1080'
  | '1280x720'
  | '3840x2160'
  | '1080x1920'
  | '720x1280'
export type AudioExportFormat = 'mp3' | 'wav' | 'm4a'
export type DurationPolicy = 'longest' | 'video'

export interface ExportSettings {
  mode: ExportMode
  resolution: ExportResolution
  fps: 24 | 30 | 60
  audioFormat: AudioExportFormat
  durationPolicy: DurationPolicy
  outputPath: string
}

export interface ExportJobRequest {
  jobId: string
  clips: SourceClip[]
  videoSegments: TimelineSegment[]
  audioSegments: TimelineSegment[]
  settings: ExportSettings
}

export interface ExportProgressEvent {
  jobId: string
  percent: number
  currentTimeSec: number
  totalDurationSec: number
  phase: string
}

export interface ExportJobResult {
  success: boolean
  canceled?: boolean
  outputPaths: string[]
  error?: string
}

export interface FfmpegHealth {
  available: boolean
  ffmpegPath: string | null
  ffprobePath: string | null
  version: string | null
  error?: string
}

export interface ProbeBatchResult {
  clips: SourceClip[]
  errors: Array<{ filePath: string; message: string }>
}

export interface VideoStitchAPI {
  checkHealth: () => Promise<FfmpegHealth>
  selectVideoFiles: () => Promise<string[]>
  selectAudioFiles: () => Promise<string[]>
  getPathForFile: (file: File) => string
  probeFiles: (filePaths: string[]) => Promise<ProbeBatchResult>
  chooseExportPath: (
    defaultName: string,
    mode: ExportMode,
    audioFormat: AudioExportFormat
  ) => Promise<string | null>
  startExport: (request: ExportJobRequest) => Promise<ExportJobResult>
  cancelExport: (jobId: string) => Promise<boolean>
  onExportProgress: (callback: (event: ExportProgressEvent) => void) => () => void
  showItemInFolder: (filePath: string) => Promise<void>
  toMediaUrl: (filePath: string) => string
}
