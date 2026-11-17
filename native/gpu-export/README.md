# D3D11 / NVENC export prototype

Production integration (2026-11-17): normal native-composition exports now default
to GPU with an eight-frame state queue; users can select compatibility PNG/x264.
Production mode covers the complete project without diagnostic flags or
per-frame reports. Pacing is uncapped only during GPU export and restored on
completion, cancellation or failure. Packages require `creator-production-gpu-v1`
and the native DLL. The sections below retain diagnostic controls and history.

Opt-in diagnostics only: `video.benchmark` with `gpuVideo: true`, native final
composition and a new destination. The merged GPU diagnostic permits at most
1,800 frames; other diagnostic paths remain capped at 300. An explicit
`fullProject: true` diagnostic permits up to 216,000 frames, only with merged
GPU capture, queue capacity 4 or 8, a new destination and the complete project
range. It requires the `creator-full-export-v1` Player marker. Normal exports keep
the existing PNG / libx264 route. NVIDIA hardware, a compatible driver,
Direct3D 11 and Unity Linear color space are required; failure is explicit.

`GssGpuExport.cpp` copies the display texture into an eight-slot D3D11 pool,
submits NVENC asynchronously, and writes compressed packets on an output
thread. No full-size pixels are mapped/read back. Input texture dimensions,
format, driver capabilities, frame order and output timestamps are checked.
Unity retains its display target until the render callback has accepted it.
The plugin retains native references until draining/destruction finishes.

`mergedFrame: true` can additionally select `queueCapacity: 1`, `4` or `8`.
The host admits at most four immutable state packets per batch; Unity consumes
them sequentially. Queue credits cover pending, active and unreported frames,
with a separate 2 MiB serialized-state budget. Session tokens isolate stale
requests, and cancellation drains the current frame before native disposal.
This reuses the existing display texture and native pool; it does not add
multi-texture rendering or change encoding settings. Queue mode is diagnostic
only and requires the `creator-queued-export-v1` Player capability marker.

Full-project reports retain aggregates, first/last frames and eight slow samples
instead of every frame reply. Native traces and timestamp validation remain
streamed; the sidecar file budget scales with the authorized frame count.
Only the explicit full-project control command gets a 30-minute timeout.
A local 1080p/30fps full export (37,951 frames, 21:05.03) took 174.92 seconds,
including preparation, audio processing and muxing. All frames decoded with
correct CFR timestamps, and audio packet continuity/stream duration passed.
This is one run on an RTX 4090, not a repeated baseline or a full visual/audio
perceptual comparison. Normal UI export remains unchanged.

The first experiment uses H.264 High, P4 HQ, constant QP 18, no B frames and no
lookahead. QP 18 is **not equivalent** to x264 CRF 18. Source frame `i` has
timestamp `i`, duration 1 and time base `1/fps`; the sidecar is validated before
FFmpeg synthesizes these CFR timestamps and stream-copies video into MP4.
Adding B frames/VFR requires a timestamp-aware packet/container interface;
the present raw H.264 contract must not be reused for that change.

Build using `scripts/build-gpu-export.ps1 -Output <new directory>` (VS 2022 C++
tools and Windows SDK). The NVENC header is vendored from:

https://raw.githubusercontent.com/FFmpeg/nv-codec-headers/n12.0.16.1/include/ffnvcodec/nvEncodeAPI.h

SHA-256: `808db2a21232839ee8a6057601f1964e90b20385f6dbf080f3cd33f6470c66c4`.
Its original MIT license is included in the header. The runtime loads
`nvEncodeAPI64.dll` only from the Windows system directory.

Use `scripts/build-player.ps1 -GpuExportPrototype` to stage the native plugin
temporarily in an unoccupied Unity project, build a new Player and remove the
staged DLL. No game resources or private configuration are bundled. The
`creator-gpu-export-v1` capability marker is emitted only if the DLL is present
in the built Player. The first round does not enable GPU export in normal UI.

For a controlled frame-cap A/B, launch a fresh hidden test instance with
`CREATOR_TEST_INSTANCE=1` and `CREATOR_DIAGNOSTIC_UNCAPPED=1`. Only that test
Player uses `Application.targetFrameRate=-1`; other sessions retain 60.
The override lasts for the test process, including pre-roll and preparation.
Export timing snapshots report `targetFrameRate` and `vSyncCount` so the
runner can verify the actual mode. No render, sampling or encoding setting
is changed by this switch. It is not a normal export preference.

The local 2026-11-17 A/B found much shorter loop waits, but uncapped 3D runs
also suffered long submission-acknowledgement stalls. Decoded frames and
audio matched the capped outputs. Do not infer stable throughput from the
fastest sample or enable this as a production default without resolving
those stalls and validating longer exports.

Native CPU wall-time tracing is available only with `CREATOR_TEST_INSTANCE=1`
and `CREATOR_GPU_TRACE_DIR` pointing to a new diagnostic directory. Separate
single-writer JSONL files record each frame's submit and output stages; frame
indices correlate with the existing Unity report. Validate row counts before
using a trace. The spans include API/lock waits and are not GPU timestamps.
Tracing is disabled in normal sessions and does not change encoder settings.

`video.benchmark` may opt into `mergedFrame: true` together with `gpuVideo: true`.
The host requires `creator-merged-export-v1` and an active bounded GPU job.
Each frame carries its state in one request. Unity validates/applies the state,
waits for media, then captures/submits in the same command and replies once.
Scene readiness, animation sampling, settle waits, frame order and native pool
ownership remain in place. The host owns frame dimensions, index and flags;
nested state cannot override them. Failure uses the existing export cleanup.
Normal exports and the default diagnostic mode keep separate requests.
