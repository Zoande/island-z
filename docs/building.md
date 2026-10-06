# Building foundations

## Registry and object data

`shared/object-registry.ts` owns stable object IDs, labels/icons, asset variants,
dimensions and the nine hotbar assignments. Rocks reuse twelve cached procedural
meshes at two fixed sizes; trees reuse the existing fifteen oak/birch/palm models.
Each wall definition has one variant. Q/E cycles definitions and asset variants
within a hotbar group, without random rerolls; the ninth slot is empty. Wood has a dedicated ImageGen albedo and
a procedural normal/roughness texture; stone reuses the shared rock material.
The `fixture` family registers physical dimensions and optional light parameters.
Torch is the first fixture: a dry-ground stake, reused materials, procedural flame,
and a warm light defined in the registry. It saves through the same schema and
needs no owner or fuel state. The catalogue adds mounted torches, campfires,
floor/roof slabs, furniture, doors and windows. Registry metadata specifies shared
box parts, structural dimensions, attachment rules, Blender assets and lights.
The exact built-in ImageGen prompt is in `assets/building-imagegen-prompts.json`.
Rebuild only the timber technical map with `python scripts/build_wall_material.py`.

A saved object contains `id`, `definitionId`, `variant`, `position`, `rotation`,
`normal`, and `support`. Its ID is the placement request UUID. Support records
terrain, a rock ID, or a wall/floor/roof ID plus an edge/top/mount/opening socket.
Doors additionally save optional `state: {open: boolean}`. Objects have no
owner, inventory, durability or resource state in this pass.

The new journal has no legacy save importer. Protocol/generator changes must
be made deliberately when changing source or collision contracts.
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
server validation. Canonical terrain drives both server and client movement; rendering LOD does
not choose ground collision.

Trunks/bushes use vertical volumes; rocks use convex full-detail hulls for
placement, with their full-detail upper triangles for movement/support. Thin
walls use oriented boxes, continuous horizontal capsule sweeps, and top support.
Convex GJK overlap permits small contact tolerance. It does not turn tree canopies
into solid volumes. `shared/build-parts.ts` derives compound wall geometry from
attached openings; GJK tests each physical part rather than closing the opening
with a convex bounding hull. Vertical capsule collision prevents jumping through
floor and roof undersides. Grass, algae and decorative pebbles are non-blocking.

`shared/catalogue-placement.ts` supplies structural and furnishing rules. A door
or window child cuts its parent wall; the parent save record stays unchanged.
Opening geometry, compound colliders, ray casts and analytical light blockers
update together. Rejecting an optimistic child restores the solid wall. Openings
are centered, one per wall, to provide stable future construction sockets.
Mounted torches require intact material beside an opening.

Floor stamps lower original terrain by at most 0.4 m, never cumulatively. Grading
uses the same global 2 m vertex samples for authoritative queries and rendered
terrain, and a blended margin covers interpolation beneath the slab. Grade
before LOD stitching; coarse edge samples must include the same floor stamps.
Only affected chunk meshes and scenery anchors rebuild. Stamps are derived from
saved floor objects and naturally disappear on optimistic rollback. They never
alter the world seed or terrain generator version. Roofs need a wall or another
roof; floor-supported walls align with their supporting floor edge.

Endpoint attachments preserve a joint position and rotate the child about it.
Only a small contact region around that joint permits overlap with its parent;
folding a wall back through its parent is rejected. Top attachments lock to the
parent's center and yaw. Wall-on-rock placement samples the full footprint,
requiring coverage, modest height variation and suitable slope. Walls cannot
intersect water, have substantial burial, or bridge large unsupported ground gaps.

Reach, visible first ray hit, standing state, self-intersection, variants,
finite coordinates and expected transforms are validated. The server derives
position/support from the intent rather than accepting arbitrary object data.
The authority derives eye/feet/standing from its simulated player. Commands
carry their input sequence; client pose fields do not authorize placement.

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
The `BuildTransport` delegates to the network/simulation worker. WSS
`/api/events` carries joined commands and reliable edits. Binary HTTPS baselines
require a connection handle, subscription generation and at most sixteen 512 m
cells per request. Loads occur on region entry and reconnect. Per-object versions
and buffered newer events prevent stale region responses overwriting edits.

Door commands use the same ordered connection. F toggles a visible nearby door;
existing sweep/overlap rules remain shared. A door/window in a damaged wall and
the parent aperture commit in one transaction. Repeated stable request IDs use
bounded saved receipts; changed payloads cannot reuse a receipt.

## Persistence and rendering

`server/build-store.ts` contains in-memory placement rules. The unified journal
worker owns compression, checksums, flushed records and atomic checkpoints for
builds, openings, grading, edits and remembered players. See
[the multiplayer record](multiplayer-implementation-plan.md) and
[deployment/recovery](deployment.md). No old JSONL save loader remains.

Rendering reuses static meshes, named materials, instance batches, LOD fading,
frustum culling and shadow caches. Placed trees retain distant low-detail geometry
instead of requiring a separate atlas per instance. The translucent ghost has
one reusable instance buffer and uniform, no collision or shadows, and alpha
cutouts matching the real foliage. Persistent rocks and trees reuse existing
assets; wall geometry is generated once per definition and opening kind. Blender
exports have no embedded images, animation or extensions. Static pieces merge by
named material before uploading, then reuse shared instance batches. Editable
sources are in `assets/sources/building-catalogue.blend`; rebuild with
`python scripts/build_catalogue.py`. Renderer disposal destroys
the preview buffers along with ordinary GPU resources.

## Checks

`npm test` covers placement, collision, support, retry and transaction rules.
`npm run build` checks TypeScript, client bundles and Pages asset sizes.
`npm run build:server` builds the production Node workers.
`npm run check:multiplayer` checks one Chrome client against an isolated server.
The old building/catalogue browser entry points delegate to that smoke harness;
they do not claim their previous multi-scenario coverage.
