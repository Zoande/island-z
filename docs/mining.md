# Terrain mining

Hold right-click while looking at ground within four metres. The existing stroke
interval is 250 ms; terrain strokes have a 32 cm radius and 40 cm depth. The
same action can continue downward into a pit or sideways into a tunnel. R still
repairs built structures and cannot restore terrain.

The procedural terrain remains the initial solid shape. Its existing two metre
triangles define the surface, including mountains, slopes, valleys, and seabeds.
The original surface materials form a thin skin; the blend becomes entirely
stone 24 cm inside that local surface, measured along its normal. There is no
global altitude that separates grass from stone.

Only touched one metre cells allocate edited distance samples. Each cell uses
the existing 2.5 cm sparse voxel format, with a heightfield continuing through
its ownership boundaries. Strokes are mirrored into neighbouring sample halos;
roughness uses world coordinates so seams share the same values. Unmined ground
does not require a voxel allocation or a mesh rebuild.

The server validates reach, revision, and cadence using the authoritative
player pose. Its existing geometry worker edits all affected cells and cooks
bounded collision boxes at 10 cm resolution. It checks every cell revision,
saves one journal patch, then activates and broadcasts that patch. Reconnects
and region loads reuse the existing reliable world state channel and journal.
Player movement and build placement query the excavated volume and select a
floor beneath their reference position, preserving overhead surfaces.

Client geometry workers mesh individual cells and assign their surface/stone
weights. Finished cells replace the procedural skin in the terrain and shadow
passes. Clip lists are local to each terrain tile. Grass, pebbles, algae, and
bushes disappear where their supporting surface has been removed. Mining
waits for accepted geometry rather than predicting terrain removal ahead of
the server's collision state. Existing object destruction retains prediction.

This first version adds no ore, drops, inventory, tools, or crafting. Terrain
does not collapse, and mining does not automatically destabilize existing
trees or buildings. Water keeps its existing surface rules rather than flowing
through excavations. Falling debris still uses its existing coarse ground
surface; precise voxel cave collision currently applies to players. Already
mined cells retain their captured surface profile during later floor grading.

Validation is deliberately limited: `npm run typecheck` and the focused
`tests/mining.test.ts` suite with one test worker. No full game build, live
browser session, load test, or multiple-player test is required for this pass.
