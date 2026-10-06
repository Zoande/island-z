# Multiplayer and destruction architecture review

> Historical review of the starting code. The agreed implementation supersedes
> its migration/testing proposals: the test save was deleted, WebSocket was
> selected, and current live verification is limited to one client. See
> [the implementation record](multiplayer-implementation-plan.md).

Reviewed 6 October 2026, against commit `dd9f94c`.

**Verdict.** Keep the hybrid sparse-volume destruction model. Replace the surrounding shared-world orchestration before adding substantial multiplayer gameplay. The present system has sophisticated geometry but incomplete authority, ordering, collision activation, and durability contracts. The proposed multiplayer direction is substantially right, but a Rust rewrite, three networking stacks, a separate gateway, and advanced bit-packing would make the first migration unnecessarily large.

The useful complexity is authoritative simulation, prediction/reconciliation, spatial interest, explicit state versions, asynchronous derived geometry, and transactional persistence. The excess complexity is duplicated state machinery and repeatedly deriving or transferring more geometry than an interaction needs. The missing complexity is the machinery that makes different clients agree on when a change becomes real.

**Evidence and limits.** I read the server, client controllers, renderer integration, shared movement/placement/volume/physics code, relevant tests, and validation scripts. Fresh runs passed all 149 tests in 21 files, TypeScript validation, and the destruction benchmark. Two isolated probes reproduced the snapshot-ordering and connectivity counterexamples below. Probe code/results and test logs are under `artifacts/architecture-review-*`; the benchmark writes `artifacts/destruction-benchmark.json`. I also examined the existing browser prediction report; I did not rerun browser visual checks or conduct a multiplayer load test. Browser timing figures below are therefore previously recorded evidence, not new measurements. Runtime code and actual game saves were not changed.

**1. What exists today, and why destruction exposes deeper problems**

The current server is an HTTP building service with a destruction service, WebSocket subscriptions, a geometry worker, and a falling-body timer added around it. It is not yet an authoritative player simulation. `server/app.ts` accepts client eye/feet/direction and client-selected session IDs. `DestructionStore` validates geometry relative to those claims. `FallingSimulation` advances fragments independently; `BuildStore` and `DestructionStore` maintain separate revisions and save formats.

On the client, placement/doors and destruction have separate request queues and reconciliation systems. Builds refresh through HTTP polling, destruction also arrives through WebSocket patches, and motion arrives through another message type. The renderer supplies movement terrain while edited solids use Rapier queries. These pieces work in isolation but have no common simulation timeline or transaction boundary.

This is an understandable prototype progression. However, making the transport faster would preserve the underlying disagreements. A WebTransport replacement cannot fix a stale-region rule, client-claimed reach, a late collider, or an operation split across two journals.

| Finding | Evidence | Consequence |
| --- | --- | --- |
| A global revision incorrectly gates partial state | `client/destruction.ts:35–40` rejects a whole patch below `worldRevision`. Probe: after revision 11 for one region, a revision-10 snapshot containing a previously unknown wall is discarded. | An unrelated update can make valid damage/removal state disappear from a region load. HTTP groups and WebSocket events make this ordering possible. |
| Input actions are limited by response latency | `client/destruction.ts:75–80` serializes requests, including waiting for each HTTP response. | At 150 ms RTT there is some room below the four-stroke cadence; at 300 ms RTT confirmations cannot sustain four strokes/s. At 1.8 seconds they are limited to about 0.56/s before processing costs. Visible prediction continues accumulating work. |
| Reach and cadence are only partially authoritative | `server/destruction-store.ts:39–54` uses submitted eye/feet and a cadence keyed by submitted session ID. | A public client can claim another location or another session. The server derives the brush correctly, but does not establish that a real player could perform it. |
| Async work still blocks unrelated commands | `DestructionStore.place` awaits collision cooking inside the shared queue; repair awaits support before saving. Synchronous file operations and compression also run in the process handling requests and physics. | A slow repair, placement, checkpoint, or hydration can delay unrelated players. A Promise queue serializes ownership; it does not create CPU or I/O isolation. |
| Replication sends too much | `server/app.ts` checks whether any record in a message matches a subscription and then sends the entire message. Every patch can trigger build polling. Falling pose saves contain full solid records. | Interest filtering is coarse; frequent changes cause unrelated records, source geometry, and existing bricks to be resent. Durable motion checkpoints also invalidate build polling. |
| Snapshot and motion have different ordering rules | Motion has no server tick or geometry dependency. The client blends arrivals over a fixed 60 ms in `client/destruction.ts:67`. | Jitter changes the apparent velocity; an old full-record response can overwrite a newer pose, and new fragments can move before clients have their geometry. |
| Persistence has operation-level gaps | `DestructionStore.place` commits through `BuildStore` before `integratePlacementNow` appends the edited-wall opening. Both stores publish their own checkpoint heads. | For an already damaged wall, attachment placement and its voxel opening can partially succeed if the second save fails. Independent atomic files do not make a cross-store transaction atomic. This is a code-path finding, not a crash reproduced in this review. |

There are good foundations: shared renderer-independent placement rules; derived rather than client-supplied brushes; idempotent request IDs; saves before normal edit acknowledgements; coalesced support jobs with geometry-read validation; sparse generation; local coordinate origins; and bounded caches. Preserve these, while making them parts of one world service.

**2. Is voxel destruction the right approach?**

For arbitrary cuts, repair, real holes, and irregular trees/rocks, yes. The implementation is more accurately an implicit solid source with sparse sampled signed-distance edits than a fully voxelized world. Undamaged objects keep normal instancing; damaged objects derive meshes and collision from their edited field. This fits the existing heightfield world and avoids voxelizing a 30 km island just to cut a wall.

Dual contouring is a defensible surface extraction choice for retaining planar features and representing natural shapes. Its original research addresses Hermite surface data and destructive modifications. This supports the choice of technique, not a claim that this implementation inherits every topological guarantee of the paper. [Ju et al., Dual Contouring of Hermite Data](https://people.eecs.berkeley.edu/~jrs/meshpapers/JuLosassoSchaeferWarren.pdf).

Simpler damage values, decals, or predefined broken variants would be cheaper if the intended gameplay only required knocking objects down. They do not satisfy the current requirement for player-made passages and repair. Conversely, weight/stress simulation, fine debris, and a fully volumetric terrain system are not needed to make the present destruction model coherent.

The important qualifications are:

- **Resolution is object-local.** `VOXEL_SIZE=.025`; transforms scale it into world space. The effective world resolution is 2.5 cm multiplied by object scale. Support/collider steps and error bounds have the same issue. Establish a world-space tolerance and a minimum meaningful feature size rather than treating 2.5 cm as universal.
- **Connectivity can contradict the native field.** Trees and rocks start support analysis at 5 cm. A 2.5 cm pass occurs only if that coarse pass finds multiple components. The probe cut a narrow gap at y=0.425: the native field had two components, but the coarse grid had one. The coarse grid missed the separation, so the current fallback condition would not correct it. This is a resolution counterexample using a synthetic box, not a reproduced tree gameplay sequence.
- **Support is connectivity, not structural strength.** Grounding propagates through sample contacts using centimeter tolerances. Tiny connections and tolerated gaps can carry large structures indefinitely. This may be an acceptable game rule, but define it explicitly. Sampling contact points from component interiors is also a weak substitute for maintaining actual surface contacts.
- **Different systems see different approximations.** Static client collision uses a reduced triangle surface; falling bodies and server placement/contact preparation use compound boxes, with natural trees sampled at 10 cm. Support has another sampling grid. Shared source data alone does not make their passage sizes or contact decisions equal.
- **Visible prediction precedes collision.** Immediate patches are installed synchronously, but full meshes, LODs, and then boxes complete later. Worker results are correctly rejected when outdated, yet repeated cuts can keep invalidating the work needed to install new collision. A visible opening can remain physically closed while jobs catch up.
- **Physics installation changes simulation time.** `SolidPhysics.add` calls `world.step()` while adding each body. In a region with live dynamic bodies, async collider installation advances those bodies outside the intended falling tick schedule. Replace this with a defined tick-boundary update/query-refresh strategy.

These findings justify revising scheduling and tolerances, not throwing out the solid model.

**3. Where the geometry is too expensive**

The fresh standalone benchmark measured the following. It generates full contours without loading the browser's prepared templates; edited mesh timing includes one refinement pass. It excludes networking, browser LOD generation, collider installation, and GPU work. These are local samples, not production capacity estimates.

| Object | Cold full mesh | Edited full mesh range | Component analysis | Compound boxes |
| --- | ---: | ---: | ---: | ---: |
| Wood wall | 1,149 ms | 254–357 ms | 102 ms | 4 |
| Stone wall | 950 ms | 207–249 ms | 170 ms | 5 |
| Wood floor | 982 ms | 203–254 ms | 77 ms | 3 |
| Rock | 1,759 ms | 246–300 ms | 155 ms | 675 |
| Oak | 5,681 ms | 282–411 ms | 162 ms | 567 |
| Birch | 1,949 ms | 152–423 ms | 202 ms | 86 |
| Palm | 2,142 ms | 146–181 ms | 26 ms | 125 |

The previously recorded browser prediction report contains about 87 ms for the first wall input-to-visible CPU commit and 96 ms for the cold oak; the patch portion was about 51/45 ms. At 60 FPS, the frame budget is 16.7 ms. This is much better than waiting seconds for a full mesh, but still enough main-thread work to disrupt camera/input responsiveness. The report's full worker mesh mean was about 2.69 seconds, including additional browser processing.

Preparation helps, but the 15 compressed contour assets total 254.6 MB in decimal units; the largest is 58.5 MB compressed. They load on demand, so this is not an initial download requirement. It is nevertheless a substantial download/decompression/cache cost for a supposedly small local interaction. The contour cache deliberately retains one oversized template beyond its nominal budget. Server residency accounting also estimates bricks as 1,024 bytes even though the retained representation is ordinary JavaScript `number[]`, not packed 16-bit storage. Treat those counters as estimates rather than hard memory limits.

The right simplification is to make derivation incremental and scheduled: typed brick storage; immutable source IDs/content hashes; local dirty patches; cached contact/connectivity summaries; high-priority collision work; and deferred distant LOD work. Avoid eagerly merging/reuploading whole objects and computing every LOD for every near-field edit. Before introducing adaptive octrees or a GPU mesher, measure whether smaller local work and better scheduling are sufficient.

**4. Evaluation of the proposed multiplayer outline**

| Proposal | Assessment for this repository |
| --- | --- |
| WebTransport datagrams; WebRTC fallback; WebSocket services | Good delivery semantics, too many stacks for the first milestone. Define reliable/unreliable lanes behind a transport interface. Prove WebTransport on the actual deployment and keep WebSocket as the initial compatibility fallback. Add WebRTC only for a demonstrated audience/deployment need. |
| Fixed authoritative 20–60 Hz server | Adopt. Separate simulation steps from input-send, snapshot, and persistence rates. Worker completions become tick-boundary commands, not arbitrary mutations. |
| Clients send inputs, never state | Correct for authoritative gameplay state. Clients still send aim, selected tools, command sequences, and timing hints; the server derives location, resources, allowed cadence, and results. Prediction digests can remain comparison hints. |
| Prediction and reconciliation | Essential. Restore a complete authoritative local-player state and replay unacknowledged input sequences. Position alone is insufficient: velocity, jump/coyote/buffer state, vitals, swimming, and collider versions affect the next result. |
| Other entities about 100 ms in the past | Good initial tuning value. Use server timestamps, clock synchronization, and a buffered timeline. Adapt delay to measured delivery jitter; fixed 60 ms blending between arrivals is not sufficient. |
| Rewind capped around 150–250 ms | Sensible candidate range for hitscan, not a universal value. Rewind against validated command/view time, including interpolation delay. It does not eliminate all high-ping fairness tradeoffs. Define doors, destruction, and projectile behavior explicitly. |
| Shared Rust native/WASM simulation | Potential later optimization, not a prerequisite. The repository already shares TypeScript movement, placement, terrain, edits, and Rapier. Rust can consolidate hot paths, but increases migration scope and does not solve inconsistent collision worlds or tick ordering. |
| Networking and simulation in a client worker | Adopt after extracting a pure simulation interface. Keep DOM input and presentation on the main thread; prioritize prediction/networking separately from geometry. Main-thread stalls can still delay delivery of new DOM input to that worker. |
| Binary delta snapshots and bit-packing | Binary schemas and sensible quantization are appropriate. Start with bounded complete snapshots for dynamic state; introduce deltas against client-acknowledged baselines. Advanced bit-packing follows measurements. A delta against a missing unreliable packet is undecodable. |
| Cell interest and two state streams | Adopt logical separation. Geometry creation/removal, damage, inventory, and doors are reliable/versioned; poses are transient. A moving tree has reliable geometry identity plus unreliable motion. Both channels need dependency metadata. |
| 64–128 m cells, one initial process | Good starting scale for spatial interest. Use 128 m provisionally and benchmark. Keep persistent storage grouping, physics islands, rendering tiles, and interest cells independently tunable. A single process-wide entity registry is fine; avoid global scans and global revision assumptions. |
| Thin gateway from the start | Keep a session/routing interface in-process, plus ordinary deployment ingress. A separately deployed forwarding service is unnecessary initially. Routing abstraction alone does not solve future ownership transfers or cross-process interactions. |
| Async dirty-cell persistence and idle unloading | Correct only after specifying durability and lifecycle. Save whole transactions asynchronously and checkpoint cells afterward. Cells with active physics, pending commits/support, relevant neighboring interactions, or outstanding jobs cannot be unloaded just because no player stands inside them. |
| Regional servers and bad-network tests | Adopt. Geographic distance remains a latency floor. Include renderer/CPU stalls, slow storage, dense bases, and cell-crossing behavior as well as packet conditions. |

As of this review, MDN marks WebTransport Baseline 2026, newly available since March 2026 on latest browsers, with older-browser and feature-level caveats. It supports workers and reliable streams as well as datagrams. This makes it a credible target; it still needs HTTPS/HTTP3 deployment and connectivity validation. [MDN WebTransport](https://developer.mozilla.org/en-US/docs/Web/API/WebTransport_API).

WebRTC requires signaling/ICE and can require relay infrastructure; it is not a free fallback adapter. An unreliable DataChannel must be explicitly configured, for example unordered with `maxRetransmits:0`. [MDN WebRTC connectivity](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Connectivity), [MDN RTCDataChannel](https://developer.mozilla.org/en-US/docs/Web/API/RTCDataChannel).

Prediction needs sufficiently consistent simulation and reconciliation, not universal bit-identical simulation. Rapier documents that construction order, initial values, and configuration matter even when using its deterministic WASM build. Native Rust also needs the appropriate determinism configuration if matching WASM exactly is a goal. [Rapier determinism](https://rapier.rs/docs/user_guides/templates_injected/determinism/).

Buffered interpolation reconstructs a timeline rather than chasing packet arrivals. Lag compensation must account for what the client was displaying, not simply subtract half the RTT. [Glenn Fiedler, Snapshot Interpolation](https://www.gafferongames.com/post/snapshot_interpolation/), [Valve, Source Multiplayer Networking](https://developer.valvesoftware.com/wiki/Source_Multiplayer_Networking).

**5. Recommended target structure**

Use one authoritative world service, initially in one Node process, with clear ownership:

| Component | Owns | Does not own |
| --- | --- | --- |
| Session/transport host | Authentication, stable session binding, bounded packet queues, command decoding, routing, transport adapters | Player transforms or world mutations |
| Simulation owner | Player state, entity registry, fixed ticks, command order, interactions, canonical collision activation, reliable world transactions | Rendering, synchronous disk operations, full visual meshing |
| Cell/interest manager | Sparse loaded cells, entity membership/bounds, subscriptions, lifecycle pins, neighboring-cell visibility | Independent authority per cell inside this single process |
| Replication service | Dynamic snapshots, owner input acknowledgements, reliable cell baselines/events, versions and resync | Permission to accept an action |
| Geometry workers | Mesh/collider/support derivation from immutable inputs, tagged results and budgets | Direct mutation of the authoritative world |
| Persistence service | Transaction log, durable receipts, checkpoints, migration, recovery | Choosing simulation outcomes |
| Client simulation worker | Input history, local prediction/replay, replicated collision state, network timestamps | Authoritative support or fragment decisions |
| Client renderer and geometry workers | Camera presentation, visual interpolation, mesh patches/LOD generation | Gameplay authority |

The existing network process can host session/replication and asynchronous persistence coordination. Move the simulation into a worker when establishing the fixed-tick service, and retain geometry workers separately so costly contour jobs cannot occupy the simulation lane. Node workers are intended for CPU work; asynchronous I/O already has suitable facilities. Database libraries with synchronous APIs can run behind a dedicated worker. [Node.js worker threads](https://nodejs.org/download/release/v22.15.0/docs/api/worker_threads.html).

Suggested starting rates are a **30 Hz orchestration tick**, **120 Hz character substeps** to preserve the current controller, **60 Hz fragment physics**, **60 Hz input sends**, and **20 Hz dynamic snapshots**. These are starting settings, not established requirements. Four character substeps and two fragment substeps fit each 30 Hz tick. Match the client's simulation schedule and replay semantics; do not silently change the existing controller to 30 Hz. Raise orchestration to 60 Hz if combat measurements justify it. Bound catch-up work and define what happens during overload.

Input commands should contain session epoch, input sequence, movement/buttons, aim, and timing metadata. Unreliable packets can repeat a small window of recent inputs; process each sequence once, reject stale/impossible timing, and apply a bounded missing-input policy. Discrete build/cut/repair commands need reliable delivery and durable IDs; do not make each wait for the previous HTTP round trip. Commands reference their input sequence so validation uses an established player state. Send the owning client `lastProcessedInput` with authoritative state.

For protocol state, distinguish **server tick**, **connection/server epoch**, **entity geometry revision**, **cell state revision**, and **transaction ID**. A global log sequence is useful for persistence and debugging, but is not proof that every region has been installed. Reliable cell entry is baseline-at-revision followed by ordered events; detect gaps and request resync. Reconnect establishes a new epoch and either resumes a known baseline or reloads it.

Dynamic snapshots carry entity ID/generation, server tick, pose/velocity and required geometry revision. New fragment geometry arrives reliably first; snapshots that refer to missing geometry wait briefly or trigger resync. Removal is a reliable tombstone. For deltas, reference an acknowledged baseline and periodically provide a fresh full snapshot. Respect the transport's actual datagram size, prioritize within a byte budget, and split independent entity groups rather than requiring every packet in a fragmented snapshot. Reliable streams also need application framing. [W3C WebTransport specification](https://www.w3.org/TR/webtransport/).

Keep near-player dynamic and collision interest separate from the kilometers of visual tree range. Subscribe using validated player position, entity bounds, hysteresis, and a margin for fast movement. Send far structures as suitable visual summaries instead of full native-resolution volume state. An entity crossing a cell boundary must receive an enter/baseline and eventual leave, rather than relying on its destination motion packet reaching a client that does not know its ID.

Do not treat cell boundaries as physics walls. Initially, one simulation owner can resolve contacts/support across cells directly. Physics regions need an overlap policy and unique dynamic-body ownership so bodies in adjacent regions interact correctly. That local correctness is needed now; multi-process ghosts and ownership handoff can wait.

**6. Persistence and destruction must join the same contract**

“Save dirty cells later” is acceptable for approximate movement recovery if loss of recent movement on a crash is allowed. It is insufficient for a transaction that consumes inventory, places a wall, cuts an opening, and changes support. Those effects must recover together and retries must not duplicate or partly repeat them.

Use an ordered world transaction containing affected entity/cell IDs, version expectations, canonical changes, durable action receipt, and any pending support job. Persist it asynchronously. For durable gameplay operations, keep a reserved/pending transaction or otherwise prevent dependent operations from spending its effects twice; final acknowledgement and publication occur after durability completes at a tick boundary. Clients can predict during that interval. The simulation never waits on disk inside its tick.

Movement snapshots can remain transient; checkpoint moving poses periodically and persist settled poses/transitions under an explicit recovery policy. A falling body's pose should not rewrite its source and voxel bricks every second. Checkpoints are projections of the transaction log, and one manifest should identify the consistent checkpoint/log position across affected cells. On restart, replay transactions and resume pending work before exposing inconsistent state.

SQLite WAL is a reasonable initial single-host option for unified transactional state; retaining a corrected journal is also possible. It is not necessary to introduce a distributed database. If SQLite is selected, choose sync policy deliberately: WAL `FULL` includes commit synchronization, while `NORMAL` can lose recent committed transactions after power/system failure. [SQLite WAL](https://www.sqlite.org/wal.html).

Keep destruction brushes deterministic for prediction, but have server-state authority and corrections. Broadcast source IDs/hashes plus changed bricks/masks and versions, with full state on baseline/resync. Binary storage should use typed quantized samples. Support results must validate geometry, transforms/contact dependencies, terrain grading, and placement changes they read, then commit atomically. Today the background guard validates geometry versions and placement epoch but does not track motion/contact versions.

Choose a consistent collision activation policy. Ideally a bounded local collider patch becomes active at a named tick and both server/client collision advance to that geometry revision. While that is being built, define the delay explicitly and avoid showing a traversable hole whose collider cannot catch up. Prioritize nearby collision before distant LOD refinement. Physics must never step merely because a worker result was installed.

Destruction cannot be entirely deferred: it already changes collision, ray occlusion, attachments, and persistent entities. Advanced strength simulation and distributed destruction can wait. Reliable edit ordering, collider revisions, and transaction integration are required for the first multiplayer version.

**7. Migration sequence and acceptance criteria**

1. **Make current shared-world state reliable.** Fix per-entity/per-cell snapshot ordering; give motion ticks/dependencies; add bounded queues/resync; remove incidental physics stepping; unify action identity and transaction semantics. Add regressions for the two probes and fault-injection around attachment-plus-opening persistence.
2. **Extract the shared simulation boundary.** Reuse `shared/character.ts`, `BuildScene`, placement, terrain/water, and Rapier. Add explicit complete state capture/restore, fixed-step commands, a canonical simulation environment, and a shared world clock. `client/main.ts` currently queries water with browser-local `performance.now()`; client/server ocean timing must be anchored together. Renderer LOD/stream availability must not define gameplay collision.
3. **Ship two authoritative players over the existing transport.** Add server-owned sessions/spawns/vitals and movement; owner prediction/replay; remote interpolation; reliable building/destruction events; bounded nearby interest. Move simulation/networking into their workers. This establishes correctness before a new transport introduces loss/reordering.
4. **Introduce the transport and bandwidth improvements.** Prove WebTransport under deployment conditions, preserve WebSocket fallback, implement unreliable input/snapshot semantics, then binary quantization and acknowledged delta baselines. Test congestion and bulky cell transfers so reliable loading does not crowd out useful gameplay updates.
5. **Optimize destruction against actual play.** Incremental collision/support, compact bricks/source references, local surface updates, prioritized/cancelable worker jobs, deferred LODs, and measured template/memory budgets. Define minimum meaningful cuts/contacts.
6. **Add combat history when combat exists.** Validate timestamp/sequence windows; history for player hitboxes and relevant blockers; capped rewind with a declared policy for walls that were cut or doors that moved. Do not rewind and mutate the live voxel world for a shot.
7. **Size the server using dense tests.** Player count alone is insufficient. Measure moving players, dense contact graphs, simultaneous cutters, fragment bodies/colliders, cold cell loads, save stalls, and per-client bytes. Treat “a few hundred players” as a hypothesis until those tests fit the tick and memory budgets. A mostly empty map says little about a crowded base.

The network test harness should cover 100/150/300 ms RTT, jitter, 1–5% loss on the unreliable adapter, reordered/duplicate inputs, disconnect after commit but before acknowledgement, reconnect during geometry changes, cell crossings, missing delta baselines, and stale worker results. Also inject 50–100 ms main-thread stalls, slow persistence, unavailable collision cells, and sustained cutting for long enough to reveal growing queues.

Track server tick p50/p95/p99 and overruns, input age, snapshot age/rate/loss, correction count and magnitude, reliable backlog, durable acknowledgement latency, collision activation delay, support lag, geometry queue age, memory, and bytes/client. Example gates: no unbounded pending backlog at the configured action cadence, no duplicated accepted actions after reconnect, consistent inventory/structure recovery after crash injection, no missed region tombstones, and collision decisions that agree at the same published geometry revision. Performance thresholds should be agreed for target hardware/player count, not inferred from the present single-object benchmark.

**Recommendations after agreement and implementation**

1. Keep sparse object-local destruction and the heightfield world. They fit the
   gameplay; native support samples and shared cooked collision fix more than a
   voxel-world rewrite would.
2. Keep one authoritative TypeScript world, input prediction, per-object ordering,
   durable transactions, and bounded worker queues as the architectural center.
3. Use WebSocket through the chosen Cloudflare Tunnel. The current implementation
   record retains sourced WebTransport alternatives for a future deployment decision.
4. Keep existing Rapier narrowly scoped, with server reuse of current collision
   queries. Add no Rust or additional physics integration now.
5. Keep detailed rendering/meshing on clients and immutable delivery on Pages;
   shared movement, edits, support and durability belong on the Pi.
6. Measure large-tree support and full-volume transfer costs on the Pi before
   adding incremental connectivity or dirty-brick replication.
7. Verify deployment with one client only at this stage. Multi-player presentation,
   crowd contact and capacity remain unvalidated until later testing is authorized.
