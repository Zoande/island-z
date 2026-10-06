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

Existing Rapier local-origin regions simulate falling pieces and query edited
solids. Client and server use identical cooked boxes for edited collision,
independent of detailed render meshes. Terrain movement/swimming retain their
settings. No new physics features or character-controller replacement is added.

## Authority and saving

Joined WSS commands carry input sequence and stable request ID. Server movement
supplies eye/feet/standing; the authority derives brushes and checks reach,
visibility, revision, cadence, repair eligibility and occupancy. HTTP POST world
commands are removed. Reliable edit events and compact receipts are independent
of bulk region baselines.

Skin clipping appears immediately; sparse edit/contour prediction runs in a
worker. Full-object geometry and distant LODs follow separately. The server cooks
collision before durable activation, while connectivity continues asynchronously
after a cut is saved. Native 2.5 cm sampling preserves thin severing gaps. Spatial
contact propagation yields between batches and validates all read dependencies
before committing collapse.

The unified binary journal records a cut and its support-pending marker together.
Build/aperture changes are atomic. Compact receipts, unfinished support, grading,
openings, and fragment poses survive restart. Edited volumes hydrate by cell and
inactive records/caches have limits. Fragment poses use small motion records;
a delayed save cannot overwrite a newer live pose.

Client mesh results validate revision and volume identity. Partial region
snapshots compare per-object versions instead of rejecting an entire older
global revision. Client collision activation is independent of rendering jobs.
There is no legacy save migration. Full sparse object state is still sent on a
geometry change; dirty-brick network deltas remain a measured follow-up.

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

The current `check:destruction` and `check:prediction` entry points delegate to
the single-client multiplayer smoke harness. It covers join, movement, building,
cutting, and reload using isolated saves; it does not claim the older delayed
response/tree/repair browser scenarios. Unit suites cover repair, connectivity,
stale motion, transaction failure and recovery. See
[the implementation record](multiplayer-implementation-plan.md) for evidence and
limits. No live two-player/ten-player validation is performed.
