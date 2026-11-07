import type { VideoStitchAPI } from '@shared/types'

declare global {
  interface Window {
    videoStitch: VideoStitchAPI
  }
}
