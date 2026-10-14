# Inventory and crafting

Press **E** to open your field inventory. It has twenty-nine slots total: nine
hotbar slots and a twenty-slot pack. A separate left-hand offhand slot stays
beside the body panel and is not part of the hotbar. Resources and most crafted
items stack to 100; crutches stack to one. Click an occupied slot, then a
destination to move, combine, or swap items. Offhand moves use inventory slot
index 29 in commands. Press **E** or **Escape** to close, then click the
landscape to resume mouse look. Select hotbar slots with **1–9**.

The Health tab opens by default and contains a segmented body diagram. Head,
chest, arms, and legs have separate health and bleeding. Leg injuries slow
movement; severe leg injuries can force crawling unless you carry crutches in
either hand. Head or chest injuries can prevent building, and a badly injured
right arm prevents cutting, mining, digging, and repair. Oxygen and stamina stay
server-owned along with health.

The Craft tab shows hand recipes, material costs, and current resource counts.
Crutches cost six wood. A bandage costs two sand and two dirt; choose an injured
body part and a pack slot containing a bandage to treat it. Bandages stop that
part's bleeding and speed recovery for a short time. An untreated severe bleed
leaves a healing ceiling; a bandage stops it and starts a 180-second timer before
full recovery can resume. Treatment consumes exactly one bandage from the
selected slot.

Tap **C** to crouch or stand; from crawling, tap to crouch. Hold C for half a
second to enter crawl or stand directly from crawl. Injuries and ceiling
clearance override unsafe stance requests, and crutches prevent crouching.
See [body health and posture](health.md) for all thresholds and damage rules.

Hold **right mouse** to cut trees, mine rocks, or dig terrain. A successful tree
stroke grants three wood; a rock stroke grants two stone; a terrain stroke grants
one dirt, sand, or stone according to its material. Failed strokes, repair, and
cutting crafted objects do not grant resources. Resources are collected directly
when there is room in inventory; there are no dropped pickup objects yet.

Hand crafting makes timber and stone walls, floors, torches, crutches, bandages,
and a crafting desk.
Craft the desk with ten wood, put it in a hotbar slot, select it, and click to place
it. Aim at a desk within three metres and press **E** to open its expanded Craft
window. Desks add roofs, furniture, doors, windows, wall torches, campfires, and
additional wall materials. All recipes are defined in `shared/inventory.ts`.

Placing a build consumes one crafted item. Existing placed builds remain in the
world; new players start with an empty inventory. Natural scenery is no longer
available from the hotbar catalogue. Rotation and floor tilt controls continue:
**T** turns other builds, **T** tilts floors by 5°, and the wheel adjusts by 1°.
**F** operates doors; **R** repairs surviving walls and roofs.

The server owns inventory and health in both anti-cheat and trusted movement
modes. Crafting, moving, harvesting, building, and treatment run in each
player's ordered command stream. Inventory changes are journalled with the
associated edit, placement, or health update so a restart cannot save a build
without spending its item, save a cut without its resource grant, or restore a
bandage without its treatment. Private snapshots contain revisions and
acknowledged inputs. The client predicts inventory changes, then reconciles them
with server snapshots. Retries reuse the same receipt and do not spend an item
twice. Expanded recipes require a nearby desk with an unobstructed interaction
ray on the server.

Validation: `npm test` covers stacks, crafting, persistence, retries, mining
rewards, optimistic inventory reconciliation, and two WebSocket clients in both
movement modes. `npm run check:inventory` exercises the real inventory UI in
Chromium without requiring a GPU and saves health/crafting screenshots under
`artifacts/`. `npm run check:network-worker` checks real worker crafting, private
inventory updates, pack moves, and preservation through a simulated outage.
