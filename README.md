# video-stitch
A desktop app that takes multiple videois together and stitches them in one cohesive video.

## Features

- **Multi-Video Input**: Select multiple video files via the native picker or drag-and-drop files anywhere into the app window.
- **Alphabetical Sequence & Reordering**: Automatically sorts imported clips in natural alphabetical order (`A–Z`, e.g., `clip_2.mp4` before `clip_10.mp4`) with drag-and-drop sequence reordering and `A–Z` / `Z–A` sort controls.
- **Separated Audio & Video (`V1` / `A1`)**: Splits video and audio onto independent timeline tracks with live waveform rendering, per-segment mute/volume, optional `Link V+A` synchronization, and export modes for **Combined `.mp4`**, **Separate Video + Audio files**, **Video Only**, or **Audio Only**.
- **Speeding Up, Slowing Down & Cutting**: Non-destructive In/Out edge trimming, Split at Playhead (`S`), Ripple Delete (`Delete`), and `0.25x`–`4.0x` playback speed controls with automatic FFmpeg `atempo` chaining and aspect-ratio/FPS normalization.
- **Undo / Redo & Live Preview**: Dual-element synchronized preview (`Space` to Play/Pause) and 60-step Undo/Redo (`Ctrl+Z` / `Ctrl+Y`).

## Commands

```powershell
# Development mode with hot reload
npm run dev

# Run unit + FFmpeg integration tests
npm test

# Production bundle & standalone Windows desktop app (.exe)
npm run pack
```
