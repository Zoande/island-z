# GPU scenery culling

Natural scenery candidates are collected when resident terrain, placed objects,
or relevant edits change. Their transforms and bounds are uploaded to persistent
GPU storage. Each frame, a compute pass applies the camera or sun frustum, range,
and LOD selection, compacts survivors into an instance buffer, and writes the
indirect draw count. The CPU path remains available as the exact rendering
fallback.

The culler keeps the existing scene rules:

- Natural props are sourced from ownership chunks at level 4 or finer. Their
  chunk's nearest horizontal distance and each prop's distance stay capped at
  1,000 m. A chunk is kept for candidate selection when it intersects either
  the camera or light frustum.
- Trees use each quality preset's LOD boundaries and complementary screen-door
  transitions. View geometry omits LOD 3, which is the handoff to the existing
  eight-view tree impostors. The impostor atlas, alpha cutoff, coverage fade,
  and 1,024 m snapped origin remain in use.
- Tree shadows use each preset's `shadowLodOffset`: low quality starts at LOD
  1, while medium and high start at LOD 0. Grass and algae do not cast shadows.
  Other props keep their caster range and light-frustum checks.
- Candidate translations and frusta share a local scene origin. World
  coordinates stay at double precision until origin or camera subtraction,
  then use compact Float32 instance records. Wind phase continues to use the
  reconstructed world position.
- Terrain grading, foundations, mining, removed or damaged natural objects,
  and chunk eviction invalidate candidate data or release its GPU buffers.
  Head-injury perception keeps using the CPU path so hidden solids and nearby
  ghosts preserve their presentation behavior.

The focused GPU check compares compute output with the CPU reference for camera
and shadow frusta, LOD transitions, tree handoff, distance fade, natural range,
repeated dispatch, and candidate replacement. It also runs compute followed by
an indirect depth/equal draw in the same command encoder, then compares GPU
readback pixels with the CPU direct draw:

```sh
npx tsx scripts/check-gpu-culling.ts
```

The renderer benchmark runs the actual game with the CPU fallback and GPU
culling enabled in turn. During each sample it changes only the camera yaw,
keeping terrain stream and topology fixed. It reports the CPU `scenery` and
`instanceUpload` stages, fallback view and shadow record counts, persistent
candidate batch slots, GPU batch encoding and frame uniform write cost, and
candidate rebuild counts. No FPS or GPU execution time is inferred from these
measurements.

Start the world server and development client in separate terminals, then run:

```sh
npm run server
npm run dev
npm run benchmark:gpu-scenery
```

Set `PROFILE_URL` if the client is served at another local address. Set
`GPU_SCENERY_ITERATIONS` to change the number of yaw samples (default 1,000).
The renderer benchmark requires Chromium with WebGPU enabled and access to the
running local world server. Compare runs on the same browser and device without
competing workloads. GPU instance counts are sampled asynchronously every 30
frames; `gpuCountSampleAge` reports how many frames old the displayed counts
are. When timestamp queries are supported, the GPU profiler samples render and
compute passes every six frames and reports the `gpuScenery` compute duration
separately from CPU command encoding. The benchmark's `computeEncodeMeanMs` is
CPU encoding time only; it is not GPU execution time.

If browser or WebGPU startup prevents the benchmark from completing, it writes
`artifacts/gpu-scenery-benchmark-failure.json` and prints the same diagnostics.
There are no FPS results unless the full benchmark completes; startup failures,
including software WebGPU/SwiftShader initialization failures, produce no FPS
claim.

The current cloud Chromium/SwiftShader attempt failed during device startup,
before collecting renderer samples. No FPS numbers were collected.

## Validation and cost tradeoffs

Validation passes include the full 262-test suite, client/server production
builds, the browser inventory/stance check, the server/browser network-worker
check, and the focused Chromium WebGPU compute/indirect rendering check. Cache
tests exercise 1,000 camera moves without rebuilding or uploading scenery in a
fixed topology and snapped-origin region, then test mining/removal, placement,
quality, origin changes, capacity reuse/growth and chunk removal. Rocks and
pebbles sharing mesh assets retain independent selection batches.

The refactor trades CPU traversal and per-frame instance uploads for persistent
GPU storage. Candidate records are 128 bytes and shared across material parts,
LOD levels and distance bins; compacted outputs are 44 bytes per reserved
instance slot, per draw batch, with 20% spare capacity when limits allow. GPU
buffer memory is included in the renderer's estimate. Small dynamic groups
(player avatars, damaged/moving solids and hallucinations) retain the CPU path;
far tree impostors retain their existing GPU shader and persistent batches.

GPU floating-point selection and atomic output ordering do not promise identical
whole-game pixels at every numerical boundary. The existing rendering rules and
quality presets remain unchanged; hardware visual playtesting and full-game
frame-time measurement remain outstanding because the cloud software adapter
fails during full viewer startup. The focused GPU test's pixel equality applies
to its controlled fixture, not a full-world screenshot.
