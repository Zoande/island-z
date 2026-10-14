import type { LodBoundary } from './lod';

/** One immutable scenery candidate. Every position is relative to the same
 * scene origin as the frame camera and frustum planes. */
export interface GpuSceneryCandidate {
  /** Translation xyz, scale, quaternion xyzw. */
  transform: Float32Array | readonly number[];
  /** Sphere center xyz and radius. */
  sphere: readonly [number, number, number, number];
  /** Prop translation xz, used for the horizontal distance rules. */
  horizontal: readonly [number, number];
  /** Additional view clip cap. Natural candidates still obey the 1000m rule. */
  maxRange: number;
  /** Per-prop range/fade and LOD boundaries, needed for scale-specific models. */
  range?: number;
  boundaries?: readonly LodBoundary[];
  /** Natural props follow the 1000m per-prop and chunk range limits. */
  natural: boolean;
  /** Bounds of the source chunk, with its conservative full sphere. */
  chunk?: {
    x: number;
    z: number;
    extent: number;
    sphere: readonly [number, number, number, number];
  };
}

export interface GpuSceneryConfig {
  mode: 'view' | 'shadow';
  /** Mesh LOD index. For tree shadows this is the mesh index after the offset. */
  level: number;
  boundaries: readonly LodBoundary[];
  range: number;
  tree: boolean;
  shadowLodOffset?: number;
  /** Optional horizontal distance bin: lower inclusive, upper exclusive. */
  distanceMin?: number;
  distanceMax?: number;
  indexCount: number;
  firstIndex?: number;
  baseVertex?: number;
}

export interface GpuSceneryFrame {
  camera: readonly [number, number, number];
  /** Six normalized planes, each [a,b,c,d], as returned by frustumPlanes. */
  viewPlanes: Float32Array | readonly number[];
  lightPlanes: Float32Array | readonly number[];
  shadowCasterRange: number;
  naturalRange?: number;
}

export const GPU_SCENERY_CANDIDATE_BYTES = 128;
export const GPU_SCENERY_INSTANCE_BYTES = 44;
export const GPU_SCENERY_FRAME_BYTES = 224;
const WORKGROUP_SIZE = 64;
const MAX_BOUNDARIES = 3;

export const gpuSceneryCullShader = /* wgsl */ `
struct Frame {
  camera: vec4f,
  viewPlanes: array<vec4f, 6>,
  lightPlanes: array<vec4f, 6>,
  limits: vec4f,
};
struct Config {
  selection: vec4f,  // mode, mesh level, boundary count, tree
  rangeBin: vec4f,   // range, min distance, max distance, shadow LOD offset
  boundaries: array<vec4f, 3>, // fallback distance, width
  counts: vec4f,       // candidate count
};
struct DrawArgs { indexCount: u32, instanceCount: atomic<u32>, firstIndex: u32, baseVertex: i32, firstInstance: u32 };
@group(0) @binding(0) var<uniform> frame: Frame;
@group(0) @binding(1) var<storage, read> candidates: array<u32>;
@group(0) @binding(2) var<storage, read_write> instances: array<u32>;
@group(0) @binding(3) var<uniform> config: Config;
@group(0) @binding(4) var<storage, read_write> args: DrawArgs;

fn f(word: u32) -> f32 { return bitcast<f32>(word); }
fn planeVisible(planes: ptr<uniform, array<vec4f, 6>>, p: vec3f, radius: f32) -> bool {
  for (var i = 0u; i < 6u; i++) {
    let plane = (*planes)[i];
    if (dot(plane.xyz, p) + plane.w < -radius) { return false; }
  }
  return true;
}
fn lodThreshold(distance: f32, targetLevel: u32, boundaryCount: u32, candidateBase: u32) -> vec2f {
  // Returns threshold and outgoing flag; a negative threshold means this mesh
  // is not one of the active entries for this distance.
  for (var i = 0u; i < boundaryCount; i++) {
    var b = config.boundaries[i];
    if (f(candidates[candidateBase + 24u]) >= 0.0) {
      b = vec4f(f(candidates[candidateBase + 26u + i * 2u]), f(candidates[candidateBase + 27u + i * 2u]), 0.0, 0.0);
    }
    let start = b.x - b.y * 0.5;
    let end = b.x + b.y * 0.5;
    if (distance < start) {
      return select(vec2f(-1.0, 0.0), vec2f(1.0, 0.0), targetLevel == i);
    }
    if (distance < end) {
      let t = (distance - start) / b.y;
      let s = t * t * (3.0 - 2.0 * t);
      if (targetLevel == i) { return vec2f(s, 1.0); }
      if (targetLevel == i + 1u) { return vec2f(s, 0.0); }
      return vec2f(-1.0, 0.0);
    }
  }
  return select(vec2f(-1.0, 0.0), vec2f(1.0, 0.0), targetLevel == boundaryCount);
}
fn rangeFade(distance: f32, range: f32) -> f32 {
  let t = clamp((range - distance) / max(range * 0.35, 0.000001), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}
@compute @workgroup_size(${WORKGROUP_SIZE})
fn cull(@builtin(global_invocation_id) id: vec3u) {
  let index = id.x;
  let count = u32(config.counts.x);
  if (index >= count) { return; }
  let base = index * 32u;
  let position = vec3f(f(candidates[base]), f(candidates[base + 1u]), f(candidates[base + 2u]));
  let scale = f(candidates[base + 3u]);
  let q = vec4f(f(candidates[base + 4u]), f(candidates[base + 5u]), f(candidates[base + 6u]), f(candidates[base + 7u]));
  let sphere = vec4f(f(candidates[base + 8u]), f(candidates[base + 9u]), f(candidates[base + 10u]), f(candidates[base + 11u]));
  let horizontal = vec2f(f(candidates[base + 12u]), f(candidates[base + 13u]));
  let maxRange = f(candidates[base + 14u]);
  let flags = candidates[base + 15u];
  let natural = (flags & 1u) != 0u;
  let hasChunk = (flags & 2u) != 0u;
  var propRange = config.rangeBin.x;
  if (f(candidates[base + 23u]) >= 0.0) { propRange = f(candidates[base + 23u]); }
  let distance = length(horizontal - frame.camera.xz);
  if (distance < config.rangeBin.y || distance >= config.rangeBin.z) { return; }
  if (natural && distance > frame.limits.y) { return; }
  if (config.selection.x < 0.5) {
    if (distance > min(propRange, maxRange)) { return; }
  } else if (distance >= frame.limits.x + sphere.w) { return; }
  if (hasChunk) {
    let chunkSphere = vec4f(f(candidates[base + 16u]), f(candidates[base + 17u]), f(candidates[base + 18u]), f(candidates[base + 19u]));
    let inChunkView = planeVisible(&frame.viewPlanes, chunkSphere.xyz - frame.camera.xyz, chunkSphere.w);
    let inChunkLight = planeVisible(&frame.lightPlanes, chunkSphere.xyz - frame.camera.xyz, chunkSphere.w);
    if (!inChunkView && !inChunkLight) { return; }
    if (natural) {
      let chunkX = f(candidates[base + 20u]);
      let chunkZ = f(candidates[base + 21u]);
      let extent = f(candidates[base + 22u]);
      let dx = max(max(chunkX - frame.camera.x, 0.0), frame.camera.x - chunkX - extent);
      let dz = max(max(chunkZ - frame.camera.z, 0.0), frame.camera.z - chunkZ - extent);
      if (length(vec2f(dx, dz)) > frame.limits.y) { return; }
    }
  }
  let centerRelative = sphere.xyz - frame.camera.xyz;
  let visible = planeVisible(&frame.viewPlanes, centerRelative, sphere.w);
  let caster = distance < frame.limits.x + sphere.w && planeVisible(&frame.lightPlanes, centerRelative, sphere.w);
  if (config.selection.x < 0.5) {
    if (!visible) { return; }
  } else if (!caster) { return; }
  var boundaryCount = u32(config.selection.z);
  if (f(candidates[base + 24u]) >= 0.0) { boundaryCount = u32(f(candidates[base + 24u])); }
  let selectedLevel = u32(config.selection.y);
  let selectorLevel = select(selectedLevel, selectedLevel - u32(config.rangeBin.w), config.selection.x > 0.5);
  let lod = lodThreshold(distance, selectorLevel, boundaryCount, base);
  if (lod.x < 0.0) { return; }
  if (config.selection.x < 0.5 && config.selection.w > 0.5 && selectorLevel == 3u) { return; }
  let fade = select(select(rangeFade(distance, propRange), 1.0, config.selection.w > 0.5), 1.0, config.selection.x > 0.5);
  let slot = atomicAdd(&args.instanceCount, 1u);
  let output = slot * 11u;
  instances[output] = bitcast<u32>(position.x - frame.camera.x);
  instances[output + 1u] = bitcast<u32>(position.y - frame.camera.y);
  instances[output + 2u] = bitcast<u32>(position.z - frame.camera.z);
  instances[output + 3u] = bitcast<u32>(scale);
  instances[output + 4u] = bitcast<u32>(q.x);
  instances[output + 5u] = bitcast<u32>(q.y);
  instances[output + 6u] = bitcast<u32>(q.z);
  instances[output + 7u] = bitcast<u32>(q.w);
  instances[output + 8u] = bitcast<u32>(lod.x);
  instances[output + 9u] = bitcast<u32>(lod.y);
  instances[output + 10u] = bitcast<u32>(fade);
}
`;
/** Alias kept explicit for shader compilation diagnostics and test harnesses. */
export const GPU_SCENERY_SHADER = gpuSceneryCullShader;

export function packGpuSceneryFrame(frame: GpuSceneryFrame): Float32Array {
  if (frame.viewPlanes.length !== 24 || frame.lightPlanes.length !== 24) throw new Error('Scenery frames require six view and light planes');
  const packed = new Float32Array(GPU_SCENERY_FRAME_BYTES / 4);
  packed.set([frame.camera[0], frame.camera[1], frame.camera[2], 0], 0);
  packed.set(frame.viewPlanes, 4);
  packed.set(frame.lightPlanes, 28);
  packed.set([frame.shadowCasterRange, frame.naturalRange ?? 1000, 0, 0], 52);
  return packed;
}

export function createGpuSceneryFrameBuffer(device: GPUDevice): GPUBuffer {
  return device.createBuffer({ label: 'Scenery culling frame', size: GPU_SCENERY_FRAME_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
}

export function writeGpuSceneryFrame(device: GPUDevice, buffer: GPUBuffer, frame: GpuSceneryFrame): void {
  device.queue.writeBuffer(buffer, 0, packGpuSceneryFrame(frame).buffer as ArrayBuffer);
}

function finiteRange(v: number): number { return Number.isFinite(v) ? v : 1e20; }
function packCandidates(values: readonly GpuSceneryCandidate[]): Uint32Array {
  const words = new Uint32Array(values.length * 32);
  const floats = new Float32Array(words.buffer);
  for (let i = 0; i < values.length; i++) {
    const c = values[i], at = i * 32;
    if (c.transform.length !== 8) throw new Error(`Scenery candidate ${i} needs an 8-float transform`);
    for (let k = 0; k < 8; k++) floats[at + k] = c.transform[k];
    floats.set(c.sphere, at + 8);
    floats[at + 12] = c.horizontal[0]; floats[at + 13] = c.horizontal[1];
    floats[at + 14] = finiteRange(c.maxRange);
    words[at + 15] = (c.natural ? 1 : 0) | (c.chunk ? 2 : 0);
    if (c.chunk) {
      floats.set(c.chunk.sphere, at + 16);
      floats[at + 20] = c.chunk.x; floats[at + 21] = c.chunk.z; floats[at + 22] = c.chunk.extent;
    }
    floats[at + 23] = c.range === undefined ? -1 : finiteRange(c.range);
    floats[at + 24] = c.boundaries?.length ?? -1;
    if (c.boundaries) {
      if (c.boundaries.length > MAX_BOUNDARIES) throw new Error(`Scenery candidate ${i} has more than ${MAX_BOUNDARIES} LOD boundaries`);
      for (let k = 0; k < c.boundaries.length; k++) {
        floats[at + 26 + k * 2] = c.boundaries[k].distance;
        floats[at + 27 + k * 2] = c.boundaries[k].width;
      }
    }
  }
  return words;
}

interface CandidateSource {
  key: readonly GpuSceneryCandidate[];
  buffer: GPUBuffer;
  count: number;
  bytes: number;
  refs: number;
}

function packConfig(c: GpuSceneryConfig, candidateCount: number): Float32Array {
  if (c.boundaries.length > MAX_BOUNDARIES) throw new Error(`Scenery supports at most ${MAX_BOUNDARIES} LOD boundaries per batch`);
  const packed = new Float32Array(24);
  packed.set([c.mode === 'view' ? 0 : 1, c.level, c.boundaries.length, c.tree ? 1 : 0], 0);
  packed.set([finiteRange(c.range), c.distanceMin ?? 0, finiteRange(c.distanceMax ?? Infinity), c.shadowLodOffset ?? 0], 4);
  for (let i = 0; i < c.boundaries.length; i++) packed.set([c.boundaries[i].distance, c.boundaries[i].width, 0, 0], 8 + i * 4);
  packed[20] = candidateCount;
  return packed;
}

function assertConfig(c: GpuSceneryConfig): void {
  if (!Number.isInteger(c.level) || c.level < 0) throw new Error('Scenery LOD level must be a nonnegative integer');
  if (!Number.isInteger(c.indexCount) || c.indexCount < 0) throw new Error('Scenery indexCount must be a nonnegative integer');
  if (c.mode === 'shadow' && c.level < (c.shadowLodOffset ?? 0)) throw new Error('Tree shadow mesh LOD precedes the shadow LOD offset');
}

export class GpuSceneryBatch {
  instances: GPUBuffer;
  indirect: GPUBuffer;
  candidateCount: number;
  capacity: number;
  readonly estimatedBytes: number;
  private source: CandidateSource;
  private readonly configBuffer: GPUBuffer;
  private group?: GPUBindGroup;
  private boundFrameBuffer?: GPUBuffer;
  private disposed = false;
  private config: GpuSceneryConfig;

  constructor(private readonly owner: GpuSceneryCuller, candidates: readonly GpuSceneryCandidate[], config: GpuSceneryConfig, reserveFactor = 1.2) {
    assertConfig(config);
    this.config = config;
    this.candidateCount = candidates.length;
    const requestedCapacity = candidates.length;
    const reservedCapacity = Math.ceil(requestedCapacity * reserveFactor);
    const reservedBytes = Math.max(4, reservedCapacity * GPU_SCENERY_INSTANCE_BYTES);
    const outputFits = reservedBytes <= owner.device.limits.maxStorageBufferBindingSize && reservedBytes <= owner.device.limits.maxBufferSize;
    this.capacity = outputFits ? reservedCapacity : requestedCapacity;
    const outBytes = Math.max(4, this.capacity * GPU_SCENERY_INSTANCE_BYTES);
    owner.assertStorageSize(Math.max(4, candidates.length * GPU_SCENERY_CANDIDATE_BYTES), outBytes);
    const device = owner.device;
    this.source = owner.acquireCandidates(candidates);
    this.instances = device.createBuffer({ label: 'Scenery compacted instances', size: outBytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_SRC });
    this.indirect = device.createBuffer({ label: 'Scenery indexed indirect args', size: 20, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC });
    this.configBuffer = device.createBuffer({ label: 'Scenery batch selection', size: 96, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(this.configBuffer, 0, packConfig(config, candidates.length).buffer as ArrayBuffer);
    const args = new Uint32Array([config.indexCount, 0, config.firstIndex ?? 0, config.baseVertex ?? 0, 0]);
    device.queue.writeBuffer(this.indirect, 0, args);
    this.estimatedBytes = outBytes + 116;
  }

  /** Replaces static candidates. A larger replacement rebuilds this batch's GPU buffers. */
  replace(candidates: readonly GpuSceneryCandidate[], config = this.config): void {
    if (this.disposed) throw new Error('Cannot replace a disposed scenery batch');
    if (candidates.length > this.capacity) throw new Error('Replacement exceeds batch capacity; create a new batch');
    assertConfig(config);
    if (config.mode !== this.config.mode || config.level !== this.config.level || config.boundaries.length !== this.config.boundaries.length) {
      throw new Error('Changing scenery mode, LOD level, or boundary count requires a replacement batch');
    }
    if (candidates !== this.source.key) {
      const next = this.owner.acquireCandidates(candidates);
      this.owner.releaseCandidates(this.source);
      this.source = next;
      this.group = undefined;
      this.boundFrameBuffer = undefined;
    }
    this.owner.device.queue.writeBuffer(this.configBuffer, 0, packConfig(config, candidates.length).buffer as ArrayBuffer);
    this.owner.device.queue.writeBuffer(this.indirect, 0, new Uint32Array([config.indexCount, 0, config.firstIndex ?? 0, config.baseVertex ?? 0, 0]));
    this.config = config;
    this.candidateCount = candidates.length;
  }

  /** Clears instanceCount in this encoder, then compacts visible candidates. */
  encode(encoder: GPUCommandEncoder, frameBuffer: GPUBuffer): void {
    if (this.disposed) throw new Error('Cannot encode a disposed scenery batch');
    this.owner.encode(encoder, [this], frameBuffer);
  }

  resetIndirect(encoder: GPUCommandEncoder): void {
    if (this.disposed) throw new Error('Cannot encode a disposed scenery batch');
    encoder.clearBuffer(this.indirect, 4, 4);
  }

  dispatch(pass: GPUComputePassEncoder, frameBuffer: GPUBuffer): void {
    if (!this.candidateCount) return;
    if (this.boundFrameBuffer !== frameBuffer || !this.group) {
      this.boundFrameBuffer = frameBuffer;
      this.group = this.owner.device.createBindGroup({ layout: this.owner.bindGroupLayout, entries: [
        { binding: 0, resource: { buffer: frameBuffer } },
      { binding: 1, resource: { buffer: this.source.buffer } },
        { binding: 2, resource: { buffer: this.instances } },
        { binding: 3, resource: { buffer: this.configBuffer } },
        { binding: 4, resource: { buffer: this.indirect } },
      ] });
    }
    pass.setBindGroup(0, this.group);
    pass.dispatchWorkgroups(Math.ceil(this.candidateCount / WORKGROUP_SIZE));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.owner.releaseCandidates(this.source); this.configBuffer.destroy(); this.instances.destroy(); this.indirect.destroy(); this.owner.unregister(this);
  }
}

export class GpuSceneryCuller {
  readonly bindGroupLayout: GPUBindGroupLayout;
  readonly pipeline: GPUComputePipeline;
  private candidateSources = new WeakMap<readonly GpuSceneryCandidate[], CandidateSource>();
  private activeSources = new Set<CandidateSource>();
  private batches = new Set<GpuSceneryBatch>();

  private constructor(readonly device: GPUDevice, layout: GPUBindGroupLayout, pipeline: GPUComputePipeline) {
    this.bindGroupLayout = layout; this.pipeline = pipeline;
  }

  static async create(device: GPUDevice): Promise<GpuSceneryCuller> {
    const module = device.createShaderModule({ label: 'Scenery candidate culling', code: gpuSceneryCullShader });
    const pipeline = await device.createComputePipelineAsync({ label: 'Scenery candidate compaction', layout: 'auto', compute: { module, entryPoint: 'cull' } });
    const layout = pipeline.getBindGroupLayout(0);
    return new GpuSceneryCuller(device, layout, pipeline);
  }

  createBatch(candidates: readonly GpuSceneryCandidate[], config: GpuSceneryConfig, reserveFactor = 1.2): GpuSceneryBatch {
    if (!Number.isFinite(reserveFactor) || reserveFactor < 1) throw new Error('Scenery output reserve factor must be finite and at least 1');
    const batch = new GpuSceneryBatch(this, candidates, config, reserveFactor);
    this.batches.add(batch);
    return batch;
  }

  /** Resets every indirect count, then dispatches all nonempty batches in one pass. */
  encode(encoder: GPUCommandEncoder, batches: readonly GpuSceneryBatch[], frameBuffer: GPUBuffer, timestampWrites?: GPUComputePassTimestampWrites): void {
    for (const batch of batches) batch.resetIndirect(encoder);
    const hasCandidates = batches.some(batch => batch.candidateCount > 0);
    if (!hasCandidates && !timestampWrites) return;
    const pass = encoder.beginComputePass({ label: 'Cull scenery candidates', timestampWrites });
    if (hasCandidates) {
      pass.setPipeline(this.pipeline);
      for (const batch of batches) batch.dispatch(pass, frameBuffer);
    }
    pass.end();
  }

  acquireCandidates(candidates: readonly GpuSceneryCandidate[]): CandidateSource {
    const found = this.candidateSources.get(candidates);
    if (found) { found.refs++; return found; }
    const packed = packCandidates(candidates), bytes = Math.max(4, packed.byteLength);
    this.assertStorageSize(bytes, 4);
    const buffer = this.device.createBuffer({ label: 'Shared scenery static candidates', size: bytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    if (packed.byteLength) this.device.queue.writeBuffer(buffer, 0, packed.buffer as ArrayBuffer);
    const source: CandidateSource = { key: candidates, buffer, count: candidates.length, bytes, refs: 1 };
    this.candidateSources.set(candidates, source); this.activeSources.add(source);
    return source;
  }

  releaseCandidates(source: CandidateSource): void {
    if (--source.refs > 0) return;
    source.buffer.destroy(); this.activeSources.delete(source); this.candidateSources.delete(source.key);
  }

  unregister(batch: GpuSceneryBatch): void { this.batches.delete(batch); }

  get estimatedBytes(): number {
    let bytes = 0;
    for (const source of this.activeSources) bytes += source.bytes;
    for (const batch of this.batches) bytes += batch.estimatedBytes;
    return bytes;
  }

  assertStorageSize(inputBytes: number, outputBytes: number): void {
    const max = Math.min(this.device.limits.maxStorageBufferBindingSize, this.device.limits.maxBufferSize);
    if (inputBytes > max || outputBytes > max) throw new Error(`Scenery batch exceeds portable GPU buffer limits (${max}); split it into smaller batches`);
    if (Math.ceil(Math.max(1, inputBytes / GPU_SCENERY_CANDIDATE_BYTES) / WORKGROUP_SIZE) > this.device.limits.maxComputeWorkgroupsPerDimension) throw new Error('Scenery batch exceeds the portable compute dispatch limit; split it into smaller batches');
  }

  dispose(): void {
    for (const batch of [...this.batches]) batch.dispose();
    this.batches.clear();
    /* pipelines and layouts are released with the device */
  }
}

function visible(planes: ArrayLike<number>, x: number, y: number, z: number, radius: number): boolean {
  for (let i = 0; i < 6; i++) {
    const at = i * 4;
    if (planes[at] * x + planes[at + 1] * y + planes[at + 2] * z + planes[at + 3] < -radius) return false;
  }
  return true;
}
function selectedLod(distance: number, boundaries: readonly LodBoundary[], level: number): { threshold: number; outgoing: number } | null {
  for (let i = 0; i < boundaries.length; i++) {
    const b = boundaries[i], start = b.distance - b.width / 2, end = b.distance + b.width / 2;
    if (distance < start) return level === i ? { threshold: 1, outgoing: 0 } : null;
    if (distance < end) {
      const t = (distance - start) / b.width, s = t * t * (3 - 2 * t);
      if (level === i) return { threshold: s, outgoing: 1 };
      if (level === i + 1) return { threshold: s, outgoing: 0 };
      return null;
    }
  }
  return level === boundaries.length ? { threshold: 1, outgoing: 0 } : null;
}

/** Exact CPU reference for differential checks. GPU output order is atomic and unspecified. */
export function gpuSceneryReference(candidates: readonly GpuSceneryCandidate[], config: GpuSceneryConfig, frame: GpuSceneryFrame): { index: number; record: Float32Array }[] {
  assertConfig(config);
  const results: { index: number; record: Float32Array }[] = [];
  const minDistance = config.distanceMin ?? 0, maxDistance = config.distanceMax ?? Infinity;
  for (let index = 0; index < candidates.length; index++) {
    const c = candidates[index], [x, y, z, scale, qx, qy, qz, qw] = c.transform;
    const distance = Math.hypot(c.horizontal[0] - frame.camera[0], c.horizontal[1] - frame.camera[2]);
    if (distance < minDistance || distance >= maxDistance) continue;
    if (c.natural && distance > (frame.naturalRange ?? 1000)) continue;
    const propRange = c.range ?? config.range;
    if (config.mode === 'view' && distance > Math.min(propRange, c.maxRange)) continue;
    if (config.mode === 'shadow' && distance >= frame.shadowCasterRange + c.sphere[3]) continue;
    if (c.chunk) {
      const s = c.chunk.sphere, cx = s[0] - frame.camera[0], cy = s[1] - frame.camera[1], cz = s[2] - frame.camera[2];
      if (!visible(frame.viewPlanes, cx, cy, cz, s[3]) && !visible(frame.lightPlanes, cx, cy, cz, s[3])) continue;
      if (c.natural) {
        const dx = Math.max(c.chunk.x - frame.camera[0], 0, frame.camera[0] - c.chunk.x - c.chunk.extent);
        const dz = Math.max(c.chunk.z - frame.camera[2], 0, frame.camera[2] - c.chunk.z - c.chunk.extent);
        if (Math.hypot(dx, dz) > (frame.naturalRange ?? 1000)) continue;
      }
    }
    const sx = c.sphere[0] - frame.camera[0], sy = c.sphere[1] - frame.camera[1], sz = c.sphere[2] - frame.camera[2], radius = c.sphere[3];
    const inView = visible(frame.viewPlanes, sx, sy, sz, radius);
    const caster = distance < frame.shadowCasterRange + radius && visible(frame.lightPlanes, sx, sy, sz, radius);
    if (config.mode === 'view' ? !inView : !caster) continue;
    const offset = config.mode === 'shadow' ? config.shadowLodOffset ?? 0 : 0;
    const selectorLevel = config.level - offset;
    const lod = selectedLod(distance, c.boundaries ?? config.boundaries, selectorLevel);
    if (!lod || config.mode === 'view' && config.tree && selectorLevel === 3) continue;
    const t = Math.max(0, Math.min(1, (propRange - distance) / Math.max(propRange * 0.35, 1e-6)));
    const fade = config.mode === 'shadow' || config.tree ? 1 : t * t * (3 - 2 * t);
    results.push({ index, record: new Float32Array([x - frame.camera[0], y - frame.camera[1], z - frame.camera[2], scale, qx, qy, qz, qw, lod.threshold, lod.outgoing, fade]) });
  }
  return results;
}
