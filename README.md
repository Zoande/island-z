# Island Z — World Lab

A TypeScript island explorer with a direct WebGPU/WGSL renderer and a placeholder
first-person capsule controller. No game engine or multiplayer gameplay is included yet.

## Run

Install dependencies with `npm install`, then use two terminals in this folder:

```powershell
npm run server
```

```powershell
npm run dev
```

Open **http://127.0.0.1:5173/** in a desktop browser with WebGPU support. The
server listens on `127.0.0.1:3001`; Vite proxies `/api` requests to it. Both bind
to localhost. Production build output is in `dist`; a deployed client will also
need an `/api` proxy to this server.

Click the landscape to capture the mouse. **WASD** moves, **Space** makes a small
jump, **Shift** sprints, and **Escape** releases the mouse to use settings.
Mouse movement controls the view; looking up/down never changes walking direction
or speed. Settings contains render quality, sun elevation, frame rate and controls.
The flying camera, vertical flight, wheel speed control and flight diagnostics are removed.

The player is an invisible placeholder capsule: no character model or Blender
assets are needed. Walking speed is 4.5 m/s, sprinting is 7 m/s, and the jump rises
about half a meter. Gravity, step handling, steep-slope limits, trunk collision
and sliding run at a fixed 120 Hz. Bush foliage slows movement by 35% rather than
blocking it. Oak, birch and palm trunks use simple collision volumes sized to the assets.
Ground collision follows the actual rendered terrain triangles, including chunk
edges. Nearby terrain is prioritized; movement waits if its collision surface
has not loaded. Rock mesh collision, swimming, fall damage and multiplayer player
simulation are later work.

## World settings

Edit `server/world.config.json`, restart `npm run server`, and refresh the page.

```json
{ "seed": "island-z", "islandSizeMeters": 30720 }
```

The default bounds are **30.72 km across**, 30 times the original 1,024-meter test
world. The irregular coastline sits inside these bounds. Use `1024` for a tiny
test island, `10240` for a smaller landscape, or `61440` for a larger streaming
test. Numeric sizes are supported from 128 to 100,000,000 meters; that upper
guard protects coordinate precision and is not a promise of practical visual
quality at extreme dimensions.

`WORLD_CONFIG` can specify another configuration file; `PORT` overrides the
server port. Update the Vite proxy if changing the port.

Generation is on demand: a larger island does **not** allocate or generate its
whole area on startup. Draw distance controls the working set. The server's
`GET /api/world` supplies the seed, size, and generator version; `GET /api/health`
reports readiness. The server is read-only and has no database or authentication.

## Terrain and rendering

- An irregular island boundary, shallow coastal shelf, rolling lowlands, foothills,
  and three seeded mountain ranges with wandering spines, broad shoulders, gullies,
  and scattered, smoothly blended upland benches.
- Plains and forest vegetation masks, slope/elevation-sensitive materials, and
  deterministic placement independent of chunk order.
- Damp mud in sheltered lowland patches, gravel on loose slopes and back beaches,
  woodland moss and litter, exposed dry meadow, shrubs and sparse pebble patches.
- Worker-generated heightfield chunks, hierarchical detail, fallback parents,
  stitched edges, shallow seam skirts, and bounded resident caches.
- Tree, grass, and rock positions are anchored to the triangles being rendered.
  Rocks align to the support plane and their complete mesh footprint is embedded
  into it. Large footprints also sample neighboring rendered tiles at chunk boundaries.
- Shared texture arrays with independent mip chains prevent atlas bleeding and
  wrap-derivative grid artifacts. Terrain uses triplanar material blending.
- Instanced oak/birch models and 12 procedural fracture-plane rock shapes with broad
  flat undersides, sparse placement, and occasional large outcrops; alpha-tested shadows,
  foliage wind, sky/haze, animated ocean, coastal foam, and tone mapping.
- Coconut palms grow in sparse coastal stands. Ocean coverage follows the same
  seeded island boundary as the terrain; inland low terrain is not automatically ocean.
- Four bounded coastal catchments use priority flooding to find valley routes and
  basin spillways in the existing heightfield. Broad main rivers reach the ocean;
  tributaries can join both main rivers and other tributaries. Lowland channels
  widen downstream, while steep headwaters stay narrow. Only local beds/banks are
  carved, with gravel streambeds and muddy lakebeds.
- Larger lakes follow sampled basin shorelines. Connected river sections share
  the lake plane, then descend through their outlets. Confluences share receiving
  levels, ripple phase, speed and flow direction. River mouths gradually share
  ocean waves, color and foam. Water geometry is clipped consistently to streamed chunks.
- Deep/shallow water color, refracted terrain, sky reflections, sunlight glints,
  fine ripples, shoreline wash, subtle caustics, and slope-dependent river foam.
  A separate water depth buffer handles overlapping lakes, streams and ocean.

This is surface heightfield terrain, not a volumetric underground mesh. There
are no caves, overhangs, erosion simulation, or terrain editing.
Mountain gullies are procedural shaping rather than a drainage simulation.
River routes are a bounded surface-water foundation, not a full rainfall,
rainfall or hydraulic simulation. Catchment metadata and lake fitting are bounded;
the terrain outside local waterbeds remains unchanged.

## Performance and distance detail

| Quality | Tree range | Grass range |
| --- | ---: | ---: |
| Low | 1,800 m | 70 m |
| Medium | 2,600 m | 120 m |
| High | 3,600 m | 170 m |

Nearby trees retain their detailed GLBs. Geometry LODs overlap across 65–95 m
and 180–240 m; the transition to distant views overlaps across 320–480 m.
Both models use complementary screen coverage instead of an abrupt swap.
Per-pixel coverage avoids repeating checkerboards and quantized fade steps.
Grass, shrubs and rocks also blend between detail levels, and scenery fades
through the last 35% of its range. Grass density and player collisions are unchanged.
Oak/birch LODs share branch layouts and leaf cluster centers.

At startup, the GPU bakes eight views of every tree variant into shared color
and surface atlases. Distant trees use those silhouettes with live sunlight,
normals, roughness and haze. Their instance buffers remain reusable while the
camera moves; a nearby origin keeps GPU coordinates precise. Trees are generated
in distant streamed tiles, rather than requiring the whole island. Rocks have
three geometry LODs and grass cards reduce bend segments with distance.

Other optimizations preserve the scene: topology/placement caching, conservative
frustum bounds, front-to-back opaque scenery, compact lossless scenery vertices,
reusable instance arrays, cached static shadow depths, early alpha rejection,
lossless 16-bit indices where possible, cached packed distant-tile transforms,
and a factored version of the same filtered shadow kernel. Wind-driven shadows
still render every frame. Cancelled initialization destroys late GPU devices.

Open `http://127.0.0.1:5173/?profile=1` to capture performance. In the development
browser console:

```js
__island.perf.reset();       // Start a fresh capture at the current view
__island.perf.summary();     // CPU stages, GPU stages, frame intervals and counters
__island.perf.download();    // Save a JSON report
__island.perf.stop();
__island.perf.start();
```

Captures retain at most 1,200 frames. GPU timestamps use three asynchronous
readback buffers and sample every sixth frame, without waiting on the GPU during
rendering. Without timestamp-query support, CPU/FPS logging still works.
CPU timings include streaming, placement, culling, instances, player movement
and submission. GPU timings separate static/moving shadows, terrain, scenery,
water and post-processing; their sum excludes transfers and presentation.
Only sampled frames split terrain/scenery passes. Profiling has a small cost.
GPU memory is an allocation estimate, not a measurement of driver residency.
Instance counts describe submitted material instances; distant trees also undergo
GPU clipping and fading. Worker timings retain the latest 200 chunk generations.

With both servers running, automated Chrome captures and screenshots are available:

```powershell
npm run profile -- final
npm run profile -- validation suite
npm run profile -- movement walk
npm run profile -- optimizations compare
```

The suite includes real keyboard walking, distant-region streaming, sun/quality
changes, resource counts and GPU/browser errors. The comparison holds animation
time fixed and switches draw ordering/static shadow reuse for image verification.
Reports are written to `artifacts/performance-<label>.json`. Chrome must be installed;
Playwright uses its local installation. FPS depends on view, display resolution,
thermal state and other GPU work, so compare matching conditions.

## Assets

Runtime textures are in `public/textures`, exported tree models in
`public/models`, and editable Blender sources in
`assets/sources/temperate-trees.blend` and `temperate-bushes.blend`.
Each tree species has six variants and three
detail levels. A constrained static GLB loader reuses named catalog materials;
models do not contain duplicate embedded texture images.
Four shrub variants have two detail levels. Curved grass cards reuse four atlas
layers: meadow grass, taller seed heads, dry grass and clover. Cutout textures
use premultiplied filtering to prevent colored fringes.
Three palm variants have three detail levels and modeled coconut clusters.
Their editable source is `assets/sources/coastal-palms.blend`.

Base-color and transparent foliage textures were generated with the built-in
ImageGen tool. Exact prompts are retained in `assets/imagegen-prompts.json`.
The expanded ground/understory prompts are in `assets/ecology-imagegen-prompts.json`.
Palm material prompts are in `assets/coast-imagegen-prompts.json`.
Normal/roughness maps were generated separately from procedural relief in
Blender. Their RGB channels contain tangent-space normals and alpha contains
roughness. The generated base-color images are preserved unchanged.

Rebuild editable assets with:

```powershell
npm run assets:materials
npm run assets:trees
npm run assets:bushes
npm run assets:palms
```

These commands require Python and Blender. `BLENDER_PATH` can override the
Blender executable; the scripts default to the installed Blender 5.1 path.
Launching the viewer does not require Blender or Python.

## Checks

```powershell
npm test
npm run build
npm run benchmark:terrain
# Or benchmark a single size:
npm run benchmark:terrain -- 30720
```

Tests cover deterministic generation, beach slopes, mountain continuity, material
weights, shared edges, detail stitching, rendered-triangle placement, rock
support, character movement across frame rates, jumps, terrain steps/slopes,
tree sweeps, bush slowdown, input focus and collision streaming,
ecology/pebble partition stability, every exported GLB, downhill flow,
basin spillways, tributary/ocean connections, lake planes, waterbed continuity,
clipped water boundaries, bounded large-world requests,
and the server protocol. The benchmark
measures sequential CPU generation of the visible working set, including
fallback chunks and scenery, and writes `artifacts/terrain-benchmark.json`.
It excludes asset download, shader compilation, GPU upload, and browser rendering;
the viewer uses up to three workers.

In development, `window.__island` exposes player/camera/world/stream/renderer diagnostics
for inspection. It is omitted from production builds. Browser visual and GPU
checks also use the Playwright profiler above. Inspect beaches, forests, ridges, steep rock placement, and
quality changes, and check the console for rendering errors.

Optional developer checks (Python packages `Pillow` and `wgpu`):

```powershell
python scripts/inspect_textures.py
npx tsx scripts/export-shaders.ts
python scripts/check_gpu.py
```

The GPU check compiles the actual WGSL/pipelines on the local graphics adapter
and compares GPU ocean masking with CPU coastline samples;
it complements browser testing. `scripts/preview_assets.py` renders an inspection
sheet from Blender sources into `artifacts/vegetation-inspection.png`.
