# Overrun networking review

Reviewed [DH4410/Overrun](https://github.com/DH4410/Overrun) at
`42f64791386346ba4a0e6e2c9430e9dff720e3fc`. The older Zoande fork did not
contain the current multiplayer implementation. This was a source review;
Overrun was not installed or playtested here.

Useful patterns in `src/net/predict.js`, `src/net/client.js`, and `server/room.js`
include shared movement simulation for prediction and replay, a reconnect token
that retains a player's seat, bounded snapshot interpolation, and up to 100 ms
of velocity extrapolation when remote snapshots arrive late. Island Z already
shares its movement simulation and buffers remote snapshots. It now applies
the short extrapolation window to presentation only, snapping respawns and
limiting prediction when a connection remains stale.

Island Z's reconnect recovery additionally replays bounded input history on the
server so permitted movement during a short outage can count. Overrun's seat
resumption resets input numbering; it is not a ready-made offline-movement
validation system. Island Z must check elapsed time, one-use tokens, collision,
and vitals against its changing island and edited geometry.

Overrun's hitscan rewind, weapon prediction, arena state, and hosting governor
do not map directly to Island Z's persistent mining and building world. They
were not introduced. Its small visual correction smoothing is also a useful
idea, but applying it safely to Island Z would need to keep camera interaction
rays separate from presentation offsets; this change does not alter those rays.
