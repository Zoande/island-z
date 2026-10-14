# Inventory and crafting

Press **E** to open your field inventory. The hotbar has nine slots; the pack
above it has twenty slots in five columns and four rows. Resources and crafted
items stack to 100. Click an occupied slot, then a destination to move, combine,
or swap a stack between the pack and hotbar. Press **E** or **Escape** to close,
then click the landscape to resume mouse look. Select hotbar slots with **1–9**.

The Health tab opens by default and contains a segmented body diagram. Body
regions are reserved for future injury mechanics; this change does not add damage
or a separate health simulation. Existing oxygen and stamina mechanics continue.
The Craft tab shows hand recipes, material costs, and current resource counts.

Hold **right mouse** to cut trees, mine rocks, or dig terrain. A successful tree
stroke grants three wood; a rock stroke grants two stone; a terrain stroke grants
one dirt, sand, or stone according to its material. Failed strokes, repair, and
cutting crafted objects do not grant resources. Resources are collected directly
when there is room in inventory; there are no dropped pickup objects yet.

Hand crafting makes timber and stone walls, floors, torches, and a crafting desk.
Craft the desk with ten wood, put it in a hotbar slot, select it, and click to place
it. Aim at a desk within three metres and press **E** to open its expanded Craft
window. Desks add roofs, furniture, doors, windows, wall torches, campfires, and
additional wall materials. All recipes are defined in `shared/inventory.ts`.

Placing a build consumes one crafted item. Existing placed builds remain in the
world; new players start with an empty inventory. Natural scenery is no longer
available from the hotbar catalogue. Rotation and floor tilt controls continue:
**T** turns other builds, **T** tilts floors by 5°, and the wheel adjusts by 1°.
**F** operates doors; **R** repairs surviving walls and roofs.

The server owns inventory in both anti-cheat and trusted movement modes. Crafting,
moving, harvesting, and building run in each player's ordered command stream.
Inventory changes are journalled with the associated edit or placement so a
restart cannot save a build without spending its item, or save a cut without its
resource grant. Private snapshots contain a revision and the acknowledged action
ID. The client predicts crafting, moves, and item consumption immediately, then
replays outstanding actions over the confirmed inventory. Retries reuse the same
receipt and do not spend or grant twice. Expanded recipes require a nearby desk
with an unobstructed interaction ray on the server.

Validation: `npm test` covers stacks, crafting, persistence, retries, mining
rewards, optimistic inventory reconciliation, and two WebSocket clients in both
movement modes. `npm run check:inventory` exercises the real inventory UI in
Chromium without requiring a GPU and saves health/crafting screenshots under
`artifacts/`. `npm run check:network-worker` checks real worker crafting, private
inventory updates, pack moves, and preservation through a simulated outage.
