# Destruction and repair

With the mouse captured, hold **right-click** to cut at four strokes per second,
within four meters. This works in every hotbar slot. Furniture, doors, windows,
torches, and campfires dismantle once per press. Grass, bushes, and decorative
pebbles are unaffected. Hold **R** to repair surviving built walls, floors, and
roofs. **T** rotates the building preview by 90 degrees; wheel rotation and Q/E
selection remain available. Releasing pointer lock or window focus stops actions.

Wood starts with approximately 24 cm wide, 10 cm deep cuts; stone starts with
15 cm wide, 4 cm deep cuts. Registry hardness and `DESTRUCTION.playerPower` control
these sizes. The server derives brushes rather than accepting client geometry.
Cuts have interior faces, shadows, and collision openings. The player can pass
through a sufficiently wide and tall hole, but shallow scratches remain solid.

Repair adds supported material toward the original shape. It cannot repair
natural wood/rock, completely removed objects, or fill a player's capsule or
another object. Occupied door/window openings remain protected. Dismantling an
attachment leaves its opening; empty openings can be repaired. Floor grading is
an independent, persistent edit and survives destruction of its floor.

## Solids and future mining

`shared/volume.ts` defines versioned solid sources, sparse 8³ signed-distance
bricks, 2.5 cm samples, quantized distances, component masks, clip planes, and
deterministic subtract/restore brushes. Box, closed branch capsule, cylinder,
convex rock, and heightfield sources use the same interfaces. A future terrain
mining implementation can start with the heightfield solid and sparse edits;
this pass does not excavate terrain or replace terrain streaming with voxels.

Hermite samples and constrained dual contouring retain structural faces and
smooth natural surfaces. Planar retriangulation and topology-preserving mesh
refinement reduce triangles; material borders remain locked. Prepared tree
contour templates include immutable surface patches and their detail levels,
preserve runtime samples and cells exactly and are versioned
against the complete source. Rebuild them after changing tree solid proxies:

```powershell
npm run assets:solids
```

Preparation assets are compressed and loaded in the geometry worker on demand.
Missing or obsolete assets fall back to deterministic generation. Undamaged
objects retain instanced meshes. Damaged geometry has its own fading distance
levels, all derived from the damaged surface; it never becomes an intact distant
tree or wall. Branch-owned foliage uses the corresponding tree detail level.

Support follows connected material and actual terrain/object contacts, including
alternate supports. Placement-parent IDs alone do not anchor an object. Severed
tree wood carries its foliage, topples, and can split into substantial saved
pieces after a hard impact. Tree pieces remain cuttable and colliding. Other
unsupported objects fall and disappear two seconds after settling, or after
15 seconds. No weight/strength simulation or tiny debris is implemented.

Rapier supplies local-origin falling regions and capsule queries against edited
solids. Static edited surfaces use welded, topology-preserving collision meshes reduced with a 2.5 mm object-space error bound; moving pieces use compound
convex boxes that retain their openings. Existing terrain movement and swimming
settings are retained. An index of climbable faces avoids costly automatic stepping attempts against tall trunks; the step height and slope limits are unchanged. Sleeping pieces and inactive regions stop simulation.

## Authority and saving

`POST /api/actions` validates world identity, reach, occlusion, aim, revision,
cadence, repair eligibility, and occupancy. Action IDs are deduplicated. Clients
predict edits, reconcile acknowledgements, roll back failures, and rebase pending
actions. `/api/events` streams region snapshots, changes, and authoritative motion.
Player movement remains client-controlled in this pass.

Local input raycasts against the current predicted solid and edits its sparse
samples synchronously. A native-spacing dual-contour patch replaces only the
surface around the brush, including actual interior faces. A dedicated skin
clipping pipeline also clips its depth and shadow passes; unchanged scenery
uses its existing pipelines. GPU upload and visible installation happen before
sending the action. Full-object meshes, distance levels, and collision cooking
remain worker jobs and cannot delay this visible response. Their results are
checked against both revision and actual volume before installation.

The client submits an intent and a canonical digest of its predicted result.
The server independently validates and derives the edit against its own world;
it never trusts client mesh data or the digest as permission. Matching edits
receive small acknowledgements over HTTP and the originating WebSocket. Only
differences or edits with additional effects require a correction patch to that
client. Other clients receive the authoritative geometry state. Rejection
restores the affected local surface and rebases remaining predictions.

Support graphs, disconnected sections, collapse, and falling physics run only
on the server's non-rendered world copy. Clients interpolate the resulting
fragment states; they do not calculate support or decide what falls.

A cut is journaled and acknowledged before expensive support/collider work.
Queued support analysis coalesces strokes and verifies every geometry revision
it read before committing collapse. Concurrent changes invalidate old analysis.
Unfinished support work is saved so restart resumes it safely.

Build checkpoints preserve prior saves and IDs, independent openings, permanent
leveling, damage, removals, and fragment poses. Immutable region files plus an
atomic checkpoint head bound replay. Decoded server records and worker contour
caches have resident budgets. One contour template larger than the worker budget is retained by itself rather than repeatedly regenerated; the reported worker cache size can exceed the nominal 96 MB budget for the largest oak. World seed and terrain-generator version remain
unchanged. Save failure rejects the action before publishing it.

## Diagnostics and checks

Use `?profile=1` and `__island.perf.summary()` for CPU/GPU frame stages. Use
`__island.building.destruction.debugReport()` for input, aim, outstanding actions,
geometry queue, and timings. Console lines beginning `[destruction]` contain JSON
details. `/api/performance` reports server edit, support, geometry, and physics
timings. Resident geometry bytes are an allocation estimate.

```powershell
npm test
npm run build
npm run check:destruction
npm run check:prediction
npm run check:solids
npm run benchmark:destruction
npm run profile -- voxel-depth depth-compare
```

Browser destruction checks use an isolated save directory and HTTP/WebSocket
server, exercise real input, holes, repair, rejection rollback, and falling tree
pieces, and write reports/screenshots to `artifacts`. They do not edit your save.
The prediction check delays server responses by 1.8 seconds and blocks the
background geometry worker, then checks a first wall cut, rejection rollback,
a cold tree cut, compact acknowledgements, and eventual worker finalization.
`artifacts/prediction-validation.json` separates mesh/upload time from total
input-to-visible-commit time. On this PC the latest run measured 51 ms for the
wall patch and 45 ms for the cold oak patch (87/96 ms including targeting and
the sparse edit), with no WebGPU validation errors. These are local CPU commit
times; the next rendered frame adds the current frame interval. Collision
cooking and authoritative support remain asynchronous and are measured separately.
