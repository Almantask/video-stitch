import React, { useEffect, useRef } from 'react'

interface WaveformCanvasProps {
  peaks: number[]
  clipDuration: number
  sourceIn: number
  sourceOut: number
  muted: boolean
  volume: number
  widthPx: number
  heightPx?: number
}

export const WaveformCanvas: React.FC<WaveformCanvasProps> = ({
  peaks,
  clipDuration,
  sourceIn,
  sourceOut,
  muted,
  volume,
  widthPx,
  heightPx = 36
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    const drawW = Math.max(16, Math.min(4096, Math.floor(widthPx)))
    const drawH = heightPx

    canvas.width = Math.floor(drawW * dpr)
    canvas.height = Math.floor(drawH * dpr)

    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, drawW, drawH)

    if (!peaks || peaks.length === 0 || clipDuration <= 0) {
      // Flat dashed center line for silent spacer
      ctx.strokeStyle = 'rgba(161, 161, 170, 0.35)'
      ctx.lineWidth = 1
      ctx.setLineDash([4, 4])
      ctx.beginPath()
      ctx.moveTo(0, drawH / 2)
      ctx.lineTo(drawW, drawH / 2)
      ctx.stroke()
      return
    }

    const startRatio = Math.max(0, Math.min(1, sourceIn / clipDuration))
    const endRatio = Math.max(startRatio + 0.001, Math.min(1, sourceOut / clipDuration))
    const startIdx = Math.floor(startRatio * peaks.length)
    const endIdx = Math.max(startIdx + 1, Math.ceil(endRatio * peaks.length))
    const sliced = peaks.slice(startIdx, endIdx)

    const barStep = 3
    const barWidth = 2
    const barCount = Math.max(1, Math.floor(drawW / barStep))
    const midY = drawH / 2
    const gainScale = muted ? 0.25 : Math.min(1.35, Math.max(0.1, volume))

    ctx.fillStyle = muted ? 'rgba(113, 113, 122, 0.55)' : 'rgba(52, 211, 153, 0.85)'

    for (let i = 0; i < barCount; i++) {
      const pIdx = Math.min(
        sliced.length - 1,
        Math.floor((i / barCount) * sliced.length)
      )
      const amp = Math.min(1, (sliced[pIdx] ?? 0.1) * gainScale)
      const barH = Math.max(2, amp * (drawH - 6))
      const x = i * barStep
      const y = midY - barH / 2
      ctx.fillRect(x, y, barWidth, barH)
    }
  }, [peaks, clipDuration, sourceIn, sourceOut, muted, volume, widthPx, heightPx])

  return (
    <canvas
      ref={canvasRef}
      style={{ width: '100%', height: `${heightPx}px` }}
      className="block pointer-events-none"
    />
  )
}
