# Body health, treatment, and posture

The server simulates six independent regions with 100 HP each: head, chest,
left/right arms, and left/right legs. The compact diagram stays at the bottom
left. In the open inventory, hover or focus a region to see its HP, bleeding,
recovery timers, and limitations. Tooltips use the reusable `TooltipManager`.

| Region | Injury effects |
| --- | --- |
| Legs | Damage gradually slows movement. At 30 HP or less, a leg forces crawling unless usable crutches are equipped. |
| Arms | At 30 HP or less, that hand cannot wield items. One bad arm greatly slows crawling; two prevent crawling. Healthy legs still permit walking. |
| Chest | Damage reduces oxygen capacity, to a minimum of 45% of normal. At 20 HP or less, chest injury forces crawling. Zero HP is fatal. |
| Head | Below 45 HP, vision gradually blurs. At 25 HP or less, building and crutch use are blocked. Below 10 HP, local visual illusions appear. Zero HP is fatal. |

Crutches cost six wood and work in either hand. They require one supporting leg
with at least 70 HP, both arms above 30 HP, head above 25 HP, and chest above
20 HP. Move crutches into the separate offhand slot in the open inventory to
keep the main hotbar free for building. Equipped items stay in inventory when a
hand becomes unusable. The same offhand is shown beside the body and to the left
of the nine-slot hotbar; it can only be edited while inventory is open.

Tap **C** to crouch or stand; from crawling, a tap moves to crouching. Hold **C**
for 500 ms to enter crawling, or to stand directly from crawling. Injuries override
manual requests until recovered. Crutches prevent crouching. Low ceilings defer
standing until there is room. Crouching and crawling use shorter collision
capsules and camera heights, slower movement, and no sprint or jump. Other
players see the current posture rather than just the requested posture.

## Bleeding and healing

Natural healing restores 0.22 HP per second after an eight-second injury delay.
Active bleeding prevents healing:

| Severity | HP lost per second | Natural recovery |
| --- | --- | --- |
| Light | 0.08 | Stops after 20 seconds. |
| Moderate | 0.28 | Stops after 120 seconds, leaving a dormant injury with a 70 HP healing ceiling until bandaged. |
| Heavy | 0.72 | Never stops naturally and can reduce a region to zero. |

A bandage costs two sand and two dirt. Select or drag a bandage from the pack or
hotbar onto a body region to apply it. Treatment stops that region's bleeding and
boosts healing to 1.2 HP per second for 60 seconds, after a short delay. Moderate
injury ceilings are removed immediately. A treated heavy injury keeps a 70 HP
ceiling for 180 seconds; repeating treatment cannot remove that timer early.
Each accepted application consumes exactly one bandage. Damage and death that
occur while the save is pending are preserved.

## Damage and death

Empty oxygen damages only the head, at eight HP per second, without causing
bleeding. A healthy head therefore gives roughly 12.5 seconds to surface after
the oxygen reserve is depleted. Breathing restores oxygen and stops this damage.

Falls of up to three metres are safe. Larger drops damage legs first. Chest and
arm damage begins at six metres, and head damage at ten metres. Bleeding scales
with larger impacts. Water cushions a landing only when it is at least one metre
deep. Normal jumps, walking down steps, and loading terrain do not count as
damaging falls. Zero head or chest HP returns the player to their saved shoreline
spawn with healthy body regions; carried inventory remains intact.

Health is authoritative even when `ANTI_CHEAT_ENABLED=false`. Trusted movement
snapshots cannot overwrite HP, oxygen, injury timers, death counters, or stance
intent. Strict movement uses shared health simulation during prediction and
reconnect input replay. Bandage requests have durable receipts, so retries do
not consume another item or reset severe injury timers.

Head injury illusions affect only client rendering: a bounded set of visual
ghosts and temporarily hidden nearby scenery. Real collision, building rays,
mining, resources, and server world state remain intact. Contact reveals a hidden
object; recovery clears the illusions. Blur affects the landscape, leaving UI
and tooltips readable.

`npm test` covers damage, bleeding, healing, treatment, posture, collision,
persistence, and network authority. `npm run check:inventory` checks the real
browser UI and tap/hold C controls without requiring a GPU.
`npm run check:network-worker` exercises crutches, treatment, stance requests,
and injury-aware reconnect movement against a real server and WebSocket peer.
