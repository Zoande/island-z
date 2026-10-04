# Building foundations

## Registry and object data

`shared/object-registry.ts` owns stable object IDs, labels/icons, asset variants,
dimensions and the nine hotbar assignments. Rocks reuse twelve cached procedural
meshes at two fixed sizes; trees reuse the existing fifteen oak/birch/palm models.
Both wall definitions have one variant. Wood has a dedicated ImageGen albedo and
a procedural normal/roughness texture; stone reuses the shared rock material.
The `fixture` family registers physical dimensions and optional light parameters.
Torch is the first fixture: a dry-ground stake, reused materials, procedural flame,
and a warm light defined in the registry. It saves through the same schema and
needs no owner, fuel state, model file, or additional placement endpoint.
The exact built-in ImageGen prompt is in `assets/building-imagegen-prompts.json`.
Rebuild only the timber technical map with `python scripts/build_wall_material.py`.

A saved object contains `id`, `definitionId`, `variant`, `position`, `rotation`,
`normal`, and `support`. Its ID is the placement request UUID. Support records
terrain, a rock ID, or a wall ID plus the endpoint/top socket. Objects have no
owner, inventory, durability or resource state in this pass.

Keep existing registry IDs stable. Save schema version 1 is independent of the
terrain generator version. Changes to saved formats or existing asset/collision
dimensions need an explicit migration rather than silently moving old builds.
Adding an object within an existing family uses a registry definition, variants,
GPU assets/materials, and its physical dimensions. A new family should supply its
support/collision/render behavior at those extension points; do not add new
hotbar-input or save-format branches for every individual item.

## Placement and collision

`shared/build-scene.ts` has no browser or renderer dependencies. It samples the
same globally aligned two-meter triangles as full-detail terrain, keeps bounded
height/generated-scenery caches, and indexes placed collision bounds in spatial
cells. `shared/object-colliders.ts` centralizes physical model dimensions.
`shared/build-placement.ts` performs the same raycast and rules for previews and
server validation. The renderer's streamed terrain continues to drive player
ground contact; building transforms stay canonical and do not shift with LOD.

Trunks/bushes use vertical volumes; rocks use convex full-detail hulls for
placement, with their full-detail upper triangles for movement/support. Thin
walls use oriented boxes, continuous horizontal capsule sweeps, and top support.
Convex GJK overlap permits small contact tolerance. It does not turn tree canopies
into solid volumes. Grass, algae and decorative pebbles are non-blocking.

Endpoint attachments preserve a joint position and rotate the child about it.
Only a small contact region around that joint permits overlap with its parent;
folding a wall back through its parent is rejected. Top attachments lock to the
parent's center and yaw. Wall-on-rock placement samples the full footprint,
requiring coverage, modest height variation and suitable slope. Walls cannot
intersect water, have substantial burial, or bridge large unsupported ground gaps.

Reach, visible first ray hit, standing state, self-intersection, variants,
finite coordinates and expected transforms are validated. The server derives
position/support from the intent rather than accepting arbitrary object data.
There is no authoritative player simulation yet: eye/feet/standing come from
the client and are checked against world geometry. Replace these pose claims
with server player state when multiplayer movement is implemented.

## Optimistic state and transport

`client/building.ts` keeps region snapshots separate from optimistic pending
objects and confirmed objects awaiting their snapshot. Pending objects render
and collide immediately. Requests are serialized so dependent walls cannot
reach the server before their parent. Rejection removes the pending object and
its pending descendants. Network timeout also rolls back; subsequent snapshots
reconcile a placement whose acknowledgment was lost.

Confirmed local objects remain overlaid until a sufficiently recent snapshot
contains their ID, preventing an older in-flight response from making them
disappear. Region revisions prevent stale batches overwriting newer batches.
The `BuildTransport` interface isolates HTTP polling from input/placement so a
later event transport can replace it without changing those rules.

`GET /api/builds?cells=cx:cz,...&since=revision` accepts up to 64 ownership cells
per request. Ownership cells are 512 meters; a bounding spatial index covers
cross-cell collision extents. An unchanged revision returns an empty unchanged
response. Clients request only a quality-dependent nearby radius, cache those
cells, and evict others. Snapshots refresh every two seconds. Save objects are
not coupled to terrain chunk regeneration.

`POST /api/builds` accepts a `BuildRequest`: request ID, world key, definition,
variant, requested rotation, eye/direction, feet/standing, and expected preview
transform/support. Success returns the canonical object and world revision;
failure returns an error code/reason. Requests are limited to 8 KiB. Reusing a
confirmed ID with a different request is rejected. Repeating an identical
confirmed request returns its existing object without another journal record.
The world key prevents stale clients placing into a changed server world.

## Persistence and rendering

`server/build-store.ts` indexes confirmed objects and appends successful actions
to a per-world JSONL journal. It flushes the journal before success, then updates
memory. Startup reconstructs objects, connections, revisions and retry receipts.
An interrupted final line is preserved separately and removed from the journal;
corrupt completed records fail loading instead of silently discarding builds.
Files are namespaced by seed, size and generator version. No removal API exists.

Rendering reuses static meshes, named materials, instance batches, LOD fading,
frustum culling and shadow caches. Placed trees retain distant low-detail geometry
instead of requiring a separate atlas per instance. The translucent ghost has
one reusable instance buffer and uniform, no collision or shadows, and alpha
cutouts matching the real foliage. Persistent rocks and trees reuse existing
assets; wall geometry is generated once per definition. Renderer disposal destroys
the preview buffers along with ordinary GPU resources.

## Checks

`npm test` covers placement, convex separation, full footprint support, wall
collisions, snapping/stacking, idempotent retries, conflicting requests, journal
reload and interrupted-write recovery. `npm run build` checks all TypeScript and
the production bundle. `npx tsx scripts/check-building.ts` exercises real Chrome
input, GPU rendering, rollback, collision, remote snapshots, stacked-wall
rotation locking and restart saves
against an isolated server; screenshots/reports go under `artifacts`.
