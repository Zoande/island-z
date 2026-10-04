import type { WorldGenerator, Prop } from './world';
import { waterGeometry, type WaterGeometry } from './water-mesh';
export const GRID = 32;
export const BASE_CHUNK = 64;
export const VERTEX_FLOATS = 16;
export interface ChunkRequest { key: string; x: number; z: number; level: number }
export interface ChunkData extends ChunkRequest { vertices: Float32Array; indices: Uint32Array; props: Prop[]; minHeight: number; maxHeight: number; water: WaterGeometry; timings?:Record<string,number> }
export function generateChunk(world: WorldGenerator, request: ChunkRequest,profile=false): ChunkData {
  const started=profile?performance.now():0;
  const extent = BASE_CHUNK * 2 ** request.level, step = extent / GRID;
  const vertices: number[] = [], indices: number[] = [];
  let minHeight = Infinity, maxHeight = -Infinity;
  const vertex = (x: number, z: number, drop = 0) => {
    const sample = world.sample(request.x + x, request.z + z), h = sample.height - drop;
    minHeight = Math.min(minHeight, h); maxHeight = Math.max(maxHeight, h);
    const index = vertices.length / VERTEX_FLOATS;
    vertices.push(x, h, z, ...sample.normal, x, z, ...sample.weights); return index;
  };
  for (let z = 0; z <= GRID; z++) for (let x = 0; x <= GRID; x++) vertex(x * step, z * step);
  for (let z = 0; z < GRID; z++) for (let x = 0; x < GRID; x++) {
    const a = z * (GRID + 1) + x, b = a + 1, c = a + GRID + 1, d = c + 1;
    indices.push(a, c, b, b, c, d);
  }
  // Edge skirts hide mismatched tessellation without moving shared surface samples.
  // Stitching handles LOD gaps; shallow skirts only cover transient roundoff cracks.
  const skirtDepth = Math.max(1.5, Math.min(8, step * .15));
  const edges = [
    Array.from({ length: GRID + 1 }, (_, i) => i),
    Array.from({ length: GRID + 1 }, (_, i) => i * (GRID + 1) + GRID),
    Array.from({ length: GRID + 1 }, (_, i) => GRID * (GRID + 1) + GRID - i),
    Array.from({ length: GRID + 1 }, (_, i) => (GRID - i) * (GRID + 1)),
  ];
  for (const edge of edges) {
    const bottoms = edge.map(i => vertex(vertices[i * VERTEX_FLOATS], vertices[i * VERTEX_FLOATS + 2], skirtDepth));
    for (let i = 0; i < GRID; i++) indices.push(edge[i], bottoms[i], edge[i + 1], edge[i + 1], bottoms[i], bottoms[i + 1]);
  }
  const meshTime=profile?performance.now():0;
  const props=request.level<=2?world.props(request.x,request.z,extent,request.level===0):request.level<=4?world.treeProps(request.x,request.z,extent):[];
  const propTime=profile?performance.now():0,water=waterGeometry(world.water,request);
  const result:ChunkData={...request,vertices:new Float32Array(vertices),indices:new Uint32Array(indices),props,minHeight,maxHeight,water};
  if(profile)result.timings={terrain:meshTime-started,props:propTime-meshTime,water:performance.now()-propTime,total:performance.now()-started};
  return result;
}
