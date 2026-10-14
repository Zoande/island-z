# Performance pass — 14 October 2026

This pass preserves the quality presets, terrain/scenery geometry, foliage density,
lighting budgets, shadow cadence, network rates and 120 Hz character simulation.
Measurements below are CPU microbenchmarks, not whole-game FPS improvements.

## Implemented changes and measurements

| Area | Before → after | Scope |
| --- | --- | --- |
| Terrain generation | 20.56 → 16.27 seconds (~21% less) | Sequential 10,240 m world benchmark; 324 chunks, 395,604 vertices, 108,806 props unchanged |
| Terrain seam/footprint neighborhoods | 0.829 → 0.409 ms (~51% less) | Actual low-quality 3,000 m draw range, 30,720 m island, 187 chunks |
| Same neighborhoods, wide range | 1.686 → 0.698 ms (~59% less) | 16,000 m range, 286 chunks; this is a diagnostic range, not the low preset |
| Solid movement query | 0.0920 → 0.00636 ms (~93% less) | 200 fixed solids, same capsule query result; median of five 5,000-call trials |
| Healthy health tick | 1.79 → 0.196 microseconds (~89% less) | Canonical healthy body, 1/120-second step |
| Bleeding health tick | 1.62 → 0.948 microseconds (~42% less) | Same moderate-bleed body per invocation |
| Active health tooltip layout reads | 2,400 → 28 | 1,200 HUD updates; remaining reads follow 14 actual content changes |

Terrain buffers are allocated at their final size. Skirts reuse their surface
samples, preserving double-precision heights before conversion to the final
Float32 output. Canonical terrain vertex, index and scenery hashes guard output.

Renderer topology changes use indexed chunk neighbors instead of exhaustive
all-pairs searches. Support tile ordering stays unchanged. Per-frame uniform
buffers and resolved resident chunk lists are reused. Lighting candidates compute
their distance once; zero-point-light fragments skip unnecessary work. Mining
clip checks remember empty results, and distant-tree visibility signatures are
scanned only after relevant revisions, without invalidating caches for unrelated
changes.

Physics tracks dynamic-body presence and caches conservative step bounds rather
than repeatedly scanning WASM bodies and transforming the same bounds. Controller
settings change only when their inputs change. Overlap recovery and stepping
remain enabled. A regression test also covers resizing the capsule when changing
posture under an edited ceiling.

Health advances use immutable updates only for changed parts; untouched healthy
bodies keep their reference. UI code caches body/vitals elements and avoids
unchanged tooltip layout and text/style updates. Multiplayer applies each worker
state once instead of revalidating and cloning it on every render frame. Collision
collection avoids intermediate arrays. Destruction job selection uses a stable
linear minimum, and tree meshing avoids redundant primitive-distance calculations
and full pristine contour-map copies for localized edits.

## Validation and limitations

Validation passed: 248 unit tests across 37 files, client/server production builds,
the real Chromium inventory/keyboard check, and the real server/browser
multiplayer-worker check. Canonical tree contour hashes also match the pre-pass
implementation through repeated cuts and repairs.
The multiplayer check exercises crafting, injuries, equipment, treatment, remote
movement, delayed loading and input replay through an outage.

Full rendered profiling was attempted on the default island in low quality. This
cloud machine exposes software WebGPU, whose device was destroyed during startup.
The profiler records this failure rather than presenting unreliable FPS. Actual
GPU frame times, visual playtesting and the perceived improvement on the user's
hardware still need measurement. Destruction benchmark runs were noisy, so no
numeric destruction-speed claim is made. None of these timings add up to a
whole-frame percentage; several apply only when terrain topology changes.

## Recommended next decisions

First profile a real GPU with `npm run profile -- hardware-low walk`. The report
separates CPU stages and GPU passes. This determines whether a further change
should target scenery, material shading, shadows or CPU scene rebuilding.

| Priority | Approach | Expected benefit and visual cost |
| --- | --- | --- |
| 1 | GPU culling/LOD and persistent instance buffers | Larger renderer refactor; can preserve visuals while avoiding CPU scenery traversal and repeated instance uploads during movement. Worth doing if scenery preparation is still CPU-bound. |
| 2 | Reduce distant grass density and shorten its fade range | Strong candidate where alpha overdraw dominates; keep nearby grass intact, but distant ground looks less lush. |
| 3 | Use simpler distant terrain material sampling | Keep full triplanar materials near the player; fewer texture/normal samples farther away. Distant slopes lose some material detail and transition tuning matters. |
| 4 | Switch distant trees to impostors earlier | Fewer triangles and shadow casters; silhouettes and parallax become flatter closer to the player. Existing smooth transitions can hide some of this. |
| 5 | Adaptive render resolution | Low already renders at scale 0.65. Scale 0.55 has about 28% fewer scene pixels than 0.65, but the image becomes softer. This is pixel-count arithmetic, not a predicted FPS gain. |
| 6 | Less frequent distant/static shadow updates or a smaller caster range | Potentially substantial if shadow GPU time dominates; moving shadows may lag, or distant shadows disappear sooner. Keep local moving-object shadows responsive. |
| 7 | Lower point-light/wall-occlusion budgets on low | Helps torch-heavy builds, with fewer simultaneous lights or weaker light blocking. Unlikely to help an unlit outdoor scene. |

Prefer targeted distant-detail changes before reducing close-up detail. Avoid
lowering simulation frequency, increasing network latency or slowing down mining
feedback to save render cost. Worker cancellation/shared generation caches and
asset packing remain possible architecture improvements without visual loss;
they principally affect startup/travel stalls and need separate implementation
and memory tradeoff work.

## Reproducing CPU measurements

- `npm run benchmark:terrain -- 10240`
- `npx tsx scripts/benchmark-renderer-cpu.ts`
- `npx tsx scripts/benchmark-physics.ts optimized`
- `npx tsx scripts/benchmark-health.ts`
- `npx tsx scripts/benchmark-health-ui.ts`

For comparisons, run on the same machine without competing benchmarks and use
multiple trials. The physics script accepts `PHYSICS_MODULE` for a baseline module;
the renderer benchmark includes its former exhaustive algorithm and verifies
identical neighborhood outputs before timing either implementation.
