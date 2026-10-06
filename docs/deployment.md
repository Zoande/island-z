# Cloudflare Pages client and Raspberry Pi server

The client is a static Pages site; the Pi owns the live world. The examples use
`play.example.com` and `api.example.com`. Replace both with your domains.
Nothing in this change creates DNS records, publishes Pages, or installs services
on the Pi.

## Pages

Use `npm ci`, build command `npm run build`, and output directory `dist`.
Set `VITE_API_URL=https://api.example.com` in the Pages production environment
**before building**. Vite embeds this address in both the page and networking
worker. Preview deployments need their own explicit address and allowed Origin
if you want them to join the same server.

Use a current Node 24 installation for the build, matching the development
validation. The server bundle targets Node 22, but the complete production path
was checked here on Node 24.11.0, Windows, rather than ARM Linux.

The asset finishing script splits compressed tree contours into content-hashed
segments of at most 8 MiB, emits checksum manifests, and verifies every output
file fits Pages' 25 MiB asset limit. Original source assets stay in `public` for
development and regeneration. Upload the resulting `dist`, not `public`.
[Pages limits](https://developers.cloudflare.com/pages/platform/limits/).

`public/_headers` applies long immutable caching to hashed asset URLs. Live world
and region responses have `Cache-Control: no-store`. Pages does not host the
simulation or cache mutable region responses for the Pi.

## Pi application

Use a 64-bit Raspberry Pi OS installation and a current Node 24 ARM64 build.
The existing Rapier compatibility package supplies WASM; this adds no Rust
toolchain or new physics dependency. Install/build with:

```sh
cd /opt/island-z
npm ci
npm run build:server
```

The runtime needs `dist-server`, production `node_modules`,
`server/world.config.json`, and the fifteen `public/models/*-solid.json` tree
proxy assets. The easiest first deployment keeps the repository checkout on the
Pi. Rendering textures, GLBs, and contour templates are downloaded from Pages;
the Pi does not serve them.

For a foreground launch:

```sh
CLIENT_ORIGINS=https://play.example.com \
WORLD_SAVE_DIR=/var/lib/island-z \
WORLD_CONFIG=/opt/island-z/server/world.config.json \
node dist-server/index.js
```

The process binds only `127.0.0.1:3001`. Set `CLIENT_ORIGINS` to a comma-separated
list of exact client origins, without trailing slashes. Requests from other
browser origins are rejected. This is an Origin policy, not authentication:
anyone with the link can join, and a browser's remembered identity is not a
verified account.

For systemd, create a dedicated `island-z` user/group, make the checkout readable
by that user, copy [the environment example](../deploy/island-z.env.example) to
`/etc/island-z.env`, and edit its paths/domain. Copy
[the service example](../deploy/island-z.service.example) to
`/etc/systemd/system/island-z.service`. Check `command -v node` and adjust
`ExecStart` if Node lives elsewhere. The service creates its writable
`/var/lib/island-z` data directory through `StateDirectory`.

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now island-z
sudo journalctl -u island-z -f
```

## Tunnel

Install `cloudflared` using Cloudflare's instructions and configure the public
hostname `api.example.com` to route to `http://127.0.0.1:3001`. A dashboard-managed
Tunnel needs that route in its published application configuration. For a
locally managed named Tunnel, adapt
[the ingress example](../deploy/cloudflared.yml.example), including the actual
UUID and credentials file. Keep the credentials outside the repository.
[Published application protocols](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/routing-to-tunnel/protocols/).

The browser uses HTTPS for bootstrap/bulk regions and WSS `/api/events` for live
messages. Check the zone's WebSockets setting. Cloudflare supports proxied
WebSockets on all plans; edge restarts can disconnect them, so the client has
keepalive and reconnect. No special WebTransport or UDP ingress is used.
[WebSockets](https://developers.cloudflare.com/network/websockets/).

Do not put a sign-in challenge in front of the public game API: this version has
no login flow. You can keep management/SSH endpoints separate from the game.

## Verify with one client

1. Check `curl http://127.0.0.1:3001/api/health` on the Pi. It waits for the world
   worker to initialize and returns 503 if unavailable.
2. Check the public health endpoint using the configured Origin:
   `curl -H 'Origin: https://play.example.com' https://api.example.com/api/health`.
3. Open the Pages client, choose a nickname, walk, place a wall, cut it, and reload
   the same browser. Confirm that edits and remembered state return.
4. Use `?netdebug=1` for RTT, snapshot frequency, and correction distance in
   Settings. The development console also exposes `__island.multiplayer.metrics`
   and destruction timing reports. `/api/performance` needs an allowed Origin
   when the production allowlist is configured.
5. Restart the game service cleanly and reconnect with the same browser. Check
   the log for save/worker errors. Do not infer multi-player capacity from this.

No two-client or ten-client live test is part of the current verification.
Actual Pi/Tunnel operation has not been tested from this workspace.

## Saves and recovery

The old test save was deleted at the user's request. There is no importer or old
format loader. `WORLD_SAVE_DIR` selects the new journal directory. Leave it
outside build/deploy output so publishing a new bundle cannot wipe the world.

Accepted edits are acknowledged after a checksummed journal record is flushed.
Player/vitals and motion state checkpoint roughly once per second; a hard crash
may lose the interval since the last checkpoint. Disconnect and clean shutdown
flush player state. Offline players have no simulated capsule and their vitals
pause. New checkpoints compact current state rather than retaining every stroke.

An incomplete final journal frame is truncated during recovery. A checksum error
in a complete record fails loading. Keep the full save directory when diagnosing
that error. Cell files are a rebuildable projection of the committed journal;
they are reconstructed on startup.

For a consistent backup, stop the service, copy the entire save directory, then
restart it. Protocol/generator changes need corresponding client/server builds;
there is no backwards compatibility promise. Changing seed or map size selects
a different world key. Bump the protocol when changing the simulation contract.
