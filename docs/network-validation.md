# Multiplayer network validation

Run `npm run check:multiplayer` to start a local server, load the rendered Chromium client, connect a protocol peer, and check movement, building, mining, and reload persistence. The harness also injects a 1.2 second region baseline delay and exercises reconnect restoration. It requires working WebGPU; Chromium in software-rendering environments may lose its graphics device and stop before the rendered movement assertion completes.

Run `npm run check:network-worker` to test the real multiplayer worker on a blank page without WebGPU. It delays the first baseline while inputs and server acknowledgements continue, verifies the worker against a protocol peer, then drops the worker socket while holding movement. The test checks local movement during the two-second grace, no continued prediction after the grace, and exact authoritative position restoration on reconnect.

During a socket outage, the worker simulates locally for at most two seconds. It never queues or sends disconnected inputs. The next welcome replaces the local state with the server state and starts a fresh input sequence.
