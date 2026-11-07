import React, { useEffect, useMemo, useRef } from 'react'
import {
  Film,
  Pause,
  Play,
  RotateCcw,
  SkipBack,
  SkipForward
} from 'lucide-react'
import {
  computeTrackLayout,
  findSegmentAtTime,
  formatTimecode,
  getTrackTotalDuration
} from '@shared/timelineMath'
import { videoStitchClient } from '../lib/videoStitchClient'
import { useProjectStore } from '../store/useProjectStore'

export const PreviewMonitor: React.FC = () => {
  const clips = useProjectStore((s) => s.clips)
  const videoSegments = useProjectStore((s) => s.videoSegments)
  const audioSegments = useProjectStore((s) => s.audioSegments)
  const playheadSec = useProjectStore((s) => s.playheadSec)
  const isPlaying = useProjectStore((s) => s.isPlaying)
  const setPlayheadSec = useProjectStore((s) => s.setPlayheadSec)
  const setIsPlaying = useProjectStore((s) => s.setIsPlaying)

  const videoRef = useRef<HTMLVideoElement | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const activeVideoSrcRef = useRef<string>('')
  const activeAudioSrcRef = useRef<string>('')

  const clipsById = useMemo(() => new Map(clips.map((c) => [c.id, c])), [clips])
  const computedV = useMemo(() => computeTrackLayout(videoSegments), [videoSegments])
  const computedA = useMemo(() => computeTrackLayout(audioSegments), [audioSegments])

  const vTotal = useMemo(() => getTrackTotalDuration(videoSegments), [videoSegments])
  const aTotal = useMemo(() => getTrackTotalDuration(audioSegments), [audioSegments])
  const totalDuration = Math.max(vTotal, aTotal)

  const hitV = useMemo(() => findSegmentAtTime(computedV, playheadSec), [computedV, playheadSec])
  const hitA = useMemo(() => findSegmentAtTime(computedA, playheadSec), [computedA, playheadSec])

  // Master transport animation loop
  useEffect(() => {
    if (!isPlaying) return
    let rafId = 0
    let lastTime = performance.now()

    const tick = (now: number): void => {
      const dt = Math.min(0.1, Math.max(0, (now - lastTime) / 1000))
      lastTime = now

      const state = useProjectStore.getState()
      const maxDur = Math.max(
        getTrackTotalDuration(state.videoSegments),
        getTrackTotalDuration(state.audioSegments)
      )
      const nextTime = state.playheadSec + dt

      if (maxDur <= 0 || nextTime >= maxDur) {
        state.setPlayheadSec(maxDur)
        state.setIsPlaying(false)
        return
      }

      state.setPlayheadSec(nextTime)
      rafId = requestAnimationFrame(tick)
    }

    rafId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafId)
  }, [isPlaying])

  // Sync <video muted> element to V1 track
  useEffect(() => {
    const vEl = videoRef.current
    if (!vEl) return

    const vClip = hitV ? clipsById.get(hitV.segment.sourceClipId) : undefined
    if (!hitV || !vClip || !vClip.hasVideo) {
      if (!vEl.paused) vEl.pause()
      return
    }

    const mediaUrl = videoStitchClient.toMediaUrl(vClip.filePath)
    if (activeVideoSrcRef.current !== mediaUrl) {
      activeVideoSrcRef.current = mediaUrl
      vEl.src = mediaUrl
      vEl.currentTime = hitV.sourceTime
    }

    const targetRate = Math.min(4, Math.max(0.25, hitV.segment.speed))
    if (Math.abs(vEl.playbackRate - targetRate) > 0.01) {
      vEl.playbackRate = targetRate
    }

    const driftThreshold = isPlaying ? Math.max(0.26, 0.18 * targetRate) : 0.03
    if (Math.abs(vEl.currentTime - hitV.sourceTime) > driftThreshold) {
      try {
        vEl.currentTime = hitV.sourceTime
      } catch {
        // media still loading metadata
      }
    }

    if (isPlaying) {
      if (vEl.paused) {
        vEl.play().catch(() => undefined)
      }
    } else if (!vEl.paused) {
      vEl.pause()
    }
  }, [hitV, isPlaying, clipsById])

  // Sync <audio> element to separated A1 track
  useEffect(() => {
    const aEl = audioRef.current
    if (!aEl) return

    const aClip = hitA ? clipsById.get(hitA.segment.sourceClipId) : undefined
    const shouldSilence =
      !hitA ||
      !aClip ||
      !aClip.hasAudio ||
      hitA.segment.muted ||
      Boolean(hitA.segment.isSilentSpacer) ||
      hitA.segment.volume <= 0.001

    if (shouldSilence) {
      if (!aEl.paused) aEl.pause()
      return
    }

    const mediaUrl = videoStitchClient.toMediaUrl(aClip.filePath)
    if (activeAudioSrcRef.current !== mediaUrl) {
      activeAudioSrcRef.current = mediaUrl
      aEl.src = mediaUrl
      aEl.currentTime = hitA.sourceTime
    }

    aEl.preservesPitch = true
    const targetRate = Math.min(4, Math.max(0.25, hitA.segment.speed))
    if (Math.abs(aEl.playbackRate - targetRate) > 0.01) {
      aEl.playbackRate = targetRate
    }

    const clampedVol = Math.min(1, Math.max(0, hitA.segment.volume))
    if (Math.abs(aEl.volume - clampedVol) > 0.01) {
      aEl.volume = clampedVol
    }

    const driftThreshold = isPlaying ? Math.max(0.26, 0.18 * targetRate) : 0.05
    if (Math.abs(aEl.currentTime - hitA.sourceTime) > driftThreshold) {
      try {
        aEl.currentTime = hitA.sourceTime
      } catch {
        // media still loading metadata
      }
    }

    if (isPlaying) {
      if (aEl.paused) {
        aEl.play().catch(() => undefined)
      }
    } else if (!aEl.paused) {
      aEl.pause()
    }
  }, [hitA, isPlaying, clipsById])

  const handlePlayToggle = (): void => {
    if (totalDuration <= 0) return
    if (!isPlaying && playheadSec >= totalDuration - 0.05) {
      setPlayheadSec(0)
    }
    setIsPlaying(!isPlaying)
  }

  const hasVisibleVideo = Boolean(hitV && clipsById.get(hitV.segment.sourceClipId)?.hasVideo)

  return (
    <section className="flex-1 min-w-0 flex flex-col bg-zinc-950">
      <div className="flex-1 min-h-0 relative flex items-center justify-center p-4 overflow-hidden">
        <div className="relative w-full h-full max-w-4xl flex items-center justify-center rounded-xl bg-black border border-zinc-800/90 overflow-hidden shadow-2xl">
          <video
            ref={videoRef}
            muted
            playsInline
            className={`max-w-full max-h-full object-contain ${
              hasVisibleVideo ? 'opacity-100' : 'opacity-0'
            }`}
          />
          <audio ref={audioRef} className="hidden" />

          {!hasVisibleVideo && (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-zinc-500 pointer-events-none">
              <Film className="w-10 h-10 mb-2 opacity-40" />
              <p className="text-xs">
                {totalDuration > 0
                  ? 'No active video frame at current playhead (Audio-only tail)'
                  : 'Import videos to preview stitched sequence'}
              </p>
            </div>
          )}

          {/* Live status overlay pills */}
          {totalDuration > 0 && (
            <div className="absolute top-3 left-3 flex items-center gap-1.5 pointer-events-none">
              {hitV && (
                <span className="px-2 py-0.5 rounded bg-zinc-900/85 border border-indigo-500/40 text-[11px] text-indigo-300 font-mono">
                  V1: {hitV.segment.label} ({hitV.segment.speed}x)
                </span>
              )}
              {hitA && (
                <span className="px-2 py-0.5 rounded bg-zinc-900/85 border border-emerald-500/40 text-[11px] text-emerald-300 font-mono">
                  A1:{' '}
                  {hitA.segment.muted || hitA.segment.isSilentSpacer
                    ? 'Muted / Silent'
                    : `${hitA.segment.speed}x`}
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Transport bar */}
      <div className="h-12 shrink-0 border-t border-zinc-800 bg-zinc-900/60 px-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => {
              setIsPlaying(false)
              setPlayheadSec(0)
            }}
            disabled={totalDuration <= 0}
            title="Return to 00:00"
            className="p-1.5 rounded-md hover:bg-zinc-800 text-zinc-300 disabled:opacity-35 cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setPlayheadSec(Math.max(0, playheadSec - 0.5))}
            disabled={totalDuration <= 0}
            title="Step back 0.5s"
            className="p-1.5 rounded-md hover:bg-zinc-800 text-zinc-300 disabled:opacity-35 cursor-pointer"
          >
            <SkipBack className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={handlePlayToggle}
            disabled={totalDuration <= 0}
            title="Play / Pause (Space)"
            className="w-8 h-8 rounded-full bg-indigo-600 hover:bg-indigo-500 text-white flex items-center justify-center disabled:opacity-40 transition cursor-pointer"
          >
            {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
          </button>
          <button
            type="button"
            onClick={() => setPlayheadSec(Math.min(totalDuration, playheadSec + 0.5))}
            disabled={totalDuration <= 0}
            title="Step forward 0.5s"
            className="p-1.5 rounded-md hover:bg-zinc-800 text-zinc-300 disabled:opacity-35 cursor-pointer"
          >
            <SkipForward className="w-4 h-4" />
          </button>
        </div>

        <input
          type="range"
          min={0}
          max={Math.max(0.1, totalDuration)}
          step={0.02}
          value={Math.min(playheadSec, Math.max(0.1, totalDuration))}
          disabled={totalDuration <= 0}
          onChange={(e) => {
            setIsPlaying(false)
            setPlayheadSec(Number(e.target.value))
          }}
          className="flex-1 accent-indigo-500 h-1.5 bg-zinc-800 rounded-lg cursor-pointer disabled:opacity-35"
        />

        <div className="font-mono text-xs text-zinc-300 shrink-0 tabular-nums">
          <span className="text-zinc-100 font-semibold">{formatTimecode(playheadSec)}</span>
          <span className="text-zinc-500"> / {formatTimecode(totalDuration)}</span>
        </div>
      </div>
    </section>
  )
}
