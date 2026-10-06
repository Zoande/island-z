# Island Z — World Lab

A TypeScript island explorer with a direct WebGPU/WGSL renderer and a placeholder
first-person capsule controller and shared, persistent building. No game engine or
multiplayer player simulation is included yet.

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
or speed on land. In deep water, WASD swims in the direction you look, **Space**
swims up, and **Shift** dives. Idle swimmers slowly sink; looking somewhat up
while swimming forward also keeps you afloat. Settings contains render quality,
time of day, natural day/night cycling, frame rate and controls.
The flying camera, vertical flight, wheel speed control and flight diagnostics are removed.

The player is an invisible placeholder capsule: no character model or Blender
assets are needed. Eye height is 1.968 m, walking speed is 5.175 m/s, sprinting
tops out at 10.465 m/s with a 4.5 m/s² acceleration ramp, and the jump rises
about 0.66 meters (30% higher than the original jump). Each takeoff costs 4 stamina
and insufficient stamina prevents jumping. Gravity, step handling, steep-slope limits, trunk collision
and sliding run at a fixed 120 Hz. Bush foliage slows movement by 35% rather than
blocking it. Oak, birch and palm trunks use simple collision volumes sized to the assets.
Ground collision follows the actual rendered terrain triangles, including chunk
edges. Nearby terrain is prioritized; movement waits if its collision surface
has not loaded. Nearby rocks use the full-detail surface with the same scale,
rotation and burial as the visible mesh. The capsule stops/slides at steep rock
faces, steps across low slabs, and can jump onto suitable surfaces or fall off
their edges. Decorative pebbles and algae remain non-solid. Swimming uses the
same terrain, rock and trunk collisions, with a 3.2 m/s movement limit. Shallow
water supports wading and sloped shores let you walk back out.

The lower-right oxygen bubbles give **60 seconds underwater** in lakes, rivers,
and within 50 meters of the ocean shoreline. Beyond that shoreline buffer,
oxygen drains progressively faster: a full reserve lasts about 30 seconds at
400 meters offshore, 12 seconds at 750 meters, and continues falling farther out.
The timer estimates remaining breath at your current drain rate; the bubbles
show your reserve. Breathing air restores oxygen; running out returns you to the original game spawn with full
oxygen and stamina. Stamina does not recover during acceleration, sprinting or
active swimming. Gentle walking and water idling restore it slowly. A full bar
allows about nine minutes of continuous lake swimming or nearly five minutes in
the ocean. Exhaustion prevents sprinting and makes swimmers sink despite holding
Space, so long open-ocean swims can end in drowning. Idle sinking is intentionally
slower than diving. Vitals use elapsed time even if collision terrain is loading.
Fall damage and multiplayer player simulation are later work.

## Building

The bottom-center hotbar has nine slots. **Q / E** cycles backward/forward within
the selected group. Reselecting a slot preserves its current choice.

| Slot | Catalogue group |
| --- | --- |
| 1 | Rocks: twelve shapes in two sizes |
| 2 | Trees: oak, birch and palm variants |
| 3 | Walls: timber, stone, solid logs and brick |
| 4 | Floors: timber and stone |
| 5 | Roofs: timber and stone |
| 6 | Lighting: ground torch, wall torch and campfire |
| 7 | Furniture: bed, table and chair |
| 8 | Attachments: timber door, braced door and window |
| 9 | Empty hands; hide the preview |

Mouse wheel rotates precisely (one
degree per typical wheel notch); **T** turns 90 degrees; **left click** places.
The first click on an unlocked landscape captures the mouse.

Aim at a visible surface within ten meters while standing on solid ground.
Valid previews are translucent blue and darken gently while moving/looking.
Invalid previews turn red and explain the reason. Grass is allowed; rocks,
trunks, bushes, the player, and existing builds block overlapping placements.
Some canopy overlap is allowed. Trees stay upright; rocks follow and embed into
the terrain. Severe terrain irregularities are rejected.

Walls are 3 m wide and 2.5 m tall, with 22 cm wood and 32 cm stone thickness.
Endpoints snap within 80 cm: wheel/T rotation pivots around the fixed joint,
including corners and mixed materials. Aim at an upper wall face to stack;
stacked walls keep the position and rotation of the wall below. Rock support
requires the entire wall footprint to fit a broad, level top. Walls cannot be
underwater, deeply buried, or left with large gaps below their base. Placed
objects immediately get normal movement collisions and shadows.

Floors and flat roofs are 3 × 3 m modules, 20 cm thick. Floors connect at their
edges and locally lower terrain by **at most 0.4 m**, with a blended margin.
Excavation is non-cumulative; unsupported gaps and substantial excavation are
rejected. Grass and decorative pebbles under a floor are suppressed. Walls snap
to floor edges. Roofs require a wall or another roof edge; they cannot be placed
freely over the ground. Rotation follows structural supports to keep seams aligned. Roofs default over the
supporting floor; T switches which side of a wall they cover.

Placing a door or window automatically cuts an opening in an existing wall.
One opening fits each wall; its frame, ray casts, movement collision and torch
light occlusion all use the same cut. **F** opens/closes a door within 3 m.
Blocked swings are rejected; door state is saved. Wall torches mount on either
face, beside openings. Campfires remain lit. Beds, tables and chairs are decorative
and colliding; sleeping, sitting, fuel and crafting are not introduced.

Furniture, doors, windows, hearths and log walls have editable Blender sources
in `assets/sources/building-catalogue.blend` and static shared-material GLBs.
Rebuild them with `npm run assets:catalogue`. The bed uses a shared ImageGen linen
albedo, with its prompt recorded in `assets/catalogue-imagegen-prompts.json`.

Torches are upright ground stakes with a procedural flame and shared timber/stone
materials. They require dry, reasonably level ground, reject overlaps, collide
with the player, and use the same immediate placement, server validation, and saves.
They stay lit, without fuel or extinguishing in this pass.

## Daylight and night lighting

The automatic cycle gives **3 real hours from sunrise to sunset** (06:00–18:00)
and **1½ real hours from sunset to sunrise**. Settings has a time slider, Dawn/Noon/
Night buttons, and a natural-cycle toggle. Changing time keeps the cycle running
unless paused. Time and pause state are remembered in this browser; an automatic
clock continues across reloads and time away. First visits start at 09:00.
These are local rendering settings; shared multiplayer time can later use the
renderer-independent clock in `shared/daylight.ts` with a server anchor.

Sun direction/color, sky fill, haze, water reflections, foam, underwater light,
and exposure follow the clock. Night has a star field, a procedural moon, cool
moonlight with the normal shadow map, and darker surroundings. Tree impostors
store albedo/normals and relight throughout the cycle. Small directional-light
increments preserve static shadow caching while sunlight moves.

Placed torches provide animated HDR flames, restrained glow, warm flickering
inverse-square light, and analytical occlusion by nearby placed walls. Local light
selection is bounded: Low/Medium/High shade the nearest 8/16/24 lights inside
128 meters, fading between 96 and 128 meters, with up to 16 nearby wall blockers.
Torch meshes remain visible farther away. This pass does not allocate cube shadow
maps for every torch; natural scenery still casts sun/moon shadows.

Placement appears locally before confirmation. The server recomputes support,
ray visibility, snapping and overlap using shared rules, and saves accepted
objects before responding. Rejections undo the placement (and dependent pending
walls). Retries cannot duplicate confirmed objects. Nearby saved builds refresh
every two seconds so other clients see them. Placement is unlimited and open to
everyone; no ownership, resource costs or removal is added. Terrain changes are
limited to the small saved floor excavation stamps.

Saves are append-only journals in `server/saves/`, excluded from Git.
`BUILD_SAVE_DIR` overrides this directory. Seed, size and generator version
identify separate worlds, preserving older saves. A trailing interrupted write
is preserved in a recovery file while complete records reload; corrupt complete
records produce a clear server error. See [building foundations](docs/building.md)
for the registry, protocol, persistence and extension points.

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
reports readiness. `GET /api/builds` streams requested build regions and
`POST /api/builds` validates placements. The server uses local save files and
has no authentication or multiplayer player simulation.

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
- The shallow coastal shelf slopes into progressively deeper offshore water.
  Seabed streaming continues outside the island with the same bounded working set.
  Shallow ocean, lake and river beds have sparse, swaying algae using shared grass
  textures and instancing. Underwater views use depth-dependent blue-green fog,
  mild ripple distortion, and a reflective water underside with a light window.
  Swimming and oxygen follow the geometric ocean waves. Inland water uses the
  generated lake planes and downhill river surface levels.
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

| Quality | Shadow map | Shadow span | Tree view handoff | Tree range | Grass range |
| --- | ---: | ---: | ---: | ---: | ---: |
| Low | 1,024² | 300 m | 240–360 m | 1,800 m | 70 m |
| Medium | 2,048² | 460 m | 320–480 m | 2,600 m | 120 m |
| High | 4,096² | 640 m | 500–700 m | 3,600 m | 170 m |

Low uses one filtered shadow comparison and reduced-detail tree shadow casters;
Medium/High use the four-comparison soft filter and detailed nearby casters.
High retains full tree geometry through 100 m before its first overlap band,
compared with 65 m on Low/Medium. Grass, shrub and rock geometry also stays detailed
farther away on High. Shadow textures are recreated and their previous resources
released when switching presets. Quality changes apply live; High costs more GPU
time and memory. Terrain, object density, rock/trunk collision and bush slowdown
are independent of the chosen preset.

On Medium, nearby trees retain their detailed GLBs. Geometry LODs overlap across 65–95 m
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
swimming controls, shore exits, stamina/exhaustion, oxygen/respawn timing, offshore
depth and algae partition stability,
ecology/pebble partition stability, every exported GLB, downhill flow,
registry variants, convex overlap, wall support/snapping/stacking, physical wall
collisions, placement retries, concurrent conflicts and durable save recovery,
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
`npx tsx scripts/check-swimming.ts` checks real keyboard sprint/ascent/dive,
ocean and elevated-lake swimming, underwater quality changes and drowning reset
in Chrome on this PC, saving screenshots and a report under `artifacts`.
`npx tsx scripts/check-building.ts` checks keyboard selection/cycling, fine and
90-degree rotation, previews, optimistic rollback, confirmed movement collision,
shared build updates and server-restart persistence. It uses isolated temporary
saves and leaves the game's real builds untouched.

`npx tsx scripts/check-daylight.ts` checks time presets, pause/resume and reload
persistence, real torch hotbar/placement input, saved torches, nearby wall light
occlusion, graphics presets, and day/dusk/night/ocean views on this PC. It uses
an isolated server/save directory and writes screenshots and a report to `artifacts`.

`npx tsx scripts/check-catalogue.ts` validates catalogue cycling, bounded floor
excavation, automatic wall openings and rollback, functional doors, furniture,
wall lights, connected roofs, new materials, and restart saves in Chrome.

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

## Destruction and repair

Hold right-click to cut wood, rocks, walls, floors, and roofs within 4 m. Small
buildables dismantle once per press. Hold R to repair surviving structural
builds; T rotates the building preview. Real holes affect collision and shadows.
Cuts, removals, floor grading, openings, and fallen tree pieces are saved.
See [destruction foundations and checks](docs/destruction.md) for architecture,
controls, preparation assets, synchronization, and diagnostics.
